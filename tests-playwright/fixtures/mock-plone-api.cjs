/**
 * Reusable mock Plone REST API server.
 * Implements minimal Plone REST API endpoints for content editing.
 * Serves content from disk (JSON files in content directories).
 *
 * Run standalone: node mock-plone-api.cjs
 * Or import the express app: const { app } = require('./mock-plone-api');
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8888;

/**
 * Parse CONTENT_MOUNTS env variable for multiple content directories
 * Format: "mountPath:dirPath,mountPath2:dirPath2"
 * Example: "/:/default/content,/pretagov:/path/to/pretagov/content"
 * Falls back to default ./content directory mounted at /
 */
function parseContentMounts() {
  const mountsEnv = process.env.CONTENT_MOUNTS;
  if (!mountsEnv) {
    return [
      { mountPath: '/', dirPath: path.join(__dirname, '../../docs/content/content/content') },
      { mountPath: '/_test_data', dirPath: path.join(__dirname, 'content') },
    ];
  }

  return mountsEnv.split(',').map(mount => {
    const [mountPath, dirPath] = mount.split(':');
    const resolvedDir = path.isAbsolute(dirPath) ? dirPath : path.resolve(process.cwd(), dirPath);
    return { mountPath: mountPath || '/', dirPath: resolvedDir };
  });
}

const CONTENT_MOUNTS = parseContentMounts();

/**
 * Resolve a moved-content redirect, mimicking plone.app.redirector.
 * Each mount may carry a redirects.json sibling ({ oldPath: newPath },
 * mount-relative) next to its content dir. Returns the new mount-prefixed
 * path or null. Read fresh each call (tiny file, only hit on a 404) so dev
 * edits to redirects.json take effect without a restart.
 */
function getRedirectTarget(cleanPath) {
  for (const { mountPath, dirPath } of CONTENT_MOUNTS) {
    const redirectsFile = path.join(dirPath, '..', 'redirects.json');
    if (!fs.existsSync(redirectsFile)) continue;
    let map;
    try { map = JSON.parse(fs.readFileSync(redirectsFile, 'utf8')); }
    catch { continue; }
    const rel = mountPath === '/'
      ? cleanPath
      : (cleanPath.startsWith(mountPath) ? cleanPath.slice(mountPath.length) || '/' : null);
    if (rel == null) continue;
    if (map[rel]) {
      return mountPath === '/' ? map[rel] : mountPath + map[rel];
    }
  }
  return null;
}

/**
 * Enumerate every redirects.json entry across mounts as mount-prefixed
 * {path, 'redirect-to'} pairs. Used by the @aliases endpoint.
 */
function getAllRedirects() {
  const out = [];
  for (const { mountPath, dirPath } of CONTENT_MOUNTS) {
    const redirectsFile = path.join(dirPath, '..', 'redirects.json');
    if (!fs.existsSync(redirectsFile)) continue;
    let map;
    try { map = JSON.parse(fs.readFileSync(redirectsFile, 'utf8')); }
    catch { continue; }
    for (const [from, to] of Object.entries(map)) {
      out.push({
        path: mountPath === '/' ? from : mountPath + from,
        'redirect-to': mountPath === '/' ? to : mountPath + to,
      });
    }
  }
  return out;
}

// Validate each mounted content tree at startup. Errors are loud (listed)
// but non-fatal — tests using the mock API still start. Set
// SKIP_CONTENT_VALIDATION=true to suppress entirely.
if (process.env.SKIP_CONTENT_VALIDATION !== 'true') {
  const { validate, checkIntegrity, formatReport } = require('./plone-content-validator.cjs');
  for (const { mountPath, dirPath } of CONTENT_MOUNTS) {
    if (!fs.existsSync(path.join(dirPath, '__metadata__.json'))) continue;
    const v = validate(dirPath);
    const c = checkIntegrity(dirPath);
    const problems = v.errors.length + v.warnings.length + c.errors.length + c.warnings.length;
    if (problems > 0) {
      console.log(`[content-check] ${mountPath} -> ${dirPath}`);
      if (v.errors.length || v.warnings.length) console.log(formatReport('validate', v));
      if (c.errors.length || c.warnings.length) console.log(formatReport('check', c));
    }
  }
}

// Session-based transient content storage for uploads
// Uploads are stored per-session so they don't appear for other users
// Format: { sessionId: { '/path': content, ... } }
const sessionContent = {};

// Bytes of images uploaded within a session, so @@images can serve back what
// was just POSTed. Without this the mock accepts an upload and then 404s every
// scale URL it advertised. Format: { 'sessionId:/path:field': {buffer, mime} }
const sessionBlobs = {};

// Paths deleted within a session. Disk content can't actually be removed (it
// is shared by every session and reloaded by the watcher), so a DELETE records
// a tombstone here and getContent treats the path as gone for that session
// only. Format: { sessionId: Set<'/path'> }
const sessionDeletions = {};

// Explicit child ordering per container, set by @order. Absent means "use the
// natural order", which is what every existing test relies on.
const sessionOrder = {};

/**
 * @move and @copy accept either one source or a list — the contents view lets
 * an editor select several rows and paste them together, so Volto always sends
 * whatever was selected. Each entry may be an absolute URL or a plain path.
 */
function normaliseSources(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(Boolean).map((entry) => {
    const value = typeof entry === 'string' ? entry : entry?.['@id'];
    if (typeof value !== 'string') return null;
    return /^https?:\/\//.test(value)
      ? new URL(value).pathname.replace('/++api++', '') || '/'
      : value;
  }).filter(Boolean);
}

// Map URL paths to source directories (for loading content from disk)
const contentDirMap = {};

// A mount may be a README-shaped markdown tree instead of a data.json tree.
// Those are read once at startup into these maps; everything downstream --
// enrichment, @components, search, @@images, resolveuid -- is unchanged,
// because it all works on the raw content object.
//
// blockmd is ESM and this file is CommonJS, so the module is pulled in with a
// single dynamic import during startup. `ready` resolves when the trees are
// loaded; the server awaits it before listening.
const MARKDOWN_BLOB_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
};
const markdownItems = new Map();   // url path -> raw content
const markdownBlobs = new Map();   // url path -> absolute blob file
let ready = Promise.resolve();
// The ESM loaders (readTree, validateTree, schema) are imported once at startup
// and held so a mount can be reloaded SYNCHRONOUSLY (on a watcher change or a
// cache miss) without re-awaiting a dynamic import.
let mdRuntime = null;

// Map UIDs to URL paths (for resolveuid endpoint)
const uidToPathMap = {};

// Map UIDs to their getObjPositionInParent value (from __metadata__.json ordering)
const uidPositionMap = {};

/**
 * Get session ID from request header.
 * Uses the Bearer auth token as the session identifier. AdminUIHelper
 * gives each test a unique token (TEST_AUTH_TOKEN + a uuid), so every
 * test gets an isolated session and its saves don't leak into others.
 * Admin (Volto) and Nuxt SSR both forward the same Authorization header,
 * so they share that one test's session.
 * @param {Object} req - Express request
 * @returns {string} Session ID (defaults to '_default' for unauthenticated requests)
 */
function getSessionId(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return `token:${token}`;
  }
  // Unauthenticated requests use default session (no persistence)
  return '_default';
}

/**
 * Store uploaded content in session-specific storage
 * @param {string} sessionId - Session ID from request
 * @param {string} urlPath - Content path
 * @param {Object} content - Content object to store
 */
function setSessionContent(sessionId, urlPath, content) {
  if (!sessionContent[sessionId]) {
    sessionContent[sessionId] = {};
  }
  sessionContent[sessionId][urlPath] = content;
}

/**
 * Generate a fresh JWT token with 24-hour expiration from now.
 * Called on each login/renew to ensure token is always valid.
 */
function generateAuthToken(username = 'admin') {
  const header = Buffer.from(JSON.stringify({"alg":"HS256","typ":"JWT"})).toString('base64').replace(/=/g, '');
  const payload = Buffer.from(JSON.stringify({
    "sub": username,
    "exp": Math.floor(Date.now()/1000) + 86400  // 24 hours from NOW
  })).toString('base64').replace(/=/g, '');
  return `${header}.${payload}.fake-signature`;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for image uploads

// Virtual Host Monster path rewriting middleware
// Volto's proxy adds VHM paths like: /VirtualHostBase/http/localhost:8888/++api++/VirtualHostRoot/@login
// And also sends requests with ++api++ prefix like: /++api++/@site
// Strip these prefixes and extract the actual path while preserving query string
// Also track if this is an API request (contains ++api++) vs frontend request
app.use((req, res, next) => {
  const url = require('url');
  const parsedUrl = url.parse(req.url, true);
  let cleanPath = parsedUrl.pathname;

  // Check if this is an API request (contains ++api++ prefix or Accept: application/json header)
  const acceptHeader = req.headers.accept || '';
  req.isApiRequest = cleanPath.includes('++api++') || acceptHeader.includes('application/json');

  // Handle full VHM path: /VirtualHostBase/http/localhost:8888/++api++/VirtualHostRoot/@login
  const vhmPattern = /^\/VirtualHostBase\/[^/]+\/[^/]+\/\+\+api\+\+\/VirtualHostRoot(.*)$/;
  const vhmMatch = cleanPath.match(vhmPattern);

  if (vhmMatch) {
    cleanPath = vhmMatch[1] || '/';
  }

  // Strip ++api++ anywhere in path (start or mid-path):
  //   /++api++/@site           -> /@site
  //   /blocks/search/++api++/@ -> /blocks/search/@
  cleanPath = cleanPath.replace(/\/?\+\+api\+\+\/?/g, '/');

  // Normalize multiple slashes to single slash (e.g., //@search -> /@search)
  cleanPath = cleanPath.replace(/\/+/g, '/');

  // Ensure path starts with /
  if (!cleanPath.startsWith('/')) {
    cleanPath = '/' + cleanPath;
  }

  // Reconstruct URL with cleaned path and preserved query string
  req.url = cleanPath + (parsedUrl.search || '');
  next();
});

// Request logging (only in debug mode)
if (process.env.DEBUG) {
  app.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    console.log(`${req.method} ${req.path}${authHeader ? ' [AUTH: ' + authHeader.substring(0, 30) + '...]' : ' [NO AUTH]'}`);
    next();
  });
}

/**
 * Check if request has valid authentication
 * @param {Object} req - Express request object
 * @returns {boolean} True if authenticated
 */
/**
 * A token the mock always rejects, so tests can reproduce a mid-session expiry
 * without tearing the server down. Nothing else issues this value.
 */
const REVOKED_TOKEN = 'EXPIRED_TOKEN';

function isRevoked(req) {
  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${REVOKED_TOKEN}`;
}

function isAuthenticated(req) {
  const authHeader = req.headers.authorization;
  return authHeader && authHeader.startsWith('Bearer ') && !isRevoked(req);
}

// Reject a revoked session before any route sees the request, exactly as a
// CMS with an expired cookie would.
app.use((req, res, next) => {
  if (isRevoked(req)) {
    return res.status(401).json({
      error: { type: 'Unauthorized', message: 'Session expired' },
    });
  }
  next();
});

/**
 * Filter actions based on authentication status
 * Unauthenticated users don't get edit permission
 * @param {Object} content - Content object with @components
 * @param {boolean} authenticated - Whether user is authenticated
 * @returns {Object} Content with filtered actions
 */
function filterActionsForAuth(content, authenticated) {
  if (!content || !content['@components'] || !content['@components'].actions) {
    return content;
  }

  // Clone content to avoid mutating original
  const filtered = JSON.parse(JSON.stringify(content));

  if (!authenticated) {
    // Remove edit action for unauthenticated users
    if (filtered['@components'].actions.object) {
      filtered['@components'].actions.object = filtered[
        '@components'
      ].actions.object.filter((action) => action.id !== 'edit');
    }
  }

  return filtered;
}

/**
 * Generate image_scales for Image content types
 * Used by object browser to display thumbnails
 */
function getImageScales(content, baseUrl) {
  if (content['@type'] !== 'Image' || !content.image) {
    return null;
  }

  const { width, height } = content.image;
  const contentPath = content['@id'].replace(baseUrl, '');

  return {
    image: [
      {
        'content-type': 'image/jpeg',
        download: `@@images/image`,
        filename: `${content.id || 'image'}.jpg`,
        width: width,
        height: height,
        scales: {
          preview: {
            download: `@@images/image/preview`,
            width: Math.min(width, 400),
            height: Math.min(height, 400),
          },
          large: {
            download: `@@images/image/large`,
            width: Math.min(width, 800),
            height: Math.min(height, 800),
          },
        },
      }
    ]
  };
}

/**
 * Generate image_scales for a non-Image content item that has a lead image
 * field set via blob_path (Documents/CaseStudy with the ILeadImage behaviour).
 * Real Plone exposes image_field + image_scales for these in listing brains;
 * our distribution export only carries the raw blob_path field, so synthesise
 * the brain shape here. Downloads are relative (`@@images/<field>[/scale]`) so
 * the frontend prefixes the item @id — same as getImageScales. No actual
 * resizing happens; the @@images endpoint serves the same bytes at any scale.
 */
function getLeadImageScales(content, fieldName) {
  const f = content[fieldName];
  if (!f) return null;
  const width = f.width || 800;
  const height = f.height || 600;
  const scaleConfigs = {
    icon: 32, tile: 64, thumb: 128, mini: 200, preview: 400,
    teaser: 600, large: 800, larger: 1000, great: 1200, huge: 1600,
  };
  const scales = {};
  for (const [name, maxDim] of Object.entries(scaleConfigs)) {
    if (maxDim < width || maxDim < height) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      scales[name] = {
        download: `@@images/${fieldName}/${name}`,
        width: Math.round(width * ratio),
        height: Math.round(height * ratio),
      };
    }
  }
  return {
    [fieldName]: [{
      'content-type': f['content-type'] || 'image/jpeg',
      download: `@@images/${fieldName}`,
      filename: f.filename || `${content.id || fieldName}`,
      width,
      height,
      scales,
    }],
  };
}

/**
 * Generate scales object for an image field
 * @param {string} fullUrl - Full URL of the content item
 * @param {string} fieldName - Image field name (e.g., 'image', 'preview_image')
 * @param {number} width - Original image width
 * @param {number} height - Original image height
 */
function generateScalesForField(fullUrl, fieldName, width, height) {
  const scaleConfigs = {
    icon: 32, tile: 64, thumb: 128, mini: 200,
    preview: 400, teaser: 600, large: 800, larger: 1000,
    great: 1200, huge: 1600,
  };
  const scales = {};
  for (const [name, maxDim] of Object.entries(scaleConfigs)) {
    if (maxDim < width || maxDim < height) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      scales[name] = {
        download: `${fullUrl}/@@images/${fieldName}/${name}`,
        width: Math.round(width * ratio),
        height: Math.round(height * ratio),
      };
    }
  }
  return scales;
}

/**
 * Transform distribution blob_path fields to proper download URLs.
 * Distribution content uses `blob_path` for image/preview_image fields;
 * the Plone REST API uses `download` URLs and `scales`.
 */
function transformBlobPaths(content, fullUrl) {
  const imageFields = ['image', 'preview_image'];
  const result = { ...content };
  for (const field of imageFields) {
    if (result[field]?.blob_path) {
      const { blob_path, ...rest } = result[field];
      result[field] = {
        ...rest,
        download: `${fullUrl}/@@images/${field}`,
        scales: generateScalesForField(fullUrl, field, rest.width || 800, rest.height || 600),
      };
    }
  }
  // A File's `file` field needs the same treatment. It was left out, so
  // blob_path — an export-layout detail no client should see — was served
  // raw, where real Plone returns a download URL.
  if (result.file?.blob_path) {
    const { blob_path, ...rest } = result.file;
    result.file = { ...rest, download: `${fullUrl}/@@download/file` };
  }
  return result;
}

/**
 * Generate placeholder image_scales for search results
 * Mimics Plone's image_scales structure - uses relative @@images paths
 * The mock server's @@images/* endpoint serves SVG placeholders
 */
function getPlaceholderImageScales(title, fieldName = 'image') {
  // Use a hash based on title for consistent URLs
  const hash = (title || 'item').split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0).toString(16);
  return {
    [fieldName]: [{
      'content-type': 'image/svg+xml',
      'download': `@@images/${fieldName}-800-${hash}.svg`,
      'filename': 'placeholder.svg',
      'height': 600,
      'width': 800,
      'scales': {
        'preview': {
          'download': `@@images/${fieldName}/preview`,
          'height': 300,
          'width': 400,
        },
        'mini': {
          'download': `@@images/${fieldName}/mini`,
          'height': 150,
          'width': 200,
        },
        'thumb': {
          'download': `@@images/${fieldName}/thumb`,
          'height': 96,
          'width': 128,
        },
      },
    }],
  };
}

/**
 * Match a SearchableText query against an item, mimicking Plone 6.2's
 * plone.app.querystring 3.0.0 `munge_search_term`: split the term on
 * whitespace, then each word must prefix-match a word token in any of
 * title/description/id. (Plone uses ZCText word-prefix indexing; we
 * tokenize on `\W+` and check `startsWith`, which is close enough.)
 */
function matchSearchableText(searchTerm, item) {
  const term = (searchTerm || '').replace(/\*+$/g, '').trim().toLowerCase();
  if (!term) return true;
  const parts = term.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  const haystackTokens = [
    ...(item.title || '').toLowerCase().split(/\W+/),
    ...(item.description || '').toLowerCase().split(/\W+/),
    ...(item.id || '').toLowerCase().split(/\W+/),
  ].filter(Boolean);
  return parts.every((p) => haystackTokens.some((tok) => tok.startsWith(p)));
}

/**
 * Format a content item for search results
 * Includes image_field and image_scales matching real Plone API structure
 * Includes is_folderish for folder navigation in object browser
 * Includes hasPreviewImage for teaser blocks to show target's preview image
 */
function formatSearchItem(content, baseUrl) {
  // Check if content has a preview image (common for Documents, News Items, etc.).
  // For distribution-style content the preview_image is a blob_path reference;
  // unless the bytes also exist on disk under the content dir, the mock can't
  // serve the @@images URL — so don't claim a preview image we can't deliver.
  const declaresPreview = !!(content.preview_image || content['@type'] === 'Image');
  let hasPreviewImage = declaresPreview;
  if (declaresPreview && content.preview_image?.blob_path) {
    const urlPath = (content['@id'] || '').replace(/^https?:\/\/[^/]+/, '') || '/';
    const dirInfo = contentDirMap[urlPath];
    hasPreviewImage = !!(dirInfo && findFirstImageFile(dirInfo.dirPath, 3));
  }

  const item = {
    '@id': content['@id'],
    '@type': content['@type'],
    'id': content.id,
    'title': content.title,
    'description': content.description || '',
    'review_state': content.review_state || 'published',
    'UID': content.UID,
    'is_folderish': content.is_folderish !== undefined ? content.is_folderish : true,
    'hasPreviewImage': hasPreviewImage,
    'effective': content.effective || content.created || null,
    'created': content.created || null,
    // Catalog brain attributes that nav-shaped listings rely on:
    // - getObjPositionInParent: position within immediate parent folder
    //   (from __metadata__.json ordering). The hierarchical post-sort
    //   in ploneFetchItems uses this to assemble parent-then-children.
    // - exclude_from_nav: whether the item is hidden from navigation —
    //   authors filter on this via a querystring criterion.
    'getObjPositionInParent': content.UID && uidPositionMap[content.UID] !== undefined
      ? uidPositionMap[content.UID]
      : null,
    'exclude_from_nav': content.exclude_from_nav === true,
    // Subject (capital S) is the Plone catalog index name; the @querystring-search
    // filter reads `item.Subject` for facet.Subject criteria. Populate from the
    // content's `subjects` field (the lowercase schema field).
    'Subject': content.subjects || [],
  };

  // Match real Plone: always include image_field and image_scales.
  // With image: image_field='image', image_scales={...}
  // Without image: image_field='', image_scales=null
  if (content['@type'] === 'Image') {
    item.image_field = 'image';
    item.image_scales = getImageScales(content, baseUrl) || getPlaceholderImageScales(content.title);
  } else if (content.image && (content.image.blob_path || content.image.width)) {
    // Lead image field (CaseStudy/Document with ILeadImage). Real Plone
    // exposes image_field='image' + image_scales for these in listings; the
    // @@images endpoint resolves the blob_path (incl. cross-referenced blobs).
    item.image_field = 'image';
    item.image_scales = getLeadImageScales(content, 'image');
  } else if (hasPreviewImage) {
    item.image_field = 'preview_image';
    item.image_scales = getPlaceholderImageScales(content.title, 'preview_image');
  } else {
    item.image_field = '';
    item.image_scales = null;
  }

  return item;
}

/**
 * Load raw content from disk (without enrichment, for internal use)
 * @param {string} urlPath - The URL path to load content for
 * @returns {Object|null} The raw content object or null if not found
 */
function loadRawContentFromDisk(urlPath) {
  // Read from the loaded caches: a markdown item, or a JSON data.json on disk.
  // Markdown is a whole-tree cache; JSON is read per-path here.
  const readCached = () => {
    if (markdownItems.has(urlPath)) return markdownItems.get(urlPath);
    const dirInfo = contentDirMap[urlPath];
    if (dirInfo && !dirInfo.markdown) {
      const dataPath = path.join(dirInfo.dirPath, 'data.json');
      if (fs.existsSync(dataPath)) return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    }
    for (const { mountPath, dirPath } of CONTENT_MOUNTS) {
      const relativePath = mountPath === '/' ? urlPath : urlPath.replace(mountPath, '');
      const dataPath = path.join(dirPath, relativePath.replace(/^\//, ''), 'data.json');
      if (fs.existsSync(dataPath)) return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    }
    return null;
  };

  const hit = readCached();
  if (hit != null) return hit;
  // Miss: reload the mount that owns this path (format-agnostic -- markdown
  // re-reads its tree, JSON rescans) and retry once. Content added since startup
  // is picked up here rather than needing a restart.
  const mount = mountFor(urlPath);
  if (mount) {
    reloadMount(mount);
    return readCached();
  }
  return null;
}

/**
 * Load content from disk for a given URL path (with enrichment)
 * @param {string} urlPath - The URL path to load content for
 * @returns {Object|null} The enriched content object or null if not found
 */
/**
 * Parse the ?expand= query string into an array of component names.
 * Real Plone treats this as a comma-separated list driving which
 * @components entries are returned expanded vs as @id stubs.
 */
function parseExpand(req) {
  const raw = req?.query?.expand;
  if (!raw) return [];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function loadContentFromDisk(urlPath, expandList = []) {
  const baseUrl = `http://localhost:${PORT}`;
  const content = loadRawContentFromDisk(urlPath);
  if (!content) return null;

  return enrichContent(content, urlPath, baseUrl, expandList);
}

