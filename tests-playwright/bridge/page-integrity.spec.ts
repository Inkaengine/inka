/**
 * Auto-discovered page integrity tests.
 *
 * Walks the unique set of pages referenced by .discovered-blocks.json and
 * runs verifyPageIntegrity against each — catches broken images and
 * off-site backend-origin links in any block on the page (not just the
 * best-of-type instance the block-sanity spec exercises).
 *
 * Uses the direct frontend URL (getFrontendUrl for the project) rather
 * than the mock-parent iframe, because verifyPageIntegrity uses
 * `page.evaluate` / `document.querySelectorAll`.
 */
import { test, expect } from '@playwright/test';
import { verifyPageIntegrity } from '../helpers/PageIntegrityHelper';
import { getFrontendUrl } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { requireEnvironment } from '../helpers/preconditions';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DiscoveredBlock {
  pagePath: string;
}

const discoveredPath = path.resolve(__dirname, '../../.discovered-blocks.json');
let uniquePages: string[] = [];
if (fs.existsSync(discoveredPath)) {
  const all: DiscoveredBlock[] = JSON.parse(fs.readFileSync(discoveredPath, 'utf-8'));
  // Some findings are about a TYPE, not a page — a registered block with no
  // content example has nothing to point at, so it carries no pagePath. Without
  // this filter they became a test literally named "undefined" that navigated to
  // `<frontend>undefined`, failing for a reason unrelated to any page.
  uniquePages = Array.from(new Set(all.map((b) => b.pagePath).filter(Boolean)));
}

test.describe('Page integrity (auto-discovered)', () => {
  test.beforeEach(async ({}, testInfo) => {
    requireEnvironment(
      testInfo,
      uniquePages.length > 0,
      'no .discovered-blocks.json — discovery needs DISCOVER_BLOCKS_API=<mock api url> in this job',
    );
  });

  for (const pagePath of uniquePages) {
    test(`${pagePath}`, async ({ page }, testInfo) => {
      const frontendUrl = process.env.FRONTEND_URL || getFrontendUrl(testInfo.project.name);
      // SCOPE, not environment: this check crawls a standalone frontend site,
      // and projects absent from the URL map have none to crawl — `mock` is
      // driven through mock-parent, and the `-firefox` variants re-run another
      // project's site in a second browser. Nothing is broken, so it skips even
      // on CI (unlike the discovery guard above).
      testInfo.skip(!frontendUrl, `no standalone frontend site for project ${testInfo.project.name}`);

      await page.goto(`${frontendUrl}${pagePath}`, { timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await verifyPageIntegrity(page);
    });
  }
});
