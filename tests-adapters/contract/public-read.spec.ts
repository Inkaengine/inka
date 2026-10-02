import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
}, 240_000);

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});

/**
 * What a VISITOR can read, with no adapter and no session.
 *
 * The public site is not rendered through the bridge. A frontend builds or
 * serves it by reading the CMS directly, so the blocks have to be reachable by
 * an anonymous HTTP client. Every other test in this suite holds the adapter's
 * credentials, which is exactly why nothing here has ever checked this: an
 * authenticated read can succeed while the public one returns nothing, and the
 * editor would look perfect while the published site renders blank.
 *
 * This is a property of the CMS and of how we chose to store blocks, not of the
 * adapter — which is why the fetch lives on the target rather than going
 * through `dispatch`.
 */
describe('public read', () => {
  it('serves a published document’s blocks to a client with no credentials', async () => {
    const blocks = await target.publicBlocks('/news/first-post');

    expect(
      blocks,
      'a published page gave an anonymous reader no blocks — the public site ' +
        'cannot render what it cannot fetch',
    ).not.toBeNull();
    expect(Object.keys(blocks ?? {}).length).toBeGreaterThan(0);
    // The seeded slate says "Hello". Asserting the CONTENT rather than a block
    // id, because ids are the CMS's to assign.
    expect(JSON.stringify(blocks)).toContain('Hello');
  });

  it('does not serve an unpublished document to a client with no credentials', async () => {
    // The other half, and the one that matters more if we get it wrong: making
    // blocks public must not make DRAFTS public.
    const blocks = await target.publicBlocks('/news/draft-post');
    expect(blocks, 'a draft was readable by an anonymous client').toBeNull();
  });
});
