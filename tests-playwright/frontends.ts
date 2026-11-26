/**
 * The frontends Inka's suites drive, and the scope of the block-sanity
 * contract over them. No Playwright imports: playwright.config.ts reads this
 * too, for the coverage reporter.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContractScope } from '@inka/testing/discovery';
import { URLS } from './ports';

/** Where global setup writes block discovery, and the sanity suites read it. */
export const DISCOVERY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Map project names to frontend URLs.
 * The default (mock) uses the test frontend, which also serves mock-parent.
 */
export const FRONTEND_URLS: Record<string, string> = {
  nuxt: URLS.nuxt,
  react: URLS.reactDoc,
  svelte: URLS.svelteDoc,
  vue: URLS.vueDoc,
  nextjs: URLS.nextjs,
  f7: URLS.f7,
  astro: URLS.astroDoc,
  vanilla: URLS.vanillaDoc,
  'svelte-qs': URLS.svelteQs,
  'astro-qs': URLS.astroQs,
};

export function getFrontendUrl(projectName: string): string | undefined {
  return FRONTEND_URLS[projectName];
}

// The frontends block-sanity ENFORCES. Others (react, svelte, vue, f7) ship
// partial block coverage on purpose and skip the render contract — so nothing
// discovered for them is ever asserted. Discovery reads this too: scanning a
// frontend whose cases can only skip cost the react/svelte/vue/astro job ~1736
// entries EACH and pushed it past the 30m CI limit.
export const SANITY_PROJECTS = new Set(['mock', 'nuxt', 'nextjs']);

/**
 * Synthetic conversion-test blocks (dnd-convert.spec.ts) are drag/paste fixtures
 * with no editable fields and are only rendered by the mock test frontend — they
 * aren't part of the cross-frontend render contract.
 *
 * The example listing-variant blocks (example-listings.spec.ts) expand via a
 * per-frontend fetcher registration and have no inline-editable fields; the RSS
 * one fetches an external feed that only resolves against the mock. They're
 * covered by their own integration spec (admin-mock), not this render contract.
 */
export const CONTRACT_SCOPE: ContractScope = {
  excludeTypePrefixes: ['conv'],
  excludeBlockTypes: ['relatedItemsListing', 'searchShortcuts', 'rssFeed'],
};
