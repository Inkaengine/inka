/**
 * slate-md -- the shared slate <-> markdown core, extracted from blockmd.mjs so
 * the prototype-mapping engine uses it without depending on the (doomed)
 * directive-format converter. Pure conversion: mdast<->slate, the <block> tag
 * scanner (tagOf/fmtTagAttrs), interpolation Templates/Refs, and slate tables.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkDefinitionList from 'remark-definition-list';
import { Parser as HtmlParser } from 'htmlparser2';

export const mdParser = unified().use(remarkParse).use(remarkGfm).use(remarkDefinitionList);
export const mdSerializer = unified()
  .use(remarkStringify, { bullet: '-', emphasis: '*', strong: '*', fences: true, rule: '-' })
  .use(remarkGfm)
  .use(remarkDefinitionList);

/**
 * Page fields that are NOT carried: server state, or derived from the tree.
 *
 * This is a denylist on purpose. It began as an allowlist of authored fields,
 * which silently dropped everything nobody had thought to enumerate: a Link's
 * `remoteUrl` -- its entire target -- and every Event's start, end, location
 * and contact details. An allowlist loses data quietly for each new content
 * type; a denylist keeps it and only drops what is known to be noise.
 */
export const MARK_KEYS = { strong: 'bold', emphasis: 'italic', delete: 'strikethrough' };

/** mdast inline nodes -> slate children. */
export function inlineToSlate(nodes) {
  const out = [];
  for (const n of nodes || []) {
    switch (n.type) {
      case 'text':
        out.push({ text: n.value });
        break;
      case 'inlineCode':
        // Stored content uses a code NODE (859 of them) not a {code:true}
        // mark. Both exist in the data; emit the dominant form.
        out.push({ type: 'code', children: [{ text: n.value }] });
        break;
      case 'strong':
        out.push({ type: 'strong', children: inlineToSlate(n.children) });
        break;
      case 'emphasis':
        out.push({ type: 'em', children: inlineToSlate(n.children) });
        break;
      case 'delete':
        out.push({ type: 'del', children: inlineToSlate(n.children) });
        break;
      case 'link':
        out.push({ type: 'link', data: { url: n.url }, children: inlineToSlate(n.children) });
        break;
      case 'break':
        // Inverse of the hard-break emit: fold back into the previous leaf so
        // the text node matches what was stored.
        if (out.length && out[out.length - 1].text !== undefined && !out[out.length - 1].type) {
          out[out.length - 1].text += '\n';
        } else {
          out.push({ text: '\n' });
        }
        break;
      default:
        if (n.children) out.push(...inlineToSlate(n.children));
        else if (n.value != null) out.push({ text: String(n.value) });
    }
  }
  // Merge adjacent plain leaves. Folding hard breaks back into text produces
  // several leaves where storage had one, which is semantically identical but
  // does not compare equal.
  const merged = [];
  for (const n of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.text !== undefined && !prev.type && n.text !== undefined && !n.type
        && Object.keys(prev).length === 1 && Object.keys(n).length === 1) {
      prev.text += n.text;
    } else merged.push(n);
  }
  return merged.length ? merged : [{ text: '' }];
}

export function listToSlate(node) {
  const items = (node.children || []).map((li) => {
    // A list item's children are usually a single paragraph.
    const kids = (li.children || []).flatMap((c) =>
      c.type === 'paragraph' ? inlineToSlate(c.children) : blockToSlate(c));
    return { type: 'li', children: kids.length ? kids : [{ text: '' }] };
  });
  return { type: node.ordered ? 'ol' : 'ul', children: items };
}

