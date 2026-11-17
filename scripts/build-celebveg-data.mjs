import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const root = process.cwd();
const uploadsDir = path.join(root, 'data-src', 'uploads');
const publicDir = path.join(root, 'public');
const originalsDir = path.join(publicDir, 'celebveg', 'originals');
const thumbsDir = path.join(publicDir, 'celebveg', 'thumbs');
const assetsDir = path.join(publicDir, 'assets');
const dataOut = path.join(root, 'src', 'data', 'celebveg.json');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/** @param {string} p */
function basenameNoExt(p) {
  return path.basename(p).replace(path.extname(p), '');
}

/** @param {string} filename */
function getPrefix(filename) {
  const m = filename.match(/^(\d{4})_/);
  return m ? m[1] : null;
}

async function copyAndProcessAssets() {
  ensureDir(originalsDir);
  ensureDir(thumbsDir);
  ensureDir(assetsDir);

  // Copy banner and cover
  const bannerSrc = path.join(uploadsDir, 'banner_v3_b212.jpg');
  const coverSrc = path.join(uploadsDir, 'cover_v3_1fc7.jpg');
  if (fs.existsSync(bannerSrc)) await fsp.copyFile(bannerSrc, path.join(assetsDir, 'banner_v3.jpg'));
  if (fs.existsSync(coverSrc)) await fsp.copyFile(coverSrc, path.join(assetsDir, 'cover_v3.jpg'));
}

async function buildPieces() {
  const entries = await fsp.readdir(uploadsDir);
  const jsonFiles = entries.filter((f) => f.endsWith('.json') && /^\d{4}_/.test(f) && !f.includes('collection'));
  const imageFiles = entries.filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && /^\d{4}_/.test(f));

  /** @type {Record<string, { json?: string; image?: string }>} */
  const byPrefix = {};
  for (const f of jsonFiles) {
    const p = getPrefix(f);
    if (!p) continue;
    byPrefix[p] = byPrefix[p] || {};
    byPrefix[p].json = f;
  }
  for (const f of imageFiles) {
    const p = getPrefix(f);
    if (!p) continue;
    byPrefix[p] = byPrefix[p] || {};
    byPrefix[p].image = f;
  }

  /** @type {any[]} */
  const pieces = [];

  for (const prefix of Object.keys(byPrefix).sort()) {
    const pair = byPrefix[prefix];
    if (!pair.json || !pair.image) {
      console.warn('Skipping', prefix, 'missing json or image');
      continue;
    }

    const jsonPath = path.join(uploadsDir, pair.json);
    const imgPath = path.join(uploadsDir, pair.image);
    const meta = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));

    const ext = path.extname(imgPath).toLowerCase();
    const baseName = `${prefix}${ext}`;
    const destOriginal = path.join(originalsDir, baseName);
    const destThumb = path.join(thumbsDir, `${prefix}.webp`);

    // Copy original
    await fsp.copyFile(imgPath, destOriginal);
    // Create thumb
    await sharp(imgPath).resize({ width: 720, height: 720, fit: 'cover' }).webp({ quality: 86 }).toFile(destThumb);

    pieces.push({
      id: prefix,
      name: meta.name,
      description: meta.description,
      shortDescription:
        typeof meta.description === 'string' && meta.description.length > 120
          ? meta.description.slice(0, 117) + '…'
          : meta.description,
      attributes: Array.isArray(meta.attributes) ? meta.attributes : [],
      image: `/celebveg/originals/${baseName}`,
      thumb: `/celebveg/thumbs/${prefix}.webp`,
    });
  }

  // Sort numerically
  pieces.sort((a, b) => Number(a.id) - Number(b.id));

  await fsp.writeFile(dataOut, JSON.stringify(pieces, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${pieces.length} pieces to ${path.relative(root, dataOut)}`);

  // Generate favicon from piece 0001 image if present
  const first = Object.values(byPrefix).sort((a, b) => (a.json || '').localeCompare(b.json || ''))[0];
  if (first?.image) {
    const src = path.join(uploadsDir, first.image);
    const favPng = path.join(publicDir, 'favicon.png');
    await sharp(src).resize(64, 64, { fit: 'cover' }).png().toFile(favPng);
    console.log('Generated favicon.png from', first.image);
  }
}

async function main() {
  await copyAndProcessAssets();
  await buildPieces();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

