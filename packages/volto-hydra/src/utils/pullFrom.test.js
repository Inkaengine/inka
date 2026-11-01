/**
 * `_pullFrom`: a block says which of its fields take their value from which
 * link, and nothing else does.
 *
 * The old record was the inverse — `_customFields` listed the exceptions, so a
 * field absent from it was pulled. Absence is what every writer that is not the
 * editor's own form produces (the importer, the restapi, `edit_blocks` over
 * MCP), so authored titles were replaced on page open. See inka#595.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => {},
  getLiveBlockData: () => null,
  HydraSchemaProvider: ({ children }) => children,
  useHydraSchemaContext: () => ({}),
}));

import {
  PULL_FROM_KEY,
  getSourceField,
  sourceFieldFor,
  isFieldPulled,
  withFieldPulled,
  withFieldNotPulled,
  fieldsToPullOnPick,
} from './copyFromTargetMapping';
import {
  isFieldLinked,
  linkPickedFields,
  getTargetId,
  getTargetValueForField,
  pullLinkedFields,
  pullAllLinkedFields,
  unpullEditedFields,
  applyCopyFromTargetToSchema,
} from './copyFromTarget';

const snapshot = {
  '@id': '/news/big',
  title: 'Big News',
  description: 'It happened',
};

/** A teaser as the shipped config declares it: `@default`, no explicit `@target`. */
const teaser = {
  id: 'teaser',
  fieldMappings: {
    '@default': { '@id': 'href', title: 'title', description: 'description' },
  },
  blockSchema: {
    properties: {
      href: { widget: 'object_browser', mode: 'link' },
      title: { title: 'Title' },
      description: { title: 'Description', widget: 'textarea' },
    },
  },
};

describe('the source link is declared, not sniffed', () => {
  it("takes the source from @default's '@id' entry", () => {
    expect(getSourceField(teaser)).toBe('href');
  });

  it("takes the source from an explicit @target's '@source'", () => {
    const cfg = {
      fieldMappings: { '@target': { '@source': 'linkTo', title: 'title' } },
      blockSchema: {
        properties: {
          linkTo: { widget: 'object_browser', mode: 'link' },
          other: { widget: 'url' },
          title: {},
        },
      },
    };
    expect(getSourceField(cfg)).toBe('linkTo');
  });

  it('falls back to the one link field when a block has exactly one', () => {
    const cfg = {
      fieldMappings: { '@target': { title: 'title' } },
      blockSchema: {
        properties: { href: { widget: 'object_browser', mode: 'link' }, title: {} },
      },
    };
    expect(getSourceField(cfg)).toBe('href');
  });

  it('THROWS when a block has two link fields and declares neither as the source', () => {
    // `button` in a real site config has url (legacy), href and searchPath, and
    // the old getUrlField silently picked the first in schema order — the dead
    // legacy field. Guessing is what has to stop.
    const cfg = {
      id: 'button',
      fieldMappings: { '@target': { title: 'title' } },
      blockSchema: {
        properties: {
          url: { title: 'Link (legacy)', widget: 'url' },
          href: { widget: 'object_browser', mode: 'link' },
          searchPath: { widget: 'object_browser', mode: 'link' },
          title: {},
        },
      },
    };
    expect(() => getSourceField(cfg)).toThrow(/button/);
    expect(() => getSourceField(cfg)).toThrow(/url, href, searchPath/);
  });

  it('is null for a block with no link field at all', () => {
    const cfg = {
      fieldMappings: { '@target': { title: 'title' } },
      blockSchema: { properties: { title: {} } },
    };
    expect(getSourceField(cfg)).toBe(null);
  });
});

