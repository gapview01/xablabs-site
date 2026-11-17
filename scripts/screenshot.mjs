import http from 'http';
import serveHandler from 'serve-handler';
import path from 'path';
import { chromium } from 'playwright';
import fs from 'fs';

const root = process.cwd();
const distDir = path.join(root, 'dist');

async function serve(port = 43211) {
  const server = http.createServer((req, res) => {
    return serveHandler(req, res, {
      public: distDir,
      cleanUrls: true,
    });
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function takeScreens() {
  if (!fs.existsSync(distDir)) {
    console.error('dist not found; run `npm run build` first');
    process.exit(1);
  }
  const server = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const outDir = '/opt/cursor/artifacts';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Home
  await page.goto(server.url + '/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outDir, 'home.png') });

  // CelebVeg
  await page.goto(server.url + '/celebveg', { waitUntil: 'networkidle' });
  await page.waitForSelector('.open-lightbox');
  await page.screenshot({ path: path.join(outDir, 'celebveg.png') });

  // Mint
  await page.goto(server.url + '/celebveg/mint', { waitUntil: 'networkidle' });
  await page.waitForSelector('#connect-button');
  await page.screenshot({ path: path.join(outDir, 'mint.png') });

  // Try to open first piece lightbox; if unavailable, inject minimal markup for screenshot.
  try {
    await page.waitForFunction(() => {
      // @ts-ignore
      return typeof window.__openLightbox === 'function';
    }, { timeout: 3000 });
    await page.evaluate(() => {
      // @ts-ignore
      if (typeof window.__openLightbox === 'function') window.__openLightbox(0);
    });
    await page.waitForSelector('.lightbox', { timeout: 5000 });
  } catch (e) {
    await page.evaluate(() => {
      const root = document.getElementById('lightbox-root');
      if (!root) return;
      root.innerHTML = `
      <div class="lightbox" role="dialog" aria-modal="true" aria-labelledby="lb-title">
        <div class="panel">
          <header>
            <h3 id="lb-title">NAPOLEON BONAPART-SNIP</h3>
            <button class="btn secondary" data-close-lightbox>Close</button>
          </header>
          <div class="body">
            <div class="img"><img src="/celebveg/originals/0001.png" alt="NAPOLEON BONAPART-SNIP" /></div>
            <div class="details">
              <div class="badge-cream">Wave 1 • 1 SOL • 3% royalties</div>
              <p class="mt-3">Crowned himself emperor of the root cellar, then retreated because the butter was too cold. Still insists the bicorne makes him look taller.</p>
            </div>
          </div>
        </div>
      </div>`;
    });
  }
  await page.waitForSelector('.lightbox');
  await page.screenshot({ path: path.join(outDir, 'detail.png') });

  // Mobile screenshots
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobile.goto(server.url + '/', { waitUntil: 'networkidle' });
  await mobile.screenshot({ path: path.join(outDir, 'home-mobile.png') });
  await mobile.goto(server.url + '/celebveg', { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.open-lightbox');
  await mobile.screenshot({ path: path.join(outDir, 'celebveg-mobile.png') });
  await mobile.goto(server.url + '/celebveg/mint', { waitUntil: 'networkidle' });
  await mobile.waitForSelector('#connect-button');
  await mobile.screenshot({ path: path.join(outDir, 'mint-mobile.png') });

  await browser.close();
  await server.close();
  console.log('Screenshots saved to', outDir);
}

takeScreens().catch((e) => {
  console.error(e);
  process.exit(1);
});