/** One mdast block node -> one slate top-level node. */
export function blockToSlate(n, shift = 0) {
  switch (n.type) {
    case 'paragraph':
      return [{ type: 'p', children: inlineToSlate(n.children) }];
    case 'heading':
      // `shift` undoes the offset the emitter applied inside a repeating
      // container; see mdToSlate.
      return [{ type: `h${Math.min(6, Math.max(1, n.depth - shift))}`,
                children: inlineToSlate(n.children) }];
    case 'list':
      return [listToSlate(n)];
    case 'blockquote':
      // Slate stores blockquote text as inline children, so unwrap a wrapping
      // paragraph (the inverse of slateBlockToMdast); keep other block children.
      return [{ type: 'blockquote', children: (n.children || []).flatMap((c) => (
        c.type === 'paragraph' ? inlineToSlate(c.children) : blockToSlate(c, shift))) }];
    case 'code':
      return [{ type: 'p', children: [{ type: 'code', children: [{ text: n.value ?? '' }] }] }];
    case 'thematicBreak':
      return [];
    default:
      return n.children ? [{ type: 'p', children: inlineToSlate(n.children) }] : [];
  }
}

/**
 * markdown -> slate value.
 *
 * Returns a LIST of top-level nodes. docs/visual-editing.md says a slate value
 * always holds exactly one; stored content disagrees (43 of 997 hold more —
 * grid cards are a bold lead-in plus a body paragraph), so this does not
 * enforce the invariant.
 */
/**
 * markdown -> slate value.
 *
 * `shift` is the heading offset applied by the enclosing repeating container.
 * Inside `::::panels[object_list]{repeat="h2" …}` a child's own `## heading`
 * would be indistinguishable from the boundary that starts the next panel, so
 * the emitter writes it two levels deeper and the reader lifts it back. That
 * makes nesting unambiguous by construction rather than by hoping the author
 * kept their headings below the split.
 */
export function mdToSlate(md, shift = 0) {
  const tree = mdParser.parse(md);
  const out = (tree.children || []).flatMap((n) => blockToSlate(n, shift));
  return out.length ? out : [{ type: 'p', children: [{ text: '' }] }];
}

// slate -> mdast
export function slateInlineToMdast(nodes) {
  const out = [];
  for (const n of nodes || []) {
    if (n.text !== undefined && !n.type) {
      // A newline inside a text leaf would reparse as a paragraph break.
      // markdown's hard break keeps it inside the same node.
      if (n.text.includes('\n') && !n.code) {
        const parts = n.text.split('\n');
        // Drop a trailing empty part: a newline at the very end of a paragraph
        // carries no meaning and would serialise to a dangling "\" that
        // reparses as a literal backslash.
        while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
        parts.forEach((part, idx) => {
          if (idx) out.push({ type: 'break' });
          if (part) out.push({ type: 'text', value: part });
        });
        continue;
      }
      let node = { type: 'text', value: n.text };
      // Marks nest outward; order is fixed so serialisation is stable.
      for (const [mdType, slateKey] of Object.entries(MARK_KEYS)) {
        if (n[slateKey]) node = { type: mdType, children: [node] };
      }
      if (n.code) node = { type: 'inlineCode', value: n.text };
      out.push(node);
      continue;
    }
    // An inline element with no content serialises to a bare "**" or "*",
    // which markdown reads back as literal asterisks. Stored content contains
    // several of these (empty strong/em left behind by editing).
    if (n.children && !plaintextOf(n.children) && n.type !== 'link' && n.type !== 'a') continue;
    switch (n.type) {
      case 'strong': case 'b':
        out.push({ type: 'strong', children: slateInlineToMdast(n.children) }); break;
      case 'em': case 'i':
        out.push({ type: 'emphasis', children: slateInlineToMdast(n.children) }); break;
      case 'del':
        out.push({ type: 'delete', children: slateInlineToMdast(n.children) }); break;
      case 'code':
        out.push({ type: 'inlineCode', value: plaintextOf(n.children) }); break;
      case 'link': case 'a':
        out.push({ type: 'link', url: n.data?.url ?? n.url ?? '',
                   children: slateInlineToMdast(n.children) }); break;
      default:
        out.push(...slateInlineToMdast(n.children));
    }
  }
  return out;
}