/**
 * Format raw content for navigation (avoids enrichment to prevent circular calls).
 * remainingDepth controls how much of the subtree to include: 0 means no
 * children, 1 means direct children only, etc.
 */
function formatNavItem(rawContent, urlPath, baseUrl, remainingDepth) {
  const hasPreviewImage = !!(rawContent.preview_image || rawContent['@type'] === 'Image');
  const children = (remainingDepth > 0 && rawContent.is_folderish !== false)
    ? getNavigationItems(urlPath, remainingDepth, baseUrl)
    : [];
  return {
    '@id': `${baseUrl}${urlPath}`,
    '@type': rawContent['@type'],
    'id': rawContent.id,
    'title': rawContent.title,
    'description': rawContent.description || '',
    'review_state': rawContent.review_state || 'published',
    'UID': rawContent.UID || `${rawContent.id}-uid`,
    'is_folderish': rawContent.is_folderish !== undefined ? rawContent.is_folderish : true,
    'hasPreviewImage': hasPreviewImage,
    'items': children,
  };
}

/**
 * Get navigation items at a specific level under a base path
 * Only includes content from disk (contentDirMap), not session uploads
 * Uses raw content to avoid circular enrichment calls
 * @param {string} basePath - The base path to get navigation for (e.g., '/' or '/pretagov')
 * @param {number} depth - How many levels deep to include (default 1)
 */
function getNavigationItems(basePath = '/', depth = 1, baseUrlIn) {
  const baseUrl = baseUrlIn || `http://localhost:${PORT}`;
  const normalizedBase = basePath.replace(/\/$/, '') || '/';
  const baseDepth = normalizedBase === '/' ? 0 : normalizedBase.split('/').filter(p => p).length;

  const items = Object.keys(contentDirMap)
    .filter((itemPath) => {
      if (itemPath === '/') return false;
      if (itemPath === normalizedBase) return false; // Exclude the base itself

      // Check if item is under the base path
      if (normalizedBase !== '/' && !itemPath.startsWith(normalizedBase + '/')) {
        return false;
      }

      // Direct children of the base only — formatNavItem recurses for the
      // rest of the subtree with remainingDepth-1.
      const itemParts = itemPath.split('/').filter(p => p);
      return itemParts.length === baseDepth + 1;
    })
    .map((itemPath) => {
      const rawContent = loadRawContentFromDisk(itemPath);
      if (!rawContent) return null;
      if (rawContent.exclude_from_nav) return null;
      if (rawContent['@type'] === 'Image' || rawContent['@type'] === 'File') return null;
      return formatNavItem(rawContent, itemPath, baseUrl, depth - 1);
    })
    .filter(Boolean);

  // Sort by __metadata__.json ordering (UID→position), preserving
  // contentDirMap key order (filesystem alphabetical) as fallback.
  items.sort((a, b) => {
    const aPos = a.UID ? uidPositionMap[a.UID] : undefined;
    const bPos = b.UID ? uidPositionMap[b.UID] : undefined;
    if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
    if (aPos !== undefined) return -1;
    if (bPos !== undefined) return 1;
    return 0; // preserve original order
  });

  return items;
}

/**
 * Get root-level navigation items.
 * Merges items from all content mounts so test content (/_test_data/*)
 * appears alongside docs content in the navigation.
 */
function getRootNavigationItems(sessionId) {
  // Top-level items each pre-populated with their immediate children, so
  // the dropdown menu shows the next level on hover. depth=2 means "two
  // levels of items in total" — top + their direct children — which is
  // what the previous (depth-1-with-implicit-child-recursion) code produced.
  return getNavigationItems('/', 2, undefined, sessionId);
}

// ── Per-component builders ────────────────────────────────────────────────
//
// Single source of truth for each @components entry. Used by:
//   1. generateComponents() — the inline expansion path that fills
//      @components when ?expand=... lists the component on a content GET/POST.
//   2. Dedicated endpoint handlers (`/@actions`, `/@breadcrumbs`, ...) that
//      respond to direct fetches from clients.
//
// Without this dedupe the two paths drift: the inline @components.actions
// historically had `view + edit + folderContents` while the dedicated
// /@actions endpoint had only `view + edit`, so reducers seeing the same
// "actions" data via different code paths got different results.

function buildBreadcrumbsComponent(cleanPath, baseUrl) {
  const pathParts = cleanPath.split('/').filter(Boolean);
  const items = [{ '@id': baseUrl, title: 'Home' }];
  let currentPath = '';
  for (const part of pathParts) {
    currentPath += '/' + part;
    const partContent = loadRawContentFromDisk(currentPath);
    items.push({
      '@id': baseUrl + currentPath,
      title: partContent?.title || part,
    });
  }
  const fullUrl = cleanPath === '/' ? baseUrl : `${baseUrl}${cleanPath}`;
  return {
    '@id': `${fullUrl}/@breadcrumbs`,
    items,
    root: baseUrl,
  };
}

function buildActionsComponent(cleanPath, baseUrl, sessionId) {
  const fullUrl = cleanPath === '/' ? baseUrl : `${baseUrl}${cleanPath}`;
  return {
    '@id': `${fullUrl}/@actions`,
    document_actions: [],
    // Two sources, and they disagree. plone.restapi's own recorded example
    // (actions_get.resp) has keys [icon, id, title]; a live Plone 6
    // (demo.plone.org) has [icon, id, title, url]. The recording predates the
    // serializer gaining `url`, and Volto reads `url` — Footer.jsx renders
    // `item.url ? flattenToAppURL(item.url) : addAppURL(item.id)` — so `url`
    // is what a current Plone emits and what belongs here.
    //
    // WHICH entries appear, and in which category, is from actions_get.resp:
    // delete belongs in object_buttons beside cut/copy/rename, not in object.
    object: [
      { url: fullUrl, icon: '', id: 'view', title: 'View' },
      { url: `${fullUrl}/edit`, icon: '', id: 'edit', title: 'Edit' },
      { id: 'folderContents', icon: '', title: 'Contents' },
      { id: 'history', icon: '', title: 'History' },
      { id: 'local_roles', icon: '', title: 'Sharing' },
    ],
    object_buttons: [
      { id: 'cut', icon: '', title: 'Cut' },
      { id: 'copy', icon: '', title: 'Copy' },
      { id: 'delete', icon: '', title: 'Delete' },
      { id: 'rename', icon: '', title: 'Rename' },
      // plone.app.iterate's, and the ids Volto gates its working-copy buttons
      // on. NOT in actions_get.resp, which records a site without it — so this
      // is the one entry here that is inferred rather than recorded.
      ...(workingCopyOf(cleanPath, sessionId)
        ? [{ id: 'iterate_checkin', icon: '', title: 'Check in' }]
        : [{ id: 'iterate_checkout', icon: '', title: 'Check out' }]),
    ],
    portal_tabs: [],
    site_actions: [],
    user: [],
  };
}

function buildNavigationComponent(cleanPath, baseUrl, sessionId) {
  const fullUrl = cleanPath === '/' ? baseUrl : `${baseUrl}${cleanPath}`;
  return {
    '@id': `${fullUrl}/@navigation`,
    // Always rooted at site root — top-level items with nested children
    items: getRootNavigationItems(sessionId),
  };
}

/**
 * Plone's simple_publication_workflow.
 *
 * Shape comes from tests-adapters/fixtures/plone/workflow_get.resp — a real
 * recorded response. Note what is NOT in it: a transition names no destination
 * state, only an @id and a title. Behaviour (which transition leads where) is
 * simulated here because the workflow definition is not over REST at all.
 */
const SPW = {
  private: [
    { id: 'publish', title: 'Publish', to: 'published' },
    { id: 'submit', title: 'Submit for publication', to: 'pending' },
  ],
  pending: [
    { id: 'publish', title: 'Publish', to: 'published' },
    { id: 'reject', title: 'Reject', to: 'private' },
    { id: 'retract', title: 'Retract', to: 'private' },
  ],
  published: [{ id: 'retract', title: 'Retract', to: 'private' }],
};

const STATE_TITLES = {
  private: 'Private',
  pending: 'Pending review',
  published: 'Published',
};

function buildWorkflowComponent(cleanPath, baseUrl, sessionId) {
  const fullUrl = cleanPath === '/' ? baseUrl : `${baseUrl}${cleanPath}`;
  const content = getContent(cleanPath, sessionId);
  const state = content?.review_state || 'published';
  return {
    '@id': `${fullUrl}/@workflow`,
    history: [
      {
        action: null,
        actor: 'admin',
        comments: '',
        review_state: state,
        time: '1995-07-31T17:30:00+00:00',
        title: STATE_TITLES[state] ?? state,
      },
    ],
    state: { id: state, title: STATE_TITLES[state] ?? state },
    // Deliberately {@id, title} only. An adapter that wants a destination
    // state has to get it somewhere else — which is the finding.
    transitions: (SPW[state] ?? []).map((t) => ({
      '@id': `${fullUrl}/@workflow/${t.id}`,
      title: t.title,
    })),
  };
}

/**
 * Local roles. Shape from tests-adapters/fixtures/plone/sharing_folder_get.resp.
 *
 * Entry-major, with a {Role: bool} map per principal — the grid. Transposing
 * that into one field per role is the ADAPTER's job, in both directions.
 */
const AVAILABLE_ROLES = [
  { id: 'Contributor', title: 'Can add' },
  { id: 'Editor', title: 'Can edit' },
  { id: 'Reader', title: 'Can view' },
  { id: 'Reviewer', title: 'Can review' },
];

const sessionSharing = {};

/**
 * Working copies. Shapes from tests-adapters/fixtures/plone/workingcopy_*.
 * A checkout lives at a DIFFERENT path, which is the whole reason the
 * transition has to say where the editing session should go.
 */
const sessionWorkingCopies = {};

function workingCopyOf(cleanPath, sessionId) {
  return sessionWorkingCopies[sessionId]?.[cleanPath] ?? null;
}

function noRoles() {
  return Object.fromEntries(AVAILABLE_ROLES.map((r) => [r.id, false]));
}

function getSharing(cleanPath, sessionId) {
  const stored = sessionSharing[sessionId]?.[cleanPath];
  if (stored) return stored;
  return {
    available_roles: AVAILABLE_ROLES,
    entries: [
      {
        disabled: false,
        id: 'AuthenticatedUsers',
        login: null,
        roles: noRoles(),
        title: 'Logged-in users',
        type: 'group',
      },
    ],
    inherit: true,
  };
}

function buildNavrootComponent(cleanPath, baseUrl) {
  const fullUrl = cleanPath === '/' ? baseUrl : `${baseUrl}${cleanPath}`;
  return {
    '@id': `${fullUrl}/@navroot`,
    navroot: {
      '@id': baseUrl,
      '@type': 'Plone Site',
      title: 'Site',
    },
  };
}

function buildTypesComponent() {
  return listAddableTypes();
}

/**
 * Generate the FULL @components map (every entry expanded). The
 * expand-aware caller (enrichContent) decides which entries are included
 * vs left as @id stubs.
 */