describe('absent _pullFrom pulls nothing — the authored value survives', () => {
  // The whole bug, as one case: a teaser written by the importer or by an agent
  // carries its own words and no record, and opening the page must not touch it.
  const authored = () => ({
    '@type': 'teaser',
    title: 'Design',
    description: 'We design in English.',
    href: [snapshot],
  });

  it('isFieldLinked is false with no record', () => {
    expect(isFieldLinked('title', teaser, authored())).toBe(false);
  });

  it('pullLinkedFields is a no-op (same reference)', () => {
    const block = authored();
    expect(pullLinkedFields(teaser, block)).toBe(block);
  });

  it('pullAllLinkedFields leaves the page untouched on open', () => {
    const form = { blocks: { t1: authored() } };
    const out = pullAllLinkedFields(form, { teaser });
    expect(out).toBe(form);
    expect(out.blocks.t1.title).toBe('Design');
  });
});

describe('a listed field is pulled', () => {
  const linked = () => ({
    '@type': 'teaser',
    title: 'stale',
    href: [snapshot],
    [PULL_FROM_KEY]: { href: ['title'] },
  });

  it('isFieldLinked is true for a listed field, false for an unlisted sibling', () => {
    expect(isFieldLinked('title', teaser, linked())).toBe(true);
    expect(isFieldLinked('description', teaser, linked())).toBe(false);
  });

  it('pullLinkedFields fills it and leaves the unlisted sibling alone', () => {
    const out = pullLinkedFields(teaser, { ...linked(), description: 'my own words' });
    expect(out.title).toBe('Big News');
    expect(out.description).toBe('my own words');
  });

  it('nothing is pulled when the named link holds no target', () => {
    const block = { ...linked(), href: [] };
    expect(isFieldLinked('title', teaser, block)).toBe(false);
    expect(pullLinkedFields(teaser, block)).toBe(block);
  });

  it('nothing is pulled from an EXTERNAL link (no catalog item to pull from)', () => {
    const block = { ...linked(), href: [{ '@id': 'https://example.org/x', title: 'Example' }] };
    expect(isFieldLinked('title', teaser, block)).toBe(false);
  });
});

describe('an empty list is not absence — the source is remembered', () => {
  const emptied = {
    '@type': 'teaser',
    title: 'Design',
    href: [snapshot],
    [PULL_FROM_KEY]: { href: [] },
  };

  it('pulls nothing', () => {
    expect(isFieldLinked('title', teaser, emptied)).toBe(false);
    expect(pullLinkedFields(teaser, emptied)).toBe(emptied);
  });

  it('still names the source, so the UI can offer re-linking', () => {
    expect(Object.keys(emptied[PULL_FROM_KEY])).toEqual(['href']);
  });

  it('withFieldNotPulled KEEPS the key when the list empties', () => {
    // The old withFieldLinked deleted the key, which is how the source was lost.
    const before = { [PULL_FROM_KEY]: { href: ['title'] } };
    const after = withFieldNotPulled(before, 'title');
    expect(after[PULL_FROM_KEY]).toEqual({ href: [] });
  });
});

describe('withFieldPulled / withFieldNotPulled', () => {
  it('adds a field under its source link, immutably', () => {
    const before = { href: [snapshot] };
    const after = withFieldPulled(before, 'title', 'href');
    expect(after[PULL_FROM_KEY]).toEqual({ href: ['title'] });
    expect(before[PULL_FROM_KEY]).toBeUndefined();
  });

  it('does not duplicate a field already listed', () => {
    const once = withFieldPulled({}, 'title', 'href');
    expect(withFieldPulled(once, 'title', 'href')[PULL_FROM_KEY]).toEqual({ href: ['title'] });
  });

  it('removes a field from whichever link lists it', () => {
    const data = { [PULL_FROM_KEY]: { href: ['title', 'description'] } };
    expect(withFieldNotPulled(data, 'title')[PULL_FROM_KEY]).toEqual({ href: ['description'] });
  });
});

