import { describe, it, expect } from 'vitest';
import { sourceFingerprint, translatableFieldIds } from './index.js';

/**
 * What a translation was made FROM.
 *
 * A translated block records a fingerprint of the source block it was written
 * from. When the source changes, the fingerprints differ and the translator is
 * told which blocks to revisit — the question nothing could answer before:
 * `untranslatedBlockIds` only catches a copy nobody has touched yet, and goes
 * quiet the moment German is typed.
 *
 * Two properties decide whether this is useful or noise:
 *
 *   STABLE  — the same content must hash the same after a round trip through
 *             form state and JSON. An unstable hash marks every block stale at
 *             once, and markers that cry wolf get ignored.
 *   NARROW  — only what a translator would rewrite. Hash an image swap or a
 *             variation id and the same thing happens for a different reason.
 */
const schema = {
  properties: {
    title: { title: 'Headline', type: 'string' },
    description: { title: 'Summary', type: 'string', widget: 'textarea' },
    text: { title: 'Body', type: 'array', widget: 'slate' },
    href: { title: 'Link', type: 'array', widget: 'object_browser' },
    variation: {
      title: 'Variation',
      type: 'string',
      choices: [
        ['default', 'Default'],
        ['summary', 'Summary'],
      ],
    },
    columns: { title: 'Columns', type: 'number' },
    styleName: {
      title: 'Style',
      type: 'string',
      // The same in every language, which is what this already means for a
      // content type's fields.
      multilingual_options: { language_independent: true },
    },
    items: { title: 'Items', type: 'array', widget: 'object_list' },
  },
};

const block = {
  '@type': 'teaser',
  block: 'uid-1',
  title: 'Design',
  description: 'What we do',
  text: [{ type: 'p', children: [{ text: 'We design in English.' }] }],
  href: [{ '@id': '/en/about', title: 'About us' }],
  variation: 'default',
  columns: 3,
  styleName: 'inverted',
  items: [{ field_type: 'card', title: 'A card' }],
  blocks: { child: { '@type': 'slate' } },
  blocks_layout: { items: ['child'] },
};

describe('translatableFieldIds', () => {
  it('names the fields a translator would rewrite, and no others', () => {
    // Prose only: a link, a variation token, a number and a style name are
    // either structure or shared, and a container's children are their own
    // blocks with their own fingerprints.
    expect(translatableFieldIds(schema).sort()).toEqual([
      'description',
      'text',
      'title',
    ]);
  });
});

describe('sourceFingerprint', () => {
  it('is the same for the same content, whatever order the keys arrive in', () => {
    const reordered = {
      blocks_layout: block.blocks_layout,
      description: block.description,
      '@type': block['@type'],
      text: block.text,
      title: block.title,
      block: block.block,
      href: block.href,
      variation: block.variation,
      columns: block.columns,
      styleName: block.styleName,
      items: block.items,
      blocks: block.blocks,
    };
    expect(sourceFingerprint(reordered, schema)).toBe(
      sourceFingerprint(block, schema),
    );
  });

  it('changes when the words change', () => {
    expect(
      sourceFingerprint({ ...block, title: 'Build' }, schema),
    ).not.toBe(sourceFingerprint(block, schema));
  });

  it('changes when rich text changes, including its links and marks', () => {
    const linked = {
      ...block,
      text: [
        {
          type: 'p',
          children: [
            { text: 'We design in ' },
            { type: 'link', data: { url: '/en/about' }, children: [{ text: 'English' }] },
            { text: '.' },
          ],
        },
      ],
    };
    expect(sourceFingerprint(linked, schema)).not.toBe(
      sourceFingerprint(block, schema),
    );
  });

  it('ignores what a translator does not rewrite', () => {
    const same = sourceFingerprint(block, schema);
    // A different image/link target, a different variation, a different count,
    // a shared style — none of these are a reason to re-read the German.
    expect(sourceFingerprint({ ...block, href: [{ '@id': '/en/services' }] }, schema)).toBe(same);
    expect(sourceFingerprint({ ...block, variation: 'summary' }, schema)).toBe(same);
    expect(sourceFingerprint({ ...block, columns: 4 }, schema)).toBe(same);
    expect(sourceFingerprint({ ...block, styleName: 'plain' }, schema)).toBe(same);
  });

  it('is shallow: a child block has its own fingerprint', () => {
    // Otherwise editing one teaser marks its grid stale as well, and the
    // roll-up counts the same edit twice.
    const withEditedChild = {
      ...block,
      blocks: { child: { '@type': 'slate', text: 'changed' } },
      items: [{ field_type: 'card', title: 'A different card' }],
    };
    expect(sourceFingerprint(withEditedChild, schema)).toBe(
      sourceFingerprint(block, schema),
    );
  });

  it('survives the trip through a form and back', () => {
    // Line endings and trailing space are what a round trip does to text; they
    // are not an edit anyone made.
    const roundTripped = {
      ...block,
      title: 'Design  ',
      description: 'What we do\r\n',
    };
    expect(sourceFingerprint(roundTripped, schema)).toBe(
      sourceFingerprint(block, schema),
    );
  });

  it('refuses a block whose schema it does not have, rather than guessing', () => {
    // Without the schema there is no way to tell prose from a variation id, and
    // hashing everything would mark blocks stale for changes that are not
    // translatable. The caller is told instead.
    expect(() => sourceFingerprint(block, null)).toThrow(/schema/i);
  });

  it('says a block with nothing to translate has nothing, rather than failing', () => {
    // A separator, a spacer, an image: knowable, and it can never go stale
    // because no words in it can change. Distinct from "we do not know what
    // this block type is", which throws above.
    const separator = { properties: { align: { type: 'string', choices: [['left', 'Left']] } } };
    expect(sourceFingerprint({ '@type': 'separator', align: 'left' }, separator)).toBeNull();
  });
});