function generateComponents(urlPath, baseUrl) {
  const cleanPath = urlPath.replace(/\/$/, '') || '/';
  return {
    // No session here: generateComponents builds the expander bundle, which
    // has no request context. The adapter reads @actions directly, and that
    // route IS session-aware, so a working copy still reports iterate_checkin.
    actions: buildActionsComponent(cleanPath, baseUrl),
    breadcrumbs: buildBreadcrumbsComponent(cleanPath, baseUrl),
    navigation: buildNavigationComponent(cleanPath, baseUrl),
    navroot: buildNavrootComponent(cleanPath, baseUrl),
    types: buildTypesComponent(),
    workflow: buildWorkflowComponent(cleanPath, baseUrl),
  };
}

/**
 * Resolve resolveuid/UID references in content to actual paths.
 * Like Plone's serializer, converts resolveuid/UID strings to addressable
 * locations.
 *
 * Most fields get a full URL (matches Plone's serializer behaviour for
 * link/href fields). templateId / templateInstanceId / slotId resolve to
 * paths only — these are template-system identifiers compared against the
 * admin's currentPath (also a path), so an origin prefix would defeat
 * equality checks like the save-flow's `id !== currentPath` filter and
 * the load-flow's "don't recursively expand a template into its own page"
 * guard.
 */
function resolveUidUrls(obj, parentKey = null) {
  if (typeof obj === 'string') {
    const resolveAsPath = parentKey === 'templateId'
      || parentKey === 'templateInstanceId'
      || parentKey === 'slotId';
    return obj.replace(/(?:\.\.\/)*resolveuid\/([a-z0-9][-a-z0-9]*)/g, (match, uid) => {
      let resolvedPath = uidToPathMap[uid];
      if (!resolvedPath) {
        // UID not found — rescan content dirs in case new files were added
        initContentDirMap();
        resolvedPath = uidToPathMap[uid];
      }
      if (!resolvedPath) return match;
      return resolveAsPath ? resolvedPath : `http://localhost:${PORT}${resolvedPath}`;
    });
  }
  if (Array.isArray(obj)) return obj.map(item => resolveUidUrls(item, parentKey));
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveUidUrls(value, key);
    }
    return result;
  }
  return obj;
}

/**
 * Add image_scales to catalog brain references embedded in block data.
 * Real Plone includes image_scales in catalog brains; our content export doesn't.
 * Walks the data and for any object with image_field but no image_scales,
 * looks up the referenced image content and generates scales.
 */
/**
 * Relation fields (currently `preview_image_link`, from volto.preview_image_link)
 * are stored on disk as `resolveuid/UID`. Plone's RelationChoiceFieldSerializer
 * serialises them as a SUMMARY of the linked object — not a url string:
 *
 *   plone.restapi serializer/relationfield.py:23
 *     summary = getMultiAdapter((value.to_object, request), ISerializeToJsonSummary)()
 *
 * and plone.volto registers a JSONSummarySerializerMetadata utility adding
 * `image_field` and `image_scales` to every summary (plone.volto/summary.py).
 *
 * IMPORTANT — `image_field` is NULL on a relation summary. Verified against real
 * Plone 6.1.5 (plone.restapi 9.15.6) and 6.2.1 (10.0.2): the catalog BRAIN has
 * `image_field: 'image'`, but the summary produced for a relation does not. An
 * earlier version of this mock invented `image_field: 'image'` so that
 * enrichImageBrains() would attach the scales — which made consumers key off a
 * field real Plone never sends, and hid a live bug in og:image resolution.
 * So attach image_scales here, directly, and leave image_field null.
 */
const RELATION_FIELDS = ['preview_image_link'];

function summarizeRelations(content, baseUrl) {
  const out = { ...content };
  for (const field of RELATION_FIELDS) {
    const value = out[field];
    if (typeof value !== 'string') continue; // already a summary, or unset
    const contentPath = value.startsWith('http') ? new URL(value).pathname : value;
    const raw = loadRawContentFromDisk(contentPath);
    if (!raw) continue;
    const summary = {
      '@id': `${baseUrl}${contentPath}`,
      '@type': raw['@type'],
      title: raw.title,
      description: raw.description || '',
      review_state: raw.review_state || 'published',
      image_field: null,
    };
    if (raw['@type'] === 'Image') {
      const scales = getImageScales(enrichContent(raw, contentPath, baseUrl), baseUrl);
      // A relation to a non-image simply has no image_scales — that, not
      // image_field, is how a consumer tells the two apart.
      if (scales) summary.image_scales = scales;
    }
    out[field] = summary;
  }
  return out;
}

/**
 * An image block's `url` is either a bare string or Volto's object-browser
 * form `[{'@id': ...}]`. Both appear in real content. Returns a string or null.
 */
function imageBlockUrl(url) {
  if (typeof url === 'string') return url;
  if (Array.isArray(url)) {
    const first = url[0];
    if (typeof first === 'string') return first;
    if (first && typeof first['@id'] === 'string') return first['@id'];
  }
  if (url && typeof url['@id'] === 'string') return url['@id'];
  return null;
}

function enrichImageBrains(obj, baseUrl) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => enrichImageBrains(item, baseUrl));

  // Check if this object is a catalog brain reference missing image_scales
  if (obj.image_field && !obj.image_scales && obj['@id']) {
    // Extract path from @id URL
    const idUrl = obj['@id'];
    const contentPath = idUrl.startsWith('http') ? new URL(idUrl).pathname : idUrl;
    const rawContent = loadRawContentFromDisk(contentPath);
    if (rawContent) {
      const enrichedImage = enrichContent(rawContent, contentPath, baseUrl);
      const scales = getImageScales(enrichedImage, baseUrl);
      if (scales) {
        obj = { ...obj, image_scales: scales };
      }
    }
  }

  // An image block references an Image object through `url` and carries no
  // `image_field`. Real Plone's serializer attaches image_scales to it at
  // request time; the content export on disk holds only the (resolveuid) url.
  // Without this, anything reading `block.image_scales` — og:image resolution,
  // responsive srcset — silently sees nothing against the mock, and fixtures
  // are forced to hand-embed a shape the real API would have produced.
  if (obj['@type'] === 'image' && obj.url && !obj.image_scales) {
    // `url` comes in two shapes: a bare string, or Volto's object-browser form
    // `[{'@id': ...}]`. Assuming a string throws `url.startsWith is not a
    // function` and 500s the whole content response.
    const url = imageBlockUrl(obj.url);
    // resolveUidUrls has already run, so an internal reference is a real path.
    const isExternal = typeof url === 'string' && url.startsWith('http') && !url.startsWith(baseUrl);
    if (url && !isExternal) {
      const contentPath = url.startsWith('http') ? new URL(url).pathname : url;
      const rawContent = loadRawContentFromDisk(contentPath);
      if (rawContent) {
        const enrichedImage = enrichContent(rawContent, contentPath, baseUrl);
        const scales = getImageScales(enrichedImage, baseUrl);
        if (scales) {
          obj = { ...obj, image_scales: scales };
        }
      }
    }
  }

  // Recurse into nested objects
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = enrichImageBrains(value, baseUrl);
  }
  return result;
}

/**
 * Resolve an object-browser link (a block's `href`/`link`) that carries ONLY an
 * `@id` -- the non-redundant form the markdown mount stores -- into a fresh
 * summary of its target (title/description/hasPreviewImage), the way a listing
 * resolves its items. A link that already carries an embedded summary (the
 * distribution/JSON form, snapshotted at edit time) is left untouched, so this
 * changes only markdown-mount content and cannot alter existing fixtures.
 *
 * This is a DELIBERATE divergence from Plone, which snapshots block links at edit
 * time and never re-resolves them: the markdown owns the reference, the server
 * resolves the label, so the stored title cannot go stale.
 */
const LINK_FIELDS = new Set(['href', 'link']);
const isBareLink = (o) => o && typeof o === 'object' && !Array.isArray(o)
  && typeof o['@id'] === 'string' && Object.keys(o).length === 1;

function resolveHrefLinks(obj, baseUrl) {
  if (Array.isArray(obj)) return obj.map((x) => resolveHrefLinks(x, baseUrl));
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (LINK_FIELDS.has(key) && Array.isArray(value) && value.length && value.every(isBareLink)) {
      out[key] = value.map((item) => {
        const path = item['@id'].startsWith('http') ? new URL(item['@id']).pathname : item['@id'];
        const raw = loadRawContentFromDisk(path);
        if (!raw) return item; // external / unresolvable -> keep the bare @id
        return { ...formatSearchItem(raw, baseUrl), '@id': `${baseUrl}${path}` };
      });
    } else {
      out[key] = resolveHrefLinks(value, baseUrl);
    }
  }
  return out;
}

/**
 * Get folder child items sorted by __metadata__.json ordering.
 * Like Plone's content serializer, returns summary representations of children.
 */
function getFolderChildItems(folderPath, baseUrl) {
  const normalizedFolder = folderPath.replace(/\/$/, '') || '/';
  const folderDepth = normalizedFolder === '/' ? 0 : normalizedFolder.split('/').filter(Boolean).length;

  const items = Object.keys(contentDirMap)
    .filter((itemPath) => {
      if (itemPath === '/') return false;
      if (itemPath === normalizedFolder) return false;
      if (normalizedFolder !== '/' && !itemPath.startsWith(normalizedFolder + '/')) return false;
      const itemParts = itemPath.split('/').filter(Boolean);
      return itemParts.length === folderDepth + 1;
    })
    .map((itemPath) => {
      const rawContent = loadRawContentFromDisk(itemPath);
      if (!rawContent) return null;
      return {
        '@id': `${baseUrl}${itemPath}`,
        '@type': rawContent['@type'],
        'description': rawContent.description || '',
        'review_state': rawContent.review_state || 'published',
        'title': rawContent.title,
        'UID': rawContent.UID,
      };
    })
    .filter(Boolean);

  // Sort by __metadata__.json ordering (UID→position)
  items.sort((a, b) => {
    const aPos = a.UID ? uidPositionMap[a.UID] : undefined;
    const bPos = b.UID ? uidPositionMap[b.UID] : undefined;
    if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
    if (aPos !== undefined) return -1;
    if (bPos !== undefined) return 1;
    return 0;
  });

  return items;
}

/**
 * Enrich content with generated fields (@id, @components, permissions, etc.)
 * Content files use distribution format with relative @id paths.
 */
/**
 * Build a stubbed @components map: every component is just {'@id': '<endpoint URL>'}.
 * Mirrors real Plone — without ?expand=, components are stubs that point to
 * dedicated endpoints (`@actions`, `@breadcrumbs`, ...). Reducers that need
 * the data either dispatch separate fetches or rely on the apiExpanders
 * middleware to add ?expand= which the request handler then expands.
 */
function stubComponents(fullUrl) {
  const ids = ['actions', 'aliases', 'breadcrumbs', 'contextnavigation', 'navigation', 'navroot', 'types', 'workflow'];
  const stubs = {};
  for (const k of ids) {
    stubs[k] = { '@id': `${fullUrl}/@${k}` };
  }
  return stubs;
}

/**
 * Replace stubs for the named components with their fully-expanded bodies.
 * `expandList` is parsed from ?expand= on the incoming request.
 */
function expandComponents(stubs, expandList, urlPath, baseUrl) {
  if (!expandList || expandList.length === 0) return stubs;
  const expanded = generateComponents(urlPath, baseUrl);
  const out = { ...stubs };
  for (const name of expandList) {
    if (expanded[name] !== undefined) out[name] = expanded[name];
  }
  return out;
}

function enrichContent(content, urlPath, baseUrl, expandList = []) {
  // Always use urlPath for @id (includes mount prefix), normalize trailing slash
  const cleanPath = urlPath.replace(/\/$/, '') || '/';
  const fullUrl = cleanPath === '/' ? baseUrl : `${baseUrl}${cleanPath}`;

  // Convert parent @id to full URL if needed
  let parent = content.parent;
  if (parent && parent['@id'] && !parent['@id'].startsWith('http')) {
    parent = {
      ...parent,
      '@id': baseUrl + parent['@id']
    };
  } else if (!parent) {
    parent = {
      '@id': baseUrl,
      '@type': 'Plone Site',
      'title': 'Site'
    };
  }

  // Transform distribution blob_path fields to download URLs
  const transformed = transformBlobPaths(content, fullUrl);

  // Dynamically build items (folder children) like Plone does,
  // sorted by __metadata__.json ordering
  const isFolderish = transformed.is_folderish !== undefined ? transformed.is_folderish : true;
  const childItems = isFolderish ? getFolderChildItems(cleanPath, baseUrl) : [];

  const enriched = {
    ...transformed,
    '@id': fullUrl,
    'UID': transformed.UID || `${transformed.id || urlPath.replace(/\//g, '-')}-uid`,
    'review_state': transformed.review_state || 'published',
    'is_folderish': isFolderish,
    'allow_discussion': transformed.allow_discussion !== undefined ? transformed.allow_discussion : false,
    'exclude_from_nav': transformed.exclude_from_nav || false,
    'created': transformed.created || '2025-01-01T12:00:00+00:00',
    'modified': transformed.modified || '2025-01-01T12:00:00+00:00',
    'lock': transformed.lock || { 'locked': false, 'stealable': true },
    'parent': parent,
    'items': childItems,
    'items_total': childItems.length,
    '@components': expandComponents(stubComponents(fullUrl), expandList, urlPath, baseUrl),
    // Permissions - granted by default, but a fixture may set `_mockPermissions` to model
    // an unauthorized case (e.g. a templates folder the user can't add to, or a template
    // document the user can't modify). This mirrors Plone's per-object permission flags.
    'can_manage_portlets': true,
    'can_view': transformed._mockPermissions?.can_view ?? true,
    'can_edit': transformed._mockPermissions?.can_edit ?? true,
    'can_delete': transformed._mockPermissions?.can_delete ?? true,
    'can_add': transformed._mockPermissions?.can_add ?? true,
    'can_list_contents': true
  };

  // 1. Resolve resolveuid/UID references to actual URLs (like Plone's serializer)
  // 2. Turn relation fields into summaries of their target (RelationChoiceFieldSerializer)
  // 3. Add image_scales to anything summary-shaped (image_field + @id)
  return enrichImageBrains(
    resolveHrefLinks(summarizeRelations(resolveUidUrls(enriched), baseUrl), baseUrl),
    baseUrl,
  );
}

/**
 * Scan content directory and populate contentDirMap (recursively)
 * Content is loaded from disk on-demand, not cached
 */
function scanContentDir(contentDirPath, mountPath) {
  if (!fs.existsSync(contentDirPath)) {
    console.log(`Content directory not found: ${contentDirPath}`);
    return;
  }

  console.log(`Scanning content from ${contentDirPath} mounted at ${mountPath}`);

  // Read __metadata__.json ordering if present (Plone distribution format)
  const metadataPath = path.join(contentDirPath, '__metadata__.json');
  if (fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    if (metadata.ordering) {
      for (const [uid, position] of Object.entries(metadata.ordering)) {
        uidPositionMap[uid] = position;
      }
    }
  }

  const dirs = fs.readdirSync(contentDirPath, { withFileTypes: true });
  dirs.forEach((dir) => {
    // Support both real directories and symlinks to directories
    const fullDirPath = path.join(contentDirPath, dir.name);
    const isDir = dir.isDirectory() || (dir.isSymbolicLink() &&
      fs.statSync(fullDirPath).isDirectory());
    if (isDir) {
      const dataPath = path.join(fullDirPath, 'data.json');
      if (fs.existsSync(dataPath)) {
        const content = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        // Use @id from content if it's a path, otherwise use directory name
        let contentPath = content['@id']?.startsWith('/') ? content['@id'] : '/' + (content.id || dir.name);

        // Handle distribution site root (plone_site_root dir or @id=/Plone)
        if (dir.name === 'plone_site_root' || contentPath === '/Plone') {
          contentPath = '/';
        }

        // Apply mount prefix (skip if @id already starts with mountPath)
        const urlPath = mountPath === '/' || contentPath.startsWith(mountPath)
          ? contentPath
          : mountPath + contentPath;

        // Only store the directory mapping, content loaded on-demand
        contentDirMap[urlPath] = { dirPath: fullDirPath, dirName: dir.name };
        // Track UID→path for resolveuid endpoint
        if (content.UID) {
          uidToPathMap[content.UID] = urlPath;
        }
        console.log(`Registered content: ${urlPath}`);
      }
      // Always recurse into subdirectories to find nested content (e.g., templates/)
      scanContentDir(fullDirPath, mountPath);
    }
  });
}

/**
 * Generate site root content (not from disk)
 */
function getSiteRoot() {
  const baseUrl = `http://localhost:${PORT}`;
  return {
    '@id': baseUrl + '/',
    '@type': 'Plone Site',
    'id': 'Plone',
    'title': 'Plone Site',
    'description': '',
    'items': [],
    'items_total': 0,
    'is_folderish': true,
    'blocks': {},
    'blocks_layout': { 'items': [] },
    '@components': generateComponents('/', baseUrl),
    'can_manage_portlets': true,
    'can_view': true,
    'can_edit': true,
    'can_delete': true,
    'can_add': true,
    'can_list_contents': true
  };
}

