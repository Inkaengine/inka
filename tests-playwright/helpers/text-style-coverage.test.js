/**
 * The aggregation contract. Two findings, kept apart on purpose:
 *   - a style that never rendered anywhere
 *   - a style that rendered, but looks exactly like body text
 * Both are "the author picked a style and got nothing", but they have different
 * causes and different fixes.
 */
import {
  measureStylesInPage,
  slateStyles,
  recordTextStyles,
  drainStyleCoverage,
  stylesNeverRendered,
  stylesRenderingAsPlainText,
  stylesSeenInContent,
  resetTextStyleCoverage,
} from './text-style-coverage.ts';

const el = (type, ...kids) => ({
  type,
  children: kids.map((k) => (typeof k === 'string' ? { text: k } : k)),
});

beforeEach(() => resetTextStyleCoverage());

describe('slateStyles', () => {
  test('finds every element type at any depth, with its text', () => {
    expect([...slateStyles([el('p', 'a ', el('strong', 'bold'), ' b')])]).toEqual([
      ['p', 'a bold b'],
      ['strong', 'bold'],
    ]);
  });

  test('an INLINE design-system style is a leaf mark, and counts', () => {
    // The style menu stores an inline style as `style-<cssClass>` on the leaf,
    // not as styleName. Counting only styleName measured half the menu.
    const value = [{ type: 'p', children: [{ text: 'A', 'style-dropcap': true }, { text: 'enean…' }] }];
    expect([...slateStyles(value)]).toEqual([
      ['p', 'Aenean…'],
      ['.dropcap', 'A'],
    ]);
  });

  test("a design system's own styles count too", () => {
    // Volto's StyleMenu writes the chosen definition's cssClass into styleName.
    // Those are what a DS actually offers an author beyond h2/bold, so they are
    // covered by the same machinery — prefixed, so `.lead` can never be confused
    // with an element type named `lead`.
    const value = [{ type: 'p', styleName: 'lead dropcap', children: [{ text: 'Intro' }] }];
    expect([...slateStyles(value)]).toEqual([
      ['p', 'Intro'],
      ['.lead', 'Intro'],
      ['.dropcap', 'Intro'],
    ]);
  });

  test('skips a style with no text — there is nothing to locate in the DOM', () => {
    expect([...slateStyles([el('p', el('image'))])]).toEqual([]);
  });
});

describe('did it render at all', () => {
  test('a style with a signature is covered', () => {
    recordTextStyles('slate', '/a', [el('h2', 'Hello')], { h2: { sig: 'H2|700|24px', node: 1 } }, { sig: 'P|400|16px', node: 0 });
    expect(stylesNeverRendered()).toEqual([]);
  });

  test('a style the page never rendered is reported, with where to look', () => {
    recordTextStyles('slate', '/a', [el('h4', 'Invisible')], { h4: null }, { sig: 'P|400|16px', node: 0 });
    expect(stylesNeverRendered()).toEqual([
      { style: 'h4', blockType: 'slate', text: 'Invisible', pagePath: '/a' },
    ]);
  });

  test('ONE rendering example is enough — a later missing one does not undo it', () => {
    recordTextStyles('slate', '/a', [el('h3', 'Shown')], { h3: { sig: 'H3|700|20px', node: 1 } });
    recordTextStyles('slate', '/b', [el('h3', 'Hidden here')], { h3: null });
    expect(stylesNeverRendered()).toEqual([]);
  });
});

describe('did it render DIFFERENTLY', () => {
  test('a style that looks exactly like body text is a finding', () => {
    recordTextStyles('slate', '/a', [el('h4', 'Subtitle')], { h4: { sig: 'P|400|16px', node: 1 } }, { sig: 'P|400|16px', node: 0 });
    expect(stylesRenderingAsPlainText().map((s) => s.style)).toEqual(['h4']);
  });

  test('a style that differs is fine, whatever markup it used', () => {
    // A styled span, not a <strong>. The check must not care.
    recordTextStyles('slate', '/a', [el('strong', 'bold')], { strong: { sig: 'SPAN|700|16px', node: 1 } }, { sig: 'P|400|16px', node: 0 });
    expect(stylesRenderingAsPlainText()).toEqual([]);
  });

  test('the default block type is body text — never a finding', () => {
    recordTextStyles('slate', '/a', [el('p', 'words')], { p: { sig: 'P|400|16px', node: 1 } }, { sig: 'P|400|16px', node: 0 });
    expect(stylesRenderingAsPlainText()).toEqual([]);
  });

  test('with no baseline captured, nothing is claimed', () => {
    recordTextStyles('slate', '/a', [el('h4', 'Subtitle')], { h4: { sig: 'P|400|16px', node: 1 } }, null);
    expect(stylesRenderingAsPlainText()).toEqual([]);
  });

  test('a fully-bold paragraph is ONE element — not evidence that bold is invisible', () => {
    // p and strong locate the same node: the paragraph IS the bold run. Reading
    // that as "bold looks like body text" is what the first version did.
    const same = { sig: 'P|700|16px', node: 3 };
    recordTextStyles('slate', '/a', [el('p', el('strong', 'All bold'))], { p: same, strong: same }, same);
    expect(stylesRenderingAsPlainText()).toEqual([]);
  });

  test('each example is judged against ITS OWN body text', () => {
    // Two pages whose body text renders differently. h4 matching the body text
    // of the page it is ON is the finding — the comparison is never against
    // some other page's baseline.
    recordTextStyles('slate', '/a', [el('p', 'x')], { p: { sig: 'P|400|16px', node: 1 } }, { sig: 'P|400|16px', node: 1 });
    recordTextStyles('slate', '/b', [el('h4', 'y')], { h4: { sig: 'DIV|400|15px', node: 2 } }, { sig: 'DIV|400|15px', node: 9 });
    expect(stylesRenderingAsPlainText().map((s) => s.style)).toEqual(['h4']);
  });
});

