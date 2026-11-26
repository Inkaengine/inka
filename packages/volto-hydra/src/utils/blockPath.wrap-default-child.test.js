import { describe, test, expect } from 'vitest';
import {
  buildBlockPathMap,
  wrapBlocksInContainer,
  unwrapContainer,
  wrapRoute,
  unwrapRoute,
} from './blockPath';

/**
 * Wrap and unwrap through a container's default child (#790).
 *
 * A `grid` holds its content one level down: its region only takes `column`
 * blocks, and each column holds the content. `column` is the region's default
 * child — the type Inka adds when it fills the region (getEmptyBlockType: its
 * `defaultBlockType`, else its only allowed type). Wrapping paragraphs in a
 * grid creates that column around them; unwrapping a grid lifts its columns'
 * blocks out, and so does unwrapping its only column.
 */
const blocksConfig = {
  // The default child is the region's only allowed type.
  grid: {
    id: 'grid',
    blockSchema: {
      properties: {
        columns: { widget: 'blocks_layout', allowedBlocks: ['column'] },
      },
    },
  },
  // The default child is named.
  band: {
    id: 'band',
    blockSchema: {
      properties: {
        items: {
          widget: 'blocks_layout',
          allowedBlocks: ['column', 'slate'],
          defaultBlockType: 'column',
        },
      },
    },
  },
  // Two allowed types and no default: no default child.
  pickBox: {
    id: 'pickBox',
    blockSchema: {
      properties: {
        items: { widget: 'blocks_layout', allowedBlocks: ['column', 'card'] },
      },
    },
  },
  // Holds the content directly.
  section: {
    id: 'section',
    blockSchema: {
      properties: {
        items: { widget: 'blocks_layout', allowedBlocks: ['slate', 'image'] },
      },
    },
  },
  // Its own default child is a slate, which holds no blocks: unwrapping goes
  // through a default child only when that child is a container.
  column: {
    id: 'column',
    restricted: true,
    blockSchema: {
      properties: {
        items: { widget: 'blocks_layout', allowedBlocks: ['slate', 'image'], defaultBlockType: 'slate' },
      },
    },
  },
  card: { id: 'card', restricted: true, blockSchema: { properties: {} } },
  // Allowed in a column, not on the page.
  image: { id: 'image', restricted: true, blockSchema: { properties: {} } },
  slate: { id: 'slate', blockSchema: { properties: { value: {} } } },
};
const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };

const slate = (value) => ({ '@type': 'slate', value });
const column = (blocks) => ({
  '@type': 'column',
  blocks,
  blocks_layout: { items: Object.keys(blocks) },
});
const grid = (columns) => ({
  '@type': 'grid',
  blocks: columns,
  blocks_layout: { columns: Object.keys(columns) },
});
const page = (blocks) => ({
  blocks,
  blocks_layout: { items: Object.keys(blocks) },
});
const ids = (...list) => {
  let i = 0;
  return () => list[i++];
};

describe('wrapRoute', () => {
  test('a container that takes the selection holds it directly', () => {
    expect(wrapRoute('section', ['slate'], blocksConfig, intl)).toEqual({ via: null });
  });

  test("a container whose default child takes the selection holds it through that child", () => {
    expect(wrapRoute('grid', ['slate', 'slate'], blocksConfig, intl)).toEqual({ via: 'column' });
    expect(wrapRoute('band', ['image'], blocksConfig, intl)).toEqual({ via: 'column' });
  });

  test('a direct fit wins over the default child', () => {
    expect(wrapRoute('band', ['slate'], blocksConfig, intl)).toEqual({ via: null });
  });

  test('no route when neither the container nor its default child takes the selection', () => {
    expect(wrapRoute('pickBox', ['slate'], blocksConfig, intl)).toBeNull();
    expect(wrapRoute('grid', ['grid'], blocksConfig, intl)).toBeNull();
  });
});

describe('wrap through the default child', () => {
  test('two paragraphs wrapped in a grid sit in one new column, where the first was', () => {
    const formData = page({ 'p-0': slate('Before'), 'p-1': slate('A'), 'p-2': slate('B'), 'p-3': slate('After') });
    const { formData: out, newContainerId } = wrapBlocksInContainer(
      formData,
      buildBlockPathMap(formData, blocksConfig, intl),
      ['p-1', 'p-2'],
      'grid',
      blocksConfig,
      intl,
      { uuidGenerator: ids('g-1', 'c-1') },
    );

    expect(newContainerId).toBe('g-1');
    expect(out.blocks_layout.items).toEqual(['p-0', 'g-1', 'p-3']);
    expect(out.blocks['g-1']).toEqual(grid({ 'c-1': column({ 'p-1': slate('A'), 'p-2': slate('B') }) }));
  });
});