/** A markdown tree is one with an index.md at its root; a distribution tree has
 *  plone_site_root/data.json instead. */
const isMarkdownMount = (mount) => fs.existsSync(path.join(mount.dirPath, 'index.md'));

/** The mount that owns a url path (the ContentSource for it). '/' owns everything. */
function mountFor(urlPath) {
  return CONTENT_MOUNTS.find((m) => m.mountPath === '/'
    || urlPath === m.mountPath || urlPath.startsWith(`${m.mountPath}/`));
}

/** (Re)load ONE markdown mount into the shared caches, then validate the tree.
 *  Synchronous (uses the held mdRuntime), so a miss or a watcher change can drive
 *  it. Additive, like the JSON rescan: it refreshes/adds items but a full restart
 *  is what clears deletions. */
function loadMarkdownMount(mount) {
  if (!mdRuntime) return;
  const { readTree, validateTree, schema } = mdRuntime;
  const { mountPath, dirPath } = mount;
  const { items, blobFiles } = readTree(dirPath);
  const urlFor = (p) => (mountPath === '/' ? p : mountPath + (p === '/' ? '' : p));
  for (const [p, item] of items) {
    const urlPath = urlFor(p);
    item['@id'] = urlPath;
    markdownItems.set(urlPath, item);
    contentDirMap[urlPath] = { dirPath, markdown: true };
    if (item.UID) {
      uidToPathMap[item.UID] = urlPath;
      if (item.getObjPositionInParent !== undefined) uidPositionMap[item.UID] = item.getObjPositionInParent;
    }
  }
  for (const [p, file] of blobFiles) markdownBlobs.set(urlFor(p), file);
  console.log(`Registered ${items.size} markdown items from ${dirPath} at ${mountPath}`);
  // Content validation over the whole loaded tree: blocks_layout integrity, schema
  // type-check, and cross-tree references. Loud but non-fatal so a --watch restart
  // (or a reload) surfaces a problem while developing, not at test time.
  if (process.env.SKIP_CONTENT_VALIDATION !== 'true') {
    const problems = validateTree(markdownItems, { schema });
    if (problems.length) {
      console.log(`[content-check] ${problems.length} problem(s) in markdown content:`);
      for (const m of problems.slice(0, 30)) console.log(`  ${m}`);
    }
  }
}

/** Reload one mount, format-agnostically -- the ContentSource.reload() seam that
 *  both the watcher and the cache-miss path call, so neither is JSON-specific. */
function reloadMount(mount) {
  if (isMarkdownMount(mount)) { loadMarkdownMount(mount); return; }
  if (mount.mountPath !== '/' && fs.existsSync(path.join(mount.dirPath, 'data.json'))) {
    contentDirMap[mount.mountPath] = { dirPath: mount.dirPath, dirName: path.basename(mount.dirPath) };
  }
  scanContentDir(mount.dirPath, mount.mountPath);
}

/** Import the ESM loaders once, hold them, and load every markdown mount. */
async function initMarkdownMounts() {
  const mounts = CONTENT_MOUNTS.filter(isMarkdownMount);
  if (!mounts.length) return;
  const { readTree } = await import('../../lib/markdown-mount.mjs');
  const { validateTree } = await import('../../lib/content-validator.mjs');
  const { sharedBlocksConfig } = await import('./shared-block-schemas.js');
  const { allBlocksConfig } = await import('./core-block-schemas.js');
  mdRuntime = { readTree, validateTree, schema: allBlocksConfig(sharedBlocksConfig) };
  for (const mount of mounts) loadMarkdownMount(mount);
}

// Scan content directories on startup (content loaded on-demand)
function initContentDirMap() {
  CONTENT_MOUNTS.forEach(({ mountPath, dirPath }) => {
    // Register the mount point itself if it has a root data.json (e.g., /_test_data folder page).
    // The '/' mount is handled via plone_site_root inside scanContentDir.
    if (mountPath !== '/') {
      const rootDataPath = path.join(dirPath, 'data.json');
      if (fs.existsSync(rootDataPath)) {
        contentDirMap[mountPath] = { dirPath, dirName: path.basename(dirPath) };
        console.log(`Registered content: ${mountPath}`);
      }
    }
    scanContentDir(dirPath, mountPath);
  });
  console.log(`Registered ${Object.keys(contentDirMap).length} content paths`);
}

// Initialize on startup
initContentDirMap();
// Markdown mounts need a dynamic import, so loading them is async. Anything
// that serves requests must await `ready` first, or the first request can
// arrive before the tree is in memory.
ready = initMarkdownMounts();

// Watch content mounts for additions/deletions/modifications and rebuild
// contentDirMap. node --watch only restarts the JS process on .cjs edits —
// new fixture directories aren't reliably detected, so listings and other
// catalog queries would miss fresh content until restart. fs.watch with
// recursive:true covers macOS + Windows; Linux falls back to no-op (tests
// fixtures only see live additions during local dev, not CI).
function setupContentWatchers() {
  const debounceMs = 100;
  let timer = null;
  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // Reload every mount through the format-agnostic seam -- markdown trees
      // reload and re-validate too, not just the JSON contentDirMap.
      for (const mount of CONTENT_MOUNTS) reloadMount(mount);
    }, debounceMs);
  };
  for (const { dirPath } of CONTENT_MOUNTS) {
    if (!fs.existsSync(dirPath)) continue;
    try {
      fs.watch(dirPath, { recursive: true, persistent: false }, onChange);
      console.log(`Watching content dir: ${dirPath}`);
    } catch (err) {
      // Linux doesn't support recursive — let it throw so the missing
      // support is visible rather than silently degrading.
      throw err;
    }
  }
}
setupContentWatchers();

/**
 * Get content for a path
 * Checks: session uploads -> disk content -> generated site root
 * @param {string} urlPath - Content path
 * @param {string} sessionId - Session ID for session-specific uploads
 */
function getContent(urlPath, sessionId, expandList = []) {
  // A path deleted in this session is gone for this session, even if disk
  // content still backs it.
  if (sessionId && sessionDeletions[sessionId]?.has(urlPath)) {
    return null;
  }
  // Check session-specific storage first (for content created in this session).
  if (sessionId && sessionContent[sessionId]) {
    const store = sessionContent[sessionId];
    let stored = store[urlPath];
    // A reader may address session-created content under the /_test_data test-content
    // mount even though it was created under a bare path (e.g. the admin's templatesPath
    // "/templates/x" while the frontend fetches "/_test_data/templates/x"). Un-prefix a
    // missed /_test_data path so created content is served in-session either way. Strip
    // ONLY (never add a prefix) so this can't shadow bare disk content.
    if (!stored && urlPath.startsWith('/_test_data')) {
      stored = store[urlPath.slice('/_test_data'.length) || '/'];
    }
    if (stored) {
      // Session content may be stored raw (POST handlers) or already-enriched
      // (legacy callers that built full responses inline). Re-enrich
      // unconditionally so the read-time @components reflect the current
      // request's ?expand= choices, like Plone does.
      const baseUrl = `http://localhost:${PORT}`;
      return enrichContent(stored, urlPath, baseUrl, expandList);
    }
  }

  // Try disk first (distribution content may have a site root)
  const diskContent = loadContentFromDisk(urlPath, expandList);
  if (diskContent) return diskContent;

  // Fall back to generated site root
  if (urlPath === '/') {
    return getSiteRoot();
  }

  return null;
}

/**
 * POST /@login-renew
 * Renew/validate existing JWT token - generates fresh token each time
 */
app.post('/@login-renew', (req, res) => {
  if (process.env.DEBUG) {
    console.log('Token renewal requested');
  }

  // Generate fresh token with new expiration
  res.json({
    token: generateAuthToken('admin'),
    user: {
      '@id': `http://localhost:${PORT}/@users/admin`,
      id: 'admin',
      fullname: 'Admin User',
      email: 'admin@example.com',
      roles: ['Manager', 'Authenticated'],
    },
  });
});

/**
 * POST /@login
 * Authenticate and return JWT token with user info - generates fresh token each time
 */
app.post('/@login', (req, res) => {
  const { login, password } = req.body;

  if (process.env.DEBUG) {
    console.log(`Login attempt - username: ${login}, password: ${password ? '***' : 'missing'}`);
  }

  if (login && password) {
    // Generate fresh token with new expiration
    const token = generateAuthToken(login);
    const response = {
      token,
      user: {
        '@id': `http://localhost:${PORT}/@users/${login}`,
        id: login,
        fullname: 'Admin User',
        email: 'admin@example.com',
        roles: ['Manager', 'Authenticated'],
      },
    };

    if (process.env.DEBUG) {
      console.log(`Login successful, returning token: ${token.substring(0, 20)}...`);
      console.log(`Response body:`, JSON.stringify(response));
    }

    res.json(response);
  } else {
    if (process.env.DEBUG) {
      console.log(`Login failed - missing credentials`);
    }

    res.status(401).json({
      error: {
        type: 'Invalid',
        message: 'Login and password required',
      },
    });
  }
});

/**
 * POST /@logout
 * Logout and invalidate the session (mock - always succeeds)
 */
app.post('/@logout', (req, res) => {
  if (process.env.DEBUG) {
    console.log('Logout requested');
  }
  // Return 204 No Content on successful logout (Plone behavior)
  res.status(204).send();
});

/**
 * POST /:target/@move — relocate content into this container.
 *
 * plone.restapi posts to the TARGET folder with the source in the body. The
 * mock keeps disk content immutable and shared, so a move is recorded as a
 * session relocation: the subtree reads from its new path and 404s at the old
 * one, for the calling session only.
 */
app.post('*/@move', (req, res) => {
  const targetPath = req.path.replace('/@move', '') || '/';
  const sessionId = getSessionId(req);
  const sources = normaliseSources(req.body?.source);
  if (sources.length === 0) {
    return res.status(400).json({
      error: { type: 'BadRequest', message: '@move requires a source' },
    });
  }

  const results = [];
  for (const sourcePath of sources) {
  const source = getContent(sourcePath, sessionId);
  if (!source) {
    return res.status(404).json({
      error: { type: 'NotFound', message: `No such resource: ${sourcePath}` },
    });
  }
  if (targetPath === sourcePath || targetPath.startsWith(`${sourcePath}/`)) {
    return res.status(400).json({
      error: {
        type: 'BadRequest',
        message: 'Cannot move a document inside itself',
      },
    });
  }

  const id = sourcePath.split('/').filter(Boolean).pop();
  const destPath = `${targetPath === '/' ? '' : targetPath}/${id}`;

  // Relocate the whole subtree: every descendant path moves with its parent,
  // exactly as a real move does. Anything else silently orphans children.
  const everyPath = new Set([
    ...Object.keys(contentDirMap),
    ...Object.keys(sessionContent[sessionId] || {}),
  ]);
  for (const p of everyPath) {
    if (p !== sourcePath && !p.startsWith(`${sourcePath}/`)) continue;
    const moved = getContent(p, sessionId);
    if (!moved) continue;
    const suffix = p.slice(sourcePath.length);
    const raw = JSON.parse(JSON.stringify(moved));
    delete raw['@components'];
    setSessionContent(sessionId, `${destPath}${suffix}`, raw);
    if (!sessionDeletions[sessionId]) sessionDeletions[sessionId] = new Set();
    sessionDeletions[sessionId].add(p);
    if (raw.UID) uidToPathMap[raw.UID] = `${destPath}${suffix}`;
  }

  results.push({ source: sourcePath, target: destPath });
  }

  return res.json(results);
});

/**
 * POST /:parent/@order — reorder a child within its container.
 */
/**
 * POST /:target/@copy — duplicate content into this container.
 *
 * Same shape as @move, but the source stays put and the copy gets a fresh UID
 * so it is a genuinely distinct document rather than a second path onto one.
 */
app.post('*/@copy', (req, res) => {
  const targetPath = req.path.replace('/@copy', '') || '/';
  const sessionId = getSessionId(req);
  const sources = normaliseSources(req.body?.source);
  if (sources.length === 0) {
    return res.status(400).json({
      error: { type: 'BadRequest', message: '@copy requires a source' },
    });
  }
  const sourcePath = sources[0];
  const source = getContent(sourcePath, sessionId);
  if (!source) {
    return res.status(404).json({
      error: { type: 'NotFound', message: `No such resource: ${sourcePath}` },
    });
  }
  const id = sourcePath.split('/').filter(Boolean).pop();
  const destPath = `${targetPath === '/' ? '' : targetPath}/${id}`;
  const raw = JSON.parse(JSON.stringify(source));
  delete raw['@components'];
  raw.UID = `${raw.UID || id}-copy-${Object.keys(sessionContent[sessionId] || {}).length}`;
  setSessionContent(sessionId, destPath, raw);
  uidToPathMap[raw.UID] = destPath;
  return res.json([{ source: sourcePath, target: destPath }]);
});

app.post('*/@order', (req, res) => {
  const parentPath = req.path.replace('/@order', '') || '/';
  const sessionId = getSessionId(req);
  const { obj_id: objId, delta } = req.body || {};
  if (!objId) {
    return res.status(400).json({
      error: { type: 'BadRequest', message: '@order requires obj_id' },
    });
  }
  if (!sessionOrder[sessionId]) sessionOrder[sessionId] = {};
  const current = sessionOrder[sessionId][parentPath] || [];
  const without = current.filter((entry) => entry !== objId);
  const index = delta === 'top' ? 0 : Math.max(0, without.length);
  without.splice(index, 0, objId);
  sessionOrder[sessionId][parentPath] = without;
  return res.status(204).send();
});

/**
 * DELETE /:path (content removal)
 *
 * Drops session-created content outright and tombstones disk-backed content
 * so it reads as gone for the calling session. Plone answers 204 with no body.
 */
app.delete('/*', (req, res, next) => {
  // Special endpoints (e.g. */@lock) have their own handlers.
  if (req.path.startsWith('/@') || req.path.includes('/@')) {
    return next();
  }

  const sessionId = getSessionId(req);
  const urlPath = req.path.replace(/\/$/, '') || '/';

  if (getContent(urlPath, sessionId) === null) {
    return res.status(404).json({
      error: { type: 'NotFound', message: `No such resource: ${urlPath}` },
    });
  }

  if (sessionContent[sessionId]) {
    delete sessionContent[sessionId][urlPath];
  }
  if (!sessionDeletions[sessionId]) {
    sessionDeletions[sessionId] = new Set();
  }
  sessionDeletions[sessionId].add(urlPath);

  return res.status(204).send();
});

/**
 * POST /:path (content creation)
 * Create new content (e.g., Image upload)
 * Used by ImageWidget for file uploads
 */
