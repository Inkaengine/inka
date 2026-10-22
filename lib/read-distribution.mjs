/**
 * Read a plone.exportimport distribution — the thing `@export` produces and
 * `@import` consumes — into the shape the importer already works on.
 *
 * Export from one site, import into another. Plone does both halves itself; for
 * a CMS that has no import endpoint, the missing half is this reader plus the
 * adapter, which is why this returns exactly what `readTree` returns
 * (`{items, order, blobFiles}`) and adds no format of its own. `planImport`
 * takes either without knowing which it got.
 *
 * The layout, as the exporter writes it:
 *
 *   content/__metadata__.json    _data_files_ (parents first), _blob_files_,
 *                                ordering: UID -> position in parent
 *   content/<dirKey>/data.json   the serialised object
 *   content/<dirKey>/<field>/<filename>   blob bytes
 *
 * `dirKey` is the path with its leading slash removed, and the site root is
 * `plone_site_root`. That is what names the path here — NOT `@id`, which in a
 * real export is an absolute URL naming whatever host ran it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const parentOf = (path) => path.replace(/\/[^/]+$/, '') || '/';
const idOf = (path) => path.split('/').filter(Boolean).pop();

/** `plone_site_root` -> `/`, `docs/first` -> `/docs/first`. */
function pathOfDirKey(dirKey) {
  return dirKey === 'plone_site_root' ? '/' : `/${dirKey}`;
}

export function readDistribution(root) {
  const content = join(root, 'content');
  const metaPath = join(content, '__metadata__.json');
  if (!existsSync(metaPath)) {
    throw new Error(
      `${metaPath} not found — this is not an exportimport distribution. ` +
        `A markdown tree is read with readTree instead.`,
    );
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

  const items = new Map();
  const uidOfPath = new Map();
  // `_data_files_` is already sorted parents-before-children by the exporter, and
  // that order is preserved here: the importer creates in iteration order and a
  // child whose parent does not exist yet has nowhere to go.
  for (const rel of meta._data_files_ ?? []) {
    const file = join(content, rel);
    if (!existsSync(file)) {
      // A distribution that lists a file it does not contain is truncated. Half
      // an import is worse than none, so this stops here.
      throw new Error(`${metaPath} lists ${rel}, which is not in the distribution`);
    }
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const path = pathOfDirKey(rel.replace(/\/data\.json$/, ''));
    items.set(path, data);
    if (data.UID) uidOfPath.set(path, data.UID);
  }

  // UID -> position becomes folder -> child ids, because that is what an importer
  // can act on: it puts a child at a position among its siblings and has no UID
  // index to resolve anything else against.
  const ordering = new Map(Object.entries(meta.ordering ?? {}));
  const childrenOf = new Map();
  for (const path of items.keys()) {
    if (path === '/') continue;
    const parent = parentOf(path);
    if (!items.has(parent)) continue; // outside this distribution
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(path);
  }

  const order = new Map();
  for (const [parent, children] of childrenOf) {
    // A real distribution positions SOME children and not others — the site root
    // of an actual export has ordered folders next to unpositioned ones — so
    // this is not all-or-nothing. `ordering` is what plone.exportimport records
    // and what its import applies: the items it names go where it says, and the
    // rest keep the order they were created in. That order is the order
    // `_data_files_` lists them in, which is the order this importer creates
    // them in, so naming them here asserts no change rather than a position the
    // distribution never claimed.
    const positionOf = (path) => {
      const at = ordering.get(uidOfPath.get(path));
      return at === undefined ? Infinity : Number(at);
    };
    if (!children.some((c) => positionOf(c) !== Infinity)) continue;
    const listedAt = new Map(children.map((c, i) => [c, i]));
    order.set(
      parent,
      [...children]
        .sort((a, b) => positionOf(a) - positionOf(b) || listedAt.get(a) - listedAt.get(b))
        .map(idOf),
    );
  }

  // `<dirKey>/<field>/<filename>` — the item is the leading directories, so the
  // last two segments come off.
  const blobFiles = new Map();
  for (const rel of meta._blob_files_ ?? []) {
    const dirKey = rel.split('/').slice(0, -2).join('/');
    const path = pathOfDirKey(dirKey);
    if (blobFiles.has(path)) {
      // One file per item is all the importer can carry. Keeping the first and
      // dropping the rest would lose content silently, so say so instead.
      throw new Error(
        `${path} has more than one blob (${blobFiles.get(path)} and ${rel}); ` +
          `the importer uploads one file per item`,
      );
    }
    blobFiles.set(path, join(content, rel));
  }

  return { items, order, blobFiles };
}
