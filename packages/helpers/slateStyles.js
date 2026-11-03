/**
 * Declarative allow-list of slate styles, resolved per REGION (#295).
 *
 * A design system can say which slate formats exist for it. Hiding a toolbar
 * button doesn't do that: `blockquote` also arrives by paste, by hotkey and by
 * the `>`-space markdown shortcut, so an allow-list only means something if one
 * vocabulary drives every surface AND normalizes what is already stored.
 *
 * DECLARATION — four optional keys on any `widget: 'blocks_layout'` property,
 * beside the `allowedBlocks` that governs block types:
 *
 *   items: {
 *     widget: 'blocks_layout',
 *     allowedStyles:    ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em'],
 *     disallowedStyles: ['blockquote'],
 *     allowedMarks:     null,
 *     disallowedMarks:  ['highlight'],
 *   }
 *
 * There is no separate global level: the `_page` schema's blocks fields ARE the
 * outermost regions, so declaring there is site-wide. There is no per-field
 * level either — every slate value belongs to a block, and every block to a
 * region, so the region chain already reaches all of them.
 *
 * `allowedStyles` names element `type` values. That covers block-level formats
 * (`p`, `h2`, `ul`, `li`) AND the inline ones, because volto-slate models bold
 * and italic as inline ELEMENTS (`MarkElementButton` → `toggleInlineFormat`,
 * `editor/config.jsx`), not as leaf marks — one vocabulary, matching what the
 * toolbar actually toggles. `allowedMarks` covers true leaf marks
 * (`Editor.addMark`), which only plugins use.
 *
 * INHERITANCE — rules fold root → leaf: a deny ACCUMULATES (a ban at the page
 * level is final for the whole subtree), an allow REPLACES (a nested region
 * restates its own list, and may widen). Intersecting instead would make an
 * inner region unable to widen, which reads as a bug when you list `h2` and it
 * never appears.
 *
 * Declaring nothing anywhere yields `null` — unrestricted, today's behaviour.
 * This file is Volto-free on purpose: the bridge, the addon and bare-node tests
 * all import it (same reason `buildBlockPathMap.js` lives here).
 */

/**
 * Types that carry data, not styling. Retyping a `link` to `p` would drop its
 * href — normalization must never lose content, so these are exempt from the
 * allow-list rather than trusted to appear in every frontend's list.
 */
const STRUCTURAL_TYPES = new Set(['link']);

/**
 * Block-level slate types — the ones that cannot legally sit inside another
 * block. Only these are collapsed when a denied wrapper is retyped; an INLINE
 * child (`strong`, `em`, a `link`) is valid there and is kept, because
 * flattening it would silently strip the formatting it carries.
 */
const BLOCK_TYPES = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'div', 'pre',
]);

/**
 * Slate element types the system actually DEFINES a rendering for.
 *
 * This is the FALLBACK, for callers with no live registry to read (an offline
 * gate). Anything running inside Volto should pass the real vocabulary instead —
 * `Object.keys(config.settings.slate.elements)` plus the styleMenu's cssClasses
 * — because the registry is OPEN: `slate.elements['blockquote'] = …` is how the
 * Blockquote plugin adds itself, and any addon can do the same.
 *
 * Kept honest by slateVocabulary.test.js, which compares this against the live
 * registry with volto-slate's applyConfig chain run. It is not maintained by
 * hand: the first hand-written version was already missing nine types
 * (callout, img and the seven table elements), which is precisely the drift the
 * test now catches.
 *
 * Note what is NOT here: `h5`/`h6`. They have `blockTagDeserializer` entries, so
 * a paste can produce them, but no element renders either — types the editor can
 * create and then not render, which is exactly what is worth reporting. A
 * region's `allowedStyles` also defines a type, so a frontend that renders `h5`
 * says so by listing it.
 */
export const DEFAULT_SLATE_VOCABULARY = [
  'b', 'blockquote', 'callout', 'code', 'default', 'del', 'div', 'em',
  'h1', 'h2', 'h3', 'h4', 'i', 'li', 'link', 'ol', 'p', 's',
  'strong', 'sub', 'sup', 'u', 'ul',
];

/**
 * Types the editor renders but never STORES: the block emitters
 * (`extractTables`, `extractImages`) lift them out of the slate value into
 * blocks of their own — hydra turns a pasted table into a `slateTable` BLOCK,
 * not slate nodes. They are real mid-paste and absent from saved content, so a
 * stored one means extraction failed. Excluded from the vocabulary so it is
 * REPORTED rather than waved through.
 */