app.post('/*', (req, res, next) => {
  // Skip special endpoints (already handled above or below)
  if (req.path.startsWith('/@') || req.path.includes('/@')) {
    return next();
  }

  if (process.env.DEBUG) {
    console.log(`POST content creation: path=${req.path}, @type=${req.body?.['@type']}`);
  }

  const body = req.body;
  if (!body || !body['@type']) {
    // No @type means this isn't a content creation request - pass to next handler
    return next();
  }

  const parentPath = req.path || '/';
  const contentType = body['@type'];

  if (contentType === 'Image') {
    // Return error for test trigger filename
    if (body.image?.filename === 'trigger-error.png') {
      return res.status(500).json({
        error: {
          type: 'InternalServerError',
          message: 'Upload failed: simulated server error',
        },
      });
    }

    // Generate a unique ID for the uploaded image
    const imageId = `uploaded-image-${Date.now()}`;
    const imagePath = `${parentPath === '/' ? '' : parentPath}/${imageId}`.replace(/\/+/g, '/');

    // Extract image dimensions from data if possible, otherwise use defaults
    const width = 800;
    const height = 600;

    // Create the image content
    const imageContent = {
      '@id': `http://localhost:${PORT}${imagePath}`,
      '@type': 'Image',
      'UID': `uid-${imageId}`,
      'id': imageId,
      'title': body.title || 'Uploaded Image',
      'description': body.description || '',
      'image': {
        'content-type': body.image?.['content-type'] || 'image/png',
        'download': `http://localhost:${PORT}${imagePath}/@@images/image`,
        'filename': body.image?.filename || 'image.png',
        'height': height,
        'width': width,
        'scales': {
          'preview': {
            'download': `http://localhost:${PORT}${imagePath}/@@images/image/preview`,
            'height': 400,
            'width': 400,
          },
          'large': {
            'download': `http://localhost:${PORT}${imagePath}/@@images/image/large`,
            'height': 800,
            'width': 800,
          },
        },
        'size': body.image?.data?.length || 1000,
      },
      'image_scales': {
        'image': [{
          'content-type': body.image?.['content-type'] || 'image/png',
          'download': `@@images/image-${width}-hash.${body.image?.['content-type']?.split('/')[1] || 'png'}`,
          'filename': body.image?.filename || 'image.png',
          'height': height,
          'width': width,
          'scales': {
            'preview': {
              'download': `@@images/image-400-hash.${body.image?.['content-type']?.split('/')[1] || 'png'}`,
              'height': 400,
              'width': 400,
            },
          },
        }],
      },
      'review_state': 'published',
    };

    // Store in session-specific storage (or global if no session)
    const sessionId = getSessionId(req);
    setSessionContent(sessionId, imagePath, imageContent);

    // Keep the bytes so @@images can serve back the scale URLs this response
    // advertises. Session-scoped, like the content itself.
    if (body.image?.data) {
      sessionBlobs[`${sessionId}:${imagePath}:image`] = {
        buffer: Buffer.from(body.image.data, body.image.encoding || 'base64'),
        mime: body.image['content-type'] || 'image/png',
      };
    }

    if (process.env.DEBUG) {
      console.log(`Created Image: ${imagePath}${sessionId ? ` (session: ${sessionId})` : ''}`);
    }

    return res.status(201).json(imageContent);
  }

  if (contentType === 'File') {
    // Non-image upload (object-browser folder upload). Id is derived from the
    // filename, matching real Plone, so callers can link to a named file.
    const rawName = body.file?.filename || body.title || 'file';
    const fileId =
      body.id ||
      rawName
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const filePath = `${parentPath === '/' ? '' : parentPath}/${fileId}`.replace(/\/+/g, '/');
    const fileContent = {
      '@id': `http://localhost:${PORT}${filePath}`,
      '@type': 'File',
      'UID': `uid-${fileId}`,
      'id': fileId,
      'title': body.title || rawName,
      'description': body.description || '',
      'file': {
        'content-type': body.file?.['content-type'] || 'application/octet-stream',
        'download': `http://localhost:${PORT}${filePath}/@@download/file`,
        'filename': body.file?.filename || rawName,
        'size': body.file?.data?.length || 0,
      },
      'review_state': 'published',
    };

    const sessionId = getSessionId(req);
    setSessionContent(sessionId, filePath, fileContent);

    if (process.env.DEBUG) {
      console.log(`Created File: ${filePath}${sessionId ? ` (session: ${sessionId})` : ''}`);
    }

    return res.status(201).json(fileContent);
  }

  if (contentType === 'Document') {
    // Plone populates server-side fields (UID, created, modified,
    // effective, review_state, etc.) on create — the client only sends
    // title, blocks, blocks_layout (and an optional id, e.g. for
    // templates that want a stable path). Match real Plone's response
    // shape so Volto can transition straight from Add → Edit on the
    // POST response without re-fetching: store the bare doc, then
    // serialize through enrichContent so the response carries
    // @components / is_folderish / parent / items / etc., same as a
    // GET on the same path would.
    const id = body.id || `untitled-document-${Date.now()}`;
    const docPath = `${parentPath === '/' ? '' : parentPath}/${id}`.replace(/\/+/g, '/');
    const now = new Date().toISOString();
    const baseUrl = `http://localhost:${PORT}`;
    const rawDoc = {
      '@type': 'Document',
      id,
      title: body.title || id,
      description: body.description || '',
      blocks: body.blocks || {},
      blocks_layout: body.blocks_layout || { items: [] },
      created: now,
      modified: now,
      effective: now,
      review_state: 'published',
    };

    const sessionId = getSessionId(req);
    setSessionContent(sessionId, docPath, rawDoc);

    if (process.env.DEBUG) {
      console.log(`Created Document: ${docPath}${sessionId ? ` (session: ${sessionId})` : ''}`);
    }

    return res.status(201).json(enrichContent(rawDoc, docPath, baseUrl, parseExpand(req)));
  }

  if (contentType === 'Folder') {
    // Folder is a container without blocks — used to exercise the Hydra
    // Add-shadow's type-aware post-create redirect: types without the
    // volto.blocks behavior should land on the canonical view, not
    // /edit. Same response shape as Document so Volto can transition
    // off the POST response.
    const id = body.id || `untitled-folder-${Date.now()}`;
    const folderPath = `${parentPath === '/' ? '' : parentPath}/${id}`.replace(/\/+/g, '/');
    const now = new Date().toISOString();
    const baseUrl = `http://localhost:${PORT}`;
    const rawFolder = {
      '@type': 'Folder',
      id,
      title: body.title || id,
      description: body.description || '',
      created: now,
      modified: now,
      effective: now,
      review_state: 'published',
    };

    const sessionId = getSessionId(req);
    setSessionContent(sessionId, folderPath, rawFolder);

    if (process.env.DEBUG) {
      console.log(`Created Folder: ${folderPath}${sessionId ? ` (session: ${sessionId})` : ''}`);
    }

    return res.status(201).json(enrichContent(rawFolder, folderPath, baseUrl, parseExpand(req)));
  }

  // Unsupported content type - return 501 instead of passing to next
  return res.status(501).json({ error: `Content type '${contentType}' not supported` });
});

/**
 * GET /health
 * Health check endpoint for server readiness
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Walk every registered content dir and collect unique `subjects` values
 * across all data.json files. Returns the `{ value: { title } }` shape
 * Plone's @querystring endpoint uses for the Subject (Keywords) index.
 */
function collectSubjectValues() {
  const subjects = new Set();
  for (const { dirPath } of Object.values(contentDirMap)) {
    const dataFile = path.join(dirPath, 'data.json');
    if (!fs.existsSync(dataFile)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      for (const s of (data.subjects || [])) {
        if (typeof s === 'string' && s) subjects.add(s);
      }
    } catch { /* ignore malformed data.json */ }
  }
  const out = {};
  for (const s of [...subjects].sort()) out[s] = { title: s };
  return out;
}

/**
 * GET /@querystring
 * Get querystring schema (available indexes, operators, sortable indexes)
 * Used by QuerystringWidget to populate criteria and sort dropdowns
 */
app.get('*/@querystring', (req, res) => {
  res.json({
    '@id': `http://localhost:${PORT}/@querystring`,
    'indexes': {
      'portal_type': {
        'title': 'Type',
        'description': 'Content type',
        'group': 'Metadata',
        'enabled': true,
        'sortable': false,
        // portal_type is a FieldIndex (one value per item) — real Plone
        // offers only .any / .none for it; .all is KeywordIndex-only.
        'operations': [
          'plone.app.querystring.operation.selection.any',
          'plone.app.querystring.operation.selection.none',
        ],
        'operators': {
          'plone.app.querystring.operation.selection.any': {
            'title': 'Matches any of',
            'description': 'Matches any of the selected values',
            'widget': 'MultipleSelectionWidget',
            'operation': 'plone.app.querystring.operation.selection.any',
          },
          'plone.app.querystring.operation.selection.none': {
            'title': 'Matches none of',
            'description': 'Matches none of the selected values',
            'widget': 'MultipleSelectionWidget',
            'operation': 'plone.app.querystring.operation.selection.none',
          },
        },
        'values': {
          'Document': { 'title': 'Page' },
          'News Item': { 'title': 'News Item' },
          'Event': { 'title': 'Event' },
          'Image': { 'title': 'Image' },
          'File': { 'title': 'File' },
          'Link': { 'title': 'Link' },
        },
      },
      'path': {
        'title': 'Location',
        'description': 'Location in the site structure',
        'group': 'Metadata',
        'enabled': true,
        'sortable': false,
        'operations': [
          'plone.app.querystring.operation.string.absolutePath',
          'plone.app.querystring.operation.string.relativePath',
        ],
        'operators': {
          'plone.app.querystring.operation.string.absolutePath': {
            'title': 'Absolute path',
            'description': 'Absolute path from site root',
            'widget': 'ReferenceWidget',
            'operation': 'plone.app.querystring.operation.string.absolutePath',
          },
          'plone.app.querystring.operation.string.relativePath': {
            'title': 'Relative path',
            'description': 'Relative to current location',
            'widget': 'ReferenceWidget',
            'operation': 'plone.app.querystring.operation.string.relativePath',
          },
        },
      },
      'review_state': {
        'title': 'Review state',
        'description': 'Workflow state',
        'group': 'Metadata',
        'enabled': true,
        'sortable': true,
        'operations': [
          'plone.app.querystring.operation.selection.any',
          'plone.app.querystring.operation.selection.none',
        ],
        'operators': {
          'plone.app.querystring.operation.selection.any': {
            'title': 'Matches any of',
            'widget': 'MultipleSelectionWidget',
            'operation': 'plone.app.querystring.operation.selection.any',
          },
          'plone.app.querystring.operation.selection.none': {
            'title': 'Matches none of',
            'widget': 'MultipleSelectionWidget',
            'operation': 'plone.app.querystring.operation.selection.none',
          },
        },
        'values': {
          'private': { 'title': 'Private' },
          'pending': { 'title': 'Pending' },
          'published': { 'title': 'Published' },
        },
      },
      'created': {
        'title': 'Creation date',
        'description': 'Date created',
        'group': 'Dates',
        'enabled': true,
        'sortable': true,
        'operations': [
          'plone.app.querystring.operation.date.lessThan',
          'plone.app.querystring.operation.date.largerThan',
          'plone.app.querystring.operation.date.between',
        ],
        'operators': {
          'plone.app.querystring.operation.date.lessThan': {
            'title': 'Before',
            'widget': 'DateWidget',
            'operation': 'plone.app.querystring.operation.date.lessThan',
          },
          'plone.app.querystring.operation.date.largerThan': {
            'title': 'After',
            'widget': 'DateWidget',
            'operation': 'plone.app.querystring.operation.date.largerThan',
          },
          'plone.app.querystring.operation.date.between': {
            'title': 'Between',
            'widget': 'DateRangeWidget',
            'operation': 'plone.app.querystring.operation.date.between',
          },
        },
      },
      'effective': {
        'title': 'Effective date',
        'description': 'Publication date',
        'group': 'Dates',
        'enabled': true,
        'sortable': true,
        'operations': [
          'plone.app.querystring.operation.date.lessThan',
          'plone.app.querystring.operation.date.largerThan',
        ],
        'operators': {
          'plone.app.querystring.operation.date.lessThan': {
            'title': 'Before',
            'widget': 'DateWidget',
            'operation': 'plone.app.querystring.operation.date.lessThan',
          },
          'plone.app.querystring.operation.date.largerThan': {
            'title': 'After',
            'widget': 'DateWidget',
            'operation': 'plone.app.querystring.operation.date.largerThan',
          },
        },
      },
      'modified': {
        'title': 'Modification date',
        'description': 'Date last modified',
        'group': 'Dates',
        'enabled': true,
        'sortable': true,
        'operations': [
          'plone.app.querystring.operation.date.lessThan',
          'plone.app.querystring.operation.date.largerThan',
        ],
        'operators': {
          'plone.app.querystring.operation.date.lessThan': {
            'title': 'Before',
            'widget': 'DateWidget',
            'operation': 'plone.app.querystring.operation.date.lessThan',
          },
          'plone.app.querystring.operation.date.largerThan': {
            'title': 'After',
            'widget': 'DateWidget',
            'operation': 'plone.app.querystring.operation.date.largerThan',
          },
        },
      },
      'Creator': {
        'title': 'Creator',
        'description': 'Content author',
        'group': 'Metadata',
        'enabled': true,
        'sortable': true,
        'operations': [
          'plone.app.querystring.operation.string.is',
        ],
        'operators': {
          'plone.app.querystring.operation.string.is': {
            'title': 'Is',
            'widget': null,
            'operation': 'plone.app.querystring.operation.string.is',
          },
        },
      },
      'Subject': {
        'title': 'Tag',
        'description': 'Subject/tag',
        'group': 'Text',
        'enabled': true,
        'sortable': false,
        'vocabulary': 'plone.app.vocabularies.Keywords',
        'operations': [
          'plone.app.querystring.operation.selection.any',
          'plone.app.querystring.operation.selection.all',
          'plone.app.querystring.operation.selection.none',
        ],
        'operators': {
          'plone.app.querystring.operation.selection.any': {
            'title': 'Matches any of',
            'widget': 'autocomplete',
            'operation': 'plone.app.querystring.operation.selection.any',
          },
          'plone.app.querystring.operation.selection.all': {
            'title': 'Matches all of',
            'widget': 'autocomplete',
            'operation': 'plone.app.querystring.operation.selection.all',
          },
          'plone.app.querystring.operation.selection.none': {
            'title': 'Matches none of',
            'widget': 'autocomplete',
            'operation': 'plone.app.querystring.operation.selection.none',
          },
        },
        'values': collectSubjectValues(),
      },
      'Title': {
        'title': 'Title',
        'description': 'Content title',
        'group': 'Text',
        'enabled': true,
        'sortable': true,
        'operations': [
          'plone.app.querystring.operation.string.contains',
        ],
        'operators': {
          'plone.app.querystring.operation.string.contains': {
            'title': 'Contains',
            'widget': null,
            'operation': 'plone.app.querystring.operation.string.contains',
          },
        },
      },
      'Description': {
        'title': 'Description',
        'description': 'Content description',
        'group': 'Text',
        'enabled': true,
        'sortable': false,
        'operations': [
          'plone.app.querystring.operation.string.contains',
        ],
        'operators': {
          'plone.app.querystring.operation.string.contains': {
            'title': 'Contains',
            'widget': null,
            'operation': 'plone.app.querystring.operation.string.contains',
          },
        },
      },
      'SearchableText': {
        'title': 'Searchable text',
        'description': 'All text content',
        'group': 'Text',
        'enabled': true,
        'sortable': false,
        'operations': [
          'plone.app.querystring.operation.string.contains',
        ],
        'operators': {
          'plone.app.querystring.operation.string.contains': {
            'title': 'Contains',
            'widget': null,
            'operation': 'plone.app.querystring.operation.string.contains',
          },
        },
      },
    },
    'sortable_indexes': {
      'effective': { 'title': 'Effective date', 'description': 'Publication date' },
      'created': { 'title': 'Creation date', 'description': 'Date created' },
      'modified': { 'title': 'Modification date', 'description': 'Date last modified' },
      'sortable_title': { 'title': 'Title', 'description': 'Title (sortable)' },
      'Creator': { 'title': 'Creator', 'description': 'Content author' },
      'review_state': { 'title': 'Review state', 'description': 'Workflow state' },
      // Position in the parent folder — used by navigation listings.
      // ploneFetchItems detects path+getObjPositionInParent and routes
      // the call to @navigation instead of @querystring-search.
      'getObjPositionInParent': { 'title': 'Position in parent', 'description': 'Order within parent folder (navigation order)' },
    },
  });
});

/**
 * GET /@site
 * Get site information
 */
app.get('/@site', (req, res) => {
  res.json({
    '@id': `http://localhost:${PORT}`,
    'plone.site_title': 'Plone Site',
    'plone.site_logo': null,
    // Volto 19 reads `plone.default_language` from this response as the
    // middle fallback in its SSR language-resolution chain
    // (server.jsx -> toBackendLang(initialLang)). Volto 18 used
    // `config.settings.defaultLanguage` instead — the source moved from
    // frontend config to backend response, so the mock has to provide it.
    'plone.default_language': 'en',
    'plone.available_languages': ['en'],
  });
});

/**
 * GET /@workflow
 * Get workflow information for site root
 */
app.get(/.*\/@workflow$/, (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@workflow$/, '') || '/').replace(/\/+$/, '') || '/';
  res.json(buildWorkflowComponent(cleanPath, `http://localhost:${PORT}`, getSessionId(req)));
});

/**
 * POST /:path/@workflow/:transition
 *
 * The body Plone accepts here is real, not invented — see
 * tests-adapters/fixtures/plone/workflow_post_with_body.req: comment,
 * effective, expires, include_children.
 */
app.post(/.*\/@workflow\/[^/]+$/, (req, res) => {
  const raw = req.path.replace('/++api++', '');
  const transitionId = raw.split('/').pop();
  const cleanPath = (raw.replace(/\/?@workflow\/[^/]+$/, '') || '/').replace(/\/+$/, '') || '/';
  const sessionId = getSessionId(req);

  const content = getContent(cleanPath, sessionId);
  if (!content) return res.status(404).json({ error: { type: 'NotFound' } });

  const from = content.review_state || 'published';
  const move = (SPW[from] ?? []).find((t) => t.id === transitionId);
  if (!move) {
    return res.status(400).json({
      error: { type: 'BadRequest', message: `Invalid transition '${transitionId}' from '${from}'` },
    });
  }

  const patch = { review_state: move.to };
  for (const field of ['effective', 'expires']) {
    if (req.body?.[field]) patch[field] = req.body[field];
  }
  setSessionContent(sessionId, cleanPath, { ...content, ...patch });

  res.json({
    action: transitionId,
    actor: 'admin',
    comments: req.body?.comment ?? '',
    review_state: move.to,
    title: STATE_TITLES[move.to] ?? move.to,
  });
});

