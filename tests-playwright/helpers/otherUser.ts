/**
 * Another user of the site, for tests of what one user meets on a page
 * another is editing. A lock is the page's, seen by every user (the mock
 * keeps it as Plone does, not per session), so a test that locks a page uses
 * a page of its own (freshPage): locking a shared fixture page would refuse
 * the saves of every other test editing it at the same time.
 */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { URLS } from '../ports';
import { mintToken } from '../fixtures/mock-tokens.cjs';

/** A token for `user`, one the mock site issued (mock-tokens.cjs). */
export function tokenFor(user: string): string {
  return mintToken(user);
}

/** A page of the test's own, in the session of `token`: a title and one paragraph (`para`). */
export async function freshPage(token: string): Promise<string> {
  const id = `own-page-${randomUUID()}`;
  const response = await fetch(`${URLS.mockApi}/_test_data`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      '@type': 'Document',
      id,
      title: 'A page of its own',
      blocks: {
        title: { '@type': 'title' },
        para: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Its only paragraph' }] }], plaintext: 'Its only paragraph' },
      },
      blocks_layout: { items: ['title', 'para'] },
    }),
  });
  expect(response.status).toBe(201);
  return new URL((await response.json())['@id']).pathname;
}

/** `user` holds `path`'s lock, as their open editor would, while `during` runs. */
export async function whileEditing(user: string, path: string, during: () => Promise<void>): Promise<void> {
  const token = tokenFor(user);
  const lock = (method: string, body?: object) => fetch(`${URLS.mockApi}${path}/@lock`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  });
  expect((await (await lock('POST')).json()).creator).toBe(user);
  try {
    await during();
  } finally {
    await lock('DELETE', { force: true });
  }
}
