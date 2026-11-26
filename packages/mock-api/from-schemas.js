/**
 * What a served content tree gets from the frontend's block schemas, after it is
 * read. Markdown decodes from the page alone (blockmd never sees a schema); these
 * are the steps that need to know what a frontend's blocks are: which field is a
 * link to summarise, what a block's schema is, for an example page to show, and
 * what a block's search text is.
 */
import { searchTextOptions, withSearchableText } from '@volto-hydra/helpers/searchableText.js';
import { linkItemSnapshot } from '@volto-hydra/helpers/linkItem.js';

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
export function resolveLinkSummaries(items, { schemaFor, prefix = '', catalogEntry = null }) {
  const localId = (id) => (prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id) || '/';
  const isBareLink = (o) => o && typeof o === 'object' && !Array.isArray(o)
    && typeof o['@id'] === 'string' && Object.keys(o).length === 1;

  const summary = (id, target) => {
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
  };

  // Fill a single object_browser field value in place. The widget stores the
  // object-list-of-one shape Volto uses, `[{'@id'}]`; a value already carrying a
  // summary (the snapshot form) is left untouched, so this only ever ENRICHES a
  // bare reference and can't overwrite authored data.
  const fillField = (value) => {
    if (!Array.isArray(value)) return value;
    return value.map((el) => {
      if (!isBareLink(el)) return el;
      const target = items.get(localId(el['@id']));
      return target ? summary(el['@id'], target) : el; // unresolvable -> keep bare
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

  const fillBlock = (block) => {
    if (!block || typeof block !== 'object') return;
    for (const v of Object.values(block)) if (Array.isArray(v)) fillTextLinks(v);
    const schema = block['@type'] ? schemaFor(block['@type']) : null;
    if (schema && schema.properties) {
      for (const [field, def] of Object.entries(schema.properties)) {
        const v = block[field];
        if (v == null) continue;
        if (def.widget === 'object_browser') {
          block[field] = fillField(v);
        } else if (def.widget === 'object_list' && Array.isArray(v) && def.schema && def.schema.properties) {
          // Items are block instances; fill THEIR object_browser fields, and
          // recurse into any content blocks they hold (a teaser inside a panel).
          const itemProps = def.schema.properties;
          for (const item of v) {
            if (!item || typeof item !== 'object') continue;
            for (const [f, d] of Object.entries(itemProps)) {
              if (d.widget === 'object_browser' && item[f] != null) item[f] = fillField(item[f]);
            }
            if (item.blocks && typeof item.blocks === 'object') {
              for (const child of Object.values(item.blocks)) fillBlock(child);
            }
          }
        }
      }
    }
    // A container block holds its children in a shared `blocks` dict; recurse so
    // a link nested in a column / accordion panel is filled too.
    if (block.blocks && typeof block.blocks === 'object' && !Array.isArray(block.blocks)) {
      for (const child of Object.values(block.blocks)) fillBlock(child);
    }
  };

  for (const [, page] of items) {
    if (page.blocks && typeof page.blocks === 'object') {
      for (const block of Object.values(page.blocks)) fillBlock(block);
    }
  }
  return items;
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
