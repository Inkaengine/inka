/**
 * Restore single-source directives after a `--markdown` readability export.
 *
 * The export ships the EXPANSION — a `{literalinclude}` becomes the file's code
 * inline, a codeExample `source=` becomes baked tabs. That is right for the
 * deploy distribution but wrong for the authored MARKDOWN: the source must keep
 * its directive, both to stay single-sourced and to stay readable. So, right
 * before the caller overwrites a source file with its exported version, it
 * scans the CURRENT source (still on disk, directives intact) and puts them
 * back. The source file IS the map.
 *
 * The rule is the same for both directive kinds: take a directive from the
 * source, compute the exact value it expands to, find that value in the export,
 * and swap the directive back in.
 *
 *  - `{literalinclude}`: the value is a code fence (recomputed by re-running the
 *    include). An exact fence, found and replaced wherever it sits — inside a
 *    codeExample or standalone — with no wrapper or field needed.
 *  - codeExample `source=`: the value is the baked `<block type="codeExample">`,
 *    found by its `slotId` (every `source=` block already has one).
 */
import { resolveLiteralIncludes } from './markdown-mount.mjs';

const OPEN_CE = /^<block\s+type="codeExample"/;
const ANY_OPEN_BLOCK = /^<block\b/;
const CLOSE_BLOCK = /^<\/block>/;
const FENCE_LITERALINCLUDE = /```\{literalinclude\}[ \t]+\S+[ \t]*\n[\s\S]*?\n?```/g;

/** Strip a leading YAML frontmatter block so a scan never sees prototype
 *  definitions (which mention `<block type="codeExample">`) as body content. */
function bodyOffset(md) {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(md);
  return m ? m[0].length : 0;
}

/** Pull a slotId from a codeExample's opening line: an attr `slotId="x"` or,
 *  on a baked tag, the `"slotId":"x"` inside its data-json. */
function slotIdOf(openLine) {
  const attr = /\bslotId="([^"]*)"/.exec(openLine);
  if (attr) return attr[1];
  const inJson = /"slotId":"([^"]*)"/.exec(openLine);
  return inJson ? inJson[1] : null;
}

/**
 * Every body `<block type="codeExample">` span, in order, as
 * `{ start, end, text, slotId, isSourceDirective }` (offsets into `md`).
 * Block tags here are line-anchored at column 0, one opening tag per line, so a
 * line scan is reliable even when `data-json` holds a `>`.
 */
export function findCodeExampleBlocks(md) {
  const from = bodyOffset(md);
  const lines = md.slice(from).split('\n');
  const offsets = [];
  { let o = from; for (const l of lines) { offsets.push(o); o += l.length + 1; } }
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN_CE.test(lines[i])) continue;
    const start = offsets[i];
    const selfClose = /\/>\s*$/.test(lines[i]);
    let endLine = i;
    if (!selfClose) {
      let nest = 1;
      let j = i + 1;
      for (; j < lines.length && nest; j++) {
        if (ANY_OPEN_BLOCK.test(lines[j]) && !/\/>\s*$/.test(lines[j])) nest += 1;
        else if (CLOSE_BLOCK.test(lines[j])) nest -= 1;
      }
      if (nest !== 0) throw new Error(`unterminated codeExample block at line ${i + 1}`);
      endLine = j - 1;
    }
    const end = offsets[endLine] + lines[endLine].length;
    blocks.push({ start, end, text: md.slice(start, end), slotId: slotIdOf(lines[i]), isSourceDirective: /\bsource=/.test(lines[i]) });
  }
  return blocks;
}

/** Put each `{literalinclude}` back: recompute its expansion and replace that
 *  exact text in the export with the directive. Processing in source order lets
 *  indexOf consume one occurrence at a time, so identical expansions still map
 *  to distinct directives. */
function restoreLiteralIncludes(sourceMd, baked, baseDir, skipSpans = []) {
  const inSkip = (i) => skipSpans.some(([s, e]) => i >= s && i < e);
  let out = baked;
  for (const m of sourceMd.matchAll(FENCE_LITERALINCLUDE)) {
    if (inSkip(m.index)) continue; // inside a codeExample — restored whole, by slotId
    const directive = m[0];
    const value = resolveLiteralIncludes(directive, baseDir);
    if (value === directive) continue;
    const at = out.indexOf(value);
    if (at < 0) throw new Error(`literalinclude restore: expansion not found in export for ${directive.split('\n')[0]}`);
    out = out.slice(0, at) + directive + out.slice(at + value.length);
  }
  return out;
}

/** Put each directive-bearing codeExample back by slotId: the AUTHORED block is
 *  the single source, so swap the whole baked block (which shipped the
 *  expansion — often as a data-json blob, since a `slotId` keeps the block off
 *  the clean tab form) for the source. Covers both a `source=` codeExample and
 *  one whose body holds a `{literalinclude}`. */
function restoreCodeExampleBlocks(sourceMd, baked) {
  const srcBlocks = findCodeExampleBlocks(sourceMd)
    .filter((b) => b.slotId != null && (b.isSourceDirective || /```\{literalinclude\}/.test(b.text)));
  let out = baked;
  for (const src of srcBlocks) {
    const target = findCodeExampleBlocks(out).find((b) => b.slotId != null && b.slotId === src.slotId);
    if (!target) throw new Error(`codeExample restore: no exported codeExample with slotId "${src.slotId}"`);
    out = out.slice(0, target.start) + src.text + out.slice(target.end);
  }
  return out;
}

/**
 * Restore every single-source directive from `sourceMd` into the exported
 * `bakedMd`. `baseDir` is the source file's directory (for resolving a
 * `{literalinclude}`'s target). Fails loud if an expected value is missing.
 *
 * A directive inside a codeExample is restored whole, by slotId (the block
 * shipped as a data-json blob, so its expansion is JSON-escaped, not verbatim);
 * a STANDALONE `{literalinclude}` (not in a codeExample) is restored by matching
 * its recomputed expansion text — so those spans are skipped in that pass.
 */
export function restoreDirectives(sourceMd, bakedMd, baseDir) {
  const ceSpans = findCodeExampleBlocks(sourceMd).map((b) => [b.start, b.end]);
  return restoreLiteralIncludes(sourceMd, restoreCodeExampleBlocks(sourceMd, bakedMd), baseDir, ceSpans);
}