export const EXTRACTED_SLATE_TYPES = [
  'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'img',
];
const KNOWN_SLATE_TYPES = new Set(DEFAULT_SLATE_VOCABULARY);

/** Union two string lists into a new deduped array, or null when both are empty. */
function unionLists(a, b) {
  if (!a?.length && !b?.length) return null;
  const out = [...(a || [])];
  for (const v of b || []) if (!out.includes(v)) out.push(v);
  return out;
}

const DECLARED_KEYS = [
  'allowedStyles',
  'disallowedStyles',
  'allowedMarks',
  'disallowedMarks',
];

/**
 * Fold one region's declaration onto the rules inherited from its ancestors.
 *
 * Returns `inherited` BY REFERENCE when the field declares nothing, so an
 * unchanged subtree allocates nothing and every block in it shares one object
 * (the pathmap entries are serialized to the bridge, so this matters).
 *
 * @param {Object|null} inherited - rules from the containing region, or null
 * @param {Object} fieldDef - a `widget: 'blocks_layout'` / 'object_list' field def
 * @returns {Object|null} resolved rules, or null when nothing is declared anywhere
 */
export function foldSlateStyleRules(inherited, fieldDef) {
  const declares = DECLARED_KEYS.some((k) => fieldDef?.[k]?.length);
  if (!declares) return inherited || null;
  return {
    // allow REPLACES
    allowedStyles: fieldDef.allowedStyles?.length
      ? [...fieldDef.allowedStyles]
      : inherited?.allowedStyles || null,
    allowedMarks: fieldDef.allowedMarks?.length
      ? [...fieldDef.allowedMarks]
      : inherited?.allowedMarks || null,
    // deny ACCUMULATES
    disallowedStyles: unionLists(
      inherited?.disallowedStyles,
      fieldDef.disallowedStyles,
    ),
    disallowedMarks: unionLists(
      inherited?.disallowedMarks,
      fieldDef.disallowedMarks,
    ),
  };
}

function permits(name, allowed, denied) {
  if (denied?.includes(name)) return false;
  if (!allowed) return true;
  return allowed.includes(name);
}

/**
 * May a slate element carry this `type` here?
 * No rules (or a structural type) → yes.
 */
export function isStyleAllowed(type, rules) {
  if (!rules) return true;
  if (STRUCTURAL_TYPES.has(type)) return true;
  return permits(type, rules.allowedStyles, rules.disallowedStyles);
}

/** May a slate leaf carry this mark key here? */
export function isMarkAllowed(mark, rules) {
  if (!rules) return true;
  return permits(mark, rules.allowedMarks, rules.disallowedMarks);
}

/** A slate text leaf: `text` and no `children`. */
function isTextNode(node) {
  return (
    node &&
    typeof node === 'object' &&
    typeof node.text === 'string' &&
    !node.children
  );
}

function normalizeLeaf(node, rules, aliases, path, changes) {
  let out = null;
  for (const key of Object.keys(node)) {
    if (key === 'text' || isMarkAllowed(key, rules)) continue;
    out = out || { ...node };
    delete out[key];
    const alias = aliases[key];
    if (alias && isMarkAllowed(alias, rules)) {
      out[alias] = node[key];
      changes.push({ path, from: key, to: alias, kind: 'mark' });
    } else {
      changes.push({ path, from: key, to: null, kind: 'mark' });
    }
  }
  return out || node;
}

/**
 * What a disallowed element becomes.
 *
 * An alias target that is ITSELF denied is a config error, not a reason to lose
 * content: fall back to the default block type and say so in `configError`, so
 * the report and the console surface it instead of it sitting there silently.
 */
function retypeTarget(type, rules, aliases, defaultBlockType) {
  const alias = aliases[type];
  if (alias) {
    if (isStyleAllowed(alias, rules)) return { to: alias };
    return { to: defaultBlockType, configError: alias };
  }
  return { to: defaultBlockType };
}

/**
 * A design system's own styles ride on `styleName`, not on the node's type:
 * volto-slate's StyleMenu writes `Transforms.setNodes(editor, { styleName })`,
 * space separated when several apply. A rule naming types could never reach
 * one, so the allow-list had nothing to say about the styles a design system
 * actually ships — the case it exists for.
 *
 * Keyed by CSS class with a leading dot (`.nsw-small`), the shape
 * getSlateVocabulary already reports them under, so a class named `p` cannot
 * collide with the element type `p`.
 *
 * Stripped rather than retyped: the node is a perfectly good paragraph, it is
 * only wearing a style this region does not offer. Nothing is deleted but the
 * class.
 */
