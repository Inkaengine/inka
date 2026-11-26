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
 *
 * The page itself is a block of its content type (`contentType`): its fields
 * are the page's own (title, summary, …) and its regions hold the blocks.
 */

import { toAgentBlock } from './pageFormat.mjs';

const listName = (region) => (region === 'items' ? 'blocks' : region);

function regionOut(r) {
  return {
    field: [...(r.regionPath ?? []), listName(r.region)].join('.'),
    allowed: r.allowedBlocks,
    ...(r.isObjectList && { list: true }),
    ...(r.maxLength && { maxLength: r.maxLength }),
  };
}

/**
 * What an image or file field takes, said on the field: from `{"widget":
 * "image"}` alone an agent guessed, and put a file's data in an image block,
 * where it was stored as it was and drew nothing (inka#702). `media`: this
 * server keeps the files an agent stages (stage_media, ask_for_files).
 */
function takesOf(facts, { media }) {
  const staged = 'a file of your own: the media id stage_media or ask_for_files gives for it';
  if (facts.widget === 'image') {
    return `an image already on the site, by its path ("/images/team.jpg")${media ? `, or ${staged}` : ''}`;
  }
  if (['Image', 'File'].includes(facts.factory)) {
    return media ? staged
      : 'the file itself: {"data": <base64>, "encoding": "base64", "filename": "team.jpg", "content-type": "image/jpeg"}';
  }
  return undefined;
}

/**
 * A block's fields, each with its facts. A field that is an object of fields
 * of its own (`styles`: alignment, background, …) gives those as `fields`, as
 * a block does, not as the raw schema the editor draws its form from: read as
 * a schema, an agent wrote `styles`' fields at the block's top level, where
 * nothing reads them.
 */
function fieldsOut(blockSchema, regionFields, files) {
  const required = new Set(blockSchema.required);
  const fields = {};
  for (const [name, facts] of Object.entries(blockSchema.properties)) {
    if (regionFields.has(name)) continue;
    const { schema, ...rest } = facts;
    const nested = facts.widget === 'object' && schema?.properties;
    const takes = takesOf(facts, files);
    fields[name] = {
      ...(nested ? rest : facts),
      ...(nested && { fields: fieldsOut(schema, new Set(), files) }),
      ...(required.has(name) && { required: true }),
      ...(facts.widget === 'slate' && { markdown: true }),
      ...(takes && { takes }),
    };
  }
  return fields;
}

export function describeBlockTypes({ page, types }, files) {
  if (typeof files?.media !== 'boolean') throw new Error('describeBlockTypes: say whether this server keeps staged files ({ media })');
  const out = {};
  const visit = (allowed, where) => {
    for (const type of allowed) {
      if (out[type]) continue;
      const t = types[type];
      if (!t) throw new Error(`${where} allows "${type}", which no block config describes`);
      const regionFields = new Set(t.regions.filter((r) => !r.regionPath).map((r) => r.region));
      out[type] = {
        title: t.title,
        ...(t.contentType && { contentType: true }),
        fields: fieldsOut(t.blockSchema, regionFields, files),
        regions: t.regions.map(regionOut),
      };
      for (const r of t.regions) visit(r.allowedBlocks, `${type}'s ${r.region}`);
    }
  };
  if (page.contentType) visit([page.contentType], 'the page');
  for (const r of page.regions) visit(r.allowedBlocks, `the page's ${r.region}`);

  return { page: page.regions.map(regionOut), ...(page.contentType && { contentType: page.contentType }), types: out };
}

/**
 * describe_block: one type in full — its fields and regions as list_block_types
 * gives them, its description and variations, where on this page it can go
 * (the page's own regions and the containers' regions that allow it), and
 * what its front end says of it: `guidance` on using it, and `examples` of it
 * filled in, which the front end declares as stored blocks and the agent gets
 * in its own format.
 */
export function describeBlockType(schemas, type, files) {
  if (typeof files?.media !== 'boolean') throw new Error('describeBlockType: say whether this server keeps staged files ({ media })');
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
    ...(t.contentType && { contentType: true }),
    variations: t.variations,
    fields: fieldsOut(t.blockSchema, regionFields, files),
    regions: t.regions.map(regionOut),
    allowedIn,
    ...(t.guidance !== undefined && { guidance: t.guidance }),
    ...(t.examples !== undefined && { examples: t.examples.map(({ title, block }) => ({ title, block: agentExample(block) })) }),
  };
}

/** An example block in the agent format; its own uid means nothing to the agent. */
function agentExample(block) {
  const { '@uid': _uid, ...rest } = toAgentBlock('example', block);
  return rest;
}
