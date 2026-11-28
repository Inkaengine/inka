/**
 * What a served content tree gets from the frontend's block schemas, after it is
 * read. Markdown decodes from the page alone (blockmd never sees a schema); these
 * are the steps that need to know what a frontend's blocks are: which field is a
 * link to summarise, what a block's schema is, for an example page to show, and
 * what a block's search text is.
 */
import { searchTextOptions, withSearchableText } from '@volto-hydra/helpers/searchableText.js';
import { linkItemSnapshot } from '@volto-hydra/helpers/linkItem.js';
import { buildBlockPathMap } from '@volto-hydra/helpers/buildBlockPathMap.js';
import { getBlockByPath, updateBlockById, regionSlotId } from '@volto-hydra/helpers/blockPath.js';
import { buildIdFieldMap } from '@volto-hydra/helpers/buildBlockPathMap.js';
import { getChildFields, getChildBlockEntries, setChildBlockEntries } from '@volto-hydra/helpers';
import { resolveEffectiveBlockSchema } from '@volto-hydra/helpers/blockSync.js';

/** Build a `schemaFor(type) -> blockSchema` lookup from a block-schema registry.
 *  Handles both shapes the project uses:
 *   - FLAT (`shared-block-schemas` `sharedBlocksConfig`): `{ type: { blockSchema } }`
 *     — the complete registry the frontends register from (every block type).
 *   - PAGE-GROUPED (`block-definitions.json`): `{ pageKey: { blocks: { type: { blockSchema } } } }`.
 *  Using the same registry the frontends use means a schema shown on a doc page
 *  is the one that actually renders. */
export function schemaRegistryFromBlockDefinitions(registry) {
  const byType = new Map();
  for (const [key, def] of Object.entries(registry || {})) {
    if (def && def.blockSchema) byType.set(key, def.blockSchema);          // flat
    for (const [type, d] of Object.entries((def && def.blocks) || {})) {   // page-grouped
      if (d && d.blockSchema) byType.set(type, d.blockSchema);
    }
  }
  return (type) => byType.get(type);
}

/**
 * Fill a page's `<block is="codeExample" source="<type>" format="schema">` with
 * that block type's schema, from the registry the frontends register from: the
 * schema a doc page shows is the one that validates. blockmd's decode fills the
 * `format="json"` ones, which show a block from the same page. A type with no
 * schema fails loud: a doc that can't show its own example is a bug, not a blank.
 */
export function resolveSchemaExamples(page, { schemaFor }) {
  for (const [id, b] of Object.entries(page.blocks ?? {})) {
    if (b['@type'] !== 'codeExample' || b.format !== 'schema') continue;
    const schema = schemaFor(b.source);
    if (!schema) throw new Error(`codeExample ${id}: no schema for "${b.source}" in the block-definitions registry`);
    b.tabs = [{ '@id': `${id}-schema`, '@type': 'tab', label: 'Schema', language: 'json', code: JSON.stringify(schema, null, 2) }];
    // Consumed into `tabs`: never served, and a markdown export writes the
    // directive back from the source (restore-directives).
    delete b.source; delete b.format; delete b.filter;
  }
  return page;
}

// The markdown mount stores a link to a local object as the bare, non-stale
// reference `[{'@id':'/path'}]` — the readable form, and the one that can't go
// stale because the label lives on the target, not the link. Volto snapshots a
// block link's summary at edit time and NEVER re-resolves it, so the
// DISTRIBUTION this builds (what gets imported) must already carry the summary,
// or the deployed teaser/link ships with no title/description. So fill it after
// decode, from the local target — driven by the WIDGET (an `object_browser`
// field), never the field name: `href` is object_browser on a teaser but a
// plain url string on a card, so only the schema knows which is a link. A
// `url`-widget field is an external string and is left alone; an `@id` that
// resolves to no local object (external / not in this tree) stays bare.
//
// A TEXT link's snapshot is the same story: the link editor keeps the picked
// item's catalog metadata beside the link's address (`data.item`, a file's type
// and size a frontend draws after the link), and Markdown writes the link alone.
// `catalogEntry` gives an item's catalog entry, as a search returns it; the
// snapshot is the link editor's own (linkItemSnapshot). A link already carrying
// one keeps it.
// The summary of a link's target, as Volto snapshots it when the link is picked.
function linkSummary(id, target) {
  // Mirror the server serializer's teaser summary. image_field names WHICH
  // field a teaser pulls its preview from: an Image / a lead `image` field ->
  // 'image'; a `preview_image` -> 'preview_image'; nothing -> '' (no preview).
  const leadImage = !!(target.image && (target.image.blob_path || target.image.width));
  const hasPreview = !!(target.preview_image || target['@type'] === 'Image');
  const imageField = (target['@type'] === 'Image' || leadImage) ? 'image'
    : (hasPreview ? 'preview_image' : '');
  return {
    '@id': id,
    '@type': target['@type'],
    Title: target.title ?? null,
    Description: target.description ?? '',
    title: target.title ?? null,
    head_title: target.head_title ?? null,
    getRemoteUrl: target.getRemoteUrl ?? null,
    hasPreviewImage: hasPreview,
    image_field: imageField,
  };
}

