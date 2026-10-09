/**
 * What a text link keeps of the item it was picked from.
 *
 * The link's address stays in `data.url`, where Plone turns an internal one
 * into a resolveuid; a copy of it here would not be, and would go stale when the
 * item moves. Who made the item is personal and not the link's business.
 */
import { describe, test, expect } from 'vitest';
import { linkItemSnapshot } from './linkItem';

const picked = {
  '@id': 'http://localhost:3000/docs/annual-report',
  '@type': 'File',
  UID: 'annual-report-uid',
  id: 'annual-report',
  title: 'Annual report',
  description: 'The year in numbers',
  portal_type: 'File',
  mime_type: 'application/pdf',
  getObjSize: '19.5 KB',
  modified: '2026-10-01T09:00:00+00:00',
  review_state: 'published',
  getURL: 'http://localhost:8080/Plone/docs/annual-report',
  getPath: '/Plone/docs/annual-report',
  getRemoteUrl: 'http://localhost:8080/Plone/docs/annual-report',
  Creator: 'jane.author',
  listCreators: ['jane.author'],
  Contributors: ['sam.editor'],
  author_name: 'Jane Author',
  commentators: ['sam.editor'],
};

describe('linkItemSnapshot', () => {
  test("keeps the item's metadata: its type, size and dates", () => {
    expect(linkItemSnapshot(picked)).toEqual({
      '@type': 'File',
      UID: 'annual-report-uid',
      id: 'annual-report',
      title: 'Annual report',
      description: 'The year in numbers',
      portal_type: 'File',
      mime_type: 'application/pdf',
      getObjSize: '19.5 KB',
      modified: '2026-10-01T09:00:00+00:00',
      review_state: 'published',
    });
  });

  test('keeps a field it does not know, so new catalog metadata (a page count) comes through', () => {
    expect(linkItemSnapshot({ ...picked, page_count: 12 }).page_count).toBe(12);
  });

  test('leaves out where the item is: data.url is the only address', () => {
    const kept = linkItemSnapshot(picked);
    for (const key of ['@id', 'getURL', 'getPath', 'getRemoteUrl']) {
      expect(kept).not.toHaveProperty(key);
    }
  });

  test('leaves out the people: creators, contributors, authors, commentators', () => {
    const kept = linkItemSnapshot(picked);
    for (const key of ['Creator', 'listCreators', 'Contributors', 'author_name', 'commentators']) {
      expect(kept).not.toHaveProperty(key);
    }
  });
});
