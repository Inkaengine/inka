import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDistribution } from './read-distribution.mjs';
import { planImport } from './import-content.mjs';

let dir;

/** Write a plone.exportimport tree: content/<dirKey>/data.json + __metadata__.json. */
function distribution({ items, ordering = {}, blobFiles = [] }) {
  const content = join(dir, 'content');
  const dataFiles = [];
  for (const [dirKey, data] of Object.entries(items)) {
    mkdirSync(join(content, dirKey), { recursive: true });
    writeFileSync(join(content, dirKey, 'data.json'), JSON.stringify(data, null, 2));
    dataFiles.push(`${dirKey}/data.json`);
  }
  for (const blob of blobFiles) {
    mkdirSync(join(content, blob, '..'), { recursive: true });
    writeFileSync(join(content, blob), 'bytes');
  }
  writeFileSync(
    join(content, '__metadata__.json'),
    JSON.stringify({
      __version__: '1.0.0',
      _data_files_: dataFiles,
      _blob_files_: blobFiles,
      default_page: {},
      local_roles: {},
      ordering,
      relations: [],
    }),
  );
  return dir;
}

const TREE = {
  items: {
    plone_site_root: { '@type': 'Plone Site', title: 'Site', UID: 'uid-root' },
    docs: { '@type': 'Folder', title: 'Docs', UID: 'uid-docs', review_state: 'published' },
    'docs/second': {
      '@type': 'Document',
      title: 'Second',
      UID: 'uid-second',
      review_state: 'published',
      blocks: { b: { '@type': 'slate' } },
      blocks_layout: { items: ['b'] },
    },
    'docs/first': {
      '@type': 'Document',
      title: 'First',
      UID: 'uid-first',
      review_state: 'private',
      blocks: { a: { '@type': 'slate' } },
      blocks_layout: { items: ['a'] },
    },
  },
  // Plone's own positions: first, then second — the OPPOSITE of the order the
  // data files are listed in.
  ordering: { 'uid-first': 0, 'uid-second': 1 },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dist-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readDistribution', () => {
  it('returns the same shape readTree does, so the importer needs no second path', () => {
    const d = readDistribution(distribution(TREE));
    expect(d.items).toBeInstanceOf(Map);
    expect(d.order).toBeInstanceOf(Map);
    expect(d.blobFiles).toBeInstanceOf(Map);
    // And it drops straight into planImport, which is the whole point.
    const plan = planImport(d, new Set());
    expect(plan.creates.length).toBeGreaterThan(0);
  });

  it('recovers each path from its dirKey, not from @id', () => {
    // @id in a real export is an absolute URL naming whatever host ran it. The
    // dirKey is the path, which is why that is what we read.
    const d = readDistribution(
      distribution({
        items: {
          plone_site_root: { '@type': 'Plone Site', title: 'S' },
          'docs/page': {
            '@type': 'Document',
            title: 'P',
            UID: 'u1',
            '@id': 'https://some-other-host.example/Plone/docs/page',
          },
        },
      }),
    );
    expect([...d.items.keys()].sort()).toEqual(['/', '/docs/page']);
  });

  it('turns the UID→position ordering into the folder→child-ids the importer wants', () => {
    // The reason this cannot be skipped: `_data_files_` lists second before
    // first, and the distribution says otherwise. An import that trusted the
    // file order would build the navigation backwards and look like it worked.
    const d = readDistribution(distribution(TREE));
    expect(d.order.get('/docs')).toEqual(['first', 'second']);
  });

  it('asserts no order for a folder the distribution did not position', () => {
    const d = readDistribution(
      distribution({
        items: {
          plone_site_root: { '@type': 'Plone Site', title: 'S' },
          loose: { '@type': 'Document', title: 'Loose', UID: 'uid-loose' },
        },
      }),
    );
    // Not an invented order: absent means the CMS decides.
    expect(d.order.size).toBe(0);
  });

  it('positions the children the distribution named and lists the rest after them', () => {
    // A REAL export does this: the site root of one has ordered folders sitting
    // next to unpositioned items. plone.exportimport applies the positions it
    // recorded and leaves everything else in creation order, which is the order
    // `_data_files_` lists — the same order this importer creates them in. So
    // naming them asserts no change, not a position nobody claimed.
    const d = readDistribution(
      distribution({
        items: {
          plone_site_root: { '@type': 'Plone Site', title: 'S', UID: 'uid-root' },
          docs: { '@type': 'Folder', title: 'Docs', UID: 'uid-docs' },
          'docs/second': { '@type': 'Document', title: 'Second', UID: 'uid-second' },
          'docs/first': { '@type': 'Document', title: 'First', UID: 'uid-first' },
          'docs/loose': { '@type': 'Document', title: 'Loose', UID: 'uid-loose' },
        },
        ordering: { 'uid-first': 0, 'uid-second': 1 },
      }),
    );
    expect(d.order.get('/docs')).toEqual(['first', 'second', 'loose']);
  });

  it('maps blob bytes to the item that carries them', () => {
    const d = readDistribution(
      distribution({ ...TREE, blobFiles: ['docs/first/image/a.png'] }),
    );
    expect(d.blobFiles.get('/docs/first')).toBe(
      join(dir, 'content', 'docs/first/image/a.png'),
    );
  });

  it('refuses an item with more than one blob, rather than dropping one', () => {
    expect(() =>
      readDistribution(
        distribution({
          ...TREE,
          blobFiles: ['docs/first/image/a.png', 'docs/first/file/b.pdf'],
        }),
      ),
    ).toThrow(/docs\/first/);
  });

  it('fails loudly with no metadata, and on a data file it promised', () => {
    mkdirSync(join(dir, 'content'), { recursive: true });
    expect(() => readDistribution(dir)).toThrow(/__metadata__\.json/);

    const root = distribution({
      items: { docs: { '@type': 'Folder', title: 'D', UID: 'u' } },
    });
    rmSync(join(root, 'content', 'docs', 'data.json'));
    // A half-written distribution must stop the import, not import half a site.
    expect(() => readDistribution(root)).toThrow(/docs\/data\.json/);
  });
});
