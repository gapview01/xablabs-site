// @ts-check
import { defineConfig } from 'astro/config';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://astro.build/config
export default defineConfig({
  site: 'https://xablabs.io',
  output: 'static',
  vite: {
    plugins: [],
    define: {
      global: 'globalThis',
    },
  },
});
