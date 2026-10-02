/**
 * Put a content tree into a CMS, through an adapter.
 *
 * The admin is not involved. Adapters are plain JS and run under Node — the
 * contract suite already drives real Plone, Drupal and WordPress that way — so an
 * importer needs no bridge, no iframe and no UI: construct an adapter, dispatch
 * intents. That is also why this module holds the file reading and the plan, and
 * the adapter holds none of it: adapters must stay browser-safe (see
 * hydra-adapters-core/browserSafety.test.js).
 *
 * Idempotent by PATH, not by id. A path is the one identity every CMS here can
 * match on: Plone can be told a UID on create, WordPress refuses a chosen id
 * outright (rest_post_exists) and Drupal assigns its own. So an import that runs
 * twice updates what it finds rather than duplicating it, and the authored UID is
 * passed only where it can be honoured — which is what keeps links from OUTSIDE
 * the tree working after a reset.
 *
 * The passes are ordered by dependency, not by tidiness:
 *
 *   1. create   — parents before children, or a child has nowhere to go
 *   2. bodies   — order-independent, so they go through `batch` and a CMS that can
 *                 group writes does
 *   3. blobs    — after the documents exist to attach them to
 *   4. order    — after every sibling exists, or positions shift under you
 *   5. state    — last, because publishing something half-written is worse than
 *                 publishing it a second later
 */

/** Deepest-last, so a parent is always created before its children. */
function byDepth(paths) {
  return [...paths].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  );
}

const parentOf = (path) => path.replace(/\/[^/]+$/, '') || '/';
const idOf = (path) => path.split('/').filter(Boolean).pop();
/** Join a parent and a child id without the `//` a root parent would give. */
export const childPath = (parent, id) =>
  `${parent === '/' ? '' : parent}/${id}`;

/**
 * What this tree asks of the CMS, as operations — before anything is sent.
 *
 * Separated from applying it so a plan can be printed (--dry-run) and asserted in
 * a test without a CMS. `existing` is the set of paths the CMS already has, which
 * the caller reads first; everything else follows from the tree.
 */
export function planImport(
  { items, order = new Map(), blobFiles = new Map() },
  existing = new Set(),
) {
  const creates = [];
  const bodies = [];
  const blobs = [];
  const orders = [];
  const states = [];

  for (const path of byDepth(items.keys())) {
    if (path === '/') continue; // the site root is not created by an import
    const page = items.get(path);
    const type = page['@type'] ?? 'Document';

    if (!existing.has(path)) {
      creates.push({
        intent: 'content.create',
        args: {
          parentPath: parentOf(path),
          data: {
            type,
            title: page.title,
            id: idOf(path),
            // Only meaningful where the CMS accepts it; adapters that cannot
            // ignore it, and nothing here depends on it having been honoured.
            ...(page.UID ? { UID: page.UID } : {}),
          },
        },
      });
    }

    // The body goes in its own pass either way: on a create the adapter may not
    // have stored blocks (WordPress serialises them into content), and on an
    // update this is the whole point.
    bodies.push({
      intent: 'content.update',
      args: {
        path,
        data: {
          title: page.title,
          ...(page.description !== undefined
            ? { description: page.description }
            : {}),
          blocks: page.blocks ?? {},
          blocksLayout: page.blocks_layout ?? { items: [] },
        },
      },
    });

    if (blobFiles.has(path)) {
      blobs.push({ path, file: blobFiles.get(path), type });
    }

    // Only a state the source actually asks for. Defaulting to 'published' would
    // publish every draft in the tree on the first import.
    if (page.review_state && page.review_state !== 'private') {
      states.push({ path, state: page.review_state });
    }
  }

  for (const [folder, childIds] of order) {
    if (!childIds || childIds.length < 2) continue;
    orders.push({ folder, childIds: [...childIds] });
  }

  return { creates, bodies, blobs, orders, states };
}

