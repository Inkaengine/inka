/**
 * A canvas field's value drawn as itself.
 *
 * The coverage rule asks for an edit annotation on each picture and link field.
 * A field whose value never appears as itself on the page — a listing's search
 * page, drawn only as the start of each result's search address — is a
 * setting, edited in the sidebar like the block's other settings, so there is
 * nothing on the canvas to annotate. As for plain text, which is checked only
 * where it is displayed.
 */
import { describe, test, expect } from 'vitest';
import { drawnAsItself } from './canvas-fields.js';

const base = 'http://site.test/page';

describe('drawnAsItself: a link', () => {
  test('its address is drawn', () => {
    expect(drawnAsItself('link', [{ '@id': '/search' }], ['http://site.test/search'], base)).toBe(true);
  });

  test('the same page with or without a trailing slash', () => {
    expect(drawnAsItself('link', [{ '@id': '/search/' }], ['http://site.test/search'], base)).toBe(true);
  });

  test('an outside address', () => {
    expect(drawnAsItself('link', [{ '@id': 'https://example.org/a?b=1' }], ['https://example.org/a?b=1'], base)).toBe(true);
  });

  test('the address with a query added is another address', () => {
    expect(drawnAsItself('link', [{ '@id': '/search' }], ['http://site.test/search?SearchableText=tax'], base)).toBe(false);
  });

  test('a site path linked through the API host is the same page', () => {
    expect(drawnAsItself('link', [{ '@id': '/search' }], ['http://api.test/search'], base)).toBe(true);
  });

  test('the same path on another site is another address', () => {
    expect(drawnAsItself('link', [{ '@id': 'https://example.org/search' }], ['http://site.test/search'], base)).toBe(false);
  });

  test('a fragment does not make it another page', () => {
    expect(drawnAsItself('link', [{ '@id': '/search' }], ['http://site.test/search#results'], base)).toBe(true);
  });
});

describe('drawnAsItself: a picture', () => {
  test('a scale of the image is drawn', () => {
    expect(drawnAsItself('media', '/photo.jpg', ['http://site.test/photo.jpg/@@images/image/large'], base)).toBe(true);
  });

  test('a reference to the image item', () => {
    expect(drawnAsItself('media', [{ '@id': '/photo.jpg' }], ['http://site.test/photo.jpg'], base)).toBe(true);
  });

  test('another image whose name starts the same is not it', () => {
    expect(drawnAsItself('media', '/photo', ['http://site.test/photo-2.jpg'], base)).toBe(false);
  });

  test('a site path drawn from the API host is the same image', () => {
    expect(drawnAsItself('media', '/photo.jpg', ['http://api.test/photo.jpg/@@images/image/large'], base)).toBe(true);
  });

  test('nothing drawn', () => {
    expect(drawnAsItself('media', '/photo.jpg', [], base)).toBe(false);
  });
});

test('a value with no address in it is never drawn', () => {
  expect(drawnAsItself('link', [{}], ['http://site.test/'], base)).toBe(false);
});
