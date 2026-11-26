/**
 * The text styles in a slate value — element types, and a design system's own
 * styles — each with the first text that carries it. Pure, so block discovery
 * (CommonJS) and the style measurement in the sanity suite read content the
 * same way.
 */
/** Every element `type` in a slate value, at any depth, with its text. */
export function slateStyles(value) {
  const out = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const text = plainText(node).trim();
    // A style with no text of its own cannot be located in the DOM, so we can't
    // measure it — don't claim coverage we didn't take.
    if (text) {
      if (typeof node.type === 'string' && !out.has(node.type)) {
        out.set(node.type, text);
      }
      // A design system's OWN styles, which Volto's style menu stores in TWO
      // different shapes — both have to be counted or half the menu goes
      // unmeasured:
      //   block  -> `styleName` on the element, space separated
      //   inline -> a leaf MARK named `style-<cssClass>` (StyleMenu/utils.js
      //             toggleInlineStyleInSelection → Editor.addMark)
      // Prefixed with a dot so a DS class can never collide with an element type.
      if (typeof node.styleName === 'string') {
        for (const cls of node.styleName.split(/\s+/).filter(Boolean)) {
          if (!out.has(`.${cls}`)) out.set(`.${cls}`, text);
        }
      }
      for (const key of Object.keys(node)) {
        const cls = node[key] && /^style-(.+)$/.exec(key)?.[1];
        if (cls && !out.has(`.${cls}`)) out.set(`.${cls}`, text);
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(value);
  return out;
}

function plainText(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(plainText).join('');
}
