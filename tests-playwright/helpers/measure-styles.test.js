/**
 * The in-page measurement, tested directly.
 *
 * Every rule in `measureStylesInPage` was written because its absence produced
 * a confident WRONG finding first — reported to the user, then retracted. Only
 * the end-to-end run exercised it, which is how all three survived to the first
 * real content run. jsdom is enough: the questions are which element is found
 * and whether two are the same, not how a browser paints.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { measureStylesInPage } from './text-style-coverage.ts';

const mount = (html) => {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById('root');
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('locating the element a style produced', () => {
  test('the ROOT itself counts', () => {
    // A slate block often renders AS the styled element (`<h3 data-block-uid>`),
    // in which case no descendant holds the text. Searching descendants only
    // reported every such heading as rendering nowhere.
    const root = mount('Heading text');
    const { out } = measureStylesInPage(root, { wanted: [{ style: 'h3', text: 'Heading text' }] });
    expect(out.h3).not.toBeNull();
  });

  test('the INNERMOST match wins, not an ancestor that merely contains it', () => {
    const root = mount('<p><strong>bold</strong></p>');
    const { out } = measureStylesInPage(root, { wanted: [
      { style: 'strong', text: 'bold' },
    ] });
    // The <strong>, which is last in document order among the full-text matches.
    expect(out.strong).not.toBeNull();
  });

  test('a style with no text is not located, and not claimed', () => {
    const root = mount('<p>words</p>');
    const { out } = measureStylesInPage(root, { wanted: [{ style: 'image', text: '' }] });
    expect(out.image).toBeNull();
  });

  test('text absent from the DOM measures as null, not as something nearby', () => {
    const root = mount('<p>something else</p>');
    const { out } = measureStylesInPage(root, { wanted: [{ style: 'h4', text: 'Invisible' }] });
    expect(out.h4).toBeNull();
  });
});

describe('whitespace', () => {
  test("a container's concatenated text matches the DOM's separated text", () => {
    // slate gives `ul` the text "oneTwo" (children joined with nothing); the DOM
    // reads back "one Two". Comparing on collapsed-but-present whitespace
    // reported every ol/ul as rendering nowhere.
    const root = mount('<ul><li>one</li><li>Two</li></ul>');
    const { out } = measureStylesInPage(root, { wanted: [{ style: 'ul', text: 'oneTwo' }] });
    expect(out.ul).not.toBeNull();
  });

  test('non-breaking spaces and zero-width marks do not defeat a match', () => {
    const root = mount('<p>a b​c</p>');
    const { out } = measureStylesInPage(root, { wanted: [{ style: 'p', text: 'a b c' }] });
    expect(out.p).not.toBeNull();
  });
});

describe('identity, not just appearance', () => {
  test('a fully-bold paragraph resolves p and strong to the SAME node', () => {
    // Without identity this reads as "bold renders like body text", which was
    // reported as a finding and was wrong.
    const root = mount('<p><strong>All bold</strong></p>');
    const { out } = measureStylesInPage(root, { wanted: [
      { style: 'p', text: 'All bold' },
      { style: 'strong', text: 'All bold' },
    ] });
    expect(out.p.node).toBe(out.strong.node);
  });

  test('distinct elements get distinct node ids', () => {
    const root = mount('<p>lead in</p><h2>a heading</h2>');
    const { out } = measureStylesInPage(root, { wanted: [
      { style: 'p', text: 'lead in' },
      { style: 'h2', text: 'a heading' },
    ] });
    expect(out.p.node).not.toBe(out.h2.node);
  });
});

describe('the baseline', () => {
  test('is the default block type, not "the longest run"', () => {
    // The first version took the longest leaf run, so in a block whose only long
    // text is bold, BOLD became the baseline and was then reported as looking
    // like body text.
    const root = mount('<p>short</p><strong>a much longer bold run of text</strong>');
    const { out, baseline } = measureStylesInPage(root, { wanted: [
      { style: 'p', text: 'short' },
      { style: 'strong', text: 'a much longer bold run of text' },
    ] });
    expect(baseline).toEqual(out.p);
    expect(baseline).not.toEqual(out.strong);
  });

  test('is null when there is no paragraph to compare against', () => {
    const root = mount('<h2>only a heading</h2>');
    const { baseline } = measureStylesInPage(root, { wanted: [
      { style: 'h2', text: 'only a heading' },
    ] });
    expect(baseline).toBeNull();
  });
});

describe('the signature', () => {
  test('describes appearance, never the tag name', () => {
    // A frontend may render bold as a styled span; the check must not care.
    const root = mount(
      '<span style="font-weight: 700">bold</span><b style="font-weight: 700">also</b>',
    );
    const { out } = measureStylesInPage(root, { wanted: [
      { style: 'strong', text: 'bold' },
      { style: 'b', text: 'also' },
    ] });
    expect(out.strong.sig).toBe(out.b.sig);
  });

  test('separates two styles that actually look different', () => {
    const root = mount(
      '<p style="font-weight: 400">plain</p><p style="font-weight: 700">heavy</p>',
    );
    const { out } = measureStylesInPage(root, { wanted: [
      { style: 'p', text: 'plain' },
      { style: 'h2', text: 'heavy' },
    ] });
    expect(out.p.sig).not.toBe(out.h2.sig);
  });
});

describe('markup a block owns but does not contain', () => {
  test('a field the design system builds elsewhere is still measured', () => {
    // The cookie banner: its description is the block's `message` field, but
    // the DS builds the banner into <body>, outside the block's element. The
    // markup says whose it is — the same `uid#field` handle the bridge clicks
    // to reveal it — and measuring the block's element alone reported the link
    // inside it as rendering NOWHERE while the words were on screen.
    const root = mount('<p>a block that draws no text of its own</p>');
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div data-block-selector="cc-1#message">
         <p>We use cookies. You can
           <a href="/manage-cookies">manage your cookie settings</a> at any time.</p>
       </div>`,
    );
    const { out } = measureStylesInPage(root, {
      wanted: [{ style: 'link', text: 'manage your cookie settings' }],
      uid: 'cc-1',
    });
    expect(out.link).not.toBeNull();
  });

  test('another block’s claimed markup is not this block’s', () => {
    const root = mount('<p>mine</p>');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-block-selector="other-1#message"><a>theirs</a></div>',
    );
    const { out } = measureStylesInPage(root, {
      wanted: [{ style: 'link', text: 'theirs' }],
      uid: 'cc-1',
    });
    expect(out.link).toBeNull();
  });

  test('a uid carrying :: does not break the lookup', () => {
    // expandTemplates mints "::" into instance uids, and an unquoted selector
    // throws on it — taking the whole measurement down rather than missing one
    // style.
    const root = mount('<p>mine</p>');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-block-selector="tpl::1#message"><a>claimed</a></div>',
    );
    const { out } = measureStylesInPage(root, {
      wanted: [{ style: 'link', text: 'claimed' }],
      uid: 'tpl::1',
    });
    expect(out.link).not.toBeNull();
  });
});
