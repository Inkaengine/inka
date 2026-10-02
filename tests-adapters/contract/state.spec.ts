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

const PATH = '/about';

const advertises = (capability: string) =>
  target.adapter.capabilities.includes(capability as never);

/**
 * The state menu, and what each entry asks for before it fires.
 *
 * Split across two intents on purpose. `state.get` is on the hot path — Plone's
 * `@actions` maps to it and the admin requests that on every content view — so
 * it stays cheap: ids and labels. `state.getForms` is fetched once when the
 * menu opens, and returns every transition's form together because the
 * expensive part, the current grants, is shared between them.
 */
describe('state.get', () => {
  it('returns the canonical shape', async () => {
    if (!advertises('state')) return;
    const pas: any = await target.adapter.dispatch('state.get', { path: PATH });

    expect(typeof pas.state.name).toBe('string');
    expect(pas.state.name.length).toBeGreaterThan(0);
    expect(typeof pas.state.label).toBe('string');

    expect(Array.isArray(pas.transitions)).toBe(true);
    const ids = new Set<string>();
    for (const t of pas.transitions) {
      expect(typeof t.id).toBe('string');
      expect(t.id.length).toBeGreaterThan(0);
      expect(typeof t.label).toBe('string');
      // Optional: Plone's @workflow names no destination. See
      // tests-adapters/fixtures/plone/README.md.
      if (t.targetState !== undefined) expect(typeof t.targetState).toBe('string');
      // Ids address the entry; a duplicate silently overrides its twin.
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }

    for (const flag of ['canEdit', 'canPublish', 'canDelete', 'canShare']) {
      expect(typeof pas.effective[flag]).toBe('boolean');
    }
  });

  it('does not offer a transition it says the user cannot make', async () => {
    if (!advertises('state')) return;
    const pas: any = await target.adapter.dispatch('state.get', { path: PATH });

    // The suite runs as an administrator, so this is not a vacuous pass: it
    // catches `effective` being derived from the wrong place — hardcoded, or
    // read from a response key that does not exist — in either direction. A
    // false canPublish beside a Publish transition disables the button the
    // menu is offering; a true one puts a button in front of a Contributor
    // that the CMS then refuses.
    const publishes = pas.transitions.filter((t: any) =>
      ['published', 'public'].includes(t.targetState),
    );
    if (publishes.length) expect(pas.effective.canPublish).toBe(true);
  });

  it('offers a transition that actually moves the document', async () => {
    if (!advertises('state')) return;
    const before: any = await target.adapter.dispatch('state.get', { path: PATH });
    const move = before.transitions[0];
    // A document with nowhere to go is a legitimate state, but not for the
    // seed's /about — if this is empty the adapter is not reading permissions.
    expect(move).toBeDefined();

    await target.adapter.dispatch('state.transition', {
      path: PATH,
      id: move.id,
    });

    const after: any = await target.adapter.dispatch('state.get', { path: PATH });
    if (move.targetState !== undefined) {
      expect(after.state.name).toBe(move.targetState);
    } else {
      // Still must MOVE. An adapter that cannot name the destination is not
      // excused from reaching one.
      expect(after.state.name).not.toBe(before.state.name);
    }
  });

  it('rejects cleanly where the capability is absent', async () => {
    if (advertises('state')) return;
    await expect(
      target.adapter.dispatch('state.get', { path: PATH }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});

describe('state.getForms', () => {
  it('answers for every transition state.get offered', async () => {
    if (!advertises('state')) return;
    const pas: any = await target.adapter.dispatch('state.get', { path: PATH });
    const forms: any = await target.adapter.dispatch('state.getForms', {
      path: PATH,
    });

    for (const t of pas.transitions) {
      // A transition the menu can show but not open is a dead entry.
      expect(forms[t.id]).toBeDefined();
    }
  });

  it('returns a renderable schema and its current values', async () => {
    if (!advertises('state')) return;
    const forms: any = await target.adapter.dispatch('state.getForms', {
      path: PATH,
    });

    for (const [id, form] of Object.entries<any>(forms)) {
      expect(Array.isArray(form.schema.fieldsets), `${id} fieldsets`).toBe(true);
      expect(typeof form.schema.properties, `${id} properties`).toBe('object');
      expect(Array.isArray(form.schema.required), `${id} required`).toBe(true);
      expect(typeof form.data, `${id} data`).toBe('object');

      // Every fieldset's fields must exist as properties, or the renderer
      // draws a legend over nothing.
      for (const fieldset of form.schema.fieldsets) {
        for (const field of fieldset.fields) {
          expect(form.schema.properties[field], `${id}.${field}`).toBeDefined();
        }
      }

      // Values the schema cannot describe cannot be rendered or sent back.
      for (const key of Object.keys(form.data)) {
        expect(form.schema.properties[key], `${id} data key ${key}`).toBeDefined();
      }
    }
  });

  it('puts principal fields in the stay-here form exactly where grants exist', async () => {
    if (!advertises('state')) return;
    const forms: any = await target.adapter.dispatch('state.getForms', {
      path: PATH,
    });
    const pas: any = await target.adapter.dispatch('state.get', { path: PATH });

    // The stay-here entry is not a sharing entry. It is for the state the
    // document is already in, so any CMS with something changeable in place
    // may offer one — Drupal has an address to edit and no per-document grants
    // at all. What is gated is the PEOPLE half.
    const update = forms.update;
    if (!update) return;

    const principalFields = Object.entries<any>(update.schema.properties).filter(
      ([, p]) => p.vocabulary === 'principals',
    );

    if (!advertises('per-content-permissions') || !pas.effective.canShare) {
      // Not a shortcoming to paper over: a CMS whose permissions are site-wide
      // has nothing to put here, and an empty people list would read as
      // "nobody has access" rather than "not answered here".
      expect(principalFields).toEqual([]);
      return;
    }

    // One field per role, not a permission matrix.
    expect(principalFields.length).toBeGreaterThan(0);
    for (const [name, prop] of principalFields) {
      expect(typeof prop.title, `${name}.title`).toBe('string');
      // The description is what makes a role name mean something — "will be
      // able to update when published" — and no CMS volunteers it.
      expect(typeof prop.description, `${name}.description`).toBe('string');
      expect(prop.description.length).toBeGreaterThan(0);
    }
  });

  it('rejects cleanly where the capability is absent', async () => {
    if (advertises('state')) return;
    await expect(
      target.adapter.dispatch('state.getForms', { path: PATH }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});

/**
 * Taking a transition, carrying its form's answers.
 *
 * This has to work with no content edit involved. The state menu is in view
 * mode as well as edit mode, so publishing must not require going through a
 * save — `state.transition` is the standalone carrier, and `content.update`
 * the one used when there IS a body to save at the same time.
 */
describe('state.transition with data', () => {
  it('accepts the values its own form asked for', async () => {
    if (!advertises('state')) return;
    const forms: any = await target.adapter.dispatch('state.getForms', {
      path: PATH,
    });
    const [id, form] =
      Object.entries<any>(forms).find(
        ([, f]) => Object.keys(f.schema.properties).length > 0,
      ) ?? [];
    if (!id) return; // nothing this CMS asks for; covered by the plain case

    await target.adapter.dispatch('state.transition', {
      path: PATH,
      id,
      data: form.data,
    });

    const after: any = await target.adapter.dispatch('state.get', { path: PATH });
    expect(typeof after.state.name).toBe('string');
  });

  it('a transition that relocates the session says where, and it resolves', async () => {
    if (!advertises('state')) return;
    const pas: any = await target.adapter.dispatch('state.get', { path: PATH });
    const move = pas.transitions.find((t: any) => t.relocates);
    if (!move) return; // this CMS has nothing that moves you

    const result: any = await target.adapter.dispatch('state.transition', {
      path: PATH,
      id: move.id,
    });

    // Declaring `relocates` and then not saying where would leave the editor
    // looking at the version they did not choose to work on.
    expect(result?.redirect).toBeTruthy();
    expect(result.redirect).not.toBe(PATH);
    // And it has to be somewhere that exists.
    await target.adapter.dispatch('content.get', { path: result.redirect });
  });

  it('refuses a field its form did not declare', async () => {
    if (!advertises('state')) return;
    const pas: any = await target.adapter.dispatch('state.get', { path: PATH });
    const move = pas.transitions[0];
    if (!move) return;

    // Silently dropping it is the failure mode worth preventing: the dialog
    // would report success for a setting that never took, and nobody finds
    // out until the wrong audience sees the document.
    await expect(
      target.adapter.dispatch('state.transition', {
        path: PATH,
        id: move.id,
        data: { notAFieldAnyoneDeclared: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

/**
 * Screens the CMS answers for itself.
 *
 * Volto has its own Profile and Site Setup. Against a CMS that is not Plone
 * they would call endpoints that do not exist, so an adapter may declare an
 * action that answers one of those screens instead, marked with `panel`.
 *
 * The mark is what the toolbar looks for, and it is only useful if it is
 * honest: a panel with no destination is a dead link where a working screen
 * used to be, and two actions claiming the same panel means the toolbar picks
 * by position — the coin flip the mark exists to avoid.
 */
describe('native screens', () => {
  const PANELS = ['profile', 'site-setup'];

  it('marks at most one action per screen, and each has somewhere to go', async () => {
    if (!advertises('state')) return;
    const pas: any = await target.adapter.dispatch('state.get', { path: PATH });
    const declared = (pas.actions ?? []).filter((a: any) => a.panel);

    for (const action of declared) {
      expect(
        PANELS,
        `${action.id} claims an unknown screen '${action.panel}'`,
      ).toContain(action.panel);
      expect(
        typeof action.url === 'string' && action.url.length > 0,
        `${action.id} claims '${action.panel}' with no url`,
      ).toBe(true);
    }

    const claimed = declared.map((a: any) => a.panel);
    expect(
      claimed.length,
      `two actions claim the same screen: ${claimed.join(', ')}`,
    ).toBe(new Set(claimed).size);
  });
});