// Every object_browser value of a block, at any depth, replaced with fn(value):
// its own fields, the fields of its object_list items, and the blocks either
// holds. `visit(block)` is called on each block reached.
function mapLinkFields(block, schemaFor, fn, visit = () => {}) {
  if (!block || typeof block !== 'object') return;
  visit(block);
  const schema = block['@type'] ? schemaFor(block['@type']) : null;
  if (schema && schema.properties) {
    for (const [field, def] of Object.entries(schema.properties)) {
      const v = block[field];
      if (v == null) continue;
      if (def.widget === 'object_browser') {
        block[field] = fn(v);
      } else if (def.widget === 'object_list' && Array.isArray(v) && def.schema && def.schema.properties) {
        // Items are block instances; their object_browser fields, and any
        // content blocks they hold (a teaser inside a panel).
        const itemProps = def.schema.properties;
        for (const item of v) {
          if (!item || typeof item !== 'object') continue;
          for (const [f, d] of Object.entries(itemProps)) {
            if (d.widget === 'object_browser' && item[f] != null) item[f] = fn(item[f]);
          }
          if (item.blocks && typeof item.blocks === 'object') {
            for (const child of Object.values(item.blocks)) mapLinkFields(child, schemaFor, fn, visit);
          }
        }
      }
    }
  }
  // A container block holds its children in a shared `blocks` dict; a link
  // nested in a column / accordion panel is one too.
  if (block.blocks && typeof block.blocks === 'object' && !Array.isArray(block.blocks)) {
    for (const child of Object.values(block.blocks)) mapLinkFields(child, schemaFor, fn, visit);
  }
}

export function resolveLinkSummaries(items, { schemaFor, prefix = '', catalogEntry = null }) {
  const localId = (id) => (prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id) || '/';
  const isBareLink = (o) => o && typeof o === 'object' && !Array.isArray(o)
    && typeof o['@id'] === 'string' && Object.keys(o).length === 1;

  // Fill a single object_browser field value in place. The widget stores the
  // object-list-of-one shape Volto uses, `[{'@id'}]`; a value already carrying a
  // summary (the snapshot form) is left untouched, so this only ever ENRICHES a
  // bare reference and can't overwrite authored data.
  const fillField = (value) => {
    if (!Array.isArray(value)) return value;
    return value.map((el) => {
      if (!isBareLink(el)) return el;
      const target = items.get(localId(el['@id']));
      return target ? linkSummary(el['@id'], target) : el; // unresolvable -> keep bare
    });
  };

  // Every text link in a value: a slate node `{ type: 'link', data: { url } }`.
  const fillTextLinks = (value) => {
    if (!catalogEntry || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(fillTextLinks); return; }
    if (value.type === 'link' && typeof value.data?.url === 'string' && !value.data.item) {
      const target = items.get(localId(value.data.url.split('#')[0]));
      if (target) value.data = { ...value.data, item: linkItemSnapshot(catalogEntry(target)) };
    }
    if (Array.isArray(value.children)) fillTextLinks(value.children);
  };

  const fillTextLinksOf = (block) => {
    for (const v of Object.values(block)) if (Array.isArray(v)) fillTextLinks(v);
  };

  for (const [, page] of items) {
    if (page.blocks && typeof page.blocks === 'object') {
      for (const block of Object.values(page.blocks)) mapLinkFields(block, schemaFor, fillField, fillTextLinksOf);
    }
  }
  return items;
}

/**
 * The page with each link field's summary left out where loading puts the same
 * one back (resolveLinkSummaries): what a Markdown export writes, the link
 * alone, as it writes a text link. A summary that differs from its target's
 * (a snapshot from before the target changed) is the content's, and stays.
 * `targetOf(id)`: the item a link's `@id` names, or null.
 */
export function withoutLinkSummaries(page, { schemaFor, targetOf }) {
  if (!page.blocks) return page;
  const blocks = structuredClone(page.blocks);
  const strip = (value) => (Array.isArray(value) ? value.map((el) => {
    if (!el || typeof el !== 'object' || typeof el['@id'] !== 'string' || Object.keys(el).length === 1) return el;
    const target = targetOf(el['@id']);
    return target && JSON.stringify(el) === JSON.stringify(linkSummary(el['@id'], target)) ? { '@id': el['@id'] } : el;
  }) : value);
  for (const block of Object.values(blocks)) mapLinkFields(block, schemaFor, strip);
  return { ...page, blocks };
}

