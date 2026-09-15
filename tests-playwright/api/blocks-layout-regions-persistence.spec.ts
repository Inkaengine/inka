import { test, expect } from '@playwright/test';
import { URLS } from '../ports';

/**
 * Persistence of layout regions.
 *
 * Layout regions (header, footer, …) are stored as SUB-KEYS of the
 * registered `blocks_layout` field, so they survive a save. The backend (here:
 * the mock, mirroring Plone's deserializer) drops ad-hoc top-level fields that
 * are not registered — which is exactly why a separate `footer_blocks` field
 * would NOT persist, and why the region model is needed.
 *
 * This is an HTTP-contract test against the mock API: a unique Bearer token
 * gives us an isolated, persisting session. The port comes from ports.ts —
 * hardcoding 8888 breaks the moment HYDRA_MOCK_API_PORT moves the server.
 */

const MOCK_API = URLS.mockApi;
const PATH = '/++api++/test-page';

test.describe('blocks_layout region persistence', () => {
  test('a footer region survives a save round-trip', async ({ request }) => {
    const token = `regiontest-survives-${Date.now()}`;
    const headers = { Authorization: `Bearer ${token}` };

    // Save a page whose footer region holds a block (and the block in the
    // shared blocks dict).
    const patch = await request.patch(`${MOCK_API}${PATH}`, {
      headers,
      data: {
        blocks: {
          'body-x': { '@type': 'slate' },
          'footer-x': { '@type': 'slate' },
        },
        blocks_layout: {
          items: ['body-x'],
          footer: ['footer-x'],
        },
      },
    });
    expect(patch.ok()).toBeTruthy();

    // Re-fetch from the same session — the footer region must still be there.
    const get = await request.get(`${MOCK_API}${PATH}`, { headers });
    expect(get.ok()).toBeTruthy();
    const body = await get.json();

    expect(body.blocks_layout.footer).toEqual(['footer-x']);
    expect(body.blocks_layout.items).toEqual(['body-x']);
    expect(body.blocks['footer-x']).toBeTruthy();
  });

  test('an old-style top-level footer_blocks field is dropped (not registered)', async ({
    request,
  }) => {
    const token = `regiontest-dropped-${Date.now()}`;
    const headers = { Authorization: `Bearer ${token}` };

    const patch = await request.patch(`${MOCK_API}${PATH}`, {
      headers,
      data: {
        blocks: { 'footer-y': { '@type': 'slate' } },
        // This is the OLD model — a separate top-level field. Plone (and now the
        // mock) drops it because it is not a registered field.
        footer_blocks: { items: ['footer-y'] },
      },
    });
    expect(patch.ok()).toBeTruthy();

    const get = await request.get(`${MOCK_API}${PATH}`, { headers });
    const body = await get.json();

    // The unregistered field did not persist...
    expect(body.footer_blocks).toBeUndefined();
    // ...while a registered field on the same PATCH did.
    expect(body.blocks['footer-y']).toBeTruthy();
  });
});
