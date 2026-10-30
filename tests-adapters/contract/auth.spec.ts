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

describe('auth.whoami', () => {
  it('returns a canonical User for the authenticated session', async () => {
    const user: any = await target.adapter.dispatch('auth.whoami', {});
    expect(typeof user.id).toBe('string');
    expect(typeof user.username).toBe('string');
    expect(Array.isArray(user.roles)).toBe(true);
    expect(user.roles.length).toBeGreaterThan(0);
  });

  it('exposes the same user through the whoami() method', async () => {
    const viaIntent: any = await target.adapter.dispatch('auth.whoami', {});
    const viaMethod: any = await target.adapter.whoami();
    expect(viaMethod.username).toBe(viaIntent.username);
  });
});

describe('session expiry', () => {
  it('maps a CMS 401 to UNAUTHORIZED and asks the admin for a challenge', async () => {
    const events: string[] = [];
    await target.expireSession((event: string) => events.push(event));

    await expect(
      target.adapter.dispatch('content.get', { path: '/news/first-post' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });

    // BaseAdapter retries once — a session refreshed in another tab is the
    // common case — and only then escalates. The admin must be told, or the
    // user sees a dead editor with no explanation.
    expect(events).toContain('auth-required');
  });
});

/**
 * Signing out.
 *
 * The credential lives in the ADAPTER, so signing out is the adapter's job and
 * has to mean the same thing on every CMS: the session ends, and the CMS stops
 * answering as that user. Nothing tested this because nothing implemented it —
 * the proxy frame stored a credential and never had a way to drop one, so
 * "logout" cleared the admin's own UI state and left the session that actually
 * reaches content untouched.
 *
 * That is the dangerous version: an editor on a shared machine clicks logout,
 * the admin looks signed out, and the next person's browser still holds a
 * working credential for the CMS.
 */
describe('auth.logout', () => {
  it('ends the session, so the CMS stops answering as that user', async () => {
    const me: any = await target.adapter.dispatch('auth.whoami', {});
    expect(me.id, 'must be signed in before signing out means anything').toBeTruthy();

    await target.adapter.dispatch('auth.logout', {});

    // UNAUTHORIZED, not an empty answer. A logout that leaves reads working is
    // not a logout, and one that returns nothing looks to the admin like a user
    // with no content.
    await expect(
      target.adapter.dispatch('auth.whoami', {}),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('is idempotent, because a second click must not throw something else', async () => {
    await target.adapter.dispatch('auth.logout', {});
    await target.adapter.dispatch('auth.logout', {});
  });
});

/**
 * How this CMS lets someone sign in.
 *
 * The admin cannot know this. A site may offer a password form and nothing
 * else, or an SSO provider, or a password-free demo editor
 * (plone.demoeditor) — and which of those exist is the CMS's business, not
 * the admin's. Plone answers it at `GET @login`; this is the same question put
 * to the ADAPTER, so an admin over WordPress or Drupal can ask it too. Without
 * it the question reached a Plone backend through the http passthrough and was
 * simply unroutable everywhere else: `No canonical intent for GET /@login`.
 *
 * Every adapter answers, including one whose CMS offers nothing beyond a
 * password: an empty list is a real answer ("no alternative way in"), and the
 * admin renders it as no extra buttons.
 *
 * Deliberately NOT gated on a capability. "What are the ways in?" has an
 * answer for every CMS, and an adapter that cannot be asked would leave the
 * admin guessing again.
 */
describe('auth.loginOptions', () => {
  it('lists the ways in, as canonical options', async () => {
    const result: any = await target.adapter.dispatch('auth.loginOptions', {});
    expect(Array.isArray(result.options)).toBe(true);
    for (const option of result.options) {
      // An option the admin can render and press: something to show the user,
      // and an id to press it by.
      expect(typeof option.id).toBe('string');
      expect(option.id.length).toBeGreaterThan(0);
      expect(typeof option.title).toBe('string');
      expect(option.title.length).toBeGreaterThan(0);
    }
  });

  // Derived from what the adapter ACTUALLY offers rather than from a list of
  // CMSes kept here: a target with no password-free option exercises nothing,
  // and one that grows one is covered the day it does.
  it('signs in with any password-free option it offers, and no password', async () => {
    const result: any = await target.adapter.dispatch('auth.loginOptions', {});
    const free = result.options.filter((o: any) => o.passwordFree === true);
    for (const option of free) {
      await target.adapter.dispatch('auth.logout', {});
      const session: any = await target.adapter.dispatch('auth.loginWithOption', {
        id: option.id,
      });
      expect(typeof session.token).toBe('string');
      expect(session.token.length).toBeGreaterThan(0);
      // Signed in for real, not merely handed a string.
      const me: any = await target.adapter.dispatch('auth.whoami', {});
      expect(me.id).toBeTruthy();
    }
  });

  it('refuses an option the CMS does not offer, rather than inventing a session', async () => {
    await expect(
      target.adapter.dispatch('auth.loginWithOption', { id: 'no-such-option' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