describe('unwrapRoute', () => {
  test('a container whose children the parent takes unwraps directly', () => {
    const formData = page({
      sec: { '@type': 'section', blocks: { 'p-1': slate('A') }, blocks_layout: { items: ['p-1'] } },
    });
    const bpm = buildBlockPathMap(formData, blocksConfig, intl);
    expect(unwrapRoute(formData, bpm, 'sec', blocksConfig, intl)).toEqual({ containerId: 'sec', through: false });
  });

  test('a grid unwraps through its columns', () => {
    const formData = page({ g: grid({ c1: column({ 'p-1': slate('A') }) }) });
    const bpm = buildBlockPathMap(formData, blocksConfig, intl);
    expect(unwrapRoute(formData, bpm, 'g', blocksConfig, intl)).toEqual({ containerId: 'g', through: true });
  });

  test("a grid's only column unwraps the grid", () => {
    const formData = page({ g: grid({ c1: column({ 'p-1': slate('A') }) }) });
    const bpm = buildBlockPathMap(formData, blocksConfig, intl);
    expect(unwrapRoute(formData, bpm, 'c1', blocksConfig, intl)).toEqual({ containerId: 'g', through: true });
  });

  test('a column is not unwrapped through its slates, which hold no blocks', () => {
    // The column's default child is a slate. Going "through" its slates would
    // promote their blocks (none) and drop the slates: content lost.
    const formData = page({ g: grid({ c1: column({ 'p-1': slate('A') }) }) });
    const bpm = buildBlockPathMap(formData, blocksConfig, intl);
    expect(unwrapRoute(formData, bpm, 'c1', blocksConfig, intl)).not.toEqual({ containerId: 'c1', through: true });
  });

  test('one of two columns does not unwrap', () => {
    const formData = page({
      g: grid({ c1: column({ 'p-1': slate('A') }), c2: column({ 'p-2': slate('B') }) }),
    });
    const bpm = buildBlockPathMap(formData, blocksConfig, intl);
    expect(unwrapRoute(formData, bpm, 'c1', blocksConfig, intl)).toBeNull();
  });

  test("no route when the page doesn't take a column's blocks", () => {
    const formData = page({ g: grid({ c1: column({ 'i-1': { '@type': 'image' } }) }) });
    const bpm = buildBlockPathMap(formData, blocksConfig, intl);
    expect(unwrapRoute(formData, bpm, 'g', blocksConfig, intl)).toBeNull();
    expect(unwrapRoute(formData, bpm, 'c1', blocksConfig, intl)).toBeNull();
  });

  test('no route through children that are not the default child', () => {
    const formData = page({
      box: {
        '@type': 'pickBox',
        blocks: { c1: column({ 'p-1': slate('A') }) },
        blocks_layout: { items: ['c1'] },
      },
    });
    const bpm = buildBlockPathMap(formData, blocksConfig, intl);
    expect(unwrapRoute(formData, bpm, 'box', blocksConfig, intl)).toBeNull();
    expect(unwrapRoute(formData, bpm, 'c1', blocksConfig, intl)).toBeNull();
  });
});

describe('unwrap through the default child', () => {
  test("a grid's columns' blocks take its place, column by column", () => {
    const formData = page({
      'p-0': slate('Before'),
      g: grid({
        c1: column({ 'p-1': slate('A'), 'p-2': slate('B') }),
        c2: column({ 'p-3': slate('C') }),
      }),
      'p-9': slate('After'),
    });
    const { formData: out, promotedIds } = unwrapContainer(
      formData,
      buildBlockPathMap(formData, blocksConfig, intl),
      'g',
      blocksConfig,
      intl,
      { through: true },
    );

    expect(promotedIds).toEqual(['p-1', 'p-2', 'p-3']);
    expect(out).toEqual(
      page({
        'p-0': slate('Before'),
        'p-1': slate('A'),
        'p-2': slate('B'),
        'p-3': slate('C'),
        'p-9': slate('After'),
      }),
    );
  });

  test('wrapping then unwrapping gives the page back', () => {
    const formData = page({ 'p-1': slate('A'), 'p-2': slate('B') });
    const { formData: wrapped } = wrapBlocksInContainer(
      formData,
      buildBlockPathMap(formData, blocksConfig, intl),
      ['p-1', 'p-2'],
      'grid',
      blocksConfig,
      intl,
      { uuidGenerator: ids('g-1', 'c-1') },
    );
    const bpm = buildBlockPathMap(wrapped, blocksConfig, intl);
    const route = unwrapRoute(wrapped, bpm, 'c-1', blocksConfig, intl);
    const { formData: out } = unwrapContainer(wrapped, bpm, route.containerId, blocksConfig, intl, {
      through: route.through,
    });
    expect(out).toEqual(formData);
  });
});
