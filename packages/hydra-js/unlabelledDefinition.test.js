/**
 * A template definition need not name itself (docs/frontend-guide/templates.md,
 * "A template is the id it was referenced by"): a document whose top-level
 * blocks hold slots but name no template IS one. The editor, the content
 * validator and every frontend ask the same question — a frontend so it does
 * not force a page layout on a template — so they ask it of one function.
 */
import { isUnlabelledDefinition } from '@volto-hydra/helpers';

const doc = (blocks, layout = { items: Object.keys(blocks) }) => ({
  '@id': '/templates/frame',
  blocks,
  blocks_layout: layout,
});

describe('isUnlabelledDefinition', () => {
  test('top-level blocks that hold slots and name no template: a definition', () => {
    expect(
      isUnlabelledDefinition(
        doc({
          head: { '@type': 'slate', fixed: true, readOnly: true, slotId: 'head' },
          body: { '@type': 'slate', slotId: 'body' },
        }),
      ),
    ).toBe(true);
  });

  test('a top-level block that names a template: a page using it, not a definition', () => {
    expect(
      isUnlabelledDefinition(
        doc({
          f: { '@type': 'slate', templateId: '/templates/frame', slotId: 'body' },
          other: { '@type': 'slate', slotId: 'body' },
        }),
      ),
    ).toBe(false);
  });

  test('no slots at the top level: a plain page', () => {
    expect(isUnlabelledDefinition(doc({ p: { '@type': 'slate' } }))).toBe(false);
    expect(isUnlabelledDefinition(doc({}))).toBe(false);
  });

  test("a slot inside a top-level container does not make the page a definition", () => {
    expect(
      isUnlabelledDefinition(
        doc({
          cols: {
            '@type': 'columns',
            blocks: { c: { '@type': 'slate', slotId: 'inner' } },
            blocks_layout: { items: ['c'] },
          },
        }),
      ),
    ).toBe(false);
  });

  test('every top-level region counts, not only items', () => {
    expect(
      isUnlabelledDefinition(
        doc(
          { foot: { '@type': 'slate', fixed: true, readOnly: true, slotId: 'foot' } },
          { items: [], footer: ['foot'] },
        ),
      ),
    ).toBe(true);
  });
});
