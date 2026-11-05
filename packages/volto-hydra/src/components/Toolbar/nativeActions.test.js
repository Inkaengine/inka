import { describe, it, expect } from 'vitest';
import { nativeActionsFrom, nativeActionForPanel } from './nativeActions';

/**
 * The shape here is Plone's, because that is what the admin's store holds by
 * the time it reaches this: `url` for the destination and `site_actions` for
 * the site category. Both were wrong for a while — the code read `@id` and
 * `site` — and nothing caught it because this file had no tests and the mock
 * had been written to agree with the adapter rather than with Plone.
 */
describe('nativeActionsFrom', () => {
  it('reads the destination from url, as Plone emits it', () => {
    const found = nativeActionsFrom({
      object: [
        { id: 'edit', title: 'Edit in WordPress', url: 'http://cms/edit', native: true },
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].url).toBe('http://cms/edit');
  });

  it('finds entries in site_actions', () => {
    const found = nativeActionsFrom({
      site_actions: [
        { id: 'wp-settings', title: 'Site settings', url: 'http://cms/opts', native: true },
      ],
    });
    expect(found.map((a) => a.id)).toEqual(['wp-settings']);
  });

  it('ignores an entry with no destination', () => {
    // Volto's own screens come through as actions too; they are permission
    // flags, not links, and rendering one as a link would send the user
    // nowhere.
    expect(
      nativeActionsFrom({ object: [{ id: 'edit', title: 'Edit', native: true }] }),
    ).toEqual([]);
  });

  it('ignores a destination that is not marked native', () => {
    expect(
      nativeActionsFrom({ object: [{ id: 'view', title: 'View', url: 'http://cms/' }] }),
    ).toEqual([]);
  });
});

describe('nativeActionForPanel', () => {
  // Volto has its own Site Setup and Profile screens. Against a CMS that is not
  // Plone they would call endpoints that do not exist, so the adapter offers its
  // own screen instead — but "the site category" is not enough to find it:
  // WordPress declares TWO site actions (settings and the media library), and
  // picking the first would be a coin flip. The adapter says which one answers
  // a known screen.
  const store = {
    object: [{ id: 'edit', title: 'Edit' }],
    site_actions: [
      { id: 'wp-media', title: 'Media library', url: 'http://cms/wp-admin/upload.php', native: true },
      {
        id: 'wp-settings',
        title: 'Site settings',
        url: 'http://cms/wp-admin/options-general.php',
        native: true,
        panel: 'site-setup',
      },
    ],
    user: [
      {
        id: 'preferences',
        title: 'Your profile',
        url: 'http://cms/wp-admin/profile.php',
        native: true,
        panel: 'profile',
      },
    ],
  };

  it('finds the action the adapter marked as answering a screen', () => {
    expect(nativeActionForPanel(store, 'site-setup').id).toBe('wp-settings');
    expect(nativeActionForPanel(store, 'profile').id).toBe('preferences');
  });

  it('says nothing when the CMS offers no such screen', () => {
    // Plone: Volto's own screens work against it, so it declares none and the
    // admin keeps its own link. An empty answer here is the signal for that.
    expect(nativeActionForPanel({ object: [], site_actions: [], user: [] }, 'site-setup')).toBeNull();
    expect(nativeActionForPanel(undefined, 'profile')).toBeNull();
  });

  it('ignores a marked action with nowhere to go', () => {
    // A permission flag carries no url; rendering it as a link sends the editor
    // nowhere, which is worse than showing Volto's own screen.
    const flagged = { site_actions: [{ id: 'x', title: 'X', panel: 'site-setup' }] };
    expect(nativeActionForPanel(flagged, 'site-setup')).toBeNull();
  });
});
