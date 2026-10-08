// Raster icons rendered from an SVG mark, so each site's icons stay in step
// with its mark. Run directly, it renders the admin's icons from public/icon.svg:
//
//   node scripts/icons.mjs
//
// The Nuxt starter renders its own with examples/nuxt-blog-starter/scripts/icons.mjs.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A white tile for small icons: an .ico or fixed PNG can't follow dark mode,
 * so the mark needs its own background to show on a dark tab bar.
 */
export const tile = (size) => ({ pad: Math.round(size / 16), background: '#ffffff', radius: Math.round(size / 6) });
/** A home-screen icon: the mark inset on white (the platform rounds the corners). */
export const homeScreen = (size) => ({ pad: Math.round(size * 0.13), background: '#ffffff', radius: 0 });

/**
 * Render `outputs` from the SVG at `svgPath` into `outDir`. Each output is
 *   { file, sizes: [n, …], style }  — an .ico holding those sizes, or
 *   { file, size, style }           — a PNG,
 * where `style(size)` gives { pad, background, radius } (see tile, homeScreen).
 */
export async function renderIcons(svgPath, outDir, outputs) {
  const svg = readFileSync(svgPath, 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const png = async (size, { pad, background, radius }) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0">
      <div style="width:${size}px;height:${size}px;box-sizing:border-box;padding:${pad}px;background:${background};border-radius:${radius}px">
      <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"
           style="display:block;width:100%;height:100%"></div></body>`);
    return page.screenshot({ omitBackground: true });
  };
  try {
    for (const out of outputs) {
      const data = out.sizes
        ? ico(await Promise.all(out.sizes.map(async (size) => ({ size, data: await png(size, out.style(size)) }))))
        : await png(out.size, out.style(out.size));
      writeFileSync(join(outDir, out.file), data);
      console.log(`wrote ${join(outDir, out.file)}`);
    }
  } finally {
    await browser.close();
  }
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pub = fileURLToPath(new URL('../public/', import.meta.url));
  await renderIcons(join(pub, 'icon.svg'), pub, [
    { file: 'favicon.ico', sizes: [16, 32, 48], style: tile },
    { file: 'favicon-16x16.png', size: 16, style: tile },
    { file: 'favicon-32x32.png', size: 32, style: tile },
    { file: 'apple-touch-icon.png', size: 180, style: homeScreen },
    { file: 'android-chrome-192x192.png', size: 192, style: homeScreen },
    { file: 'android-chrome-512x512.png', size: 512, style: homeScreen },
  ]);
}
