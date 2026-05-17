/**
 * iOS (and App Store) expect a 1024×1024 icon with no "hole" in the alpha channel.
 * The Dock icon pipeline uses a rounded-rect mask with transparent corners, which
 * iOS draws as a black border. This flattens those pixels to the app background color.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
export const IOS_APPIcon_PATH = path.join(
  root,
  "ios",
  "App",
  "App",
  "Assets.xcassets",
  "AppIcon.appiconset",
  "AppIcon-512@2x.png"
);

/** Pixels inside the mark but not the white letter, for sampling plate color. */
const BG_SAMPLE = [
  [0.2, 0.2],
  [0.25, 0.3],
  [0.3, 0.2],
  [0.22, 0.28]
];

/**
 * @param {Buffer} pngBuffer
 * @returns {Promise<{ r: number; g: number; b: number }>}
 */
export async function samplePlaqueBackgroundRgb(pngBuffer) {
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  for (const [fx, fy] of BG_SAMPLE) {
    const x = Math.min(w - 1, Math.max(0, Math.floor(fx * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(fy * h)));
    const i = (y * w + x) * 4;
    const a = data[i + 3];
    if (a < 40) {
      continue;
    }
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r + g + b > 720) {
      continue;
    }
    return { r, g, b };
  }
  return { r: 208, g: 159, b: 72 };
}

/**
 * @param {Buffer} pngBuffer
 * @returns {Promise<Buffer>}
 */
export async function flattenPngForIosAppStore(pngBuffer) {
  const { r, g, b } = await samplePlaqueBackgroundRgb(pngBuffer);
  return await sharp(pngBuffer)
    .flatten({ background: { r, g, b, alpha: 1 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

const __filename = fileURLToPath(import.meta.url);

async function cli() {
  const input = path.resolve(process.argv[2] ?? path.join(root, "build", "icon.png"));
  const raw = await fs.readFile(input);
  const out = await flattenPngForIosAppStore(raw);
  await fs.writeFile(IOS_APPIcon_PATH, out);
  console.log(`Wrote ${IOS_APPIcon_PATH} (opaque, flattened from ${input})`);
}

if (path.resolve(__filename) === path.resolve(process.argv[1] ?? "")) {
  cli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