export function slateBlockToMdast(n, shift = 0) {
  const t = n.type;
  if (/^h[1-6]$/.test(t)) {
    return { type: 'heading', depth: Math.min(6, +t[1] + shift),
             children: slateInlineToMdast(n.children) };
  }
  if (t === 'ul' || t === 'ol') {
    return {
      type: 'list', ordered: t === 'ol', spread: false,
      children: (n.children || []).map((li) => {
        // A list item's inline content is one paragraph; a nested list is a
        // block child of the item, not inline -- flattening it (the old
        // behaviour) dropped the sub-list.
        const kids = li.children || [];
        const nested = kids.filter((c) => c.type === 'ul' || c.type === 'ol');
        const inline = kids.filter((c) => c.type !== 'ul' && c.type !== 'ol');
        return {
          type: 'listItem', spread: false,
          children: [
            { type: 'paragraph', children: slateInlineToMdast(inline) },
            ...nested.map((sub) => slateBlockToMdast(sub, shift)),
          ],
        };
      }),
    };
  }
  if (t === 'blockquote') {
    // Slate stores a blockquote's text as INLINE children directly; markdown
    // requires block content, so wrap inline children in a paragraph. (A
    // blockquote that already holds block children keeps them.)
    const kids = n.children || [];
    const isBlock = (c) => /^(p|h[1-6]|ul|ol|blockquote)$/.test(c.type || '');
    const children = kids.length && kids.every(isBlock)
      ? kids.map((c) => slateBlockToMdast(c, shift))
      : [{ type: 'paragraph', children: slateInlineToMdast(kids) }];
    return { type: 'blockquote', children };
  }
  return { type: 'paragraph', children: slateInlineToMdast(n.children) };
}

export function slateToMd(value, shift = 0) {
  const tree = { type: 'root', children: (value || []).map((n) => slateBlockToMdast(n, shift)) };
  return mdSerializer.stringify(tree).trim();
}


/**
 * Does this slate value survive a markdown round-trip?
 *
 * Not all valid slate can be written as markdown. An editor can produce
 * adjacent emphasis nodes, a text leaf containing a bare "*", emphasis
 * boundaries that no markdown delimiters can reproduce. Those are legal slate
 * and the format must not lose them.
 *
 * So rather than enumerate markdown's limitations, the emitter CHECKS: if the
 * prose does not come back identical, that block falls back to raw slate in
 * the escape hatch. Losslessness becomes a property of the design instead of a
 * statistic we measure afterwards.
 */
export function plaintextOf(v) {
  let s = '';
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      if (typeof n.text === 'string') s += n.text;
      (n.children || []).forEach(walk);
    }
  };
  walk(v);
  return s;
}

// ------------------------------------------------------------ attributes ---
/** A value that can live in {attrs}: scalar, single-line, not enormous. */
export function tagOf(line) {
  const t = line.trim();
  if (!t.startsWith('<') || !t.endsWith('>')) return null;
  // htmlparser2 discards an unmatched closing tag without emitting anything,
  // so that one case is recognised here. It carries no attributes, which is
  // the only thing worth handing to a parser.
  const close = /^<\/([A-Za-z][\w-]*)\s*>$/.exec(t);
  if (close) return { kind: 'close', name: close[1], attrs: {} };
  let out = null, texts = 0;
  const parser = new HtmlParser({
    onopentag(name, attrs) { out = { kind: 'open', name, attrs }; },
    onclosetag(name, implied) { if (!implied) out = out ?? { kind: 'close', name, attrs: {} }; },
    ontext(x) { if (x.trim()) texts += 1; },
  }, { lowerCaseAttributeNames: false, lowerCaseTags: false, recognizeSelfClosing: true });
  parser.write(t);
  parser.end();
  if (!out || texts) return null;
  if (out.kind === 'open' && /\/>$/.test(t)) out.kind = 'self';
  return out;
}

