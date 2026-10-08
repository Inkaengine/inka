import { describe, it, expect } from 'vitest';
import { menuEntriesFrom } from './menuEntries';

const forms = {
  publish: { schema: { fieldsets: [], properties: { comment: {} }, required: [] }, data: {} },
  retract: { schema: { fieldsets: [], properties: {}, required: [] }, data: {} },
  update: {
    schema: { fieldsets: [], properties: { Reader: { vocabulary: 'principals' } }, required: [] },
    data: { Reader: ['alice'] },
  },
};

describe('menuEntriesFrom', () => {
  it('lists a transition per available move, with its form attached', () => {
    const entries = menuEntriesFrom(
      { state: { name: 'private' }, transitions: [{ id: 'publish', label: 'Publish' }] },
      forms,
    );
    expect(entries.map((e) => e.id)).toEqual(['publish', 'update']);
    expect(entries[0].schema.properties.comment).toBeDefined();
  });

  it('drops a transition that leads where we already are', () => {
    // The design's rule: choosing the current state does nothing, so offering
    // it invites a click that cannot have an effect.
    const entries = menuEntriesFrom(
      {
        state: { name: 'published' },
        transitions: [
          { id: 'publish', label: 'Publish', targetState: 'published' },
          { id: 'retract', label: 'Retract', targetState: 'private' },
        ],
      },
      forms,
    );
    expect(entries.map((e) => e.id)).toEqual(['retract', 'update']);
  });

  it('keeps a transition that cannot say where it leads', () => {
    // Plone names no destination. Dropping those would empty its menu.
    const entries = menuEntriesFrom(
      { state: { name: 'private' }, transitions: [{ id: 'publish', label: 'Publish' }] },
      forms,
    );
    expect(entries.map((e) => e.id)).toContain('publish');
  });

  it('offers the stay-here entry separately, and only when the CMS has it', () => {
    const withUpdate = menuEntriesFrom(
      { state: { name: 'x', label: 'Published' }, transitions: [] },
      forms,
    );
    expect(withUpdate.map((e) => e.kind)).toEqual(['update']);
    // Named for the state it keeps you in, so it reads as "change something
    // else" rather than as a transition that does nothing.
    expect(withUpdate[0].label).toContain('Published');

    const without = menuEntriesFrom({ state: { name: 'x' }, transitions: [] }, { publish: forms.publish });
    expect(without).toEqual([]);
  });

  it('says which entries will ask something before they fire', () => {
    // Drives the dialog: an entry with nothing to ask is a sentence and a
    // confirm, not an empty form.
    const entries = menuEntriesFrom(
      {
        state: { name: 'private' },
        transitions: [
          { id: 'publish', label: 'Publish' },
          { id: 'retract', label: 'Retract' },
        ],
      },
      forms,
    );
    expect(entries.find((e) => e.id === 'publish').asks).toBe(true);
    expect(entries.find((e) => e.id === 'retract').asks).toBe(false);
  });

  it('carries whether committing will move the editor elsewhere', () => {
    // Checking out a copy puts the draft at another path. The dialog has to say
    // so before it happens rather than leave it to be discovered.
    const entries = menuEntriesFrom(
      {
        state: { name: 'published' },
        transitions: [
          { id: 'checkout', label: 'Work on a draft copy', relocates: true },
          { id: 'retract', label: 'Retract' },
        ],
      },
      forms,
    );
    expect(entries.find((e) => e.id === 'checkout').relocates).toBe(true);
    expect(entries.find((e) => e.id === 'retract').relocates).toBe(false);
  });

  it('survives a transition the adapter offered no form for', () => {
    const entries = menuEntriesFrom(
      { state: { name: 'private' }, transitions: [{ id: 'mystery', label: 'Mystery' }] },
      forms,
    );
    expect(entries.find((e) => e.id === 'mystery').asks).toBe(false);
  });
});