function normalizeStyleName(node, rules, path, changes) {
  if (!rules || typeof node.styleName !== 'string') return node;
  const tokens = node.styleName.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => isStyleAllowed(`.${t}`, rules));
  if (kept.length === tokens.length) return node;
  for (const t of tokens) {
    if (!kept.includes(t)) {
      changes.push({ path, from: `.${t}`, to: null, kind: 'style-name' });
    }
  }
  const out = { ...node };
  if (kept.length) out.styleName = kept.join(' ');
  else delete out.styleName;
  return out;
}


function normalizeNodes(nodes, rules, opts, parentPath, changes) {
  const { aliases, defaultBlockType } = opts;
  let out = null; // stays null while nothing has changed
  const write = (i, replacement) => {
    out = out || [...nodes];
    out[i] = replacement;
  };

  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    const path = [...parentPath, i];

    if (isTextNode(node)) {
      const leaf = normalizeLeaf(node, rules, aliases, path, changes);
      if (leaf !== node) write(i, leaf);
      continue;
    }
    if (!node || typeof node !== 'object') continue;

    // The design system's own styles, which sit BESIDE the type rather than in
    // it — a styled paragraph stays a paragraph, so this runs before (and
    // independently of) the retyping below.
    const styled = normalizeStyleName(node, rules, path, changes);
    if (styled !== node) {
      write(i, styled);
      node = styled;
    }

    const kids = Array.isArray(node.children) ? node.children : null;

    if (isStyleAllowed(node.type, rules)) {
      if (!kids) continue;
      const nextKids = normalizeNodes(kids, rules, opts, path, changes);
      if (nextKids !== kids) write(i, { ...node, children: nextKids });
      continue;
    }

    // Disallowed, and no alias to rename it to. DEPTH decides what happens:
    //
    //   deeper than the top — it is inline (`b` inside a `p`), and retyping it
    //     to `p` would nest a paragraph inside a paragraph. Unwrap: the children
    //     splice into the parent and the text survives without the formatting.
    //   top level — retype to the default block type. A wrapper of other
    //     elements (a `ul` of `li`s) COLLAPSES: its grandchildren's inline
    //     content is concatenated into that one node.
    //
    // The collapse is the invariant in docs/visual-editing.md — a slate field's
    // value holds exactly ONE top-level node, and renderers are told they may
    // assume it. Splicing the lifted `li`s in as siblings would hand back a
    // two-node value, and a renderer reading value[0] would silently drop every
    // word after the first item. Nothing is ever deleted.
    if (parentPath.length > 0 && kids && !aliases[node.type]) {
      changes.push({ path, from: node.type, to: null, kind: 'style-unwrap' });
      out = out || [...nodes];
      const lifted = normalizeNodes(kids, rules, opts, path, changes);
      out.splice(out.indexOf(node), 1, ...lifted);
      continue;
    }

    const { to, configError } = retypeTarget(
      node.type,
      rules,
      aliases,
      defaultBlockType,
    );
    changes.push({
      path,
      from: node.type,
      to,
      kind: 'style',
      ...(configError && { configError }),
    });
    let nextKids = kids ? normalizeNodes(kids, rules, opts, path, changes) : kids;
    // A retyped top-level wrapper would otherwise become `p > li`. Lift the
    // grandchildren's inline content into it instead, so the result is one
    // well-formed node rather than a paragraph full of list items.
    if (nextKids?.length && nextKids.every((k) => BLOCK_TYPES.has(k?.type) && k.children)) {
      nextKids = nextKids.flatMap((k) => k.children);
    }
    write(i, { ...node, type: to, ...(kids && { children: nextKids }) });
  }

  return out || nodes;
}

/**
 * Downgrade every disallowed node in a slate value.
 *
 * Pure. Returns the SAME array reference when nothing changed, so callers can
 * skip the write — the convention `applySchemaDefaultsToBlock` already uses.
 * Text is never dropped: a node is retyped, aliased, or unwrapped, never
 * deleted.
 *
 * @param {Array} value - a slate value (array of nodes)
 * @param {Object|null} rules - resolved rules from `foldSlateStyleRules`
 * @param {Object} [opts]
 * @param {Object} [opts.aliases] - `config.settings.slate.styleAliases`, e.g. { b: 'strong' }
 * @param {string} [opts.defaultBlockType] - `config.settings.slate.defaultBlockType`
 * @returns {{ value: Array, changes: Array<{path, from, to, kind, configError?}> }}
 */
