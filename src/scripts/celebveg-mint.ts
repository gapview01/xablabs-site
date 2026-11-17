/* Buffer polyfill for browser environments */
import { Buffer } from 'buffer';
// @ts-ignore
if (typeof (globalThis as any).Buffer === 'undefined') {
  // @ts-ignore
  (globalThis as any).Buffer = Buffer;
}

import mintConfigJson from '../data/mint.json';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
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

  if (!connectBtn || !mintBtn || !msgEl || !walletEl || !remainingEl || !availableEl) {
    // Page is missing expected elements; nothing to do.
    return;
  }

  let umi: Umi = createUmi(mintConfig.rpc).use(mplCore()).use(mplCandyMachine());
  const wallet = new PhantomWalletAdapter();
  umi = umi.use(walletAdapterIdentity(wallet as any));

  async function loadStatus(): Promise<void> {
    try {
      const cm = await fetchCandyMachine(umi, publicKey(mintConfig.candyMachine));
      // itemsAvailable and itemsRedeemed are numbers/bigints depending on version; coerce safely.
      const available = Number((cm as any).itemsAvailable ?? mintConfig.itemsAvailable ?? 0);
      const redeemed = Number((cm as any).itemsRedeemed ?? 0);
      const remaining = Math.max(available - redeemed, 0);
      if (remainingEl) remainingEl.textContent = String(remaining);
      if (availableEl) availableEl.textContent = String(available);
      if (remaining <= 0) {
        mintBtn.disabled = true;
        msgEl.textContent = 'Sold out.';
      } else {
        if (wallet.connected) {
          mintBtn.disabled = false;
        }
        if (!wallet.connected && !mintBtn.disabled) {
          mintBtn.disabled = true;
        }
      }
    } catch (e) {
      // Surface status load error but do not hard-fail the page.
      msgEl.textContent = 'Unable to load mint status. Please retry.';
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
    msgEl.textContent = 'Connect Phantom to mint.';
    if (explorerEl) {
      explorerEl.style.display = 'none';
      explorerEl.removeAttribute('href');
    }
  }

  wallet.on('disconnect', onDisconnect);

  connectBtn.addEventListener('click', async () => {
    try {
      if (
        location.protocol !== 'https:' &&
        location.hostname !== 'localhost' &&
        location.hostname !== '127.0.0.1'
      ) {
        msgEl.textContent =
          'Phantom may refuse to connect on non-HTTPS pages. This site will work once HTTPS is enforced.';
      }

      // Quick check for Phantom provider in the browser.
      // @ts-ignore
      const hasPhantom = typeof window !== 'undefined' && (window.phantom?.solana || window.solana);
      if (!hasPhantom) {
        msgEl.textContent =
          'Phantom was not found. Install Phantom, then reload this page.';
        return;
      }

      connectBtn.disabled = true;
      msgEl.textContent = 'Connecting wallet…';
      await wallet.connect();
      const addr = wallet.publicKey?.toBase58?.() ?? '';
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
    } finally {
      connectBtn.disabled = false;
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
      if (!wallet.connected) {
        msgEl.textContent = 'Connect Phantom to mint.';
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
      mintBtn.disabled = !wallet.connected || remaining <= 0;
    }
  });
}

