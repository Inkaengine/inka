// Render scripts/og-image.html to public/og-image.png (1200x630), the share
// image for pages without one of their own.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const html = fileURLToPath(new URL('./og-image.html', import.meta.url));
const png = fileURLToPath(new URL('../public/og-image.png', import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`file://${html}`);
await page.screenshot({ path: png });
await browser.close();
console.log(`wrote ${png}`);
