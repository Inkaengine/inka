/**
 * Back-compatible re-export. The caption implementation lives in
 * `@inka/testing/playwright/caption`, next to AdminUIHelper, so the helper and
 * this module share ONE mechanism instead of drawing two overlays that would
 * both show.
 *
 * External demo suites import `showCaption`/`clearCaption` from this path —
 * keep it working. New code should import the package, or prefer
 * `AdminUIHelper.caption()`, which is the same implementation with the page
 * already bound.
 */
export { showCaption, clearCaption } from '@inka/testing/playwright/caption';
export { glance, holdOn, readFor } from '@inka/testing/playwright/demoPacing';
