/**
 * Translate Volto's Plone-shaped requests into canonical intents.
 *
 * Volto's ~30 action creators emit raw Plone REST paths — /@types/Document,
 * /@querystring, /@search?path.depth=1. Carried verbatim over the `http`
 * passthrough they only mean anything to a Plone adapter, so on WordPress or
 * Drupal every call fails and the CMS is never contacted.
 *
 * Rewriting every action creator is the alternative; routing here is not. This
 * is the single point every admin request already passes through, so one
 * translation table serves all of them, and the action creators stay untouched.
 *
 * Returns null when a path has no semantic equivalent — the caller then falls
 * back to the passthrough, which is exactly what Plone wants anyway. Returns an
 * array of {intent, args} when one request is several canonical operations
 * (a bulk @move); the caller performs them in order.
 */

const stripQuery = (path) => String(path).split('?')[0];

function queryOf(path) {
  const q = String(path).split('?')[1];
  return new URLSearchParams(q || '');
}

/**
 * A plain search string, from whatever Plone-flavoured text Volto sent.
 *
 * Only the trailing wildcard is removed: it is what the contents filter always
 * appends, and it is unambiguous. Anything more elaborate — field:value, AND/OR
 * — is left alone rather than half-translated, so an adapter that cannot honour
 * it fails visibly instead of quietly searching for the wrong thing.
 */
function normaliseSearchText(raw) {
  if (!raw) return undefined;
  return raw.replace(/\*+$/, '') || undefined;
}

/** Volto addresses content by path; everything after the last @foo is the verb. */
function splitEndpoint(path) {
  const clean = stripQuery(path);
  const at = clean.lastIndexOf('/@');
  if (at === -1) return { contextPath: clean || '/', endpoint: null, rest: [] };
  const contextPath = clean.slice(0, at) || '/';
  const [endpoint, ...rest] = clean.slice(at + 2).split('/');
  return { contextPath, endpoint, rest };
}


/**
 * Find a file upload inside a create payload.
 *
 * Plone serialises an upload as a field holding
 * {data, encoding, 'content-type', filename}. The field NAME varies (image,
 * file, …) and the '@type' is CMS-specific, so match on the value's shape:
 * base64 data plus a filename is unambiguous.
 */
function findFilePayload(data) {
  for (const value of Object.values(data ?? {})) {
    if (
      value &&
      typeof value === 'object' &&
      typeof value.data === 'string' &&
      typeof value.filename === 'string'
    ) {
      return {
        filename: value.filename,
        contentType: value['content-type'] ?? 'application/octet-stream',
        data: value.data,
      };
    }
  }
  return null;
}

