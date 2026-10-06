/**
 * Unit tests for slateTransforms.js
 *
 * Tests the headless Slate editor implementation for applying
 * formatting transforms to Slate document structures.
 */

import config from '@plone/volto/registry';
import { createHeadlessEditor } from './slateTransforms';
import slateTransforms from './slateTransforms';

describe('slateTransforms', () => {
  describe('createHeadlessEditor', () => {
    it('should create a headless editor with given value', () => {
      const value = [
        {
          type: 'p',
          children: [{ text: 'Hello world' }],
        },
      ];

      const editor = createHeadlessEditor(value);

      expect(editor).toBeDefined();
      expect(editor.children).toEqual(value);
    });

    it('should create editor with empty value', () => {
      const editor = createHeadlessEditor([]);

      expect(editor).toBeDefined();
      expect(editor.children).toEqual([]);
    });
  });

  describe('htmlToSlate', () => {
    it('should convert simple paragraph HTML to Slate', () => {
      const html = '<p>Hello world</p>';
      const result = slateTransforms.htmlToSlate(html);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should convert bold text to Slate marks', () => {
      const html = '<p><strong>Bold text</strong></p>';
      const result = slateTransforms.htmlToSlate(html);

      expect(result).toBeDefined();
      // Check that bold mark is applied
      const hasBold = JSON.stringify(result).includes('"bold":true');
      expect(hasBold).toBe(true);
    });
  });

  describe('splitBlock', () => {
    it('should split a block at the selection point', () => {
      const value = [
        {
          type: 'p',
          children: [{ text: 'Hello world' }],
        },
      ];

      const selection = {
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      };

      const { topValue, bottomValue } = slateTransforms.splitBlock(value, selection);

      expect(topValue[0].children.map((c) => c.text).join('')).toBe('Hello');
      expect(bottomValue[0].children.map((c) => c.text).join('')).toBe(' world');
    });

    describe('around a link', () => {
      // The site config makes `link` an inline (volto-slate's link plugin);
      // the unit environment has no such extension, so register the same
      // isInline rule here — without it slate treats the link as a block and
      // the split behaves nothing like it does in the editor.
      let savedExtensions;
      beforeEach(() => {
        savedExtensions = config.settings.slate.extensions;
        config.settings.slate.extensions = [
          ...(savedExtensions || []),
          (editor) => {
            const { isInline } = editor;
            editor.isInline = (element) =>
              element.type === 'link' || isInline(element);
            return editor;
          },
        ];
      });
      afterEach(() => {
        config.settings.slate.extensions = savedExtensions;
      });

      // A link is an inline, and slate always keeps a text node after it. With
      // the caret at the end of the link's text, "from the caret to the end"
      // starts INSIDE the link, so the new paragraph used to begin with an empty
      // copy of it — typing there extended it, and pages were saved with
      // `<a href="…"></a>` beside the real link.
      const linkedParagraph = () => [
        {
          type: 'p',
          children: [
            { text: 'See ' },
            {
              type: 'link',
              data: { url: 'https://example.com' },
              children: [{ text: 'Click here' }],
            },
            { text: '' },
          ],
        },
      ];
      const linksIn = (node) =>
        Array.isArray(node)
          ? node.flatMap(linksIn)
          : node && typeof node === 'object'
            ? [
                ...(node.type === 'link' ? [node] : []),
                ...linksIn(node.children || []),
              ]
            : [];

      it('splitting at the end of a link keeps the link on top and none below', () => {
        const end = { path: [0, 1, 0], offset: 'Click here'.length };
        const { topValue, bottomValue } = slateTransforms.splitBlock(
          linkedParagraph(),
          { anchor: end, focus: end },
        );

        expect(linksIn(bottomValue)).toEqual([]);
        const topLinks = linksIn(topValue);
        expect(topLinks).toHaveLength(1);
        expect(topLinks[0].children.map((c) => c.text).join('')).toBe('Click here');
      });

      it('splitting at the start of a link moves it down whole, leaving none on top', () => {
        const start = { path: [0, 1, 0], offset: 0 };
        const { topValue, bottomValue } = slateTransforms.splitBlock(
          linkedParagraph(),
          { anchor: start, focus: start },
        );

        expect(linksIn(topValue)).toEqual([]);
        const bottomLinks = linksIn(bottomValue);
        expect(bottomLinks).toHaveLength(1);
        expect(bottomLinks[0].children.map((c) => c.text).join('')).toBe('Click here');
      });

      it('splitting inside a link still splits the link in two', () => {
        const mid = { path: [0, 1, 0], offset: 'Click'.length };
        const { topValue, bottomValue } = slateTransforms.splitBlock(
          linkedParagraph(),
          { anchor: mid, focus: mid },
        );

        expect(linksIn(topValue)[0].children[0].text).toBe('Click');
        expect(linksIn(bottomValue)[0].children[0].text).toBe(' here');
      });
    });
  });
});
