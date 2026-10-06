/**
 * The Nuxt front end's social preview: a visitor's page carries Open Graph and
 * Twitter card tags from the page itself, with absolute URLs on the public
 * site, and the site's card as the image when the page has none of its own.
 */
import { test, expect } from '../fixtures';
import { URLS } from '../ports';

const meta = (page, attr: string, name: string) =>
  page.locator(`head meta[${attr}="${name}"]`).getAttribute('content');

test('a page without an image of its own shares with its title and the site card', async ({ page }) => {
  await page.goto(`${URLS.nuxt}/_test_data/accordion-test-page`);
  await expect(page).toHaveTitle('Accordion Test Page');

  expect(await meta(page, 'property', 'og:title')).toBe('Accordion Test Page');
  expect(await meta(page, 'property', 'og:site_name')).toBe('Inka');
  expect(await meta(page, 'property', 'og:type')).toBe('website');
  expect(await meta(page, 'property', 'og:url')).toBe('https://inka.sh/_test_data/accordion-test-page');
  expect(await meta(page, 'property', 'og:image')).toBe('https://inka.sh/og-image.png');
  expect(await meta(page, 'name', 'twitter:card')).toBe('summary_large_image');
  expect(await meta(page, 'name', 'twitter:title')).toBe('Accordion Test Page');
  expect(await meta(page, 'name', 'twitter:image')).toBe('https://inka.sh/og-image.png');

  // The card is served by the front end.
  const card = await page.request.get(`${URLS.nuxt}/og-image.png`);
  expect(card.headers()['content-type']).toBe('image/png');
});

test('a page with a preview image shares that image', async ({ page }) => {
  const content = await (await fetch(`${URLS.mockApi}/_test_data/test-page`, { headers: { Accept: 'application/json' } })).json();
  expect(content.preview_image?.download).toBeTruthy();

  await page.goto(`${URLS.nuxt}/_test_data/test-page`);
  await expect(page).toHaveTitle('Test Page');
  expect(await meta(page, 'property', 'og:image')).toBe(content.preview_image.download);
  expect(await meta(page, 'name', 'twitter:image')).toBe(content.preview_image.download);
});