test('reports the vocabulary actually present in the content', () => {
  recordTextStyles('slate', '/a', [el('p', 'x'), el('h2', 'y')], {});
  expect(stylesSeenInContent()).toEqual(['h2', 'p']);
});

describe('merging across workers', () => {
  // Playwright runs each worker in its OWN process, so module state alone makes
  // the answer depend on which worker happens to run the aggregate — the check
  // passed on one run and reported "0 styles measured" on the next from
  // identical content. Each test DRAINS its records and the spec attaches them;
  // the coverage reporter concatenates every worker's and runs the aggregate on
  // the combined list. The aggregates take that list as an argument, so combining
  // is just array concatenation — no shared files, no ordering assumptions.

  test("another worker's coverage counts", () => {
    // This worker saw h2 but never rendered it; another worker did.
    recordTextStyles('slate', '/a', [el('h2', 'Heading')], { h2: null }, { sig: 'P|400|16px', node: 0 });
    const mine = drainStyleCoverage();
    expect(stylesNeverRendered(mine).map((s) => s.style)).toEqual(['h2']);

    // The other worker rendered h2 with a real signature.
    recordTextStyles('slate', '/c', [el('h2', 'Heading')], { h2: { sig: 'H2|700|24px', node: 1 } }, { sig: 'P|400|16px', node: 0 });
    const other = drainStyleCoverage();
    expect(stylesNeverRendered([...mine, ...other])).toEqual([]);
  });

  test("another worker's styles are visible to the fail-closed check", () => {
    recordTextStyles('slate', '/b', [el('h3', 'x')], {});
    const other = drainStyleCoverage();
    // This worker saw nothing; the combined list still reports h3.
    expect(stylesSeenInContent([...drainStyleCoverage(), ...other])).toEqual(['h3']);
  });

  test('a style flat in one worker but distinct in another is not a finding', () => {
    // The reason the aggregate must see EVERY worker's records: proof the
    // frontend CAN render a style distinctly can arrive from a different worker.
    recordTextStyles('slate', '/a', [el('h4', 'flat here')], { h4: { sig: 'P|400|16px', node: 1 } }, { sig: 'P|400|16px', node: 0 });
    const mine = drainStyleCoverage();
    expect(stylesRenderingAsPlainText('p', mine).map((s) => s.style)).toEqual(['h4']);

    recordTextStyles('slate', '/z', [el('h4', 'distinct here')], { h4: { sig: 'H4|700|20px', node: 1 } }, { sig: 'P|400|16px', node: 0 });
    const other = drainStyleCoverage();
    expect(stylesRenderingAsPlainText('p', [...mine, ...other])).toEqual([]);
  });
});


/**
 * Where a block's text is ALLOWED to be.
 *
 * Design system JavaScript builds some fields elsewhere in the document — a
 * cookie banner, a dialog — and stamps `data-block-selector="uid#field"` on the
 * control that reveals them. That attribute is a HANDLE, not a container: its
 * subtree holds the button's own label, never the field. Reading it instead of
 * clicking it reported the field as rendering NOWHERE while the words were one
 * click from the screen.
 */
describe('measureStylesInPage — fields the design system draws elsewhere', () => {
  const setup = () => {
    document.body.innerHTML = `
      <div data-block-uid="uid" id="root">
        <a data-block-selector="uid#message" id="handle">Show cookie consent</a>
      </div>
      <div id="banner" style="display: none">
        <p>We use cookies. You can <a id="link">manage your cookie settings</a> at any time.</p>
      </div>
    `;
    // The design system opens it from a document-level click handler.
    document.getElementById('handle').addEventListener('click', () => {
      document.getElementById('banner').style.display = 'block';
    });
    return document.getElementById('root');
  };

  test('the handle is clicked, and the revealed text is measured', () => {
    const root = setup();
    const { out } = measureStylesInPage(root, {
      wanted: [{ style: 'link', text: 'manage your cookie settings' }],
      uid: 'uid',
      field: 'message',
    });
    expect(out.link).not.toBeNull();
  });

  test('without the field, the handle is not clicked and nothing is found', () => {
    // The block alone cannot say WHICH surface to open: a block drawn in two
    // places (a banner and its preferences dialog) has a handle for each, and
    // revealing the second hides the first.
    const root = setup();
    const { out } = measureStylesInPage(root, {
      wanted: [{ style: 'link', text: 'manage your cookie settings' }],
      uid: 'uid',
    });
    expect(out.link).toBeNull();
  });

  test("a block with no handle is still measured inside itself", () => {
    document.body.innerHTML = `
      <div data-block-uid="uid" id="root"><p id="p">ordinary body text</p></div>
    `;
    const { out } = measureStylesInPage(document.getElementById('root'), {
      wanted: [{ style: 'p', text: 'ordinary body text' }],
      uid: 'uid',
      field: 'value',
    });
    expect(out.p).not.toBeNull();
  });
});