describe('a record naming a link the mapping did not declare is bad data', () => {
  // Nothing can choose the source: the sidebar toggle is per destination field
  // and every path asks the config. So a second link in the record is not a
  // second source — it is a record the editor could not have written.
  const cfg = {
    id: 'card',
    fieldMappings: { '@target': { '@source': 'href', title: 'title' } },
    blockSchema: {
      properties: {
        href: { widget: 'object_browser', mode: 'link' },
        preview_image_link: { widget: 'object_browser', mode: 'link' },
        title: {},
      },
    },
  };

  it('resolves a field against the link the record names', () => {
    const block = { [PULL_FROM_KEY]: { href: ['title'] } };
    expect(sourceFieldFor('title', block)).toBe('href');
    expect(sourceFieldFor('nothing', block)).toBe(null);
  });

  it('THROWS rather than pulling from an undeclared link', () => {
    const block = {
      '@type': 'card',
      href: [{ '@id': '/news/big', title: 'Big News' }],
      preview_image_link: [{ '@id': '/images/hero', title: 'Hero' }],
      [PULL_FROM_KEY]: { preview_image_link: ['title'] },
    };
    expect(() => isFieldLinked('title', cfg, block)).toThrow(/preview_image_link/);
    expect(() => isFieldLinked('title', cfg, block)).toThrow(/declares "href"/);
  });

  it('getTargetId reads the declared source', () => {
    const block = {
      '@type': 'card',
      href: [{ '@id': '/news/big' }],
      [PULL_FROM_KEY]: { href: ['title'] },
    };
    expect(getTargetId(cfg, block, 'title')).toBe('/news/big');
  });
});

describe('isFieldPulled', () => {
  it('is true only for a field listed under some link', () => {
    const data = { [PULL_FROM_KEY]: { href: ['title'] } };
    expect(isFieldPulled('title', data)).toBe(true);
    expect(isFieldPulled('description', data)).toBe(false);
    expect(isFieldPulled('title', {})).toBe(false);
  });
});

describe('unpullEditedFields — editing a pulled field claims it', () => {
  const cfg = { teaser };
  const pulled = () => ({
    '@type': 'teaser',
    href: [snapshot],
    title: 'Big News',
    [PULL_FROM_KEY]: { href: ['title', 'description'] },
  });

  it('drops an edited field from the list, keeping the typed value', () => {
    const previous = { blocks: { t1: pulled() } };
    const incoming = { blocks: { t1: { ...pulled(), title: 'Typed on canvas' } } };
    const out = unpullEditedFields(incoming, previous, cfg);
    expect(out.blocks.t1.title).toBe('Typed on canvas');
    expect(out.blocks.t1[PULL_FROM_KEY]).toEqual({ href: ['description'] });
  });

  it('leaves an unchanged field listed', () => {
    const previous = { blocks: { t1: pulled() } };
    const incoming = { blocks: { t1: pulled() } };
    expect(unpullEditedFields(incoming, previous, cfg)).toBe(incoming);
  });

  it('does NOT drop a field whose value changed TO the target (that is the pull)', () => {
    const previous = { blocks: { t1: { ...pulled(), title: 'stale' } } };
    const incoming = { blocks: { t1: { ...pulled(), title: 'Big News' } } };
    const out = unpullEditedFields(incoming, previous, cfg);
    expect(out.blocks.t1[PULL_FROM_KEY]).toEqual({ href: ['title', 'description'] });
  });

  it('ignores a field that was never listed', () => {
    const previous = { blocks: { t1: { '@type': 'teaser', href: [snapshot], title: 'a' } } };
    const incoming = { blocks: { t1: { '@type': 'teaser', href: [snapshot], title: 'b' } } };
    expect(unpullEditedFields(incoming, previous, cfg)).toBe(incoming);
  });

  it('reaches blocks inside containers', () => {
    const previous = { blocks: { grid: { '@type': 'grid', blocks: { t1: pulled() } } } };
    const incoming = {
      blocks: { grid: { '@type': 'grid', blocks: { t1: { ...pulled(), title: 'Edited' } } } },
    };
    const out = unpullEditedFields(incoming, previous, cfg);
    expect(out.blocks.grid.blocks.t1[PULL_FROM_KEY]).toEqual({ href: ['description'] });
  });
});

