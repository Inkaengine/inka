// Render the site's icons from public/favicon.svg (the Inka mark):
//   public/favicon.ico            16, 32 and 48px on a white tile (an .ico can't follow
//                                 dark mode), for browsers without SVG favicons
//   public/apple-touch-icon.png   180px, on white, for home screens
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const svg = readFileSync(pub('favicon.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();

/** The mark as a PNG, `size` square, inset by `pad` on a `background` with corner `radius`. */
async function png(size, { pad, background, radius = 0 }) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">
    <div style="width:${size}px;height:${size}px;box-sizing:border-box;padding:${pad}px;background:${background};border-radius:${radius}px">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"
         style="display:block;width:100%;height:100%"></div></body>`);
  return page.screenshot({ omitBackground: true });
}

/** An .ico holding PNG images (supported everywhere .ico is). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) {
  images.push({ size, data: await png(size, { pad: Math.round(size / 16), background: '#ffffff', radius: Math.round(size / 6) }) });
}
writeFileSync(pub('favicon.ico'), ico(images));
writeFileSync(pub('apple-touch-icon.png'), await png(180, { pad: 24, background: '#ffffff' }));
await browser.close();
console.log('wrote favicon.ico, apple-touch-icon.png');
