#!/usr/bin/env node
/**
 * CLI for the plone-content-validator. Usage:
 *   plone-content validate [<content-dir>]   — export-shape validation
 *   plone-content check    [<content-dir>]   — graph integrity check
 *   plone-content schema   [<content-dir>] --schemas <schemas.json>
 *                                            — every block field no schema declares
 *   plone-content all      [<content-dir>]   — validate + check (+ schema with --schemas)
 *   plone-content served                     — the whole site the mock API serves for
 *                                              CONTENT_MOUNTS (every mount together), the
 *                                              same check that stops the mock starting
 *
 * <content-dir> defaults to cwd/content. `--schemas` takes the site's block
 * schemas, the JSON its frontend config loads ({ blockType: { blockSchema,
 * schemaEnhancer? } }): `check` then also checks each field's value against its
 * schema, and `schema` reports fields a block doesn't declare. (`--fields`, a
 * names-only map, still works until every frontend ships schemas.)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { validate, checkIntegrity, checkBlockSchemas, fieldMapFromSchemas, schemaForFrom, formatReport } = require(
  path.join(__dirname, '..', 'tests-playwright', 'fixtures', 'plone-content-validator.cjs'),
);

function usage() {
  console.error(
    'Usage: plone-content <validate|check|schema|all> [<content-dir>] ' +
      '[--schemas <schemas.json>]\n' +
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
const fieldsPath = takeFlag('--fields');
const schemas = schemasPath ? JSON.parse(fs.readFileSync(path.resolve(schemasPath), 'utf8')) : null;

const [cmd, dirArg] = argv;
if (!cmd || !['validate', 'check', 'schema', 'all'].includes(cmd)) usage();
if (cmd === 'schema' && !schemas && !fieldsPath) {
  console.error('schema needs --schemas <schemas.json>');
  process.exit(2);
}

const contentDir = path.resolve(dirArg || 'content');

let hasErrors = false;
if (cmd === 'validate' || cmd === 'all') {
  const r = validate(contentDir);
  console.log(formatReport('validate', r));
  if (r.errors.length) hasErrors = true;
}
if (cmd === 'check' || cmd === 'all') {
  if (cmd === 'all') console.log('');
  const r = checkIntegrity(contentDir, schemas ? { schemaFor: schemaForFrom(schemas) } : {});
  console.log(formatReport('check', r));
  if (r.errors.length) hasErrors = true;
}

if (cmd === 'schema' || (cmd === 'all' && (schemas || fieldsPath))) {
  if (cmd === 'all') console.log('');
  const fields = schemas ? fieldMapFromSchemas(schemas) : JSON.parse(fs.readFileSync(path.resolve(fieldsPath), 'utf8'));
  const r = checkBlockSchemas(contentDir, fields);
  console.log(formatReport('schema', r));
  if (r.errors.length) hasErrors = true;
}

process.exit(hasErrors ? 1 : 0);
