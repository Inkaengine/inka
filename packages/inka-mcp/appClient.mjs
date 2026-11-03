/**
 * The ext-apps client the screenshot view carries (screenshotView.mjs), as
 * text. Run from source it is read from node_modules; the hosted server's image
 * has none, so bundle.mjs puts the text itself in place of this module.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const appClientSource = readFileSync(require.resolve('@modelcontextprotocol/ext-apps/app-with-deps'), 'utf8');
