/**
 * Render canonical adapter results in the shape Volto's reducers parse.
 *
 * The routing half of this pair turns Plone-shaped requests into canonical
 * intents; without this half the answers come back in the wrong shape and every
 * reducer downstream breaks. Volto's ~40 reducers are the part we are
 * deliberately not rewriting, so the canonical result is translated once, here,
 * rather than teaching each of them a second vocabulary.
 *
 * `@id` is emitted as a bare path. flattenToAppURL() strips a configured
 * apiPath prefix when present and otherwise returns its input untouched, so a
 * path survives it unchanged — which is what every component wants anyway.
 */

/** Plone marks folderishness explicitly; canonical Documents imply it. */
const isFolderish = (doc) =>
  doc.fields?.isFolderish ?? ['Folder', 'Plone Site', 'page'].includes(doc.type);

export function documentToPlone(doc) {
  if (!doc) return doc;
  const { blocks, blocksLayout, fields, _adapter, id, path, type, title, state, context, ...rest } = doc;
  return {
    ...fields,
    ...rest,
    '@id': path,
    '@type': type,
    id: path.split('/').filter(Boolean).pop() ?? '',
    UID: id,
    title,
    blocks: blocks ?? {},
    blocks_layout: blocksLayout ?? { items: [] },
    ...(state !== undefined ? { review_state: state } : {}),
    ...(context ? { '@components': componentsToPlone(context, path) } : {}),
    is_folderish: isFolderish(doc),
  };
}

/**
 * A canonical context bundle as Plone's '@components'.
 *
 * Runs each value through the SAME converter the standalone endpoint uses, so
 * the expanded and separately-fetched forms cannot drift. Volto's reducers
 * read both — breadcrumbs.js populates from action.result['@components']
 * .breadcrumbs on GET_CONTENT and from the endpoint's own response otherwise —
 * and a difference between them would surface as a component that renders
 * correctly on one navigation and wrongly on the next.
 */
function componentsToPlone(context, path) {
  const AS = {
    breadcrumbs: (value) => plonify('breadcrumbs.get', value, { path }),
    navigation: (value) => plonify('navigation.get', value, { path }),
    types: (value) => plonify('types.list', value, { path }),
    actions: (value) => actionsToPlone(value),
    querystring: (value) => plonify('querystring.getIndexes', value, { path }),
  };
  return Object.fromEntries(
    Object.entries(context).map(([name, value]) => {
      const as = AS[name];
      if (!as) {
        throw new Error(
          `bridge: adapter returned an unknown expansion '${name}'`,
        );
      }
      return [name, as(value)];
    }),
  );
}

/** Listings, search and folder contents share one envelope in Plone. */
function resultsToPlone(result, path) {
  const items = (result?.items ?? []).map(documentToPlone);
  return {
    '@id': path,
    items,
    items_total: result?.total ?? items.length,
    batching: result?.batching ?? {},
  };
}

function indexesToPlone(indexes) {
  // Volto's query builder reads `indexes` for the dropdown and
  // `sortable_indexes` for the sort-on select; they are separate maps.
  const sortable = {};
  for (const [name, idx] of Object.entries(indexes ?? {})) {
    if (idx.sortable) sortable[name] = { title: idx.title };
  }
  return { indexes: indexes ?? {}, sortable_indexes: sortable };
}

function permissionsToPlone(pas) {
  // Volto's @workflow endpoint returns the transitions list plus the current
  // state; history is a Plone-only affordance and is legitimately empty here.
  return {
    '@id': '',
    history: [],
    transitions: (pas?.transitions ?? []).map((t) => ({
      '@id': t.id,
      title: t.label,
      new_state_id: t.targetState,
    })),
    state: pas?.state?.name,
  };
}

/**
 * Volto's toolbar and contents view read @actions to decide which controls to
 * show. Derive them from the canonical permissions rather than asking adapters
 * to model Plone's action registry.
 */
/**
 * Actions the admin renders, from what the user MAY do plus what the CMS wants
 * to answer for itself.
 *
 * The permission flags below decide which built-ins exist at all. An adapter's
 * own `actions` list is then folded in by id: an id Volto knows takes that
 * button over — a destination on the CMS, or merely `permitted: false` to
 * withhold it — and any other id is an entry Volto had no concept of.
 *
 * `url` carries the destination. That is the field Plone 6 actually emits and
 * the one Volto reads (Footer.jsx renders `item.url`); an earlier version of
 * this wrote `@id`, which the mock was then written to match, so nothing
 * caught it. Verified against demo.plone.org — see
 * tests-adapters/fixtures/plone/live_actions_anon.json. An entry without a
 * destination keeps Volto's own screen.
 */
