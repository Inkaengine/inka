/**
 * The MCP server's screenshots, made to fit a tool result. claude.ai keeps a
 * tool result of more than about 150,000 characters out of the conversation
 * (it is written to a file instead), and a full-page PNG of a real page is
 * several times that: neither the model nor the person saw it.
 */
import { test, expect, type Page } from '@playwright/test';
import { fitImage } from '../../packages/inka-mcp/fitImage.mjs';

/** A page of `count` paragraphs of text, as a full-page PNG. */
async function pageOfText(page: Page, count: number): Promise<Buffer> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const words = 'editors build pages people want to read and assistants help them without breaking the design system'.split(' ');
  const paragraphs = Array.from({ length: count }, (_, i) => `<p>${Array.from({ length: 40 }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(' ')}</p>`);
  await page.setContent(`<body style="margin:24px;font:16px/1.5 sans-serif">${paragraphs.join('')}</body>`);
  return page.screenshot({ fullPage: true });
}

async function sizeOf(page: Page, { data, mimeType }: { data: string; mimeType: string }) {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  }, `data:${mimeType};base64,${data}`);
}

const asPng = (png: Buffer) => ({ data: png.toString('base64'), mimeType: 'image/png' });

test.describe('fitImage', () => {
  test('a picture that fits is sent as it was taken', async ({ page }) => {
    await page.setContent('<p style="font-size:40px">Small</p>');
    const png = await page.screenshot();
    expect(await fitImage(page.context(), png, 100_000)).toEqual({ ...asPng(png), cropped: null });
  });

  test('a picture too big for the result is made smaller, keeping its shape', async ({ page }) => {
    const png = await pageOfText(page, 12);
    expect(png.toString('base64').length).toBeGreaterThan(150_000);

    const original = await sizeOf(page, asPng(png));
    const fitted = await fitImage(page.context(), png, 100_000);
    expect(fitted).toMatchObject({ mimeType: 'image/jpeg', cropped: null });
    expect(fitted.data.length).toBeLessThanOrEqual(100_000);
    const { width, height } = await sizeOf(page, fitted);
    expect(width).toBeLessThan(original.width);
    expect(height / width).toBeCloseTo(original.height / original.width, 1);
  });

  test('a page too long for that is shown from its top, at half width, and says so', async ({ page }) => {
    const png = await pageOfText(page, 300);
    const original = await sizeOf(page, asPng(png));
    const fitted = await fitImage(page.context(), png, 100_000);
    expect(fitted.data.length).toBeLessThanOrEqual(100_000);
    expect(fitted.cropped).toEqual({ shown: expect.any(Number), of: original.height });
    expect(fitted.cropped!.shown).toBeLessThan(original.height);
    const { width, height } = await sizeOf(page, fitted);
    expect(width).toBe(original.width / 2);
    expect(height).toBe(Math.round(fitted.cropped!.shown / 2));
  });

  test('refuses, rather than send a sliver of the page', async ({ page }) => {
    const png = await pageOfText(page, 30);
    await expect(fitImage(page.context(), png, 500)).rejects.toThrow(/cannot fit/);
  });
});
