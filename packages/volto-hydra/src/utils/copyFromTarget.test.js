import { describe, it, expect, vi } from 'vitest';

// HydraSchemaContext.js is JSX inside a .js file (the admin build uses babel;
// vitest/vite can't transform JSX in .js). copyFromTarget → blockSync
// imports '../context', so stub it — same convention as blockSync.test.js.
vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => {},
  getLiveBlockData: () => null,
  HydraSchemaProvider: ({ children }) => children,
  useHydraSchemaContext: () => ({}),
}));

import {
  getTargetMapping,
  getSourceField,
  applyCopyFromTargetToSchema,
  getTargetValueForField,
  isFieldLinked,
  isFieldPulled,
  PULL_FROM_KEY,
  installCopyFromTargetEnhancers,
  getTargetId,
  pullLinkedFields,
  COPY_FROM_TARGET_WIDGET,
} from './copyFromTarget';
import { createSchemaEnhancerFromRecipe, convertBlockType } from './blockSync';

// A teaser-like block: `href` is the link/url field carrying the target
// snapshot (selectedItemAttrs), and fieldMappings['@target'] maps target
// content attrs → this block's fields.
const teaserConfig = {
  id: 'teaser',
  fieldMappings: {
    '@target': {
      title: 'title',
      description: 'description',
      head_title: 'head_title',
      image: 'preview_image',
    },
  },
  blockSchema: {
    properties: {
      href: { widget: 'object_browser', mode: 'link' },
      title: { title: 'Title' },
      description: { title: 'Description', widget: 'textarea' },
      head_title: { title: 'Kicker' },
      preview_image: { title: 'Image', widget: 'object_browser', mode: 'image' },
    },
  },
};

const targetSnapshot = {
  '@id': '/news/big',
  title: 'Big News',
  description: 'It happened',
  head_title: 'Breaking',
  image_field: 'image',
  image_scales: { image: [{ download: '/news/big/@@images/x.jpg' }] },
};

const schemaOf = () => ({
  properties: {
    href: { widget: 'object_browser', mode: 'link' },
    title: { title: 'Title' },
    description: { title: 'Description', widget: 'textarea' },
    head_title: { title: 'Kicker' },
    preview_image: { title: 'Image', widget: 'object_browser', mode: 'image' },
  },
});

describe('getTargetMapping', () => {
  it('returns the @target mapping when declared', () => {
    expect(getTargetMapping(teaserConfig)).toEqual(teaserConfig.fieldMappings['@target']);
  });
  it('returns null when there is no @target mapping', () => {
    expect(getTargetMapping({ id: 'slate', fieldMappings: { '@default': { title: 'x' } } })).toBeNull();
    expect(getTargetMapping({ id: 'slate' })).toBeNull();
  });
});

describe('applyCopyFromTargetToSchema — gating + widget swap', () => {
  it('is a no-op for a block without @target mapping', () => {
    const schema = schemaOf();
    const out = applyCopyFromTargetToSchema(schema, { id: 'slate' });
    expect(out.properties.title.widget).toBeUndefined();
  });

  it('swaps each mapped DESTINATION field to the wrapper widget, stashing the original', () => {
    const out = applyCopyFromTargetToSchema(schemaOf(), teaserConfig);
    // Destinations are the mapping *values* (title, description, head_title, preview_image)
    for (const field of ['title', 'description', 'head_title', 'preview_image']) {
      expect(out.properties[field].widget).toBe(COPY_FROM_TARGET_WIDGET);
      // original widget config preserved for faithful re-resolution
      expect(out.properties[field].baseWidget).toBeDefined();
    }
  });

  it('does NOT swap the URL field itself or unmapped fields', () => {
    const out = applyCopyFromTargetToSchema(schemaOf(), teaserConfig);
    expect(out.properties.href.widget).toBe('object_browser'); // url field untouched
  });

  it('is idempotent (re-running does not double-wrap)', () => {
    const once = applyCopyFromTargetToSchema(schemaOf(), teaserConfig);
    const twice = applyCopyFromTargetToSchema(once, teaserConfig);
    expect(twice.properties.title.baseWidget).not.toBe(COPY_FROM_TARGET_WIDGET);
    expect(twice.properties.title.widget).toBe(COPY_FROM_TARGET_WIDGET);
  });
});