const SEARCH_INTL = { formatMessage: (message) => message?.defaultMessage ?? '' };

// `full`, with each `searchableText` the content already had kept in its place.
function keepStored(stored, full) {
  if (Array.isArray(full)) return full.map((item, i) => keepStored(stored?.[i], item));
  if (!full || typeof full !== 'object') return full;
  const out = { ...full };
  for (const [key, value] of Object.entries(full)) {
    if (key !== 'searchableText' && stored && key in stored) out[key] = keepStored(stored[key], value);
  }
  if (stored?.searchableText) out.searchableText = stored.searchableText;
  return out;
}

/**
 * The page with search text on every block that has none: the text the editor's
 * save would write, from the frontend's blocks config (its schemas, and a block
 * type's `searchableFields`). Content read from disk was never saved; a block
 * whose content stores its search text keeps it.
 */
export function withMissingSearchText(page, blocksConfig) {
  if (!page.blocks) return page;
  return keepStored(page, withSearchableText(page, searchTextOptions(blocksConfig, SEARCH_INTL, page)));
}

// `stored` without each `searchableText` that `derived` has the same, at the same place.
function dropDerived(stored, derived) {
  if (Array.isArray(stored)) return stored.map((item, i) => dropDerived(item, derived?.[i]));
  if (!stored || typeof stored !== 'object') return stored;
  const out = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key === 'searchableText' && value === derived?.searchableText) continue;
    out[key] = dropDerived(value, derived?.[key]);
  }
  return out;
}

/**
 * The page without the search text the frontend would give it anyway: what a markdown
 * export leaves out, so a page reads clean and loads back the same (withMissingSearchText
 * fills it again). Search text set to something else is the page's own, and is kept.
 */
export function withoutDefaultSearchText(page, blocksConfig) {
  if (!page.blocks) return page;
  return dropDerived(page, withSearchableText(page, searchTextOptions(blocksConfig, SEARCH_INTL, page)));
}

// A field's declared, fixed default (not a function of where the block sits).
// Not a region's: a blocks_layout region keeps its children in the block's
// `blocks` and `blocks_layout`, never under its own name, and its default lists
// the blocks a new one starts with.
const fixedDefaults = (schema) => Object.entries(schema?.properties ?? {})
  .filter(([, def]) => def && def.default !== undefined && typeof def.default !== 'function'
    && def.widget !== 'object' && def.widget !== 'blocks_layout');

/** Every block of a page, nested ones too, rewritten by `fn(block, schema, type)`
 *  against the block's effective schema (its variation's, enhanced). The block is
 *  as stored: a list item typed by its own field (a form's `field_type`) is not
 *  given the `@type` that reading it as a block shows (getBlockById). */
