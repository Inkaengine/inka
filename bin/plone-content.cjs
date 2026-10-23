#!/usr/bin/env node
/**
 * CLI for the plone-content-validator. Usage:
 *   plone-content validate [<content-dir>]   — export-shape validation
 *   plone-content check    [<content-dir>]   — graph integrity check
 *   plone-content schema   [<content-dir>] --schemas <schemas.json>
 *                                            — every block field no schema declares, and
 *                                              everything the editor would refuse or rewrite
 *   plone-content all      [<content-dir>]   — validate + check (+ schema with --schemas)
 *   --allow-missing-blobs                    — a blob with no bytes on disk is a warning, not
 *                                              an error: generated media (a recorded clip,
 *                                              a screenshot) that CI makes after the change
 *                                              listing it is merged. Never on a deploy.
 *   --exempt-slot <slotId>                    — (repeatable) don't check the PLACEMENT of
 *                                              blocks in that template slot
 *   --json <report.json>                     — also write the report as data:
 *                                              { <check>: { errors, warnings, stats } }
 *   plone-content served                     — the whole site the mock API serves for
 *                                              CONTENT_MOUNTS (every mount together), the
 *                                              same check that stops the mock starting
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
const { validate, checkIntegrity, checkBlockSchemas, checkEditorRules, checkChooserGroups, fieldMapFromSchemas, loadSchemas, formatReport } = require(
  path.join(__dirname, '..', 'tests-playwright', 'fixtures', 'plone-content-validator.cjs'),
);

function usage() {
  console.error(
    'Usage: plone-content <validate|check|schema|all> [<content-dir>] ' +
      '[--schemas <schemas.json>] [--exempt-slot <slot>]... [--json <report.json>] [--allow-missing-blobs]\n' +
      '       plone-content served   (reads CONTENT_MOUNTS)',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);

if (argv[0] === 'served') {
  // Loading the mock runs the check; it rejects `ready` with the problems
  // already listed on stderr. Exit explicitly: its content watchers would
  // otherwise keep the process alive.
  const { ready } = require(path.join(__dirname, '..', 'tests-playwright', 'fixtures', 'mock-plone-api.cjs'));
  ready.then(
    () => { console.log('[content-check] served content is valid'); process.exit(0); },
    (err) => { console.error(`[content-check] ${err.message}`); process.exit(1); },
  );
  return;
}

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
// Template slots whose blocks are placed deliberately where the editor would
// not put them (a documentation page's examples). Repeatable.
const allowMissingBlobs = argv.includes('--allow-missing-blobs');
if (allowMissingBlobs) argv.splice(argv.indexOf('--allow-missing-blobs'), 1);
const exemptSlots = [];
for (let slot = takeFlag('--exempt-slot'); slot; slot = takeFlag('--exempt-slot')) exemptSlots.push(slot);

(async () => {
const schemas = schemasPath ? await loadSchemas(schemasPath) : null;

const [cmd, dirArg] = argv;
// Anything left over is a flag this CLI does not know: ignoring it would run a
// different check from the one asked for.
if (!cmd || !['validate', 'check', 'schema', 'all'].includes(cmd) || argv.length > 2) usage();
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
let idFieldMap = null;
if (schemas) {
  const { buildIdFieldMap } = require('../packages/hydra-js/buildBlockPathMap.js');
  idFieldMap = buildIdFieldMap(schemas, { formatMessage: (m) => m?.defaultMessage || '' });
}

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
    const rules = await checkEditorRules(contentDir, schemas, { exemptSlots });
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
  }
}

if (jsonPath) fs.writeFileSync(path.resolve(jsonPath), `${JSON.stringify(report, null, 2)}\n`);
process.exit(hasErrors ? 1 : 0);
})();
