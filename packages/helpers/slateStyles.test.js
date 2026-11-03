import {
  foldSlateStyleRules,
  isStyleAllowed,
  isMarkAllowed,
  normalizeSlateValue,
  undefinedSlateTypes,
} from './slateStyles.js';

const p = (...kids) => ({ type: 'p', children: kids.map(t => (typeof t === 'string' ? { text: t } : t)) });
const el = (type, ...kids) => ({ type, children: kids.map(t => (typeof t === 'string' ? { text: t } : t)) });

// The DS bans blockquote outright and calls `b` by its real name.
const NO_QUOTE = { allowedStyles: null, disallowedStyles: ['blockquote', 'b'], allowedMarks: null, disallowedMarks: null };
const OPTS = { aliases: { b: 'strong', i: 'em' }, defaultBlockType: 'p' };

describe('foldSlateStyleRules', () => {
  test('nothing declared anywhere → null (unrestricted, today’s behaviour)', () => {
    expect(foldSlateStyleRules(null, {})).toBeNull();
    expect(foldSlateStyleRules(null, { widget: 'blocks_layout' })).toBeNull();
  });

  test('a field that declares nothing returns the inherited object BY REFERENCE', () => {
    const inherited = foldSlateStyleRules(null, { disallowedStyles: ['blockquote'] });
    expect(foldSlateStyleRules(inherited, { allowedBlocks: ['slate'] })).toBe(inherited);
  });

  test('deny accumulates down the chain and cannot be re-allowed', () => {
    const page = foldSlateStyleRules(null, { disallowedStyles: ['blockquote'] });
    const region = foldSlateStyleRules(page, { allowedStyles: ['p', 'h2', 'blockquote'] });
    expect(isStyleAllowed('h2', region)).toBe(true);
    expect(isStyleAllowed('blockquote', region)).toBe(false);
  });

  test('deny unions across levels', () => {
    const page = foldSlateStyleRules(null, { disallowedStyles: ['blockquote'] });
    const region = foldSlateStyleRules(page, { disallowedStyles: ['h4'] });
    expect(region.disallowedStyles.sort()).toEqual(['blockquote', 'h4']);
    expect(page.disallowedStyles).toEqual(['blockquote']); // parent not mutated
  });

  test('allow REPLACES the inherited list — a nested region may widen', () => {
    const page = foldSlateStyleRules(null, { allowedStyles: ['p'] });
    const region = foldSlateStyleRules(page, { allowedStyles: ['p', 'h2'] });
    expect(isStyleAllowed('h2', page)).toBe(false);
    expect(isStyleAllowed('h2', region)).toBe(true);
  });

  test('marks fold the same way, independently of styles', () => {
    const rules = foldSlateStyleRules(null, { disallowedMarks: ['highlight'] });
    expect(isMarkAllowed('highlight', rules)).toBe(false);
    expect(isMarkAllowed('strong', rules)).toBe(true);
    expect(isStyleAllowed('highlight', rules)).toBe(true);
  });
});

describe('isStyleAllowed', () => {
  test('no rules → everything allowed', () => {
    expect(isStyleAllowed('blockquote', null)).toBe(true);
    expect(isStyleAllowed('blockquote', undefined)).toBe(true);
  });

  test('link is structural and is never restrictable', () => {
    expect(isStyleAllowed('link', { allowedStyles: ['p'], disallowedStyles: ['link'] })).toBe(true);
  });
});