function eachBlockWithSchema(page, blocksConfig, fn) {
  if (!page.blocks) return page;
  const pathMap = buildBlockPathMap(page, blocksConfig, SEARCH_INTL);
  let out = page;
  for (const [id, info] of Object.entries(pathMap)) {
    if (!info?.path) continue; // a virtual block (a template's), not in the page
    const block = getBlockByPath(out, info.path);
    if (!block) continue;
    const schema = resolveEffectiveBlockSchema(id, out, pathMap, blocksConfig, SEARCH_INTL);
    if (!schema) continue;
    const next = fn(block, schema, info.blockType ?? block['@type'], info.path.join('/'));
    if (next !== block) out = updateBlockById(out, pathMap, id, next);
  }
  return out;
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The page without the values its schemas declare as defaults: what a markdown
 * export leaves out, so a question reads without `required="false"`. The editor
 * applies a default and saves it, and a frontend renders the stored value, so
 * loading puts each back (withSchemaDefaults).
 */
// `keep(type, field, value)`: a default to keep anyway -- one the block's
// prototype states as that literal, which its bare Markdown implies (an
// image's `size="l"`), so dropping it would leave the bare form unable to read
// back. See statedDefaults.
//
// A default is only left out when loading puts it back: some come from the
// block itself (a listing in a container defaults its item type to the one it
// holds), and without the value there is no default to fill. So the page is
// filled again and any value that did not come back is kept, until none is lost.
export function withoutSchemaDefaults(page, blocksConfig, { keep = () => false } = {}) {
  if (!page.blocks) return page;
  const paths = Object.entries(buildBlockPathMap(page, blocksConfig, SEARCH_INTL))
    .filter(([, info]) => info?.path).map(([id, info]) => [id, info.path]);
  const kept = new Set(); // `${path}|${field}` that loading could not restore
  for (;;) {
    const out = eachBlockWithSchema(page, blocksConfig, (block, schema, type, path) => {
      let next = block;
      for (const [field, def] of fixedDefaults(schema)) {
        if (keep(type, field, def.default) || kept.has(`${path}|${field}`)) continue;
        if (field in next && sameValue(next[field], def.default)) {
          if (next === block) next = { ...block };
          delete next[field];
        }
      }
      return next;
    });
    const back = withSchemaDefaults(out, blocksConfig);
    let lost = false;
    for (const [, path] of paths) {
      const was = getBlockByPath(page, path);
      const now = getBlockByPath(back, path);
      if (!was || !now) continue;
      for (const field of Object.keys(was)) {
        if (!sameValue(was[field], now[field]) && !kept.has(`${path.join('/')}|${field}`)) {
          kept.add(`${path.join('/')}|${field}`);
          lost = true;
        }
      }
    }
    if (!lost) return out;
  }
}

/**
 * `keep` for withoutSchemaDefaults: the values each block type's prototypes
 * state as literals, at any depth (an image's `size="l"`). A default is kept
 * only where a prototype states that same value. Another variant stating the
 * field differently (a table's `headerMode="col"`) is no reason to keep the
 * default: the bare variant reads it back, and kept, it matches no variant.
 */
export function statedDefaults(protos) {
  const stated = new Map(); // type -> field -> literals
  const walk = (list) => {
    for (const p of list ?? []) {
      for (const [field, value] of Object.entries(p.fields ?? {})) {
        if (typeof value === 'string' && value.trim().startsWith('${')) continue;
        if (!stated.has(p.type)) stated.set(p.type, new Map());
        const fields = stated.get(p.type);
        if (!fields.has(field)) fields.set(field, []);
        fields.get(field).push(value);
      }
      for (const r of p.regions ?? []) walk(r.protos);
    }
  };
  walk(protos);
  // A literal is written in the Markdown as text (`size="l"`, `:gap="false"`),
  // so it states a value when it is the value or spells it.
  const states = (literal, value) => sameValue(literal, value) || (typeof literal === 'string' && literal === String(value));
  return (type, field, value) => (stated.get(type)?.get(field) ?? []).some((literal) => states(literal, value));
}

/** The page with each absent field its schema declares a default for set to
 *  it, as the editor saves it. Only ABSENT: a stored null stays null. */
export function withSchemaDefaults(page, blocksConfig) {
  return eachBlockWithSchema(page, blocksConfig, (block, schema) => {
    let out = block;
    for (const [field, def] of fixedDefaults(schema)) {
      if (!(field in out)) {
        if (out === block) out = { ...block };
        out[field] = structuredClone(def.default);
      }
    }
    return out;
  });
}

/**
 * Each block of the page rewritten, at every depth, with `fn(child, slot)` for a
 * child of the same template instance as its block, `slot` being the name the
 * editor gives it (regionSlotId: the block's slot and the region). `outward`:
 * rewrite a child after what is inside it (its slot names its own children's),
 * else before.
 */
function mapInstanceChildren(page, blocksConfig, fn, outward) {
  if (!page.blocks) return page;
  const idFieldMap = buildIdFieldMap(blocksConfig, SEARCH_INTL);
  const visit = (block) => {
    if (!block || typeof block !== 'object') return block;
    let out = block;
    for (const field of getChildFields(block, idFieldMap, { allObjectLists: true })) {
      let changed = false;
      const entries = getChildBlockEntries(out, field).map(({ id, block: child }) => {
        const ours = child && block.templateInstanceId && block.slotId && child.templateInstanceId === block.templateInstanceId;
        const slot = ours ? regionSlotId(block.slotId, field.region) : null;
        const next = !ours ? visit(child) : outward ? fn(visit(child), slot) : visit(fn(child, slot));
        if (next !== child) changed = true;
        return { id, block: next };
      });
      if (changed) {
        if (out === block) out = { ...block };
        setChildBlockEntries(out, field, entries);
      }
    }
    return out;
  };
  return { ...page, blocks: Object.fromEntries(Object.entries(page.blocks).map(([id, b]) => [id, visit(b)])) };
}

/** The page without each template child's slot named from its region: what a
 *  markdown export leaves out (withRegionSlots names it again). */
export function withoutRegionSlots(page, blocksConfig) {
  return mapInstanceChildren(page, blocksConfig, (child, slot) => {
    if (child.slotId !== slot) return child;
    const { slotId, ...rest } = child;
    return rest;
  }, true);
}

/** The page with each template child that has no slot given the one the editor
 *  names from its region, as inheritTemplateMembershipDeep does. */
export function withRegionSlots(page, blocksConfig) {
  return mapInstanceChildren(page, blocksConfig, (child, slot) => (child.slotId ? child : { ...child, slotId: slot }), false);
}