app.post(/.*\/@workingcopy$/, (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@workingcopy$/, '') || '/').replace(/\/+$/, '') || '/';
  const sessionId = getSessionId(req);
  const content = getContent(cleanPath, sessionId);
  if (!content) return res.status(404).json({ error: { type: 'NotFound' } });

  const segments = cleanPath.split('/');
  const id = segments.pop();
  const copyPath = [...segments, `copy_of_${id}`].join('/') || '/';

  setSessionContent(sessionId, copyPath, { ...content, id: `copy_of_${id}` });
  if (!sessionWorkingCopies[sessionId]) sessionWorkingCopies[sessionId] = {};
  sessionWorkingCopies[sessionId][copyPath] = cleanPath;

  res.status(201).json({ '@id': `http://localhost:${PORT}${copyPath}` });
});

app.get(/.*\/@workingcopy$/, (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@workingcopy$/, '') || '/').replace(/\/+$/, '') || '/';
  const baseline = workingCopyOf(cleanPath, getSessionId(req));
  res.json({
    working_copy: null,
    working_copy_of: baseline ? { '@id': `http://localhost:${PORT}${baseline}` } : null,
  });
});

function endWorkingCopy(req, res) {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@workingcopy$/, '') || '/').replace(/\/+$/, '') || '/';
  const sessionId = getSessionId(req);
  const baseline = workingCopyOf(cleanPath, sessionId);
  if (!baseline) {
    return res.status(400).json({
      error: { type: 'BadRequest', message: 'Not a working copy' },
    });
  }
  delete sessionWorkingCopies[sessionId][cleanPath];

  // The copy stops existing. Applying it merges it into the baseline and
  // discarding it throws it away — either way there is no document left at
  // this path, and leaving one behind put a stray `copy_of_*` in every listing
  // for the rest of the session.
  if (sessionContent[sessionId]) delete sessionContent[sessionId][cleanPath];
  if (!sessionDeletions[sessionId]) sessionDeletions[sessionId] = new Set();
  sessionDeletions[sessionId].add(cleanPath);

  res.json({
    working_copy_of: { '@id': `http://localhost:${PORT}${baseline}` },
  });
}

app.patch(/.*\/@workingcopy$/, endWorkingCopy);
app.delete(/.*\/@workingcopy$/, endWorkingCopy);

app.get(/.*\/@sharing$/, (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@sharing$/, '') || '/').replace(/\/+$/, '') || '/';
  res.json(getSharing(cleanPath, getSessionId(req)));
});

app.post(/.*\/@sharing$/, (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@sharing$/, '') || '/').replace(/\/+$/, '') || '/';
  const sessionId = getSessionId(req);
  const current = getSharing(cleanPath, sessionId);

  const byId = new Map(current.entries.map((e) => [e.id, e]));
  for (const incoming of req.body?.entries ?? []) {
    const existing = byId.get(incoming.id);
    byId.set(incoming.id, {
      disabled: false,
      login: null,
      title: incoming.id,
      type: incoming.type ?? 'user',
      ...existing,
      id: incoming.id,
      roles: { ...noRoles(), ...(existing?.roles ?? {}), ...incoming.roles },
    });
  }

  if (!sessionSharing[sessionId]) sessionSharing[sessionId] = {};
  sessionSharing[sessionId][cleanPath] = {
    available_roles: AVAILABLE_ROLES,
    entries: [...byId.values()],
    inherit: req.body?.inherit ?? current.inherit,
  };
  res.status(204).end();
});

/**
 * GET /@users/:userid
 *
 * Matched with the /++api++ prefix optional, because every OTHER handler here
 * copes with it by stripping req.path and there is no middleware doing it
 * globally. Declared as an exact path, this was the one endpoint that answered
 * only WITHOUT the prefix — so an adapter, which prefixes every call, could
 * never identify its user. Adapter registration calls whoami first, so it died
 * there and took every test with it.
 */
app.get(/^(?:\/\+\+api\+\+)?\/@users\/([^/]+)$/, (req, res) => {
  // A regex, not a path pattern: `+` is a repeat modifier in Express's route
  // syntax, so '/++api++/...' is not a valid pattern at all.
  const userid = req.params[0];
  res.json({
    '@id': `http://localhost:${PORT}/@users/${userid}`,
    id: userid,
    fullname: 'Admin User',
    email: 'admin@example.com',
    roles: ['Manager', 'Authenticated'],
    username: userid,
  });
});

/**
 * GET /@types/:typeName
 * Get content type schema
 */
function getTypeSchema(typeName) {
  const schemaPath = path.join(
    __dirname,
    'api',
    `schema-${typeName.toLowerCase()}.json`
  );

  const baseSchemaPath = path.join(__dirname, 'api', 'schema-base.json');
  const base = fs.existsSync(baseSchemaPath)
    ? JSON.parse(fs.readFileSync(baseSchemaPath, 'utf-8'))
    : { properties: {}, fieldsets: [] };

  let schema;
  if (fs.existsSync(schemaPath)) {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  } else {
    // Return default Document schema
    schema = {
      title: typeName,
      properties: {
        title: {
          title: 'Title',
          type: 'string',
        },
        description: {
          title: 'Summary',
          type: 'string',
        },
        blocks: {
          title: 'Blocks',
          type: 'object',
        },
        blocks_layout: {
          title: 'Blocks Layout',
          type: 'object',
        },
      },
      required: ['title'],
      fieldsets: [
        {
          id: 'default',
          title: 'Default',
          fields: ['title', 'description'],
        },
      ],
    };
  }

  // Merge base schema fields (only add fields not already defined)
  schema.properties = { ...base.properties, ...schema.properties };
  const existingFieldsetIds = new Set((schema.fieldsets || []).map((f) => f.id));
  for (const fs_ of base.fieldsets || []) {
    if (!existingFieldsetIds.has(fs_.id)) {
      schema.fieldsets = [...(schema.fieldsets || []), fs_];
    }
  }

  return schema;
}

/**
 * True when this mock knows the type at all: either it ships a schema file or
 * it is one of the addable types. Real Plone 404s on an unknown type rather
 * than inventing a schema, and adapters have to be able to tell the
 * difference, so the fallback in getTypeSchema must not apply to made-up
 * names.
 */
function isKnownType(typeName) {
  const schemaPath = path.join(
    __dirname,
    'api',
    `schema-${typeName.toLowerCase()}.json`,
  );
  if (fs.existsSync(schemaPath)) return true;
  return listAddableTypes().some(
    (t) => t['@id'].split('/').pop() === typeName,
  );
}

app.get('/@types/:typeName', (req, res) => {
  const { typeName } = req.params;
  if (!isKnownType(typeName)) {
    return res.status(404).json({
      error: { type: 'NotFound', message: `No such content type: ${typeName}` },
    });
  }
  res.json(getTypeSchema(typeName));
});

/**
 * GET /@vocabularies/:vocab — minimal vocabulary endpoint. The example Search
 * Shortcuts block reads Keywords (Subject) unique values in site-wide mode.
 */
const VOCAB_ITEMS = {
  'plone.app.vocabularies.Keywords': ['news', 'plone', 'events'],
};

// Optional generated vocabularies, declared by a seed file and switched on
// with VOCAB_SPEC. Used by the adapter contract suite, which needs a
// vocabulary large enough that fetch-everything-and-filter-in-memory shows up
// as a latency failure. Off unless the env var is set, so nothing else here
// changes behaviour.
const GENERATED_VOCABS = {};
if (process.env.VOCAB_SPEC) {
  const specPath = path.resolve(process.cwd(), process.env.VOCAB_SPEC);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8')).vocabularies || {};
  const prefix = process.env.VOCAB_PREFIX || '';
  for (const [name, def] of Object.entries(spec)) {
    GENERATED_VOCABS[`${prefix}${name}`] = Array.from(
      { length: def.generate },
      (_, i) => ({
        token: `${def.tokenPrefix}${i}`,
        title: `${def.titlePrefix}${i}`,
      }),
    );
  }
  console.log(
    `Generated vocabularies: ${Object.entries(GENERATED_VOCABS)
      .map(([k, v]) => `${k} (${v.length})`)
      .join(', ')}`,
  );
}

app.get('/@vocabularies/:vocab', (req, res) => {
  const generated = GENERATED_VOCABS[req.params.vocab];
  if (generated) {
    // Real Plone filters and batches server-side; so must this, or the
    // contract suite's type-ahead latency assertion is meaningless.
    const title = req.query.title;
    const filtered = title
      ? generated.filter((i) => i.title.includes(title))
      : generated;
    const size = req.query.b_size ? parseInt(req.query.b_size, 10) : 25;
    const start = req.query.b_start ? parseInt(req.query.b_start, 10) : 0;
    return res.json({
      '@id': `http://localhost:${PORT}/@vocabularies/${req.params.vocab}`,
      items: filtered.slice(start, start + size),
      items_total: filtered.length,
    });
  }

  if (!VOCAB_ITEMS[req.params.vocab]) {
    return res.status(404).json({
      error: {
        type: 'NotFound',
        message: `No such vocabulary: ${req.params.vocab}`,
      },
    });
  }

  const values = VOCAB_ITEMS[req.params.vocab] || [];
  res.json({
    '@id': `http://localhost:${PORT}/@vocabularies/${req.params.vocab}`,
    items: values.map((v) => ({ token: v, title: v })),
    items_total: values.length,
  });
});

/**
 * GET /rss-stub — canned RSS feed for the RSS Feed example block (the block's
 * feedUrl points here; same-origin so the client-side fetch succeeds).
 */
app.get('/rss-stub', (req, res) => {
  res.type('application/xml').send(
    `<?xml version="1.0"?><rss version="2.0"><channel><title>Stub Feed</title>` +
      `<item><title>Feed One</title><link>http://feed.test/1</link><description>First entry</description><pubDate>Mon, 05 Jan 2026 00:00:00 GMT</pubDate></item>` +
      `<item><title>Feed Two</title><link>http://feed.test/2</link><description>Second entry</description></item>` +
      `</channel></rss>`,
  );
});

/**
 * GET /@types  (and GET /<folder>/@types)
 * List addable content types for the current container. Volto's toolbar
 * Add button reads this to populate the type-picker menu — without it the
 * button is hidden (Toolbar.jsx requires types.length > 0).
 *
 * Returns just Document for now; extend if a test needs Folder/News Item.
 */
function listAddableTypes() {
  return [
    {
      '@id': `http://localhost:${PORT}/@types/Document`,
      addable: true,
      title: 'Page',
    },
    {
      '@id': `http://localhost:${PORT}/@types/Folder`,
      addable: true,
      title: 'Folder',
    },
  ];
}

app.get('/@types', (req, res) => {
  res.json(listAddableTypes());
});
app.get('*/@types', (req, res) => {
  res.json(listAddableTypes());
});

/**
 * GET /:path/@types/:typeName
 * Get content type schema for a specific content path
 */
app.get('*/@types/:typeName', (req, res) => {
  const { typeName } = req.params;
  res.json(getTypeSchema(typeName));
});

/**
 * GET /:path/@breadcrumbs
 * Get breadcrumb trail
 */
app.get('*/@breadcrumbs', (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@breadcrumbs$/, '') || '/').replace(/\/+$/, '') || '/';
  res.json(buildBreadcrumbsComponent(cleanPath, `http://localhost:${PORT}`));
});

/**
 * GET /:path/@actions
 * Get available actions for content (Edit, View, etc.)
 * Use regex to ensure matching with ++api++ prefix
 */
app.get(/.*\/@actions$/, (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@actions$/, '') || '/').replace(/\/+$/, '') || '/';
  res.json(buildActionsComponent(cleanPath, `http://localhost:${PORT}`, getSessionId(req)));
});

/**
 * GET /<path>/@navigation, /<path>/@navroot — sibling components reachable
 * via the @id stubs that @components emits when not in ?expand=. Same
 * builders feed the inline expansion path.
 */
app.get(/.*\/@navigation$/, (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@navigation$/, '') || '/').replace(/\/+$/, '') || '/';
  const baseUrl = `http://localhost:${PORT}`;
  // Real Plone honors `?expand.navigation.depth=N` and
  // `?expand.navigation.root_path=/some/path`. Default: rooted at site
  // root, depth 1 (matches the existing buildNavigationComponent behavior).
  const depthParam = req.query['expand.navigation.depth'];
  const rootPathParam = req.query['expand.navigation.root_path'];
  if (depthParam !== undefined || rootPathParam !== undefined) {
    const depth = depthParam !== undefined ? parseInt(depthParam, 10) : 1;
    const rootPath = rootPathParam || '/';
    res.json({
      '@id': `${baseUrl}${cleanPath}/@navigation`,
      items: getNavigationItems(rootPath, depth, baseUrl, getSessionId(req)),
    });
    return;
  }
  res.json(buildNavigationComponent(cleanPath, baseUrl, getSessionId(req)));
});

app.get(/.*\/@navroot$/, (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@navroot$/, '') || '/').replace(/\/+$/, '') || '/';
  res.json(buildNavrootComponent(cleanPath, `http://localhost:${PORT}`));
});

/**
 * GET /@aliases or /:path/@aliases
 * plone.app.redirector aliases (manual redirects). On the site root the
 * response lists every alias; on a context it filters to aliases that
 * target that context (path or descendant), matching plone.restapi's
 * `@aliases` GET behavior in Plone 6.2.
 */
app.get(/.*\/@aliases$/, (req, res) => {
  const cleanPath = (req.path.replace('/++api++', '').replace(/\/?@aliases$/, '') || '/').replace(/\/+$/, '') || '/';
  const baseUrl = `http://localhost:${PORT}`;
  const all = getAllRedirects();
  const items = cleanPath === '/'
    ? all
    : all.filter((a) => a['redirect-to'] === cleanPath || a['redirect-to'].startsWith(cleanPath + '/'));
  res.json({
    '@id': `${baseUrl}${cleanPath === '/' ? '' : cleanPath}/@aliases`,
    items,
    items_total: items.length,
  });
});

/**
 * POST /@querystring-search
 * Search for content using Volto's querystring format.
 * Used by listing blocks to fetch query results.
 *
 * Request body:
 * {
 *   query: [{ i: 'portal_type', o: 'plone.app.querystring.operation.selection.any', v: ['Document'] }],
 *   sort_on: 'effective',
 *   sort_order: 'descending',
 *   b_start: 0,
 *   b_size: 10,
 *   metadata_fields: '_all'
 * }
 */
