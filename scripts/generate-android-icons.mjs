// Generates Android launcher icons from public/icon-512.png using sharp.
// Replaces Capacitor generic icons with TILA branding.
import sharp from "sharp";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "public", "icon-512-maskable.png");
const RES = join(ROOT, "android", "app", "src", "main", "res");

if (!existsSync(SRC)) {
  console.error("Source not found:", SRC);
  process.exit(1);
}

// [density, launcher_size, foreground_size]
const DENSITIES = [
  ["mipmap-mdpi",    48,  108],
  ["mipmap-hdpi",    72,  162],
  ["mipmap-xhdpi",   96,  216],
  ["mipmap-xxhdpi",  144, 324],
  ["mipmap-xxxhdpi", 192, 432],
];

async function generate() {
  for (const [density, size, fgSize] of DENSITIES) {
    const dir = join(RES, density);

    // ic_launcher.png — standard square icon
    await sharp(SRC)
      .resize(size, size, { fit: "contain", background: { r: 9, g: 9, b: 11, alpha: 1 } })
      .png()
      .toFile(join(dir, "ic_launcher.png"));

    // ic_launcher_round.png — circular icon (same content, Android clips to circle)
    await sharp(SRC)
      .resize(size, size, { fit: "contain", background: { r: 9, g: 9, b: 11, alpha: 1 } })
      .png()
      .toFile(join(dir, "ic_launcher_round.png"));

    // ic_launcher_foreground.png — adaptive icon foreground (logo centered in safe zone)
    // Safe zone = inner 66/108 of the canvas = ~61%. Pad logo to 72% of fgSize to stay safe.
    const logoSize = Math.round(fgSize * 0.62);
    await sharp(SRC)
      .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top:    Math.floor((fgSize - logoSize) / 2),
        bottom: Math.ceil((fgSize - logoSize) / 2),
        left:   Math.floor((fgSize - logoSize) / 2),
        right:  Math.ceil((fgSize - logoSize) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(join(dir, "ic_launcher_foreground.png"));

    console.log(`✓ ${density} (${size}px launcher, ${fgSize}px foreground)`);
  }
  console.log("Done — Android icons generated.");
}

generate().catch(err => { console.error(err); process.exit(1); });
