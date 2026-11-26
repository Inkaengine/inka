import StateMenu from '../../../../../components/Toolbar/StateMenu';

/**
 * Volto's state menu, replaced — and the two entries that belong inside it,
 * withdrawn.
 *
 * The stock component is a react-select whose onChange fires the transition
 * immediately, and whose options include the state the document is already in.
 * Three things follow from the spec that it cannot do:
 *
 *  - **Nothing fires on the click that opened it.** A transition names what it
 *    will do to who can reach this document, and waits.
 *  - **A transition may ask for something first** — WordPress wants a date and
 *    a visibility, Drupal a revision log, Plone effective and expiration dates.
 *    A select has nowhere to put a form.
 *  - **Sharing and working copies are the same list.** Changing who can reach a
 *    document, and taking a draft copy of it, are state changes. Plone putting
 *    them on separate screens is what this design is arguing with — and Volto's
 *    More menu inherits that split, carrying `state`, `sharing` and four
 *    working-copy buttons as unrelated entries.
 *
 * The old `sharing` and working-copy entries are gone from the menu itself —
 * see the More.jsx shadow, which had to exist anyway because Volto's crashes
 * when content is still loading.
 *
 * Renders nothing when the adapter does not advertise `state`, matching what
 * Volto does for content with no workflow — in which case the withdrawn entries
 * would be the only way to reach either, so they stay.
 */
const Workflow = ({ pathname, closeMenu }) => (
  <StateMenu pathname={pathname} closeMenu={closeMenu} />
);

export default Workflow;
