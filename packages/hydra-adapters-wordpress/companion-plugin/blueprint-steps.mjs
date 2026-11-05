/**
 * The companion plugin as WordPress Playground blueprint steps.
 *
 * Every harness that boots a Playground this adapter will read needs the SAME
 * thing: the plugin's PHP inside the instance. The contract suite needs it for
 * locking and translations; a frontend's public suite needs it because
 * `hydra/v1/front-page` is the only way a visitor can be told which page is
 * `/`. Each one composing its own writeFile steps meant each one could be
 * missing a file — and one was: the GDS public suite booted a Playground with
 * no companion plugin at all, so its root 500'd and the webServer never came
 * up.
 *
 * EVERY top-level .php file in the plugin, not a named one. The plugin was a
 * single file when the first harness inlined it; splitting the importer out
 * into `import-command.php` left that harness writing a lone
 * `hydra-companion.php` whose `require_once __DIR__ . '/import-command.php'`
 * then fatals — a white screen for every request, from a change in a different
 * file. Reading the directory cannot drift from the plugin.
 *
 * mu-plugins rather than a mounted, activated plugin: WordPress loads every
 * top-level file in mu-plugins with no activation step, and activating a plugin
 * directory that appeared via a Playground mount fails with "Plugin file does
 * not exist" even though get_plugins() lists it — the overlay filesystem shows
 * it to a directory scan but not to validate_plugin's file check.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'hydra-companion',
);

/** @returns {Array<{step: string, path: string, data: string}>} */
export function companionMuPluginSteps() {
  const files = readdirSync(PLUGIN_DIR)
    .filter((name) => name.endsWith('.php'))
    // Alphabetical, which is also mu-plugins' own load order.
    .sort();
  if (files.length === 0) {
    throw new Error(`No PHP in ${PLUGIN_DIR}: the companion plugin is missing.`);
  }
  return files.map((name) => ({
    step: 'writeFile',
    path: `/wordpress/wp-content/mu-plugins/${name}`,
    data: readFileSync(join(PLUGIN_DIR, name), 'utf8'),
  }));
}
