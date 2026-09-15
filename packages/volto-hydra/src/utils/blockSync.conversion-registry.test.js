/**
 * Registry-wide conversion validation.
 *
 * validateFieldMappings() only ever inspected ONE block at a time, so the two
 * failure modes that actually bite are both invisible to it:
 *
 *   1. NO block in the registry declares fieldMappings. Every call to
 *      getConvertibleTypes() then returns [], the block-type dropdown is empty
 *      everywhere, and nothing warns — the feature is simply absent. This was
 *      the real state of the pretagov-site registry.
 *
 *   2. Two blocks have the SAME SHAPE (same field names + widgets) but no
 *      common conversion target, so an author who builds the wrong one has no
 *      way across. Reachability is transitive: a shared hub satisfies this,
 *      an edge between the two is not required.
 */
import { describe, it, expect, vi } from 'vitest';

// blockSync.js pulls in the React context barrel (JSX in a .js file, which
// vite won't parse). validateConversionRegistry is pure, so stub it out.
vi.mock('../context/index.js', () => ({
  getHydraSchemaContext: () => null,
  setHydraSchemaContext: () => {},
  getLiveBlockData: () => null,
}));

import { validateConversionRegistry } from './blockSync.js';

/** A block whose shape is an object_list of {title, description} items. */
const listOfCards = (extra = {}) => ({
  blockSchema: {
    properties: {
      items: {
        widget: 'object_list',
        idField: '@id',
        schema: {
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
    },
  },
  ...extra,
});

describe('validateConversionRegistry', () => {
  describe('rule 1: the registry must declare some mappings', () => {
    it('fails when no block declares fieldMappings', () => {
      const problems = validateConversionRegistry({
        features: listOfCards(),
        process: listOfCards(),
      });
      expect(problems).toHaveLength(1);
      expect(problems[0].rule).toBe('no-mappings');
      expect(problems[0].message).toMatch(/no block declares fieldMappings/i);
    });

    it('passes rule 1 as soon as one block declares fieldMappings', () => {
      const problems = validateConversionRegistry({
        features: listOfCards({ fieldMappings: { process: { items: 'items' } } }),
        process: listOfCards({ fieldMappings: { features: { items: 'items' } } }),
      });
      expect(problems.filter(p => p.rule === 'no-mappings')).toEqual([]);
    });

    it('does not fail vacuously on an empty registry', () => {
      // An empty registry is a caller error, not a mapping error. Say so
      // rather than reporting "no block declares fieldMappings".
      expect(() => validateConversionRegistry({})).toThrow(/empty/i);
    });
  });

  describe('rule 2: same-shape blocks need a common target', () => {
    it('fails when two same-shape blocks share no reachable target', () => {
      const problems = validateConversionRegistry({
        features: listOfCards({ fieldMappings: { teaser: { items: 'items' } } }),
        process: listOfCards(),   // no mappings at all → reaches nothing
        teaser: { blockSchema: { properties: { title: { type: 'string' } } } },
      });
      const shape = problems.filter(p => p.rule === 'unreachable-shape');
      expect(shape).toHaveLength(1);
      expect(shape[0].types.sort()).toEqual(['features', 'process']);
    });

    it('passes when the two convert directly to each other', () => {
      const problems = validateConversionRegistry({
        features: listOfCards({ fieldMappings: { process: { items: 'items' } } }),
        process: listOfCards({ fieldMappings: { features: { items: 'items' } } }),
      });
      expect(problems.filter(p => p.rule === 'unreachable-shape')).toEqual([]);
    });

    it('passes when both reach a common hub — reachability is transitive', () => {
      // features → hub ← process. No features↔process edge exists, and the
      // user was explicit that none is required: "you only need to convert to
      // one. its transitive."
      const problems = validateConversionRegistry({
        features: listOfCards({ fieldMappings: { hub: { items: 'items' } } }),
        process: listOfCards({ fieldMappings: { hub: { items: 'items' } } }),
        hub: listOfCards({ fieldMappings: { features: { items: 'items' } } }),
      });
      expect(problems.filter(p => p.rule === 'unreachable-shape')).toEqual([]);
    });

    it('ignores blocks of different shapes', () => {
      const problems = validateConversionRegistry({
        features: listOfCards({ fieldMappings: { x: {} } }),
        quote: { blockSchema: { properties: { text: { type: 'string' } } } },
      });
      expect(problems.filter(p => p.rule === 'unreachable-shape')).toEqual([]);
    });

    it('ignores blocks with no schema — shape is unknown, not equal', () => {
      const problems = validateConversionRegistry({
        features: listOfCards({ fieldMappings: { x: {} } }),
        mystery1: {},
        mystery2: {},
      });
      expect(problems.filter(p => p.rule === 'unreachable-shape')).toEqual([]);
    });
  });

  describe('rule 4: listing-item-shaped blocks need an @default mapping', () => {
    // A block whose own fields are a content item's fields — title, description,
    // image, a link — IS a rendering of a search result, whether or not anyone
    // wired it up. Without fieldMappings['@default'] it can never be produced
    // from a listing, so an author cannot point a listing at it.
    it('fails when a listing-item-shaped block has no @default mapping', () => {
      const problems = validateConversionRegistry({
        promoCard: {
          blockSchema: {
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              image: { widget: 'object_browser' },
            },
          },
        },
        teaser: {
          fieldMappings: { '@default': { title: 'title', description: 'description' } },
          blockSchema: { properties: { heading: { type: 'string' } } },
        },
      });
      const bad = problems.filter(p => p.rule === 'missing-default');
      expect(bad).toHaveLength(1);
      expect(bad[0].types).toEqual(['promoCard']);
      expect(bad[0].message).toMatch(/@default/);
    });

    it('passes when the listing-item-shaped block declares @default', () => {
      const problems = validateConversionRegistry({
        promoCard: {
          fieldMappings: { '@default': { title: 'title', description: 'description' } },
          blockSchema: {
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              image: { widget: 'object_browser' },
            },
          },
        },
      });
      expect(problems.filter(p => p.rule === 'missing-default')).toEqual([]);
    });

    it('ignores blocks that merely have a title', () => {
      // One canonical field is a coincidence, not a listing item — a section
      // heading has a title and is nothing like a search result.
      const problems = validateConversionRegistry({
        sectionHeading: {
          blockSchema: { properties: { title: { type: 'string' }, align: { type: 'string' } } },
        },
        teaser: {
          fieldMappings: { '@default': { title: 'title' } },
          blockSchema: { properties: { heading: { type: 'string' } } },
        },
      });
      expect(problems.filter(p => p.rule === 'missing-default')).toEqual([]);
    });

    it('ignores a container block\'s own heading', () => {
      // Nearly every container block has a `title` + `description` heading of
      // its own (team, form, testimonials…). That pair is a HEADING, not an
      // item — what makes something an item is a link, image or date tying it
      // to a content object. Matching on title+description alone flagged the
      // form block as a search result, which it plainly is not.
      const problems = validateConversionRegistry({
        contactForm: {
          blockSchema: {
            properties: {
              title: { type: 'string' },
              description: { widget: 'textarea' },
              subblocks: { widget: 'object_list' },
              submit_label: { type: 'string' },
            },
          },
        },
        teaser: {
          fieldMappings: { '@default': { title: 'title' } },
          blockSchema: { properties: { heading: { type: 'string' } } },
        },
      });
      expect(problems.filter(p => p.rule === 'missing-default')).toEqual([]);
    });

    it('looks through an object_list at the ITEM shape', () => {
      // features/process/testimonials hold listing-item-shaped items in an
      // object_list. Those are the blocks a listing should be able to feed.
      const problems = validateConversionRegistry({
        cards: {
          blockSchema: {
            properties: {
              items: {
                widget: 'object_list',
                idField: '@id',
                schema: {
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    image: { widget: 'object_browser' },
                  },
                },
              },
            },
          },
        },
        teaser: {
          fieldMappings: { '@default': { title: 'title' } },
          blockSchema: { properties: { heading: { type: 'string' } } },
        },
      });
      const bad = problems.filter(p => p.rule === 'missing-default');
      expect(bad).toHaveLength(1);
      expect(bad[0].types).toEqual(['cards']);
    });
  });

  describe('rule 3: a mapping must name things that exist', () => {
    it('fails when a mapping names an unknown block type', () => {
      const problems = validateConversionRegistry({
        features: listOfCards({ fieldMappings: { procces: { items: 'items' } } }),
      });
      const bad = problems.filter(p => p.rule === 'unknown-target');
      expect(bad).toHaveLength(1);
      expect(bad[0].message).toMatch(/procces/);
    });

    it('does not treat @default as an unknown block type', () => {
      const problems = validateConversionRegistry({
        features: listOfCards({ fieldMappings: { '@default': { title: 'title' } } }),
      });
      expect(problems.filter(p => p.rule === 'unknown-target')).toEqual([]);
    });
  });
});
