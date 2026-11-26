/**
 * Opening an editor that the site refuses. The editor's first read expands the
 * addable types, which Plone refuses (401) to anyone it doesn't take as signed
 * in, as it doesn't a token it no longer accepts; the editor then never opens.
 * openForEdit waited its full minute for it, and said only that it had not
 * opened.
 */
import { describe, it, expect } from 'vitest';
import { openForEdit, EditorRefused } from './adminDriver.mjs';

/** A loaded admin whose editor never opens, and whose reads answer `status`. */
function adminAnswering(status) {
  const listeners = new Set();
  const answer = (url) => {
    const response = { status: () => status, url: () => url, request: () => ({ method: () => 'GET' }) };
    for (const listener of listeners) listener(response);
  };
  return {
    on: (event, listener) => { if (event === 'response') listeners.add(listener); },
    off: (event, listener) => listeners.delete(listener),
    // goTo navigates (true); the editor's read answers as it is told to;
    // after that, every check finds the editor not open.
    evaluate: async (_fn, arg) => {
      if (typeof arg === 'string' && arg.endsWith('/edit')) {
        answer('https://admin.example.org/++api++/?expand=breadcrumbs,actions,types');
        return true;
      }
      return false;
    },
    waitForTimeout: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  };
}

describe('openForEdit', () => {
  it('stops as soon as the site refuses the editor, and says so', async () => {
    const started = Date.now();
    await expect(openForEdit(adminAnswering(401), { path: '/news' })).rejects.toThrow(EditorRefused);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
