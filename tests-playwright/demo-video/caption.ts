/**
 * Back-compatible re-export. The caption implementation moved to
 * `../helpers/caption`, next to AdminUIHelper, so the helper and this module
 * share ONE mechanism instead of drawing two overlays that would both show.
 *
 * External demo suites import `showCaption`/`clearCaption` from this path —
 * keep it working. New code should prefer `AdminUIHelper.caption()`, which is
 * the same implementation with the page already bound.
 */
export { showCaption, clearCaption } from '../helpers/caption';
export { glance, holdOn, readFor } from '../helpers/demoPacing';
