#!/usr/bin/env node
/**
 * CLI for the plone-content-validator. Usage:
 *   plone-content validate [<content-dir>]   — export-shape validation
 *   plone-content check    [<content-dir>]   — graph integrity check
 *   plone-content schema   [<content-dir>] --schemas <schemas.json>
 *                                            — every block field no schema declares, and
 *                                              everything the editor would refuse or rewrite
 *   plone-content all      [<content-dir>]   — validate + check (+ schema with --schemas)
 *   plone-content search-text [<content-dir>] --schemas <schemas.json>
 *   plone-content field-mappings [<content-dir>] --schemas <schemas.json>
 *   plone-content convert-block --schemas <schemas.json> --to <type>
 *                                            — one block (JSON on stdin) converted to
 *                                              <type> as the editor converts it, through
 *                                              the site's field mappings (JSON on stdout):
 *                                              for a program that makes content outside
 *                                              the editor (a site converter, a migration)
 *                                            — writes each block's searchableText into the
 *                                              content, as the editor does on save: for
 *                                              content that doesn't pass through the editor
 *   --allow-missing-blobs                    — a blob with no bytes on disk is a warning, not
 *                                              an error: generated media (a recorded clip,
 *                                              a screenshot) that CI makes after the change
 *                                              listing it is merged. Never on a deploy.
 *   --exempt-slot <slotId>                    — (repeatable) don't check the PLACEMENT of
 *                                              blocks in that template slot
 *   --content-types <types.json>             — the site's content types, { <type>: the schema
 *                                              its @types/<type> serves }: what a site's own
 *                                              catalog column holds, for a listing mapping one
 *                                              (schema, all, field-mappings)
 *   --json <report.json>                     — also write the report as data:
 *                                              { <check>: { errors, warnings, stats } }
 *
 * <content-dir> defaults to cwd/content. `--schemas` takes the site's block
 * schemas -- the JS module (default export) or JSON file its frontend config
 * loads ({ blockType: { blockSchema,
 * schemaEnhancer? } }): `check` then also checks each field's value against its
 * schema, and `schema` reports fields a block doesn't declare. (`--fields`, a
 * names-only map, still works until every frontend ships schemas.) Keys starting
 * `_` are not blocks: `_page` is the page's own schema, and `_groupBlocksOrder`
 * the frontend's chooser order (voltoConfig.blocks.groupBlocksOrder), which
 * replaces the admin's — every offered block must name one of its groups.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { validate, checkIntegrity, checkBlockSchemas, checkEditorRules, checkChooserGroups, checkFieldsetCoverage, checkReservedFields, checkFieldMappings, checkUndeclaredBlocks, fieldMapFromSchemas, idFieldMapFor, loadSchemas, formatReport } = require('./plone-content-validator.js');

function usage() {
  console.error(
    'Usage: plone-content <validate|check|schema|all|search-text|field-mappings|convert-block> [<content-dir>] ' +
      '[--schemas <schemas.json>] [--content-types <types.json>] [--exempt-slot <slot>]... [--json <report.json>] [--allow-missing-blobs]',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);

const takeFlag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
};
const schemasPath = takeFlag('--schemas');
const noSchemas = argv.includes('--no-schemas') && (argv.splice(argv.indexOf('--no-schemas'), 1), true);
const fieldsPath = takeFlag('--fields');
// The report as data — { <check>: { errors, warnings, stats } } for each
// check run — for a program that acts on it rather than a person reading it.
const jsonPath = takeFlag('--json');
const contentTypesPath = takeFlag('--content-types');
const contentTypes = contentTypesPath ? JSON.parse(fs.readFileSync(path.resolve(contentTypesPath), 'utf8')) : undefined;
// Template slots whose blocks are placed deliberately where the editor would
// not put them (a documentation page's examples). Repeatable.
const allowMissingBlobs = argv.includes('--allow-missing-blobs');
if (allowMissingBlobs) argv.splice(argv.indexOf('--allow-missing-blobs'), 1);
// convert-block: the type to convert the block to.
const toType = takeFlag('--to');
const exemptSlots = [];
for (let slot = takeFlag('--exempt-slot'); slot; slot = takeFlag('--exempt-slot')) exemptSlots.push(slot);

(async () => {
const schemas = schemasPath ? await loadSchemas(schemasPath) : null;

const [cmd, dirArg] = argv;
// Anything left over is a flag this CLI does not know: ignoring it would run a
// different check from the one asked for.
if (!cmd || !['validate', 'check', 'schema', 'all', 'search-text', 'field-mappings', 'convert-block'].includes(cmd) || argv.length > 2) usage();
// One block converted as the editor converts it (convertBlockType, through the
// site's field mappings), for content made outside the editor. A type the block
// does not convert to is an error, never a block of that type with nothing in it.
if (cmd === 'convert-block') {
  if (!schemas) {
    console.error('convert-block needs --schemas <schemas.json>');
    process.exit(2);
  }
  if (!toType) {
    console.error('convert-block needs --to <type>');
    process.exit(2);
  }
  const { convertBlockType } = require('@volto-hydra/helpers/blockSync.js');
  const { getConvertibleTypes } = require('@volto-hydra/helpers/conversionValidation.js');
  const intl = { formatMessage: (m) => m?.defaultMessage || '' };
  const block = JSON.parse(fs.readFileSync(0, 'utf8'));
  const fromType = block['@type'];
  if (!schemas[toType]) {
    console.error(`convert-block: the site has no block type ${toType}`);
    process.exit(1);
  }
  const reachable = getConvertibleTypes(fromType, schemas).map((t) => t.type);
  if (!reachable.includes(toType)) {
    console.error(`convert-block: ${fromType} does not convert to ${toType}`);
    process.exit(1);
  }
  const converted = convertBlockType(block, toType, schemas, '@type', intl);
  // The editor keeps the old type's unmapped fields, so converting back
  // restores them. Content made outside the editor is converted once, and the
  // content check refuses a field its block does not declare: keep only what
  // the new type declares, by the same reckoning the check uses.
  const { blocks: declared, identityFields } = fieldMapFromSchemas(schemas);
  const own = declared[toType];
  const keeps = (field) =>
    own.builtIn ||
    own.fields.includes(field) ||
    identityFields.includes(field) ||
    field === 'blocks' ||
    field === 'blocks_layout' ||
    (own.defaultsPrefix && field.startsWith(`${own.defaultsPrefix}_`));
  const kept = Object.fromEntries(Object.entries(converted).filter(([field]) => keeps(field)));
  process.stdout.write(`${JSON.stringify(kept)}\n`);
  return;
}
// Every data.json under a content tree. An export names its folders by UID, all at
// the top; a layout names them by path, so a page can sit at any depth.
function* pageFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    const file = path.join(sub, 'data.json');
    if (fs.existsSync(file)) yield file;
    yield* pageFiles(sub);
  }
}

// Run `change` over every page with blocks and write back only the pages whose data it
// changes, each in its file's own indentation: content lives in git, and a rewrite in
// another indentation would change every line and hide what the command did. A file
// written on one line stays on one line. Returns how many pages were written.
function rewritePages(contentRoot, change) {
  let pages = 0;
  for (const file of pageFiles(contentRoot)) {
    const before = fs.readFileSync(file, 'utf8');
    const page = JSON.parse(before);
    if (!page.blocks) continue;
    const changed = change(page);
    if (JSON.stringify(changed) === JSON.stringify(page)) continue;
    const indent = before.match(/^\{\r?\n([ \t]*)/)?.[1] ?? '';
    fs.writeFileSync(file, JSON.stringify(changed, null, indent) + (before.endsWith('\n') ? '\n' : ''));
    pages += 1;
  }
  return pages;
}

// What the editor stores on a block with a mapping widget, for content that
// doesn't pass through it: the widget's default where there is none, every
// entry with its conversion, the address under getURL. Only pages it changes
// are written.
if (cmd === 'field-mappings') {
  if (!schemas) {
    console.error('field-mappings needs --schemas <schemas.json>');
    process.exit(2);
  }
  const { withFieldMappings } = require('@volto-hydra/helpers/storeFieldMappings.js');
  const intl = { formatMessage: (m) => m?.defaultMessage || '' };
  const pages = rewritePages(path.resolve(dirArg || 'content'), (page) =>
    withFieldMappings(page, schemas, intl, contentTypes),
  );
  console.log(`field-mappings: ${pages} page(s) written`);
  return;
}
if (cmd === 'search-text') {
  if (!schemas) {
    console.error('search-text needs --schemas <schemas.json>');
    process.exit(2);
  }
  const { searchTextOptions, withSearchableText } = require('@volto-hydra/helpers/searchableText.js');
  const intl = { formatMessage: (m) => m?.defaultMessage || '' };
  const pages = rewritePages(path.resolve(dirArg || 'content'), (page) =>
    withSearchableText(page, searchTextOptions(schemas, intl, page)),
  );
  console.log(`search-text: ${pages} page(s) written`);
  return;
}
if (cmd === 'schema' && !schemas && !fieldsPath) {
  console.error('schema needs --schemas <schemas.json>');
  process.exit(2);
}
// `check` and `all` without schemas ran a REDUCED check and said nothing about
// it: checkBlockSchemas and checkEditorRules were skipped, and getChildFields
// got no idFieldMap, so every object_list keyed by anything but `@id` went
// unwalked. A gate that quietly tests less than it appears to is worse than no
// gate — a site ran this way and the first run WITH schemas found seven errors
// it had never reported, one of them a block the editor refuses to save.
//
// So refuse. Validating content without its schema is not validation.
// --no-schemas is there for the one honest case (a tree whose site has no
// schema file yet) and it says in the output what is not being checked.
if ((cmd === 'check' || cmd === 'all') && !schemas && !fieldsPath && !noSchemas) {
  console.error(
    `ERROR: ${cmd} needs --schemas <schemas.json>.\n` +
    '\n' +
    '  Without it the block-schema and editor-rule passes do not run at all,\n' +
    '  and object_list regions are not walked. That is a structure-only check,\n' +
    '  and it will report success while a page the editor refuses to save sits\n' +
    '  in the content.\n' +
    '\n' +
    '  If the site genuinely has no schemas yet, pass --no-schemas to say so\n' +
    '  deliberately; the report will state which checks were skipped.',
  );
  process.exit(2);
}

const contentDir = path.resolve(dirArg || 'content');

let hasErrors = false;
const report = {};
if (cmd === 'validate' || cmd === 'all') {
  const r = validate(contentDir, { allowMissingBlobs });
  report.validate = r;
  console.log(formatReport('validate', r));
  if (r.errors.length) hasErrors = true;
}
// The idFieldMap names each block type's object_list fields and the key each
// is addressed by. Without it getChildFields sees only object_lists whose
// items carry templateId, so a form's subblocks or a table's rows go
// unchecked — and any id read from one is bogus. Derived from the site's own
// schemas, so it is only as complete as --schemas.
const idFieldMap = idFieldMapFor(schemas);

if (cmd === 'check' || cmd === 'all') {
  if (cmd === 'all') console.log('');
  const r = checkIntegrity(contentDir, {
    allowMissingBlobs,
    idFieldMap,
    ...(schemas ? { schemasFor: () => schemas } : {}),
  });
  report.check = r;
  console.log(formatReport('check', r));
  if (r.errors.length) hasErrors = true;
}

if (cmd === 'schema' || (cmd === 'all' && (schemas || fieldsPath))) {
  if (cmd === 'all') console.log('');
  const fields = schemas ? fieldMapFromSchemas(schemas) : JSON.parse(fs.readFileSync(path.resolve(fieldsPath), 'utf8'));
  const r = checkBlockSchemas(contentDir, fields, { idFieldMap });
  report.schema = r;
  console.log(formatReport('schema', r));
  if (r.errors.length) hasErrors = true;
  // The rules the editor enforces need the schemas themselves, not a names-only
  // field map: placement, maxLength, required fields and region text styles.
  if (schemas) {
    console.log('');
    const rules = await checkEditorRules(contentDir, schemas, { exemptSlots, contentTypes });
    report.rules = rules;
    console.log(formatReport('rules', rules));
    if (rules.errors.length) hasErrors = true;

    // A defect in the config rather than in any page: a block the chooser
    // cannot offer is unreachable however correct the content is.
    console.log('');
    const chooser = checkChooserGroups(schemas);
    report.chooser = chooser;
    console.log(formatReport('chooser', chooser));
    if (chooser.errors.length) hasErrors = true;

    // Also config, not content: a field no fieldset lists is invisible in the
    // editor, so nobody can see it, change it, or tell whether anything still
    // reads it.
    console.log('');
    const fieldsets = checkFieldsetCoverage(schemas);
    report.fieldsets = fieldsets;
    console.log(formatReport('fieldsets', fieldsets));
    if (fieldsets.errors.length) hasErrors = true;

    console.log('');
    const reserved = checkReservedFields(schemas);
    report.reserved = reserved;
    console.log(formatReport('reserved', reserved));
    if (reserved.errors.length) hasErrors = true;

    // Mappings the editor refuses to load on: a source or destination the
    // schemas don't have, a conversion that can't fill the field, an `@id`.
    console.log('');
    const mappings = checkFieldMappings(schemas);
    report.mappings = mappings;
    console.log(formatReport('mappings', mappings));
    if (mappings.errors.length) hasErrors = true;

    // A region that may hold a block nobody declares: the editor refuses to
    // load on it.
    console.log('');
    const undeclared = checkUndeclaredBlocks(schemas);
    report.undeclared = undeclared;
    console.log(formatReport('undeclared', undeclared));
    if (undeclared.errors.length) hasErrors = true;
  }
}

if (jsonPath) fs.writeFileSync(path.resolve(jsonPath), `${JSON.stringify(report, null, 2)}\n`);
process.exit(hasErrors ? 1 : 0);
})();