app.post('*/@querystring-search', (req, res) => {
  const contextPath = req.path.replace('/++api++/@querystring-search', '').replace('/@querystring-search', '');
  const baseUrl = `http://localhost:${PORT}`;

  const { query = [], sort_on, sort_order, b_start = 0, b_size = 10, limit } = req.body;
  console.log('[MOCK-API] @querystring-search query:', JSON.stringify(query));

  // Extract the "root" path from the path criteria so depth (below) can
  // compute "how far below root is this item". Real Plone applies depth
  // relative to each path criterion; for our use we only support one path
  // criterion at a time — which matches sectionNav's listing config.
  // Resolve `..` / `.` segments in a path the way real Plone does for relativePath.
  const resolveRelativePath = (base, rel) => {
    const segs = (base + '/' + rel).split('/').filter(Boolean);
    const stack = [];
    for (const seg of segs) {
      if (seg === '.') continue;
      if (seg === '..') stack.pop();
      else stack.push(seg);
    }
    return '/' + stack.join('/');
  };

  // Plone encodes path-criterion depth in the criterion VALUE as
  // `path::depth` (e.g. `/docs/examples::1`, `.::2`). A bare path is a
  // recursive query. The top-level `depth` field on the request body is
  // NOT honoured by Plone's @querystring-search — verified against
  // demo.plone.org — so it is deliberately ignored here.
  const splitPathDepth = (v) => {
    const s = typeof v === 'string' ? v : '';
    const sep = s.indexOf('::');
    if (sep === -1) return { path: s, depth: null };
    const n = parseInt(s.slice(sep + 2), 10);
    return { path: s.slice(0, sep), depth: Number.isNaN(n) ? null : n };
  };

  let depthRoot = null;
  let pathDepth = null;
  for (const cond of query) {
    if (cond.i !== 'path') continue;
    const { path: pathV, depth: critDepth } = splitPathDepth(cond.v);
    if (critDepth !== null) pathDepth = critDepth;
    if (cond.o.includes('absolutePath')) {
      depthRoot = pathV;
    } else if (cond.o.includes('relativePath')) {
      let rel = pathV;
      if (rel === '.' || rel === '') rel = '';
      depthRoot = rel ? resolveRelativePath(contextPath, rel) : contextPath;
    }
  }

  // Get all content items using raw content (no enrichment needed for search).
  // loadContentFromDisk enriches every item (resolveuid, image scales, components)
  // which is extremely slow with 70+ items. Search results only need basic fields.
  let allItems = Object.keys(contentDirMap)
    .filter((itemPath) => itemPath !== '/')
    .map((itemPath) => {
      const raw = loadRawContentFromDisk(itemPath);
      if (!raw) return null;
      // Add @id and UID like enrichContent would, but skip expensive processing
      return {
        ...raw,
        '@id': `${baseUrl}${itemPath}`,
        UID: raw.UID || `${raw.id || itemPath.split('/').pop()}-uid`,
        id: raw.id || itemPath.split('/').pop(),
      };
    })
    .filter((content) => content !== null);

  // Apply query filters
  // plone.app.querystring `selection.*` operations apply by index TYPE,
  // not index name: FieldIndexes (portal_type, review_state — one value
  // per item) and KeywordIndexes (Subject — a list per item) share the
  // same .any/.all/.none semantics. selectionFields maps each index to
  // the item value(s) the operation compares against, so the single
  // handler below covers them all instead of per-index branches that drift.
  const selectionFields = {
    portal_type: (item) => [item['@type']],
    review_state: (item) => [item.review_state || 'published'],
    // Items here come from loadRawContentFromDisk — the raw content schema
    // field is lowercase `subjects`. The catalog index name `Subject`
    // (capital S) is only added later by formatSearchItem. Read both so
    // this works whether the filter runs on raw or brain-formatted items.
    Subject: (item) => item.subjects || item.Subject || [],
  };

  for (const condition of query) {
    const { i: index, o: operation } = condition;
    // For path criteria the value may carry a `::depth` suffix — strip it
    // for the path match (depth is applied separately, below).
    const value =
      index === 'path' ? splitPathDepth(condition.v).path : condition.v;

    if (operation.includes('selection')) {
      // Generic plone.app.querystring selection filter (see selectionFields):
      //   .all  — item has every wanted value (KeywordIndex only — a
      //           FieldIndex item has one value, so .all of 2+ matches none)
      //   .none — item has no wanted value (nav listings use this to drop
      //           Image/File from portal_type)
      //   .any  — item has at least one wanted value (default)
      const accessor = selectionFields[index];
      const wanted = Array.isArray(value) ? value : [value];
      if (!accessor) {
        console.warn(
          `[MOCK-API] @querystring-search: no selection mapping for index '${index}' — criterion ignored`,
        );
      } else if (operation.endsWith('.all')) {
        allItems = allItems.filter((item) =>
          wanted.every((w) => accessor(item).includes(w)),
        );
      } else if (operation.endsWith('.none')) {
        allItems = allItems.filter((item) =>
          !wanted.some((w) => accessor(item).includes(w)),
        );
      } else {
        allItems = allItems.filter((item) =>
          wanted.some((w) => accessor(item).includes(w)),
        );
      }
    } else if (index === 'path' && operation.includes('absolutePath')) {
      // Filter by path — strict descendants of basePath (exclude basePath
      // itself). The trailing '/' ensures `/foo` matches `/foo/bar` but
      // not `/foo` itself, and avoids `/foo` matching `/foobar`.
      const basePath = value || '/';
      if (basePath !== '/') {
        const prefix = basePath.endsWith('/') ? basePath : basePath + '/';
        allItems = allItems.filter((item) => {
          const itemPath = new URL(item['@id']).pathname;
          return itemPath.startsWith(prefix);
        });
      }
    } else if (index === 'path' && operation.includes('relativePath')) {
      // Filter by relative path from context.
      // '.' means current context, '..' means parent, etc.
      //
      // Plone quirk: relativePath EXCLUDES the current context page
      // itself from results. So a `..` query from /a/b returns
      // /a's strict descendants minus /a/b. That's a deliberate Plone
      // navigation convention ("don't list me in my own nav"). We
      // replicate it here so cnav rendering works the same under mock
      // as under prod — including exposing the missing-intermediate-
      // parent case that hierarchicalSortByPosition has to handle.
      let relValue = value || '';
      if (relValue === '.' || relValue === '') {
        relValue = '';
      }
      const fullPath = relValue ? resolveRelativePath(contextPath, relValue) : contextPath;
      if (fullPath !== '/') {
        allItems = allItems.filter((item) => {
          const itemPath = new URL(item['@id']).pathname;
          return itemPath.startsWith(fullPath + '/');
        });
      }
      allItems = allItems.filter((item) => new URL(item['@id']).pathname !== contextPath);
    } else if (index === 'SearchableText' && operation.includes('string.contains')) {
      // Full-text search across title/description/id. Mirrors Plone 6.2's
      // plone.app.querystring 3.0.0 wildcard-prefix behavior — each word in
      // the search term must prefix-match a word token in one of those fields.
      if (value) {
        allItems = allItems.filter((item) => matchSearchableText(value, item));
      }
    } else if (index === 'Title' && operation.includes('string.contains')) {
      // The Title index is its own catalog index, distinct from SearchableText.
      // Without this branch a Title criterion matched nothing in the chain and
      // was dropped, so the endpoint returned the whole collection and any
      // test asserting "the filter found something" passed without filtering.
      if (value) {
        allItems = allItems.filter((item) =>
          String(item.title ?? '')
            .toLowerCase()
            .includes(String(value).toLowerCase()),
        );
      }
    } else if (index === 'exclude_from_nav' && operation.includes('boolean')) {
      // Nav listings filter out items marked exclude_from_nav: true.
      // Mirrors Plone's plone.app.querystring.operation.boolean.{isFalse,isTrue}.
      const wantTrue = operation.includes('isTrue');
      allItems = allItems.filter((item) => {
        const flag = item.exclude_from_nav === true;
        return wantTrue ? flag : !flag;
      });
      // Note: `review_state` and `Subject` selection.{any,all,none} are
      // handled generically above via `selectionFields` (which already
      // maps both indices), so we don't need explicit branches here.
    } else {
      // Never drop a criterion quietly. An ignored filter returns the whole
      // collection, which looks exactly like a filter that matched everything
      // — the failure mode that hid the missing Title branch above.
      console.warn(
        `[MOCK-API] @querystring-search: unhandled criterion '${index}' ` +
          `with operation '${operation}' — returning unfiltered results`,
      );
    }
  }

  // Apply depth limit from the path criterion's `::depth` suffix (parsed
  // into pathDepth above). `path::1` under /docs returns /docs/foo but
  // not /docs/foo/bar; a bare path is recursive (no limit).
  if (typeof pathDepth === 'number' && depthRoot !== null) {
    const rootSegments = depthRoot.split('/').filter(Boolean).length;
    const maxSegments = rootSegments + pathDepth;
    allItems = allItems.filter((item) => {
      const itemSegments = new URL(item['@id']).pathname.split('/').filter(Boolean).length;
      return itemSegments <= maxSegments;
    });
  }

  // Sort items. Plone's `sort_order: descending` reverses the whole result
  // sequence — tied items included — so sort ascending and reverse the
  // array. Negating the comparator instead leaves ties in input order
  // (a stable sort treats -0 as 0), so descending != reverse(ascending).
  let comparator = null;
  if (sort_on === 'getObjPositionInParent') {
    // Folder order: use __metadata__.json ordering (UID→position),
    // falling back to contentDirMap key order (filesystem alphabetical).
    const allPaths = Object.keys(contentDirMap);
    comparator = (a, b) => {
      const aPos = a.UID ? uidPositionMap[a.UID] : undefined;
      const bPos = b.UID ? uidPositionMap[b.UID] : undefined;
      if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
      if (aPos !== undefined) return -1; // items with ordering come first
      if (bPos !== undefined) return 1;
      // Fallback to contentDirMap key order
      const aPath = new URL(a['@id']).pathname;
      const bPath = new URL(b['@id']).pathname;
      return allPaths.indexOf(aPath) - allPaths.indexOf(bPath);
    };
  } else if (sort_on) {
    comparator = (a, b) => {
      const aVal = a[sort_on] || '';
      const bVal = b[sort_on] || '';
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    };
  }
  if (comparator) {
    allItems.sort(comparator);
    if (sort_order === 'descending') allItems.reverse();
  }

  // Apply results limit (different from b_size which is for pagination)
  if (limit && limit > 0) {
    allItems = allItems.slice(0, limit);
  }

  const itemsTotal = allItems.length;

  // Apply paging
  const pagedItems = allItems.slice(b_start, b_start + b_size);

  // Format items for response
  const items = pagedItems.map((content) => formatSearchItem(content, baseUrl));

  const searchUrl = contextPath
    ? `${baseUrl}${contextPath}/@querystring-search`
    : `${baseUrl}/@querystring-search`;

  res.json({
    '@id': searchUrl,
    items,
    items_total: itemsTotal,
    batching: {
      '@id': searchUrl,
      first: `${searchUrl}?b_start=0`,
      last: `${searchUrl}?b_start=${Math.max(0, itemsTotal - b_size)}`,
      next: b_start + b_size < itemsTotal ? `${searchUrl}?b_start=${b_start + b_size}` : null,
      prev: b_start > 0 ? `${searchUrl}?b_start=${Math.max(0, b_start - b_size)}` : null,
    },
  });
});

/**
 * GET /@search or /:path/@search
 * Search for content (used by ObjectBrowser)
 * Supports path.depth parameter to get children of a specific path
 * Supports path.query parameter to get a specific content item
 */
app.get('*/@search', (req, res) => {
  const searchPath = req.path.replace('/@search', '');

  // UID lookup — the index behind resolveuid. Real Plone's catalog answers
  // this and reflects unsaved-elsewhere edits made in the same session, so it
  // must read through getContent (session first) rather than straight off
  // disk, or a renamed document keeps reporting its old title.
  if (req.query.UID) {
    const uidPath = uidToPathMap[req.query.UID];
    const found = uidPath
      ? getContent(uidPath, getSessionId(req))
      : null;
    return res.json({
      '@id': `http://localhost:${PORT}${searchPath}/@search`,
      items: found
        ? [formatSearchItem(found, `http://localhost:${PORT}`)]
        : [],
      items_total: found ? 1 : 0,
    });
  }

  const pathDepth = req.query['path.depth'];
  const pathQuery = req.query['path.query'];
  const searchableText = req.query['SearchableText'];
  const portalType = req.query['portal_type'];
  const baseUrl = `http://localhost:${PORT}`;

  let items;

  // Handle SearchableText (used by ObjectBrowser search input). Plone 6.2
  // (plone.app.querystring 3.0.0) appends a wildcard to each word and ANDs
  // the parts — matchSearchableText replicates that on title/description/id.
  if (searchableText) {
    items = Object.keys(contentDirMap)
      .filter((itemPath) => itemPath !== '/')
      .map((itemPath) => formatSearchItem(loadContentFromDisk(itemPath), baseUrl))
      .filter((item) => matchSearchableText(searchableText, item));
    // Filter by portal_type if specified
    if (portalType) {
      const types = Array.isArray(portalType) ? portalType : [portalType];
      items = items.filter((item) => types.includes(item['@type']));
    }
  }
  // Handle path.query with path.depth=0 (exact match for specific content)
  else
  if (pathQuery && pathDepth === '0') {
    const content = loadContentFromDisk(pathQuery);
    if (content) {
      items = [formatSearchItem(content, baseUrl)];
    } else {
      items = [];
    }
  } else if (pathDepth === '1') {
    // Get immediate children of the search path (used by ObjectBrowser)
    // Unlike navigation, search returns ALL content types (including Images, Files)
    const normalizedSearch = (searchPath === '' || searchPath === '/') ? '/' : searchPath;
    const searchDepth = normalizedSearch === '/' ? 0 : normalizedSearch.split('/').filter(Boolean).length;

    // Direct children, from disk AND from anything this session created or
    // moved here. Enumerating contentDirMap alone would miss a page that was
    // just pasted in and would keep listing one that was cut away, which is
    // precisely what the contents view is for.
    const sessionPaths = Object.keys(sessionContent[getSessionId(req)] || {});
    const candidates = new Set([...Object.keys(contentDirMap), ...sessionPaths]);
    items = [...candidates]
      .filter((itemPath) => {
        if (itemPath === '/') return false;
        if (itemPath === normalizedSearch) return false;
        // Must be under the search path
        if (normalizedSearch !== '/' && !itemPath.startsWith(normalizedSearch + '/')) return false;
        // Must be exactly one level deeper
        const itemParts = itemPath.split('/').filter(Boolean);
        return itemParts.length === searchDepth + 1;
      })
      .map((itemPath) => getContent(itemPath, getSessionId(req)))
      // A dir with no parseable data.json (e.g. `templates/`) loads as null —
      // skip it, don't crash formatSearchItem (same guard as the no-depth branch).
      .filter((content) => content != null)
      .map((content) => formatSearchItem(content, baseUrl));

    // Honour an explicit ordering set via @order for this container. Items not
    // named in it keep their natural position after the ones that are.
    const explicit = sessionOrder[getSessionId(req)]?.[normalizedSearch];
    if (explicit) {
      const rank = (item) => {
        const id = new URL(item['@id']).pathname.split('/').filter(Boolean).pop();
        const at = explicit.indexOf(id);
        return at === -1 ? explicit.length : at;
      };
      items.sort((a, b) => rank(a) - rank(b));
    }

    // For root searches, also include non-root mount points as virtual folders
    // so the object browser can navigate into them (e.g., _test_data)
    if (normalizedSearch === '/') {
      CONTENT_MOUNTS.forEach(({ mountPath }) => {
        if (mountPath === '/') return;
        const mountParts = mountPath.split('/').filter(Boolean);
        if (mountParts.length !== 1) return; // Only top-level mounts
        const mountName = mountParts[0];
        // Skip if already in contentDirMap (has its own data.json)
        if (contentDirMap[mountPath]) return;
        items.push({
          '@id': `${baseUrl}${mountPath}`,
          '@type': 'Folder',
          'id': mountName,
          'title': mountName.replace(/[_-]/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()),
          'description': '',
          'review_state': 'published',
          'UID': `virtual-mount-${mountName}`,
          'is_folderish': true,
          'hasPreviewImage': false,
          'image_field': null,
          'image_scales': null,
        });
      });
    }

    // For non-root paths not in contentDirMap (e.g. mount points like /_test_data),
    // check if any content exists under this path and list children
    if (items.length === 0 && normalizedSearch !== '/' && !contentDirMap[normalizedSearch]) {
      const hasChildren = Object.keys(contentDirMap).some(p => p.startsWith(normalizedSearch + '/'));
      if (hasChildren) {
        items = Object.keys(contentDirMap)
          .filter((itemPath) => {
            if (itemPath === normalizedSearch) return false;
            if (!itemPath.startsWith(normalizedSearch + '/')) return false;
            const itemParts = itemPath.split('/').filter(Boolean);
            return itemParts.length === searchDepth + 1;
          })
          .map((itemPath) => loadContentFromDisk(itemPath))
          .filter((content) => content != null)
          .map((content) => formatSearchItem(content, baseUrl));
      }
    }
  } else {
    // No depth filter - return all content items from disk.
    // Rescan so newly-added fixture directories surface without a server
    // restart — same "rescan on miss" pattern as resolveUidUrls() above.
    initContentDirMap();
    items = Object.keys(contentDirMap)
      .filter((itemPath) => itemPath !== '/')
      .map((itemPath) => loadContentFromDisk(itemPath))
      .filter((content) => content != null)  // skip dirs with no parseable data.json
      .map((content) => formatSearchItem(content, baseUrl));
  }

  // GET @search honours sort_on / sort_order, as the catalog does.
  //
  // It did not, so anything ordering a listing through this endpoint — the
  // contents view's "Rearrange by", above all — came back in whatever order
  // the items were assembled. Ascending and descending were byte-identical,
  // which is indistinguishable from a sort the ADMIN failed to send, and hid
  // the question of whether the admin sends it at all.
  //
  // getObjPositionInParent is the folder's own order, which is how the items
  // already arrive; every other index sorts on the metadata field of that
  // name, and sort_order: descending reverses the whole result, as in the
  // querystring-search handler above.
  const sortOn = req.query.sort_on;
  if (sortOn && sortOn !== 'getObjPositionInParent') {
    items = [...items].sort((a, b) => {
      const x = a[sortOn] ?? '';
      const y = b[sortOn] ?? '';
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
    });
  }
  if (req.query.sort_order === 'descending' || req.query.sort_order === 'reverse') {
    items = [...items].reverse();
  }

  const searchUrl = searchPath === '' || searchPath === '/'
    ? `http://localhost:${PORT}/@search`
    : `http://localhost:${PORT}${searchPath}/@search`;

  res.json({
    '@id': searchUrl,
    'items': items,
    'items_total': items.length,
    'batching': {
      '@id': searchUrl,
      'first': `${searchUrl}?b_start=0`,
      'last': `${searchUrl}?b_start=0`,
      'next': null,
      'prev': null,
    },
  });
});

/**
 * GET /:path/@contents or /@contents
 * Get folder contents for content browsing
 * Returns items at the parent folder level (siblings of current content)
 */