describe('getTargetValueForField — typed extraction from the snapshot', () => {
  const data = { href: [targetSnapshot] };
  it('extracts a plain string field', () => {
    expect(getTargetValueForField('title', teaserConfig, data)).toBe('Big News');
    expect(getTargetValueForField('head_title', teaserConfig, data)).toBe('Breaking');
  });
  it('extracts via the source→dest mapping (Description → description)', () => {
    expect(getTargetValueForField('description', teaserConfig, data)).toBe('It happened');
  });
  it('returns undefined for an unmapped field', () => {
    expect(getTargetValueForField('href', teaserConfig, data)).toBeUndefined();
  });
  it('returns undefined when no target is selected', () => {
    expect(getTargetValueForField('title', teaserConfig, { href: [] })).toBeUndefined();
    expect(getTargetValueForField('title', teaserConfig, {})).toBeUndefined();
  });

  it('assembles an image field into the object_browser (mode=image) array form', () => {
    const data = { href: [targetSnapshot] };
    expect(getTargetValueForField('preview_image', teaserConfig, data)).toEqual([
      {
        '@id': '/news/big',
        image_field: 'image',
        image_scales: { image: [{ download: '/news/big/@@images/x.jpg' }] },
      },
    ]);
  });

  it('returns undefined for an image field when the target has no image', () => {
    const noImage = { '@id': '/x', title: 'T' };
    expect(getTargetValueForField('preview_image', teaserConfig, { href: [noImage] })).toBeUndefined();
  });

  // Tags / other multi-value fields: a plain (non-typed) mapping passes the
  // array through as-is; no special handling needed beyond image.
  const tagsConfig = {
    id: 'card',
    fieldMappings: { '@target': { Subjects: 'tags' } },
    blockSchema: {
      properties: {
        href: { widget: 'object_browser', mode: 'link' },
        tags: { title: 'Tags', widget: 'array' },
      },
    },
  };
  it('passes a tags/array field through from the target', () => {
    const data = { href: [{ '@id': '/x', Subjects: ['news', 'plone'] }] };
    expect(getTargetValueForField('tags', tagsConfig, data)).toEqual(['news', 'plone']);
  });
});

describe('live target — divergence/sync against the CURRENT target, not the snapshot', () => {
  it('getTargetId reads the link field @id', () => {
    expect(getTargetId(teaserConfig, { href: [targetSnapshot] })).toBe('/news/big');
    expect(getTargetId(teaserConfig, { href: [] })).toBeUndefined();
  });

  it('getTargetValueForField uses the live target (snapshot-shaped) when provided', () => {
    // Stored snapshot says 'Big News'; the live target has since changed.
    const data = { href: [targetSnapshot] };
    const live = { ...targetSnapshot, title: 'Big News (updated)' };
    expect(getTargetValueForField('title', teaserConfig, data, live)).toBe('Big News (updated)');
    // …and falls back to the stored snapshot when no live target is passed.
    expect(getTargetValueForField('title', teaserConfig, data)).toBe('Big News');
  });

});

// Linked-vs-owned state, the `_pullFrom` record and unpullEditedFields are
// covered in pullFrom.test.js, which is the spec for inka#595.

describe('pullLinkedFields — atomic multi-field pull on link change', () => {
  it('fills EVERY linked mapped field in one write (no per-field clobber)', () => {
    // Setting the link on an empty multi-field block must pull title, description,
    // head_title AND the image together — the regression guard for the race where
    // per-field pulls clobbered all but the last-written field.
    const block = {
      '@type': 'teaser',
      href: [targetSnapshot],
      [PULL_FROM_KEY]: { href: ['title', 'description', 'head_title', 'preview_image'] },
    };
    const out = pullLinkedFields(teaserConfig, block);
    expect(out.title).toBe('Big News');
    expect(out.description).toBe('It happened');
    expect(out.head_title).toBe('Breaking');
    expect(out.preview_image?.[0]?.['@id']).toBe('/news/big');
  });

  it("skips fields the link doesn't own and leaves already-synced ones untouched", () => {
    const block = {
      '@type': 'teaser',
      href: [targetSnapshot],
      title: 'Big News', // already at target
      description: 'my own words', // unlisted → the author's
      [PULL_FROM_KEY]: { href: ['title', 'head_title'] },
    };
    const out = pullLinkedFields(teaserConfig, block);
    expect(out.description).toBe('my own words');
    expect(out.head_title).toBe('Breaking'); // owned, pulled
  });

  it('is a no-op with no target selected', () => {
    const block = { '@type': 'teaser', href: [] };
    expect(pullLinkedFields(teaserConfig, block)).toBe(block);
  });
});

