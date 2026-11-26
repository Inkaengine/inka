/**
 * Before creating a template, the editor asks whether the chosen folder takes
 * new content. When it can't see the folder (may not read it, or it isn't
 * there) it goes on and leaves the create to the server; anything else is a
 * real failure, said.
 */
import { describe, test, expect } from 'vitest';
import { assertCanAddTo } from './templateFolderPermission.js';

const apiAnswering = (get) => ({ get: async (path) => get(path) });
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('the folder a new template goes in', () => {
  test('one that takes new content: go on', async () => {
    await expect(assertCanAddTo(apiAnswering(() => ({ can_add: true })), '/templates')).resolves.toBeUndefined();
  });

  test('one that refuses it: a permission error naming the folder', async () => {
    await expect(assertCanAddTo(apiAnswering(() => ({ can_add: false })), '/templates'))
      .rejects.toMatchObject({ isPermissionError: true, message: expect.stringContaining('/templates') });
  });

  test("one we can't see: go on, and let the server take or refuse the create", async () => {
    for (const status of [401, 403, 404]) {
      await expect(assertCanAddTo(apiAnswering(() => { throw httpError(status); }), '/templates')).resolves.toBeUndefined();
    }
  });

  test('any other failure is not swallowed', async () => {
    await expect(assertCanAddTo(apiAnswering(() => { throw httpError(500); }), '/templates')).rejects.toMatchObject({ status: 500 });
    await expect(assertCanAddTo(apiAnswering(() => { throw new TypeError('bug'); }), '/templates')).rejects.toThrow('bug');
  });
});
