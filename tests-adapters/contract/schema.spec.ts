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

describe('types.list', () => {
  it('includes the types the seed content uses', async () => {
    const res: any = await target.adapter.dispatch('types.list', {});
    const ids = res.items.map((t: any) => t.id);
    expect(ids).toContain(target.types.page);
  });

  it('gives every type an id and a title', async () => {
    const res: any = await target.adapter.dispatch('types.list', {});
    expect(res.items.length).toBeGreaterThan(0);
    for (const t of res.items) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.title).toBe('string');
    }
  });
});

describe('types.getSchema', () => {
  /**
   * Whatever the admin offers in "add", adding it must work HERE.
   *
   * types.list is asked per context — Volto requests /news/@types to mean
   * "what can be created in this folder" — and the WordPress adapter answered
   * with every registered type, `post` first. A post is non-hierarchical, so
   * creating one "inside" /news produced a document that simply was not there,
   * and the journey's add step hung waiting for a URL that never came.
   *
   * Creating the FIRST addable type is exactly what the admin's add menu does,
   * which is why this catches what listing-shape assertions did not.
   */
  it('only advertises types that can be created in that context', async () => {
    const res: any = await target.adapter.dispatch('types.list', {
      path: '/news',
    });
    const addable = res.items.filter((t: any) => t.addable !== false);
    expect(addable.length).toBeGreaterThan(0);

    const created: any = await target.adapter.dispatch('content.create', {
      parentPath: '/news',
      data: { type: addable[0].id, title: 'Addable probe' },
    });
    expect(created.path.startsWith('/news/')).toBe(true);
  });

  it('returns the canonical Schema shape', async () => {
    const schema: any = await target.adapter.dispatch('types.getSchema', {
      type: target.types.page,
    });
    expect(Array.isArray(schema.fieldsets)).toBe(true);
    expect(typeof schema.properties).toBe('object');
    expect(Array.isArray(schema.required)).toBe(true);
  });

  it('exposes title as a property listed in a fieldset', async () => {
    const schema: any = await target.adapter.dispatch('types.getSchema', {
      type: target.types.page,
    });
    expect(schema.properties.title).toBeDefined();
    const allFields = schema.fieldsets.flatMap((f: any) => f.fields);
    expect(allFields).toContain('title');
  });

  /**
   * A text field must be described as text, not as the CMS's wire shape.
   *
   * WordPress describes editable text as an object with raw/rendered members,
   * and its adapter passed that through untouched. The admin cannot read it,
   * so it rendered the page TITLE as a file-upload input — the add form served
   * a file picker where the title belonged, and no page could be created. The
   * old assertions passed throughout: title existed and sat in a fieldset.
   * Existing is not the same as being usable.
   *
   * Deliberately narrow. Asserting a whole canonical type vocabulary also
   * fails Plone's 'dict' (which Volto renders natively) and Drupal's
   * 'string_long', and settling what that vocabulary should be is a spec
   * decision, not something to decide inside a test.
   */
  it('describes title as text, not as a CMS wire shape', async () => {
    const schema: any = await target.adapter.dispatch('types.getSchema', {
      type: target.types.page,
    });

    expect(schema.properties.title.type).toBe('string');

    for (const [name, field] of Object.entries<any>(schema.properties)) {
      expect(
        field.type === 'object' && field.properties?.raw !== undefined,
        `field '${name}' is exposed as a raw/rendered object; the admin turns ` +
          `that into a file input rather than a text field`,
      ).toBe(false);
    }
  });

  it('rejects an unknown type with NOT_FOUND', async () => {
    await expect(
      target.adapter.dispatch('types.getSchema', { type: 'NoSuchType' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