describe('normalizeSlateValue', () => {
  test('an untouched value comes back BY REFERENCE', () => {
    const value = [p('hello', el('strong', 'world'))];
    expect(normalizeSlateValue(value, NO_QUOTE, OPTS).value).toBe(value);
  });

  test('blockquote → p, children intact', () => {
    const value = [el('blockquote', 'quoted')];
    const out = normalizeSlateValue(value, NO_QUOTE, OPTS);
    expect(out.value).toEqual([p('quoted')]);
    expect(out.changes).toEqual([
      { path: [0], field: undefined, from: 'blockquote', to: 'p', kind: 'style' },
    ]);
  });

  test('b → strong via the alias map, not to the default block type', () => {
    const value = [p('a ', el('b', 'bold'), ' word')];
    const out = normalizeSlateValue(value, NO_QUOTE, OPTS);
    expect(out.value).toEqual([p('a ', el('strong', 'bold'), ' word')]);
    expect(out.changes[0]).toMatchObject({ from: 'b', to: 'strong', kind: 'style' });
  });

  test('an allowed nested list is left alone', () => {
    const value = [el('ul', el('li', 'one'), el('li', 'two'))];
    expect(normalizeSlateValue(value, NO_QUOTE, OPTS).value).toBe(value);
  });

  // docs/visual-editing.md: a slate field's value always holds exactly ONE
  // top-level node, and a frontend renderer is told it can assume that. A
  // downgrade that splices siblings in at the top would hand renderers a
  // multi-node value — which drops everything after the first.
  test('a denied top-level WRAPPER collapses into ONE node, keeping every word', () => {
    const rules = foldSlateStyleRules(null, { allowedStyles: ['p', 'strong'] });
    const value = [el('ul', el('li', 'one'), el('li', 'two'))];
    const out = normalizeSlateValue(value, rules, OPTS);
    expect(out.value).toHaveLength(1);
    expect(out.value).toEqual([p('one', 'two')]);
  });

  test('collapsing a wrapper must not eat INLINE children', () => {
    // blockquote is denied and holds only a `strong`. That is not a block
    // wrapper — flattening it would silently un-bold the text.
    const rules = foldSlateStyleRules(null, { disallowedStyles: ['blockquote'] });
    const value = [el('blockquote', el('strong', 'bold'), ' rest')];
    const out = normalizeSlateValue(value, rules, { defaultBlockType: 'p' });
    expect(out.value).toEqual([p(el('strong', 'bold'), ' rest')]);
  });

  test('a wrapper of a single inline element keeps that element', () => {
    const rules = foldSlateStyleRules(null, { disallowedStyles: ['blockquote'] });
    const value = [el('blockquote', el('strong', 'bold'))];
    const out = normalizeSlateValue(value, rules, { defaultBlockType: 'p' });
    expect(out.value).toEqual([p(el('strong', 'bold'))]);
  });

  test('no downgrade ever grows the top level', () => {
    const rules = foldSlateStyleRules(null, { allowedStyles: ['p'] });
    for (const value of [
      [el('ul', el('li', 'a'), el('li', 'b'), el('li', 'c'))],
      [el('blockquote', el('p', 'a'), el('p', 'b'))],
      [el('ol', el('li', el('strong', 'a')), el('li', 'b'))],
    ]) {
      expect(normalizeSlateValue(value, rules, OPTS).value).toHaveLength(1);
    }
  });

  test('a denied leaf mark is stripped, its text kept', () => {
    const rules = foldSlateStyleRules(null, { disallowedMarks: ['highlight'] });
    const value = [{ type: 'p', children: [{ text: 'keep me', highlight: true, bold: true }] }];
    const out = normalizeSlateValue(value, rules, OPTS);
    expect(out.value).toEqual([{ type: 'p', children: [{ text: 'keep me', bold: true }] }]);
    expect(out.changes[0]).toMatchObject({ from: 'highlight', to: null, kind: 'mark' });
  });

  test('a link survives an allow-list that does not mention it', () => {
    const rules = foldSlateStyleRules(null, { allowedStyles: ['p'] });
    const value = [p('see ', { type: 'link', data: { url: '/x' }, children: [{ text: 'x' }] })];
    expect(normalizeSlateValue(value, rules, OPTS).value).toBe(value);
  });

  test('an alias pointing at a DENIED target is a config error, not data loss', () => {
    const rules = foldSlateStyleRules(null, { disallowedStyles: ['blockquote', 'q'] });
    const value = [el('blockquote', 'quoted')];
    const out = normalizeSlateValue(value, rules, { aliases: { blockquote: 'q' }, defaultBlockType: 'p' });
    expect(out.value).toEqual([p('quoted')]);
    expect(out.changes[0]).toMatchObject({ from: 'blockquote', to: 'p', kind: 'style', configError: 'q' });
  });

  test('no rules at all → the value is returned untouched', () => {
    const value = [el('blockquote', 'quoted')];
    expect(normalizeSlateValue(value, null, OPTS).value).toBe(value);
  });
});

describe('depth decides the downgrade', () => {
  // Nothing declared but `b`/`i` denied — the DS spells them `strong`/`em`.
  const rules = { allowedStyles: null, disallowedStyles: ['b', 'blockquote'], allowedMarks: null, disallowedMarks: null };

  test('a TOP-LEVEL node is retyped: it has to stay a block element', () => {
    const out = normalizeSlateValue([el('blockquote', 'quoted')], rules, { defaultBlockType: 'p' });
    expect(out.value).toEqual([p('quoted')]);
  });

  test('an INLINE node unwraps — retyping it to `p` would nest p inside p', () => {
    const value = [p('a ', el('b', 'bold'), ' word')];
    const out = normalizeSlateValue(value, rules, { defaultBlockType: 'p' });
    expect(out.value).toEqual([
      { type: 'p', children: [{ text: 'a ' }, { text: 'bold' }, { text: ' word' }] },
    ]);
  });

  test('an alias still wins over both, at any depth', () => {
    const value = [p(el('b', 'bold'))];
    const out = normalizeSlateValue(value, rules, { aliases: { b: 'strong' }, defaultBlockType: 'p' });
    expect(out.value).toEqual([p(el('strong', 'bold'))]);
  });
});

