/**
 * Unit tests for Bridge.addNodeIds()
 * Tests that nodeIds are added correctly to Slate structures
 */

import { test, expect, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Bridge.addNodeIds()', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  test('simple paragraph with text', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const input = [{ type: 'p', children: [{ text: 'Hello world' }] }];
      return (window as any).bridge.addNodeIds(input);
    });

    expect(result).toEqual([
      {
        type: 'p',
        nodeId: '0',
        children: [{ text: 'Hello world' }], // text nodes don't get nodeIds
      },
    ]);
  });

  test('paragraph with formatted text', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const input = [
        {
          type: 'p',
          children: [
            { text: 'Hello ' },
            { type: 'strong', children: [{ text: 'world' }] },
          ],
        },
      ];
      return (window as any).bridge.addNodeIds(input);
    });

    expect(result).toEqual([
      {
        type: 'p',
        nodeId: '0',
        children: [
          { text: 'Hello ' },
          { type: 'strong', nodeId: '0.1', children: [{ text: 'world' }] },
        ],
      },
    ]);
  });

  test('unordered list with simple items', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const input = [
        {
          type: 'ul',
          children: [
            { type: 'li', children: [{ text: 'Item 1' }] },
            { type: 'li', children: [{ text: 'Item 2' }] },
          ],
        },
      ];
      return (window as any).bridge.addNodeIds(input);
    });

    expect(result).toEqual([
      {
        type: 'ul',
        nodeId: '0',
        children: [
          { type: 'li', nodeId: '0.0', children: [{ text: 'Item 1' }] },
          { type: 'li', nodeId: '0.1', children: [{ text: 'Item 2' }] },
        ],
      },
    ]);
  });

  test('list item with link (Plone API structure)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const input = [
        {
          type: 'ul',
          children: [
            {
              type: 'li',
              children: [
                { text: '' },
                {
                  type: 'link',
                  data: { url: 'https://example.com' },
                  children: [{ text: 'NUXT.js Example' }],
                },
                { text: '' },
              ],
            },
          ],
        },
      ];
      return (window as any).bridge.addNodeIds(input);
    });

    // Verify structure is correct - li should NOT have text property
    expect(result[0].children[0]).not.toHaveProperty('text');
    expect(result[0].children[0]).toHaveProperty('type', 'li');
    expect(result[0].children[0]).toHaveProperty('children');
    expect(result[0].children[0]).toHaveProperty('nodeId', '0.0');

    // Full structure check
    expect(result).toEqual([
      {
        type: 'ul',
        nodeId: '0',
        children: [
          {
            type: 'li',
            nodeId: '0.0',
            children: [
              { text: '' },
              {
                type: 'link',
                nodeId: '0.0.1',
                data: { url: 'https://example.com' },
                children: [{ text: 'NUXT.js Example' }],
              },
              { text: '' },
            ],
          },
        ],
      },
    ]);
  });

  test('multiple list items with links (full Plone structure)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const input = [
        {
          type: 'ul',
          children: [
            {
              type: 'li',
              children: [
                { text: '' },
                {
                  type: 'link',
                  data: { url: 'https://hydra-nuxt-flowbrite.netlify.app/' },
                  children: [{ text: 'NUXT.js Example' }],
                },
                { text: '' },
              ],
            },
            {
              type: 'li',
              children: [
                { text: '' },
                {
                  type: 'link',
                  data: { url: 'https://hydra-vue-f7.netlify.app/' },
                  children: [{ text: 'Framework7 Example' }],
                },
                { text: '' },
              ],
            },
          ],
        },
      ];
      return (window as any).bridge.addNodeIds(input);
    });

    // Verify NO li has a text property
    result[0].children.forEach((li: any, index: number) => {
      expect(li).not.toHaveProperty('text');
      expect(li).toHaveProperty('type', 'li');
      expect(li).toHaveProperty('nodeId', `0.${index}`);
    });
  });

  test('handles node with both text AND children (malformed)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      // This is INVALID Slate but might come from buggy code
      const input = [
        {
          type: 'li',
          text: '', // INVALID - element nodes shouldn't have text
          children: [{ text: 'content' }],
        },
      ];
      return (window as any).bridge.addNodeIds(input);
    });

    // Fixed behavior: since it has 'type' and 'children', treat as element
    expect(result[0]).toHaveProperty('text', ''); // Still has the invalid text
    expect(result[0]).toHaveProperty('nodeId', '0'); // nodeId IS added now
    expect(result[0]).toHaveProperty('type', 'li');
    expect(result[0]).toHaveProperty('children');
  });
});
