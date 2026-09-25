/**
 * @volto-hydra/helpers
 *
 * Pure data helpers extracted from `packages/hydra-js/hydra.src.js`.
 *
 * Importing this module must be safe from any JS runtime — browsers,
 * Node servers (Astro / Nuxt server / Express render endpoints), and
 * SSR build steps. It must NOT depend on `window`, `document`,
 * `postMessage`, the Bridge class, or anything that requires the
 * iframe-admin handshake.
 *
 * The two "almost-pure" helpers — `expandListingBlocks` and
 * `ploneFetchItems` — touch the network (fetch) and may consult
 * `window.__hydraBridge` / cookies *if available*, but they are
 * SSR-safe via `typeof window` guards. They are also re-exported from
 * `@volto-hydra/hydra-js` for back-compat so existing callers keep
 * working unchanged.
 */

////////////////////////////////////////////////////////////////////////////////
// Internal: SSR-safe logging + auth header
////////////////////////////////////////////////////////////////////////////////

// Debug logging - disabled by default, enable via window.HYDRA_DEBUG or
// _hydra_debug URL param. Mirrors the gate used in hydra.src.js so the
// two modules log consistently.
let debugEnabled = false;
try {
  debugEnabled =
    typeof window !== 'undefined' &&
    !!(
      window.HYDRA_DEBUG ||
      (window.location?.search &&
        new URLSearchParams(window.location.search).has('_hydra_debug'))
    );
} catch {
  /* SSR or restricted environment */
}
function log(...args) {
  if (!debugEnabled && !(typeof window !== 'undefined' && window.HYDRA_DEBUG))
    return;
  const runId = typeof window !== 'undefined' && window.__testRunId;
  const prefix = runId != null ? `[HYDRA][RUN-${runId}]` : '[HYDRA]';
  console.log(prefix, ...args);
}

/**
 * SSR-safe minimal token cookie reader — mirrors the cookie-only path
 * of hydra-js's `getTokenFromCookie`. Returns null in any non-browser
 * environment.
 */
function _getTokenFromCookie() {
  if (typeof document === 'undefined') {
    return null;
  }
  const name = 'access_token=';
  const decodedCookie = decodeURIComponent(document.cookie);
  const cookieArray = decodedCookie.split(';');
  for (let i = 0; i < cookieArray.length; i++) {
    let cookie = cookieArray[i].trim();
    if (cookie.indexOf(name) === 0) {
      return cookie.substring(name.length, cookie.length);
    }
  }
  return null;
}

/**
 * SSR-safe minimal access-token reader — mirrors hydra-js's
 * `getAccessToken` but without sessionStorage writes in non-browser
 * environments. Order: URL `access_token` param → sessionStorage →
 * cookie. Returns null on server.
 */
export function getAccessToken() {
  if (typeof window === 'undefined') {
    return null;
  }
  const urlToken = new URL(window.location.href).searchParams.get(
    'access_token',
  );
  if (urlToken) {
    sessionStorage.setItem('hydra_access_token', urlToken);
    return urlToken;
  }
  const sessionToken = sessionStorage.getItem('hydra_access_token');
  if (sessionToken) {
    return sessionToken;
  }
  return _getTokenFromCookie();
}

/**
 * SSR-safe auth headers — returns Bearer if a token is reachable, else
 * just `{ Accept: 'application/json' }`. Mirrors hydra-js's
 * `getAuthHeaders` so server-side and client-side fetchers produce
 * matching requests.
 */
function _getAuthHeaders() {
  const token = getAccessToken();
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
  }
  return {
    Accept: 'application/json',
  };
}

////////////////////////////////////////////////////////////////////////////////
// contentPath
////////////////////////////////////////////////////////////////////////////////

/**
 * Convert an absolute API URL to a frontend-relative path.
 *
 * Content URLs from the Plone REST API (e.g. @id fields in listing items)
 * use the API base URL. Pass your API base URL to convert them to
 * frontend-relative paths. Note: the bridge may not be initialised in
 * non-edit mode, so the API URL must be provided by the frontend itself.
 *
 * @param {string} url - URL to convert (absolute or relative)
 * @param {string} apiUrl - API base URL (e.g. 'https://api.example.com')
 * @returns {string} Relative path if url starts with apiUrl, otherwise url unchanged
 */
export function contentPath(url, apiUrl) {
  if (!url || !apiUrl || typeof url !== 'string') return url || '';
  if (url.startsWith(apiUrl)) {
    const rel = url.slice(apiUrl.length);
    return rel.startsWith('/') ? rel : '/' + rel;
  }
  return url;
}

////////////////////////////////////////////////////////////////////////////////
// buildQuerystringSearchBody
////////////////////////////////////////////////////////////////////////////////

/**
 * Build the request body for @querystring-search endpoint.
 * This is the Plone endpoint that accepts Volto's querystring format.
 *
 * @param {Object} queryConfig - Volto querystring configuration
 * @param {Array} queryConfig.query - Array of query conditions [{i, o, v}, ...]
 * @param {string} [queryConfig.sort_on] - Field to sort on
 * @param {string} [queryConfig.sort_order] - 'ascending' or 'descending'
 * @param {number} [queryConfig.limit] - Maximum number of results (0 = unlimited)
 * @param {Object} [paging] - Paging options
 * @param {number} [paging.b_start=0] - Starting index
 * @param {number} [paging.b_size=10] - Number of items per page
 * @param {Object} [extraCriteria={}] - Additional query criteria (for search blocks)
 * @param {string} [extraCriteria.SearchableText] - Text search term
 * @param {string} [extraCriteria.sort_on] - Override sort field
 * @param {string} [extraCriteria.sort_order] - Override sort order
 * @param {string|string[]} [extraCriteria['facet.*']] - Facet filters (e.g., 'facet.portal_type': ['Document'])
 * @returns {Object} Request body for POST to @querystring-search
 */
export function buildQuerystringSearchBody(
  queryConfig,
  paging = {},
  extraCriteria = {},
) {
  const { b_start = 0, b_size = 10 } = paging;

  // When no queryConfig at all (listing with no querystring configured),
  // default to current folder contents in folder order — matching Plone's
  // behavior for unconfigured listing blocks.
  const hasQuery =
    queryConfig?.query &&
    Array.isArray(queryConfig.query) &&
    queryConfig.query.length > 0;

  let query;
  if (hasQuery) {
    // Clone to avoid mutations
    query = [...queryConfig.query];
  } else {
    // Default: the context's CONTENTS — its direct children (`.::1`), which is
    // what Volto shows for a listing with no criteria. `.` alone is the whole
    // subtree: a converted LECC page listed 25 items (every language folder's
    // sub-pages) where the source listed its 7 languages. A listing that sets
    // its own `depth` keeps it (applied below).
    query = [
      {
        i: 'path',
        o: 'plone.app.querystring.operation.string.relativePath',
        v: queryConfig?.depth !== undefined ? '.' : '.::1',
      },
    ];
  }

  // Merge extraCriteria into query
  if (extraCriteria.SearchableText) {
    // queryType (plone6): "search" = Advanced (word/phrase) → the ZCTextIndex
    // `string.search` operation; anything else = Standard substring
    // (`string.contains`, the default). Only "search" switches it.
    query.push({
      i: 'SearchableText',
      o:
        extraCriteria.queryType === 'search'
          ? 'plone.app.querystring.operation.string.search'
          : 'plone.app.querystring.operation.string.contains',
      v: extraCriteria.SearchableText,
    });
  }

  // Add facet filters from extraCriteria (keys starting with 'facet.').
  //
  // A DATE-RANGE facet is a `facet.<field>.after` / `facet.<field>.before` key —
  // a "from" and a "to" are TWO separate facets on the SAME index (so they don't
  // collide on one `facet.<field>`), each carrying its direction in the key. They
  // map to the Plone date operations `largerThan` / `lessThan` (a single scalar
  // date value), which the catalog ANDs together into a range. Every other
  // `facet.<field>` is a discrete-value facet → `selection.any` (an array).
  const DATE_OPS = {
    after: 'plone.app.querystring.operation.date.largerThan',
    before: 'plone.app.querystring.operation.date.lessThan',
  };
  for (const [key, value] of Object.entries(extraCriteria)) {
    if (!key.startsWith('facet.')) continue;
    const field = key.replace('facet.', '');
    const dateMatch = field.match(/^(.+)\.(after|before)$/);
    if (dateMatch) {
      // Date-range facet: `<index>.<after|before>` → a scalar date operation.
      const [, index, direction] = dateMatch;
      const v = Array.isArray(value) ? value[0] : value;
      if (v) {
        query.push({ i: index, o: DATE_OPS[direction], v });
      }
    } else {
      query.push({
        i: field,
        o: 'plone.app.querystring.operation.selection.any',
        v: Array.isArray(value) ? value : [value],
      });
    }
  }

  // Default sort: folder order for unconfigured listings, effective date for configured ones
  const defaultSort = hasQuery ? 'effective' : 'getObjPositionInParent';
  const defaultOrder = hasQuery ? 'descending' : 'ascending';

  const body = {
    query,
    sort_on: extraCriteria.sort_on || queryConfig?.sort_on || defaultSort,
    sort_order:
      extraCriteria.sort_order || queryConfig?.sort_order || defaultOrder,
    b_start,
    b_size,
    metadata_fields: '_all',
  };

  // Depth belongs ON the path criterion, encoded in its VALUE as `path::depth`
  // (`.::1`, `/docs::2`); a bare path is a recursive query. A top-level `depth`
  // field on the request body is NOT honoured by @querystring-search — it is
  // accepted and silently ignored, and inside the criterion as an object it
  // errors with "index 'UID': option 'depth' is not valid".
  //
  // This used to set `body.depth` and so did nothing: a listing configured with
  // depth 1 still matched the whole subtree, which put every nested Image into
  // the /components index (`.` → 107 items, `.::1` → 33).
  if (queryConfig?.depth !== undefined) {
    for (const criterion of body.query) {
      if (criterion.i !== 'path') continue;
      if (typeof criterion.v !== 'string' || criterion.v.includes('::')) continue;
      criterion.v = `${criterion.v}::${queryConfig.depth}`;
    }
  }

  // Add limit if specified (0 or undefined means no limit)
  if (queryConfig?.limit && queryConfig.limit > 0) {
    body.limit = queryConfig.limit;
  }

  return body;
}

////////////////////////////////////////////////////////////////////////////////
// calculatePaging
////////////////////////////////////////////////////////////////////////////////

/**
 * Calculate paging information from search results.
 *
 * @param {number} itemsTotal - Total number of items
 * @param {number} bSize - Items per page
 * @param {number} currentPage - Current page index (0-based)
 * @returns {Object} Paging info with pages array, prev, next, last
 */
export function calculatePaging(itemsTotal, bSize, currentPage = 0) {
  if (!bSize || bSize <= 0 || !itemsTotal || itemsTotal <= 0) {
    return {
      pages: [],
      prev: null,
      next: null,
      last: null,
      totalPages: 0,
      currentPage: 0,
      totalItems: 0,
    };
  }

  const totalPages = Math.ceil(itemsTotal / bSize);
  const pages = Array.from({ length: totalPages }, (_, i) => ({
    start: i * bSize,
    page: i + 1,
  }));

  // Get a window of pages around current page (show 5 pages max)
  const windowStart = Math.max(0, currentPage - 2);
  const windowEnd = Math.min(totalPages, currentPage + 3);
  const visiblePages = pages.slice(windowStart, windowEnd);

  return {
    pages: visiblePages,
    prev: currentPage > 0 ? currentPage - 1 : null,
    next: currentPage < totalPages - 1 ? currentPage + 1 : null,
    last: totalPages - 1,
    totalPages,
    currentPage,
    totalItems: itemsTotal,
  };
}

////////////////////////////////////////////////////////////////////////////////
// staticBlocks (+ computePagingUI helper)
////////////////////////////////////////////////////////////////////////////////

/**
 * Expand listing blocks by fetching query results and converting items to blocks.
 * Uses itemType and fieldMapping from each listing block to determine output format.
 * Each listing is replaced by multiple blocks of the specified itemType in the layout.
 * Works with any fetch library (Nuxt $fetch, React Query, SWR, etc.)
 *
 * @param {Object} blocks - Block data keyed by block ID
 * @param {Array} blocksLayout - Ordered array of block IDs (blocks_layout.items)
 * @param {Object} options
 * @param {string} [options.apiUrl] - Base API URL (required if no fetcher provided)
 * @param {string} options.contextPath - Current content path for relative queries
 * @param {number} [options.page=0] - Current page number (0-indexed)
 * @param {number} [options.pageSize=10] - Number of elements per page
 * @param {Function} [options.fetcher] - Custom fetch function(path, body, headers) => Promise<response>
 * @param {Object} [options.extraCriteria={}] - Additional query criteria (for search blocks)
 * @param {string} [options.extraCriteria.SearchableText] - Text search term
 * @param {string} [options.extraCriteria.sort_on] - Override sort field
 * @param {string} [options.extraCriteria.sort_order] - Override sort order ('ascending'|'descending')
 * @param {string|string[]} [options.extraCriteria['facet.*']] - Facet filters (e.g., 'facet.portal_type': ['Document'])
 * @param {string} [options.itemTypeField='itemType'] - Field name to read item block type from (e.g., 'variation')
 * @param {string} [options.defaultItemType='summary'] - Default item type when field is not set
 * @returns {Promise<{items: Array, paging: Object}>}
 *   - items: Array of blocks, each with @uid (block ID for data-block-uid) and @type
 *   - paging: { currentPage, totalPages, totalItems, prev, next, pages }
 *
 * @example
 * // Listing block with itemType and fieldMapping:
 * // {
 * //   '@type': 'listing',
 * //   'itemType': 'teaser',
 * //   'fieldMapping': { 'title': 'headline', '@id': 'href' },
 * //   'itemDefaults': { 'showImage': true }
 * // }
 * // Query result: { title: 'My Page', '@id': '/my-page', description: '...' }
 * // Output block: { '@type': 'teaser', headline: 'My Page', href: '/my-page', showImage: true }
 */

/**
 * Synchronous helper to pass through static blocks with @uid.
 * Use for non-listing blocks in grids with combined paging.
 *
 * Returns { items, paging } — does NOT mutate the input paging object.
 * Chain `paging.seen` from one call to the next for correct positioning.
 *
 * @param {Array} inputItems - Array of block IDs or objects with @uid
 * @param {Object} options - Configuration options
 * @param {Object} options.blocks - Map of blockId -> block data (for ID lookups)
 * @param {Object} options.paging - Paging input { start, size } (not mutated)
 * @param {number} [options.seen=0] - Number of items already seen (from prior calls)
 * @returns {{ items: Array, paging: Object }} Items on current page + computed paging state
 */
export function staticBlocks(inputItems, options = {}) {
  const { blocks: blocksDict, paging: pagingIn = {} } = options;
  let seen = options.seen || 0;
  const start = pagingIn.start || 0;
  const size = pagingIn.size || 1000;

  // Normalize items: convert IDs to objects if blocksDict provided
  const normalizedItems = (inputItems || [])
    .map((item) => {
      if (typeof item === 'string') {
        const block = blocksDict?.[item];
        if (!block) {
          console.warn(`[HYDRA] staticBlocks: block not found for ID: ${item}`);
          return null;
        }
        return { ...block, '@uid': item };
      }
      return item;
    })
    .filter(Boolean);

  const items = [];

  for (const item of normalizedItems) {
    seen++;
    // Only include items on current page
    if (seen > start && seen - start <= size) {
      items.push(item);
    }
  }

  // Build output paging with computed UI values
  const paging = { start, size, total: seen, seen };
  computePagingUI(paging);

  return { items, paging };
}

/**
 * Internal helper to compute paging UI values.
 */
function computePagingUI(paging) {
  const { start, size, total } = paging;
  if (size && total) {
    paging.currentPage = Math.floor(start / size);
    paging.totalPages = Math.ceil(total / size);
    paging.totalItems = total;

    // Page number window (show ~5 pages centered on current)
    const windowStart = Math.max(0, paging.currentPage - 2);
    const windowEnd = Math.min(paging.totalPages, paging.currentPage + 3);
    paging.pages = [];
    for (let i = windowStart; i < windowEnd; i++) {
      paging.pages.push({ start: i * size, page: i + 1 });
    }

    paging.prev = paging.currentPage > 0 ? paging.currentPage - 1 : null;
    paging.next =
      paging.currentPage < paging.totalPages - 1
        ? paging.currentPage + 1
        : null;
  } else {
    // No results (or no page size): leave a well-formed empty paging object so
    // consumers can rely on `pages`/`totalPages` always being present rather
    // than `undefined` (which would throw on `paging.pages.map`).
    paging.currentPage = 0;
    paging.totalPages = 0;
    paging.totalItems = total || 0;
    paging.pages = [];
    paging.prev = null;
    paging.next = null;
  }
}

////////////////////////////////////////////////////////////////////////////////
// convertFieldValue (+ slateToText, textToSlate helpers)
////////////////////////////////////////////////////////////////////////////////

/**
 * Extract plain text from a Slate JSON value (array of nodes).
 * BR nodes within a paragraph become newlines when separator is '\n'.
 */
function slateToText(nodes, separator = '\n') {
  if (!Array.isArray(nodes)) return String(nodes ?? '');
  return nodes
    .map((node) => {
      if (node.text !== undefined) return node.text;
      if (node.type === 'br') return separator;
      if (node.children) return slateToText(node.children, separator);
      return '';
    })
    .join('');
}

/**
 * Convert a plain text string to Slate JSON value.
 * Always produces a single paragraph node (Slate fields have one block element).
 * Newlines become BR inline nodes within the paragraph.
 */
function textToSlate(text) {
  const str = String(text ?? '');
  if (!str || !str.includes('\n')) {
    return [{ type: 'p', children: [{ text: str }] }];
  }
  const lines = str.split('\n');
  const children = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) children.push({ type: 'br', children: [{ text: '' }] });
    children.push({ text: lines[i] });
  }
  return [{ type: 'p', children }];
}

/**
 * Convert a field value to match a target JSON Schema type.
 * Used by expandListingBlocks when fieldMapping specifies a target type,
 * and by convertBlockType for coercing values between block schemas.
 *
 * Conversions:
 *   array → string:  join with ", " (or extract @id from link arrays)
 *   Slate array → string:  extract text (no line breaks)
 *   object (image) → string:  extract main image URL
 *   string → link:   wrap as [{ '@id': value }]
 *   string → array:  wrap as [value]
 *   string → slate:  wrap as [{type:'p', children:[{text:value}]}]
 *   Slate → textarea:  extract text with line breaks between paragraphs
 *   string → textarea:  pass through
 *   textarea → slate:  split on newlines into paragraph nodes
 *   * → string:      String(value)
 */
/**
 * Package a catalog brain's separate `image_field` + `image_scales` keys into a
 * single self-contained `image` object `{ '@id', image_field, image_scales }`
 * (with `@id` duplicated inside so a downstream scale URL can resolve relative
 * paths), and drop the two separate keys. This is the ONE normalization that lets
 * a mapping read a plain `image` source key and hand a single value to
 * `convertFieldValue`. Shared by the listing fetcher and copy-from-target so both
 * pull images the same way. A brain with no image is returned unchanged.
 */
export function normalizeCatalogImage(item) {
  if (!item || !item.image_scales || !item.image_field) return item;
  const normalized = { ...item };
  normalized.image = {
    '@id': item['@id'],
    image_field: item.image_field,
    image_scales: item.image_scales,
  };
  delete normalized.image_scales;
  delete normalized.image_field;
  return normalized;
}

export function convertFieldValue(value, targetType) {
  if (!targetType) return value; // No type specified = pass through

  switch (targetType) {
    case 'string':
      if (Array.isArray(value)) {
        // Object browser link array: [{@id: '/path', title: '...'}] → extract URL
        if (value.length > 0 && value[0]?.['@id']) return value[0]['@id'];
        // Slate array: extract text without line breaks
        if (value.length > 0 && value[0]?.type && value[0]?.children)
          return slateToText(value, ' ');
        return value.join(', ');
      }
      if (value && typeof value === 'object') {
        // Image object: extract main URL from image_scales
        if (value.image_scales && value.image_field) {
          const field = value.image_field;
          const scaleData = value.image_scales[field];
          if (scaleData?.[0]?.download) {
            return `${value['@id'] || ''}/${scaleData[0].download}`;
          }
        }
        return String(value);
      }
      return String(value);

    case 'textarea':
      // Like 'string' but preserves line breaks from Slate paragraphs
      if (Array.isArray(value)) {
        if (value.length > 0 && value[0]?.['@id']) return value[0]['@id'];
        if (value.length > 0 && value[0]?.type && value[0]?.children)
          return slateToText(value, '\n');
        return value.join(', ');
      }
      if (typeof value === 'string') return value;
      return String(value ?? '');

    case 'slate':
      // Convert to Slate JSON array
      if (Array.isArray(value)) {
        // Already a Slate array — pass through
        if (value.length > 0 && value[0]?.type && value[0]?.children)
          return value;
        // Object browser link array → extract URL and wrap
        if (value.length > 0 && value[0]?.['@id'])
          return textToSlate(value[0]['@id']);
        return textToSlate(value.join(', '));
      }
      if (typeof value === 'string') return textToSlate(value);
      return textToSlate(String(value ?? ''));

    case 'link':
      // Volto link format: [{ '@id': url, title?: '...' }]
      if (typeof value === 'string') return [{ '@id': value }];
      if (Array.isArray(value)) {
        // Strip image-specific metadata, keep only link fields
        if (value.length > 0 && value[0]?.['@id']) {
          return value.map((item) => {
            const { image_field, image_scales, ...linkFields } = item;
            return linkFields;
          });
        }
        return value;
      }
      if (value && typeof value === 'object' && value['@id'])
        return [{ '@id': value['@id'] }];
      return [{ '@id': String(value) }];

    case 'image':
      // ImageWidget format: plain string URL (siblings handled by pack/unpack in convertBlockType)
      if (Array.isArray(value)) {
        // Image link array: [{ '@id': url, ... }] → extract URL string
        if (value.length > 0 && value[0]?.['@id']) return value[0]['@id'];
        // Slate array → extract text as URL
        if (value.length > 0 && value[0]?.type && value[0]?.children)
          return slateToText(value, ' ');
        return value.join(', ');
      }
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object' && value['@id'])
        return value['@id'];
      return value;

    case 'image_link':
      // object_browser image format: [{ '@id': url, image_field?: '...', image_scales?: {...} }]
      if (Array.isArray(value)) {
        // Already array format — pass through
        if (value.length > 0 && value[0]?.['@id']) return value;
        // Slate array → extract text as URL
        if (value.length > 0 && value[0]?.type && value[0]?.children) {
          return [{ '@id': slateToText(value, ' ') }];
        }
        return value;
      }
      if (typeof value === 'string') return [{ '@id': value }];
      if (value && typeof value === 'object' && value['@id']) return [value];
      return value;

    case 'array':
      if (Array.isArray(value)) return value;
      return [value];

    default:
      return value; // 'object', 'number', 'boolean', 'integer' — pass through
  }
}

