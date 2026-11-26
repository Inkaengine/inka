import {
  indexIncluded,
  resolveRelationship,
  flatten,
  flattenPayload,
  aliasOf,
} from './normalize.js';

const payload = {
  data: {
    type: 'node--page',
    id: 'uuid-node-1',
    attributes: {
      title: 'About',
      drupal_internal__nid: 7,
      path: { alias: '/about', pid: 1 },
      field_hydra_blocks: '{"v":1,"blocks":{}}',
    },
    relationships: {
      uid: { data: { type: 'user--user', id: 'uuid-user-1' } },
      field_tags: {
        data: [
          { type: 'taxonomy_term--tags', id: 'uuid-term-1' },
          { type: 'taxonomy_term--tags', id: 'uuid-term-2' },
        ],
      },
      field_empty: { data: null },
    },
  },
  included: [
    { type: 'user--user', id: 'uuid-user-1', attributes: { name: 'admin' } },
    { type: 'taxonomy_term--tags', id: 'uuid-term-1', attributes: { name: 'news' } },
    { type: 'taxonomy_term--tags', id: 'uuid-term-2', attributes: { name: 'plone' } },
  ],
};

test('indexes included entries by type and id', () => {
  const index = indexIncluded(payload);
  expect(index.get('user--user:uuid-user-1').attributes.name).toBe('admin');
  expect(index.size).toBe(3);
});

test('resolves a to-one relationship to its entity', () => {
  const index = indexIncluded(payload);
  const resolved = resolveRelationship(payload.data.relationships.uid, index);
  expect(resolved).toHaveLength(1);
  expect(resolved[0].attributes.name).toBe('admin');
});

test('resolves a to-many relationship preserving order', () => {
  const index = indexIncluded(payload);
  const resolved = resolveRelationship(
    payload.data.relationships.field_tags,
    index,
  );
  expect(resolved.map((t) => t.attributes.name)).toEqual(['news', 'plone']);
});

test('an empty relationship resolves to nothing, not a crash', () => {
  const index = indexIncluded(payload);
  expect(resolveRelationship(payload.data.relationships.field_empty, index)).toEqual([]);
  expect(resolveRelationship(undefined, index)).toEqual([]);
});

test('flatten keeps to-one single and to-many an array', () => {
  const flat = flatten(payload.data, indexIncluded(payload));
  expect(flat.relationships.uid.attributes.name).toBe('admin');
  expect(Array.isArray(flat.relationships.field_tags)).toBe(true);
  // A to-one relationship must NOT become a one-element array: callers would
  // then have to branch on cardinality everywhere.
  expect(Array.isArray(flat.relationships.uid)).toBe(false);
  expect(flat.relationships.field_empty).toBeNull();
});

test('a reference not present in included keeps its id', () => {
  // JSON:API always carries the id; `included` only adds the body. Dropping
  // the reference would lose information the response actually has — and a
  // menu tree walked by id would come back empty.
  const index = indexIncluded({ included: [] });
  const flat = flatten(payload.data, index);
  expect(flat.relationships.uid).toEqual({ id: 'uuid-user-1', type: 'user--user' });
  expect(flat.relationships.uid.attributes).toBeUndefined();
  expect(flat.relationships.field_tags.map((t) => t.id)).toEqual([
    'uuid-term-1',
    'uuid-term-2',
  ]);
});

test('flattens a collection response', () => {
  const flat = flattenPayload({ ...payload, data: [payload.data] });
  expect(Array.isArray(flat)).toBe(true);
  expect(flat[0].attributes.title).toBe('About');
});

test('uses the path alias as the document URL', () => {
  expect(aliasOf(flatten(payload.data, indexIncluded(payload)))).toBe('/about');
});

test('falls back to /node/<nid> when no alias exists', () => {
  const noAlias = {
    ...payload.data,
    attributes: { ...payload.data.attributes, path: { alias: '' } },
  };
  // Not a fabricated pretty path: inventing one produces a URL that 404s.
  expect(aliasOf(flatten(noAlias, indexIncluded(payload)))).toBe('/node/7');
});

// ---------------------------------------------------------------------------
// Against real Drupal 11 output.
//
// The sample above is hand-written and therefore agrees with my assumptions.
// These run the same functions over responses captured from an actual Drupal
// (tests-adapters/capture/capture-drupal.sh), which is the only way to find
// out where those assumptions are wrong.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests-adapters/fixtures/drupal',
);

const load = (name) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));

test('flattens a real node collection', () => {
  const flat = flattenPayload(load('node-page'));
  expect(Array.isArray(flat)).toBe(true);
  expect(flat.length).toBeGreaterThan(0);

  const about = flat.find((n) => n.attributes.title === 'About');
  expect(about).toBeDefined();
  expect(about.type).toBe('node--page');
  // uuid: the stable handle references are stored by.
  expect(about.id).toMatch(/^[0-9a-f-]{36}$/);
});

test('the blocks field survives Drupal byte-for-byte', () => {
  const flat = flattenPayload(load('node-page'));
  const about = flat.find((n) => n.attributes.title === 'About');
  const raw = about.attributes.field_hydra_blocks;

  expect(typeof raw).toBe('string');
  // A core string_long field, so Drupal treats it as opaque text — no
  // re-encoding, no PHP empty-array-versus-object ambiguity like WordPress.
  expect(JSON.parse(raw)).toEqual({ v: 1, blocks: { b1: { '@type': 'slate' } } });
});

test('the path alias is the document URL', () => {
  const flat = flattenPayload(load('node-page'));
  const about = flat.find((n) => n.attributes.title === 'About');
  expect(aliasOf(about)).toBe('/about');
});

test('real relationships resolve without an included section', () => {
  // This capture has no ?include=, so every relationship is a bare pointer.
  // Resolving must yield null/[] rather than throwing — the adapter asks for
  // includes only when it needs them.
  const flat = flattenPayload(load('node-page'));
  const about = flat.find((n) => n.attributes.title === 'About');
  // No ?include= in this capture, so the body is absent but the id remains.
  expect(about.relationships.uid.id).toBeTruthy();
  expect(about.relationships.uid.attributes).toBeUndefined();
  expect(Object.keys(about.relationships)).toContain('node_type');
});

test('an empty collection flattens to an empty array, not null', () => {
  // menu-links is empty on a fresh site: the virtual-folder case, where a
  // document exists with no menu link and therefore no place in the tree.
  const flat = flattenPayload(load('menu-links'));
  expect(flat).toEqual([]);
});