describe('installCopyFromTargetEnhancers — auto-install, gated on @target', () => {
  const makeConfig = () => ({
    teaser: { ...teaserConfig },
    slate: { id: 'slate', blockSchema: { properties: { value: { widget: 'slate' } } } },
  });

  it('attaches an enhancer only to blocks with an @target mapping', () => {
    const cfg = makeConfig();
    installCopyFromTargetEnhancers(cfg);
    expect(typeof cfg.teaser.schemaEnhancer).toBe('function');
    expect(cfg.slate.schemaEnhancer).toBeUndefined(); // no @target → untouched
  });

  it("the installed enhancer swaps the teaser's mapped fields", () => {
    const cfg = makeConfig();
    installCopyFromTargetEnhancers(cfg);
    const out = cfg.teaser.schemaEnhancer({ schema: teaserConfig.blockSchema });
    expect(out.properties.title.widget).toBe(COPY_FROM_TARGET_WIDGET);
  });

  it('is idempotent (re-install does not stack enhancers)', () => {
    const cfg = makeConfig();
    installCopyFromTargetEnhancers(cfg);
    const first = cfg.teaser.schemaEnhancer;
    installCopyFromTargetEnhancers(cfg);
    expect(cfg.teaser.schemaEnhancer).toBe(first);
  });

  it('composes with an existing block schemaEnhancer (runs both)', () => {
    const cfg = makeConfig();
    let ran = false;
    cfg.teaser.schemaEnhancer = ({ schema }) => {
      ran = true;
      return schema;
    };
    installCopyFromTargetEnhancers(cfg);
    const out = cfg.teaser.schemaEnhancer({ schema: teaserConfig.blockSchema });
    expect(ran).toBe(true); // existing enhancer still runs
    expect(out.properties.title.widget).toBe(COPY_FROM_TARGET_WIDGET); // ours too
  });
});

/**
 * copy-from-target × fieldRules (optional target attributes).
 *
 * A card maps the linked/listing item's optional attributes — `image`, `date` —
 * onto its own fields, and those fields are OPTIONAL card elements shown
 * conditionally by a `fieldRules` recipe (the `elements` multiselect pattern).
 * The real chain is: fieldRules (hide the element's field when off) THEN the
 * copy-from-target swap (installCopyFromTargetEnhancers appends it). So a mapped
 * field must be wrapped (toggle + pull) only when its element is enabled, and get
 * NO wrapper when the rule hides it — no orphan "pull from linked" toggle on a
 * field the editor can't see.
 */
