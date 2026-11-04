/**
 * mergeTemplatesIntoPage must preserve sibling regions of a blocks_layout field.
 *
 * Regression: the page-level merge rebuilt `blocks_layout = { items }`, which
 * dropped the `footer` region on the second FORM_DATA sent to the iframe (so an
 * edited footer rendered empty). Each region must be processed and reassembled.
 */
import { describe, test, expect } from 'vitest';
import { mergeTemplatesIntoPage } from './mergeTemplates.js';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const blocksConfig = { slate: { id: 'slate' } };
const loadTemplate = async () => ({ blocks: {}, blocks_layout: { items: [] } });

describe('mergeTemplatesIntoPage — region preservation', () => {
  test('keeps the footer region when merging the items region (no templates)', async () => {
    const formData = {
      blocks: {
        'body-1': { '@type': 'slate' },
        'footer-1': { '@type': 'slate' },
      },
      blocks_layout: {
        items: ['body-1'],
        footer: ['footer-1'],
      },
    };

    const { merged } = await mergeTemplatesIntoPage(formData, {
      loadTemplate,
      preloadedTemplates: {},
      pageBlocksFields: { items: {}, footer: {} },
      uuidGenerator: (() => {
        let n = 0;
        return () => `u-${++n}`;
      })(),
      blocksConfig,
      intl,
    });

    expect(merged.blocks_layout.items).toEqual(['body-1']);
    expect(merged.blocks_layout.footer).toEqual(['footer-1']); // preserved
    expect(merged.blocks['footer-1']).toBeTruthy();
  });

  test('an empty declared footer region survives the merge', async () => {
    const formData = {
      blocks: { 'body-1': { '@type': 'slate' } },
      blocks_layout: { items: ['body-1'], footer: [] },
    };

    const { merged } = await mergeTemplatesIntoPage(formData, {
      loadTemplate,
      preloadedTemplates: {},
      pageBlocksFields: { items: {}, footer: {} },
      uuidGenerator: () => 'u-1',
      blocksConfig,
      intl,
    });

    expect(merged.blocks_layout.items).toEqual(['body-1']);
    expect(Array.isArray(merged.blocks_layout.footer)).toBe(true);
    expect(merged.blocks_layout.footer).toEqual([]);
  });
});

describe('mergeTemplatesIntoPage — nested container regions', () => {
  const nestedBlocksConfig = {
    slate: { id: 'slate' },
    section: {
      id: 'section',
      blockSchema: {
        properties: {
          items: { widget: 'blocks_layout' }, footer: { widget: 'blocks_layout' },
        },
      },
    },
  };

  test('preserves a region inside a nested container block', async () => {
    const formData = {
      blocks: {
        'sec-1': {
          '@type': 'section',
          blocks: {
            'in-1': { '@type': 'slate' },
            'inf-1': { '@type': 'slate' },
          },
          blocks_layout: { items: ['in-1'], footer: ['inf-1'] },
        },
      },
      blocks_layout: { items: ['sec-1'] },
    };

    const { merged } = await mergeTemplatesIntoPage(formData, {
      loadTemplate,
      preloadedTemplates: {},
      pageBlocksFields: { items: {} },
      uuidGenerator: (() => { let n = 0; return () => `u-${++n}`; })(),
      blocksConfig: nestedBlocksConfig,
      intl,
    });

    const sec = merged.blocks['sec-1'];
    expect(sec.blocks_layout.items).toEqual(['in-1']);
    expect(sec.blocks_layout.footer).toEqual(['inf-1']); // preserved
    expect(sec.blocks['inf-1']).toBeTruthy();
  });
});