describe('fieldsToPullOnPick — what a fresh link pick links', () => {
  // Picking a link must not overwrite words already written, so only the EMPTY
  // mapped fields start out pulled. This is Volto's own guard
  // (`!data.title && !data.description` in the teaser's adapter), kept.
  it('lists the mapped fields that are empty', () => {
    expect(fieldsToPullOnPick(teaser, { '@type': 'teaser' })).toEqual(['title', 'description']);
  });

  it('omits a field that already holds a value', () => {
    expect(fieldsToPullOnPick(teaser, { '@type': 'teaser', title: 'Design' })).toEqual([
      'description',
    ]);
  });

  it('treats an empty string and an empty array as empty', () => {
    expect(
      fieldsToPullOnPick(teaser, { '@type': 'teaser', title: '', description: [] }),
    ).toEqual(['title', 'description']);
  });
});

describe('applyCopyFromTargetToSchema stamps the DECLARED source', () => {
  it('puts selectedItemAttrs on the declared link field', () => {
    const schema = {
      properties: {
        href: { widget: 'object_browser', mode: 'link' },
        title: {},
        description: { widget: 'textarea' },
      },
    };
    const out = applyCopyFromTargetToSchema(schema, teaser);
    expect(out.properties.href.selectedItemAttrs).toContain('title');
    expect(out.properties.href.selectedItemAttrs).toContain('description');
  });

  it('does NOT stamp a link field that is not the source', () => {
    // The real failure: `button`'s snapshot keys landed on the dead legacy
    // `url`, so `href` — the field the author picks with — never stored one and
    // the pull could not have worked even pointed correctly.
    const cfg = {
      id: 'button',
      fieldMappings: { '@default': { '@id': { field: 'href', type: 'link' }, title: 'title' } },
      blockSchema: {
        properties: {
          url: { title: 'Link (legacy)', widget: 'url' },
          href: { widget: 'object_browser', mode: 'link' },
          title: {},
        },
      },
    };
    const out = applyCopyFromTargetToSchema(cfg.blockSchema, cfg);
    expect(out.properties.href.selectedItemAttrs).toBeTruthy();
    expect(out.properties.url.selectedItemAttrs).toBeUndefined();
  });
});

describe('linkPickedFields — picking a link hands it the empty fields', () => {
  const picked = () => ({ '@type': 'teaser', href: [snapshot] });

  it('lists the empty mapped fields under the source, when nothing was decided', () => {
    const out = linkPickedFields(teaser, picked());
    expect(out[PULL_FROM_KEY]).toEqual({ href: ['title', 'description'] });
  });

  it('leaves fields that already hold words to the author', () => {
    const out = linkPickedFields(teaser, { ...picked(), title: 'Design' });
    expect(out[PULL_FROM_KEY]).toEqual({ href: ['description'] });
  });

  it('respects a decision already made — an EMPTY list is a decision', () => {
    // Unticking every toggle leaves `{href: []}`. Re-linking from there is the
    // author's call, so a later render must not hand the fields back.
    const block = { ...picked(), [PULL_FROM_KEY]: { href: [] } };
    expect(linkPickedFields(teaser, block)).toBe(block);
  });

  it('does not re-link a field released while a sibling stays linked', () => {
    const block = { ...picked(), [PULL_FROM_KEY]: { href: ['description'] } };
    expect(linkPickedFields(teaser, block)).toBe(block);
  });

  it('does nothing without an internal target', () => {
    expect(linkPickedFields(teaser, { '@type': 'teaser', href: [] })).toEqual({
      '@type': 'teaser',
      href: [],
    });
    const external = { '@type': 'teaser', href: [{ '@id': 'https://example.org/x' }] };
    expect(linkPickedFields(teaser, external)).toBe(external);
  });
});