function actionsToPlone(pas) {
  const e = pas?.effective ?? {};
  const object = [{ id: 'view', title: 'View' }];
  if (e.canEdit) object.push({ id: 'edit', title: 'Edit' });
  if (e.canEdit) object.push({ id: 'folderContents', title: 'Contents' });
  if (e.canDelete) object.push({ id: 'delete', title: 'Delete' });
  if (e.canShare) object.push({ id: 'sharing', title: 'Sharing' });

  // Keys are Plone's own category names, because Volto reads them directly
  // (state.actions.actions.site_actions). The canonical `site` an adapter
  // declares maps onto site_actions here.
  // Keys are Plone's own category names, because Volto reads them directly
  // (state.actions.actions.site_actions, .object_buttons). The canonical names
  // an adapter declares map onto them here.
  const categories = {
    object,
    object_buttons: [],
    user: [],
    site_actions: [],
  };
  const CATEGORY_NAMES = {
    site: 'site_actions',
    'object-buttons': 'object_buttons',
  };

  for (const declared of pas?.actions ?? []) {
    const requested = declared.category ?? 'object';
    const category = categories[CATEGORY_NAMES[requested] ?? requested] ?? object;
    const existing = category.findIndex((a) => a.id === declared.id);

    if (declared.permitted === false) {
      // Withheld: the adapter is answering for this button by removing it.
      if (existing !== -1) category.splice(existing, 1);
      continue;
    }

    const entry = {
      id: declared.id,
      title: declared.title,
      ...(declared.url ? { url: declared.url } : {}),
      // How it opens travels with it; the toolbar decides nothing on its own.
      ...(declared.target ? { target: declared.target } : {}),
      native: Boolean(declared.url),
    };
    if (existing === -1) category.push(entry);
    else category[existing] = { ...category[existing], ...entry };
  }

  return categories;
}

/**
 * An uploaded asset, in the shape the image widget reads back.
 *
 * It uses content['@id'] as the stored value and content.image as
 * image_scales.image[0], so those two are the contract here — not the whole
 * canonical Document.
 */
function assetToPlone(doc) {
  const url = doc?.fields?.url ?? doc?.path;
  return {
    '@id': url,
    '@type': 'Image',
    id: doc?.id,
    title: doc?.title,
    image: {
      filename: doc?.fields?.filename,
      download: url,
      scales: {},
    },
  };
}

export function plonify(intent, result, { path, endpoint } = {}) {
  if (intent === 'asset.upload') return assetToPlone(result);
  if (endpoint === 'actions') return actionsToPlone(result);
  switch (intent) {
    case 'content.get':
    case 'content.update':
    case 'content.create':
    case 'content.move':
      return documentToPlone(result);

    case 'content.delete':
      return result ?? {};

    case 'search':
    case 'tree.list':
    case 'querystringSearch':
      return resultsToPlone(result, path);

    case 'types.getSchema':
      return result;

    case 'types.list':
      // Canonical listings are always {items}, never a bare array — Volto's
      // types reducer stores the response as-is and the toolbar maps over it.
      return (result?.items ?? []).map((t) => ({
        '@id': `/@types/${t.id}`,
        id: t.id,
        title: t.title,
        addable: t.addable ?? true,
      }));

    case 'querystring.getIndexes':
      return indexesToPlone(result);

    case 'auth.whoami':
      return { '@id': `/@users/${result?.id}`, ...result };

    case 'vocabulary.get':
      return {
        '@id': path,
        items: result?.items ?? [],
        items_total: result?.total ?? (result?.items ?? []).length,
      };

    case 'breadcrumbs.get':
      return {
        '@id': path,
        items: (result?.items ?? []).map((i) => ({ '@id': i.path, title: i.title })),
      };

    case 'navigation.get':
      return {
        '@id': path,
        items: (result?.items ?? []).map(function toItem(i) {
          return {
            '@id': i.path,
            title: i.title,
            ...(i.items ? { items: i.items.map(toItem) } : {}),
          };
        }),
      };

    case 'state.get':
    case 'state.transition':
      return permissionsToPlone(result);

    default:
      return result;
  }
}

export default plonify;
