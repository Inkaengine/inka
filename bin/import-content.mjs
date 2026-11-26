#!/usr/bin/env node
/**
 * Put a content tree into a CMS, through an adapter.
 *
 *   import-content --from docs --cms plone --url http://localhost:8080/Plone
 *   import-content --from dist --cms wordpress --url http://localhost:8790
 *   import-content --from docs --cms plone --url … --dry-run
 *
 * No admin and no browser: adapters are plain JS and run under Node, which is how
 * the contract suite already drives real Plone, Drupal and WordPress.
 *
 * `--from` takes either a markdown tree — read with the same readTree the mock API
 * serves from, so what lands in the CMS is what the tests run against — or a
 * plone.exportimport distribution, which is what `@export` produces when you take
 * one site's content to another. Plone does that round trip itself; this is the
 * missing half for a CMS that has no import endpoint.
 *
 * Credentials come from the environment, and a missing one is a hard stop rather
 * than an anonymous attempt that half-works:
 *
 *   plone      HYDRA_CMS_TOKEN                          (bearer)
 *   wordpress  HYDRA_CMS_USER + HYDRA_CMS_APP_PASSWORD  (application password)
 *   drupal     HYDRA_CMS_USER + HYDRA_CMS_PASSWORD
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readTree } from '../lib/markdown-mount.mjs';
import { readDistribution } from '../lib/read-distribution.mjs';
import {
  planImport,
  readExisting,
  applyImport,
  childPath,
} from '../lib/import-content.mjs';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
};

/**
 * A distribution or a markdown tree, whichever `--from` holds.
 *
 * The two are the same job seen from either end: export from one site, import
 * into another, or build the tree from markdown and import that. Both read into
 * `{items, order, blobFiles}`, so nothing below this line knows the difference.
 * Detection is the presence of the metadata file exportimport cannot do without,
 * not a flag — a wrong flag against the right directory is a confusing failure,
 * and the directory already says what it is.
 */
function readSource({ from, prefix }) {
  if (existsSync(join(from, 'content', '__metadata__.json'))) {
    if (prefix) {
      // A distribution carries its own paths, including the site root. Shifting
      // them under a prefix would put the root somewhere it cannot be created.
      console.error('--prefix applies to a markdown tree, not a distribution');
      process.exit(2);
    }
    console.log('[import] source is an exportimport distribution');
    return readDistribution(from);
  }
  console.log('[import] source is a markdown tree');
  return readTree(from, { prefix: prefix ?? '' });
}

function argv() {
  const args = process.argv.slice(2);
  const out = { dryRun: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--from') out.from = args[++i];
    else if (arg === '--cms') out.cms = args[++i];
    else if (arg === '--url') out.url = args[++i];
    else if (arg === '--prefix') out.prefix = args[++i];
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

async function buildAdapter({ cms, url }) {
  const need = (name) => {
    const value = process.env[name];
    if (!value) {
      console.error(
        `${name} is not set. An import writes content; it does not get to guess ` +
          `who it is.`,
      );
      process.exit(2);
    }
    return value;
  };

  if (cms === 'plone') {
    const { PloneAdapter } = await import('@volto-hydra/hydra-adapters-plone');
    return new PloneAdapter({
      cmsBaseUrl: url,
      authToken: need('HYDRA_CMS_TOKEN'),
    });
  }
  if (cms === 'wordpress') {
    const { WordPressAdapter } = await import(
      '@volto-hydra/hydra-adapters-wordpress'
    );
    return new WordPressAdapter({
      cmsBaseUrl: url,
      credentials: {
        username: need('HYDRA_CMS_USER'),
        appPassword: need('HYDRA_CMS_APP_PASSWORD'),
      },
    });
  }
  if (cms === 'drupal') {
    const { DrupalAdapter } = await import(
      '@volto-hydra/hydra-adapters-drupal'
    );
    return new DrupalAdapter({
      cmsBaseUrl: url,
      credentials: {
        username: need('HYDRA_CMS_USER'),
        password: need('HYDRA_CMS_PASSWORD'),
      },
    });
  }
  console.error(
    `--cms must be plone, wordpress or drupal (got ${cms ?? 'nothing'})`,
  );
  return process.exit(2);
}

async function main() {
  const options = argv();
  if (!options.from || !options.cms || !options.url) {
    console.error(
      'Usage: import-content --from <dir> --cms <plone|wordpress|drupal> ' +
        '--url <base> [--prefix /path] [--dry-run]',
    );
    process.exit(2);
  }

  const tree = readSource(options);
  console.log(
    `[import] read ${tree.items.size} documents and ${tree.blobFiles.size} files ` +
      `from ${options.from}`,
  );

  if (options.dryRun) {
    // A plan with no CMS: every path reads as absent, so this shows the most it
    // would ever do rather than pretending to know what is already there.
    const plan = planImport(tree, new Set());
    console.log(
      `[import] would create ${plan.creates.length}, update ${plan.bodies.length}, ` +
        `upload ${plan.blobs.length}, order ${plan.orders.length} folder(s), ` +
        `transition ${plan.states.length}`,
    );
    for (const create of plan.creates) {
      console.log(
        `  create ${childPath(create.args.parentPath, create.args.data.id)}`,
      );
    }
    return;
  }

  const adapter = await buildAdapter(options);
  await adapter.init?.({ cmsBaseUrl: options.url, emit: () => {} });

  const existing = await readExisting(adapter, tree.items.keys());
  console.log(`[import] the CMS already has ${existing.size} of them`);

  const plan = planImport(tree, existing);
  const done = await applyImport(adapter, plan, {
    log: (line) => console.log(`  ${line}`),
    readFile: async (file) => ({
      filename: basename(file),
      contentType:
        MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      data: readFileSync(file).toString('base64'),
    }),
  });

  console.log(
    `[import] created ${done.created}, updated ${done.updated}, ` +
      `uploaded ${done.uploaded}, ordered ${done.ordered}, ` +
      `transitioned ${done.transitioned}`,
  );
}

// No catch: an import that fails part-way must exit non-zero with the reason, not
// print a summary that reads like success.
await main();