/** Which of these paths the CMS already has. */
export async function readExisting(adapter, paths) {
  const existing = new Set();
  for (const path of paths) {
    if (path === '/') continue;
    try {
      await adapter.dispatch('content.get', { path });
      existing.add(path);
    } catch (error) {
      // Only "it is not there" means create it. Anything else — a dead CMS, a
      // rejected credential — must stop the import rather than be read as absence
      // and turned into a duplicate.
      if (error?.code !== 'NOT_FOUND') throw error;
    }
  }
  return existing;
}

/**
 * Apply a plan. Returns what it did, so a caller can report rather than guess.
 *
 * `readFile` is injected (rather than imported) to keep this module usable from a
 * test with no filesystem, and to keep node:fs out of anything an adapter touches.
 */
export async function applyImport(
  adapter,
  plan,
  { readFile, log = () => {} } = {},
) {
  const done = {
    created: 0,
    updated: 0,
    uploaded: 0,
    ordered: 0,
    transitioned: 0,
  };

  for (const operation of plan.creates) {
    await adapter.dispatch(operation.intent, operation.args);
    done.created += 1;
    log(
      `created ${childPath(operation.args.parentPath, operation.args.data.id)}`,
    );
  }

  // One intention: bodies do not depend on each other, so a CMS that can group
  // writes gets to. `batch` is served by every adapter, so there is no fallback
  // to keep here.
  if (plan.bodies.length) {
    await adapter.dispatch('batch', { operations: plan.bodies });
    done.updated = plan.bodies.length;
    log(`updated ${plan.bodies.length} bodies`);
  }

  for (const blob of plan.blobs) {
    if (!readFile)
      throw new Error('applyImport needs readFile to upload blobs');
    const { data, contentType, filename } = await readFile(blob.file);
    await adapter.dispatch('asset.upload', {
      parentPath: parentOf(blob.path),
      filename,
      contentType,
      data,
    });
    done.uploaded += 1;
    log(`uploaded ${filename}`);
  }

  for (const { folder, childIds } of plan.orders) {
    // Positions, applied in the source's order: each child is asked to sit where
    // the tree says, which converges whatever the CMS started with.
    for (const [index, childId] of childIds.entries()) {
      await adapter.dispatch('content.order', {
        path: childPath(folder, childId),
        targetIndex: index,
      });
    }
    done.ordered += 1;
    log(`ordered ${folder} (${childIds.length} children)`);
  }

  for (const { path, state } of plan.states) {
    // Already there? Then there is nothing to ask for. Most CMSes create content
    // in some default state, and firing a transition anyway writes history nobody
    // asked for — and on a CMS with a one-way workflow it can fail outright.
    const current = await adapter.dispatch('content.get', { path });
    if (current?.state === state) {
      log(`${path} already ${state}`);
      continue;
    }

    let forms;
    try {
      forms = await adapter.dispatch('state.getForms', { path });
    } catch (error) {
      // A CMS with no workflow is a fact to report, not an error to hide. Anything
      // else — a dead CMS, a rejected credential — stops the import: this used to
      // catch everything and carry on, which would have turned an outage into a
      // tree of silently unpublished pages.
      if (error?.code !== 'NOT_IMPLEMENTED') throw error;
      log(`skipped state ${state} for ${path}: this CMS has no workflow`);
      continue;
    }
    const available = Object.keys(forms ?? {});
    // Transition NAMES differ by CMS, so the source's target state is matched
    // against what this CMS offers rather than assumed to be a transition id.
    const transition =
      available.find((name) => name.includes(state)) ??
      (state === 'published'
        ? available.find((n) => n.includes('publish'))
        : undefined);
    if (!transition) {
      log(`skipped state ${state} for ${path}: no transition offers it`);
      continue;
    }
    await adapter.dispatch('state.transition', { path, transition });
    done.transitioned += 1;
    log(`${path} -> ${state}`);
  }

  return done;
}