////////////////////////////////////////////////////////////////////////////////
// expandListingBlocks
////////////////////////////////////////////////////////////////////////////////

export async function expandListingBlocks(inputItems, options = {}) {
  const {
    blocks: blocksDict, // Optional: lookup dict for when items are IDs
    fetchItems, // { blockType: async (block, { start, size }) => { items, total } }
    paging: pagingIn, // { start, size } — not mutated
    itemTypeField = 'itemType', // Field name to read item type from (e.g., 'variation')
    defaultItemType = 'summary', // Default item type when field is not set
  } = options;

  if (!fetchItems || typeof fetchItems !== 'object') {
    throw new Error(
      'expandListingBlocks requires a fetchItems map of { blockType: fetcherFn }',
    );
  }

  // Normalize items: convert IDs to objects if blocksDict provided
  // Items can be: objects with @uid, or string IDs (looked up in blocksDict)
  const normalizedItems = (inputItems || [])
    .map((item) => {
      if (typeof item === 'string') {
        // It's a block ID - look up in blocksDict
        const block = blocksDict?.[item];
        if (!block) {
          console.warn(
            `[HYDRA] expandListingBlocks: block not found for ID: ${item}`,
          );
          return null;
        }
        return { ...block, '@uid': item };
      }
      // Already an object with @uid
      return item;
    })
    .filter(Boolean);

  // Convert to blocks/layout format for internal processing
  const blocks = Object.fromEntries(
    normalizedItems.map((item) => [item['@uid'], item]),
  );
  const blocksLayout = normalizedItems.map((item) => item['@uid']);

  // Use input paging values (not mutated) and seen count from prior calls
  const paging = pagingIn || { start: 0, size: 1000 };

  // Find all listing blocks that need expansion (any block whose @type has a fetcher)
  const listingBlockIds = blocksLayout.filter(
    (blockId) => fetchItems[blocks[blockId]?.['@type']],
  );

  // Register listing blocks as readonly on the live bridge (browser-only).
  // Expanded items share these UIDs and shouldn't have editable fields.
  // Server-side: window.__hydraBridge is undefined — skip.
  const bridgeInstance =
    (typeof window !== 'undefined' && window.__hydraBridge) || null;
  if (bridgeInstance) {
    for (const blockId of listingBlockIds) {
      bridgeInstance.setBlockReadonly(blockId, true);
      log('expandListingBlocks: registered readonly block:', blockId);
    }
  } else {
    log(
      'expandListingBlocks: no bridgeInstance, skipping readonly registration for:',
      listingBlockIds,
    );
  }

  // Account for items already counted by prior staticBlocks calls.
  // Caller passes seen count explicitly (no shared mutable state).
  const priorSeen = options.seen || 0;

  // Single-pass: walk blocks in layout order, fetching each listing sequentially.
  // Each fetch returns { items, total }, so we learn the total and get the items
  // in one request. This avoids a separate "get totals" phase.
  let globalPos = priorSeen;
  let batchTotal = 0;
  const listingTotals = {};
  const listingResults = {};
  const windowStart = paging.start;
  const windowEnd = paging.start + paging.size;

  for (const blockId of blocksLayout) {
    if (!listingBlockIds.includes(blockId)) {
      globalPos += 1; // Non-listing blocks contribute 1 item
      batchTotal += 1;
      continue;
    }

    const blockStart = globalPos;

    // Optimistic check: if this listing starts past the page window end,
    // we still need its total for paging UI, so fetch with size: 0.
    // Otherwise, compute the slice we need and fetch items + total together.
    let localStart = 0;
    let localSize = 0;
    if (blockStart < windowEnd) {
      // This listing might overlap the window — compute the slice
      localStart = Math.max(0, windowStart - blockStart);
      // We don't know total yet, so request up to the remaining window size.
      // The backend will clamp to actual available items.
      localSize = windowEnd - Math.max(blockStart, windowStart);
    }

    try {
      const fetcher = fetchItems[blocks[blockId]['@type']];
      const result = await fetcher(blocks[blockId], {
        start: localStart,
        size: localSize,
      });
      const total = result.total || 0;
      listingTotals[blockId] = total;
      batchTotal += total;

      // Now that we know the actual total, check if this listing truly overlaps
      const blockEnd = blockStart + total;
      if (localSize > 0 && blockEnd > windowStart && blockStart < windowEnd) {
        listingResults[blockId] = result.items || [];
      }

      globalPos += total;
    } catch (error) {
      console.error(`[HYDRA] Failed to fetch listing ${blockId}:`, error);
      listingTotals[blockId] = 0;
      globalPos += 0;
    }
  }

  // Build items array — walk layout in order, emitting items that fall in the page window
  const items = [];
  globalPos = priorSeen;

  for (const blockId of blocksLayout) {
    const block = blocks[blockId];

    if (listingBlockIds.includes(blockId)) {
      const total = listingTotals[blockId];
      const blockStart = globalPos;

      if (listingResults[blockId]) {
        const itemType = block[itemTypeField] || defaultItemType;
        const fieldMapping = block.fieldMapping || {};

        // Extract itemDefaults from flat keys (e.g., itemDefaults_overwrite -> overwrite)
        const itemDefaults = {};
        const defaultsPrefix = 'itemDefaults_';
        for (const [key, value] of Object.entries(block)) {
          if (key.startsWith(defaultsPrefix)) {
            const fieldName = key.slice(defaultsPrefix.length);
            itemDefaults[fieldName] = value;
          }
        }
        log('expandListingBlocks:', {
          blockId,
          itemType,
          fieldMapping: JSON.stringify(fieldMapping),
          itemDefaults: JSON.stringify(itemDefaults),
          itemCount: listingResults[blockId].length,
        });

        // Convert each query result to a block of itemType
        // All expanded items share the same @uid (the listing block's ID)
        // fieldMapping acts as an allowlist: only mapped fields end up on the block.
        // Format: { source: { field: target, type: jsonSchemaType } }
        // Or legacy: { source: target } (simple rename, no conversion)
        const DEFAULT_FIELD_MAPPING = {
          '@id': 'href',
          title: 'title',
          description: 'description',
          image: 'image',
        };
        const effectiveMapping =
          Object.keys(fieldMapping).length > 0
            ? fieldMapping
            : DEFAULT_FIELD_MAPPING;

        for (const result of listingResults[blockId]) {
          const itemBlock = {
            '@uid': blockId, // Block UID for data-block-uid attribute
            '@type': itemType,
            ...itemDefaults,
            readOnly: true,
          };

          for (const [sourceField, mapping] of Object.entries(
            effectiveMapping,
          )) {
            const targetField =
              typeof mapping === 'string' ? mapping : mapping?.field;
            const targetType =
              typeof mapping === 'object' ? mapping?.type : undefined;
            if (!targetField) continue;
            if (result[sourceField] === undefined) continue;

            itemBlock[targetField] = convertFieldValue(
              result[sourceField],
              targetType,
            );
          }

          items.push(itemBlock);
        }
      }

      globalPos += total;
    } else if (block) {
      // Non-listing block: include if it falls in the page window
      if (globalPos >= paging.start && globalPos < paging.start + paging.size) {
        items.push({ ...block, '@uid': blockId });
      }
      globalPos += 1;
    }
  }

  // Build output paging with computed UI values (input is not mutated)
  const seen = priorSeen + batchTotal;
  const outPaging = {
    start: paging.start,
    size: paging.size,
    total: seen,
    seen,
  };
  computePagingUI(outPaging);

  return { items, paging: outPaging };
}

////////////////////////////////////////////////////////////////////////////////
// ploneFetchItems (+ hierarchicalSortByPosition helper)
////////////////////////////////////////////////////////////////////////////////

// A page can ask the SAME question many times: a doc page showing eleven filter
// arrangements over one query, a layout repeating a list. Each caller is its own
// block with its own ids, so nothing upstream can tell they match — only the
// request can, and here it is built.
//
// Identical requests IN FLIGHT AT THE SAME MOMENT share one response. In flight
// only: the next render asks again, so an edited query, a new page or fresh
// content is never served from a stale entry.
//
// The key includes the Authorization header, not just the body. Today the token
// is read from the browser's session (getAccessToken), so a server process is
// always anonymous and every caller there would get the same rows anyway — this
// is defence for the day that changes: two identical queries carrying different
// credentials can legitimately return different rows, and sharing them would
// hand one person another's results. It is not covered by a test, because the
// test environment's storage is inert and the token cannot be driven from one.
const inFlightSearches = new Map();

async function fetchQuerystringSearch(url, headers, payload) {
  const key = `${url}\n${headers.Authorization || ''}\n${payload}`;
  const running = inFlightSearches.get(key);
  if (running) return running;
  const started = (async () => {
    const res = await fetch(url, { method: 'POST', headers, body: payload });
    const data = await res.json();
    // An error answer has no `items`, and read as data it is an empty page:
    // a stock Plone 6.2 rejecting an operation it lacks (400 "Invalid query.")
    // showed "No results found" for every search, with nothing logged.
    if (!res.ok) {
      throw new Error(
        `@querystring-search ${url} answered ${res.status}: ${data?.message ?? ''}`,
      );
    }
    return data;
  })().finally(() => {
    inFlightSearches.delete(key);
  });
  inFlightSearches.set(key, started);
  return started;
}

/**
 * Create a fetchItems callback for Plone's @querystring-search endpoint.
 *
 * @param {Object} options
 * @param {string} options.apiUrl - Plone site URL (e.g., 'http://localhost:8080/Plone')
 * @param {string} [options.contextPath='/'] - Path for relative queries
 * @param {Object} [options.extraCriteria={}] - Additional query params (SearchableText, facet.*, sort_on, sort_order)
 * @returns {Function} fetchItems(block, { start, size }) => Promise<{ items, total }>
 */
export function ploneFetchItems({
  apiUrl,
  contextPath = '/',
  extraCriteria = {},
} = {}) {
  if (!apiUrl) {
    throw new Error('ploneFetchItems requires apiUrl');
  }

  return async function fetchItems(block, { start, size }) {
    const body = buildQuerystringSearchBody(
      block.querystring,
      {
        b_start: start,
        b_size: size,
      },
      extraCriteria,
    );

    const headers = _getAuthHeaders();
    headers['Content-Type'] = 'application/json';

    const path = `${contextPath}/++api++/@querystring-search`;
    const url = `${apiUrl}${path}`;
    const payload = JSON.stringify(body);
    const response = await fetchQuerystringSearch(url, headers, payload);

    const rawItems = response.items || [];
    // Normalize: package image_field + image_scales into a self-contained image
    // object (imageProps needs the @id inside as base URL for relative paths).
    let items = rawItems.map(normalizeCatalogImage);

    // `getObjPositionInParent` is the catalog's position-within-parent
    // index. Plone returns items in flat position order; for a query
    // spanning multiple folders that flat order isn't hierarchical —
    // parents and children interleave by position number. When the
    // listing sorts on it, post-sort into parent-before-children order.
    // This is a pure re-ordering: every item Plone returned is kept and
    // nothing is injected. Tree expansion and pruning for the context
    // navigation is the frontend ContextNavigationBlock's job, not this
    // fetcher's — ploneFetchItems returns exactly what Plone returns.
    if (
      block.querystring?.sort_on === 'getObjPositionInParent' &&
      items.length > 1
    ) {
      items = hierarchicalSortByPosition(items);
    }

    return {
      items,
      total: response.items_total ?? rawItems.length,
    };
  };
}

/**
 * Fetcher for the Related Items example block: renders the CURRENT page's
 * relation field (default `relatedItems`). Reads the context content and pages
 * its relation summaries — no catalog query. A `fetchItems` value for
 * `expandListingBlocks`, same contract as `ploneFetchItems`.
 */
export function relatedItemsFetcher({ apiUrl, contextPath = '/' } = {}) {
  if (!apiUrl) throw new Error('relatedItemsFetcher requires apiUrl');
  return async function fetchItems(block, { start, size }) {
    const field = block.relationField || 'relatedItems';
    const headers = _getAuthHeaders();
    const res = await fetch(`${apiUrl}${contextPath}/++api++`, { headers });
    const content = await res.json();
    const all = Array.isArray(content?.[field]) ? content[field] : [];
    const items = size ? all.slice(start, start + size) : [];
    return { items, total: all.length };
  };
}

// Catalog index → vocabulary of its unique values (site-wide mode). Extend as
// needed; falls back to a same-named vocabulary.
const SEARCH_SHORTCUT_INDEX_VOCAB = {
  Subject: 'plone.app.vocabularies.Keywords',
};

/**
 * Fetcher for the Search Shortcuts example block. Produces one result per value,
 * each a shortcut LINK into a search: `@id` is set to
 * `${searchUrl}?facet.${index}=${value}` so expandListingBlocks' default
 * @id→href mapping renders it as a link item — no special renderer.
 *
 * A linked `pageField` ⇒ THIS page's values of that field; no `pageField` ⇒ all
 * unique values of the index, site-wide (from the index's vocabulary).
 */
export function searchShortcutsFetcher({ apiUrl, contextPath = '/' } = {}) {
  if (!apiUrl) throw new Error('searchShortcutsFetcher requires apiUrl');
  return async function fetchItems(block, { start, size }) {
    const index = block.index || 'Subject';
    const searchUrl = block.searchUrl || '';
    const headers = _getAuthHeaders();

    let values;
    if (block.pageField) {
      const res = await fetch(`${apiUrl}${contextPath}/++api++`, { headers });
      const content = await res.json();
      const v = content?.[block.pageField];
      values = Array.isArray(v) ? v : v == null ? [] : [v];
    } else {
      const vocab = SEARCH_SHORTCUT_INDEX_VOCAB[index] || index;
      const res = await fetch(`${apiUrl}/++api++/@vocabularies/${vocab}`, { headers });
      const data = await res.json();
      values = (data?.items || []).map((t) => t.token);
    }

    const all = values.map((value) => ({
      '@id': `${searchUrl}?facet.${index}=${encodeURIComponent(value)}`,
      title: value,
    }));
    const items = size ? all.slice(start, start + size) : [];
    return { items, total: all.length };
  };
}

function _decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Dependency-free RSS parse (no DOMParser → runs in the browser AND node/jest).
// Good enough for the example; each <item> → a raw result whose @id is the link.
function _parseRssEntries(xml) {
  const out = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const tag = (block, name) => {
    const mm = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
    if (!mm) return undefined;
    return _decodeXml(
      mm[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim(),
    );
  };
  let m;
  while ((m = itemRe.exec(xml))) {
    const b = m[1];
    const entry = {
      '@id': tag(b, 'link') || '',
      title: tag(b, 'title') || '',
      description: tag(b, 'description') || '',
    };
    const pub = tag(b, 'pubDate');
    if (pub !== undefined) entry.pubDate = pub;
    out.push(entry);
  }
  return out;
}

/**
 * Fetcher for the RSS Feed example block: client-side `fetch` of `block.feedUrl`
 * → parse entries. Best-effort — a CORS/parse failure degrades to an empty feed
 * (never throws). Each entry's `@id` is its link, so expandListingBlocks renders
 * it as a link item (no special renderer). `block.count` caps the feed length.
 */
export function rssFetcher() {
  return async function fetchItems(block, { start, size }) {
    let entries = [];
    try {
      const res = await fetch(block.feedUrl);
      entries = _parseRssEntries(await res.text());
    } catch {
      return { items: [], total: 0 };
    }
    if (block.count != null) entries = entries.slice(0, block.count);
    const items = size ? entries.slice(start, start + size) : [];
    return { items, total: entries.length };
  };
}

/**
 * Re-order a flat result set into parent-before-children order,
 * position-sorted within each parent. Each item must have `@id` (used to
 * derive its path + parent path); `getObjPositionInParent` orders
 * siblings (missing values sort last).
 *
 * Pure post-sort: every item is kept and nothing is added. An item whose
 * parent path is not in the set is a top-level root. Each subtree is
 * walked depth-first.
 */
function hierarchicalSortByPosition(items) {
  const pathOf = (item) => {
    try {
      return new URL(item['@id']).pathname;
    } catch {
      return item['@id'];
    }
  };
  const parentOf = (path) => path.replace(/\/[^/]+\/?$/, '') || '/';
  const positionOf = (item) =>
    typeof item.getObjPositionInParent === 'number'
      ? item.getObjPositionInParent
      : Infinity;

  const itemPaths = new Set(items.map(pathOf));
  const childrenByParent = new Map();
  const roots = [];

  for (const item of items) {
    const parent = parentOf(pathOf(item));
    if (itemPaths.has(parent)) {
      const bucket = childrenByParent.get(parent) || [];
      bucket.push(item);
      childrenByParent.set(parent, bucket);
    } else {
      // Parent not in the result set — a top-level root for ordering.
      // Never dropped: a pure post-sort keeps every item Plone returned.
      roots.push(item);
    }
  }

  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => positionOf(a) - positionOf(b));
  }
  roots.sort((a, b) => positionOf(a) - positionOf(b));

  const out = [];
  const visit = (item) => {
    out.push(item);
    const kids = childrenByParent.get(pathOf(item)) || [];
    for (const k of kids) visit(k);
  };
  for (const r of roots) visit(r);
  return out;
}

////////////////////////////////////////////////////////////////////////////////
// Field type utilities
////////////////////////////////////////////////////////////////////////////////

/**
 * Convert a schema field definition to a "type:widget" string.
 * Mirrors the format used by extractBlockFieldTypes in View.jsx.
 * @param {Object} field - Schema field definition with optional type and widget
 * @returns {string} Field type string like "string", "array:slate", "string:textarea", ":object_browser"
 */
export function getFieldTypeString(field) {
  const type = field.type;
  const widget = field.widget;
  if (type && widget) return `${type}:${widget}`;
  // A field with a widget and no declared `type` is a STRING — which is exactly
  // what the no-widget path below has always assumed. Emitting `:widget` made a
  // widget quietly mean "no type at all", and the predicates key off the type
  // half: `isPlainStringFieldType` wants `string` or `string:…`, so such a field
  // stopped being inline-editable.
  //
  // Which is not hypothetical. `copy-from-target` swaps a mapped destination
  // field's widget to `copyFromTargetField`, so a card's `title` — declared as
  // just `{ title: 'Headline' }`, as most schemas declare an obvious string —
  // went from `string` to `:copyFromTargetField` the moment the block gained the
  // ability to fill itself from a link. Typing into a card title silently
  // stopped working, and a front-page demo video filmed someone doing it to a
  // card that stayed empty.
  //
  // Widgets that imply a different EDITOR are unaffected: the predicates match
  // on `:slate` / `:textarea` anywhere in the string, so `string:textarea` still
  // reads as a textarea.
  if (widget) return `string:${widget}`;
  if (type) return type;
  return 'string';
}

/**
 * Check if a field type indicates a Slate field.
 * Handles both old format ('slate') and new format ('array:slate'). A `richtext`
 * widget is HTML, not slate, so it is deliberately NOT matched here.
 * @param {string} fieldType - Field type string
 * @returns {boolean}
 */
export function isSlateFieldType(fieldType) {
  if (!fieldType) return false;
  // A `richtext` widget stores HTML ({data, content-type, encoding}), NOT slate,
  // so it is NOT inline-editable in the bridge — do not treat `:richtext` as a
  // slate field.
  return fieldType === 'slate' || fieldType.includes(':slate');
}

/**
 * Check if a field type indicates a textarea field.
 * @param {string} fieldType - Field type string
 * @returns {boolean}
 */
export function isTextareaFieldType(fieldType) {
  return fieldType?.includes(':textarea') || false;
}

/**
 * Check if a field type indicates a plain string field (single-line text).
 * @param {string} fieldType - Field type string
 * @returns {boolean}
 */
