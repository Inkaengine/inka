import { describe, test, expect } from 'vitest';
import {
  buildBlockPathMap,
  wrapBlocksInContainer,
  unwrapContainer,
} from './blockPath';

/**
 * Wrapping blocks that sit in a layout's slot, and unwrapping them back.
 *
 * A page laid out with a template keeps its own blocks marked for the
 * instance's slot (`templateId`, `templateInstanceId`, `slotId`). Wrapped as
 * they were, the children kept the marks: the next expansion collected them
 * as the slot's content and pulled them back OUT of the new container, which
 * then held nothing, and selecting up from a child reached the template
 * instead of the container — so it could not be unwrapped.
 *
 * The block in the slot is now the container: it takes the marks and its
 * children drop them. Unwrapping gives them back.
 */
const blocksConfig = {
  section: {
    id: 'section',
    blockSchema: {
      properties: {
        blocks_layout: { widget: 'blocks_layout', allowedBlocks: ['slate'] },
      },
    },
  },
  slate: { id: 'slate', blockSchema: { properties: { value: {} } } },
};
const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const MARKS = {
  templateId: '/templates/plain',
  templateInstanceId: 'inst-1',
  slotId: 'default',
};

const makeFormData = () => ({
  blocks: {
    'p-1': { '@type': 'slate', value: 'A', ...MARKS },
    'p-2': { '@type': 'slate', value: 'B', ...MARKS },
    'p-3': { '@type': 'slate', value: 'C', ...MARKS },
  },
  blocks_layout: { items: ['p-1', 'p-2', 'p-3'] },
});

const marksOf = (block) =>
  Object.fromEntries(
    Object.keys(MARKS)
      .filter((k) => block[k] !== undefined)
      .map((k) => [k, block[k]]),
  );

describe('wrap/unwrap in a layout slot', () => {
  test('the new container takes the slot marks; its children drop them', () => {
    const formData = makeFormData();
    const pathMap = buildBlockPathMap(formData, blocksConfig, intl);
    const { formData: out, newContainerId } = wrapBlocksInContainer(
      formData,
      pathMap,
      ['p-1', 'p-2'],
      'section',
      blocksConfig,
      intl,
      { uuidGenerator: () => 'sec-1' },
    );

    const section = out.blocks[newContainerId];
    expect(marksOf(section)).toEqual(MARKS);
    expect(Object.keys(section.blocks)).toEqual(['p-1', 'p-2']);
    for (const child of Object.values(section.blocks)) {
      expect(marksOf(child)).toEqual({});
    }
    expect(marksOf(out.blocks['p-3'])).toEqual(MARKS);
  });

  test('unwrapping gives the children back their slot marks', () => {
    const formData = makeFormData();
    const pathMap = buildBlockPathMap(formData, blocksConfig, intl);
    const { formData: wrapped, newContainerId } = wrapBlocksInContainer(
      formData,
      pathMap,
      ['p-1', 'p-2'],
      'section',
      blocksConfig,
      intl,
      { uuidGenerator: () => 'sec-1' },
    );
    const { formData: out } = unwrapContainer(
      wrapped,
      buildBlockPathMap(wrapped, blocksConfig, intl),
      newContainerId,
      blocksConfig,
      intl,
    );

    expect(out.blocks_layout.items).toEqual(['p-1', 'p-2', 'p-3']);
    for (const id of ['p-1', 'p-2', 'p-3']) {
      expect(marksOf(out.blocks[id])).toEqual(MARKS);
    }
  });

  test('blocks in no slot wrap and unwrap with no marks at all', () => {
    const formData = {
      blocks: { 'p-1': { '@type': 'slate', value: 'A' } },
      blocks_layout: { items: ['p-1'] },
    };
    const pathMap = buildBlockPathMap(formData, blocksConfig, intl);
    const { formData: out, newContainerId } = wrapBlocksInContainer(
      formData,
      pathMap,
      ['p-1'],
      'section',
      blocksConfig,
      intl,
      { uuidGenerator: () => 'sec-1' },
    );
    expect(marksOf(out.blocks[newContainerId])).toEqual({});
  });
});