export function normalizeSlateValue(value, rules, opts = {}) {
  if (!rules || !Array.isArray(value)) return { value, changes: [] };
  const changes = [];
  const normalized = normalizeNodes(
    value,
    rules,
    {
      aliases: opts.aliases || {},
      defaultBlockType: opts.defaultBlockType || 'p',
    },
    [],
    changes,
  );
  return { value: normalized, changes };
}

/**
 * Widgets whose value is a slate value (an array of nodes). `richtext` /
 * `slate_html` store an HTML STRING, so they are not listed — and
 * `normalizeSlateValue` bails on a non-array anyway, so a frontend that uses a
 * widget name we don't know about is left alone rather than mangled.
 */
const SLATE_WIDGETS = new Set(['slate', 'slate_richtext']);

/**
 * Normalize every slate field of one block against its region's rules.
 *
 * Descends `widget: 'object'` sub-schemas so a slate field nested in an object
 * wrapper is reached; object_list items are NOT descended here because each one
 * is its own pathmap entry and the caller's loop already visits it.
 *
 * @param {Object} blockData
 * @param {Object} schema - the block's resolved schema
 * @param {Object|null} rules - resolved rules from `foldSlateStyleRules`
 * @param {Object} [opts] - { aliases, defaultBlockType }
 * @returns {{ block: Object, changes: Array }} `block` is the SAME reference when nothing changed
 */
export function normalizeSlateFields(blockData, schema, rules, opts = {}) {
  const changes = [];
  if (!rules || !blockData || !schema?.properties) {
    return { block: blockData, changes };
  }
  let block = blockData;
  for (const [fieldName, fieldDef] of Object.entries(schema.properties)) {
    if (fieldDef?.widget === 'object' && fieldDef.schema?.properties) {
      const nested = normalizeSlateFields(
        block[fieldName],
        fieldDef.schema,
        rules,
        opts,
      );
      if (nested.block !== block[fieldName]) {
        block = { ...block, [fieldName]: nested.block };
      }
      changes.push(...nested.changes.map((c) => ({ ...c, field: `${fieldName}.${c.field}` })));
      continue;
    }
    if (!SLATE_WIDGETS.has(fieldDef?.widget)) continue;
    const result = normalizeSlateValue(block[fieldName], rules, opts);
    if (result.value !== block[fieldName]) {
      block = { ...block, [fieldName]: result.value };
    }
    changes.push(...result.changes.map((c) => ({ ...c, field: fieldName })));
  }
  return { block, changes };
}

/**
 * Slate nodes whose `type` nothing defines a rendering for.
 *
 * Separate from the allow-list: a DISALLOWED style is a known style the region
 * has turned off (normalization handles it), while an UNDEFINED one is a type
 * no renderer knows — it survives in stored content and shows up as unstyled
 * text, or nothing at all, depending on the frontend. Neither the editor nor the
 * allow-list would ever produce it, so finding one means the content was written
 * by something else (an import, a script, a hand edit).
 *
 * @param {Array} value - a slate value
 * @param {Object|null} rules - resolved rules; a type it ALLOWS counts as defined
 * @param {string[]} [vocabulary] - the types something renders, from the live
 *   registry where there is one. Falls back to DEFAULT_SLATE_VOCABULARY, which
 *   is only correct for a stock volto-slate — an addon that registers its own
 *   element is invisible to it.
 * @returns {Array<{path: number[], type: string}>} empty when everything is known
 */
export function undefinedSlateTypes(value, rules, vocabulary) {
  const known = vocabulary ? new Set(vocabulary) : KNOWN_SLATE_TYPES;
  const found = [];
  const walk = (nodes, parentPath) => {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((node, i) => {
      if (!node || typeof node !== 'object' || isTextNode(node)) return;
      const path = [...parentPath, i];
      if (
        typeof node.type === 'string' &&
        !known.has(node.type) &&
        !rules?.allowedStyles?.includes(node.type)
      ) {
        found.push({ path, type: node.type });
      }
      walk(node.children, path);
    });
  };
  walk(value, []);
  return found;
}
