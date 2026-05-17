/**
 * Trims the icon: pads for safe alpha-erosion (removes light semi-transparent fringe),
 * fits to a square canvas, applies a smooth rounded-rectangle mask, and writes
 * `build/icon.png` (1024×1024) for electron-builder and the dev window icon, and
 * a flattened 1024×1024 iOS `AppIcon.appiconset` file (no transparent corner holes; see `iosAppIcon.mjs`).
 * Art is scaled to a fraction of the canvas so the Dock size matches typical macOS icons (full-bleed PNGs read oversized).
 *
 * Usage: node scripts/process-app-icon.mjs [input.png]
 * Default input: resources/icons/app-icon-source.png
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { flattenPngForIosAppStore, IOS_APPIcon_PATH } from "./iosAppIcon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const DEFAULT_INPUT = path.join(root, "resources", "icons", "app-icon-source.png");
const OUTPUT = path.join(root, "build", "icon.png");
const SIZE = 1024;
/** Transparent border so alpha erosion can shrink the silhouette without edge artifacts. */
const PAD = 12;
/** 4-neighbor min-filter iterations on the alpha channel (typical 2 → ~4px tighter crop). */
const ERODE_PASSES = 2;
/** Corner radius as a fraction of canvas size. */
const CORNER_RADIUS_FRAC = 0.2;
/**
 * Draw the mark within this fraction of the final square (rest is transparent margin).
 * ~0.72 aligns with common macOS template padding so the Dock glyph matches neighbor apps.
 */
const DOCK_CONTENT_FRAC = 0.8;

function erodeAlpha5(buf, width, height) {
  const out = Buffer.alloc(buf.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let m = 255;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const x2 = x + dx;
        const y2 = y + dy;
        const a =
          x2 < 0 || x2 >= width || y2 < 0 || y2 >= height ? 0 : buf[(y2 * width + x2) * 4 + 3];
        if (a < m) {
          m = a;
        }
      }
      out[i] = buf[i];
      out[i + 1] = buf[i + 1];
      out[i + 2] = buf[i + 2];
      out[i + 3] = m;
    }
  }
  return out;
}

async function main() {
  const inputPath = path.resolve(process.argv[2] ?? DEFAULT_INPUT);
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });

  const padded = await sharp(inputPath)
    .extend({
      top: PAD,
      bottom: PAD,
      left: PAD,
      right: PAD,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  let { data, info } = padded;
  const w = info.width;
  const h = info.height;
  let buf = Buffer.from(data);
  for (let p = 0; p < ERODE_PASSES; p++) {
    buf = erodeAlpha5(buf, w, h);
  }

  const afterErode = await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();

  const trimmed = await sharp(afterErode)
    .trim({ threshold: 0 })
    .toBuffer({ resolveWithObject: true });

  const inner = Math.round(SIZE * DOCK_CONTENT_FRAC);
  const scaledArt = await sharp(trimmed.data)
    .resize(inner, inner, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .ensureAlpha()
    .png()
    .toBuffer();

  const sm = await sharp(scaledArt).metadata();
  const sw = sm.width ?? inner;
  const sh = sm.height ?? inner;
  const left = Math.floor((SIZE - sw) / 2);
  const top = Math.floor((SIZE - sh) / 2);

  const onCanvas = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: scaledArt, left, top }])
    .png()
    .toBuffer();

  const r = Math.round(SIZE * CORNER_RADIUS_FRAC);
  const svgMask = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}">
      <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${r}" ry="${r}" fill="#fff"/>
    </svg>`
  );

  const out = await sharp(onCanvas)
    .ensureAlpha()
    .composite([{ input: svgMask, blend: "dest-in" }])
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true
    })
    .toBuffer();

  await fs.writeFile(OUTPUT, out);
  console.log(
    `Wrote ${OUTPUT} (${SIZE}×${SIZE}, trimmed ${trimmed.info.width}×${trimmed.info.height} after fringe cleanup)`
  );

  const iosOut = await flattenPngForIosAppStore(out);
  await fs.writeFile(IOS_APPIcon_PATH, iosOut);
  console.log(`Wrote ${IOS_APPIcon_PATH} (iOS: transparent corners filled to match plate)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