describe('copy-from-target × fieldRules — conditional (optional) mapped fields', () => {
  const intl = { formatMessage: (m) => (m && m.defaultMessage) || '' };

  // A card whose `elements` multiselect reveals `image` / `date`. @target pulls
  // both from the linked item (image_scales → image, effective → date) plus the
  // always-shown title.
  const makeCard = () => ({
    id: 'card',
    fieldMappings: {
      '@target': {
        title: 'title',
        effective: 'date',
        image_scales: { field: 'image', type: 'image' },
      },
    },
    // Recipe form, converted to a function BEFORE installCopyFromTargetEnhancers
    // runs (exactly as index.js does), so the two compose.
    schemaEnhancer: createSchemaEnhancerFromRecipe({
      fieldRules: {
        image: { when: { elements: { contains: 'image' } }, else: false },
        date: { when: { elements: { contains: 'date' } }, else: false },
      },
    }),
    blockSchema: {
      fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'elements', 'image', 'date'] }],
      properties: {},
    },
  });

  const baseSchema = () => ({
    fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'elements', 'image', 'date'] }],
    properties: {
      title: { title: 'Title' },
      elements: { title: 'Elements', type: 'array' },
      image: { title: 'Image', widget: 'image' },
      date: { title: 'Date' },
    },
  });

  const composed = (card) => {
    const blocksConfig = { card };
    installCopyFromTargetEnhancers(blocksConfig);
    return blocksConfig.card.schemaEnhancer;
  };

  test('a mapped field hidden by its rule gets NO wrapper (no orphan toggle)', () => {
    const card = makeCard();
    const enhancer = composed(card);
    // No elements enabled → both image and date are hidden by fieldRules.
    const out = enhancer({ schema: baseSchema(), formData: { elements: [] }, intl });
    expect(out.properties.image).toBeUndefined(); // dropped by fieldRules
    expect(out.properties.date).toBeUndefined();
    expect(out.properties.title.widget).toBe(COPY_FROM_TARGET_WIDGET); // always-shown mapped field is wrapped
  });

  test('a mapped field shown by its rule IS wrapped (toggle + pull)', () => {
    const card = makeCard();
    const enhancer = composed(card);
    // Only the image element is on → image shown+wrapped, date still hidden.
    const out = enhancer({ schema: baseSchema(), formData: { elements: ['image'] }, intl });
    expect(out.properties.image).toBeDefined();
    expect(out.properties.image.widget).toBe(COPY_FROM_TARGET_WIDGET);
    expect(out.properties.image.baseWidget.widget).toBe('image'); // original widget preserved for re-resolution
    expect(out.properties.date).toBeUndefined(); // its element is off
    expect(out.properties.title.widget).toBe(COPY_FROM_TARGET_WIDGET);
  });

  test('toggling which element is on moves the wrapper to that field', () => {
    const card = makeCard();
    const enhancer = composed(card);
    const withDate = enhancer({ schema: baseSchema(), formData: { elements: ['date'] }, intl });
    expect(withDate.properties.date?.widget).toBe(COPY_FROM_TARGET_WIDGET);
    expect(withDate.properties.image).toBeUndefined();
  });
});

/**
 * On-by-default: a link-bearing block with a `@default` mapping (but no explicit
 * `@target`) pulls from the link. The synthesized mapping normalizes @default's
 * canonical keys (title/description/image) to the link snapshot's brain keys
 * (Title/Description/image_scales); `@id` (the link itself) is not pulled.
 */