export function routeToIntent({ op, path, data }) {
  const { contextPath, endpoint, rest } = splitEndpoint(path);
  const params = queryOf(path);

  // Plain content operations: no @endpoint at all.
  if (!endpoint) {
    if (op === 'get') {
      // Volto's api middleware serialises expanders as ?expand=a,b,c. Passed
      // through verbatim rather than filtered to a known list: an expansion no
      // adapter implements must fail loudly as UNKNOWN_EXPANSION, because the
      // component that asked for it has already skipped its own fetch and
      // would otherwise just never receive the data.
      const expand = (params.get('expand') ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      return {
        intent: 'content.get',
        args: { path: contextPath, ...(expand.length ? { expand } : {}) },
      };
    }
    if (op === 'patch') {
      const { blocks, blocks_layout: blocksLayout, ...fields } = data ?? {};
      return {
        intent: 'content.update',
        args: {
          path: contextPath,
          data: {
            ...fields,
            ...(blocks !== undefined ? { blocks } : {}),
            ...(blocksLayout !== undefined ? { blocksLayout } : {}),
          },
        },
      };
    }
    if (op === 'post') {
      // An upload, not a content create. Volto's image widget posts
      // {'@type':'Image', image: {data, encoding, 'content-type', filename}},
      // and routing that to content.create makes the CMS build a PAGE named
      // after the file: on Drupal it produced a node instead of a media entity,
      // so asset.upload — implemented by every adapter and covered by the
      // contract — was never exercised by the editor at all.
      //
      // Detected by the SHAPE of the payload rather than by '@type': 'Image',
      // which is a Plone type name and means nothing to the other two.
      const file = findFilePayload(data);
      if (file) {
        return {
          intent: 'asset.upload',
          args: {
            parentPath: contextPath,
            filename: file.filename,
            contentType: file.contentType,
            data: file.data,
          },
          endpoint: 'upload',
        };
      }
      return {
        intent: 'content.create',
        args: {
          parentPath: contextPath,
          data: {
            type: data?.['@type'],
            title: data?.title,
            blocks: data?.blocks,
            blocksLayout: data?.blocks_layout,
          },
        },
      };
    }
    if (op === 'del') return { intent: 'content.delete', args: { path: contextPath } };
    return null;
  }

  switch (endpoint) {
    case 'types':
      return rest.length
        ? { intent: 'types.getSchema', args: { type: decodeURIComponent(rest[0]) } }
        : // The PATH matters: Volto asks /news/@types to mean "what can be
          // created HERE", and dropping it left the adapter answering with
          // every registered type. On WordPress the first of those was `post`,
          // which is non-hierarchical and cannot take a parent at all, so the
          // journey's add step created something that could never appear under
          // the folder it was added to.
          { intent: 'types.list', args: { path: contextPath } };

    case 'querystring':
      return { intent: 'querystring.getIndexes', args: {} };

    case 'querystring-search':
      return {
        intent: 'querystringSearch',
        args: {
          query: data?.query ?? [],
          sortOn: data?.sort_on,
          sortOrder: data?.sort_order,
          limit: data?.b_size,
        },
      };

    case 'users':
      // Volto asks for a specific user, but the only one it ever needs in the
      // editor is the current session's.
      return { intent: 'auth.whoami', args: {} };

    case 'search': {
      // path.depth=1 is a folder listing, not a search — the contents view and
      // the object browser both use it that way.
      // WHICH folder is named in path.query, not in the URL. Volto's object
      // browser asks /@search?path.query=/news&path.depth=1 from whatever
      // route it happens to be on, so reading only the URL context listed the
      // SITE ROOT no matter where the editor navigated: the breadcrumb said
      // /news while the items were the root's children, and picking a link
      // target was impossible.
      const scope = params.get('path.query') || contextPath;

      const query = normaliseSearchText(params.get('SearchableText'));

      // A folder listing is tree.list — but only while it is UNFILTERED and
      // UNSORTED.
      //
      // The contents view always sends path.depth=1, including when the editor
      // has typed in its filter box, so routing on depth alone threw the search
      // term away and returned the whole folder. Typing in the filter narrowed
      // nothing, on every CMS, and looked like a broken adapter rather than a
      // dropped parameter.
      //
      // A requested ORDER travels WITH it. tree.list is the folder listing,
      // and a folder listing can be ordered; getObjPositionInParent names the
      // folder's own order, the sibling order an editor arranges by hand,
      // which is what an adapter returns when nothing else is asked for.
      //
      // Not routed to `search` instead: that is full-text search, and asking
      // it for an empty query scoped to a path returned nothing at all.
      const sortOn = params.get('sort_on');
      if (params.get('path.depth') === '1' && !query) {
        return {
          intent: 'tree.list',
          args: {
            parent: scope,
            sortOn: sortOn || undefined,
            sortOrder: params.get('sort_order') || undefined,
          },
        };
      }
      return {
        intent: 'search',
        args: {
          // Stripped of Plone's trailing wildcard.
          //
          // The contents view's filter box sends SearchableText as
          // `${filter}*` — catalog syntax, which Plone's own passthrough is
          // welcome to, but which means nothing to anyone else. Passed through
          // verbatim it reached the adapters as a literal asterisk: filtering
          // the listing for "first" searched for "first*", matched nothing on
          // WordPress and Drupal, and the listing silently did not narrow.
          //
          // Translating it here is exactly this router's job — turning
          // Plone-shaped REST into a canonical intent.
          query,
          path: scope === '/' ? undefined : scope,
          // The ordering the editor asked for, named as an index the way the
          // contents view names it; each adapter maps it to whatever its CMS
          // calls that field.
          sortOn: sortOn || undefined,
          sortOrder: params.get('sort_order') || undefined,
          limit: params.get('b_size') ? Number(params.get('b_size')) : undefined,
        },
      };
    }

    case 'actions':
      // Plone's way of asking "what may I do here". The canonical form is
      // PermissionsAndState.effective, which is the same question — CMSes
      // without two separate concepts should not have to invent one.
      return { intent: 'state.get', args: { path: contextPath }, endpoint };

    case 'breadcrumbs':
      return { intent: 'breadcrumbs.get', args: { path: contextPath } };

    case 'navigation':
      return { intent: 'navigation.get', args: { path: contextPath } };

    case 'vocabularies':
      return {
        intent: 'vocabulary.get',
        args: {
          name: decodeURIComponent(rest.join('/')),
          title: params.get('title') ?? undefined,
          limit: params.get('b_size') ? Number(params.get('b_size')) : undefined,
        },
      };

    case 'workflow':
      return rest.length
        ? { intent: 'state.transition', args: { path: contextPath, id: rest[0] } }
        : { intent: 'state.get', args: { path: contextPath } };

    case 'move':
      // One @move carries every item a cut-and-paste selected; the canonical
      // intent moves one document. Several steps, not source[0]: taking only
      // the first silently dropped the rest of a bulk move.
      return (Array.isArray(data?.source) ? data.source : [data?.source]).map(
        (source) => ({
          intent: 'content.move',
          args: { path: source, targetParentPath: contextPath },
        }),
      );

    default:
      // Anything else — @history, @sharing, @controlpanels — has no canonical
      // equivalent yet. Returning null lets the caller decide; it must not
      // silently pretend to have handled it.
      return null;
  }
}

export default routeToIntent;