app.get('*/@contents', (req, res) => {
  const contentPath = req.path.replace('/@contents', '') || '/';

  // Helper to format content item for response
  const formatItem = (itemPath) => {
    const content = loadContentFromDisk(itemPath);
    if (!content) return null;
    return {
      '@id': content['@id'],
      '@type': content['@type'],
      'id': content.id,
      'title': content.title,
      'description': content.description || '',
      'review_state': content.review_state || 'published',
      'UID': content.UID,
      'is_folderish': content.is_folderish !== undefined ? content.is_folderish : true,
    };
  };

  // For Documents, we return siblings (contents of parent folder)
  // For the site root, we return all root-level items
  let items;

  if (contentPath === '' || contentPath === '/') {
    // Root level - return all root-level items
    items = Object.keys(contentDirMap)
      .filter((itemPath) => {
        if (itemPath === '/') return false;
        const pathParts = itemPath.split('/').filter(p => p);
        return pathParts.length === 1;
      })
      .map(formatItem)
      .filter(Boolean);
  } else {
    // Get parent folder's contents (siblings of this content)
    const pathParts = contentPath.split('/').filter(p => p);
    const parentPath = pathParts.length > 1
      ? '/' + pathParts.slice(0, -1).join('/')
      : '/';

    items = Object.keys(contentDirMap)
      .filter((itemPath) => {
        if (itemPath === '/') return false;
        const itemParts = itemPath.split('/').filter(p => p);
        // Same depth as current content and same parent
        if (parentPath === '/') {
          return itemParts.length === 1;
        } else {
          return itemPath.startsWith(parentPath + '/') &&
                 itemParts.length === pathParts.length;
        }
      })
      .map(formatItem)
      .filter(Boolean);
  }

  res.json({
    '@id': `http://localhost:${PORT}${contentPath}/@contents`,
    'items': items,
    'items_total': items.length,
  });
});

/**
 * POST /:path/@submit-form
 * Form submission endpoint (collective.volto.formsupport)
 * Accepts { block_id, data: [{ field_id, label, value }] }
 */
app.post('*/@submit-form', (req, res) => {
  if (process.env.DEBUG) {
    console.log(`POST @submit-form: path=${req.path}`);
  }
  res.status(204).end();
});

/**
 * POST /:path/@lock
 * Lock content for editing
 */
app.post('*/@lock', (req, res) => {
  res.json({
    locked: true,
    stealable: true,
    creator: 'admin',
    time: new Date().toISOString(),
    timeout: 600
  });
});

/**
 * DELETE /:path/@lock
 * Unlock content after editing
 */
app.delete('*/@lock', (req, res) => {
  res.json({ locked: false });
});

/**
 * GET /resolveuid/:uid
 * Resolve a UID to content - used by distribution content that references
 * other content via resolveuid/UID links
 */
app.get('*/resolveuid/:uid', (req, res) => {
  const uid = req.params.uid;
  const contentPath = uidToPathMap[uid];
  if (contentPath) {
    const content = getContent(contentPath, getSessionId(req));
    if (content) return res.json(content);
  }
  res.status(404).json({
    error: { type: 'NotFound', message: `UID not found: ${uid}` }
  });
});

/**
 * GET *\/@@images/*
 * Serve images for Plone image scales
 * URLs like: /test-image-1/@@images/image/preview
 * Serves actual image files from content directories if they exist,
 * otherwise falls back to placeholder SVGs.
 */
function findFirstImageFile(rootDir, maxDepth) {
  const imageExts = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase())) {
        return full;
      }
      if (entry.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return null;
}

app.get('*/@@images/*', (req, res) => {
  // Extract content path and field name from URL. Serves the same image
  // file regardless of scale — the mock doesn't generate actual scales.
  // e.g., /images/test-image-1/@@images/image/preview
  // e.g., /block/grid-block/@@images/preview_image/large
  // e.g., /concepts/custom-blocks/@@images/image-800-1c983515.svg (listing expansion scale URL)
  // Match field name which may include hash suffix: image-800-1c983515.svg
  const pathMatch = req.path.match(/^(.+?)\/@@images\/([a-z_]+(?:-[\w.-]+)?)/i);
  const contentPath = pathMatch ? pathMatch[1] : '';
  // Strip hash suffix from field name (e.g., 'image-800-1c983515.svg' → 'image')
  const rawField = pathMatch ? pathMatch[2] : 'image';
  const fieldName = rawField.replace(/-\d+.*$/, '');
  const scale = pathMatch && pathMatch[3] ? pathMatch[3] : 'preview';

  // A markdown mount keeps the blob as an ordinary file beside the markdown
  // that references it, so there is nothing to resolve.
  if (markdownBlobs.has(contentPath)) {
    const file = markdownBlobs.get(contentPath);
    res.set('Content-Type', MARKDOWN_BLOB_MIME[path.extname(file).toLowerCase()]
      || 'application/octet-stream');
    res.sendFile(file);
    return;
  }

  // Bytes uploaded in this session take precedence: they have no directory on
  // disk, so contentDirMap will never find them.
  const blob = sessionBlobs[`${getSessionId(req)}:${contentPath}:${fieldName}`];
  if (blob) {
    res.set('Content-Type', blob.mime);
    return res.send(blob.buffer);
  }

  // Try to serve actual image file from content directory
  // Use contentDirMap to find actual directory for nested paths
  // If not found, rescan in case content was added after startup
  let dirInfo = contentDirMap[contentPath];
  if (!dirInfo) {
    initContentDirMap();
    dirInfo = contentDirMap[contentPath];
  }
  const imageDir = dirInfo ? path.join(dirInfo.dirPath, fieldName) : null;

  const mimeTypes = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const isImageExt = (ext) => ext in mimeTypes;
  const serveFile = (imageFile) => {
    const ext = path.extname(imageFile).toLowerCase();
    res.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.sendFile(imageFile);
  };

  // Distribution lead/preview image may reference ANOTHER content item's blob
  // via blob_path (e.g. a case study whose lead image points at /images/msc.png).
  // Resolve the blob_path through contentDirMap and serve the exact bytes, so
  // <item>/@@images/<field> works even when the bytes live under another item.
  if (dirInfo) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dirInfo.dirPath, 'data.json'), 'utf-8'));
      const bp = data[fieldName] && data[fieldName].blob_path;
      const sep = `/${fieldName}/`;
      const idx = bp ? bp.indexOf(sep) : -1;
      if (idx > 0) {
        const itemRel = bp.slice(0, idx);   // e.g. images/msc.png
        const within = bp.slice(idx + 1);   // e.g. image/<file>.png
        const tgt = contentDirMap['/' + itemRel];
        const blobFile = tgt ? path.join(tgt.dirPath, within) : null;
        if (blobFile && fs.existsSync(blobFile)) { serveFile(blobFile); return; }
      }
    } catch (e) { /* fall through to dir scan */ }
  }

  if (imageDir && fs.existsSync(imageDir)) {
    const files = fs.readdirSync(imageDir);
    if (files.length > 0) {
      serveFile(path.join(imageDir, files[0]));
      return;
    }
  }

  // Fallback for distribution-style content where preview_image is set via
  // blob_path. The actual bytes live in a nested image content item under
  // the data dir, e.g. <content>/<screenshot>.png/image/<file>.png.
  // Walk the dir tree and serve the first image file found (depth-limited).
  if (dirInfo && fs.existsSync(dirInfo.dirPath)) {
    const found = findFirstImageFile(dirInfo.dirPath, 3);
    if (found) {
      serveFile(found);
      return;
    }
  }

  res.status(404).json({
    error: { type: 'NotFound', message: `Image not found: ${req.path}` }
  });
});

// @@download — same as @@images, serves image files from content directories
app.get('*/@@download/*', (req, res) => {
  // e.g., /images/quadrant/@@download/image/quadrant.svg -> contentPath=/images/quadrant, fieldName=image
  const pathMatch = req.path.match(/^(.+?)\/@@download\/(\w+)(?:\/.*)?$/);
  const contentPath = pathMatch ? pathMatch[1] : '';
  const fieldName = pathMatch ? pathMatch[2] : 'image';

  // A markdown mount keeps the blob as an ordinary file beside its markdown, so
  // serve it directly — same as the @@images handler. Image blocks store their
  // src as `@@download/image/<file>`, so this path must resolve it too, not only
  // the distribution `<dir>/image/<file>` layout handled below.
  if (markdownBlobs.has(contentPath)) {
    const file = markdownBlobs.get(contentPath);
    res.set('Content-Type', MARKDOWN_BLOB_MIME[path.extname(file).toLowerCase()]
      || 'application/octet-stream');
    res.sendFile(file);
    return;
  }

  const dirInfo = contentDirMap[contentPath];
  const imageDir = dirInfo ? path.join(dirInfo.dirPath, fieldName) : null;

  if (imageDir && fs.existsSync(imageDir)) {
    const files = fs.readdirSync(imageDir);
    if (files.length > 0) {
      const imageFile = path.join(imageDir, files[0]);
      const ext = path.extname(files[0]).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
      };
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      res.sendFile(imageFile);
      return;
    }
  }

  res.status(404).json({
    error: { type: 'NotFound', message: `Download not found: ${req.path}` }
  });
});

/**
 * GET /<content-path-that-is-an-Image>
 *
 * Plone's Zope-traversal layer serves Image content items' blob bytes
 * directly at their plain content path (no /@@images/image suffix, no
 * ++api++ prefix, Accept != application/json). Frontend <img src> URLs
 * rely on this so image refs like `/company/about-us/screenshot.png`
 * resolve against the backend. The @@images handler above covers
 * explicit scale paths; this covers the implicit default-view case.
 */
app.get('*', (req, res, next) => {
  if (req.isApiRequest) return next();

  const dirInfo = contentDirMap[req.path];
  if (!dirInfo) return next();

  const dataFile = path.join(dirInfo.dirPath, 'data.json');
  if (!fs.existsSync(dataFile)) return next();

  let item;
  try { item = JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return next(); }
  if (item['@type'] !== 'Image') return next();

  // Image items store the blob in an `image/` subdirectory (same shape as
  // the @@images handler reads from). Serve whatever file is in there.
  const imageDir = path.join(dirInfo.dirPath, 'image');
  if (!fs.existsSync(imageDir)) return next();
  const files = fs.readdirSync(imageDir);
  if (files.length === 0) return next();

  const imageFile = path.join(imageDir, files[0]);
  const ext = path.extname(files[0]).toLowerCase();
  const mimeTypes = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  res.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  res.sendFile(imageFile);
});

/**
 * GET /:path
 * Get content by path (API requests only)
 * Frontend requests fall through to static file serving
 */
app.get('*', (req, res, next) => {
  // Only handle API requests (with ++api++ prefix)
  // Frontend requests should be handled by static file middleware
  if (!req.isApiRequest) {
    return next();
  }

  const urlPath = req.path;
  // Normalize: remove ++api++ prefix and strip trailing slash (except root)
  const cleanPath = (urlPath.replace('/++api++', '') || '/').replace(/\/+$/, '') || '/';
  const sessionId = getSessionId(req);

  // Debug logging for template/page requests
  if (cleanPath.includes('template') || cleanPath.includes('test-page')) {
    const fs = require('fs');
    const hasInSession = sessionId && sessionContent[sessionId]?.[cleanPath];
    let contentPreview = '';
    if (hasInSession) {
      // Log content to verify edited value is present
      const sessionData = sessionContent[sessionId][cleanPath];
      const blockIds = sessionData?.blocks_layout?.items || Object.keys(sessionData?.blocks || {});
      const firstBlockId = blockIds[0];
      if (firstBlockId && sessionData?.blocks?.[firstBlockId]) {
        const val = JSON.stringify(sessionData.blocks[firstBlockId].value || '');
        contentPreview = ` firstBlock: ${val.substring(0, 150)}`;
      }
    }
    const logMsg = `[GET] ${cleanPath} sessionId: ${sessionId} inSession: ${!!hasInSession}${contentPreview}\n`;
    fs.appendFileSync('/tmp/mock-api-get.log', logMsg);
    console.log(logMsg);
  }

  // Reload content from disk to pick up changes during development.
  // Pass ?expand= so @components matches what the client requested
  // (real Plone behaviour: stub by default, expand only what's listed).
  const content = getContent(cleanPath, sessionId, parseExpand(req));

  if (content) {
    // Filter actions based on authentication
    const authenticated = isAuthenticated(req);
    const filteredContent = filterActionsForAuth(content, authenticated);

    if (process.env.DEBUG) {
      console.log(`[DEBUG] Serving API content for ${cleanPath} (auth: ${authenticated})${sessionId ? ` (session: ${sessionId})` : ''}`);
      console.log(`[DEBUG] Query params:`, req.query);
      console.log(`[DEBUG] Response preview:`, JSON.stringify(filteredContent).substring(0, 500));
    }
    res.json(filteredContent);
  } else {
    // plone.app.redirector: moved content 302s (GET) to the new path, keeping
    // the ++api++ namespace. The frontend (ploneApi) upgrades this to a 301.
    const redirectTo = getRedirectTarget(cleanPath);
    if (redirectTo) {
      res.redirect(302, `http://localhost:${PORT}/++api++${redirectTo}`);
      return;
    }
    res.status(404).json({
      error: {
        type: 'NotFound',
        message: `Content not found: ${cleanPath}`,
      },
    });
  }
});

/**
 * Standard Plone fields that are "registered" in this mock world — common
 * dexterity/behavior fields a content type may legitimately expose. Used to
 * decide which top-level fields survive a PATCH (see dropUnregisteredFields).
 * Deliberately does NOT include `footer_blocks` / `header_blocks`: layout
 * regions now live as sub-keys of `blocks_layout`, not as separate fields.
 */
const STANDARD_REGISTERED_FIELDS = new Set([
  'title', 'description', 'blocks', 'blocks_layout', 'id', 'UID',
  'review_state', 'created', 'modified', 'effective', 'expires',
  'subjects', 'language', 'rights', 'relatedItems', 'preview_image',
  'exclude_from_nav', 'allow_discussion', 'layout', 'text',
  'contact_email', 'contact_name', 'contact_phone', 'event_url',
  'start', 'end', 'open_end', 'whole_day', 'location', 'image',
]);

/**
 * Mirror Plone's deserializer: keep only top-level keys that are registered
 * fields. A key survives if it is metadata (`@`-prefixed), already present on
 * the stored object (so it's clearly a real field of this type), or in the
 * standard registered set. Everything else is dropped, the same way a real
 * Plone backend ignores values for fields that don't exist on the schema.
 */
function dropUnregisteredFields(body, baseline) {
  const out = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (
      key.startsWith('@') ||
      (baseline && Object.prototype.hasOwnProperty.call(baseline, key)) ||
      STANDARD_REGISTERED_FIELDS.has(key)
    ) {
      out[key] = value;
    } else {
      console.log(`[PATCH] dropping unregistered field: ${key}`);
    }
  }
  return out;
}

/**
 * PATCH /:path
 * Update content - persists to session storage for authenticated requests.
 * Default session ('_default') does NOT persist to ensure test isolation for
 * unauthenticated requests.
 */
app.patch('*', (req, res) => {
  const urlPath = req.path;
  const cleanPath = urlPath.replace('/++api++', '');
  const sessionId = getSessionId(req);

  const fs = require('fs');
  const logMsg = `[PATCH] ${cleanPath} sessionId: ${sessionId}\n`;
  fs.appendFileSync('/tmp/mock-api-patch.log', logMsg);
  console.log(logMsg);

  // Reload content from disk to pick up changes during development
  const content = getContent(cleanPath, sessionId);

  if (content) {
    // Emulate Plone's REST deserializer: only fields backed by a registered
    // dexterity field / behavior survive a save. Unknown top-level fields (e.g.
    // an ad-hoc `footer_blocks`) are silently dropped. This is WHY layout
    // regions must live as sub-keys of the registered `blocks_layout` dict —
    // they ride along inside a registered field and persist, whereas a separate
    // top-level region field would be discarded here.
    const registeredBody = dropUnregisteredFields(req.body, content);
    const mergedContent = { ...content, ...registeredBody };

    // Persist to session storage for test verification when session is provided
    // Default session doesn't persist to maintain backward compatibility
    if (sessionId && sessionId !== '_default') {
      console.log(`[PATCH] Persisting to session: ${sessionId} path: ${cleanPath}`);
      setSessionContent(sessionId, cleanPath, mergedContent);
      // Verify it was saved
      const fs = require('fs');
      const verifyInSession = sessionContent[sessionId]?.[cleanPath] ? 'YES' : 'NO';
      const verifyMsg = `[PATCH VERIFY] ${cleanPath} in session: ${verifyInSession}\n`;
      fs.appendFileSync('/tmp/mock-api-patch.log', verifyMsg);
    } else {
      console.log(`[PATCH] NOT persisting (no session or default)`);
    }

    res.json(mergedContent);
  } else {
    res.status(404).json({
      error: {
        type: 'NotFound',
        message: `Content not found: ${cleanPath}`,
      },
    });
  }
});

// Start server only when run directly (not when require()'d)
let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`Mock Plone API server running on http://localhost:${PORT}`);
    console.log(`Health endpoint: http://localhost:${PORT}/health`);
    console.log(`Content endpoints available:`);
    Object.keys(contentDirMap).forEach((urlPath) => {
      console.log(`  - http://localhost:${PORT}${urlPath}`);
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

// Export for use by test frontend server or test harnesses
module.exports = { app, server, contentDirMap, CONTENT_MOUNTS, ready };