/**
 * Block fields -> HTML attributes.
 *
 * A string becomes an ordinary attribute; anything that is not a string goes
 * into one `data` attribute as JSON. HTML attribute values are string-typed,
 * so `collapsed="false"` could not say whether it meant the boolean or the
 * word -- putting non-strings in JSON removes the question rather than
 * inventing a convention to answer it.
 *
 * Attribute NAMES must be legal HTML. `@type` is not: GitHub escapes the whole
 * tag and renders it as visible text, where an unknown-but-legal tag is
 * stripped cleanly. So `@type` travels as `type` on the tag and stays `@type`
 * inside the JSON.
 */
export function fmtTagAttrs(fields) {
  const attrs = [], data = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;          // an absent field is not an empty one
    if (v instanceof Template) { attrs.push(`${k}="${v.text}"`); continue; }
    if (typeof v === 'string' && !v.includes('"') && !v.includes('\n') && v.length <= 200) {
      attrs.push(`${k}="${v}"`);
    } else data[k] = v;
  }
  if (Object.keys(data).length) {
    // The attribute is single-quoted so the JSON's own double quotes need no
    // escaping; an apostrophe inside the data would otherwise close it early
    // (one slateTable's text contains "editor's" and truncated the whole
    // block). `&` first, or the escapes escape each other.
    const json = JSON.stringify(data).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    attrs.push(`data-json='${json}'`);
  }
  return attrs.join(' ');
}

export class Template {
  constructor(text) { this.text = text; }
  /** The whole value is one reference — hand back the referenced type. */
  get whole() {
    const m = /^\$\{([^}]+)\}$/.exec(this.text);
    return m ? new Ref(m[1]) : null;
  }
}

/**
 * A reference: `part`, `N/part`, or `N.../hK`.
 *
 * The part vocabulary belongs to markdown's constructs, not to any block type,
 * which is what keeps the mechanism general.
 */
export class Ref {
  constructor(spec) {
    // `2.../blocks_layout` -- constructs 2 onward, as a nested region. The
    // remainder of a group is how a repeating container holds child BLOCKS
    // rather than scalars: an accordion panel is a heading plus a whole
    // blocks_layout region, and its own headings sit below the split level so
    // the boundary stays unambiguous.
    const rest = /^(\d+)\.\.\.\/([A-Za-z]\w*)$/.exec(spec);
    if (rest) {
      this.index = Number(rest[1]) - 1;
      this.rest = true;
      this.part = rest[2];
      return;
    }
    const one = /^(?:(\d+)\/)?([A-Za-z]\w*)$/.exec(spec);
    if (!one) {
      throw new Error(`Bad reference "${spec}": expected part or N/part.`);
    }
    this.index = one[1] ? Number(one[1]) - 1 : null;
    this.part = one[2];
  }
}


// ------------------------------------------------- native markdown fields ---
/**
 * Some fields have a native markdown spelling: a heading block IS a heading, a
 * codeExample tab IS a heading plus a fenced code block. Writing them as
 * attributes or fenced JSON is the format failing at its one job.
 *
 * How to lay a block out is decided at CONVERSION time, from markdown-roles
 * (which names block types). What comes out records that decision in its own
 * attributes, so reading it needs nothing:
 *
 *     :::codeExample{uid="ce-8" tabs="${1.../h3}" tabs.label="${text}"
 *                    tabs.language="${lang}" tabs.code="${code}"}
 *     ### Nuxt.js
 *     ```vue
 *     <template>…</template>
 *     ```
 *     :::
 */

export function renderTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const cellText = (c) => {
    const v = c.value;
    // Only a single paragraph fits a markdown cell; anything else has to stay
    // in the data rather than be flattened into one.
    if (!Array.isArray(v) || v.length !== 1 || v[0].type !== 'p') return null;
    return slateToMd([{ type: 'p', children: v[0].children }]).replace(/\n/g, ' ').replace(/\|/g, '\\|');
  };
  const out = [];
  for (const [i, row] of rows.entries()) {
    const cells = row.cells.map(cellText);
    if (cells.some((c) => c === null)) return null;
    out.push(`| ${cells.join(' | ')} |`);
    if (i === 0) out.push(`| ${cells.map(() => '---').join(' | ')} |`);
  }
  return out.join('\n');
}

/** Build the markdown for one construct from its parts. */
