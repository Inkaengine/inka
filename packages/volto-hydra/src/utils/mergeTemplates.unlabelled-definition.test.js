/**
 * Opening a template definition that does not name itself.
 *
 * A definition's blocks need not carry a templateId: where the document lives already
 * says what it is. Opened for editing it must come up as itself — its own block ids,
 * its content as stored, never merged against any template — and its blocks must get
 * the instance id the unlock toggle keys on, exactly as a definition that names itself
 * does.
 */
import { describe, test, expect } from 'vitest';
import { mergeTemplatesIntoPage } from './mergeTemplates.mjs';

const definition = (label) => {
  const withLabel = (block) =>
    label === undefined ? block : { ...block, templateId: label };
  return {
    '@id': 'http://localhost:8888/templates/footer',
    UID: 'f00000000000000000000000000000ff',
    blocks: {
      frame: withLabel({
        '@type': 'columns',
        fixed: true,
        readOnly: true,
        slotId: 'frame',
        blocks: {
          brand: withLabel({
            '@type': 'slate',
            fixed: true,
            readOnly: false,
            slotId: 'brand',
            value: [{ text: 'Brand' }],
          }),
        },
        blocks_layout: { items: ['brand'] },
      }),
      links: withLabel({
        '@type': 'slate',
        fixed: false,
        readOnly: false,
        slotId: 'links',
      }),
    },
    blocks_layout: { items: ['frame', 'links'] },
  };
};

const open = (doc) =>
  mergeTemplatesIntoPage(doc, {
    skipOwnTemplate: true,
    uuidGenerator: () => 'minted',
    loadTemplate: async (id) => {
      throw new Error(`a definition must not load a template, asked for ${id}`);
    },
  });

describe('opening a definition that does not name itself', () => {
  test('comes up as itself, like one that names itself', async () => {
    const { merged: labelled } = await open(definition('/templates/footer'));
    const { merged: unlabelled } = await open(definition(undefined));

    expect(unlabelled.blocks_layout.items).toEqual(['frame', 'links']);
    expect(Object.keys(unlabelled.blocks.frame.blocks)).toEqual(['brand']);
    expect(unlabelled.blocks.frame.blocks.brand.value).toEqual([
      { text: 'Brand' },
    ]);
    // Same unlock wiring as the labelled definition: the page's own path as its id.
    expect(unlabelled.blocks.frame.templateInstanceId).toBe(
      labelled.blocks.frame.templateInstanceId,
    );
    expect(unlabelled.blocks.frame.blocks.brand.templateInstanceId).toBe(
      labelled.blocks.frame.blocks.brand.templateInstanceId,
    );
    expect(unlabelled.blocks.frame.templateId).toBe('/templates/footer');
  });

  test('a page that uses a template is not mistaken for a definition', async () => {
    const page = {
      '@id': 'http://localhost:8888/a-page',
      blocks: {
        plain: { '@type': 'slate', value: [{ text: 'Just a page' }] },
      },
      blocks_layout: { items: ['plain'] },
    };
    const { merged } = await open(page);
    expect(merged.blocks.plain).toEqual(page.blocks.plain);
  });
});