export function isPlainStringFieldType(fieldType) {
  if (!fieldType) return false;
  if (isSlateFieldType(fieldType) || isTextareaFieldType(fieldType)) {
    return false;
  }
  return fieldType === 'string' || fieldType.startsWith('string:');
}

/**
 * Check if a field type is text-editable (string, textarea, or slate).
 * @param {string} fieldType - Field type string
 * @returns {boolean}
 */
export function isTextEditableFieldType(fieldType) {
  if (!fieldType) return false;
  return (
    isSlateFieldType(fieldType) ||
    isTextareaFieldType(fieldType) ||
    isPlainStringFieldType(fieldType)
  );
}

////////////////////////////////////////////////////////////////////////////////
// deepEqual + formDataContentEqual + findChangedUnit
////////////////////////////////////////////////////////////////////////////////

/**
 * Key-order-independent deep equality check for JSON-like objects.
 * JSON.stringify comparison fails when the same data has different key ordering
 * (e.g., Plone API returns {type, children} but Slate produces {children, type}).
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!b.hasOwnProperty(k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Compare two formData objects for content equality, ignoring _editSequence.
 * Used to detect if form content has actually changed vs just metadata.
 * @param {Object} formDataA - First formData object
 * @param {Object} formDataB - Second formData object
 * @returns {boolean} True if content is equal (ignoring _editSequence)
 */
export function formDataContentEqual(formDataA, formDataB) {
  if (!formDataA || !formDataB) return formDataA === formDataB;
  const { _editSequence: seqA, ...contentA } = formDataA;
  const { _editSequence: seqB, ...contentB } = formDataB;
  return deepEqual(contentA, contentB);
}

/**
 * Find the SHALLOWEST changed unit between two formData snapshots.
 *
 * Returns one of:
 *   - null                                — forms are deep-equal, no edit happened.
 *   - { unit: 'page' }                    — render the whole content area.
 *   - { unit: 'block', blockId: 'X' }     — render only block X.
 *
 * Used by server-rendered frontends (Astro / PHP / Django / Rails — anything
 * without client-side reactivity). The bridge invokes this internally when
 * `renderEndpoint` is configured on initBridge; the result tells the bridge
 * what to POST to the server-render endpoint.
 *
 * Algorithm (recursive, walks DOWN from the page):
 *
 *   1. If items array at this level differs (add/remove/reorder) → THIS
 *      level is the unit. Re-render this container, its children come along.
 *   2. Otherwise find children whose data differs (deep compare):
 *        - 0 differ → no change here, return null
 *        - 1 differ AND child is a container → recurse into it. If
 *          recursion finds a deeper unit, return that; otherwise return
 *          the child itself.
 *        - 1 differ, leaf → return that child.
 *        - 2+ differ → return THIS level (multiple children changed,
 *          shallowest common parent is here).
 *
 * Spans more than one nesting level (e.g. block moved from col-1 to col-2
 * — both containers' items change) → walks up to PAGE.
 *
 * Reactive frontends (Vue/React/Svelte/Solid) don't need this — their
 * framework reconciliation provides per-block updates implicitly. Pure
 * server-rendered frontends do: a naive full-page innerHTML swap on every
 * keystroke would destroy contenteditable cursors, image loads, scroll
 * state. Diffing to the smallest changed unit makes outerHTML swaps
 * targeted enough that the unchanged DOM keeps its state.
 */
export function findChangedUnit(prevForm, newForm) {
  if (deepEqual(prevForm, newForm)) return null;
  // Compare ids across EVERY region of blocks_layout (items, footer, …), not
  // just `items`: a change in a non-items region would otherwise fall through to
  // a full-page swap, destroying the contenteditable cursor mid-edit in that
  // region — the exact thing this targeted-diff exists to avoid.
  const prevIds = allRegionIds(prevForm?.blocks_layout);
  const newIds = allRegionIds(newForm?.blocks_layout);
  if (!deepEqual(prevIds, newIds)) return { unit: 'page' };
  const prevBlocks = prevForm?.blocks || {};
  const newBlocks = newForm?.blocks || {};
  const changed = [];
  for (const id of newIds) {
    if (!deepEqual(prevBlocks[id], newBlocks[id])) changed.push(id);
  }
  // No top-level block data changed but forms differ → page-level scalar
  // (title, description, etc.) changed. Re-render page.
  if (changed.length === 0) return { unit: 'page' };
  if (changed.length > 1) return { unit: 'page' };
  const blockId = changed[0];
  const inner = _findChangedInBlock(prevBlocks[blockId], newBlocks[blockId]);
  if (inner?.unit === 'this') return { unit: 'block', blockId };
  if (inner?.unit === 'block') return inner;
  return { unit: 'block', blockId };
}

/**
 * Container fields on a block worth recursing into. Mirrors the
 * blockPathMap conventions: `blocks_layout` for slate/image/etc lists,
 * `columns` for column items in a columns block — both reference ids
 * in the same sibling `blocks` dict.
 */
function _getContainerFields(block) {
  if (!block || typeof block !== 'object') return [];
  const fields = [];
  // Every blocks field is a sub-key of the shared blocks_layout dict (the
  // default `items`, plus named fields like `columns`, `listing`, `footer`).
  // Each sub-key is an ordered id list into the same sibling `blocks` dict.
  if (block.blocks_layout && block.blocks) {
    for (const ids of Object.values(block.blocks_layout)) {
      if (Array.isArray(ids)) {
        fields.push({ items: ids, blocks: block.blocks });
      }
    }
  }
  return fields;
}

function _findChangedInBlock(prevBlock, newBlock) {
  const newFields = _getContainerFields(newBlock);
  const prevFields = _getContainerFields(prevBlock);
  if (newFields.length !== prevFields.length) return { unit: 'this' };
  for (let f = 0; f < newFields.length; f++) {
    const cur = newFields[f];
    const old = prevFields[f];
    if (!deepEqual(cur.items, old.items)) return { unit: 'this' };
    const changed = [];
    for (const childId of cur.items) {
      if (!deepEqual(cur.blocks[childId], old.blocks[childId]))
        changed.push(childId);
    }
    if (changed.length === 0) continue;
    if (changed.length > 1) return { unit: 'this' };
    const childId = changed[0];
    const inner = _findChangedInBlock(old.blocks[childId], cur.blocks[childId]);
    if (inner?.unit === 'this') return { unit: 'block', blockId: childId };
    if (inner?.unit === 'block') return inner;
    return { unit: 'block', blockId: childId };
  }
  return null;
}

/**
 * Decide whether the only differences between two block objects are
 * `.text` string changes inside slate `value[]` arrays. Used by
 * `_installRenderEndpoint` (in hydra.src.js) to decide whether a render
 * is necessary on a server-only frontend like Astro — if the change is
 * text-only AND the iframe DOM already has the new text (because the
 * user typed it directly into the contenteditable), we can skip the
 * POST + outerHTML swap, preserving cursor / focus / IME state.
 *
 * Returns `true` when:
 *   - block @type and all non-slate fields are deepEqual
 *   - any slate fields (value, description, etc. — heuristic: array of
 *     {type, children} or {text} nodes) differ only in `.text` strings
 *     with the SAME node tree structure (same number of nodes at each
 *     level, same types, same marks, same attrs other than text/nodeId)
 *
 * Returns `false` for anything structural (new/removed/reordered nodes,
 * changed marks like bold, link href changes, image url, slot id, etc.).
 * False on those forces a render so the bridge's existing cursor
 * save/restore + blockedBlockId protections kick in for transforms.
 *
 * Ignores `nodeId` on every node — the bridge stamps these and they can
 * legitimately differ between renders without being a "real" change.
 */
export function isTextOnlyBlockChange(prevBlock, newBlock) {
  if (!prevBlock || !newBlock) return false;
  // Block-level non-slate fields must match exactly. We strip slate-shaped
  // arrays out so we can compare them separately with the text-only rule.
  const stripSlateFields = (block) => {
    const out = {};
    const slateFieldNames = [];
    for (const [k, v] of Object.entries(block)) {
      if (_looksLikeSlateValue(v)) {
        slateFieldNames.push(k);
      } else {
        out[k] = v;
      }
    }
    return { stripped: out, slateFieldNames };
  };
  const pa = stripSlateFields(prevBlock);
  const pb = stripSlateFields(newBlock);
  if (!deepEqual(pa.stripped, pb.stripped)) return false;
  if (!deepEqual(pa.slateFieldNames.sort(), pb.slateFieldNames.sort()))
    return false;
  for (const field of pa.slateFieldNames) {
    if (!_slateValuesDifferOnlyInText(prevBlock[field], newBlock[field]))
      return false;
  }
  return true;
}

function _looksLikeSlateValue(v) {
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every(
    (n) =>
      n &&
      typeof n === 'object' &&
      (typeof n.text === 'string' || Array.isArray(n.children)),
  );
}

function _slateValuesDifferOnlyInText(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (!_slateNodeDiffersOnlyInText(prev[i], next[i])) return false;
  }
  return true;
}

/**
 * Walk a formData tree and find the block with the given uid anywhere
 * in the nested blocks dicts (columns -> col-N.blocks -> slate, etc.).
 * Returns the block data object or null. Pure walk — no use of
 * blockPathMap, no Bridge dependency.
 */
export function findBlockInForm(form, blockId) {
  if (!form || !blockId) return null;
  const blocks = form.blocks;
  if (!blocks) return null;
  if (blocks[blockId]) return blocks[blockId];
  for (const child of Object.values(blocks)) {
    if (child && typeof child === 'object') {
      const inside = findBlockInForm(child, blockId);
      if (inside) return inside;
    }
  }
  return null;
}

/**
 * Concatenate all text leaves of a slate-style node array, in document
 * order. Used by the renderEndpoint's text-only-skip heuristic to
 * compare with the iframe DOM's textContent.
 */
export function slateNodesText(nodes) {
  if (!Array.isArray(nodes)) return '';
  let out = '';
  for (const n of nodes) {
    if (!n) continue;
    if (typeof n.text === 'string') out += n.text;
    else if (Array.isArray(n.children)) out += slateNodesText(n.children);
  }
  return out;
}

/**
 * True when a slate value holds nothing an author wrote.
 *
 * Every slate field has a top node — the editor defaults one to a single empty
 * paragraph — so "nothing written" is that paragraph, not an absent value, and
 * a one-node array always passes a plain truthiness check. A renderer hiding an
 * optional slate field asks this instead: `!isEmptySlate(block.summary) && …`.
 *
 * Empty means: absent (content saved before the default), `[]`, or one `p`
 * whose children are all text leaves with no text. Anything else is content —
 * a heading, an image, an inline element, or the zero-width space reveal
 * renders precisely so the field shows.
 */
export function isEmptySlate(value) {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value)) {
    throw new TypeError(`isEmptySlate expects a slate value (an array), got ${typeof value}`);
  }
  if (value.length === 0) return true;
  if (value.length > 1) return false;
  const [node] = value;
  return (
    node?.type === 'p' &&
    Array.isArray(node.children) &&
    node.children.every((c) => typeof c.text === 'string' && c.text === '')
  );
}

function _slateNodeDiffersOnlyInText(p, n) {
  if (!p || !n) return p === n;
  const pIsText = typeof p.text === 'string';
  const nIsText = typeof n.text === 'string';
  if (pIsText !== nIsText) return false;
  if (pIsText) {
    // Both text leaves. `text` strings may differ; marks (bold, italic, ...)
    // must match. nodeId is bridge-stamped, ignore.
    const { text: _pt, nodeId: _pn, ...prest } = p;
    const { text: _nt, nodeId: _nn, ...nrest } = n;
    return deepEqual(prest, nrest);
  }
  // Both element nodes. Type, attrs, data must match (ignoring nodeId).
  // Then recurse into children.
  const { children: pc, nodeId: _pn, ...prest } = p;
  const { children: nc, nodeId: _nn, ...nrest } = n;
  if (!deepEqual(prest, nrest)) return false;
  return _slateValuesDifferOnlyInText(pc || [], nc || []);
}

/**
 * Convert a Plone image value to a full URL suitable for `<img src>`.
 *
 * Handles every shape the Plone REST API hands back:
 *   - string paths (relative or absolute)
 *   - objects with an `@id`
 *   - catalog brains with `image_scales` + `image_field`
 *   - arrays of the above (first element wins)
 *
 * Relative paths are prefixed with `apiUrl`. For paths that don't already
 * point at a scale URL (no `@@images` / `@@download`), the canonical
 * `@@images/image` suffix is appended.
 *
 * Was previously duplicated in each example's `utils.js`. Centralised
 * here because every frontend needs the same URL resolution; per-example
 * copies always drifted from each other.
 *
 * `apiUrl` is the base origin (e.g. `'http://localhost:8888'`) — pass it
 * explicitly so this works in SSR / Node where `window` is undefined.
 */
export function getImageUrl(value, apiUrl = '') {
  if (!value) return '';

  // Catalog brain with image_scales
  if (value.image_scales && value.image_field) {
    const field = value.image_field;
    const scales = value.image_scales[field];
    if (scales?.[0]?.download) {
      // A `preview_image_link` relation (e.g. a case-study teaser pointing at a
      // shared /logos/<client> image) serializes its scales on the LINKED image,
      // not this item. plone.volto stamps each scale entry with `base_path` = the
      // linked image's path; use it as the base (Volto's Image.jsx does the same:
      // `image.base_path || item['@id']`). Otherwise the URL resolves against the
      // referencing item and 404s / serves the wrong image.
      const baseUrl = scales[0].base_path || value['@id'] || '';
      const prefix = baseUrl.startsWith('http') ? '' : apiUrl;
      return `${prefix}${baseUrl}/${scales[0].download}`;
    }
  }

  // No image data (catalog brain without image_scales) — return empty
  if (value.image_scales === null || value.image_field === '') return '';

  // Extract URL from various formats
  let url = Array.isArray(value) ? value[0]?.['@id'] : value?.['@id'] || value;
  if (typeof url !== 'string') return '';

  // Add @@images/image for content paths without a scale URL
  if (
    url.startsWith('/') &&
    !url.includes('@@images') &&
    !url.includes('@@download')
  ) {
    url = `${url}/@@images/image`;
  }

  // Prepend API origin for relative paths
  if (url.startsWith('/')) {
    url = `${apiUrl}${url}`;
  }

  return url;
}

////////////////////////////////////////////////////////////////////////////////
// Plone template family
//
// Templates are Plone documents whose `blocks` describe a layout (with
// `fixed: true` blocks for chrome) or a snippet (no fixed blocks). At
// render time we merge templates into a page's `blocks_layout` so the
// frontend renders the composed result. All of this is pure data —
// no DOM, no postMessage, no Bridge state — so it lives here in helpers
// to be shared by hydra-js (admin), Nuxt/Astro/Vue SSR frontends and the
// admin's `mergeTemplatesIntoPage`.
//
// Container-aware predicates / Bridge methods (e.g. canContain) stay in
// containerOps.js; only the templateEditMode-aware addability helpers and
// canContainAll were pulled in because they're called from both SSR
// (helpers) and bridge code paths.
////////////////////////////////////////////////////////////////////////////////

/**
 * Marker field name used internally to flag template blocks during
 * legacy migrations. Kept exported because external callers may still
 * key off it; current code uses the flat `templateId` / `slotId` fields.
 */
export const TEMPLATE_MARKER = '_template';

/**
 * SSR-safe edit-mode detector. Mirrors hydra-js's `isEditMode` but
 * returns false on the server so template expansion works the same way
 * in Node (Astro/Nuxt server render) as it does in the browser.
 */
function _isEditMode() {
  if (typeof window === 'undefined') {
    return false;
  }
  const url = new URL(window.location.href);
  const editParam = url.searchParams.get('_edit');
  return window.name.startsWith('hydra-edit:') || editParam === 'true';
}

/**
 * Simple UUID generator for block IDs.
 * @returns {string} UUID v4 format string
 */
