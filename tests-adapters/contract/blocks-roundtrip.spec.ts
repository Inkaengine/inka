import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
});

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});

const PATH = '/news/first-post';

async function write(blocks: unknown, items: string[]) {
  await target.adapter.dispatch('content.update', {
    path: PATH,
    data: { blocks, blocksLayout: { items } },
  });
  return target.adapter.dispatch('content.get', { path: PATH }) as Promise<any>;
}

describe('blocks survive the storage round trip', () => {
  it('preserves a deeply nested block structure byte for byte', async () => {
    // Where the blocks physically live is adapter business — a native field in
    // Plone, an HTML comment in WordPress's post_content, a string_long field
    // in Drupal. The contract is only that what goes in comes back out.
    const blocks = {
      cols: {
        '@type': 'columnsBlock',
        data: {
          blocks: {
            c1: {
              '@type': 'column',
              blocks: {
                t1: {
                  '@type': 'slate',
                  value: [
                    {
                      type: 'p',
                      children: [
                        { text: 'Nested ' },
                        { text: 'bold', bold: true },
                        { text: ' and "quoted" & escaped <tags>' },
                      ],
                    },
                  ],
                },
              },
              blocks_layout: { items: ['t1'] },
            },
          },
          blocks_layout: { items: ['c1'] },
        },
      },
    };

    const doc = await write(blocks, ['cols']);
    expect(doc.blocks).toEqual(blocks);
    expect(doc.blocksLayout.items).toEqual(['cols']);
  });

  it('preserves unicode and newlines in block text', async () => {
    const blocks = {
      s1: {
        '@type': 'slate',
        value: [
          {
            type: 'p',
            children: [{ text: 'emoji 🎉 · ümlaut · 日本語\nsecond line' }],
          },
        ],
      },
    };
    const doc = await write(blocks, ['s1']);
    expect(doc.blocks).toEqual(blocks);
  });

  it('preserves layout order exactly', async () => {
    const ids = ['z', 'a', 'm', 'b'];
    const blocks = Object.fromEntries(
      ids.map((id) => [id, { '@type': 'slate', value: [] }]),
    );
    const doc = await write(blocks, ids);
    expect(doc.blocksLayout.items).toEqual(ids);
  });

  it('can empty the blocks of a document', async () => {
    const doc = await write({}, []);
    expect(doc.blocks).toEqual({});
    expect(doc.blocksLayout.items).toEqual([]);
  });
});
