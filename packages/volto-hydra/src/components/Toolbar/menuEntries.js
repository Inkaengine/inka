/**
 * The state menu's entries: one list of things that change what this document
 * is and who can reach it.
 *
 * Named to not collide with StateMenu.jsx. It was `stateMenu.js`, which differs
 * from the component only by case — fine on Linux, and on macOS webpack
 * resolved `./StateMenu` to THIS file, because .js is tried before .jsx. The
 * component then had no default export and the build broke in a way that named
 * neither file as the problem.
 *
 * Plone keeps workflow, sharing and working copies in three separate screens.
 * They answer one question — who can do what, when — so they are one list here,
 * and every entry opens a dialog that says what it will do before it does it.
 *
 * Pure, so the rules below are testable without mounting a toolbar.
 */

/**
 * Staying where you are, and changing anything else that matters here.
 *
 * Reserved id in the contract. It was called `access` and offered only
 * permissions, which was too narrow: it is the entry for the state the
 * document is ALREADY in, so it carries whatever matters in that state — who
 * can reach it, what it is called, whether it is listed, when it expires. An
 * already-published document has no publish transition, so without this there
 * is nowhere to change any of that.
 */
export const UPDATE_ID = 'update';

/**
 * @param {object} pas - PermissionsAndState from `state.get`
 * @param {object} forms - TransitionForms from `state.getForms`
 */
export function menuEntriesFrom(pas, forms) {
  const current = pas?.state?.name;

  const entries = (pas?.transitions ?? [])
    // A transition to where we already are cannot have an effect, so offering
    // it invites a click that does nothing. Kept when the adapter cannot say
    // where it leads — Plone's @workflow names no destination, and dropping
    // those would empty its menu entirely.
    .filter((t) => t.targetState === undefined || t.targetState !== current)
    .map((t) => ({
      ...entry(t.id, t.label, 'transition', forms),
      // Whether committing ends with the editor somewhere else. The dialog
      // says so first.
      relocates: Boolean(t.relocates),
    }));

  if (forms?.[UPDATE_ID]) {
    // Named for the state it keeps you in, so it cannot be misread as a
    // transition that does nothing.
    const label = pas?.state?.label
      ? `Update — stays ${pas.state.label}`
      : 'Update';
    entries.push(entry(UPDATE_ID, label, 'update', forms));
  }

  return entries;
}

function entry(id, label, kind, forms) {
  const form = forms?.[id];
  const properties = form?.schema?.properties ?? {};
  return {
    id,
    label,
    kind,
    schema: form?.schema ?? null,
    data: form?.data ?? {},
    // Nothing to ask means the dialog is a sentence and a confirm rather than
    // an empty form. An adapter that offered no form at all lands here too.
    asks: Object.keys(properties).length > 0,
  };
}
