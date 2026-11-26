#!/usr/bin/env node
/**
 * Enable Volto addons by EXTENDING volto.config.js, never replacing it, so any
 * upstream theme/addon config survives.
 *
 * Enabling is a config edit, not an install: it cannot touch the dependency
 * graph, which is why a site chooses its plugins this way rather than by
 * installing them into a built image.
 *
 * Usage: node docker/enable-plugins.cjs "@scope/name @scope/other"
 *   (versions, if present, are stripped -- volto.config wants package names)
 */
const fs = require('fs');

const names = (process.argv[2] || '')
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .map((entry) => {
    const at = entry.lastIndexOf('@');
    return entry.startsWith('@') ? (at > 0 ? entry.slice(0, at) : entry) : entry.split('@')[0];
  });

if (!names.length) {
  console.log('enable-plugins: nothing to enable; volto.config.js untouched');
  process.exit(0);
}

fs.copyFileSync('volto.config.js', 'volto.config.base.js');
fs.writeFileSync(
  'volto.config.js',
  `const base = require('./volto.config.base.js');\n\n` +
    `module.exports = {\n` +
    `  ...base,\n` +
    `  addons: [...(base.addons || []), ${names.map((n) => `'${n}'`).join(', ')}],\n` +
    `};\n`
);
console.log(`enable-plugins: enabled ${names.join(', ')}`);
