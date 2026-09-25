/**
 * Unit tests for Bridge.readSlateValueFromDOM()
 *
 * Each test provides three values:
 *   existing  — the Slate JSON before the DOM change (determines inline metadata)
 *   dom       — the HTML the frontend rendered
 *   expected  — the Slate JSON we expect readSlateValueFromDOM to produce
 */

import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

test.describe('Bridge.readSlateValueFromDOM()', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
    await helper.injectPreserveWhitespaceHelper();
  });

  /** Validate Slate structure — element nodes must not have 'text' property */
  function validateSlateStructure(node: any, path = ''): void {
    if (Array.isArray(node)) {
      node.forEach((child, i) => validateSlateStructure(child, `${path}[${i}]`));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    if (node.type && Object.prototype.hasOwnProperty.call(node, 'text')) {
      throw new Error(`Invalid Slate at ${path}: element has both 'type' and 'text'. ${JSON.stringify(node)}`);
    }
    if (node.children) {
      node.children.forEach((child: any, i: number) =>
        validateSlateStructure(child, `${path}.children[${i}]`)
      );
    }
  }

  /**
   * Test helper: given existing Slate, a DOM string, and expected output,
   * verify readSlateValueFromDOM produces the expected result.
   */
  async function testDomToSlate(
    body: any,
    { id, existing, dom, expected, matchMetadataFromDom }: {
      id: string;
      existing: any[];
      dom: string;
      expected: any[];
      matchMetadataFromDom?: boolean;
    },
  ) {
    const htmlWithId = dom.replace('data-edit-text=', `id="${id}" data-edit-text=`);
    const result = await body.evaluate(
      (_el: any, json: string) => {
        const { html, id: elId, existing: existingValue, matchMetadataFromDom: mmfd } = JSON.parse(json);
        const bridge = (window as any).bridge;
        const fragment = (window as any).preserveWhitespaceDOM(html);
        document.body.appendChild(fragment);
        const el = document.getElementById(elId)!;
        const result = bridge.readSlateValueFromDOM(el, existingValue, mmfd ? { matchMetadataFromDom: true } : undefined);
        el.remove();
        return result;
      },
      JSON.stringify({ html: htmlWithId, id, existing, matchMetadataFromDom }),
    );

    expect(result, `readSlateValueFromDOM result`).toEqual(expected);
    expect(() => validateSlateStructure(result)).not.toThrow();
  }

  // ── Two valid DOM patterns ────────────────────────────────────────

  test('pattern 1: field and node on same element', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'p1',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello ' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: ' world' },
      ]}],

      dom:
        '<div data-edit-text="value" data-node-id="0">' +
          'Hello <strong data-node-id="0.1">bold</strong> world' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello ' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: ' world' },
      ]}],
    });
  });

  test('pattern 2: node nested inside field', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'p2',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello ' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: ' world' },
      ]}],

      dom:
        '<div data-edit-text="value">' +
          '<p data-node-id="0">Hello <strong data-node-id="0.1">bold</strong> world</p>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello ' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: ' world' },
      ]}],
    });
  });

  test('the browser\'s end-of-line <br> placeholder is not a break, with a framework comment after it', async () => {
    // An emptied contenteditable line gets a placeholder <br> from the browser;
    // typing then lands before it. A comment is never content — Vue's templates
    // leave them in the DOM — so it must not make the placeholder read as "\n".
    // Built with innerHTML: testDomToSlate's whitespace-preserving parser has no
    // comment support.
    const body = helper.getIframe().locator('body');
    const result = await body.evaluate(() => {
      const wrap = document.createElement('div');
      wrap.innerHTML =
        '<div data-edit-text="value"><p data-node-id="0">Fresh<br><!-- a framework comment --></p></div>';
      document.body.appendChild(wrap);
      const field = wrap.firstElementChild!;
      const value = (window as any).bridge.readSlateValueFromDOM(field, [
        { type: 'p', nodeId: '0', children: [{ text: '' }] },
      ]);
      wrap.remove();
      return value;
    });
    expect(result).toEqual([{ type: 'p', nodeId: '0', children: [{ text: 'Fresh' }] }]);
  });

  test('both patterns produce identical result', async () => {
    const body = helper.getIframe().locator('body');
    const existing = [{ type: 'p', nodeId: '0', children: [
      { text: 'Hello ' },
      { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
      { text: ' world' },
    ]}];

    const r1 = await body.evaluate((args: any) => {
      const bridge = (window as any).bridge;
      const f = (window as any).preserveWhitespaceDOM(
        '<div id="bp1" data-edit-text="value" data-node-id="0">Hello <strong data-node-id="0.1">bold</strong> world</div>'
      );
      document.body.appendChild(f);
      const r = bridge.readSlateValueFromDOM(document.getElementById('bp1')!, args.existing);
      document.getElementById('bp1')!.remove();
      return JSON.stringify(r);
    }, { existing });

    const r2 = await body.evaluate((args: any) => {
      const bridge = (window as any).bridge;
      const f = (window as any).preserveWhitespaceDOM(
        '<div id="bp2" data-edit-text="value"><p data-node-id="0">Hello <strong data-node-id="0.1">bold</strong> world</p></div>'
      );
      document.body.appendChild(f);
      const r = bridge.readSlateValueFromDOM(document.getElementById('bp2')!, args.existing);
      document.getElementById('bp2')!.remove();
      return JSON.stringify(r);
    }, { existing });

    expect(r1).toBe(r2);
  });

  // ── Slate normalization (empty text around inline) ────────────────

  test('DOM without empty text around inline — normalization adds them', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'n1',

      // Existing has empty text around strong (valid Slate)
      existing: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: '' },
      ]}],

      // DOM doesn't have empty spans — just the strong
      dom:
        '<div data-edit-text="value" data-node-id="0">' +
          '<strong data-node-id="0.1">bold</strong>' +
        '</div>',

      // Should still produce empty text nodes around the inline
      expected: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: '' },
      ]}],
    });
  });

  test('empty text between adjacent inline elements', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'n2',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: '' },
        { type: 'em', nodeId: '0.2', children: [{ text: 'italic' }] },
        { text: '' },
      ]}],

      dom:
        '<div data-edit-text="value" data-node-id="0">' +
          '<strong data-node-id="0.1">bold</strong>' +
          '<em data-node-id="0.2">italic</em>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: '' },
        { type: 'em', nodeId: '0.2', children: [{ text: 'italic' }] },
        { text: '' },
      ]}],
    });
  });

  test('text before inline — no extra empty text needed', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'n3',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello ' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: '' },
      ]}],

      dom:
        '<div data-edit-text="value" data-node-id="0">' +
          'Hello <strong data-node-id="0.1">bold</strong>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello ' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
        { text: '' },
      ]}],
    });
  });

  // ── Basic reading ─────────────────────────────────────────────────

  test('simple paragraph', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'b1',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello world' },
      ]}],

      dom: '<div data-edit-text="value"><p data-node-id="0">Hello world</p></div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello world' },
      ]}],
    });
  });

  test('updated text', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'b2',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'Original' },
      ]}],

      dom: '<div data-edit-text="value"><p data-node-id="0">Updated text</p></div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'Updated text' },
      ]}],
    });
  });

  test('unchanged DOM produces identical JSON', async () => {
    const body = helper.getIframe().locator('body');
    const existing = [{ type: 'p', nodeId: '0', children: [{ text: 'Same text' }] }];

    await testDomToSlate(body, {
      id: 'b3',
      existing,
      dom: '<div data-edit-text="value"><p data-node-id="0">Same text</p></div>',
      expected: existing,
    });
  });

  // ── Metadata preservation ─────────────────────────────────────────

  test('link data preserved from existing JSON', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'm1',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'Text with ' },
        { type: 'link', nodeId: '0.1', data: { url: 'https://example.com' }, children: [{ text: 'a link' }] },
        { text: '' },
      ]}],

      dom:
        '<div data-edit-text="value">' +
          '<p data-node-id="0">Text with <a data-node-id="0.1">a link</a></p>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'Text with ' },
        { type: 'link', nodeId: '0.1', data: { url: 'https://example.com' }, children: [{ text: 'a link' }] },
        { text: '' },
      ]}],
    });
  });

  // ── Non-editable / decorative chrome is skipped ───────────────────
  //
  // A frontend may render non-editable islands inside slate content — e.g. the
  // DS external-link icon after a link's text. Such an element has no
  // data-node-id and is marked contenteditable="false" (the caret skips it) and
  // aria-hidden (decoration). It is NOT content, so the reader must skip it, not
  // read its ligature text ("open_in_new") into the value — otherwise every
  // edit / select / delete over the link would corrupt the Slate value. Either
  // marker alone is enough to skip it; a framework wrapper span has neither and
  // is still read as text (see 's1' above).

  test('non-editable icon (contenteditable=false + aria-hidden) inside a link is not read as text', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'ne1',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'An ' },
        { type: 'link', nodeId: '0.1', data: { url: 'https://example.com' }, children: [{ text: 'external link' }] },
        { text: '' },
      ]}],

      dom:
        '<div data-edit-text="value">' +
          '<p data-node-id="0">An ' +
            '<a data-node-id="0.1">external link' +
              '<span class="nsw-material-icons" aria-hidden="true" contenteditable="false">open_in_new</span>' +
            '</a>' +
          '</p>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'An ' },
        { type: 'link', nodeId: '0.1', data: { url: 'https://example.com' }, children: [{ text: 'external link' }] },
        { text: '' },
      ]}],
    });
  });

  test('contenteditable=false alone (no aria-hidden) is also skipped', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'ne2',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'A ' },
        { type: 'link', nodeId: '0.1', data: { url: 'https://example.com' }, children: [{ text: 'widget link' }] },
        { text: '' },
      ]}],

      dom:
        '<div data-edit-text="value">' +
          '<p data-node-id="0">A ' +
            '<a data-node-id="0.1">widget link' +
              '<span contenteditable="false">[chip]</span>' +
            '</a>' +
          '</p>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'A ' },
        { type: 'link', nodeId: '0.1', data: { url: 'https://example.com' }, children: [{ text: 'widget link' }] },
        { text: '' },
      ]}],
    });
  });

  // ── Lists ─────────────────────────────────────────────────────────

  test('whitespace between list items is ignored (HTML indentation)', async () => {
    const body = helper.getIframe().locator('body');
    // Nuxt/Vue renders whitespace text nodes between <li> elements
    // These should not become Slate text children
    await testDomToSlate(body, {
      id: 'lw1',

      existing: [{ type: 'ul', children: [
        { type: 'li', children: [{ text: 'Item 1' }], nodeId: '0.0' },
        { type: 'li', children: [{ text: 'Item 2' }], nodeId: '0.1' },
      ], nodeId: '0' }],

      dom:
        '<div data-edit-text="value">' +
          '<ul data-node-id="0">\n' +
          '  <li data-node-id="0.0">Item 1</li>\n' +
          '  <li data-node-id="0.1">Item 2</li>\n' +
          '</ul>' +
        '</div>',

      expected: [{ type: 'ul', children: [
        { type: 'li', children: [{ text: 'Item 1' }], nodeId: '0.0' },
        { type: 'li', children: [{ text: 'Item 2' }], nodeId: '0.1' },
      ], nodeId: '0' }],
    });
  });

  test('list structure (no normalization needed — children are blocks)', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'l1',

      existing: [{ type: 'ul', nodeId: '0', children: [
        { type: 'li', nodeId: '0.0', children: [{ text: 'Item 1' }] },
        { type: 'li', nodeId: '0.1', children: [{ text: 'Item 2' }] },
      ]}],

      dom:
        '<div data-edit-text="value">' +
          '<ul data-node-id="0">' +
            '<li data-node-id="0.0">Item 1</li>' +
            '<li data-node-id="0.1">Item 2</li>' +
          '</ul>' +
        '</div>',

      expected: [{ type: 'ul', nodeId: '0', children: [
        { type: 'li', nodeId: '0.0', children: [{ text: 'Item 1' }] },
        { type: 'li', nodeId: '0.1', children: [{ text: 'Item 2' }] },
      ]}],
    });
  });

  test('deeply nested list with link — metadata preserved', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'l2',

      existing: [{ type: 'ul', nodeId: '0', children: [
        { type: 'li', nodeId: '0.0', children: [
          { text: '' },
          { type: 'link', nodeId: '0.0.1', data: { url: 'https://example.com' }, children: [{ text: 'Link text' }] },
          { text: '' },
        ]},
      ]}],

      dom:
        '<div data-edit-text="value">' +
          '<ul data-node-id="0">' +
            '<li data-node-id="0.0"><a data-node-id="0.0.1">Link text</a></li>' +
          '</ul>' +
        '</div>',

      expected: [{ type: 'ul', nodeId: '0', children: [
        { type: 'li', nodeId: '0.0', children: [
          { text: '' },
          { type: 'link', nodeId: '0.0.1', data: { url: 'https://example.com' }, children: [{ text: 'Link text' }] },
          { text: '' },
        ]},
      ]}],
    });
  });

  // ── Format toggle (new text node) ─────────────────────────────────

  test('all text inside single inline element (bold all)', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'f0',

      // User typed "Bold text", selected all, made bold, then typed " more"
      existing: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'Bold text' }] },
        { text: '' },
      ]}],

      // DOM: everything inside the strong, cursor at end
      dom:
        '<div data-edit-text="value" data-node-id="0">' +
          '<span></span>' +
          '<span data-node-id="0.1"><span>Bold text more</span></span>' +
          '<span></span>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'Bold text more' }] },
        { text: '' },
      ]}],
    });
  });

  test('typing after bold: text goes into trailing empty span', async () => {
    // Reproduces the "format persists" flaky test failure:
    // User makes text bold, moves cursor to end, types " more"
    // The browser puts " more" in the trailing empty <span> OUTSIDE the <strong>
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'f0b',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'Bold text' }] },
        { text: '' },
      ]}],

      // DOM: " more" is in the trailing span (outside bold)
      dom:
        '<div data-edit-text="value" data-node-id="0">' +
          '<span></span>' +
          '<span data-node-id="0.1"><span>Bold text</span></span>' +
          '<span> more</span>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'Bold text' }] },
        { text: ' more' },
      ]}],
    });
  });



  test('new text after toggling format off is captured', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'f1',

      // Before: user had typed "one two [BOLD] three four five"
      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'one two ' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'BOLD' }] },
        { text: 'three four five' },
      ]}],

      // After toggling bold off, user typed " new " — browser merged text nodes
      dom:
        '<div data-edit-text="value">' +
          '<p data-node-id="0">' +
            'one two <strong data-node-id="0.1">BOLD</strong> new three four five' +
          '</p>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'one two ' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'BOLD' }] },
        { text: ' new three four five' },
      ]}],
    });
  });

  // ── Framework re-render echo ──────────────────────────────────────

  test('framework re-render with same content produces identical value', async () => {
    const body = helper.getIframe().locator('body');
    const value = [{ type: 'p', nodeId: '0', children: [
      { text: 'Hello ' },
      { type: 'strong', nodeId: '0.1', children: [{ text: 'bold' }] },
      { text: ' world' },
    ]}];

    await testDomToSlate(body, {
      id: 'e1',
      existing: value,
      dom:
        '<div data-edit-text="value">' +
          '<p data-node-id="0">Hello <strong data-node-id="0.1">bold</strong> world</p>' +
        '</div>',
      expected: value,
    });
  });

  // ── Text node merging ─────────────────────────────────────────────

  test('adjacent text nodes from framework splitting are merged', async () => {
    const body = helper.getIframe().locator('body');
    // Can't test split text nodes via HTML — use manual DOM creation
    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;
      const container = document.createElement('div');
      container.id = 'tm1';
      container.setAttribute('data-edit-text', 'value');
      const p = document.createElement('p');
      p.setAttribute('data-node-id', '0');
      p.appendChild(document.createTextNode('Hello'));
      p.appendChild(document.createTextNode(' '));
      p.appendChild(document.createTextNode('world'));
      container.appendChild(p);
      document.body.appendChild(container);
      const result = bridge.readSlateValueFromDOM(container,
        [{ type: 'p', nodeId: '0', children: [{ text: 'Hello world' }] }]
      );
      container.remove();
      return result;
    });

    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].text).toBe('Hello world');
  });

  test('empty text nodes from Vue are merged with adjacent text', async () => {
    const body = helper.getIframe().locator('body');
    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;
      const container = document.createElement('div');
      container.id = 'tm2';
      container.setAttribute('data-edit-text', 'value');
      const p = document.createElement('p');
      p.setAttribute('data-node-id', '0');
      p.appendChild(document.createTextNode(''));
      p.appendChild(document.createTextNode('Real text'));
      container.appendChild(p);
      document.body.appendChild(container);
      const result = bridge.readSlateValueFromDOM(container,
        [{ type: 'p', nodeId: '0', children: [{ text: 'Real text' }] }]
      );
      container.remove();
      return result;
    });

    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].text).toBe('Real text');
  });

  // ── Invalid nodeId handling ───────────────────────────────────────

  test('invalid data-node-id elements treated as text (Next.js pattern)', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'i1',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello world' },
      ]}],

      dom:
        '<div data-edit-text="value">' +
          '<p data-node-id="0"><span data-node-id="undefined">Hello world</span></p>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: 'Hello world' },
      ]}],
    });
  });

  // ── Mock frontend pattern (span wrappers) ─────────────────────────

  test('span wrappers without nodeId around inline — text preserved', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 's1',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'Bold text' }] },
        { text: ' more' },
      ]}],

      // Mock frontend renders empty spans for empty text leaves
      dom:
        '<div data-edit-text="value" data-node-id="0">' +
          '<span></span>' +
          '<span data-node-id="0.1"><span>Bold text</span></span>' +
          '<span> more</span>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', nodeId: '0.1', children: [{ text: 'Bold text' }] },
        { text: ' more' },
      ]}],
    });
  });

  // ── handleTextChange integration ──────────────────────────────────

  test('handleTextChange skips when DOM matches formData', async () => {
    const body = helper.getIframe().locator('body');
    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="ht1" data-block-uid="test-block" data-edit-text="value">' +
          '<p data-node-id="0">Hello <strong data-node-id="0.1">bold</strong> world</p>' +
        '</div>'
      );
      document.body.appendChild(fragment);
      const container = document.getElementById('ht1')!;
      const p = container.querySelector('p')!;

      const mockParent = (window as any).parent.mockParent;
      const formData = mockParent.getFormData();
      formData.blocks['test-block'] = {
        '@type': 'slate',
        // nodeId at end — matches addNodeIds output order
        value: [{ type: 'p', children: [
          { text: 'Hello ' },
          { type: 'strong', children: [{ text: 'bold' }], nodeId: '0.1' },
          { text: ' world' },
        ], nodeId: '0' }],
      };
      formData.blocks_layout.items.push('test-block');
      bridge.formData = formData;
      bridge.blockPathMap = mockParent.buildBlockPathMap();

      const valueBefore = JSON.stringify(formData.blocks['test-block'].value);
      bridge.handleTextChange(container, p, p.childNodes[0]);
      const valueAfter = JSON.stringify(formData.blocks['test-block'].value);
      container.remove();

      return { unchanged: valueBefore === valueAfter };
    });

    expect(result.unchanged).toBe(true);
  });

  // ── matchMetadataFromDom mode (isContentReady) ──────────────────────

  test('matchMetadataFromDom: merged list with two links matches', async () => {
    // After merge, li has two links. Both rendered as <a href>.
    // matchMetadataFromDom finds href values in DOM → metadata included.
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'mmd1',
      matchMetadataFromDom: true,

      existing: [{ type: 'ul', nodeId: '0', children: [{
        type: 'li', nodeId: '0.0', children: [
          { text: '' },
          { type: 'link', data: { url: 'https://nuxt.example.com/' }, children: [{ text: 'NUXT' }], nodeId: '0.0.1' },
          { text: '' },
          { text: '' },
          { type: 'link', data: { url: 'https://f7.example.com/' }, children: [{ text: 'F7' }], nodeId: '0.0.4' },
          { text: '' },
        ],
      }]}],

      dom:
        '<div data-edit-text="value">' +
          '<ul data-node-id="0"><li data-node-id="0.0">' +
            '<span></span>' +
            '<a href="https://nuxt.example.com/" data-node-id="0.0.1"><span>NUXT</span></a>' +
            '<span></span><span></span>' +
            '<a href="https://f7.example.com/" data-node-id="0.0.4"><span>F7</span></a>' +
            '<span></span>' +
          '</li></ul>' +
        '</div>',

      // Adjacent empty <span></span> between links merge into one text node
      expected: [{ type: 'ul', nodeId: '0', children: [{
        type: 'li', nodeId: '0.0', children: [
          { text: '' },
          { type: 'link', data: { url: 'https://nuxt.example.com/' }, children: [{ text: 'NUXT' }], nodeId: '0.0.1' },
          { text: '' },
          { type: 'link', data: { url: 'https://f7.example.com/' }, children: [{ text: 'F7' }], nodeId: '0.0.4' },
          { text: '' },
        ],
      }]}],
    });
  });

  test('matchMetadataFromDom: old URL not in DOM causes mismatch', async () => {
    // DOM has new URL, formData has old URL. matchMetadataFromDom should
    // NOT include old URL (not in DOM) → result won't match formData.
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'mmd2',
      matchMetadataFromDom: true,

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'link', data: { url: 'https://OLD.example.com/' }, children: [{ text: 'Click' }], nodeId: '0.1' },
        { text: '' },
      ]}],

      dom:
        '<div data-edit-text="value">' +
          '<p data-node-id="0"><span></span>' +
            '<a href="https://NEW.example.com/" data-node-id="0.1"><span>Click</span></a>' +
            '<span></span>' +
          '</p>' +
        '</div>',

      // OLD url not in DOM, so data.url excluded. type stays (comes with nodeId).
      expected: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'link', children: [{ text: 'Click' }], nodeId: '0.1' },
        { text: '' },
      ]}],
    });
  });

  test('bold text with leading BOM (Nuxt)', async () => {
    const body = helper.getIframe().locator('body');
    await testDomToSlate(body, {
      id: 'bom1',

      existing: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', children: [{ text: 'Text' }], nodeId: '0.0' },
        { text: ' to format' },
      ]}],

      dom:
        '<div data-edit-text="value">' +
          '<p data-node-id="0">\uFEFF<strong data-node-id="0.0">Text</strong> to format</p>' +
        '</div>',

      expected: [{ type: 'p', nodeId: '0', children: [
        { text: '' },
        { type: 'strong', children: [{ text: 'Text' }], nodeId: '0.0' },
        { text: ' to format' },
      ]}],
    });
  });
});
