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
