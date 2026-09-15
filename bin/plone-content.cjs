#!/usr/bin/env node
/**
 * CLI for the plone-content-validator. Usage:
 *   plone-content validate [<content-dir>]   — export-shape validation
 *   plone-content check    [<content-dir>]   — graph integrity check
 *   plone-content schema   [<content-dir>] --fields <block-fields.json>
 *                                            — every block field no schema declares
 *   plone-content all      [<content-dir>]   — validate + check (+ schema with --fields)
 *
 * <content-dir> defaults to cwd/content. `--fields` takes the map a frontend
 * emits from its own block schemas: { blockType: ["field", ...] }.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { validate, checkIntegrity, checkBlockSchemas, formatReport } = require(
  path.join(__dirname, '..', 'tests-playwright', 'fixtures', 'plone-content-validator.cjs'),
);

function usage() {
  console.error(
    'Usage: plone-content <validate|check|schema|all> [<content-dir>] ' +
      '[--fields <block-fields.json>]',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const fieldsIndex = argv.indexOf('--fields');
const fieldsPath = fieldsIndex === -1 ? null : argv[fieldsIndex + 1];
if (fieldsIndex !== -1) argv.splice(fieldsIndex, 2);

const [cmd, dirArg] = argv;
if (!cmd || !['validate', 'check', 'schema', 'all'].includes(cmd)) usage();
if (cmd === 'schema' && !fieldsPath) {
  console.error('schema needs --fields <block-fields.json>');
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
  const r = checkIntegrity(contentDir);
  console.log(formatReport('check', r));
  if (r.errors.length) hasErrors = true;
}

if (cmd === 'schema' || (cmd === 'all' && fieldsPath)) {
  if (cmd === 'all') console.log('');
  const fields = JSON.parse(fs.readFileSync(path.resolve(fieldsPath), 'utf8'));
  const r = checkBlockSchemas(contentDir, fields);
  console.log(formatReport('schema', r));
  if (r.errors.length) hasErrors = true;
}

process.exit(hasErrors ? 1 : 0);