function uuidFromRand(rand) {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (rand() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateUUID() {
  return uuidFromRand(Math.random);
}

/**
 * Deterministic UUID-format id derived from a seed string: the same seed always
 * yields the same id. Used to mint a template instance id from a stable data key
 * (the region's first block id) so a server render and the client hydration agree
 * on `${instanceId}::${tplChildId}` block uids — a random id would differ between
 * the two passes and trigger a React hydration mismatch (and, because that id is
 * the block's edit identity, confuse block selection). xfnv1a hash → mulberry32
 * PRNG, so it's pure/deterministic (no Math.random, no crypto).
 * @param {string} seed
 * @returns {string} UUID v4 format string
 */
function deterministicUUID(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  const rand = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return uuidFromRand(rand);
}

/**
 * Extract content field values from a block to use as fieldPlaceholders.
 * Skips system/template fields. Only includes fields with actual content.
 * @param {Object} block - The block data
 * @returns {Object} Map of fieldName -> value for non-empty content fields
 */
function extractFieldPlaceholders(block) {
  const SYSTEM_FIELDS = new Set([
    '@type',
    '@uid',
    'templateId',
    'templateInstanceId',
    'slotId',
    'fixed',
    'readOnly',
    'readOnly',
    'fieldPlaceholders',
    'fieldMappings',
    'blocks',
    'blocks_layout',
    'nextSlotId',
    'childSlotIds',
  ]);
  const placeholders = {};
  for (const [key, value] of Object.entries(block)) {
    if (SYSTEM_FIELDS.has(key)) continue;
    if (typeof value === 'string' && value.trim()) {
      placeholders[key] = value;
    } else if (Array.isArray(value) && value.length > 0 && value[0]?.children) {
      // Slate value — check if there's text content
      const text = value
        .map((n) => (n.children || []).map((c) => c.text || '').join(''))
        .join('')
        .trim();
      if (text) placeholders[key] = value;
    }
  }
  return placeholders;
}

/**
 * Check if a template is a layout (has fixed blocks at edges).
 * Layout = first or last block has fixed: true (Volto standard property).
 *
 * @param {Object} templateData - Template document with blocks and blocks_layout
 * @returns {boolean}
 */
export function isLayoutTemplate(templateData) {
  const { blocks, blocks_layout } = templateData;
  const layout = blocks_layout?.items || [];
  if (layout.length === 0) return false;

  const firstBlock = blocks?.[layout[0]];
  const lastBlock = blocks?.[layout[layout.length - 1]];

  // If first or last block has fixed: true (Volto standard), it's a layout
  const firstIsFixed = firstBlock?.fixed === true;
  const lastIsFixed = lastBlock?.fixed === true;

  return firstIsFixed || lastIsFixed;
}

/**
 * Find slot regions in a template.
 * Slot blocks (fixed: false) with same slotId form a region.
 *
 * @param {Object} templateData - Template document
 * @returns {Object} { slotId: { blockIds: [], allowedBlocks: [] } }
 */
export function findSlotRegions(templateData) {
  const { blocks, blocks_layout } = templateData;
  const layout = blocks_layout?.items || [];
  const regions = {};

  for (const blockId of layout) {
    const block = blocks?.[blockId];
    // Slot blocks have fixed: false (or undefined) and a slotId
    if (block?.fixed) continue; // Skip fixed blocks

    const slotId = block?.slotId;
    if (slotId) {
      if (!regions[slotId]) {
        regions[slotId] = {
          blockIds: [],
          allowedBlocks: null,
        };
      }
      regions[slotId].blockIds.push(blockId);
    }
  }
  return regions;
}

/**
 * Check if a template is allowed in a given container context.
 *
 * @param {Object} templateData - Template document
 * @param {string} containerType - Block @type of container (e.g., "page", "columns")
 * @param {string} fieldName - Container field name (e.g., "blocks")
 * @returns {boolean}
 */
export function isTemplateAllowedIn(templateData, containerType, fieldName) {
  const { allowed_container_types, allowed_field_names } = templateData;

  // If no restrictions, allow everywhere
  if (!allowed_container_types?.length && !allowed_field_names?.length) {
    return true;
  }

  // Check restrictions
  const typeOk =
    !allowed_container_types?.length ||
    allowed_container_types.includes(containerType);
  const fieldOk =
    !allowed_field_names?.length || allowed_field_names.includes(fieldName);

  return typeOk && fieldOk;
}

/**
 * Filter templates for "Apply Layout" UI.
 * Returns templates that are layouts and allowed in the given context.
 *
 * @param {Array} templates - Array of template documents
 * @param {string} containerType - Block @type of container
 * @param {string} fieldName - Container field name
 * @returns {Array} Filtered templates
 */
export function getLayoutTemplates(templates, containerType, fieldName) {
  return templates.filter(
    (t) =>
      isLayoutTemplate(t) && isTemplateAllowedIn(t, containerType, fieldName),
  );
}

/**
 * Filter templates for block chooser (snippets).
 * Returns templates that are NOT layouts and allowed in the given context.
 *
 * @param {Array} templates - Array of template documents
 * @param {string} containerType - Block @type of container
 * @param {string} fieldName - Container field name
 * @returns {Array} Filtered templates
 */
export function getSnippetTemplates(templates, containerType, fieldName) {
  return templates.filter(
    (t) =>
      !isLayoutTemplate(t) && isTemplateAllowedIn(t, containerType, fieldName),
  );
}

/**
 * Clone template blocks with fresh UUIDs.
 * Recursively filters nested blocks to only include those with template markers.
 *
 * @param {Object} blocks - Template blocks object
 * @param {Array} layout - Template blocks_layout.items array
 * @param {Function} uuidGenerator - Function to generate UUIDs (default: generateUUID)
 * @returns {Object} { blocks, layout, idMap } where idMap tracks old->new IDs
 */
export function cloneBlocksWithNewIds(
  blocks,
  layout,
  uuidGenerator = generateUUID,
) {
  const idMap = {}; // oldId -> newId
  const newBlocks = {};
  const newLayout = [];

  for (const oldId of layout) {
    const newId = uuidGenerator();
    idMap[oldId] = newId;

    // Deep clone the block, filtering nested blocks without template markers
    const block = blocks[oldId];
    if (block) {
      newBlocks[newId] = cloneBlockFilteringNested(block, uuidGenerator);
    }

    newLayout.push(newId);
  }

  return { blocks: newBlocks, layout: newLayout, idMap };
}

/**
 * Clone a block, recursively filtering nested blocks without template markers.
 * Only nested blocks with `slotId` or `templateId` are included. Storage-agnostic: iterates
 * EVERY child field via getChildFields (blocks_layout regions AND object_list arrays) and reads/
 * writes through the funnel — the same region-aware pattern as fillContainerInto. Handling only
 * blocks_layout left a nested object_list (a slider's `slides`) with its template-internal blocks
 * and original ids on insert.
 *
 * @param {Object} block - Block to clone
 * @param {Function} uuidGenerator - Function to generate UUIDs
 * @returns {Object} Cloned block with filtered nested blocks
 */
export function cloneBlockFilteringNested(block, uuidGenerator) {
  // Start with a shallow clone
  const cloned = { ...block };

  const fields = getChildFields(cloned);
  if (fields.length === 0) return cloned;

  // blocks_layout regions share cloned.blocks — reset it once so template-internal blocks don't
  // linger; object_list fields are independent arrays, rewritten in place per field.
  if (fields.some((f) => !f.isObjectList)) {
    cloned.blocks = {};
    cloned.blocks_layout = {};
  }

  for (const field of fields) {
    const kept = [];
    // Read from the ORIGINAL block (cloned.blocks may already be reset above).
    for (const { block: nestedBlock } of getChildBlockEntries(block, field)) {
      // Only include nested blocks that have template markers
      if (nestedBlock.slotId || nestedBlock.templateId) {
        kept.push({
          id: uuidGenerator(),
          // Recursively filter this nested block's children too
          block: cloneBlockFilteringNested(nestedBlock, uuidGenerator),
        });
      }
    }
    setChildBlockEntries(cloned, field, kept);
  }

  return cloned;
}

/**
 * Copy a page's blocks for a translation: every block, at every depth, under a
 * new id.
 *
 * Volto's own copy walks blocks_layout and renames what it finds there. That
 * leaves a container's children with the ids they had, so one uid names a block
 * on two pages at once — and everything that addresses a block by uid
 * (selection, inline editing, the bridge) has no way to tell which page is
 * meant. Children are reached here through the SAME container API the editor
 * uses everywhere else, so regions and object_list children are both covered,
 * however deep they nest.
 *
 * Each copy records `@canonical`: the id of the block it came from. That is the
 * only link back to the original, and what lets a translator be shown which
 * blocks still hold the source language.
 *
 * @param {Object} blocks - The original page's blocks
 * @param {Array} layout - The original page's blocks_layout items
 * @param {Function} uuidGenerator - Function to generate UUIDs
 * @returns {{blocks: Object, layout: Array}} The copy
 */
export function cloneBlocksForTranslation(
  blocks,
  layout,
  uuidGenerator = generateUUID,
  idFieldMap = null,
  fingerprintOf = null,
) {
  const newBlocks = {};
  const newLayout = [];

  for (const oldId of layout || []) {
    const block = blocks?.[oldId];
    if (!block) continue;
    const newId = uuidGenerator();
    newLayout.push(newId);
    newBlocks[newId] = cloneBlockForTranslation(
      block,
      oldId,
      uuidGenerator,
      idFieldMap,
      fingerprintOf,
    );
  }

  return { blocks: newBlocks, layout: newLayout };
}

/**
 * One block and everything under it, copied under new ids.
 *
 * Each copy records what it was made FROM: `@canonical`, the id of the source
 * block, and a fingerprint of that block's translatable content. The
 * fingerprint is what later says the source has CHANGED — `@canonical` alone
 * pairs them, and comparing the words only finds a copy nobody has touched.
 * Without a `fingerprintOf` the copy records no fingerprint and the page
 * reports those blocks as unknown rather than pretending to know.
 */
function cloneBlockForTranslation(
  block,
  oldId,
  uuidGenerator,
  idFieldMap,
  fingerprintOf = null,
) {
  const cloned = { ...block, '@canonical': oldId };
  if (fingerprintOf) {
    const fingerprint = fingerprintOf(block, oldId, getBlockType(block));
    if (fingerprint) cloned['@translation'] = { fingerprint };
  }

  const fields = getChildFields(cloned, idFieldMap, { allObjectLists: true });
  if (fields.length === 0) return cloned;

  // Regions share one `blocks` map, so it is rebuilt once; object_list fields
  // are independent arrays, rewritten per field.
  if (fields.some((f) => !f.isObjectList)) {
    cloned.blocks = {};
    cloned.blocks_layout = {};
  }

  for (const field of fields) {
    const copies = [];
    // Read from the ORIGINAL: `cloned.blocks` may already have been reset.
    for (const { id, block: child } of getChildBlockEntries(block, field)) {
      copies.push({
        id: uuidGenerator(),
        block: cloneBlockForTranslation(
          child,
          id,
          uuidGenerator,
          idFieldMap,
          fingerprintOf,
        ),
      });
    }
    setChildBlockEntries(cloned, field, copies);
  }

  return cloned;
}

/**
 * The same block, in the other language.
 *
 * A translation's blocks are copies, and each records `@canonical`: the id of
 * the block it came from. That is the whole pairing — and it reads both ways,
 * because either the page you are looking at is the copy, or the one beside it
 * is. Volto writes this and never reads it; here it is what lets a selection,
 * or a scroll, mean the same thing on both sides.
 *
 * A block added after the copy has no counterpart, and gets null: worth saying
 * plainly, because it tells the translator the block is new.
 *
 * @param {Object} blocks - the page the block is on (any depth)
 * @param {string} blockId - the block in question
 * @param {Object} otherBlocks - the page beside it
 * @param {Object} [idFieldMap] - which fields hold children, per block type
 * @returns {string|null}
 */
export function counterpartBlockId(blocks, blockId, otherBlocks, idFieldMap = null) {
  const here = findBlockAnywhere(blocks, blockId, idFieldMap);
  if (!here) return null;

  // This page is the copy: it says where it came from.
  const canonical = here['@canonical'];
  if (canonical && findBlockAnywhere(otherBlocks, canonical, idFieldMap)) {
    return canonical;
  }

  // Or the page beside it is the copy, and one of its blocks came from this.
  let found = null;
  walkBlocks(otherBlocks, idFieldMap, (id, block) => {
    if (!found && block?.['@canonical'] === blockId) found = id;
  });
  return found;
}

/** A block by id, wherever it is nested. */
function findBlockAnywhere(blocks, blockId, idFieldMap) {
  let found = null;
  walkBlocks(blocks, idFieldMap, (id, block) => {
    if (!found && id === blockId) found = block;
  });
  return found;
}

/** Every block of a page, at every depth, through the container API. */
function walkBlocks(blocks, idFieldMap, visit) {
  for (const [id, block] of Object.entries(blocks || {})) {
    visit(id, block);
    for (const field of getChildFields(block, idFieldMap, { allObjectLists: true })) {
      const nested = {};
      for (const entry of getChildBlockEntries(block, field)) {
        nested[entry.id] = entry.block;
      }
      walkBlocks(nested, idFieldMap, visit);
    }
  }
}

/**
 * The same blocks, every one of them read-only — at every depth.
 *
 * Not a new kind of frame: read-only is already a property of a BLOCK, which
 * hydra.js honours by collecting no editable fields for it and the sidebar by
 * showing its settings as text. A page that may be read but not changed — a
 * compared language, an old version — is that property applied to all of it.
 *
 * @param {Object} blocks
 * @param {Object} [idFieldMap] - which fields hold children, per block type
 * @returns {Object} a copy; the original is untouched
 */
export function withAllBlocksReadOnly(blocks, idFieldMap = null) {
  const out = {};
  for (const [id, block] of Object.entries(blocks || {})) {
    out[id] = markBlockReadOnly(block, idFieldMap);
  }
  return out;
}

function markBlockReadOnly(block, idFieldMap) {
  const marked = { ...block, readOnly: true };
  for (const field of getChildFields(marked, idFieldMap, { allObjectLists: true })) {
    const children = [];
    for (const { id, block: child } of getChildBlockEntries(block, field)) {
      children.push({ id, block: markBlockReadOnly(child, idFieldMap) });
    }
    if (!field.isObjectList) {
      // Regions share one map; rebuild it rather than mutating the original's.
      marked.blocks = { ...marked.blocks };
    }
    setChildBlockEntries(marked, field, children);
  }
  return marked;
}

// Fields that LOOK like text and are not prose: a link target, a token, a
// date, a colour. Translating one breaks rendering rather than the sentence —
// `variation: "summary"` becoming "Zusammenfassung" stops the block resolving —
// and a change to one is no reason to re-read a translation.
const NON_PROSE_WIDGETS = new Set([
  'object_browser',
  'url',
  'email',
  'date',
  'datetime',
  'time',
  'color',
  'icon',
  'json',
  'copyFromTargetField',
]);

// Fields that hold OTHER BLOCKS. They have fingerprints of their own.
const CHILD_WIDGETS = new Set(['blocksid_list', 'object_list']);

/**
 * The fields of a block a translator would rewrite.
 *
 * The schema is the only thing that can say: a string field is prose, a link,
 * an icon name or a variation id, and the value alone cannot tell you which.
 * `isTextEditableFieldType` already answers "can this be typed into" for inline
 * editing; translatable is that, minus what is shared between languages
 * (`multilingual_options.language_independent`, the same flag a content type's
 * fields use) and minus text-shaped fields that are not sentences.
 *
 * @param {Object} schema - the BLOCK TYPE's schema
 * @returns {string[]} field ids, in schema order
 */
export function translatableFieldIds(schema) {
  const properties = schema?.properties;
  if (!properties) return [];
  return Object.entries(properties)
    .filter(([, def]) => {
      if (!def) return false;
      if (def.multilingual_options?.language_independent) return false;
      if (CHILD_WIDGETS.has(def.widget)) return false;
      if (NON_PROSE_WIDGETS.has(def.widget)) return false;
      // A field with a fixed set of values holds a token, not a sentence.
      if (def.choices || def.vocabulary) return false;
      return isTextEditableFieldType(getFieldTypeString(def));
    })
    .map(([id]) => id);
}

/** Text as it MEANS, not as a round trip happens to have left it. */
function normalizeText(value) {
  return value.replace(/\r\n?/g, '\n').trim();
}

/**
 * A value in one canonical form, so the same content always hashes the same.
 * Object keys are sorted (insertion order survives neither a form nor JSON);
 * array order is content and is kept.
 */
function canonicalize(value) {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value ?? null;
}

/** FNV-1a, twice, for a short stable hash. Change detection, not security. */
function hashString(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * A fingerprint of the SOURCE content a translation was written from.
 *
 * Stored on the translated block beside `@canonical`, it answers the question
 * nothing else could: the source has changed since this was translated, so
 * revisit it. `untranslatedBlockIds` only finds a copy nobody has touched, and
 * says nothing once German has been typed.
 *
 * SHALLOW on purpose: a container's children carry their own fingerprints, so
 * including them would mark the parent stale for a child's edit and the sidebar
 * roll-up would count one edit twice.
 *
 * @param {Object} block - the SOURCE block
 * @param {Object} schema - that block type's schema
 * @returns {string} a stable hash of its translatable fields
 * @throws when the schema is missing or has nothing translatable — without it
 *   prose cannot be told from a variation id, and a guess marks blocks stale
 *   for changes a translator does not care about
 */
export function sourceFingerprint(block, schema) {
  if (!schema?.properties) {
    throw new Error(
      'sourceFingerprint: no schema for this block type — cannot tell which fields are translatable',
    );
  }
  // A block with nothing to translate — a separator, an image, a spacer — is
  // not an error and not unknown: it can never go stale, because no words in it
  // can change. `null` says exactly that, and is distinct from the throw above,
  // which means we do not know what this block type IS.
  const fields = translatableFieldIds(schema);
  if (!fields.length) return null;
  const content = {};
  for (const id of fields) {
    if (block?.[id] === undefined) continue;
    content[id] = canonicalize(block[id]);
  }
  return hashString(JSON.stringify(content));
}

/**
 * The same schema, with the named fields shown but not editable.
 *
 * `readOnly` is already the word for this: a BLOCK carries it (see
 * isBlockReadonly, withAllBlocksReadOnly) and the sidebar answers by rendering
 * its values as text rather than a disabled form. This is the same flag one
 * level down, on a field — the translation inherits the canonical's tags, so
 * asking for them again would offer two homes for one value.
 *
 * Not `mode: 'readonly'`, though Volto's Field reads `mode` for `hidden`:
 * `mode` is already overloaded per widget (object_browser reads it as
 * link/image/multiple), so a read-only object_browser field could not have said
 * both.
 *
 * @param {Object} schema - a Volto schema (fieldsets / properties / required)
 * @param {string[]} fieldIds - the fields to show read-only
 * @returns {Object} a copy; the original is untouched
 */
export function withFieldsReadOnly(schema, fieldIds) {
  if (!schema || !fieldIds?.length) return schema;
  const properties = { ...schema.properties };
  for (const id of fieldIds) {
    // A field the schema doesn't have is not ours to invent.
    if (!properties[id]) continue;
    properties[id] = { ...properties[id], readOnly: true };
  }
  return { ...schema, properties };
}

/**
 * Which of a page's fields are inherited from the language it was translated
 * from, rather than owned by the page itself.
 *
 * A language-independent field is ONE value shared by a translation group, so
 * it needs one home: the page in the site's default language. Its translations
 * show the value and send the editor there. Volto marks these fields only while
 * a translation is being created — its `babel-view` class is set in Add.jsx and
 * nowhere else — and leaves them editable on every translation afterwards,
 * which is as many homes as there are languages.
 *
 * A page in another language that is nobody's translation inherits nothing: it
 * owns its own value.
 *
 * @param {Object} schema - the content type's schema
 * @param {Object} content - the page (language, @components.translations)
 * @param {string} defaultLanguage - the site's default language
 * @returns {string[]} field ids, empty when this page owns everything
 */
export function inheritedLanguageFields(schema, content, defaultLanguage) {
  if (!schema?.properties || !content || !defaultLanguage) return [];

  const language =
    typeof content.language === 'object'
      ? content.language?.token
      : content.language;
  if (!language || language === defaultLanguage) return [];

  // No translations expander means a single-language site, and an empty one
  // means a page that stands alone — neither inherits from anything.
  const translations = content['@components']?.translations?.items;
  if (!translations?.length) return [];

  return Object.entries(schema.properties)
    .filter(([, def]) => def?.multilingual_options?.language_independent)
    .map(([id]) => id);
}

// How loud each status is. A container holding both an error and an
// untranslated copy shows the error: one stops a save, the other is work still
// to do.
//
// Untranslated outranks stale because of what a READER gets: an untranslated
// block shows them the wrong language outright, while a stale one shows their
// own language a revision behind.
const NESTED_STATUS_SEVERITY = {
  error: 4,
  warning: 3,
  untranslated: 2,
  stale: 1,
};

/**
 * What the blocks INSIDE this one need, if anything.
 *
 * A container's blind in the sidebar is collapsed, so whatever is wrong three
 * levels down is invisible until the editor goes looking. Given a status per
 * block id — a refused save, a copy still in the language it came from — this
 * answers "does anything in here need attention?" over every descendant,
 * through the same container API the editor addresses blocks with.
 *
 * Deliberately NOT about the block itself: a blind speaks for what it hides.
 *
 * @param {Object} block - the container to look inside
 * @param {Object} options.statuses - { [blockId]: 'error' | 'warning' | 'untranslated' }
 * @param {Object} [options.idFieldMap] - which fields hold children, per type
 * @returns {{status: string, count: number}|null}
 */
export function nestedStatus(block, { statuses = {}, idFieldMap = null } = {}) {
  let worst = null;
  let count = 0;

  const walk = (node) => {
    for (const field of getChildFields(node, idFieldMap, { allObjectLists: true })) {
      for (const { id, block: child } of getChildBlockEntries(node, field)) {
        const status = statuses[id];
        if (status) {
          count += 1;
          if (
            !worst ||
            (NESTED_STATUS_SEVERITY[status] || 0) >
              (NESTED_STATUS_SEVERITY[worst] || 0)
          ) {
            worst = status;
          }
        }
        walk(child);
      }
    }
  };
  walk(block);

  return worst ? { status: worst, count } : null;
}

/**
 * Which blocks of a translation still read as the page they were copied from.
 *
 * A copy carries `@canonical`, the id of the block it came from. Comparing the
 * two — everything but the identity keys — says whether anyone has touched it
 * since. That is as close to "not translated yet" as the data allows, and it
 * needs no new field: a translator who retypes the same words in the same
 * language is, after all, not wrong to be told nothing has changed.
 *
 * @param {Object} blocks - the translation's blocks (any depth)
 * @param {Object} sourceBlocks - the original's blocks (any depth)
 * @param {Object} [idFieldMap] - which fields hold children, per type
 * @returns {Array<string>} ids, outermost first
 */
export function untranslatedBlockIds(blocks, sourceBlocks, idFieldMap = null) {
  const sourceById = {};
  const indexSource = (map) => {
    for (const [id, block] of Object.entries(map || {})) {
      sourceById[id] = block;
      for (const field of getChildFields(block, idFieldMap, { allObjectLists: true })) {
        const nested = {};
        for (const entry of getChildBlockEntries(block, field)) {
          nested[entry.id] = entry.block;
        }
        indexSource(nested);
      }
    }
  };
  indexSource(sourceBlocks);

  const untranslated = [];
  const visit = (map) => {
    for (const [id, block] of Object.entries(map || {})) {
      const canonical = block?.['@canonical'];
      const source = canonical ? sourceById[canonical] : null;
      if (source && sameBlockContent(block, source, idFieldMap)) {
        untranslated.push(id);
      }
      for (const field of getChildFields(block, idFieldMap, { allObjectLists: true })) {
        const nested = {};
        for (const entry of getChildBlockEntries(block, field)) {
          nested[entry.id] = entry.block;
        }
        visit(nested);
      }
    }
  };
  visit(blocks);

  return untranslated;
}

/**
 * The same blocks, with the fingerprint moved forward for the ones the
 * translator has just brought up to date.
 *
 * A stale marker that cannot be cleared is worse than no marker: translators
 * learn to ignore it, and the ones that matter go unseen with it. So doing the
 * work clears it — saving a block whose WORDS changed records the source it has
 * now caught up with.
 *
 * The words, not the block: restyling one or swapping its image is no evidence
 * anyone read the English that changed, and clearing the marker on that would
 * lose the drift these fingerprints exist to catch. `fingerprintOf` is the same
 * function used on the source — applied here to the translation, it answers
 * "did anyone write in this block".
 *
 * Re-stamping every block with a `@canonical` instead would be cheaper and
 * wrong: saving a page for any reason would silently clear staleness on blocks
 * nobody looked at.
 *
 * @param {Object} blocks - the blocks about to be saved
 * @param {Object} initialBlocks - the same page as it was loaded
 * @param {Object} sourceBlocks - the blocks of the language it is translated from
 * @param {Object} options
 * @param {Function} options.fingerprintOf - (block, id, type) => string|null
 * @param {Object} [options.idFieldMap] - which fields hold children, per type
 * @returns {Object} a copy; the originals are untouched
 */
export function restampTranslatedBlocks(blocks, initialBlocks, sourceBlocks, options = {}) {
  const { fingerprintOf, idFieldMap = null } = options;
  if (!fingerprintOf) return blocks;

  const sourceById = {};
  const indexSource = (map) => {
    for (const [id, block] of Object.entries(map || {})) {
      sourceById[id] = block;
      for (const field of getChildFields(block, idFieldMap, { allObjectLists: true })) {
        const nested = {};
        for (const entry of getChildBlockEntries(block, field)) nested[entry.id] = entry.block;
        indexSource(nested);
      }
    }
  };
  indexSource(sourceBlocks);

  const initialById = {};
  const indexInitial = (map) => {
    for (const [id, block] of Object.entries(map || {})) {
      initialById[id] = block;
      for (const field of getChildFields(block, idFieldMap, { allObjectLists: true })) {
        const nested = {};
        for (const entry of getChildBlockEntries(block, field)) nested[entry.id] = entry.block;
        indexInitial(nested);
      }
    }
  };
  indexInitial(initialBlocks);

  const safely = (block, id, type) => {
    try {
      return fingerprintOf(block, id, type);
    } catch {
      // A type with no schema: we cannot tell which fields are words, so we
      // cannot tell whether anyone wrote any. Leave the block as it is.
      return undefined;
    }
  };

  const restampBlock = (block, id) => {
    let out = block;
    const canonical = block?.['@canonical'];
    const source = canonical ? sourceById[canonical] : null;
    if (source) {
      const before = safely(initialById[id], id, getBlockType(block));
      const after = safely(block, id, getBlockType(block));
      const wordsChanged =
        before !== undefined && after !== undefined && before !== after;
      if (wordsChanged) {
        const caughtUpWith = safely(source, canonical, getBlockType(source));
        if (caughtUpWith) {
          out = { ...block, '@translation': { ...block['@translation'], fingerprint: caughtUpWith } };
        }
      }
    }

    for (const field of getChildFields(out, idFieldMap, { allObjectLists: true })) {
      const children = [];
      for (const entry of getChildBlockEntries(block, field)) {
        children.push({ id: entry.id, block: restampBlock(entry.block, entry.id) });
      }
      if (children.length) {
        if (out === block) out = { ...block };
        if (!field.isObjectList) out.blocks = { ...out.blocks };
        setChildBlockEntries(out, field, children);
      }
    }
    return out;
  };

  const result = {};
  for (const [id, block] of Object.entries(blocks || {})) {
    result[id] = restampBlock(block, id);
  }
  return result;
}

/**
 * What a translator needs to know about a translated page, without reading it
 * end to end or diffing anything.
 *
 *   untranslated — copied and never touched (`sameBlockContent`, as before)
 *   stale        — translated, but the SOURCE has changed since
 *   missing      — the source has a block this page never received
 *
 * `@canonical` gives the pairing; the fingerprint recorded when the translation
 * was written gives the change. Severity belongs to the caller — `nestedStatus`
 * ranks these and rolls them up through containers for the sidebar blinds.
 *
 * A block whose fingerprint was never recorded is reported as `unknown`, not
 * guessed at: claiming "stale" for every un-fingerprinted block would mark a
 * whole page on the day this ships, and a marker that cries wolf gets ignored.
 * A block type with no schema lands there too — the pass keeps going and names
 * it, because one unknown type must not cost the page every other marker.
 *
 * @param {Object} blocks - the TRANSLATION's blocks
 * @param {Object} sourceBlocks - the blocks it was translated from
 * @param {Object} options
 * @param {Object} options.schemas - block type → schema
 * @param {Function} [options.fingerprintOf] - (block, id, type) => string
 * @param {Object} [options.idFieldMap] - which fields hold children, per type
 * @returns {{statuses: Object, missing: string[], unknown: string[]}}
 */
export function translationStatus(blocks, sourceBlocks, options = {}) {
  const { schemas = {}, idFieldMap = null } = options;
  const fingerprintOf =
    options.fingerprintOf ||
    ((block, id, type) => sourceFingerprint(block, schemas[type]));

  const sourceById = {};
  const indexSource = (map) => {
    for (const [id, block] of Object.entries(map || {})) {
      sourceById[id] = block;
      for (const field of getChildFields(block, idFieldMap, { allObjectLists: true })) {
        const nested = {};
        for (const entry of getChildBlockEntries(block, field)) {
          nested[entry.id] = entry.block;
        }
        indexSource(nested);
      }
    }
  };
  indexSource(sourceBlocks);

  const statuses = {};
  const unknown = [];
  const claimed = new Set();

  const visit = (map) => {
    for (const [id, block] of Object.entries(map || {})) {
      const canonical = block?.['@canonical'];
      const source = canonical ? sourceById[canonical] : null;
      if (source) {
        claimed.add(canonical);
        if (sameBlockContent(block, source, idFieldMap)) {
          statuses[id] = 'untranslated';
        } else {
          const recorded = block['@translation']?.fingerprint;
          if (!recorded) {
            // Nothing translatable in it means nothing to record, and nothing
            // to be unknown about.
            let translatable = true;
            try {
              translatable =
                fingerprintOf(source, canonical, getBlockType(source)) !== null;
            } catch {
              translatable = true;
            }
            if (translatable) unknown.push(id);
          } else {
            let current;
            try {
              current = fingerprintOf(source, canonical, getBlockType(source));
            } catch {
              // No schema for this type: cannot tell prose from a token, so
              // cannot tell whether the change matters. Say so and move on.
              unknown.push(id);
              current = undefined;
            }
            if (current !== undefined && current !== null && current !== recorded) {
              statuses[id] = 'stale';
            }
          }
        }
      }
      for (const field of getChildFields(block, idFieldMap, { allObjectLists: true })) {
        const nested = {};
        for (const entry of getChildBlockEntries(block, field)) {
          nested[entry.id] = entry.block;
        }
        visit(nested);
      }
    }
  };
  visit(blocks);

  const missing = Object.keys(sourceById).filter((id) => !claimed.has(id));

  return { statuses, missing, unknown };
}

/**
 * Two blocks, compared on the WORDS in them.
 *
 * Not on the whole object: a block in the editor has been through schema
 * defaults and url resolution, and the original it was copied from has not, so
 * comparing everything reports differences that no translator made. Text is
 * what a translation changes, and what its absence means.
 */
function sameBlockContent(a, b, idFieldMap) {
  return blockText(a, idFieldMap) === blockText(b, idFieldMap);
}

// Strings a block carries that are not words anyone translates: where it
// points, how it looks, which variant it is. Styling in particular is set by
// selecting a block in the sidebar, which would otherwise make simply LOOKING
// at a copy count as translating it.
const NON_TEXT_KEYS = new Set([
  'styles',
  'href',
  'url',
  'src',
  'link',
  'preview_image',
  'image',
  'variation',
  'align',
  'size',
]);

/** The words an editor types into this block — not its children's. */
function blockText(block, idFieldMap) {
  const childFields = new Set(
    getChildFields(block, idFieldMap, { allObjectLists: true }).map((f) => f.region),
  );
  const parts = [];
  for (const [key, value] of Object.entries(block || {})) {
    // Identity and structure, not words.
    if (key.startsWith('@') || key === 'block') continue;
    if (key === 'blocks' || key === 'blocks_layout') continue;
    if (childFields.has(key) || NON_TEXT_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      parts.push(`${key}=${value}`);
    } else if (
      Array.isArray(value) &&
      value.some((node) => node && typeof node === 'object' && 'children' in node)
    ) {
      // A slate value: an array of nodes whose text is what was typed.
      parts.push(`${key}=${slateNodesText(value)}`);
    }
  }
  return parts.sort().join('\u0000');
}

/**
 * Insert snippet blocks at a specific position.
 * - Clones snippet blocks with new IDs
 * - Adds template fields (templateId, templateInstanceId, slotId)
 * - Preserves Volto's fixed/readOnly properties
 * - Inserts at the specified position
 *
 * @param {Object} pageFormData - Existing page data
 * @param {Object} templateData - Snippet template document
 * @param {number} position - Index to insert at
 * @param {Function} uuidGenerator - Function to generate UUIDs (default: generateUUID)
 * @returns {Object} Updated formData with snippet inserted
 */
export function insertSnippetBlocks(
  pageFormData,
  templateData,
  position,
  uuidGenerator = generateUUID,
) {
  const result = {
    blocks: { ...pageFormData.blocks },
    blocks_layout: {
      items: [...(pageFormData.blocks_layout?.items || [])],
    },
  };
  const templateId = templateData['@id'] || templateData.UID;
  const instanceId = uuidGenerator(); // New instance ID for this insertion

  // Clone snippet blocks
  const {
    blocks: clonedBlocks,
    layout: clonedLayout,
    idMap,
  } = cloneBlocksWithNewIds(
    templateData.blocks,
    templateData.blocks_layout?.items || [],
    uuidGenerator,
  );

  // Add template fields
  for (const [newId, block] of Object.entries(clonedBlocks)) {
    const originalId = Object.entries(idMap).find(([_, v]) => v === newId)?.[0];
    const originalBlock = templateData.blocks?.[originalId];

    // Set flat template fields
    block.templateId = templateId;
    block.templateInstanceId = instanceId;
    block.slotId = originalBlock?.slotId || originalId;

    // Preserve Volto's fixed/readOnly from template
    if (originalBlock?.fixed !== undefined) block.fixed = originalBlock.fixed;
    if (originalBlock?.readOnly !== undefined)
      block.readOnly = originalBlock.readOnly;

    // Snippet insert is always a user action — store content as fieldPlaceholders
    // for editable blocks so authored text shows as hints
    if (!block.readOnly) {
      const placeholders = extractFieldPlaceholders(originalBlock || block);
      if (Object.keys(placeholders).length > 0) {
        block.fieldPlaceholders = placeholders;
      }
    }

    result.blocks[newId] = block;
  }

  // Insert at position
  result.blocks_layout.items.splice(position, 0, ...clonedLayout);

  return result;
}

/**
 * Get blocks that belong to a specific template.
 *
 * @param {Object} formData - Page form data
 * @param {string} tplId - Template UID to find
 * @returns {Array} Array of block IDs belonging to this template
 */
export function getTemplateBlocks(formData, tplId) {
  const blockIds = [];
  for (const blockId of allRegionIds(formData.blocks_layout)) {
    const block = formData.blocks?.[blockId];
    if (block?.templateId === tplId) {
      blockIds.push(blockId);
    }
  }
  return blockIds;
}

/**
 * Check if a block is a fixed template block (cannot be moved individually).
 * Uses Volto's standard fixed property.
 *
 * @param {Object} block - Block data
 * @returns {boolean}
 */
export function isFixedTemplateBlock(block) {
  // Fixed if it has templateId AND fixed: true (Volto standard)
  return block?.templateId && block?.fixed === true;
}

/**
 * Check if a block is slot content (can be moved freely).
 * Slot blocks have templateId but fixed: false (or undefined).
 *
 * @param {Object} block - Block data
 * @returns {boolean}
 */
export function isPlaceholderContent(block) {
  // Placeholder if it has templateId but is NOT fixed
  return block?.templateId && !block?.fixed;
}

/**
 * Read the value at an array path (e.g. ['table','rows'] or ['content','headline']).
 * Empty path returns `obj` itself. Missing segment returns undefined.
 */
export function getAtPath(obj, path) {
  return (path || []).reduce((cur, key) => cur?.[key], obj);
}

/**
 * Immutably descend `path` on `obj`, replacing each visited node with a shallow
 * clone (so callers can mutate the returned node / its properties without
 * touching the original references — INITIAL_DATA arrives deep-frozen). Returns
 * the node at `path`. To set a leaf value: `ensureMutablePath(obj,
 * path.slice(0, -1))[path.at(-1)] = value`.
 */
export function ensureMutablePath(obj, path) {
  let cur = obj;
  for (const key of path || []) {
    cur[key] = { ...(cur[key] || {}) };
    cur = cur[key];
  }
  return cur;
}

/**
 * Resolve a field's schema def by an object-descent `path` (e.g.
 * ['content','headline']). Descends ONLY through `widget:'object'` wrappers — a
 * transparent grouping of fields. A REGION (`object_list` / `blocks_layout`) or
 * a plain value is TERMINAL: you cannot path *through* it, because a region's
 * children are separate blocks addressed by their own UID, not by continuing
 * the field path (and a value has no sub-fields). Note object_list/blocks_layout
 * ALSO carry a `.schema`, so the gate is on the widget, not on `.schema`.
 * Returns the fieldDef at `path`, or undefined if a segment is missing or an
 * intermediate segment is not an object wrapper.
 */
export function getFieldDefByPath(schema, path) {
  let props = schema?.properties;
  let def;
  for (let i = 0; i < (path || []).length; i++) {
    if (!props) return undefined;
    def = props[path[i]];
    if (!def) return undefined;
    if (i < path.length - 1) {
      if (def.widget !== 'object' || !def.schema?.properties) return undefined;
      props = def.schema.properties;
    }
  }
  return def;
}

// ── Central field access ──────────────────────────────────────────────────
// The ONE API every inline-edit path (text / link / media) and the sidebar/
// validation should use to read or write a block field by its `/`-path (the
// object-descent grammar; #245). Never index `block[fieldName]` /
// `schema.properties[fieldName]` directly — a nested field like `content/image`
// would read undefined and write a stray flat key. `/`-scope and `..` (which
// BLOCK) are resolved separately (DOM-relative, hydra-side) before these run.

/** Read a block field value by `/`-path. "content/headline" → block.content.headline. */
export function getFieldValue(block, fieldPath) {
  return getAtPath(block, String(fieldPath).split('/'));
}

/**
 * Return a NEW block with the field at `/`-path set (immutable — input untouched;
 * intermediate object wrappers are cloned). Callers that want in-place mutation
 * (hydra's live formData) reassign / Object.assign the result.
 */
export function setFieldValue(block, fieldPath, value) {
  const parts = String(fieldPath).split('/');
  const result = { ...block };
  ensureMutablePath(result, parts.slice(0, -1))[parts[parts.length - 1]] = value;
  return result;
}

/** Resolve a block field's schema def by `/`-path (descends `widget:'object'` only). */
export function getFieldDef(schema, fieldPath) {
  return getFieldDefByPath(schema, String(fieldPath).split('/'));
}

// Same value as hydra.js / buildBlockPathMap — inlined so this module stays
// free of hydra-js deps.
const PAGE_BLOCK_UID = '_page';

/**
 * The BLOCK-SCOPE half of the path grammar: resolve a `data-edit-*` path's
 * leading `/` / `..` against the block hierarchy, returning `{ blockId,
 * fieldName }` where `fieldName` is the remaining WITHIN-block object-descent
 * path (feed it to getFieldDef / getFieldValue / setFieldValue). Pure — the
 * pathMap is passed in, not read off a bridge.
 *
 *   'field'    → { blockId, 'field' }         this block's field
 *   'a/b'      → { blockId, 'a/b' }           descend the block's objects
 *   '/field'   → { _page, 'field' }           page/root field
 *   '../field' → { parent block, 'field' }    up one BLOCK per `../`
 *   '../a/b'   → { parent block, 'a/b' }       then descend objects
 *
 * `..` only ever crosses a BLOCK boundary (never an object/region level); past
 * the top block it lands on the page.
 *
 * @param {string} fieldPath
 * @param {string} blockId - current block (PAGE_BLOCK_UID for page-level)
 * @param {Object} blockPathMap - blockId → { parentId } (for `../`)
 * @returns {{ blockId: string, fieldName: string }}
 */
export function resolveFieldPath(fieldPath, blockId, blockPathMap) {
  if (fieldPath.startsWith('/')) {
    return { blockId: PAGE_BLOCK_UID, fieldName: fieldPath.slice(1) };
  }
  if (!blockId || blockId === PAGE_BLOCK_UID) {
    return { blockId: PAGE_BLOCK_UID, fieldName: fieldPath };
  }
  let currentBlockId = blockId;
  let remainingPath = fieldPath;
  while (remainingPath.startsWith('../')) {
    const pathInfo = blockPathMap?.[currentBlockId];
    if (!pathInfo?.parentId || pathInfo.parentId === PAGE_BLOCK_UID) {
      return { blockId: PAGE_BLOCK_UID, fieldName: remainingPath.slice(3) };
    }
    currentBlockId = pathInfo.parentId;
    remainingPath = remainingPath.slice(3);
  }
  return { blockId: currentBlockId, fieldName: remainingPath };
}

/**
 * The child blocks at a container's region, as ordered {id, block} entries — uniform
 * across BOTH storages. blocks_layout and object_list are just two ways to lay out the
 * same thing (a container's ordered region of child blocks); any caller that needs the
 * actual child blocks (inheriting template membership, re-entering a container, …)
 * should use this and never branch on storage.
 *
 * The caller supplies a descriptor — knowing WHICH fields are containers stays its job
 * (the admin derives it from the schema, the merge data-drivenly), but the read shape
 * is shared here so it isn't duplicated.
 *
 * A descriptor's `regionPath` is the object-key prefix to where the region
 * lives (e.g. ['table'] for a `table` object wrapper, [] for the block root) —
 * the `/`-path grammar's object hops. For object_list the array is at
 * `[...regionPath, region]`; for blocks_layout the shared dict + layout live on
 * the node at `regionPath`. Same prefix, one representation, no `dataPath`.
 *
 * @param {Object} parentBlock - the container block
 * @param {Object} descriptor - { isObjectList, regionPath, region='items', idField='@id' }
 * @returns {Array<{id: string, block: Object}>}
 */
export function getChildBlockEntries(parentBlock, descriptor = {}) {
  const {
    isObjectList,
    regionPath = [],
    region = 'items',
    idField = '@id',
  } = descriptor;
  if (isObjectList) {
    // object_list: an inline array at [...regionPath, region].
    const arr = getAtPath(parentBlock, [...regionPath, region]);
    return [...(arr || [])].map((block) => ({ id: block[idField], block }));
  }
  // blocks_layout: the region lists ids into a shared blocks dict on the node at
  // regionPath (block root when empty, e.g. a `table` object wrapper otherwise).
  const container = getAtPath(parentBlock, regionPath);
  const ids = container?.blocks_layout?.[region] || [];
  return ids
    .map((id) => ({ id, block: container?.blocks?.[id] }))
    .filter((entry) => entry.block);
}

/**
 * Every child region/field of a container, as descriptors for getChildBlockEntries /
 * setChildBlockEntries — data-driven, no schema. A container's children live either in
 * blocks_layout regions (ids into the shared blocks dict) or in object_list array fields
 * (inline arrays of blocks carrying a templateId). Returns one descriptor per region/
 * field so callers iterate uniformly and never branch on storage.
 *
 * @param {Object} block - the container block
 * @returns {Array<{ region?: string, isObjectList?: boolean, regionPath?: string[] }>}
 */
export function getChildFields(block, idFieldMap = null, options = {}) {
  const fields = [];
  if (block?.blocks && isBlocksMap(block.blocks)) {
    for (const [region] of blocksLayoutRegions(block.blocks_layout)) {
      fields.push({ region });
    }
  }
  // An object_list field is keyed by its idField (a form's subblocks by `field_id`, a table's
  // rows by `key`, …) — NOT `@id`. The idField is a per-(blockType, field) fact the CALLER
  // resolves once and passes as `idFieldMap` ({ type: { field: idField } }): the admin derives
  // it from the schema, a frontend passes it as a literal hint. Read + write both key off the
  // descriptor's idField, so a missing hint (fallback `@id`) mints a bogus id — hence the hint
  // is required whenever a template contains an object_list keyed by anything but `@id`.
  const typeIds = block?.['@type'] ? idFieldMap?.[block['@type']] : null;
  for (const [key, val] of Object.entries(block || {})) {
    if (!Array.isArray(val) || val.length === 0) continue;
    // `templateId` marks a template's own children, which is all the insertion
    // path cares about. `allObjectLists` is for callers copying a WHOLE page —
    // a translation — where every child counts, template or not; the fields
    // that hold them are the ones the idFieldMap names for this type.
    const isTemplateList = !!val[0]?.templateId;
    const isDeclaredList = !!(options.allObjectLists && typeIds?.[key]);
    if (isTemplateList || isDeclaredList) {
      fields.push({
        isObjectList: true,
        region: key, // top-level array field; regionPath defaults to []
        idField: typeIds?.[key] || '@id',
      });
    }
  }
  return fields;
}

/**
 * Write ordered {id, block} entries back into a container's region/field — the writer
 * paired with getChildBlockEntries, uniform across BOTH storages (the public mutator the
 * merge and the admin can share). For blocks_layout it ADDS the blocks to the shared
 * dict and sets the region's id list (call once per region — regions accumulate in the
 * one dict). For object_list it writes the array at `[...regionPath, region]`,
 * cloning each level (INITIAL_DATA arrives deep-frozen).
 *
 * @param {Object} parentBlock - the container block to mutate
 * @param {Object} descriptor - { isObjectList, regionPath, region='items', idField='@id' }
 * @param {Array<{id: string, block: Object}>} entries
 */
export function setChildBlockEntries(parentBlock, descriptor, entries) {
  const {
    isObjectList,
    regionPath = [],
    region = 'items',
    idField = '@id',
  } = descriptor;
  if (isObjectList) {
    const parent = ensureMutablePath(parentBlock, regionPath);
    parent[region] = entries.map((e) => ({
      ...e.block,
      [idField]: e.id,
    }));
    return;
  }
  // blocks_layout: the shared blocks dict + blocks_layout may live under a
  // widget:'object' wrapper (regionPath). Clone each level so the object's own
  // dict is written (never the block root) and sibling object fields survive.
  const container = ensureMutablePath(parentBlock, regionPath);
  for (const { id, block } of entries) {
    // Callers that manage the shared blocks dict themselves (e.g. the admin's
    // full-dict setContainerItems, whose blocksObj already reflects adds/deletes)
    // omit `block` — only write into the dict when a block is actually provided.
    if (block !== undefined) {
      if (!container.blocks) container.blocks = {};
      container.blocks[id] = block;
    }
  }
  container.blocks_layout = {
    ...(container.blocks_layout || {}),
    [region]: entries.map((e) => e.id),
  };
}

/**
 * Enforce fixed-XOR-inside-slot. A slot is a template region that is neither fixed nor
 * readOnly — a per-page user-fillable area. A propagating/locked block can't live inside a
 * per-page region, so any descendant of a slot can itself only be a slot: recursively strip
 * `fixed`/`readOnly` from every block inside a slot. Call on save so malformed data from
 * paste/programmatic paths (which bypass the sidebar dropdown) is normalized. Returns a new
 * tree only when something changed; a no-op outside template instances.
 *
 * @param {Object} node - a block (or page) with a nested `blocks` map
 * @param {boolean} [insideSlot=false] - whether `node` is already inside a slot
 * @returns {Object} the node, with fixed/readOnly stripped from slot descendants
 */
export function stripFixedInsideSlots(node, insideSlot = false) {
  if (!node?.blocks || typeof node.blocks !== 'object') return node;
  let changed = false;
  const newBlocks = {};
  for (const [id, block] of Object.entries(node.blocks)) {
    let b = block;
    if (insideSlot && (b?.fixed || b?.readOnly)) {
      b = { ...b, fixed: false, readOnly: false };
      changed = true;
    }
    // A block is a slot when it belongs to a template instance and is neither fixed nor
    // readOnly. Its descendants are "inside a slot".
    const isSlot = !!b?.templateInstanceId && !b?.fixed && !b?.readOnly;
    const recursed = stripFixedInsideSlots(b, insideSlot || isSlot);
    if (recursed !== b) {
      b = recursed;
      changed = true;
    }
    newBlocks[id] = b;
  }
  return changed ? { ...node, blocks: newBlocks } : node;
}

/**
 * Template edit mode (v2) is a SET of currently-unlocked template instance ids:
 * multiple templates can be unlocked and edited on one page at once, and
 * unlocking a template does NOT lock the rest of the page. The state is threaded
 * as a string[] (postMessage-friendly); this normalizes null/undefined to [].
 *
 * @param {string[]|null} templateEditMode
 * @returns {string[]}
 */
export function unlockedTemplateIds(templateEditMode) {
  return Array.isArray(templateEditMode) ? templateEditMode : [];
}

/**
 * Check if a block belongs to a template instance that is currently unlocked
 * for editing.
 *
 * @param {Object} blockData - The block data object
 * @param {string[]|null} templateEditMode - The unlocked template instance ids
 * @returns {boolean} True if the block is inside an unlocked template, false otherwise
 */
export function isBlockInEditedTemplate(blockData, templateEditMode) {
  const iid = blockData?.templateInstanceId;
  if (!iid) return false;
  return unlockedTemplateIds(templateEditMode).includes(iid);
}

/**
 * Check if a block should be readonly. Shared by the admin (sidebar/toolbar) and
 * the hydra.js Bridge.
 *
 * v2: a block is readonly by its OWN `readOnly` flag — UNLESS it belongs to a
 * template instance that is currently unlocked (then it's editable). Unlocking a
 * template no longer makes the rest of the page readonly, so page blocks (no
 * `readOnly`) are always editable regardless of which templates are unlocked.
 *
 * @param {Object} blockData - The block data object
 * @param {string[]|null} templateEditMode - The unlocked template instance ids
 * @returns {boolean} True if the block should be readonly
 */
export function isBlockReadonly(blockData, templateEditMode) {
  // A block in an unlocked template is editable, even if flagged readOnly.
  if (isBlockInEditedTemplate(blockData, templateEditMode)) return false;
  // Otherwise the block's own readOnly property (Volto standard).
  return !!blockData?.readOnly;
}

/**
 * A block's type, storage-agnostic. blocks_layout blocks carry it in `@type`; a typed
 * object_list item carries it in a `typeField` (e.g. `field_type`) and has NO `@type`
 * (initializeContainerBlock deletes it). This pair is the ONE place that knows both, so
 * callers never hardcode `@type` for a block that could be either — the recurring
 * object_list-vs-blocks_layout asymmetry (dcd3114 = read, the mutate path = write).
 *
 * @param {Object} blockData
 * @param {string|null} [typeField] - the object_list item's type field, from pathInfo.typeField
 * @returns {string|undefined}
 */
export function getBlockType(blockData, typeField = null) {
  return (
    blockData?.['@type'] ?? (typeField ? blockData?.[typeField] : undefined)
  );
}

/**
 * Write a block's type to the right place: `@type` for blocks_layout, or the `typeField`
 * (dropping `@type`) for a typed object_list item. Returns a new object.
 */
export function setBlockType(blockData, type, typeField = null) {
  if (typeField && typeField !== '@type') {
    const next = { ...blockData, [typeField]: type };
    delete next['@type'];
    return next;
  }
  return { ...blockData, '@type': type };
}

/**
 * Drop a block's type entirely. A single-schema object_list item's type is virtual (derived
 * from the parent field schema, e.g. 'slateTable:rows:cells') and never stored, so the
 * temporary @type used for schema resolution must be removed. Returns a new object.
 */
export function clearBlockType(blockData) {
  const { '@type': _drop, ...rest } = blockData;
  return rest;
}

/**
 * Check if a block's position is locked (cannot be moved/dragged).
 * This is the shared utility for both admin (toolbar) and hydra.js Bridge.
 *
 * v2: a block's position is locked by its OWN `fixed` flag — UNLESS it belongs to
 * a template instance that is currently unlocked (then it's freely movable, even
 * if fixed). Page blocks (no `fixed`) always move, regardless of which templates
 * are unlocked. Drop-zone restrictions (where a block may LAND) are handled
 * separately in the drag handler via getBlockAddability.
 *
 * @param {Object} blockData - The block data object
 * @param {string[]|null} templateEditMode - The unlocked template instance ids
 * @returns {boolean} True if the block's position is locked
 */
export function isBlockPositionLocked(blockData, templateEditMode) {
  // A block in an unlocked template can be moved, even if flagged fixed.
  if (isBlockInEditedTemplate(blockData, templateEditMode)) return false;
  // Otherwise the block's own fixed property (Volto standard).
  return !!blockData?.fixed;
}

/**
 * Get block addability - centralized logic for whether blocks can be added
 * before/after/into a block. Used by DnD, add buttons, and BlockChooser.
 *
 * @param {string} blockId - The block ID to check addability for (target block)
 * @param {Object} blockPathMap - Map of blockId -> pathInfo
 * @param {Object} blockData - The target block data object (can be null for pathMap-only checks)
 * @param {string|null} templateEditMode - The templateInstanceId being edited, or null
 * @param {Object|null} sourceBlockData - For DnD: the source block being moved. Enables template-aware logic.
 * @returns {Object} Addability info:
 *   - canInsertBefore: Can add a sibling before this block
 *   - canInsertAfter: Can add a sibling after this block
 *   - canReplace: Can replace this block (for empty blocks)
 *   - allowedTypes: Array of allowed block types, or null for all types
 *   - maxReached: Whether container is at maxLength
 */
export function getBlockAddability(
  blockId,
  blockPathMap,
  blockData,
  templateEditMode,
  sourceBlockData = null,
) {
  const pathInfo = blockPathMap?.[blockId];

  // Default: can't add anywhere
  const result = {
    canInsertBefore: false,
    canInsertAfter: false,
    canReplace: false,
    allowedTypes: null,
    maxReached: false,
  };

  if (!pathInfo) {
    return result;
  }

  // v2: templateEditMode is a set of unlocked instance ids; "any template unlocked"
  // is a non-empty set.
  const anyTemplateUnlocked = unlockedTemplateIds(templateEditMode).length > 0;

  // Detect 'empty' storage-agnostically (blocks_layout @type OR object_list typeField),
  // otherwise the form's typed field (e.g. the E-mail field) is missed and never gets a '+'.
  const isEmptyBlock = getBlockType(blockData, pathInfo.typeField) === 'empty';

  // A seeded 'empty' placeholder is ALWAYS replaceable in template edit mode — you're
  // building the template, so its type must be pickable (canReplace → the '+' appears). A
  // field seeded inside a template-edit context may not carry the edited template's
  // instanceId yet, so isBlockInEditedTemplate is false and the template-mode gate below
  // would return early with canReplace=false, stranding it. Short-circuit that here (before
  // the maxReached + template-mode gates: replacing an empty mutates in place, it never adds
  // a sibling).
  if (anyTemplateUnlocked && isEmptyBlock) {
    return { ...result, canReplace: true };
  }

  // Get static insert restrictions from pathMap (based on fixed blocks)
  const staticCanInsertBefore = pathInfo.canInsertBefore !== false;
  const staticCanInsertAfter = pathInfo.canInsertAfter !== false;

  // Check if container is at maxLength
  const maxReached =
    pathInfo.maxSiblings != null &&
    pathInfo.siblingCount >= pathInfo.maxSiblings;
  result.maxReached = maxReached;

  // If max is reached, can't add more blocks
  if (maxReached) {
    return result;
  }

  // Template edit mode handling:
  // - For add button (no sourceBlockData): Only allow if target is in the edited template
  // - For DnD (sourceBlockData provided): Allow if source OR target is in the template
  //   This enables dragging blocks from outside INTO the template
  let targetInTemplate = false;
  if (anyTemplateUnlocked) {
    targetInTemplate = isBlockInEditedTemplate(blockData, templateEditMode);
    const sourceInTemplate = sourceBlockData
      ? isBlockInEditedTemplate(sourceBlockData, templateEditMode)
      : false;

    // For DnD: allow if either source or target is in the template
    // For add button: only allow if target is in the template
    const allowedByTemplateMode = sourceBlockData
      ? sourceInTemplate || targetInTemplate
      : targetInTemplate;

    if (!allowedByTemplateMode) {
      // Neither block is in the template being edited - can't add here
      return result;
    }
  }

  // Apply static restrictions
  // In template edit mode, ignore restrictions for blocks in the template being edited
  // (the restrictions are for normal mode to prevent adding outside slots)
  if (anyTemplateUnlocked && targetInTemplate) {
    result.canInsertBefore = true;
    result.canInsertAfter = true;
  } else {
    result.canInsertBefore = staticCanInsertBefore;
    result.canInsertAfter = staticCanInsertAfter;
  }

  // For empty blocks (isEmptyBlock computed above, storage-agnostic): can replace (unless
  // readonly), but NOT add before/after — empty blocks are replaced via the block chooser.
  if (isEmptyBlock) {
    // In template edit mode, check if block is in the edited template for replace permission
    const blockIsReadonly = isBlockReadonly(blockData, templateEditMode);
    result.canReplace = !blockIsReadonly;
    result.canInsertBefore = false;
    result.canInsertAfter = false;
  }

  // Include allowed types from pathInfo
  result.allowedTypes = pathInfo.allowedSiblingTypes || null;

  return result;
}

/**
 * Can a container accept every block type in `blockTypes` given its current
 * count? Considers the combined count against maxLength. Pulled into
 * helpers (rather than left in containerOps.js) so SSR template-merge code
 * can call it without dragging the iframe-only container ops along.
 *
 * @param {object} config         Container field config
 * @param {string[]} blockTypes   Block types to add (in order)
 * @param {number} currentCount   Current number of children
 * @returns {boolean}
 */
export function canContainAll(config, blockTypes, currentCount) {
  if (blockTypes.length === 0) return true;
  if (config?.readOnly || config?.fixed) return false;
  const { allowedBlocks, maxLength } = config || {};
  if (allowedBlocks != null) {
    for (const type of blockTypes) {
      if (!allowedBlocks.includes(type)) return false;
    }
  }
  if (maxLength != null && currentCount + blockTypes.length > maxLength) {
    return false;
  }
  return true;
}

/**
 * Extract the pathname from a template ID, which may be a full URL or a path.
 * Plone's API resolves resolveuid/UID references to full URLs (e.g.
 * "http://plone.example.com/templates/foo"), but allowedLayouts may use
 * relative paths (e.g. "/templates/foo").  This helper normalises both
 * forms to a plain pathname so comparisons work regardless of format.
 *
 * @param {string|null} id - Template ID (URL or path)
 * @returns {string|null} The pathname portion, or the original value
 */
export function templateIdToPath(id) {
  if (!id || typeof id !== 'string') return id;
  // Fast path: already a relative path
  if (!id.startsWith('http://') && !id.startsWith('https://')) return id;
  try {
    return new URL(id).pathname;
  } catch {
    return id;
  }
}

/**
 * Check whether two template IDs refer to the same template, ignoring
 * URL-vs-path differences.  E.g. "http://localhost:8888/tpl/foo" matches
 * "/tpl/foo".
 */
function templateIdsMatch(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return templateIdToPath(a) === templateIdToPath(b);
}

/**
 * Get unique template IDs (paths) from page data.
 *
 * @param {Object} formData - Page data with blocks
 * @returns {Array<string>} Array of unique template paths
 */
export function getUniqueTemplateIds(formData) {
  const templateIds = new Set();
  for (const blockId of Object.keys(formData.blocks || {})) {
    const block = formData.blocks[blockId];
    if (block?.templateId) {
      templateIds.add(block.templateId);
    }
  }
  return Array.from(templateIds);
}
// Note: callers that need to avoid recursing into the template's own
// definition page (e.g. saveTemplatesRef) filter by `id !== currentPath`
// — that's the load-bearing check. Earlier this function ALSO skipped
// blocks where `templateInstanceId === templateId` as a heuristic for
// "definition-side", but the load/expand path
// (loadTemplates / expandTemplatesSync) never reads stored instanceIds
// from a definition (it generates fresh per-application ids), so the
// only consumer of the heuristic was this very function. Removing it
// also unblocks make-template, where the page-side block can have
// instanceId === templateId for unrelated reasons and was being silently
// excluded from save → the new template never POSTed to the backend.

/**
 * Check if an object looks like a blocks map (string keys -> objects with @type).
 */
function isBlocksMap(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.values(obj).some((v) => v?.['@type']);
}

/**
 * Whether `tplBlock` is a container whose children need merging. Post-#234 a
 * container's child ordering always lives in its own `blocks_layout` dict, as
 * one or more named regions ({ <region>: [stringId, ...], ... } — e.g. a columns
 * block's `columns` region, a column's default `items` region). Returns true for
 * a container (has a `blocks` map + a `blocks_layout` dict), false otherwise.
 * Callers iterate every region in `tplBlock.blocks_layout`.
 */
function hasNestedBlocksLayout(tplBlock) {
  return !!(
    tplBlock &&
    tplBlock.blocks &&
    isBlocksMap(tplBlock.blocks) &&
    tplBlock.blocks_layout &&
    typeof tplBlock.blocks_layout === 'object' &&
    !Array.isArray(tplBlock.blocks_layout)
  );
}

/**
 * The named regions of a `blocks_layout` dict, as `[region, ids[]]` entries
 * (post-#234: every blocks field is an id-list under one shared dict — `items`,
 * `columns`, `footer`, …). Non-array sub-keys are skipped. The single place that
 * knows the regions shape, so no caller re-implements `.items`-style walking.
 */
function blocksLayoutRegions(blocksLayout) {
  if (
    !blocksLayout ||
    typeof blocksLayout !== 'object' ||
    Array.isArray(blocksLayout)
  ) {
    return [];
  }
  return Object.entries(blocksLayout).filter(([, ids]) => Array.isArray(ids));
}

/**
 * Every child id across all regions of a `blocks_layout` dict, in region order.
 */
function allRegionIds(blocksLayout) {
  return blocksLayoutRegions(blocksLayout).flatMap(([, ids]) => ids);
}

/**
 * The AUTHOR's blocks nested inside a block that is about to be dropped.
 *
 * Switching layouts drops the outgoing layout's furniture, and a layout whose
 * frame is ONE container block (a `contentLayout` holding `main` + a sidebar,
 * say) carries the author's content inside that frame. Dropping the frame on
 * its `readOnly` flag therefore dropped the whole page with it — silently, on a
 * menu choice.
 *
 * So look inside before letting it go. `fixed` marks the template's own
 * furniture, which the incoming layout replaces; everything else is the
 * author's and is pushed back into `pendingContent` under its own slot, exactly
 * as the flat scan does for content that sits at the top level. Template
 * markers are left ON the harvested blocks — the flat scan leaves them there
 * too, and the apply re-stamps what it re-homes.
 *
 * @param {Object} block - The block being dropped
 * @param {Map} pendingContent - Map of slotId -> [{blockId, block}]
 * @param {Set} visited - Already visited blocks (prevent cycles)
 */
export function collectNestedAuthorContent(block, pendingContent, visited = new Set()) {
  if (!block || typeof block !== 'object') return;
  if (visited.has(block)) return;
  visited.add(block);
  const nested = block.blocks;
  const layouts = block.blocks_layout;
  if (!nested || !layouts) return;
  for (const ids of Object.values(layouts)) {
    if (!Array.isArray(ids)) continue;
    for (const blockId of ids) {
      const child = nested[blockId];
      if (!child) continue;
      if (child.fixed) {
        // Furniture. It goes, but it may be a container holding content.
        collectNestedAuthorContent(child, pendingContent, visited);
        continue;
      }
      const slotId = child.slotId || 'default';
      if (!pendingContent.has(slotId)) pendingContent.set(slotId, []);
      pendingContent.get(slotId).push({ blockId, block: child });
      collectNestedAuthorContent(child, pendingContent, visited);
    }
  }
}

/**
 * Recursively scan for blocks with matching templateInstanceId.
 * Handles arbitrary nesting - looks for blocks maps (values have @type)
 * and corresponding layout arrays.
 *
 * @param {Object} container - Container object to scan
 * @param {string} instanceId - Template instance ID to match
 * @param {Map} pendingContent - Map of slotId -> [{blockId, block}]
 * @param {Array} standaloneBlocks - Blocks without slotId
 * @param {Set} visited - Already visited objects (prevent cycles)
 */
export function collectContentFromTree(
  container,
  instanceId,
  pendingContent,
  standaloneBlocks,
  existingFixedBlockIds,
  visited = new Set(),
) {
  if (!container || typeof container !== 'object') return;
  if (visited.has(container)) return;
  visited.add(container);

  // Capture ONE child block by slot/instance, then recurse into it. Shared by the blocks_layout
  // (shared `blocks` dict) and object_list (inline array) branches so both storages capture the
  // same way — the apply path already treats them uniformly (fillContainerInto).
  const processBlock = (blockId, block) => {
    if (!block) return;
    if (block.templateInstanceId === instanceId) {
      const slotId = block.slotId;
      if (slotId) {
        if (block.fixed) {
          // Track existing fixed block ID and content for reuse
          existingFixedBlockIds.set(slotId, { blockId, block });
        } else {
          // User content block
          if (!pendingContent.has(slotId)) pendingContent.set(slotId, []);
          pendingContent.get(slotId).push({ blockId, block });
        }
      }
    } else if (!block.templateId && !block.slotId) {
      // Standalone block (no template markers) - track position
      standaloneBlocks.push({ blockId, block });
    }
    // Recurse into block for nested containers
    collectContentFromTree(
      block,
      instanceId,
      pendingContent,
      standaloneBlocks,
      existingFixedBlockIds,
      visited,
    );
  };

  if (Array.isArray(container)) {
    for (const item of container) {
      collectContentFromTree(
        item,
        instanceId,
        pendingContent,
        standaloneBlocks,
        existingFixedBlockIds,
        visited,
      );
    }
    return;
  }

  // Enumerate every child region (blocks_layout regions AND object_list arrays) through the SAME
  // shared funnel the apply path uses (getChildFields + getChildBlockEntries) — one region-aware
  // read, not a bespoke isBlocksMap scan with an all-keys fallback and a divergent object_list
  // heuristic. processBlock captures each child (by slot/instance) and recurses into it.
  for (const field of getChildFields(container)) {
    for (const { id, block } of getChildBlockEntries(container, field)) {
      processBlock(id, block);
    }
  }
}

/**
 * Fill ONE region's ordered template blocks — the SAME logic for a blocks_layout
 * region and an object_list array (they are one concept: an ordered list of blocks,
 * differing only in storage). Drops orphans (no templateId — never invents one), keeps
 * fixed blocks (preserving the template id, or the page's id+value when the page
 * overrode an editable one), replaces slot placeholders with the page's content from
 * the shared ctx (consumed so it isn't reused), and recurses into nested containers.
 * Returns filled [{ id, block }] in order.
 */
/**
 * THE single policy for a template child's block id. Deterministic by default
 * (`${instanceId}::${tplChildId}` — stable across a server render and the
 * client hydration, and instance-scoped so two instances of one template
 * never collide); a caller-provided generator wins only where the caller
 * genuinely needs one-off ids (e.g. snippet insertion into a page).
 */
function mintChildBlockId(instanceId, tplChildId, uuidGenerator) {
  return uuidGenerator ? uuidGenerator() : `${instanceId}::${tplChildId}`;
}

/**
 * The fields an EDITABLE block carries back from the page.
 *
 * A fixed block that is not readOnly belongs to the page: the author can change
 * ANY field on it, and it is saved into the page as they left it. The merge
 * therefore keeps the page's fields wholesale — it does not pick out the ones it
 * imagines are content. Taking only `value` (which is what it used to do) meant
 * `plaintext` reverted to the template's, so a page rendered the author's words
 * out of `value` while the text Plone indexes into SearchableText said something
 * else; and every other edited field — a colour, an alignment, a link — was
 * silently reverted with it.
 *
 * What the TEMPLATE keeps is identity, ownership and structure:
 *   - templateId / slotId / templateInstanceId: how the next merge finds this
 *     block again. A page cannot rename its own slot.
 *   - fixed / readOnly: the template's declaration of who owns the block. A lock
 *     added to the template later has to take hold on pages already using it.
 *   - blocks / blocks_layout: a container's children are re-derived per region
 *     by fillContainerInto, region by region.
 *   - nextSlotId / fieldPlaceholders: hints recomputed on every apply.
 */
const TEMPLATE_OWNED_FIELDS = new Set([
  'templateId',
  'slotId',
  'templateInstanceId',
  'fixed',
  'readOnly',
  'blocks',
  'blocks_layout',
  'nextSlotId',
  'fieldPlaceholders',
]);

function editedFieldsOf(block) {
  const out = {};
  for (const [field, value] of Object.entries(block || {})) {
    if (!TEMPLATE_OWNED_FIELDS.has(field)) out[field] = value;
  }
  return out;
}

function fillRegionEntries(entries, templateState, options) {
  const { instanceId, templateId } = templateState;
  const ctx = templateState.instances?.[instanceId];
  const { uuidGenerator, firstInsert } = options;
  const out = [];
  for (let idx = 0; idx < entries.length; idx++) {
    const { id: tplChildId, block: child } = entries[idx];
    if (!child || !child.templateId) continue; // orphan / missing → drop

    if (child.fixed) {
      const editable = !child.readOnly && !!child.slotId;
      const existingFixed = editable
        ? ctx?.existingFixedBlockIds?.get(child.slotId)
        : undefined;
      // Instance-scope the id so two instances of the same template don't reuse the
      // template's child id and collide in the blockPathMap (snippet insertion already
      // re-ids nested blocks; the forced-layout apply must too). Kept DETERMINISTIC
      // (`${instanceId}::${tplChildId}`, not uuidGenerator) so the id is stable across
      // re-renders and preserves the template child id as a suffix. Editable fixed blocks
      // reuse the page's own (already-unique) id when the page overrode them.
      const outId = existingFixed?.blockId || `${instanceId}::${tplChildId}`;
      // Look ahead for the next non-fixed slot in this region (add-path hint).
      let nextSlotId = undefined;
      for (let i = idx + 1; i < entries.length; i++) {
        const nb = entries[i].block;
        if (nb && !nb.fixed && nb.slotId) {
          nextSlotId = nb.slotId;
          break;
        }
        if (nb?.fixed) break;
      }
      const stamped = {
        ...child,
        templateInstanceId: instanceId,
        ...(existingFixed?.block ? editedFieldsOf(existingFixed.block) : {}),
        ...(nextSlotId && { nextSlotId }),
      };
      if (firstInsert && editable) {
        const placeholders = extractFieldPlaceholders(child);
        if (Object.keys(placeholders).length > 0)
          stamped.fieldPlaceholders = placeholders;
      }
      fillContainerInto(stamped, child, templateState, options);
      out.push({ id: outId, block: stamped });
    } else if (child.slotId) {
      const slotId = child.slotId;
      const userContent = ctx?.pendingContent?.get(slotId);
      if (userContent && userContent.length > 0) {
        ctx.pendingContent.delete(slotId);
        for (const { blockId, block } of userContent) {
          out.push({
            id: blockId,
            block: {
              ...block,
              templateId,
              templateInstanceId: instanceId,
              slotId,
            },
          });
        }
      } else {
        // No page content matches this slot. Emit the slot itself instead of dropping it —
        // a slot whose slotId matches no page content is a slot DEFINITION (e.g. one the
        // author just added to the template), not a filled slot, so it must survive and be
        // captured by the reverse merge. Emit the DEFINITION only — strip any nested content
        // (a slot's contents are per-page user content, never template content; a fixed
        // block placed inside a slot is malformed and must not ride along). Field
        // placeholders only matter on first insert.
        const nid = mintChildBlockId(instanceId, tplChildId, uuidGenerator);
        const {
          blocks: _slotBlocks,
          blocks_layout: _slotLayout,
          ...childDef
        } = child;
        const nb = { ...childDef, templateInstanceId: instanceId };
        if (firstInsert) {
          const placeholders = extractFieldPlaceholders(child);
          if (Object.keys(placeholders).length > 0)
            nb.fieldPlaceholders = placeholders;
        }
        out.push({ id: nid, block: nb });
      }
    }
  }
  return out;
}

/**
 * Fully expand a container's child regions IN PLACE onto `stamped` at APPLY time.
 * Storage-agnostic: enumerate every child field (getChildFields), read each (
 * getChildBlockEntries), fill it (fillRegionEntries), and write it back
 * (setChildBlockEntries) — ONE loop, no branch on blocks_layout vs object_list. After
 * this the children are COMPLETE, so the renderer's re-entry only recognizes the minted
 * templateInstanceId and passes them through — no deferred re-derivation and no
 * object-identity Map (which missed whenever the caller handed back a Vue reactive
 * proxy / clone / postMessage copy of the dict → infinite re-application).
 */
function fillContainerInto(stamped, tplBlock, templateState, options) {
  const fields = getChildFields(tplBlock, options?.idFieldMap);
  if (fields.length === 0) return;
  // blocks_layout regions share stamped.blocks — reset it once so stale template blocks
  // don't linger (object_list fields are independent arrays, written in place).
  if (fields.some((f) => !f.isObjectList)) {
    stamped.blocks = {};
    stamped.blocks_layout = {};
  }
  for (const field of fields) {
    const filled = fillRegionEntries(
      getChildBlockEntries(tplBlock, field),
      templateState,
      options,
    );
    setChildBlockEntries(stamped, field, filled);
  }
}

/**
 * Load all templates referenced in data, including nested templates.
 * Recursively scans data for templateId references, loads them,
 * then scans loaded templates for more references until all are loaded.
 *
 * Templates the page response already carries are used, not requested again. A backend
 * with the @templates addon returns them inside the page response when it is fetched with
 * `?expand=templates` (plus `&expand.templates.extra=<ids>` for forced layouts the page
 * does not reference): `data['@components'].templates` then holds `templates` (id ->
 * template) and, for any that failed, `errors`. Those are taken as loaded / failed, and
 * `loadTemplate` is only called for what is still missing. Without the addon — no
 * component, or just its unexpanded `@id` stub — every template is fetched as before.
 *
 * @param {Object} data - Page data to scan for template references (the whole response, @components included)
 * @param {Function} loadTemplate - Async function: (templateId) => Promise<templateData>
 * @param {Object} preloadedTemplates - Already-loaded templates: { templateId: templateData }. Caller owns the cache.
 * @param {Array} extraTemplateIds - Additional template IDs to fetch (e.g. forced layouts not referenced in page data)
 * @returns {Promise<Object>} Map of templateId -> template data (includes preloaded + newly fetched)
 */
export async function loadTemplates(
  data,
  loadTemplate,
  preloadedTemplates = {},
  extraTemplateIds = [],
) {
  // Start with caller-provided templates (caller owns the cache)
  const templates = { ...preloadedTemplates };
  const loaded = new Set(Object.keys(preloadedTemplates));
  const failed = new Map();

  // Templates the response already carries (the @templates component). Taken in over the
  // caller's cache — they arrived with this very response, so they are the freshest copy —
  // and written back to it, like any template this function fetches.
  const component = data?.['@components']?.templates;
  if (component?.templates) {
    for (const [id, template] of Object.entries(component.templates)) {
      templates[id] = template;
      preloadedTemplates[id] = template;
      loaded.add(id);
    }
  }
  // Ones the backend already failed to resolve (missing, or not viewable by this user):
  // asking again would fail the same way, one request later. Recorded as an Error, the
  // same shape as a failed fetch, so callers see one kind of error.
  for (const { templateId, error } of component?.errors || []) {
    if (templateId && !loaded.has(templateId)) {
      failed.set(templateId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Helper to scan an object for templateId references
  function collectTemplateIds(obj, visited = new Set()) {
    const ids = new Set();

    function scan(o) {
      if (!o || typeof o !== 'object') return;
      if (visited.has(o)) return;
      visited.add(o);

      if (Array.isArray(o)) {
        for (const item of o) scan(item);
        return;
      }

      if (o.templateId && typeof o.templateId === 'string') {
        ids.add(o.templateId);
      }

      for (const value of Object.values(o)) {
        scan(value);
      }
    }

    scan(obj);
    return ids;
  }

  // Collect template IDs referenced in the page data, plus any extra forced layouts.
  let pending = collectTemplateIds(data);
  for (const id of extraTemplateIds) {
    if (id) pending.add(id);
  }

  // Keep loading until no new templates found
  while (pending.size > 0) {
    // Filter out already loaded/failed
    const toLoad = Array.from(pending).filter(
      (id) => !loaded.has(id) && !failed.has(id),
    );
    pending.clear();

    if (toLoad.length === 0) break;

    // Load in parallel with a per-template timeout so a hanging request
    // doesn't block INITIAL_DATA indefinitely.
    //
    // The bound is settable, because this race wraps the CALLER's loadTemplate:
    // a frontend that retries a transient failure (ours retries three times,
    // for a backend busy enough to time out a fetch) never gets to finish, the
    // race cancels it at 5s and the page fails with "not found in pre-loaded
    // templates". Environments where the backend is legitimately slow to warm
    // — a mock serving a whole distribution from disk on its first request —
    // raise it; the default is unchanged and a hang is still bounded.
    const TEMPLATE_LOAD_TIMEOUT =
      Number(globalThis.process?.env?.HYDRA_TEMPLATE_LOAD_TIMEOUT) || 5000;
    const results = await Promise.all(
      toLoad.map(async (id) => {
        try {
          const template = await Promise.race([
            loadTemplate(id),
            new Promise((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Template load timed out after ${TEMPLATE_LOAD_TIMEOUT}ms`,
                    ),
                  ),
                TEMPLATE_LOAD_TIMEOUT,
              ),
            ),
          ]);
          return { id, template };
        } catch (error) {
          console.warn(`[HYDRA] Failed to load template ${id}:`, error);
          return { id, template: null, error };
        }
      }),
    );

    // Process results and collect nested template IDs
    for (const { id, template, error } of results) {
      if (template) {
        loaded.add(id);
        templates[id] = template;
        preloadedTemplates[id] = template; // Write back to caller's cache

        // Scan this template for nested template references
        const nestedIds = collectTemplateIds(template);
        for (const nestedId of nestedIds) {
          if (!loaded.has(nestedId) && !failed.has(nestedId)) {
            pending.add(nestedId);
          }
        }
      } else {
        failed.set(id, error);
      }
    }
  }

  const errors = Array.from(failed.entries()).map(([templateId, error]) => ({
    templateId,
    error,
  }));
  return { templates, errors };
}

/**
 * Async version of expandTemplates.
 * Loads templates on-demand using loadTemplates callback, then delegates to expandTemplatesSync.
 *
 * @param {Array} inputItems - Input items (block IDs or block objects)
 * @param {Object} options - Configuration options
 * @param {Object} options.blocks - Blocks dict for ID lookup
 * @param {Object} options.templateState - Mutable state object (pass {} on first call)
 * @param {Function} options.loadTemplate - Async callback: (templateId) => Promise<templateData>
 * @param {Array} options.allowedLayouts - Force layout from this list if no matching layout applied
 * @returns {Promise<Array>} Items with @uid field
 */
export async function expandTemplates(inputItems, options = {}) {
  const { blocks: blocksDict, loadTemplate, preloadedTemplates } = options;

  // Build data object for loadTemplates to scan
  const data = blocksDict
    ? { blocks: blocksDict, blocks_layout: { items: inputItems } }
    : { items: inputItems };

  // Load templates referenced in the page data, seeded with caller's cache
  const { templates } = await loadTemplates(
    data,
    loadTemplate,
    preloadedTemplates,
  );

  // Delegate to sync version with pre-loaded templates.
  // Don't pass loadTemplate — it's async and expandTemplatesSync requires
  // sync loaders. Instead, catch "not found" errors and retry after awaiting.
  const { loadTemplate: _drop, ...syncOptions } = options;
  const loaded = new Set(Object.keys(templates));
  while (true) {
    try {
      return expandTemplatesSync(inputItems, {
        ...syncOptions,
        templates,
      });
    } catch (e) {
      const match = e.message?.match(/^Template "(.+)" not found/);
      if (match && loadTemplate && !loaded.has(match[1])) {
        const missingId = match[1];
        loaded.add(missingId);
        try {
          templates[missingId] = await loadTemplate(missingId);
          continue;
        } catch {
          // loadTemplate failed — fall through to rethrow
        }
      }
      throw e;
    }
  }
}

/**
 * =============================================================================
 * TEMPLATE MERGE — the single merge used for BOTH applying and saving templates.
 * =============================================================================
 *
 * There is ONE merge (this file's expandTemplates / expandTemplatesSync). The
 * admin-side `mergeTemplatesIntoPage` is a thin wrapper that calls THIS merge for
 * BOTH directions — load (apply) and save — and only adds what a pure helper
 * can't: async loading of referenced templates (loadTemplates). Region walking,
 * nested containers, and instance-id stamping all live here and must NOT be
 * re-implemented there (no separate `processBlocksRecursive`).
 *
 * ── WHAT A TEMPLATE MUST CONTAIN ──────────────────────────────────────────────
 *  - `blocks`: one flat dict of blocks, shared by every region.
 *  - `blocks_layout`: a dict of REGIONS (named ordered id lists). `items` is the
 *    default region; others (e.g. `footer`) are declared in the schema. How a
 *    region is stored is a choice; the merge treats all regions uniformly.
 *  - Every template block carries `slotId` (stable identity used to MATCH a
 *    template slot to the corresponding instance block — matching is by slotId,
 *    not block id; ids are regenerated on apply) and may be `fixed`/`readOnly`
 *    (Volto flags; fixed blocks are template-owned).
 *  - `templateId` is NOT on every block. It marks a block as a template-INSTANCE
 *    REFERENCE — the signal `expandTemplatesSync` scans for to decide "apply a
 *    template here." Only the TOP instance block of a template carries it; its
 *    nested CONTENT blocks (a footer column, a grid cell) do NOT — they belong via
 *    nesting + `slotId`. CRITICAL: never stamp `templateId` onto nested content
 *    (it makes the per-call re-entry try to re-apply the whole template → infinite
 *    recursion; see RECOGNIZING NESTED CONTAINERS).
 *  - A template NEEDN'T carry a `templateInstanceId`, but it's fine if it does —
 *    save is merge(template, page), so a saved template ends up with one. The id
 *    is generated on apply (or reused if the page already holds an instance of
 *    this template).
 *  - EVERY block (top AND nested content) carries its RESOLVED instance id,
 *    stamped by the merge: a child keeps the PARENT's id while its `templateId`
 *    matches (nested content has none → keeps the parent's), and a genuinely
 *    foreign nested `templateId` starts a NEW id. So same-template nesting is one
 *    instance; a different nested `templateId` is a nested instance. Consumers use
 *    the plain flat check (`block.templateInstanceId === editedInstance`) — no
 *    ancestry walk. (Note: the instance id is stamped; the templateId is NOT — see
 *    above.)
 *  - SLOT CONSTRAINT: slot blocks sharing a `slotId` must be CONTIGUOUS in their
 *    region and that `slotId` must not be reused elsewhere in the same template
 *    unless consecutive — so a slot maps to one unambiguous run of content.
 *  - Nested containers are detected from DATA, never schema:
 *      • blocks_layout container: a block with its own `blocks` + `blocks_layout`.
 *      • object_list container: a block field holding an array whose items carry
 *        `templateId` (idField defaults to `@id`).
 *  - A template MAY embed a DIFFERENT template (a nested block whose `templateId`
 *    differs from the one being applied). It is re-instanced as a SEPARATE
 *    instance — a template-in-a-template. [NOT YET SUPPORTED: the merge currently
 *    flattens it into the parent; see tnt tests.]
 *
 * ── HOW THE MERGE IS PERFORMED — merge(target, source) ────────────────────────
 *  Overlay the SOURCE's slot content onto the TARGET's structure, matching by
 *  `slotId`, recursing into every nested container and region, and:
 *      • KEEP the TARGET's instance id (reuse the target's existing instance of
 *        this template, else generate a fresh one),
 *      • STRIP the SOURCE's instance id (it is never carried into the result).
 *
 *  There is no separate "forward" and "reverse" merge — same op, swapped roles:
 *      APPLY = merge(page,     template)  page is target → page's instance id;
 *                                         template content fills the slots.
 *      SAVE  = merge(template, page)      template is target → its own fresh id;
 *                                         the page's edits fill the slots; the
 *                                         editing page's instance id is dropped.
 *
 *  A nested block whose `templateId` differs from the one being applied is a
 *  foreign template: re-instanced with its own id. Because every block then
 *  carries its true instance id, the plain flat unlock check naturally locks the
 *  inner template when editing the outer (inner id !== edited id) — editing the
 *  outer does not unlock the inner, which may have different edit permissions.
 *
 * ── FILLING SLOTS, INCLUDING DEEP ONES ────────────────────────────────────────
 *  A non-fixed slot is a PLACEHOLDER: it is filled with the source blocks sharing
 *  its `slotId`, and the content MOVES to wherever the slot sits in the target —
 *  even deep inside a fixed container. The source content is collected ONCE, deeply,
 *  by slotId into the instance state (`ctx.pendingContent`, via collectContentFromTree)
 *  when the template is encountered, then the WHOLE template is expanded in that ONE
 *  pass: the top-level call fills the top slots and, for every nested container,
 *  recurses (fillContainerInto → fillRegionEntries) to fill that container's slots
 *  too — ALL levels, up front. A fixed-but-NON-readOnly block takes the source's
 *  edited value + block id from `ctx.existingFixedBlockIds` (the editable-fixed flow);
 *  readOnly keeps the template's content. Each slot's content is consumed as it fills,
 *  so it lands exactly once. The renderer's per-container re-entry then only RECOGNIZES
 *  the already-expanded children (below) and passes them through — no second fill.
 *
 * ── RECOGNIZING ALREADY-EXPANDED CONTENT (pure data, no object identity) ───────
 *  This merge is pure JSON-in / JSON-out. On the first encounter of a fresh
 *  `templateId` reference it mints ONE `templateInstanceId`, records it in
 *  `templateState.instances`, and stamps every emitted block (all levels) with it.
 *  Recognition on re-entry is then trivial and DATA-DERIVED: a level whose first block
 *  carries a `templateInstanceId` present in `templateState.instances` (i.e. minted
 *  THIS pass) is finished CONTENT → emit as-is. A `templateId` that is not a live
 *  instance is an unexpanded reference → apply. blocks_layout and object_list are ONE
 *  concept (an ordered list of blocks, differing only in storage) and share this single
 *  path — no special-casing.
 *
 *  Why data and not object identity: an earlier design kept a Map keyed by the
 *  blocks-dict OBJECT REFERENCE. It missed the instant the caller passed a
 *  different-but-equal object — a Vue REACTIVE PROXY, a clone, or a postMessage copy —
 *  so recognition failed and the template re-applied forever (a Vue `block.vue`
 *  setupStatefulComponent stack overflow / blank iframe). Recognizing from the
 *  instanceId every block already carries makes cloning / proxying / serialization
 *  irrelevant.
 *
 *  The discriminator is "minted THIS pass" (in templateState.instances), NOT merely
 *  "has an instanceId": switch-layout legitimately RE-APPLIES over blocks that still
 *  carry a PRIOR instanceId (not in this pass's set), so those correctly fall to the
 *  main path and are replaced.
 * =============================================================================
 */

/**
 * Synchronous version of expandTemplates.
 * Requires all templates to be pre-loaded in options.templates.
 * Falls back to options.loadTemplate (must be synchronous) if a required template
 * is not in the pre-loaded map. Throws if loadTemplate returns a Promise or if
 * the template still can't be found.
 *
 * This function is called recursively: the top-level BlocksRenderer calls it for
 * the page layout, and the expanded result may contain container blocks (columns,
 * accordions, etc.) whose child BlocksRenderers call it again. The apply pass expands
 * every level up front; each re-entry is recognized by its minted templateInstanceId
 * (present in templateState.instances) and passed through as-is — no re-derivation.
 *
 * templateState is shared across all BlocksRenderer instances on the page (via
 * Vue provide/inject or similar). It must be a fresh {} for each page render to
 * avoid stale state across navigations.
 *
 * @param {Array} inputItems - Input items (block IDs or block objects)
 * @param {Object} options - Configuration options
 * @param {Object} options.templates - Map of templateId -> template data (REQUIRED)
 * @param {Object} options.templateState - Mutable state object (pass {} on first call)
 * @param {Array} options.allowedLayouts - Force layout from this list if no matching layout applied
 * @returns {Array} Items with @uid field
 */
export function expandTemplatesSync(inputItems, options = {}) {
  const {
    blocks: blocksDict,
    templateState,
    templates,
    allowedLayouts,
    uuidGenerator,
    filterInstanceId,
    loadTemplate,
    idField, // For object_list arrays: field name used as item ID (e.g. '@id', 'key')
    firstInsert, // When true, copy slot block defaults as fieldPlaceholders
    idFieldMap, // { blockType: { field: idField } } — caller-resolved, so the merge never walks schemas
    editMode: editModeOverride, // explicit edit-mode signal for SSR frontends that have no window.name
  } = options;

  const items = [];
  const addItem = (block, blockId) => {
    items.push({ ...block, '@uid': blockId });
  };

  // In edit mode, admin handles template merging - pass blocks through as-is.
  // Templates option is only needed for view-mode expansion, so the check
  // for it runs after this early return.
  // A server-rendered frontend (Astro/Nuxt render API) has no window.name, so _isEditMode() can't
  // see the edit iframe — it signals edit mode explicitly instead. Fall back to the window-based
  // detector when no override is given (the browser edit iframe + view render).
  const editMode =
    editModeOverride !== undefined ? editModeOverride : _isEditMode();
  if (editMode) {
    return (inputItems || [])
      .map((item) => {
        if (typeof item === 'string') {
          const block = blocksDict?.[item];
          return block ? { ...block, '@uid': item } : null;
        }
        // Object_list items: map idField → @uid
        if (idField && item && !item['@uid']) {
          const id = item[idField];
          if (id) return { ...item, '@uid': id };
        }
        return item;
      })
      .filter(Boolean);
  }

  if (!templates) {
    throw new Error(
      'expandTemplatesSync requires options.templates with pre-loaded templates',
    );
  }

  // templateState is REQUIRED, with no default. It carries the cross-call
  // recognition state (instances minted this pass + their ctx). It must be created ONCE per
  // render and passed to EVERY expand call (top-level + every nested re-entry). A
  // default {} would silently hand each call its own state, so a nested re-entry
  // couldn't see what the top-level registered → it would re-apply the template →
  // infinite recursion. Failing loudly forces callers to share one state.
  if (!templateState) {
    throw new Error(
      'expandTemplatesSync requires options.templateState — create ONE per render and pass the same object to every expand call (top-level and every nested re-entry). There is no default on purpose.',
    );
  }

  // Normalize items
  const normalizedItems = (inputItems || [])
    .map((item) => {
      if (typeof item === 'string') {
        const block = blocksDict?.[item];
        if (!block) {
          console.warn(
            `[HYDRA] expandTemplatesSync: block not found for ID: ${item}`,
          );
          return null;
        }
        return { ...block, '@uid': item };
      }
      // Object_list items: map idField → @uid
      if (idField && item && !item['@uid']) {
        const id = item[idField];
        if (id) return { ...item, '@uid': id };
      }
      return item;
    })
    .filter(Boolean);

  const blocks = Object.fromEntries(
    normalizedItems.map((item) => [item['@uid'], item]),
  );
  const layout = normalizedItems.map((item) => item['@uid']);

  // Initialize global state structures if needed
  if (!templateState.instances) {
    templateState.instances = {};
  }

  // Re-entry recognized from DATA (no object identity) — the SAME check for object_list
  // and blocks_layout. Templates can start at ANY level (a snippet carrying its own
  // templateId + instanceId, or a forced layout that mints one), so there is nothing
  // special about the top level and the two storages are treated equally. A level whose
  // first block carries a templateInstanceId minted THIS render pass (present in
  // templateState.instances) is already-expanded content → emit as-is. It survives the
  // caller handing the dict back as a Vue reactive proxy / clone / postMessage copy —
  // what broke the object-reference Map (nuxt block.vue overflow). A templateId that is
  // NOT a live instance (a fresh reference, or a prior-pass instance on reload) falls
  // through and is applied; allowedLayouts = a forced apply / switch, must re-apply.
  // Relies on templateState being ONE object for the whole render (never reset
  // mid-render), so a top-level apply's instances are visible to every re-entry.
  if (!allowedLayouts?.length && layout.length > 0) {
    const firstBlock = blocks[layout[0]];
    if (
      firstBlock?.templateInstanceId &&
      templateState.instances?.[firstBlock.templateInstanceId]
    ) {
      for (const id of layout) {
        if (blocks[id]) addItem(blocks[id], id);
      }
      return items;
    }
  }

  if (layout.length === 0 && !allowedLayouts?.length) {
    return items;
  }

  // Recognise a DIFFERENT templateInstanceId as a different instance. The apply below
  // uses ONE instance per call (the first block's), so a layout spanning several
  // instances — e.g. two of the same template inserted separately, or two DIFFERENT
  // templates (v2: multiple templates editable on one page) — would process only the
  // first and drop the rest. Expand each instance's contiguous run on its own (sharing
  // this templateState) and concatenate in order.
  //
  // This fires EVEN when allowedLayouts is present. A page-level field always carries
  // allowedLayouts (its layout menu, e.g. [null, layoutA, layoutB]) so the earlier code
  // skipped the split on every re-render and collapsed a multi-instance page into one
  // forced layout — dropping every instance but the first. The split is only wrong for a
  // genuine forced single-layout SWITCH (the user picks one layout to re-home the whole
  // page), which passes exactly one allowedLayout; a menu list (length ≠ 1) is a
  // re-render and must re-recognize the existing instances. Reverse merge (filterInstanceId)
  // still re-homes into one instance, so it's excluded. allowedLayouts is dropped in the
  // per-run recursion so each already-applied run re-applies its own template.
  const forcedSingleLayout = allowedLayouts?.length === 1;
  if (!filterInstanceId && !forcedSingleLayout) {
    const seenInstances = new Set();
    for (const id of layout) {
      const b = blocks[id];
      if (b?.templateId && b?.templateInstanceId)
        seenInstances.add(b.templateInstanceId);
    }
    if (seenInstances.size > 1) {
      let run = null;
      const flushRun = () => {
        if (!run) return;
        for (const it of expandTemplatesSync(run.ids, {
          ...options,
          blocks,
          allowedLayouts: undefined,
        }))
          items.push(it);
        run = null;
      };
      for (const id of layout) {
        const key = blocks[id]?.templateInstanceId ?? null;
        if (!run || run.key !== key) {
          flushRun();
          run = { key, ids: [] };
        }
        run.ids.push(id);
      }
      flushRun();
      return items;
    }
  }

  // Determine templateId and instanceId for this call
  let templateId = null;
  let existingInstanceId = filterInstanceId || null;
  for (const blockId of layout) {
    const block = blocks[blockId];
    if (block?.templateId) {
      templateId = block.templateId;
      if (!filterInstanceId) {
        existingInstanceId = block.templateInstanceId;
      }
      break;
    }
  }

  // Track previous templateId before allowedLayouts may override it
  const previousTemplateId = templateId;

  if (allowedLayouts?.length > 0) {
    // Determine if this is a layout (all blocks belong to the template) or an
    // inserted template (template blocks mixed with standalone blocks).
    // allowedLayouts should only enforce on layouts, not on inserted templates.
    const isLayout =
      templateId &&
      layout.every((blockId) => {
        const block = blocks[blockId];
        return block?.templateInstanceId === existingInstanceId;
      });

    // Use path-normalised comparison: block templateId may be a full URL
    // (e.g. from Plone's resolveuid) while allowedLayouts may be paths.
    // Only a genuine forced SWITCH re-homes a page. A page-level blocks field
    // always carries its allowedLayouts — that is the layout MENU, not an
    // instruction — so re-homing on every render meant a page laid out with a
    // template the current menu doesn't list (a content-type layout offered only
    // on that type) was moved to allowedLayouts[0]: `null` by the menu's own
    // convention, i.e. its layout REMOVED on load, fixed blocks and all, and
    // persisted by the next save. The same distinction the multi-instance split
    // already makes above: exactly one allowedLayout is a switch, a list is a
    // re-render.
    if (
      isLayout &&
      forcedSingleLayout &&
      !allowedLayouts.some((l) => templateIdsMatch(l, templateId))
    ) {
      templateId = allowedLayouts[0];
      if (!filterInstanceId) {
        existingInstanceId = null;
      }
    } else if (!templateId) {
      // No template found — apply the forced layout
      templateId = allowedLayouts[0];
      if (!filterInstanceId) {
        existingInstanceId = null;
      }
    }
  }

  // Template removal: allowedLayouts forced null but a template was applied.
  // Use same merge logic with a synthetic "container" template (just a default slot)
  // so content is properly extracted from nested structures, then strip markers.
  let removingTemplate = false;
  if (!templateId && previousTemplateId) {
    removingTemplate = true;
    templateId = '__none__';
    templates['__none__'] = {
      blocks: { __default__: { '@type': 'slate', slotId: 'default' } },
      blocks_layout: { items: ['__default__'] },
    };
  }

  // No template to apply - pass through
  if (!templateId) {
    for (const blockId of layout) {
      if (blocks[blockId]) {
        addItem(blocks[blockId], blockId);
      }
    }
    return items;
  }

  // Get or generate instanceId.
  // A merge keeps the TARGET's instance id and strips the SOURCE's. `existingInstanceId`
  // doubles as the SOURCE-content filter (= filterInstanceId when merging INTO a
  // template), so it must NOT be stamped onto the result — that id belongs to the
  // source page's instance, not the template. When merging into a template, the
  // result (target) gets its own fresh id; the source filter still uses
  // existingInstanceId below. (Forward apply has no filterInstanceId, so the
  // target's own id — reused from the page or generated — is used as before.)
  // For forced layouts (no existing instanceId), mint one — but re-expanding the SAME
  // input in one pass must reuse it so generated block ids (`${instanceId}::tplId`)
  // stay stable (idempotency, e.g. a React/StrictMode double render). Key that by a
  // DATA id (the first block id, a string), NOT the dict object — so it survives a Vue
  // proxy / clone / postMessage copy, unlike the WeakMap it replaces.
  let instanceId = filterInstanceId ? null : existingInstanceId;
  if (!instanceId) {
    const idemKey = layout[0];
    if (idemKey && templateState.generatedInstanceIds?.[idemKey]) {
      instanceId = templateState.generatedInstanceIds[idemKey];
    } else {
      // Derive the id deterministically from the region's first block id so the
      // server render and the client hydration mint the SAME instance id (and so
      // the same `${instanceId}::tplChildId` block uids) — a random id differs
      // between the two passes and causes a hydration mismatch. An EMPTY forced
      // layout has no first block id, but the forced template id itself is a
      // stable seed (one region, one forced template): without it, every block
      // of a forced chrome template changed uid on hydration, and the editor's
      // pathmap/selectors (e.g. `uid#field` reveal handles) pointed at the
      // server pass's dead uids. Random only when there is truly no seed.
      // Distinctness: TWO forced layouts of the same template in one pass
      // (same templateState) must not share an instance — count per template,
      // so the Nth forced application seeds `${templateId}#${N}`. Region
      // render order is the same on the server and the client, so the counter
      // yields the same ids both passes.
      let forcedSeed = null;
      if (!idemKey && allowedLayouts?.length === 1) {
        if (!templateState.forcedSeedCounts) templateState.forcedSeedCounts = {};
        const nth = templateState.forcedSeedCounts[allowedLayouts[0]] || 0;
        templateState.forcedSeedCounts[allowedLayouts[0]] = nth + 1;
        forcedSeed = `${allowedLayouts[0]}#${nth}`;
      }
      instanceId = idemKey
        ? deterministicUUID(idemKey)
        : forcedSeed
          ? deterministicUUID(forcedSeed)
          : generateUUID();
      if (idemKey) {
        if (!templateState.generatedInstanceIds)
          templateState.generatedInstanceIds = {};
        templateState.generatedInstanceIds[idemKey] = instanceId;
      }
    }
  }

  // Shared on templateState so the apply-time recursion (fillContainerInto) sees the
  // current template + instance while filling nested containers.
  templateState.templateId = templateId;
  templateState.instanceId = instanceId;

  // Get or create instance context.
  // Always rebuild ctx when the instanceId is re-encountered (e.g. after save,
  // the API returns blocks with the same templateInstanceId but different content).
  // The ctx is mutated during processing (pendingContent consumed, emittedSlotIds
  // populated) so it cannot be reused.
  let ctx = templateState.instances[instanceId];
  if (ctx) {
    delete templateState.instances[instanceId];
    ctx = null;
  }

  if (!ctx) {
    ctx = {
      templateId,
      template: null,
      instanceId,
      emittedSlotIds: new Set(),
      pendingContent: new Map(),
      existingFixedBlockIds: new Map(),
      leadingStandaloneBlocks: [],
      trailingStandaloneBlocks: [],
      newTemplateIds: new Set(),
    };
    templateState.instances[instanceId] = ctx;

    // Initialize content collection for this instance
    if (existingInstanceId) {
      const allStandaloneBlocks = [];
      collectContentFromTree(
        { blocks, blocks_layout: { items: layout } },
        existingInstanceId,
        ctx.pendingContent,
        allStandaloneBlocks,
        ctx.existingFixedBlockIds,
      );

      let foundFirstTemplateBlock = false;
      let lastTemplateBlockIndex = -1;
      for (let i = 0; i < layout.length; i++) {
        const block = blocks[layout[i]];
        if (block?.templateInstanceId === existingInstanceId) {
          if (!foundFirstTemplateBlock) foundFirstTemplateBlock = true;
          lastTemplateBlockIndex = i;
        }
      }

      for (let i = 0; i < layout.length; i++) {
        const blockId = layout[i];
        const block = blocks[blockId];
        if (!block) continue;
        if (!block.templateId && !block.templateInstanceId && !block.slotId) {
          if (
            !foundFirstTemplateBlock ||
            i <
              layout.indexOf(
                layout.find((id, idx) => {
                  const b = blocks[id];
                  return (
                    b?.templateInstanceId === existingInstanceId &&
                    idx <= lastTemplateBlockIndex
                  );
                }),
              )
          ) {
            ctx.leadingStandaloneBlocks.push({ blockId, block });
          } else if (i > lastTemplateBlockIndex) {
            ctx.trailingStandaloneBlocks.push({ blockId, block });
          }
        }
      }
    } else {
      for (const blockId of layout) {
        const block = blocks[blockId];
        if (!block) continue;
        if (block.templateId && block.templateId !== templateId) {
          ctx.newTemplateIds.add(block.templateId);
        }
        if (
          block.fixed &&
          block.templateId &&
          block.templateId !== templateId
        ) {
          if (block.readOnly) {
            // Dropped — but not what the author put INSIDE it. A layout whose
            // frame is a single container block keeps the page's content in
            // that frame, so letting it go whole loses the page.
            collectNestedAuthorContent(block, ctx.pendingContent);
            continue;
          }
          if (block.slotId) {
            ctx.existingFixedBlockIds.set(block.slotId, { blockId, block });
          }
          continue;
        }
        if (block.slotId) {
          const slotId = block.slotId;
          if (!ctx.pendingContent.has(slotId)) {
            ctx.pendingContent.set(slotId, []);
          }
          ctx.pendingContent.get(slotId).push({ blockId, block });
        } else {
          if (!ctx.pendingContent.has('default')) {
            ctx.pendingContent.set('default', []);
          }
          ctx.pendingContent.get('default').push({ blockId, block });
        }
      }
    }
  }

  // Load template from pre-loaded map, falling back to sync loadTemplate callback.
  if (!ctx.template) {
    let template = templates[templateId];
    if (!template && loadTemplate) {
      template = loadTemplate(templateId);
      if (!template || typeof template.then === 'function') {
        throw new Error(
          `loadTemplate for "${templateId}" must return data synchronously, not a Promise. Use expandTemplates() for async loading, or pre-load templates via loadTemplates().`,
        );
      }
      templates[templateId] = template;
    }
    if (!template) {
      throw new Error(
        `Template "${templateId}" not found in pre-loaded templates. Available: ${Object.keys(templates).join(', ')}`,
      );
    }
    ctx.template = template;
  }

  const {
    template,
    emittedSlotIds,
    pendingContent,
    leadingStandaloneBlocks,
    trailingStandaloneBlocks,
    existingFixedBlockIds,
  } = ctx;

  // Process template (same as async version from here).
  // In the REVERSE merge `template` is the edited page (loaded via loadTemplate),
  // whose instance blocks can live in any region — a branded footer in
  // `blocks_layout.footer`, not just `items`. Walk every region via the shared
  // region API, or reverse-merging a non-items forced layout harvests nothing
  // and returns an empty template. (Forward templates only have `items`, so this
  // is a no-op there.)
  const templateLayout = allRegionIds(template.blocks_layout);
  let firstFixedIndex = -1;
  let lastFixedIndex = -1;
  const slotPositions = {};

  for (let i = 0; i < templateLayout.length; i++) {
    const tplBlock = template.blocks?.[templateLayout[i]];
    if (!tplBlock?.slotId) continue;
    if (tplBlock.fixed) {
      if (firstFixedIndex === -1) firstFixedIndex = i;
      lastFixedIndex = i;
    } else {
      if (firstFixedIndex === -1) {
        slotPositions[tplBlock.slotId] = 'top';
      } else if (i > lastFixedIndex) {
        slotPositions[tplBlock.slotId] = 'bottom';
      } else {
        slotPositions[tplBlock.slotId] = 'middle';
      }
    }
  }

  for (const { blockId, block } of leadingStandaloneBlocks) {
    addItem(block, blockId);
  }

  let defaultInsertIndex = -1;
  let bottomSlotInsertIndex = -1;
  let topSlotInsertIndex = -1;

  for (const tplBlockId of templateLayout) {
    const tplBlock = template.blocks?.[tplBlockId];
    if (!tplBlock) continue;

    if (tplBlock.fixed) {
      const slotId = tplBlock.slotId;
      const existing = slotId && existingFixedBlockIds?.get(slotId);
      const blockId =
        existing?.blockId || mintChildBlockId(instanceId, tplBlockId, uuidGenerator);

      let blockContent = tplBlock;
      if (!tplBlock.readOnly && existing?.block) {
        blockContent = { ...tplBlock, ...editedFieldsOf(existing.block) };
      }

      // Look ahead in template layout for the next non-fixed slot at this level.
      // This preserves slot info even when all slot blocks are deleted.
      const tplIdx = templateLayout.indexOf(tplBlockId);
      let nextSlotId = undefined;
      for (let i = tplIdx + 1; i < templateLayout.length; i++) {
        const nextTplBlock = template.blocks?.[templateLayout[i]];
        if (nextTplBlock && !nextTplBlock.fixed && nextTplBlock.slotId) {
          nextSlotId = nextTplBlock.slotId;
          break;
        }
        if (nextTplBlock?.fixed) break; // Stop at next fixed block
      }

      // For container blocks, filter nested blocks to only those with
      // template markers (slotId or templateId). Blocks without these are
      // template-internal details that should not be synced to pages. A
      // container's children are ordered by the named regions in its
      // `blocks_layout` dict (#234); filter each region and preserve them all.
      const isContainer = hasNestedBlocksLayout(tplBlock);
      if (tplBlock.blocks && isBlocksMap(tplBlock.blocks) && !isContainer) {
        throw new Error(
          `expandTemplatesSync: template block "${tplBlockId}" has nested ` +
            `\`blocks\` but no \`blocks_layout\` dict listing them by region.`,
        );
      }
      // childSlotIds hint: first non-fixed slot per field (add-path anchor). getChildFields
      // covers blocks_layout regions AND object_list array fields, so an object_list slot
      // container (a slider's `slides`) gets an anchor too — not just blocks_layout containers.
      // Keyed by the consumer's `field`: the shared 'blocks' dict for blocks_layout, or the
      // object_list field name (e.g. 'slides') — blockSync reads childSlotIds[field].
      let childSlotIds = undefined;
      for (const field of getChildFields(tplBlock)) {
        const key = field.isObjectList
          ? field.region
          : 'blocks';
        for (const { block: child } of getChildBlockEntries(tplBlock, field)) {
          if (child && !child.fixed && child.slotId) {
            if (!childSlotIds) childSlotIds = {};
            if (!childSlotIds[key]) childSlotIds[key] = child.slotId;
            break;
          }
        }
      }

      // Emit the container, then fully expand its child regions IN PLACE — every
      // blocks_layout region AND object_list array field, one path (fillContainerInto).
      // Re-entry recognizes the children by minted instanceId and passes them through.
      const emitted = {
        ...blockContent,
        templateId: templateId,
        templateInstanceId: instanceId,
        ...(nextSlotId && { nextSlotId }),
        ...(childSlotIds && { childSlotIds }),
      };
      fillContainerInto(emitted, tplBlock, templateState, options);
      addItem(emitted, blockId);
    } else {
      const slotId = tplBlock.slotId || 'default';
      const insertIndex = items.length;

      if (slotId === 'default') {
        defaultInsertIndex = insertIndex;
      }
      const position = slotPositions[slotId];
      if (position === 'bottom' && bottomSlotInsertIndex === -1) {
        bottomSlotInsertIndex = insertIndex;
      } else if (position === 'top' && topSlotInsertIndex === -1) {
        topSlotInsertIndex = insertIndex;
      }

      if (!emittedSlotIds.has(slotId)) {
        emittedSlotIds.add(slotId);
        const content = pendingContent.get(slotId) || [];
        for (const { blockId, block } of content) {
          addItem(
            {
              ...block,
              templateId: templateId,
              templateInstanceId: instanceId,
              slotId: slotId,
            },
            blockId,
          );
        }
        pendingContent.delete(slotId);
      }
    }
  }

  const remainingContent = [];
  for (const [slotId, content] of pendingContent) {
    if (!emittedSlotIds.has(slotId)) {
      emittedSlotIds.add(slotId);
      for (const { blockId, block } of content) {
        remainingContent.push({
          ...block,
          templateId: templateId,
          templateInstanceId: instanceId,
          slotId: 'default',
          _orphaned: true,
          '@uid': blockId,
        });
      }
    }
  }

  if (remainingContent.length > 0) {
    let insertIndex = -1;
    if (defaultInsertIndex >= 0) {
      insertIndex = defaultInsertIndex;
    } else if (bottomSlotInsertIndex >= 0) {
      insertIndex = bottomSlotInsertIndex;
    } else if (topSlotInsertIndex >= 0) {
      insertIndex = topSlotInsertIndex;
    }

    if (insertIndex >= 0) {
      items.splice(insertIndex, 0, ...remainingContent);
    }
  }

  for (const { blockId, block } of trailingStandaloneBlocks) {
    addItem(block, blockId);
  }

  // Template removal: strip all template markers so blocks are clean
  if (removingTemplate) {
    for (const item of items) {
      delete item.templateId;
      delete item.templateInstanceId;
      delete item.slotId;
      delete item.fixed;
      delete item.readOnly;
      delete item.nextSlotId;
      delete item.childSlotIds;
      delete item._orphaned;
    }
  }

  return items;
}