describe('copy-from-target — on by default via @default (link-bearing blocks)', () => {
  const linkCard = {
    id: 'linkcard',
    fieldMappings: {
      '@default': {
        '@id': 'href',
        title: 'heading',
        description: 'summary',
        image: 'picture',
      },
    },
    blockSchema: {
      properties: {
        href: { title: 'Link', widget: 'object_browser', mode: 'link' },
        heading: { title: 'Heading' },
        summary: { title: 'Summary' },
        picture: { title: 'Picture', widget: 'object_browser', mode: 'image' },
      },
    },
  };

  it('synthesizes a @target from @default (canonical → snapshot keys, @id skipped)', () => {
    const m = getTargetMapping(linkCard);
    expect(m).toEqual({
      title: 'heading',
      description: 'summary',
      image: 'picture',
    });
    // @id → href is the link itself, not pulled
    expect(m['@id']).toBeUndefined();
  });

  it('a block with @default but NO link field is not default-on', () => {
    const noLink = {
      id: 'x',
      fieldMappings: { '@default': { title: 'heading' } },
      blockSchema: { properties: { heading: { title: 'Heading' } } },
    };
    expect(getTargetMapping(noLink)).toBeNull();
  });

  it('reads a schema FUNCTION as well as an object (a built-in block\'s)', () => {
    // An admin block's schema is often a function of the block's data (Volto's
    // teaser, image). Read only as an object, its link field was invisible and
    // copy-from-target silently off for exactly those blocks.
    const fnCard = {
      ...linkCard,
      blockSchema: ({ intl }) => ({
        properties: { ...linkCard.blockSchema.properties, heading: { title: intl.formatMessage({ defaultMessage: 'Heading' }) } },
      }),
    };
    expect(getSourceField(fnCard)).toBe('href');
    expect(getTargetMapping(fnCard)).toEqual({ title: 'heading', description: 'summary', image: 'picture' });
  });

  it('a block-type conversion drops the record, so nothing it filled is pulled over', () => {
    // Converting a hero to a link card writes the hero's heading into the
    // card's heading. That is the author's text; the link's title must not
    // replace it the next time the page is opened. The source's own record is
    // dropped: it names the HERO's field names, which mean nothing here.
    const blocksConfig = {
      linkcard: linkCard,
      hero: {
        id: 'hero',
        fieldMappings: { '@default': { title: 'headline', '@id': 'link' } },
        blockSchema: { properties: { headline: { title: 'Headline' }, link: { title: 'Link', widget: 'url' } } },
      },
    };
    const out = convertBlockType(
      {
        '@type': 'hero',
        headline: 'Welcome',
        link: [{ '@id': '/target', Title: 'Target Page' }],
        [PULL_FROM_KEY]: { link: ['headline'] },
      },
      'linkcard',
      blocksConfig,
    );
    expect(out.heading).toBe('Welcome');
    expect(out[PULL_FROM_KEY]).toBeUndefined();
    expect(isFieldPulled('heading', out)).toBe(false);
  });

  it('an explicit @target still wins over @default', () => {
    const both = { ...linkCard, fieldMappings: { ...linkCard.fieldMappings, '@target': { title: 'heading' } } };
    expect(getTargetMapping(both)).toEqual({ title: 'heading' });
  });

  it('pulls the target value through the synthesized mapping', () => {
    const blockData = {
      href: [{ '@id': '/p', title: 'Live Title', description: 'Live Desc' }],
    };
    expect(getTargetValueForField('heading', linkCard, blockData)).toBe('Live Title');
    expect(getTargetValueForField('summary', linkCard, blockData)).toBe('Live Desc');
  });

  // @default is pass-through, NOT an allowlist of title/description/image: any
  // declared field flows (tags via `Subject`, dates via `created`/`effective`),
  // reading its own snapshot key. Only `image` is special-cased and `@id` skipped.
  const richCard = {
    id: 'richcard',
    fieldMappings: {
      '@default': {
        '@id': 'href',
        title: 'heading',
        image: 'picture',
        Subject: 'tags',
        created: 'createdOn',
        effective: 'publishedOn',
      },
    },
    blockSchema: {
      properties: {
        href: { title: 'Link', widget: 'object_browser', mode: 'link' },
        heading: { title: 'Heading' },
        picture: { title: 'Picture', widget: 'object_browser', mode: 'image' },
        tags: { title: 'Tags', widget: 'array' },
        createdOn: { title: 'Created', widget: 'date' },
        publishedOn: { title: 'Published', widget: 'date' },
      },
    },
  };

  it('passes tags and dates through @default (not just title/description/image)', () => {
    const m = getTargetMapping(richCard);
    // plain source keys map straight through to their dest field
    expect(m.Subject).toBe('tags');
    expect(m.created).toBe('createdOn');
    expect(m.effective).toBe('publishedOn');
    // image passes through verbatim (type derived from the dest widget); @id skipped
    expect(m.image).toBe('picture');
    expect(m['@id']).toBeUndefined();
  });

  it('pulls tags (Subject) and dates (created/effective) from the snapshot', () => {
    const blockData = {
      href: [{
        '@id': '/p',
        title: 'Live Title',
        Subject: ['news', 'plone'],
        created: '2025-01-01T12:00:00+00:00',
        effective: '2025-02-02T09:00:00+00:00',
      }],
    };
    expect(getTargetValueForField('tags', richCard, blockData)).toEqual(['news', 'plone']);
    expect(getTargetValueForField('createdOn', richCard, blockData)).toBe('2025-01-01T12:00:00+00:00');
    expect(getTargetValueForField('publishedOn', richCard, blockData)).toBe('2025-02-02T09:00:00+00:00');
  });
});
