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

describe('reference.resolve', () => {
  it('resolves a stored id to a renderable path, url and title', async () => {
    const doc: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });

    const ref: any = await target.adapter.dispatch('reference.resolve', {
      id: doc.id,
    });

    expect(ref.id).toBe(doc.id);
    expect(ref.path).toBe('/about');
    expect(ref.title).toBe('About');
    expect(ref.url).toMatch(/^https?:\/\//);
  });

  it('rejects an unknown id with NOT_FOUND', async () => {
    await expect(
      target.adapter.dispatch('reference.resolve', { id: 'no-such-id-12345' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  /**
   * The assertion this whole intent exists for.
   *
   * A link stored as a path is a link that dies the first time an editor
   * renames the target — silently, with no error anywhere, discovered by a
   * reader hitting a 404. Storing the id is the only thing that survives, and
   * this test is what stops an adapter quietly persisting a path instead.
   */
  it('still resolves after the target is renamed', async () => {
    const before: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });

    await target.adapter.dispatch('content.update', {
      path: '/about',
      data: { title: 'About Us, Renamed' },
    });

    const after: any = await target.adapter.dispatch('reference.resolve', {
      id: before.id,
    });

    expect(after.id).toBe(before.id);
    expect(after.title).toBe('About Us, Renamed');
    expect(after.path).toBeTruthy();
  });
});