describe('undefinedSlateTypes', () => {
  test('a type nothing defines is reported, with where it sits', () => {
    const value = [el('p', 'ok'), el('marquee', 'what is this')];
    expect(undefinedSlateTypes(value, null)).toEqual([
      { path: [1], type: 'marquee' },
    ]);
  });

  test('volto-slate\'s own vocabulary is defined, plugins included', () => {
    const value = [
      el('h2', 'a'), el('blockquote', 'b'), el('ul', el('li', 'c')),
      el('p', el('strong', 'd'), el('code', 'e'),
        { type: 'link', data: { url: '/x' }, children: [{ text: 'f' }] }),
    ];
    expect(undefinedSlateTypes(value, null)).toEqual([]);
  });

  test('h5 has no element renderer in volto-slate — it is NOT defined by default', () => {
    expect(undefinedSlateTypes([el('h5', 'deep heading')], null)).toEqual([
      { path: [0], type: 'h5' },
    ]);
  });

  test('a region that ALLOWS a style thereby defines it', () => {
    const rules = foldSlateStyleRules(null, { allowedStyles: ['p', 'h5'] });
    expect(undefinedSlateTypes([el('h5', 'deep heading')], rules)).toEqual([]);
  });

  test('being DISALLOWED is a different finding — not "undefined"', () => {
    const rules = foldSlateStyleRules(null, { disallowedStyles: ['blockquote'] });
    expect(undefinedSlateTypes([el('blockquote', 'q')], rules)).toEqual([]);
  });

  test('nested and inline positions are found too', () => {
    const value = [el('p', 'a ', el('bogus', 'b'))];
    expect(undefinedSlateTypes(value, null)).toEqual([
      { path: [0, 1], type: 'bogus' },
    ]);
  });
});

/**
 * A DESIGN SYSTEM style — the style menu's, not slate's own.
 *
 * volto-slate's StyleMenu does not retype the node: `toggleBlockStyleInSelection`
 * writes `styleName: "nsw-small"` (space separated when several apply). So a
 * rule naming node types could never reach one, and the allow-list had nothing
 * to say about the styles a design system actually ships — the case it exists
 * for. They are keyed by their CSS class with a leading dot, the same shape
 * getSlateVocabulary reports them under (`.nsw-small`), which is what keeps a
 * class called `p` from colliding with the element type `p`.
 */
describe('design-system styles (styleName)', () => {
  const FOOTER_ONLY = {
    allowedStyles: null,
    disallowedStyles: ['.nsw-small'],
    allowedMarks: null,
    disallowedMarks: null,
  };
  const styled = (styleName, text) => ({ type: 'p', styleName, children: [{ text }] });

  test('a disallowed style is stripped, and the node keeps everything else', () => {
    const value = [styled('nsw-small', 'fine print')];
    const out = normalizeSlateValue(value, FOOTER_ONLY, OPTS);
    expect(out.value).toEqual([{ type: 'p', children: [{ text: 'fine print' }] }]);
    expect(out.changes[0]).toMatchObject({ from: '.nsw-small', to: null, kind: 'style-name' });
  });

  test('only the disallowed one goes; the rest of the list survives', () => {
    const value = [styled('nsw-intro nsw-small', 'lede')];
    const out = normalizeSlateValue(value, FOOTER_ONLY, OPTS);
    expect(out.value[0].styleName).toBe('nsw-intro');
  });

  test('an allowed style is untouched, by reference', () => {
    const value = [styled('nsw-intro', 'lede')];
    expect(normalizeSlateValue(value, FOOTER_ONLY, OPTS).value).toBe(value);
  });

  test('where nothing is declared, every style stays', () => {
    const value = [styled('nsw-small', 'fine print')];
    expect(normalizeSlateValue(value, null, OPTS).value).toBe(value);
  });

  test('a style is asked about by its dotted key', () => {
    expect(isStyleAllowed('.nsw-small', FOOTER_ONLY)).toBe(false);
    expect(isStyleAllowed('.nsw-intro', FOOTER_ONLY)).toBe(true);
    // The element type `p` is a different thing from a class called `p`.
    expect(isStyleAllowed('p', FOOTER_ONLY)).toBe(true);
  });
});
