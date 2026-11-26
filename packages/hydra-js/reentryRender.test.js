import { describe, test, expect } from 'vitest';
import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * RE-ENTRY RENDER HARNESS + data-driven cases.
 *
 * The frontend renderer (block.vue) is recursive: it expands a field, renders each
 * output block, and for a CONTAINER re-invokes expand() on that container's
 * children — once per region, recursively, in order. That per-level re-entry is
 * the path that actually breaks (infinite recursion → Vue "Maximum call stack size
 * exceeded" → blank render), and nothing unit-tested it: the other suites do a
 * single top-level expand and inspect the output tree.
 *
 * `renderReentry` does the re-entry expand once, here, so every case below is just
 * page+template JSON in → rendered JSON out → assert. No copy-pasted recursion.
 *
 * Each re-entry uses a FRESH templateState on purpose: across the renderer's call
 * boundary the merge's `nestedContainers` reference-recognition is NOT reliably
 * available (the data arrives as Vue reactive proxies / postMessage-serialized
 * copies, not the registered raw object). So a correct merge must terminate from
 * the DATA — nested CONTENT carries no `templateId`, so it is passed through and
 * the recursion bottoms out. A regression that stamps `templateId` onto nested
 * content makes every level re-apply the whole template → the depth guard fires.
 */
const DEPTH_CAP = 30;

const isContainer = (b) =>
  b && b.blocks && typeof b.blocks === 'object' && !Array.isArray(b.blocks) && b.blocks_layout;

function renderReentry(layout, blocks, { templates = {}, allowedLayouts } = {}) {
  // ONE shared templateState — the renderer injects a single one and passes it to
  // every expand call (top-level + every nested re-entry). The re-entry is given the
  // SAME blocks object the merge emitted (the frontend must pass raw data — toRaw,
  // not a Vue proxy or a clone), so the reference-keyed nestedContainers lookup HITS
  // and the container is recognised as already-expanded content (rendered, not
  // re-applied). Passing a clone/proxy here would miss recognition and re-apply —
  // that's the frontend-usage bug this models the CORRECT side of. The result is
  // assembled back into a tree so callers can assert the fully-rendered output.
  const ts = {};

  const renderLevel = (lay, blks, allowed, depth) => {
    if (depth > DEPTH_CAP) {
      throw new Error(
        `renderReentry: runaway recursion at depth ${depth} — a nested level is ` +
          `re-applying its template instead of passing through`,
      );
    }
    const items = expandTemplatesSync(lay, {
      blocks: blks || {},
      templates,
      templateState: ts,
      ...(allowed ? { allowedLayouts: allowed } : {}),
    });
    return items.map((block) => {
      if (!isContainer(block)) return block;
      const newBlocks = {};
      const newLayout = {};
      for (const [region, ids] of Object.entries(block.blocks_layout)) {
        if (!Array.isArray(ids)) { newLayout[region] = ids; continue; }
        // Same object the merge emitted — no clone (the frontend toRaw's its data).
        const children = renderLevel(ids, block.blocks, null, depth + 1);
        newLayout[region] = children.map((c) => c['@uid']);
        for (const c of children) newBlocks[c['@uid']] = c;
      }
      return { ...block, blocks: newBlocks, blocks_layout: newLayout };
    });
  };

  return renderLevel(layout, blocks, allowedLayouts, 0);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

// All-fixed branded footer: columns -> column -> slate, every block fixed+readOnly
// with a slotId. The nested blocks have NO templateId (only the top carries one,
// stamped on apply). This is the shape that loops if nested content gets templateId.
const footerTemplate = {
  '@id': '/t/footer',
  blocks: {
    cols: {
      '@type': 'columns', fixed: true, readOnly: true, templateId: '/t/footer', slotId: 'cols',
      blocks: {
        'col-1': {
          '@type': 'column', fixed: true, readOnly: true, templateId: '/t/footer', slotId: 'col-1',
          blocks: { 'txt-1': { '@type': 'slate', fixed: true, readOnly: true, templateId: '/t/footer', slotId: 'txt-1', value: [{ text: 'Footer text' }] } },
          blocks_layout: { items: ['txt-1'] },
        },
      },
      blocks_layout: { columns: ['col-1'] },
    },
  },
  blocks_layout: { items: ['cols'] },
};

// Flat layout: fixed header, a default slot, fixed footer.
const flatTemplate = {
  '@id': '/t/flat',
  blocks: {
    h: { '@type': 'slate', fixed: true, readOnly: true, slotId: 'header', value: [{ text: 'H' }] },
    d: { '@type': 'slate', slotId: 'default' },
    f: { '@type': 'slate', fixed: true, readOnly: true, slotId: 'footer', value: [{ text: 'F' }] },
  },
  blocks_layout: { items: ['h', 'd', 'f'] },
};

// Deep-slot layout: the editable `default` slot lives INSIDE a nested column,
// between two fixed blocks. Tests that PAGE slot content lands in the right place
// deep in the tree on refresh — the case emphasized in review.
// Containers are fixed but NOT readOnly so rule 3 recurses into them; the deep
// `default` slot is editable. (A readOnly container would instead "just insert the
// template's" and drop the page's nested edits — a separate rule, worth its own case.)
const deepSlotTemplate = {
  '@id': '/t/deepslot',
  blocks: {
    cols: {
      '@type': 'columns', fixed: true, templateId: '/t/deepslot', slotId: 'cols',
      blocks: {
        col: {
          '@type': 'column', fixed: true, templateId: '/t/deepslot', slotId: 'col',
          blocks: {
            h: { '@type': 'slate', fixed: true, readOnly: true, templateId: '/t/deepslot', slotId: 'ch', value: [{ text: 'H' }] },
            d: { '@type': 'slate', templateId: '/t/deepslot', slotId: 'default' },
            f: { '@type': 'slate', fixed: true, readOnly: true, templateId: '/t/deepslot', slotId: 'cf', value: [{ text: 'F' }] },
          },
          blocks_layout: { items: ['h', 'd', 'f'] },
        },
      },
      blocks_layout: { columns: ['col'] },
    },
  },
  blocks_layout: { items: ['cols'] },
};

// A /t/deepslot instance whose column already holds user content in the deep
// default slot. A refresh must keep it in place, between the refreshed fixed
// header/footer.
const deepSlotPageBlocks = {
  pc: {
    '@type': 'columns', fixed: true, slotId: 'cols',
    templateId: '/t/deepslot', templateInstanceId: 'inst-1',
    blocks: {
      pcol: {
        '@type': 'column', fixed: true, slotId: 'col', templateInstanceId: 'inst-1',
        blocks: {
          ph: { '@type': 'slate', slotId: 'ch', templateInstanceId: 'inst-1', value: [{ text: 'old H' }] },
          puser: { '@type': 'slate', slotId: 'default', templateInstanceId: 'inst-1', value: [{ text: 'USER' }] },
          pf: { '@type': 'slate', slotId: 'cf', templateInstanceId: 'inst-1', value: [{ text: 'old F' }] },
        },
        blocks_layout: { items: ['ph', 'puser', 'pf'] },
      },
    },
    blocks_layout: { columns: ['pcol'] },
  },
};

// Fixed but NOT readOnly: the block's POSITION is locked, but its CONTENT is
// editable and belongs to the page. A nested fixed-non-readonly block must keep
// the page's edited value, not revert to the template default (the editable-fixed
// flow, top level handles it via existingFixedBlockIds). `h` here is fixed (not a
// slot, not readOnly); the page's `ph` (same slotId) holds an edited value.
const fixedEditableTemplate = {
  '@id': '/t/fixededit',
  blocks: {
    cols: {
      '@type': 'columns', fixed: true, templateId: '/t/fixededit', slotId: 'cols',
      blocks: {
        col: {
          '@type': 'column', fixed: true, templateId: '/t/fixededit', slotId: 'col',
          blocks: {
            h: { '@type': 'slate', fixed: true, templateId: '/t/fixededit', slotId: 'ch', value: [{ text: 'TEMPLATE H' }] },
          },
          blocks_layout: { items: ['h'] },
        },
      },
      blocks_layout: { columns: ['col'] },
    },
  },
  blocks_layout: { items: ['cols'] },
};

const fixedEditablePageBlocks = {
  pc: {
    '@type': 'columns', fixed: true, slotId: 'cols',
    templateId: '/t/fixededit', templateInstanceId: 'fe-1',
    blocks: {
      pcol: {
        '@type': 'column', fixed: true, slotId: 'col', templateInstanceId: 'fe-1',
        blocks: {
          ph: { '@type': 'slate', fixed: true, slotId: 'ch', templateInstanceId: 'fe-1', value: [{ text: 'PAGE H EDITED' }] },
        },
        blocks_layout: { items: ['ph'] },
      },
    },
    blocks_layout: { columns: ['pcol'] },
  },
};

// ── Cases ────────────────────────────────────────────────────────────────────

const cases = [
  {
    name: 'forced all-fixed footer: nested columns render, re-entry terminates',
    layout: [],
    blocks: {},
    templates: { '/t/footer': footerTemplate },
    allowedLayouts: ['/t/footer'],
    check: (out) => {
      const cols = out.find((b) => b['@type'] === 'columns');
      expect(cols).toBeDefined();
      const col1 = cols.blocks[cols.blocks_layout.columns[0]];
      const txt1 = col1.blocks[col1.blocks_layout.items[0]];
      expect(txt1.value).toEqual([{ text: 'Footer text' }]);

      // Model invariant: EVERY block keeps templateId (same-template nesting shares
      // the instance's templateId + instanceId at every depth). Recognition of an
      // already-expanded re-entry is via the shared templateState, not the absence
      // of templateId.
      expect(cols.templateId).toBe('/t/footer');
      expect(col1.templateId).toBe('/t/footer');
      expect(txt1.templateId).toBe('/t/footer');
      expect(col1.templateInstanceId).toBe(cols.templateInstanceId);
      expect(txt1.templateInstanceId).toBe(cols.templateInstanceId);
    },
  },
  {
    name: 'flat layout: user content fills the default slot, fixed header/footer applied',
    layout: ['u1'],
    blocks: { u1: { '@type': 'slate', value: [{ text: 'U' }] } },
    templates: { '/t/flat': flatTemplate },
    allowedLayouts: ['/t/flat'],
    check: (out) => {
      expect(out.map((b) => b.value?.[0]?.text)).toEqual(['H', 'U', 'F']);
    },
  },
  {
    // A non-fixed slot is a placeholder filled by matching slotId from the page,
    // and the content moves to wherever the slot sits in the template — even when
    // that slot is deep inside a nested container. `puser` (slotId 'default')
    // must land in the column's deep default slot, between the refreshed fixed
    // header/footer.
    name: 'deep slot: page block with matching slotId fills the deep default slot, between fixed neighbours',
    layout: ['pc'],
    blocks: deepSlotPageBlocks,
    templates: { '/t/deepslot': deepSlotTemplate },
    allowedLayouts: ['/t/deepslot'],
    check: (out) => {
      const cols = out.find((b) => b['@type'] === 'columns');
      expect(cols).toBeDefined();
      const col = cols.blocks[cols.blocks_layout.columns[0]];
      const texts = col.blocks_layout.items.map((id) => col.blocks[id].value?.[0]?.text);
      expect(texts).toEqual(['H', 'USER', 'F']);
    },
  },
  {
    name: 'fixed non-readonly: nested block keeps the page edited value, not the template default',
    layout: ['pc'],
    blocks: fixedEditablePageBlocks,
    templates: { '/t/fixededit': fixedEditableTemplate },
    allowedLayouts: ['/t/fixededit'],
    check: (out) => {
      const cols = out.find((b) => b['@type'] === 'columns');
      expect(cols).toBeDefined();
      const col = cols.blocks[cols.blocks_layout.columns[0]];
      const h = col.blocks[col.blocks_layout.items[0]];
      expect(h.value?.[0]?.text).toBe('PAGE H EDITED');
    },
  },
  {
    // Multiple page blocks sharing one slotId must ALL fill the deep slot, in order,
    // between the fixed neighbours — the deep analogue of the flat "collects multiple
    // blocks per slot" rule.
    name: 'multiple per slot (deep): two page blocks with the same slotId fill the deep slot in order',
    layout: ['pc'],
    blocks: {
      pc: {
        '@type': 'columns', fixed: true, slotId: 'cols',
        templateId: '/t/deepslot', templateInstanceId: 'm-1',
        blocks: {
          pcol: {
            '@type': 'column', fixed: true, slotId: 'col', templateInstanceId: 'm-1',
            blocks: {
              ph: { '@type': 'slate', slotId: 'ch', templateInstanceId: 'm-1', value: [{ text: 'old H' }] },
              pu1: { '@type': 'slate', slotId: 'default', templateInstanceId: 'm-1', value: [{ text: 'U1' }] },
              pu2: { '@type': 'slate', slotId: 'default', templateInstanceId: 'm-1', value: [{ text: 'U2' }] },
              pf: { '@type': 'slate', slotId: 'cf', templateInstanceId: 'm-1', value: [{ text: 'old F' }] },
            },
            blocks_layout: { items: ['ph', 'pu1', 'pu2', 'pf'] },
          },
        },
        blocks_layout: { columns: ['pcol'] },
      },
    },
    templates: { '/t/deepslot': deepSlotTemplate },
    allowedLayouts: ['/t/deepslot'],
    check: (out) => {
      const cols = out.find((b) => b['@type'] === 'columns');
      const col = cols.blocks[cols.blocks_layout.columns[0]];
      const texts = col.blocks_layout.items.map((id) => col.blocks[id].value?.[0]?.text);
      expect(texts).toEqual(['H', 'U1', 'U2', 'F']);
    },
  },
];

describe('re-entry render harness', () => {
  for (const c of cases) {
    // `failing: true` marks a known, captured bug — test.fails passes
    // while the test fails and FLIPS to a failure once the bug is fixed (prompting
    // removal of the flag). Keeps the suite green while documenting the defect.
    const t = c.failing ? test.fails : test;
    t(c.name, () => {
      const out = renderReentry(c.layout, c.blocks, { templates: c.templates, allowedLayouts: c.allowedLayouts });
      c.check(out);
    });
  }

  test('idempotent: re-entering the deep-slot tree twice yields identical output', () => {
    const opts = { templates: { '/t/deepslot': deepSlotTemplate }, allowedLayouts: ['/t/deepslot'] };
    const once = renderReentry(['pc'], deepSlotPageBlocks, opts);
    const twice = renderReentry(['pc'], deepSlotPageBlocks, opts);
    // Deterministic ids (no foreign-template UUIDs) + same content → identical tree.
    expect(twice).toEqual(once);
  });
});
