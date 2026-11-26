#!/usr/bin/env node
/**
 * Add plugins to package.json's dependencies BEFORE the install.
 *
 * Ordering is the whole point. Installing plugins AFTER an install re-resolves
 * the workspace and can leave two webpack instances in the tree, so razzle
 * registers MiniCssExtractPlugin in one and the loader runs in the other --
 * which fails as "You forgot to add 'mini-css-extract-plugin' plugin" and took
 * down a consumer's production deploy. Injecting before the install leaves
 * exactly one resolution pass, so the split cannot happen.
 *
 * Usage: node docker/add-plugins.cjs "@scope/name@1.2.3 @scope/other@2.0.0"
 */
const fs = require('fs');

const spec = (process.argv[2] || '').trim();
if (!spec) process.exit(0);

const file = 'package.json';
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.dependencies = pkg.dependencies || {};

for (const entry of spec.split(/\s+/).filter(Boolean)) {
  // `@scope/name@1.2.3` -> name is everything before the LAST `@`, which is
  // not the leading one. A bare `@scope/name` has only the leading `@`.
  const at = entry.lastIndexOf('@');
  const scoped = entry.startsWith('@');
  const hasVersion = scoped ? at > 0 : at !== -1;
  const name = hasVersion ? entry.slice(0, at) : entry;
  const version = hasVersion ? entry.slice(at + 1) : null;
  if (!version) {
    console.error(
      `add-plugins: ${entry} has no version. An unpinned plugin resolves to ` +
        `whatever is latest at build time, which is not reproducible. ` +
        `Pass ${entry}@<version>.`
    );
    process.exit(1);
  }
  pkg.dependencies[name] = version;
  console.log(`add-plugins: + ${name}@${version}`);
}

fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
