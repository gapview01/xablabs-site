/* Buffer polyfill for browser environments */
import { Buffer } from 'buffer';
// @ts-ignore
if (typeof (globalThis as any).Buffer === 'undefined') {
  // @ts-ignore
  (globalThis as any).Buffer = Buffer;
}

import mintConfigJson from '../data/mint.json';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletReadyState, type WalletAdapter } from '@solana/wallet-adapter-base';
// Optional adapters for standard wallets
// These are light wrappers around injected wallets and only load if present.
// They enable Solflare and Backpack in addition to Phantom.
// eslint-disable-next-line import/no-extraneous-dependencies
import { SolflareWalletAdapter, BackpackWalletAdapter } from '@solana/wallet-adapter-wallets';
// Wallet Standard detection (used for presence checks and future extensibility)
// eslint-disable-next-line import/no-extraneous-dependencies
import { getWallets } from '@wallet-standard/app';
import { createUmi, generateSigner, publicKey, some } from '@metaplex-foundation/umi';
import type { Umi } from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import {
  fetchCandyMachine,
  mintV1,
  mplCandyMachine,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { PublicKey as Web3PublicKey } from '@solana/web3.js';

type MintConfig = {
  collection: string;
  candyMachine: string;
  candyGuard: string;
  owner: string;
  priceSol: number;
  itemsAvailable: number;
  rpc: string;
  network: string;
};

const mintConfig = mintConfigJson as MintConfig;

function shorten(address: string, head = 4, tail = 4): string {
  if (address.length <= head + tail) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function initMintPage(): void {
  const connectBtn = document.getElementById('connect-button') as HTMLButtonElement | null;
  const mintBtn = document.getElementById('mint-button') as HTMLButtonElement | null;
  const msgEl = document.getElementById('mint-message') as HTMLParagraphElement | null;
  const walletEl = document.getElementById('wallet-address') as HTMLElement | null;
  const remainingEl = document.getElementById('mint-remaining') as HTMLElement | null;
  const availableEl = document.getElementById('mint-available') as HTMLElement | null;
  const explorerEl = document.getElementById('mint-explorer') as HTMLAnchorElement | null;
  const progressEl = document.getElementById('mint-progress') as HTMLDivElement | null;
  const pickerEl = document.getElementById('wallet-picker') as HTMLDivElement | null;
  const deeplinksEl = document.getElementById('mobile-deeplinks') as HTMLDivElement | null;
  const openPhantom = document.getElementById('open-phantom') as HTMLAnchorElement | null;
  const openSolflare = document.getElementById('open-solflare') as HTMLAnchorElement | null;

  if (!connectBtn || !mintBtn || !msgEl || !walletEl || !remainingEl || !availableEl) {
    // Page is missing expected elements; nothing to do.
    return;
  }

  let umi: Umi = createUmi(mintConfig.rpc).use(mplCore()).use(mplCandyMachine());
  let wallet: WalletAdapter | null = null;
  // Pre-set available to config so UI never shows empty fallback on slow networks
  availableEl.textContent = String(mintConfig.itemsAvailable ?? 10);

  async function loadStatus(): Promise<void> {
    try {
      const timeoutMs = 10_000;
      const cm = (await Promise.race([
        fetchCandyMachine(umi, publicKey(mintConfig.candyMachine)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs)),
      ])) as any;
      // itemsAvailable and itemsRedeemed are numbers/bigints depending on version; coerce safely.
      const available = Number((cm as any).itemsAvailable ?? mintConfig.itemsAvailable ?? 0);
      const redeemed = Number((cm as any).itemsRedeemed ?? 0);
      const remaining = Math.max(available - redeemed, 0);
      if (remainingEl) remainingEl.textContent = String(remaining);
      if (availableEl) availableEl.textContent = String(available);
      if (progressEl) {
        const minted = Math.max(available - remaining, 0);
        const pct = available > 0 ? Math.min(100, Math.round((minted / available) * 100)) : 0;
        progressEl.style.width = `${pct}%`;
        progressEl.parentElement?.setAttribute('aria-valuenow', String(minted));
        progressEl.parentElement?.setAttribute('aria-valuemax', String(available));
      }
      if (remaining <= 0) {
        mintBtn.disabled = true;
        msgEl.textContent = 'Sold out.';
      } else {
        if (wallet?.connected) {
          mintBtn.disabled = false;
        }
        if (!wallet?.connected && !mintBtn.disabled) {
          mintBtn.disabled = true;
        }
      }
    } catch (e) {
      // Surface status load error but do not hard-fail the page.
      // Fallback to config so iOS Safari never shows "–"
      const available = Number(mintConfig.itemsAvailable ?? 10);
      if (availableEl) availableEl.textContent = String(available);
      if (remainingEl) remainingEl.textContent = String(available);
      if (progressEl) {
        progressEl.style.width = '0%';
        progressEl.parentElement?.setAttribute('aria-valuenow', '0');
        progressEl.parentElement?.setAttribute('aria-valuemax', String(available));
      }
      msgEl.textContent = 'Live counter temporarily unavailable. You can still mint.';
      console.error('loadStatus error', e);
    }
  }

  // Initial status and periodic refresh
  loadStatus();
  const interval = window.setInterval(loadStatus, 20_000);
  window.addEventListener('beforeunload', () => window.clearInterval(interval));

  function onDisconnect(): void {
    walletEl.textContent = 'Not connected';
    mintBtn.disabled = true;
    msgEl.textContent = 'Connect a wallet to mint.';
    if (explorerEl) {
      explorerEl.style.display = 'none';
      explorerEl.removeAttribute('href');
    }
  }

  function isMobile(): boolean {
    return /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator as any).maxTouchPoints > 1;
  }
  function inPhantomInApp(): boolean {
    // @ts-ignore
    return !!(window?.phantom?.solana?.isPhantom && /Phantom/.test(navigator.userAgent));
  }
  function inSolflareInApp(): boolean {
    // @ts-ignore
    return !!(window as any).solflare?.isSolflare;
  }
  // Setup deep links on mobile when no extension context
  (function setupDeeplinks() {
    if (!deeplinksEl || !openPhantom || !openSolflare) return;
    const url = encodeURIComponent(location.href);
    const ref = encodeURIComponent(location.origin);
    openPhantom.href = `https://phantom.app/ul/browse/${url}?ref=${ref}`;
    openSolflare.href = `https://solflare.com/ul/v1/browse/${url}?ref=${ref}`;
    const shouldShow = isMobile() && !inPhantomInApp() && !inSolflareInApp();
    deeplinksEl.style.display = shouldShow ? 'flex' : 'none';
  })();

  // Build wallet list using adapters; only show installed or loadable
  const adapters: WalletAdapter[] = [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter({ network: mintConfig.network as any }),
    new BackpackWalletAdapter(),
  ];
  // Eagerly check Wallet Standard (this can cause late injections to be picked up)
  try {
    getWallets()?.get();
  } catch {}
  function sortAdapters(list: WalletAdapter[]): WalletAdapter[] {
    const byInstalled = (a: WalletAdapter) =>
      a.readyState === WalletReadyState.Installed || a.readyState === WalletReadyState.Loadable;
    const weight = (a: WalletAdapter) => (a.name.toLowerCase().includes('phantom') ? 0 : 1);
    return list
      .filter(byInstalled)
      .sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name));
  }
  function renderPicker(): void {
    if (!pickerEl) return;
    pickerEl.innerHTML = '';
    const list = sortAdapters(adapters);
    if (list.length === 0) {
      pickerEl.style.display = 'none';
      return;
    }
    pickerEl.style.display = 'grid';
    for (const a of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn secondary';
      btn.textContent = `Connect ${a.name}`;
      btn.addEventListener('click', async () => {
        await connectWith(a);
      });
      pickerEl.appendChild(btn);
    }
  }

  async function connectWith(adapter: WalletAdapter): Promise<void> {
    try {
      if (wallet && wallet !== adapter) {
        try {
          await wallet.disconnect();
        } catch {}
      }
      wallet = adapter;
      umi = createUmi(mintConfig.rpc).use(mplCore()).use(mplCandyMachine()).use(walletAdapterIdentity(wallet as any));

      wallet.on('disconnect', onDisconnect);

      msgEl.textContent = `Connecting ${wallet.name}…`;
      await wallet.connect?.();
      const addr = wallet?.publicKey ? (wallet.publicKey as any).toBase58?.() : '';
      if (addr) {
        walletEl.textContent = shorten(addr);
        msgEl.textContent = 'Wallet connected. You can mint now.';
        await loadStatus();
        const remaining = Number(remainingEl.textContent ?? '0');
        mintBtn.disabled = remaining <= 0 ? true : false;
      } else {
        onDisconnect();
      }
    } catch (e) {
      console.error('connect error', e);
      msgEl.textContent = (e as Error)?.message ?? 'Failed to connect wallet.';
      onDisconnect();
    }
  }

  connectBtn.addEventListener('click', async () => {
    // HTTPS note
    if (
      location.protocol !== 'https:' &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1'
    ) {
      msgEl.textContent =
        'Wallets may refuse to connect on non-HTTPS pages. This will work once HTTPS is enforced.';
    }
    renderPicker();
    if (pickerEl && pickerEl.style.display !== 'none') {
      pickerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  mintBtn.addEventListener('click', async () => {
    try {
      msgEl.textContent = 'Preparing mint…';
      mintBtn.disabled = true;
      await loadStatus();
      const remaining = Number(remainingEl.textContent ?? '0');
      if (remaining <= 0) {
        msgEl.textContent = 'Sold out.';
        return;
      }
      if (!wallet?.connected) {
        msgEl.textContent = 'Connect a wallet to mint.';
        return;
      }

      const asset = generateSigner(umi);
      const destination = publicKey(mintConfig.owner);

      const builder = setComputeUnitLimit(umi, { units: 800_000 }).add(
        mintV1(umi, {
          candyMachine: publicKey(mintConfig.candyMachine),
          candyGuard: publicKey(mintConfig.candyGuard),
          collection: publicKey(mintConfig.collection),
          asset,
          mintArgs: {
            solPayment: some({ destination }),
          },
        })
      );

      await builder.sendAndConfirm(umi, { confirm: 'confirmed' });

      const assetAddress = new Web3PublicKey(asset.publicKey).toBase58();
      msgEl.innerHTML = `Minted. Your piece: <code>${assetAddress}</code>`;
      if (explorerEl) {
        const net = mintConfig.network || 'mainnet-beta';
        const url =
          net === 'mainnet-beta'
            ? `https://explorer.solana.com/address/${assetAddress}`
            : `https://explorer.solana.com/address/${assetAddress}?cluster=${encodeURIComponent(
                net
              )}`;
        explorerEl.href = url;
        explorerEl.style.display = 'inline-block';
      }

      // Confetti burst (respect reduced motion)
      try {
        const prefersReduced =
          window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!prefersReduced) {
          const burst = document.createElement('div');
          burst.style.position = 'fixed';
          burst.style.inset = '0';
          burst.style.pointerEvents = 'none';
          burst.style.zIndex = '200';
          document.body.appendChild(burst);
          const colors = ['#1d4ed8', '#ff3ea5', '#15c47e', '#7c3aed', '#ff7a1a', '#facc15'];
          const N = 60;
          for (let i = 0; i < N; i++) {
            const el = document.createElement('div');
            const size = 6 + Math.random() * 6;
            el.style.position = 'absolute';
            el.style.left = '50%';
            el.style.top = '50%';
            el.style.width = `${size}px`;
            el.style.height = `${size}px`;
            el.style.borderRadius = '2px';
            el.style.background = colors[i % colors.length];
            el.style.transform = `translate(-50%, -50%) rotate(${Math.random() * 360}deg)`;
            el.style.opacity = '0.95';
            burst.appendChild(el);
            const angle = Math.random() * Math.PI * 2;
            const distance = 200 + Math.random() * 260;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;
            const rotate = (Math.random() * 360).toFixed(0);
            el.animate(
              [
                { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
                { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) rotate(${rotate}deg)`, opacity: 0 },
              ],
              { duration: 1000 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,0,1)' }
            );
          }
          window.setTimeout(() => burst.remove(), 1500);
        }
      } catch {}

      await loadStatus();
    } catch (e) {
      console.error('mint error', e);
      msgEl.textContent =
        (e as Error)?.message ??
        'Mint failed. Please try again or check your wallet/network.';
    } finally {
      // Only re-enable if still connected and not sold out
      await loadStatus();
      const remaining = Number(remainingEl.textContent ?? '0');
      mintBtn.disabled = !wallet?.connected || remaining <= 0;
    }
  });
}

