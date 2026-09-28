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

const advertises = (capability: string) =>
  target.adapter.capabilities.includes(capability as never);

/**
 * What refers to this document.
 *
 * The question a delete warning is made of, and the one place references stop
 * being a matter of encoding. Resolving FORWARDS works everywhere — Plone's
 * resolveuid, WordPress's post id, Drupal's /node/<id> — but looking BACKWARDS
 * needs an index of incoming links, and only some CMSes keep one.
 *
 * So the test is written against the outcome and gated on the capability. It
 * deliberately stores the link the way an authoring tool has it — by PATH — and
 * leaves it to the adapter to index that however its CMS does. A test that wrote
 * `resolveuid/<uid>` would be asserting Plone's mechanism on everyone.
 */
describe('reference.dependents', () => {
  it('refuses when the CMS cannot see incoming links', async () => {
    if (advertises('link-integrity')) return;
    // Honest refusal, not an empty list: "nothing links here" invites a delete
    // that breaks someone's page, which is precisely the warning's job.
    await expect(
      target.adapter.dispatch('reference.dependents', { path: '/about' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('names the document that links to this one', async () => {
    if (!advertises('link-integrity')) return;

    const target_: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });

    // A link stored the way an editor's tool has it: by path.
    await target.adapter.dispatch('content.update', {
      path: '/news/first-post',
      data: {
        blocks: {
          linker: {
            '@type': 'slate',
            value: [
              {
                type: 'p',
                children: [
                  { text: 'see ' },
                  {
                    type: 'link',
                    data: { url: target_.path },
                    children: [{ text: 'about' }],
                  },
                ],
              },
            ],
          },
        },
        blocksLayout: { items: ['linker'] },
      },
    });

    const found: any = await target.adapter.dispatch('reference.dependents', {
      path: '/about',
    });
    expect(Array.isArray(found.references)).toBe(true);
    expect(found.references.map((r: any) => r.path)).toContain(
      '/news/first-post',
    );
    for (const reference of found.references) {
      // Paths, not URLs — every other intent here takes and returns paths.
      expect(reference.path.startsWith('/')).toBe(true);
      expect(typeof reference.title).toBe('string');
    }
  });

  it('answers empty for a document nothing links to', async () => {
    if (!advertises('link-integrity')) return;
    const found: any = await target.adapter.dispatch('reference.dependents', {
      path: '/news/draft-post',
    });
    expect(found.references).toEqual([]);
  });

  it('rejects a path that does not exist, rather than answering empty', async () => {
    if (!advertises('link-integrity')) return;
    // "Nothing links to it" and "it isn't there" are different answers, and a
    // delete dialog built on the first would be reassuring about a typo.
    await expect(
      target.adapter.dispatch('reference.dependents', {
        path: '/no-such-page',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
