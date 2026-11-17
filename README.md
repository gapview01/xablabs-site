# Xab Labs — static site (Astro)

Static, mobile‑first site for Xab Labs with CelebVeg as the flagship collection.

- Home: `/`
- CelebVeg: `/celebveg`

Built with [Astro](https://astro.build). Fast, no client framework.

## Local dev

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The build runs a data step to collate NFT metadata and optimize images, then outputs to `dist/`.

## Open Graph and favicon

- Per‑page Open Graph/Twitter meta uses `public/assets/banner_v3.jpg`.
- Favicon is generated from the Napoleon image into `public/favicon.png`. A generic `favicon.ico` is kept as fallback.

## Adding a new wave

Wave data is generated from Metaplex JSON + images. To add more pieces:

1) Drop files into `data-src/uploads/`
   - Artwork images: `NNNN_*.{png,jpg,webp}` (e.g. `0011_abcd.png`)
   - Metadata JSON: `NNNN_*.json` with standard Metaplex fields (`name`, `description`, `attributes`, …)
   - Use matching numeric prefixes so each JSON pairs with its image (e.g. `0011_*.json` with `0011_*.png`)
2) Run:
   ```bash
   npm run generate
   ```
   This will:
   - Copy originals to `public/celebveg/originals/NNNN.ext`
   - Create optimized WebP thumbs at `public/celebveg/thumbs/NNNN.webp` (720×720)
   - Rebuild `src/data/celebveg.json`
3) Commit the new files. The gallery will automatically include them on `/celebveg` (sorted by `NNNN`).

Notes:
- Keep originals high‑res for the lightbox. Thumbs are used in the grid for speed.
- The collection banner/cover live under `public/assets/`.

## Deploy (GitHub Pages)

A GitHub Actions workflow builds on push to `main` and deploys to Pages. Custom domain is configured via `public/CNAME` with `xablabs.io`.

