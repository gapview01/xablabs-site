type AnimPieceState = {
  root: HTMLElement;
  img: HTMLImageElement;
  video: HTMLVideoElement;
  muteBtn: HTMLButtonElement | null;
  hasGesture: boolean;
  prefersReduced: boolean;
};

function createState(root: HTMLElement): AnimPieceState | null {
  const img = root.querySelector<HTMLImageElement>('img.still');
  const video = root.querySelector<HTMLVideoElement>('video.clip');
  if (!img || !video) return null;
  const muteBtn = root.querySelector<HTMLButtonElement>('button.mute-toggle');
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  return { root, img, video, muteBtn, hasGesture: false, prefersReduced };
}

function showVideo(state: AnimPieceState): void {
  state.root.classList.add('is-playing');
  state.video.style.visibility = 'visible';
  state.video.style.opacity = '1';
  state.muteBtn && (state.muteBtn.style.display = 'inline-flex');
}
function hideVideo(state: AnimPieceState): void {
  state.root.classList.remove('is-playing');
  state.video.pause();
  state.video.currentTime = 0;
  state.video.style.opacity = '0';
  // Delay visibility off to let fade finish
  window.setTimeout(() => {
    if (!state.root.classList.contains('is-playing')) {
      state.video.style.visibility = 'hidden';
    }
  }, 150);
  state.muteBtn && (state.muteBtn.style.display = 'none');
}

function playOnce(state: AnimPieceState, withSound: boolean): void {
  state.video.muted = !withSound;
  // Ensure playsinline for iOS
  state.video.setAttribute('playsinline', 'true');
  state.video.loop = false;
  state.video.currentTime = 0;
  showVideo(state);
  state.video.play().catch(() => {
    // Autoplay may be blocked; fall back to muted
    state.video.muted = true;
    state.video.play().catch(() => hideVideo(state));
  });
}

export function initAnimatePieces(): void {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('.anim-piece'));
  const globalState = { hasGesture: false };
  const gestureHandler = () => (globalState.hasGesture = true);
  window.addEventListener('click', gestureHandler, { once: true, capture: true });
  window.addEventListener('touchstart', gestureHandler, { once: true, capture: true, passive: true });
  roots.forEach((root) => {
    const state = createState(root);
    if (!state) return;
    const { video, muteBtn } = state;
    // On hover: if reduced motion, do nothing
    root.addEventListener('mouseenter', () => {
      if (state.prefersReduced) return;
      playOnce(state, globalState.hasGesture);
    });
    root.addEventListener('mouseleave', () => {
      // Fade back to still
      hideVideo(state);
    });
    // On click/tap: always replay with sound and mark gesture
    root.addEventListener('click', (e) => {
      e.preventDefault();
      globalState.hasGesture = true;
      playOnce(state, true);
    });
    // When video ends, fade back to still
    video.addEventListener('ended', () => hideVideo(state));
    // Mute toggle only while playing
    if (muteBtn) {
      muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        video.muted = !video.muted;
        muteBtn.setAttribute('aria-pressed', String(!video.muted));
        muteBtn.textContent = video.muted ? 'Unmute' : 'Mute';
      });
    }
  });
}

