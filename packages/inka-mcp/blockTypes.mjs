/**
 * list_block_types: the block types an agent can add to a page, their fields,
 * and where child blocks go — shaped from the admin's getBlockSchemas (which
 * resolves what each region allows by the editor's own rules).
 *
 * Only types reachable from the page's own regions are listed. A region is
 * named as the agent sees it in get_page (`blocks` for the usual `items`), and
 * fields that hold child blocks are listed as regions, not fields. Items of a
 * list region without types of their own (an accordion's panels) are the
 * `<block>:<field>` types the admin registers for them.
 */

const listName = (region) => (region === 'items' ? 'blocks' : region);

function regionOut(r) {
  return {
    field: [...(r.regionPath ?? []), listName(r.region)].join('.'),
    allowed: r.allowedBlocks,
    ...(r.isObjectList && { list: true }),
    ...(r.maxLength && { maxLength: r.maxLength }),
  };
}

function fieldsOut(blockSchema, regionFields) {
  const required = new Set(blockSchema.required);
  const fields = {};
  for (const [name, facts] of Object.entries(blockSchema.properties)) {
    if (regionFields.has(name)) continue;
    fields[name] = {
      ...facts,
      ...(required.has(name) && { required: true }),
      ...(facts.widget === 'slate' && { markdown: true }),
    };
  }
  return fields;
}

export function describeBlockTypes({ page, types }) {
  const out = {};
  const visit = (allowed, where) => {
    for (const type of allowed) {
      if (out[type]) continue;
      const t = types[type];
      if (!t) throw new Error(`${where} allows "${type}", which no block config describes`);
      const regionFields = new Set(t.regions.filter((r) => !r.regionPath).map((r) => r.region));
      out[type] = { title: t.title, fields: fieldsOut(t.blockSchema, regionFields), regions: t.regions.map(regionOut) };
      for (const r of t.regions) visit(r.allowedBlocks, `${type}'s ${r.region}`);
    }
  };
  for (const r of page.regions) visit(r.allowedBlocks, `the page's ${r.region}`);

  return { page: page.regions.map(regionOut), types: out };
}

/**
 * describe_block: one type in full — its fields and regions as list_block_types
 * gives them, its description and variations, and where on this page it can
 * go (the page's own regions and the containers' regions that allow it).
 */
export function describeBlockType(schemas, type) {
  const t = schemas.types[type];
  if (!t) throw new Error(`no block type "${type}" (list_block_types lists what this page can hold)`);
  const regionFields = new Set(t.regions.filter((r) => !r.regionPath).map((r) => r.region));
  const allowedIn = [
    ...schemas.page.regions.filter((r) => r.allowedBlocks.includes(type)).map((r) => `the page's ${regionOut(r).field}`),
    ...Object.entries(schemas.types).flatMap(([container, c]) => c.regions
      .filter((r) => r.allowedBlocks.includes(type))
      .map((r) => `${container}'s ${regionOut(r).field}`)),
  ];
  return {
    type,
    title: t.title,
    ...(t.description !== undefined && { description: t.description }),
    variations: t.variations,
    fields: fieldsOut(t.blockSchema, regionFields),
    regions: t.regions.map(regionOut),
    allowedIn,
  };
}
