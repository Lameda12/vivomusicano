// Generates every logo/icon asset from the single source image.
// Usage: npm run icons   (re-run after changing assets/logo-source.png)
import sharp from "sharp";

const SRC = "assets/logo-source.png";
const BG = { r: 7, g: 4, b: 16 };

// The source has black padding around the rounded tile: find the tile and crop it square.
const { data, info } = await sharp(SRC).greyscale().raw().toBuffer({ resolveWithObject: true });
let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[y * info.width + x] > 6) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
}
const side = Math.max(x1 - x0, y1 - y0);
const left = Math.max(0, Math.round((x0 + x1 - side) / 2));
const top = Math.max(0, Math.round((y0 + y1 - side) / 2));
const tile = () => sharp(SRC).extract({ left, top, width: side, height: side });

// Rounded-corner mask so the icon sits cleanly on light and dark backgrounds.
const rounded = async (size) => {
  const r = Math.round(size * 0.225);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`,
  );
  return tile()
    .resize(size, size)
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9, palette: true, quality: 90 });
};

await (await rounded(256)).toFile("public/logo.png"); // README + in-app mark
await (await rounded(48)).toFile("app/icon.png"); // browser tab
await tile().resize(180, 180).flatten({ background: BG }).png({ compressionLevel: 9 }).toFile("app/apple-icon.png");

// 1200x630 Open Graph / social preview card.
const W = 1200, H = 630, L = 340;
const text = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <style>text{font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-weight:900}</style>
  <text x="500" y="270" font-size="74" fill="#ffffff">vivomusicano</text>
  <text x="504" y="345" font-size="36" fill="#ff8c3c">Play chords with your hands.</text>
  <text x="504" y="400" font-size="24" fill="#c8bedc">Webcam gesture synth · on-device · open source</text>
</svg>`);
await sharp({ create: { width: W, height: H, channels: 3, background: BG } })
  .composite([
    { input: await (await rounded(L)).toBuffer(), left: 100, top: Math.round((H - L) / 2) },
    { input: text, left: 0, top: 0 },
  ])
  .png({ compressionLevel: 9 })
  .toFile("app/opengraph-image.png");

console.log("icons written: public/logo.png, app/icon.png, app/apple-icon.png, app/opengraph-image.png");
