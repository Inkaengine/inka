/**
 * Block renderer for test frontend.
 * Renders blocks based on their @type.
 *
 * IMPORTANT: This renderer ONLY generates HTML markup following the Hydra specification.
 * It uses data attributes (like data-edit-text, data-node-id) to mark what SHOULD
 * be editable, but it does NOT set contenteditable attributes directly.
 *
 * The hydra.js bridge is responsible for:
 * - Reading these data attributes
 * - Setting contenteditable="true" on the appropriate elements
 * - Attaching event listeners for editing
 *
 * This separation ensures:
 * - Renderers stay simple and framework-agnostic
 * - hydra.js has full control over edit mode behavior
 * - No nested contenteditable conflicts
 */

// Global render counter for testing re-render behavior
window.hydraRenderCount = window.hydraRenderCount || 0;


// Test-frontend log with run ID prefix (matches hydra.js log pattern)
function tfLog(...args) {
  const runId = window.__testRunId;
  const prefix = runId != null ? `[TEST-FRONTEND][RUN-${runId}]` : '[TEST-FRONTEND]';
  console.log(prefix, ...args);
}

/**
 * Expand child items, only going async when there are actual listing blocks.
 * Used by container renderers (grid, columns, accordion) and the top-level page render.
 * @param {Object} blocks - Block dict keyed by ID
 * @param {string[]} layout - Array of block IDs
 * @param {string} containerId - Container ID for paging
 * @returns {Promise<{items: Object[], paging: Object|null}>}
 */
// Block types that expand via expandListingBlocks (listing + the example
// listing-variant blocks). Each has a fetcher registered in index.html.
const LISTING_BLOCK_TYPES = ['listing', 'relatedItemsListing', 'searchShortcuts', 'rssFeed'];

// Expand a container's children (blocks_layout OR object_list) into renderable
// items WITH paging — the same way for every container. staticBlocks and
// expandListingBlocks compose: staticBlocks windows the static (non-listing)
// children, expandListingBlocks fetches + windows the listing children, and each
// call's `seen` count is PASSED into the next (threaded, not shared state) so a
// mixed container pages as ONE combined window. Paging is NOT conditional on a
// listing being present: a plain grid of slate cards pages exactly like a grid
// with a listing. Returning all items with paging:null (as the old no-listing
// shortcut did) meant a manual grid silently lost paging and its pager, so a
// paged-out child (which the reveal needs) had no page-step control to reach it.
async function expandItems(blocks, layout, containerId, paging) {
    const isListing = (id) => {
        const t = blocks[id]?.['@type'];
        if (t === 'listing') return !!blocks[id]?.querystring?.query;
        return LISTING_BLOCK_TYPES.includes(t);
    };
    const out = [];
    // A container that DOESN'T page (an accordion panel, a column) calls this with
    // no paging. staticBlocks tolerates that (its size defaults to 1000, so every
    // static child renders), but expandListingBlocks does NOT: a truthy paging
    // object with no start/size makes its window `undefined..NaN` and it returns
    // ZERO items — a nested listing rendered empty. Normalize one window here so
    // both helpers get real start/size numbers: the container's own window when it
    // pages, else a full window (all items). seen still threads for combined paging.
    const pagingWindow = { start: paging?.start ?? 0, size: paging?.size ?? 1000 };
    let seen = paging?.seen || 0;
    let outPaging = null;
    let i = 0;
    while (i < layout.length) {
        if (isListing(layout[i]) && window._expandListingBlocks) {
            const res = await window._expandListingBlocks(blocks, [layout[i]], containerId, { ...pagingWindow, seen });
            out.push(...(res.items || []));
            outPaging = res.paging || outPaging;
            seen = res.paging?.seen ?? (seen + (res.items?.length || 0));
            i++;
        } else {
            // A run of consecutive static children — window them together.
            const run = [];
            while (i < layout.length && !isListing(layout[i])) { run.push(layout[i]); i++; }
            const res = window._staticBlocks(run, { blocks, paging: pagingWindow, seen });
            out.push(...res.items);
            outPaging = res.paging;
            seen = res.paging.seen;
        }
    }
    return { items: out, paging: outPaging };
}

// Slider state: track slide count to detect new slides { [blockId]: slideCount }
const sliderSlideCount = {};

/**
 * Strip the API origin from an absolute URL, returning a relative path.
 * e.g. "http://localhost:8888/images/foo.jpg" → "/images/foo.jpg"
 * Leaves relative paths unchanged.
 */
function stripApiOrigin(url) {
    if (!url || !url.startsWith('http')) return url;
    const apiOrigin = window._apiOrigin;
    if (apiOrigin && url.startsWith(apiOrigin)) {
        return url.slice(apiOrigin.length) || '/';
    }
    // External URL — preserve as-is
    return url;
}

/**
 * Extract URL from various formats and construct image URL.
 * Handles:
 * - Catalog brain: { '@id': '/path', image_field: 'image', image_scales: { image: [{ download: '@@images/...' }] } }
 * - Array: [{ '@id': '/path' }]
 * - Object: { '@id': '/path' }
 * - String: '/path'
 * @param {Array|Object|string} value - Image value in various formats
 * @returns {string} Image URL ready for src attribute
 */
function getImageUrl(value) {
    if (!value) return '';
    const apiOrigin = window._apiOrigin || '';

    // Handle catalog brain format from expandListingBlocks
    // { '@id': '/content-path', image_field: 'image', image_scales: { image: [{ download: '@@images/...' }] } }
    if (value.image_scales && value.image_field) {
        const field = value.image_field;
        const scales = value.image_scales[field];
        if (scales?.[0]?.download) {
            // A brain's @id comes back absolute from the API, so use it as the
            // base as-is. Stripping it to a path and re-prefixing with apiOrigin
            // silently produced an ORIGIN-LESS src whenever window._apiOrigin
            // was unset — the browser then resolved it against the frontend,
            // which 404s: "All images should have valid src and load
            // successfully" for a listing thumbnail that is fine on the API.
            const rawId = value['@id'] || '';
            const baseUrl = /^https?:\/\//.test(rawId) ? rawId : `${apiOrigin}${rawId}`;
            return `${baseUrl}/${scales[0].download}`;
        }
    }

    // Extract @id from array or object format
    let url = Array.isArray(value) ? value[0]?.['@id'] : value?.['@id'] || value;
    if (typeof url !== 'string') return '';
    // Add @@images/image suffix for Plone paths that don't already have a scale/download URL
    if (url.startsWith('/') && !url.includes('@@images') && !url.includes('@@download')) {
        url = `${url}/@@images/image`;
    }
    // Prepend API origin so images load from the API server, not the frontend
    if (url.startsWith('/')) {
        url = `${apiOrigin}${url}`;
    }
    return url;
}

/**
 * Extract URL from various formats for links.
 * Handles: array of objects [{@id: '/path'}], object {@id: '/path'}, or string '/path'
 * @param {Array|Object|string} value - Link value in various formats
 * @returns {string} Link URL
 */
function getLinkUrl(value) {
    if (!value) return '';
    // Extract @id from array or object format
    const url = Array.isArray(value) ? value[0]?.['@id'] : value?.['@id'] || value;
    return typeof url === 'string' ? stripApiOrigin(url) : '';
}

/**
 * Render content blocks to the DOM.
 * @param {Object} content - Content object with items array (each item has @uid and @type)
 * @param {string} containerId - ID of the container element (default: 'content')
 * @param {number} [renderGeneration] - If provided, abort if window._renderGeneration has changed
 */
async function renderContent(content, containerId = 'content', renderGeneration) {
    // Increment render counter (only for main content)
    if (containerId === 'content') {
        window.hydraRenderCount++;
        const counterEl = document.getElementById('render-counter');
        if (counterEl) counterEl.textContent = window.hydraRenderCount;
    }

    const container = document.getElementById(containerId);
    if (!container) return;
    // Stale check before rendering
    if (renderGeneration !== undefined && renderGeneration !== window._renderGeneration) {
        tfLog('renderContent: STALE gen=' + renderGeneration + ' current=' + window._renderGeneration);
        return;
    }

    const { items } = content;
    if (!items) {
        container.innerHTML = '';
        return;
    }

    // Build all blocks into a fragment first, then swap atomically
    tfLog('renderContent: START gen=' + renderGeneration + ' items=' + items.length + ' t=' + performance.now().toFixed(0));
    const fragment = document.createDocumentFragment();
    for (const item of items) {
        const blockElement = await renderBlock(item['@uid'], item);
        if (renderGeneration !== undefined && renderGeneration !== window._renderGeneration) {
            tfLog('renderContent: STALE mid-loop gen=' + renderGeneration + ' current=' + window._renderGeneration);
            return;
        }
        if (blockElement) {
            fragment.appendChild(blockElement);
        }
    }
    tfLog('renderContent: SWAP gen=' + renderGeneration + ' t=' + performance.now().toFixed(0));
    container.innerHTML = '';
    container.appendChild(fragment);

    // Mobile-first cnav: sync newly-rendered <details> to the current
    // viewport. Global listener (below) covers resize after this point.
    syncCnavOpenState();
}

/**
 * Sync contextNavigation <details> open state to viewport. Open at
 * ≥768px, closed below. Called after every render + on viewport change.
 * Idempotent — setting `open` to the same value is a no-op.
 */
function syncCnavOpenState() {
    if (typeof window === 'undefined') return;
    const desktop = window.matchMedia('(min-width: 768px)').matches;
    document
        .querySelectorAll('details.context-navigation-disclosure')
        .forEach((d) => { d.open = desktop; });
}

/**
 * Render a single block.
 * @param {string} blockId - Block UID (used for data-block-uid attribute)
 * @param {Object} block - Block data
 * @returns {Promise<HTMLElement>} Rendered block element
 */
async function renderBlock(blockId, block) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-block-uid', blockId);
    // NOTE: a real frontend does NOT mark template read-only — hydra owns that
    // from the merged block.readOnly (isBlockReadonly), so editability and the
    // anchor harvest are consistent on every frontend without a render-side flag.
    // data-block-readonly stays available as a frontend's OWN escape hatch to lock
    // a block for its own reasons (see the teaser's overwrite handling below).

    switch (block['@type']) {
        case 'title':
            wrapper.innerHTML = `<h1 data-edit-text="/title">${window._currentFormData?.title || ''}</h1>`;
            break;
        case 'description':
            wrapper.innerHTML = `<p data-edit-text="/description">${window._currentFormData?.description || ''}</p>`;
            break;
        case 'slate':
            wrapper.innerHTML = renderSlateBlock(block);
            break;
        case 'text':
            wrapper.innerHTML = renderTextBlock(block);
            break;
        case 'textarea':
            wrapper.innerHTML = renderTextareaBlock(block);
            break;
        case 'image':
            wrapper.innerHTML = renderImageBlock(block);
            break;
        case 'video':
            wrapper.innerHTML = renderVideoBlock(block);
            break;
        case 'maps':
            wrapper.innerHTML = renderMapsBlock(block);
            break;
        case 'multifield':
            wrapper.innerHTML = renderMultiFieldBlock(block);
            break;
        case 'hero':
            // Hero uses comment syntax instead of data attributes
            // This tests the hydra comment parser with selectors
            const heroFragment = document.createDocumentFragment();
            // Comment specifies block-uid and field selectors
            const heroComment = document.createComment(` hydra block-uid=${blockId} edit-text=heading(.hero-heading) edit-text=subheading(.hero-subheading) edit-media=image(.hero-image) edit-text=buttonText(.hero-button) edit-link=buttonLink(.hero-button) `);
            heroFragment.appendChild(heroComment);
            const heroEl = document.createElement('div');
            heroEl.innerHTML = renderHeroBlockClean(block);
            heroFragment.appendChild(heroEl.firstElementChild);
            heroFragment.appendChild(document.createComment(' /hydra '));
            return heroFragment;

        case 'columns':
            wrapper.innerHTML = await renderColumnsBlock(block);
            break;
        case 'column':
            wrapper.innerHTML = renderColumnBlock(block);
            break;
        case 'section':
            wrapper.innerHTML = await renderSectionBlock(block);
            break;
        // Conversion drag/paste test blocks (dnd-convert.spec.ts). Leaf types
        // render a titled paragraph; the containers reuse the generic section
        // renderer (children in blocks_layout.items, incl. a seeded empty).
        case 'convSource':
        case 'convTargetA':
        case 'convTargetB':
        case 'convAlien':
            wrapper.innerHTML = `<p data-conv-type="${block['@type']}">${escapeHtml(block.title || block['@type'])}</p>`;
            break;
        case 'convBox':
        case 'convBoxMulti':
            wrapper.innerHTML = await renderConvBox(block);
            break;
        case 'convGroupSrc':
        case 'convGroupDst':
        case 'convGroupBox':
            wrapper.innerHTML = await renderConvGroup(block);
            break;
        case 'contextNavigation': {
            // Return the <nav> directly so aria-label / class /
            // data-block-uid all live on the same element. The default
            // wrapper would put data-block-uid on a generic div and bury
            // <nav> a level deeper — a11y checks (and the test contract)
            // expect them co-located.
            const navEl = document.createElement('div');
            navEl.innerHTML = await renderContextNavigationBlock(block, blockId);
            return navEl.firstElementChild;
        }
        case 'navItem': {
            // Return the <a> as the outer element so data-block-uid lives
            // alongside the link semantics (matches contextNavigation
            // putting data-block-uid on the <nav>). The default wrapper
            // would bury the <a> under a <div>. Manual + listing-synth
            // navItems share the same shape (listing's fieldMappings
            // converts @id → href via the `link` type), so one path.
            const itemEl = document.createElement('div');
            itemEl.innerHTML = renderNavItemBlock(block, blockId);
            return itemEl.firstElementChild;
        }
        case 'gridBlock':
            wrapper.innerHTML = await renderGridBlock(block, blockId);
            break;
        case 'carousel':
            wrapper.classList.add('carousel-block');
            wrapper.innerHTML = renderCarouselBlock(block);
            break;
        case 'slider':
            // Slider uses object_list format (slides as array with @id)
            wrapper.classList.add('carousel-block');
            wrapper.innerHTML = await renderSliderBlock(block, blockId);
            break;
        case 'slide':
            wrapper.innerHTML = renderSlideBlock(block);
            break;
        case 'accordion':
            wrapper.innerHTML = await renderAccordionBlock(block, blockId);
            break;
        // accordionPanel is rendered inline by renderAccordionBlock (object_list items)
        case 'socialLinks':
            wrapper.innerHTML = renderSocialLinksBlock(block);
            break;
        case 'slateTable':
            wrapper.innerHTML = renderSlateTableBlock(block);
            break;
        case 'objectBlocks':
            wrapper.innerHTML = await renderObjectBlocksBlock(block);
            break;
        case 'search':
            wrapper.innerHTML = await renderSearchBlock(block, blockId);
            break;
        case 'teaser':
            // Teaser handles its own data-block-uid, so return it directly
            const teaserEl = document.createElement('div');
            teaserEl.innerHTML = renderTeaserBlock(block, blockId);
            return teaserEl.firstElementChild;
        case 'default':
            const defaultEl = document.createElement('div');
            defaultEl.innerHTML = renderDefaultItemBlock(block, blockId);
            return defaultEl.firstElementChild;
        case 'summary':
            const summaryEl = document.createElement('div');
            summaryEl.innerHTML = renderSummaryItemBlock(block, blockId);
            return summaryEl.firstElementChild;
        case 'relatedItemsListing':
        case 'searchShortcuts':
        case 'rssFeed':
        case 'listing':
            if (window._expandListingBlocks) {
                return await renderListingBlock(block, blockId);
            }
            wrapper.textContent = 'Listing block (no fetch handler)';
            break;
        case 'introduction':
            wrapper.innerHTML = renderIntroductionBlock(block);
            break;
        case 'heading':
            wrapper.innerHTML = renderHeadingBlock(block);
            break;
        case 'suggest':
            wrapper.innerHTML = renderSuggestBlock(block, blockId);
            break;
        case 'separator':
            wrapper.innerHTML = renderSeparatorBlock(block);
            break;
        case 'button':
            wrapper.innerHTML = renderButtonBlock(block);
            break;
        case 'highlight':
            wrapper.innerHTML = renderHighlightBlock(block);
            break;
        case 'callout':
            wrapper.innerHTML = await renderCalloutBlock(block);
            break;
        case 'toc':
            wrapper.innerHTML = renderTocBlock(block);
            break;
        case 'form':
            wrapper.innerHTML = renderFormBlock(block);
            attachFormValidation(wrapper.querySelector('form'), block);
            break;
        case 'empty':
            wrapper.innerHTML = renderEmptyBlock(block);
            break;
        case 'codeExample':
            wrapper.innerHTML = renderCodeExampleBlock(block, blockId);
            break;
        case 'cookieConsent':
            // The bar is the block's element; the banner and the preferences
            // dialog it words are built OUTSIDE it (see renderCookieConsentBar).
            wrapper.innerHTML = renderCookieConsentBar(block, blockId);
            mountCookieConsentChrome(block, blockId);
            break;
        case 'title':
            // Title block is just rendered by page title, empty here
            wrapper.innerHTML = '';
            break;
        default:
            // Diagnostic only — keep type in a data attribute so it doesn't
            // leak as visible text that fails checkEditAnnotations.
            wrapper.innerHTML = `<p data-unknown-block-type="${block['@type']}">[not implemented]</p>`;
    }

    return wrapper;
}

/**
 * Render a Slate text block.
 * @param {Object} block - Slate block data
 * @returns {string} HTML string
 */
// Plain text of a slate node (recursively join leaf .text) — used to derive
// heading anchor ids/labels.
function slateNodeText(node) {
    if (node == null) return '';
    if (typeof node.text === 'string') return node.text;
    return (node.children || []).map(slateNodeText).join('');
}

// URL-fragment slug from arbitrary text.
function slugify(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Keep heading anchors fresh WHILE editing. This frontend derives a heading's
// id/data-linkable-id from its text, but inline editing changes the text without
// re-running the renderer — so update them live on input. hydra harvests the id
// on its next flush/render.
if (typeof document !== 'undefined') {
    document.addEventListener(
        'input',
        (e) => {
            const editable =
                e.target && e.target.closest && e.target.closest('[data-edit-text]');
            if (!editable) return;
            // Refresh only the elements this frontend already TAGGED with
            // data-linkable-id (any element, multiple per block). It's purely
            // tag-driven — untagged elements (the page title, plain text) are
            // never touched, so no element/block/field special-casing is needed.
            const tagged = editable.matches('[data-linkable-id]') ? [editable] : [];
            editable
                .querySelectorAll('[data-linkable-id]')
                .forEach((el) => tagged.push(el));
            for (const el of tagged) {
                const text = (el.textContent || '').trim();
                el.setAttribute('data-linkable-id', text);
                if (text) el.id = slugify(text);
                else el.removeAttribute('id');
            }
        },
        true,
    );
}

/**
 * The class attribute a design-system style produces.
 *
 * Volto's style menu stores its two kinds differently, and a frontend has to
 * render BOTH or half the menu silently does nothing:
 *   block  -> `styleName` on the element (space separated, several can apply)
 *   inline -> a leaf MARK `style-<cssClass>` (StyleMenu/utils.js, Editor.addMark)
 * This example frontend renders them so the contract is demonstrated, not just
 * described.
 */
function styleClassAttr(node) {
    const classes = [];
    if (typeof node.styleName === 'string') classes.push(node.styleName);
    for (const key of Object.keys(node)) {
        const m = node[key] && /^style-(.+)$/.exec(key);
        if (m) classes.push(m[1]);
    }
    return classes.length ? ` class="${classes.join(' ').trim()}"` : '';
}

function renderSlateBlock(block) {
    // An EMPTY slate block (no `value` at all — the state a just-added block is
    // in) still has to render one node, or there is nothing carrying
    // data-node-id for the bridge to sync a cursor to: clicking it raises
    // "Selection sync failed - missing data-node-id" and the author cannot
    // type. A real frontend gets this from the schema default
    // ([{type:'p',children:[{text:''}]}]); this fixture has no defaults layer,
    // so it seeds the same empty paragraph here, nodeId '0' like the first node
    // of any slate value.
    const value = (block.value && block.value.length)
        ? block.value
        : [{ type: 'p', nodeId: '0', children: [{ text: '' }] }];
    let html = '';
    value.forEach((node) => {
        // nodeId is required for edit mode (hydra.js adds it), but optional for view mode
        // If missing in edit mode, hydra.js should add it - but we don't throw here to allow view mode
        const nodeIdAttr = (node.nodeId !== undefined ? ` data-node-id="${node.nodeId}"` : '')
            + styleClassAttr(node);

        // Deep-link anchor. This frontend CHOOSES to make every heading linkable:
        // a real id (the #fragment) + data-linkable-id (the picker label), which
        // hydra.js harvests into block._linkableAnchors. Explicit node.data.anchorId
        // wins; otherwise a heading's id/label are derived from its text. Tagging
        // headings is a frontend decision — the bridge just harvests the attributes.
        // This frontend CHOOSES to make headings deep-link anchors (a frontend
        // decision — the bridge just harvests [data-linkable-id]). Always emit
        // the tag on headings, even empty, so the tag-driven live refresh can
        // update a freshly-typed one; the id is added once there's text to slug.
        const a = node.data || {};
        const isHeading = /^h[1-6]$/.test(node.type || '');
        const headingText = isHeading ? slateNodeText(node).trim() : '';
        const anchorId = a.anchorId || (headingText ? slugify(headingText) : '');
        const anchorName = (a.anchorName || headingText || '').replace(/"/g, '&quot;');
        const anchorAttr =
            isHeading || a.anchorId
                ? `${anchorId ? ` id="${anchorId}"` : ''} data-linkable-id="${anchorName}"`
                : '';

        const text = renderChildren(node.children);
        // Mark as editable field - hydra.js will read this and set contenteditable="true"

        // Render based on node type
        switch (node.type) {
            case 'p':
                html += `<p data-edit-text="value"${nodeIdAttr}>${text}</p>`;
                break;
            case 'h1':
                html += `<h1 data-edit-text="value"${nodeIdAttr}${anchorAttr}>${text}</h1>`;
                break;
            case 'h2':
                html += `<h2 data-edit-text="value"${nodeIdAttr}${anchorAttr}>${text}</h2>`;
                break;
            case 'h3':
                html += `<h3 data-edit-text="value"${nodeIdAttr}${anchorAttr}>${text}</h3>`;
                break;
            case 'h4':
                html += `<h4 data-edit-text="value"${nodeIdAttr}${anchorAttr}>${text}</h4>`;
                break;
            case 'h5':
                html += `<h5 data-edit-text="value"${nodeIdAttr}${anchorAttr}>${text}</h5>`;
                break;
            case 'h6':
                html += `<h6 data-edit-text="value"${nodeIdAttr}${anchorAttr}>${text}</h6>`;
                break;
            case 'blockquote':
                html += `<blockquote data-edit-text="value"${nodeIdAttr}>${text}</blockquote>`;
                break;
            case 'ul':
                html += `<ul data-edit-text="value"${nodeIdAttr}>${renderListItems(node.children)}</ul>`;
                break;
            case 'ol':
                html += `<ol data-edit-text="value"${nodeIdAttr}>${renderListItems(node.children)}</ol>`;
                break;
            default:
                // Fallback for unknown block types
                html += `<p data-edit-text="value"${nodeIdAttr}>${text}</p>`;
        }
    });

    return html || '<p data-edit-text="value">Empty block</p>';
}

/**
 * Render list items (li elements) for ul/ol lists.
 * Each li can contain text nodes, links, and other inline elements.
 * @param {Array} items - Array of li nodes
 * @returns {string} HTML string
 */
function renderListItems(items) {
    if (!items || !Array.isArray(items)) return '';

    return items.map(item => {
        if (item.type === 'li') {
            const nodeIdAttr = item.nodeId !== undefined ? ` data-node-id="${item.nodeId}"` : '';
            const content = renderChildren(item.children || []);
            return `<li${nodeIdAttr}>${content}</li>`;
        }
        // Handle nested lists (ul/ol inside ul/ol) for indentation
        if (item.type === 'ul' || item.type === 'ol') {
            const nodeIdAttr = item.nodeId !== undefined ? ` data-node-id="${item.nodeId}"` : '';
            return `<${item.type}${nodeIdAttr}>${renderListItems(item.children)}</${item.type}>`;
        }
        // If not an li or nested list, render as inline content
        return renderChildren([item]);
    }).join('');
}

/**
 * Recursively render Slate children nodes.
 * Handles both old format (marks) and new format (inline element nodes).
 * Uses non-standard markup to prove architectural decoupling.
 * @param {Array} children - Array of Slate nodes
 * @returns {string} HTML string
 */
function renderChildren(children) {
    return children.map(child => {
        // Handle inline element nodes (new format from toggleInlineFormat)
        // Add data-node-id for selection restoration
        if (child.type === 'strong') {
            const nodeId = child.nodeId !== undefined ? ` data-node-id="${child.nodeId}"` : '';
            return `<span style="font-weight: bold"${nodeId}>${renderChildren(child.children)}</span>`;
        }
        if (child.type === 'em') {
            const nodeId = child.nodeId !== undefined ? ` data-node-id="${child.nodeId}"` : '';
            return `<span style="font-style: italic"${nodeId}>${renderChildren(child.children)}</span>`;
        }
        if (child.type === 'del') {
            const nodeId = child.nodeId !== undefined ? ` data-node-id="${child.nodeId}"` : '';
            return `<span style="text-decoration: line-through"${nodeId}>${renderChildren(child.children)}</span>`;
        }
        if (child.type === 'u') {
            const nodeId = child.nodeId !== undefined ? ` data-node-id="${child.nodeId}"` : '';
            return `<span style="text-decoration: underline"${nodeId}>${renderChildren(child.children)}</span>`;
        }
        if (child.type === 'code') {
            const nodeId = child.nodeId !== undefined ? ` data-node-id="${child.nodeId}"` : '';
            return `<code${nodeId}>${renderChildren(child.children)}</code>`;
        }
        if (child.type === 'link') {
            const nodeId = child.nodeId !== undefined ? ` data-node-id="${child.nodeId}"` : '';
            const url = child.data?.url || '#';
            return `<a href="${url}"${nodeId}>${renderChildren(child.children)}</a>`;
        }

        // Handle text nodes (leaf nodes).
        // Wrapped in <span> to match how Vue/F7 frontends render text — they
        // use template interpolation ({{ node.text }}) inside <span> elements.
        // This is the hardest case for hydra.js because:
        // 1. The <span> has no data-node-id (only Slate element nodes get IDs,
        //    not leaf text nodes), so hydra.js must walk UP to find the parent
        //    element's data-node-id.
        // 2. When the user types, the browser may REPLACE the text node inside
        //    <span> (a childList mutation) rather than modify it in-place
        //    (characterData mutation). The MutationObserver must handle both.
        // 3. Select-all + type replaces the entire <span> content, which is a
        //    childList change that characterData-only observers miss entirely.
        // A leaf carrying an inline design-system style needs an element to put
        // the class on; a plain leaf still renders as bare text.
        const leafStyles = child.text !== undefined ? styleClassAttr(child) : '';
        if (leafStyles) {
            // Escape: a slate text leaf is TEXT, not markup. A real frontend
            // interpolates it ({{ node.text }}) and the framework escapes; this
            // fixture builds an innerHTML string, so it must escape itself. Without
            // it, a code example whose text is literal HTML/JSX — e.g. a slate
            // `code` leaf `<div data-block-uid={uid}>` — is parsed as real
            // elements: the stray <div> auto-closes the enclosing
            // <p data-edit-text="value">, stranding everything after it (a link)
            // outside the editable region, and a bare data-block-uid is read as a
            // block that never round-trips.
            let content = escapeHtml(child.text || '');
            return `<span${leafStyles}>${content}</span>`;
        }
        if (child.text !== undefined) {
            let content = escapeHtml(child.text || '');

            // Also handle old format (marks) for backward compatibility
            if (child.bold) content = `<span style="font-weight: bold">${content}</span>`;
            if (child.italic) content = `<span style="font-style: italic">${content}</span>`;
            if (child.code) content = `<code>${content}</code>`;
            if (child.del) content = `<span style="text-decoration: line-through">${content}</span>`;

            const nodeIdAttr = child.nodeId !== undefined ? ` data-node-id="${child.nodeId}"` : '';
            return `<span${nodeIdAttr}>${content}</span>`;
        }

        // Unknown node type - render children if present, otherwise return empty
        if (child.children) {
            const nodeId = child.nodeId !== undefined ? ` data-node-id="${child.nodeId}"` : '';
            console.warn(`Unknown Slate node type: ${child.type}, rendering children`);
            return `<span${nodeId}>${renderChildren(child.children)}</span>`;
        }

        return '';
    }).join('');
}

/**
 * Render a simple text block (non-Slate).
 * @param {Object} block - Text block data
 * @returns {string} HTML string
 */
function renderTextBlock(block) {
    const text = block.text || '';
    // Mark as editable field - hydra.js will read this and set contenteditable="true"
    // No data-node-id needed for simple text blocks
    return `<div data-edit-text="text">${text}</div>`;
}

/**
 * Render a textarea block (multiline text, non-Slate).
 * @param {Object} block - Textarea block data
 * @returns {string} HTML string
 */
function renderTextareaBlock(block) {
    const content = block.content || '';
    // Mark as editable field - hydra.js will read this and set contenteditable="true"
    // No data-node-id needed for textarea blocks
    // Preserve newlines by replacing \n with <br> for display (hydra.js will convert back to \n when sending)
    const displayContent = content.replace(/\n/g, '<br>');
    return `<div data-edit-text="content">${displayContent}</div>`;
}

/**
 * Render a multi-field block (with both text and slate fields).
 * @param {Object} block - Multi-field block data
 * @returns {string} HTML string
 */
function renderMultiFieldBlock(block) {
    const title = block.title || '';
    const description = block.description || [];

    let html = `<div data-edit-text="title">${title}</div>`;

    // Render description as slate field
    description.forEach((node) => {
        if (node.type === 'p') {
            // nodeId is optional for view mode
            const nodeIdAttr = node.nodeId !== undefined ? ` data-node-id="${node.nodeId}"` : '';
            const text = renderChildren(node.children);
            html += `<p data-edit-text="description"${nodeIdAttr}>${text}</p>`;
        }
    });

    return html;
}

/**
 * Render a hero block with multiple editable text fields.
 * Tests all field types: string (heading, buttonText), textarea (subheading), slate (description)
 * @param {Object} block - Hero block data
 * @returns {string} HTML string
 */
function renderHeroBlock(block) {
    const heading = block.heading || '';
    // Ensure subheading is a string (might be object from conversion)
    const subheading = typeof block.subheading === 'string' ? block.subheading : '';
    const buttonText = block.buttonText || '';
    const buttonLink = getLinkUrl(block.buttonLink);
    const imageSrc = getImageUrl(block.image);
    // Data-driven: no data ⇒ no element (issue #296). Do NOT substitute an empty
    // paragraph — that renders an editable element for a field with no content and
    // leaks an empty <p> into view markup.
    const description = block.description || [];

    // Render subheading as textarea (preserve newlines)
    const subheadingHtml = subheading.replace(/\n/g, '<br>');

    // Render description as slate field
    let descriptionHtml = '';
    description.forEach((node) => {
        const nodeIdAttr = node.nodeId !== undefined ? ` data-node-id="${node.nodeId}"` : '';
        const text = renderChildren(node.children);
        switch (node.type) {
            case 'h1':
                descriptionHtml += `<h1 data-edit-text="description"${nodeIdAttr}>${text}</h1>`;
                break;
            case 'h2':
                descriptionHtml += `<h2 data-edit-text="description"${nodeIdAttr}>${text}</h2>`;
                break;
            case 'p':
            default:
                descriptionHtml += `<p data-edit-text="description"${nodeIdAttr}>${text}</p>`;
        }
    });

    // Data-driven (issue #296): no image ⇒ no element. The grey stand-in that used
    // to render here was the "always-render" hack — it gave an inline target for an
    // empty field at the cost of an empty div in view markup.
    const imageHtml = imageSrc
        ? `<img data-edit-media="image" src="${imageSrc}" alt="Hero image" style="max-width: 100%; height: auto; margin-bottom: 10px;" />`
        : '';

    // The <a> hosts TWO fields (buttonText + buttonLink), so it exists when the
    // button exists — i.e. when it has a label or a target. This is the case the
    // per-block `hideButton` flag was papering over.
    const buttonHtml = (block.buttonText || block.buttonLink)
        ? `<a data-edit-text="buttonText" data-edit-link="buttonLink" href="${buttonLink}" style="display: inline-block; padding: 10px 20px; background: #007eb1; color: white; text-decoration: none; border-radius: 4px; cursor: pointer;">${buttonText}</a>`
        : '';

    return `
        <div class="hero-block" style="padding: 20px; background: #f0f0f0; border-radius: 8px;">
            ${imageHtml}
            ${heading ? `<h1 data-edit-text="heading">${heading}</h1>` : ''}
            ${subheading ? `<p data-edit-text="subheading" style="font-size: 1.2em; color: #666;">${subheadingHtml}</p>` : ''}
            ${descriptionHtml ? `<div class="hero-description" style="margin: 10px 0;">${descriptionHtml}</div>` : ''}
            ${buttonHtml}
        </div>
    `;
}

/**
 * Render a hero block WITHOUT data attributes (for comment syntax testing).
 * Uses CSS classes instead of data-* attributes - hydra comment will add them.
 * @param {Object} block - Hero block data
 * @returns {string} HTML string
 */
function renderHeroBlockClean(block) {
    const heading = block.heading || '';
    // Ensure subheading is a string (might be object from conversion)
    const subheading = typeof block.subheading === 'string' ? block.subheading : '';
    const buttonText = block.buttonText || '';
    const buttonLink = getLinkUrl(block.buttonLink);
    const imageSrc = getImageUrl(block.image);
    // Data-driven: no data ⇒ no element (issue #296).
    const description = block.description || [];

    // Render subheading as textarea (preserve newlines)
    const subheadingHtml = subheading.replace(/\n/g, '<br>');

    // Render description - still needs node IDs for slate editing.
    // Data-driven, in edit mode too (issue #296): no data ⇒ no element. Reveal
    // is the bridge's job — TOGGLE_OPTIONAL_FIELDS seeds a sentinel value so
    // this very `description.length` rule fires — and it only works while the
    // renderer keeps telling the truth about what the block holds.
    let descriptionHtml = '';
    description.forEach((node) => {
        const nodeIdAttr = node.nodeId !== undefined ? ` data-node-id="${node.nodeId}"` : '';
        const text = renderChildren(node.children);
        switch (node.type) {
            case 'h1':
                descriptionHtml += `<h1 class="hero-description-node" data-edit-text="description"${nodeIdAttr}>${text}</h1>`;
                break;
            case 'h2':
                descriptionHtml += `<h2 class="hero-description-node" data-edit-text="description"${nodeIdAttr}>${text}</h2>`;
                break;
            case 'p':
            default:
                descriptionHtml += `<p class="hero-description-node" data-edit-text="description"${nodeIdAttr}>${text}</p>`;
        }
    });

    // Image - uses class instead of data-edit-media. Data-driven (issue #296):
    // no image ⇒ no element, so the comment selector matches nothing.
    //
    // NOT a placeholder in edit mode. An empty field is easier to set with
    // something to click, but "can clear image using X button overlay" asserts
    // that clearing an image leaves NO annotated element behind — and a
    // placeholder IS the leftover it looks for. Revealing an empty media field
    // is the toolbar's job (issue #296), not the renderer's.
    const imageHtml = imageSrc
        ? `<img class="hero-image" src="${imageSrc}" alt="Hero image" style="max-width: 100%; height: auto; margin-bottom: 10px;" />`
        : '';

    // One element, two fields (buttonText + buttonLink) — see renderHeroBlock.
    const buttonHtml = (block.buttonText || block.buttonLink)
        ? `<a class="hero-button" href="${buttonLink}" style="display: inline-block; padding: 10px 20px; background: #007eb1; color: white; text-decoration: none; border-radius: 4px; cursor: pointer;">${buttonText}</a>`
        : '';

    // No data-* attributes on fields - comment syntax will add them via selectors
    return `
        <div class="hero-block" style="padding: 20px; background: #f0f0f0; border-radius: 8px;">
            ${imageHtml}
            ${heading ? `<h1 class="hero-heading">${heading}</h1>` : ''}
            ${subheading ? `<p class="hero-subheading" style="font-size: 1.2em; color: #666;">${subheadingHtml}</p>` : ''}
            ${descriptionHtml ? `<div class="hero-description" style="margin: 10px 0;">${descriptionHtml}</div>` : ''}
            ${buttonHtml}
        </div>
    `;
}

/**
 * Render a teaser block.
 * Shows placeholder when href is empty, content when href has value.
 * By default, shows target page title/description from href.
 * Only uses block.title/description when overwrite is true.
 *
 * For listing items, hydra.js uses the readonly registry (set by expandListingBlocks)
 * to determine if fields should be editable.
 *
 * @param {Object} block - Teaser block data
 * @param {string|null} blockUid - Block UID (null if inside a container with its own UID)
 * @returns {string} HTML string (includes wrapper with data-block-uid)
 */
function renderTeaserBlock(block, blockUid) {
    const hrefObj = Array.isArray(block.href) && block.href.length > 0 ? block.href[0] : null;

    // Determine whether to use block data or hrefObj data for ALL fields (no mixing)
    // - overwrite=true: user wants custom data → use block data
    // - overwrite=false but hrefObj has no content data: use block data (e.g., listing items)
    // - overwrite=false and hrefObj has content data: use hrefObj data (object browser selection)
    const hrefObjHasContentData = hrefObj?.title !== undefined;
    const useBlockData = block.overwrite || !hrefObjHasContentData;

    // Get href: always from hrefObj @id (link destination). Strip apiOrigin
    // so brain-absolute URLs render as same-origin relative paths.
    const href = stripApiOrigin(hrefObj?.['@id'] || '');

    // Get title/description/image based on useBlockData (all or nothing, no mixing)
    const title = useBlockData ? (block.title || '') : (hrefObj?.title || '');
    const description = useBlockData ? (block.description || '') : (hrefObj?.description || '');

    let imageSrc = '';
    if (block.preview_image) {
        // Use block's own preview_image if available (covers both overwrite=true
        // and conversion cases where block has image data but link target doesn't)
        imageSrc = getImageUrl(block.preview_image);
    } else if (!useBlockData && hrefObj?.hasPreviewImage && hrefObj?.['@id']) {
        imageSrc = getImageUrl({ '@id': hrefObj['@id'] + '/@@images/preview_image' });
    }

    // Only add data-block-uid if blockUid is provided (not when inside a container that already has it)
    const blockUidAttr = blockUid ? `data-block-uid="${blockUid}"` : '';


    // If href is empty, show placeholder for starter UI (only for standalone teasers)
    if (!href && blockUid) {
        return `
            <div ${blockUidAttr} class="teaser-block teaser-placeholder" style="padding: 40px 20px; background: #f5f5f5; border: 2px dashed #ccc; border-radius: 8px; text-align: center; min-height: 150px; display: flex; align-items: center; justify-content: center;">
                <p style="color: #999; margin: 0;">Select a target page for this teaser</p>
            </div>
        `;
    }

    // Show teaser content when href has value
    const imageHtml = imageSrc
        ? `<img data-edit-media="preview_image" src="${imageSrc}" alt="" style="max-width: 100%; height: auto; margin-bottom: 10px; border-radius: 4px;" />`
        : `<div data-edit-media="preview_image" style="height: 100px; background: #ddd; display: flex; align-items: center; justify-content: center; margin-bottom: 10px; border-radius: 4px; cursor: pointer;">Click to add image</div>`;

    // When overwrite is false, add data-block-readonly to prevent editing
    // User must check "Customize teaser content" checkbox to enable editing
    const readonlyAttr = block.overwrite ? '' : 'data-block-readonly';

    // Always include editable/linkable attributes - hydra.js respects data-block-readonly
    return `
        <div ${blockUidAttr} ${readonlyAttr} class="teaser-block" style="padding: 20px; background: #f9f9f9; border-radius: 8px;">
            ${imageHtml}
            <a href="${href || '#'}" data-edit-link="href" style="display: block; margin: 0 0 10px 0; text-decoration: none; color: inherit;">
                <h3 data-edit-text="title" style="margin: 0;">${title}</h3>
            </a>
            <p data-edit-text="description" style="color: #666; margin: 0;">${description}</p>
            <a href="${href || '#'}" data-edit-link="href" style="display: inline-block; margin-top: 10px; color: #007eb1; text-decoration: none;">Read more →</a>
        </div>
    `;
}

/**
 * Render a default result item (simple title + description).
 * @param {Object} block - Block data
 * @param {string} blockUid - Block UID
 * @returns {string} HTML string
 */
function renderDefaultItemBlock(block, blockUid) {
    const hrefObj = Array.isArray(block.href) && block.href.length > 0 ? block.href[0] : null;
    const href = window._contentPath(typeof block.href === 'string' ? block.href : (hrefObj?.['@id'] || ''));
    const title = block.title || hrefObj?.title || '';
    const description = block.description || hrefObj?.description || '';
    const blockUidAttr = blockUid ? `data-block-uid="${blockUid}"` : '';

    return `
        <div ${blockUidAttr} class="default-item-block" style="padding: 15px; border-bottom: 1px solid #eee;">
            <a href="${href || '#'}" data-edit-link="href" style="text-decoration: none; color: inherit;">
                <h4 data-edit-text="title" style="margin: 0 0 5px 0;">${title}</h4>
            </a>
            <p data-edit-text="description" style="color: #666; margin: 0; font-size: 14px;">${description}</p>
        </div>
    `;
}

/**
 * Render a summary result item (title + description + image).
 * @param {Object} block - Block data
 * @param {string} blockUid - Block UID
 * @returns {string} HTML string
 */
function renderSummaryItemBlock(block, blockUid) {
    const hrefObj = Array.isArray(block.href) && block.href.length > 0 ? block.href[0] : null;
    const href = window._contentPath(typeof block.href === 'string' ? block.href : (hrefObj?.['@id'] || ''));
    const title = block.title || hrefObj?.title || '';
    const description = block.description || hrefObj?.description || '';
    const blockUidAttr = blockUid ? `data-block-uid="${blockUid}"` : '';

    // NOT _contentPath: that strips the API origin so a LINK stays same-origin
    // for navigation (see href above). An image src must keep it — the bytes are
    // served by the API, and stripping it made the browser resolve
    // "/…/@@images/preview_image-800-….svg" against the FRONTEND, which 404s.
    const imageSrc = block.image ? getImageUrl(block.image) : '';

    const imageHtml = imageSrc
        ? `<img data-edit-media="image" src="${imageSrc}" alt="" style="width: 80px; height: 60px; object-fit: cover; margin-right: 15px; border-radius: 4px;" />`
        : '';

    const dateHtml = block.date
        ? `<time style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #333; margin-bottom: 4px;">${new Date(block.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>`
        : '';

    return `
        <div ${blockUidAttr} class="summary-item-block" style="padding: 15px; border-bottom: 1px solid #eee; display: flex; align-items: flex-start;">
            ${imageHtml}
            <div style="flex: 1;">
                ${dateHtml}
                <a href="${href || '#'}" data-edit-link="href" style="text-decoration: none; color: inherit;">
                    <h4 data-edit-text="title" style="margin: 0 0 5px 0;">${title}</h4>
                </a>
                <p data-edit-text="description" style="color: #666; margin: 0; font-size: 14px;">${description}</p>
            </div>
        </div>
    `;
}

/**
 * Render an image block.
 * @param {Object} block - Image block data
 * @returns {string} HTML string
 */
function renderImageBlock(block) {
    tfLog('renderImageBlock:', { url: block.url, type: typeof block.url, hasImageScales: !!block.url?.image_scales });
    const imageSrc = getImageUrl(block.url) || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23e5e7eb%22/%3E%3C/svg%3E';
    // Volto's image block uses 'placeholder' for alt text, not 'alt'
    const alt = block.placeholder || block.alt || '';
    const href = getLinkUrl(block.href);

    // Add data-edit-media="url" for inline image editing
    const img = `<img data-edit-media="url" src="${imageSrc}" alt="${alt}" />`;

    // If href is set, wrap in link with data-edit-link on the <a>
    // This ensures hydra.js prevents navigation in edit mode
    if (href) {
        return `<a href="${href}" class="image-link" data-edit-link="href">${img}</a>`;
    }
    // No href yet - put data-edit-link on img so users can add a link
    return `<img data-edit-media="url" data-edit-link="href" src="${imageSrc}" alt="${alt}" />`;
}

/**
 * A map embed that builds its iframe inside a SHADOW ROOT.
 *
 * This is how embed components are really written — `<pdfjs-viewer-element>`,
 * `<lite-youtube>`, the map wrappers that gate a third-party frame behind
 * cookie consent — so the vendor iframe and its styles stay isolated from the
 * page. It is a plain custom element: no library, no network, nothing to
 * install.
 *
 * Hydra has to cope with the shape, which is why the test frontend renders maps
 * this way rather than as a bare iframe (the video block already covers that).
 * The shadow boundary hides the embed from ordinary traversal: querySelector()
 * from the block will not find the iframe, the iframe's closest() cannot reach
 * back out to the block, and document.activeElement reports the HOST element
 * when focus moves inside. Detecting an embed therefore has to pierce shadow
 * roots, and the host is the only way back to the block.
 * @returns {void}
 */
function defineMapEmbedElement() {
    if (customElements.get('map-embed')) return;
    customElements.define(
        'map-embed',
        class extends HTMLElement {
            connectedCallback() {
                if (this.shadowRoot) return;
                const root = this.attachShadow({ mode: 'open' });
                const frame = document.createElement('iframe');
                frame.src = this.getAttribute('src') || '';
                frame.title = this.getAttribute('frame-title') || 'Map';
                frame.loading = 'lazy';
                frame.setAttribute('allowfullscreen', '');
                frame.style.cssText = 'width:100%;height:450px;border:none;display:block';
                root.appendChild(frame);
            }
        },
    );
}
defineMapEmbedElement();

/**
 * Render a maps block.
 * @param {Object} block - Maps block data with url
 * @returns {string} HTML string
 */
function renderMapsBlock(block) {
    const url = block.url || '';
    const title = block.title || 'Map';
    if (url) {
        return `<div class="maps-block">
            <map-embed src="${url}" frame-title="${title}"></map-embed>
        </div>`;
    }
    return `<div class="maps-block"><p>No map URL set</p></div>`;
}

function renderVideoBlock(block) {
    const url = block.url || '';
    const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?/]+)/);
    if (ytMatch) {
        return `<div class="video-block">
            <iframe src="https://www.youtube.com/embed/${ytMatch[1]}" allowfullscreen
                style="width:100%;aspect-ratio:16/9;border:none" title="Video"></iframe>
        </div>`;
    }
    if (url) {
        return `<div class="video-block">
            <video src="${url}" controls style="width:100%"></video>
        </div>`;
    }
    return `<div class="video-block"><p>No video URL set</p></div>`;
}

/**
 * Render an introduction block — a standalone slate value used as page intro.
 * Data shape: { @type: 'introduction', value: [slate nodes…] }.
 * @param {Object} block - Introduction block data
 * @returns {string} HTML string
 */
function renderIntroductionBlock(block) {
    return renderSlateBlock(block);
}

/**
 * Render a heading block (standalone h1–h6).
 * @param {Object} block - Heading block data
 * @returns {string} HTML string
 */
/**
 * Render a suggest block: a labelled text box whose answer a vocabulary
 * completes (the live fetch is the docs example's job — the fixture renders
 * the resting markup: label, input, empty suggestion list).
 */
function renderSuggestBlock(block, blockId) {
    const label = block.label || '';
    const value = block.value || '';
    return `<div class="suggest">` +
        `<label for="${blockId}-input" data-edit-text="label">${label}</label>` +
        `<input id="${blockId}-input" name="answer" type="text" value="${value}" aria-autocomplete="list" autocomplete="off">` +
        `<ul class="suggest__list" hidden></ul>` +
        `</div>`;
}

function renderHeadingBlock(block) {
    const tag = block.tag || 'h2';
    const text = block.heading || '';
    return `<${tag} data-edit-text="heading">${text}</${tag}>`;
}

/**
 * Render a separator block (horizontal rule).
 * @param {Object} block - Separator block data
 * @returns {string} HTML string
 */
function renderSeparatorBlock(block) {
    const align = block.styles?.align || 'full';
    return `<hr class="separator-${align}" />`;
}

/**
 * Render a button block (CTA link).
 * @param {Object} block - Button block data
 * @returns {string} HTML string
 */
function renderButtonBlock(block) {
    const title = block.title || 'Button';
    const href = getLinkUrl(block.href) || '#';
    return `<a href="${href}" data-edit-text="title" data-edit-link="href" class="btn" style="display:inline-block;padding:10px 20px;background:#007eb1;color:white;text-decoration:none;border-radius:4px;">${title}</a>`;
}

/**
 * Render a highlight block (banner with background, overlay, CTA).
 * @param {Object} block - Highlight block data
 * @returns {string} HTML string
 */
function renderHighlightBlock(block) {
    const title = block.title || '';
    const imageSrc = getImageUrl(block.image);
    const ctaText = block.cta_title || '';
    const ctaLink = getLinkUrl(block.cta_link);
    const description = block.description || [];

    let descHtml = '';
    description.forEach((node) => {
        const nodeIdAttr = node.nodeId !== undefined ? ` data-node-id="${node.nodeId}"` : '';
        const text = renderChildren(node.children);
        descHtml += `<p data-edit-text="description"${nodeIdAttr}>${text}</p>`;
    });

    const highlightGradients = {
        'highlight-custom-color-1': 'linear-gradient(135deg, #1e3a5f, #2563eb)',
        'highlight-custom-color-2': 'linear-gradient(135deg, #064e3b, #059669)',
        'highlight-custom-color-3': 'linear-gradient(135deg, #581c87, #9333ea)',
        'highlight-custom-color-4': 'linear-gradient(135deg, #78350f, #d97706)',
        'highlight-custom-color-5': 'linear-gradient(135deg, #881337, #e11d48)',
    };
    const gradient = highlightGradients[block.styles?.descriptionColor] || 'linear-gradient(135deg, #334, #556)';
    const bgStyle = imageSrc ? `background-image:url(${imageSrc});background-size:cover;` : `background:${gradient};`;
    const ctaHtml = ctaText
        ? `<a href="${ctaLink || '#'}" data-edit-text="cta_title" data-edit-link="cta_link" style="display:inline-block;padding:10px 20px;background:#007eb1;color:white;text-decoration:none;border-radius:4px;">${ctaText}</a>`
        : '';

    // The image is drawn as a CSS background, so nothing carried
    // data-edit-media and highlight.image was uneditable everywhere it appeared.
    // The bridge only needs an element with dimensions, not an <img> — the
    // overlay covers the section, so annotate it. (Same fix as the nuxt
    // example's highlight.)
    return `<section class="highlight-block" style="${bgStyle}padding:40px 20px;color:white;border-radius:8px;">
        <div class="highlight-overlay" data-edit-media="image" style="background:rgba(0,0,0,0.4);padding:30px;border-radius:8px;">
            <h2 data-edit-text="title">${title}</h2>
            <div class="highlight-body">${descHtml}</div>
            ${ctaHtml}
        </div>
    </section>`;
}

/**
 * Render a callout block — a labelled admonition box (note/tip/warning/important).
 * Level = block.variation (drives label + colour); body = a slate value.
 * @param {Object} block - Callout block data
 * @returns {string} HTML string
 */
async function renderCalloutBlock(block) {
    const levels = {
        note:      { label: 'Note',      color: '#2563eb', bg: '#eff6ff' },
        tip:       { label: 'Tip',       color: '#059669', bg: '#ecfdf5' },
        warning:   { label: 'Warning',   color: '#d97706', bg: '#fffbeb' },
        important: { label: 'Important', color: '#dc2626', bg: '#fef2f2' },
    };
    const level = levels[block.variation] || levels.note;
    // The body is a region of child blocks (blocks_layout.items) — render each
    // through renderBlock, the shared container primitive.
    const blocks = block.blocks || {};
    const items = block.blocks_layout?.items || [];
    let bodyHtml = '';
    for (const id of items) {
        const el = await renderBlock(id, { ...blocks[id], '@uid': id });
        if (el) bodyHtml += el.outerHTML;
    }
    return `<aside class="callout callout--${block.variation || 'note'}" style="border-left:4px solid ${level.color};background:${level.bg};padding:12px 16px;border-radius:4px;margin:1em 0;">
        <div class="callout__label" style="font-weight:700;color:${level.color};text-transform:uppercase;font-size:0.8em;letter-spacing:0.05em;margin-bottom:4px;">${level.label}</div>
        <div class="callout__body">${bodyHtml}</div>
    </aside>`;
}

/**
 * Render a table-of-contents block.
 * Scans page blocks for headings.
 * @param {Object} block - TOC block data
 * @returns {string} HTML string
 */
function renderTocBlock(block) {
    const formData = window._currentFormData;
    const entries = [];
    if (formData?.blocks && formData?.blocks_layout?.items) {
        for (const id of formData.blocks_layout.items) {
            const b = formData.blocks[id];
            if (!b) continue;
            if (b['@type'] === 'heading' && b.heading) {
                entries.push({ id, level: parseInt((b.tag || 'h2').slice(1)), text: b.heading });
            } else if (b['@type'] === 'slate' && b.value?.[0]?.type?.match(/^h[1-6]$/)) {
                const level = parseInt(b.value[0].type.slice(1));
                const text = b.plaintext || b.value[0].children?.map(c => c.text).join('') || '';
                if (text.trim()) entries.push({ id, level, text });
            }
        }
    }
    if (entries.length === 0) {
        return `<nav class="toc-block"><p>Table of Contents</p></nav>`;
    }
    const lis = entries.map(e =>
        `<li style="margin-left:${(e.level - 2) * 1.5}em"><a href="#${e.id}">${e.text}</a></li>`
    ).join('');
    return `<nav class="toc-block"><ul>${lis}</ul></nav>`;
}

/**
 * Render a form block.
 * @param {Object} block - Form block data
 * @returns {string} HTML string
 */
function renderFormBlock(block) {
    const title = block.title || '';
    const description = block.description || '';
    const subblocks = block.subblocks || [];
    const submitLabel = block.submit_label || 'Submit';
    const successMessage = block.send_message || 'Thank you, your form has been submitted.';

    let html = '<form class="form-block" style="padding: 20px; border: 1px solid #ddd; border-radius: 8px;" novalidate>';
    if (title) {
        html += `<h2 data-edit-text="title">${title}</h2>`;
    }
    if (description) {
        html += `<p data-edit-text="description" style="color: #666;">${description}</p>`;
    }
    for (const field of subblocks) {
        const fieldId = field['field_id'] || field['@id'] || '';
        const fieldType = field.field_type || 'text';
        const label = field.label || '';
        const required = field.required || false;
        html += `<div class="form-field" data-block-uid="${fieldId}" data-block-add="bottom" style="margin-bottom: 12px;">`;
        html += `<label data-edit-text="label" style="display: block; margin-bottom: 4px; font-weight: bold;">${label}${required ? ' *' : ''}</label>`;
        if (fieldType === 'empty') {
            // A typed object_list item seeded as 'empty' (type in field_type, no @type).
            // Render a selectable placeholder; the admin supplies the '+' to pick its type.
            // No data-edit-text: "Empty field — pick a type" is a hint the
            // frontend writes, not content the author owns. No schema declares
            // a `placeholder` field, so annotating it promised an edit that
            // hydra correctly refuses — the same lie as a "Read More" label on
            // a block with no button.
            html += `<span style="color:#999;">Empty field — pick a type</span>`;
        } else if (fieldType === 'textarea') {
            html += `<textarea name="${fieldId}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" rows="3"></textarea>`;
        } else if (fieldType === 'select') {
            const values = field.input_values || [];
            html += `<select name="${fieldId}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">`;
            html += '<option value="">-- Select --</option>';
            for (const v of values) html += `<option value="${v}">${v}</option>`;
            html += '</select>';
        } else if (fieldType === 'checkbox') {
            html += `<input type="checkbox" name="${fieldId}" style="margin-right: 8px;" />`;
        } else if (fieldType === 'single_choice') {
            const values = field.input_values || [];
            for (const v of values) {
                html += `<label style="display: inline-flex; align-items: center; gap: 4px; margin-right: 16px;"><input type="radio" name="${fieldId}" value="${v}" /> ${v}</label>`;
            }
        } else {
            const inputType = fieldType === 'from' ? 'email' : fieldType;
            html += `<input type="${inputType}" name="${fieldId}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />`;
        }
        html += '</div>';
    }
    html += `<button type="button" class="form-submit" data-edit-text="submit_label" style="padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 4px;">${submitLabel}</button>`;
    html += '</form>';
    return html;
}

/**
 * Attach client-side validation to a rendered form block.
 * Called after innerHTML is set so the DOM elements exist.
 */
function attachFormValidation(formEl, block) {
    if (!formEl) return;
    const subblocks = block.subblocks || [];
    const submitBtn = formEl.querySelector('.form-submit');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', function () {
        // Clear previous errors
        formEl.querySelectorAll('.form-error').forEach(el => el.remove());

        let valid = true;

        for (const field of subblocks) {
            const fieldId = field['field_id'] || field['@id'] || '';
            const fieldType = field.field_type || 'text';
            if (!field.required) continue;

            const fieldDiv = formEl.querySelector(`.form-field[data-block-uid="${fieldId}"]`);
            if (!fieldDiv) continue;

            let hasError = false;
            let errorMsg = 'This field is required.';

            if (fieldType === 'checkbox') {
                const input = formEl.querySelector(`input[name="${fieldId}"]`);
                if (input && !input.checked) hasError = true;
            } else if (fieldType === 'from') {
                const input = formEl.querySelector(`input[name="${fieldId}"]`);
                if (input) {
                    if (!input.value) {
                        hasError = true;
                    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
                        hasError = true;
                        errorMsg = 'Please enter a valid email address.';
                    }
                }
            } else if (fieldType === 'select') {
                const select = formEl.querySelector(`select[name="${fieldId}"]`);
                if (select && !select.value) hasError = true;
            } else if (fieldType === 'textarea') {
                const textarea = formEl.querySelector(`textarea[name="${fieldId}"]`);
                if (textarea && !textarea.value.trim()) hasError = true;
            } else {
                const input = formEl.querySelector(`input[name="${fieldId}"]`);
                if (input && !input.value.trim()) hasError = true;
            }

            if (hasError) {
                valid = false;
                const errorEl = document.createElement('div');
                errorEl.className = 'form-error';
                errorEl.style.cssText = 'color: red; font-size: 13px; margin-top: 4px;';
                errorEl.textContent = errorMsg;
                fieldDiv.appendChild(errorEl);
            }
        }

        if (valid) {
            const successMessage = block.send_message || 'Thank you, your form has been submitted.';
            const successDiv = document.createElement('div');
            successDiv.className = 'form-success';
            successDiv.style.cssText = 'color: green; margin-top: 16px; padding: 12px; background: #f0fff0; border-radius: 4px;';
            successDiv.textContent = successMessage;
            formEl.appendChild(successDiv);
        }
    });
}

/**
 * Object-nested blocks_layout (#245). The `content` object holds its OWN shared
 * blocks dict + blocks_layout; the `body` region lists ids into content.blocks.
 * Renders each child with data-block-uid so the bridge can select/edit them.
 * @param {Object} block - objectBlocks data with block.content.{blocks,blocks_layout}
 * @returns {Promise<string>} HTML string
 */
async function renderObjectBlocksBlock(block) {
    const content = block.content || {};
    const blocks = content.blocks || {};
    const bodyItems = content.blocks_layout?.body || [];

    // Inline-editable text field living directly on the object
    // (block.content.headline) — a slate field, marked data-edit-text so hydra
    // sets it contenteditable, exactly like a top-level slate field.
    let html = '';
    const headline = content.headline;
    if (Array.isArray(headline) && headline[0]) {
        const node = headline[0];
        const nodeIdAttr = node.nodeId !== undefined ? ` data-node-id="${node.nodeId}"` : '';
        const text = renderChildren(node.children);
        html += `<h3 class="ob-headline" data-edit-text="content/headline"${nodeIdAttr}>${text}</h3>`;
    }
    // Inline-editable LINK field on the object (block.content.href) — addressed
    // by its /-path, edited via the central field-access API.
    if (content.href !== undefined) {
        html += `<a class="ob-link" data-edit-link="content/href" href="${content.href || '#'}">Object link</a>`;
    }
    html += '<div class="object-blocks-body">';
    for (const childId of bodyItems) {
        const child = blocks[childId];
        if (!child || !child['@type']) continue;
        html += `<div data-block-uid="${childId}" data-block-add="bottom">`;
        switch (child['@type']) {
            case 'slate':
                html += renderSlateBlock(child);
                break;
            case 'image':
                html += renderImageBlock(child);
                break;
            default:
                html += `<p data-unknown-block-type="${child['@type']}">[not implemented]</p>`;
        }
        html += '</div>';
    }
    html += '</div>';
    return html;
}

/**
 * Render a columns container block.
 * One blocks_layout slot (`columns`) restricted to `column` children.
 * Calls window._expandListingBlocks for nested listings in columns.
 * @param {Object} block - Columns block data with shared blocks dict + columns layout field
 * @returns {Promise<string>} HTML string
 */
async function renderColumnsBlock(block) {
    // 'columns' is a blocks field: its name is the key in the shared blocks_layout
    // dict, and child blocks live in the shared blocks dict.
    const blocks = block.blocks || {};
    const columnsItems = block.blocks_layout?.columns || [];
    const title = block.title || '';

    let html = '';

    // Render editable title for columns block
    if (title) {
        html += `<h3 data-edit-text="title" class="columns-title" style="margin-bottom: 10px;">${title}</h3>`;
    }

    // Render columns container (columns go right)
    html += '<div class="columns-row" style="display: flex; gap: 20px;">';

    for (const columnId of columnsItems) {
        const column = blocks[columnId];
        if (!column) continue;

        // Render column as a nested block with data-block-uid and data-block-add="right"
        html += `<div data-block-uid="${columnId}" data-block-add="right" class="column" style="flex: 1; padding: 10px; border: 1px dashed #ccc;">`;
        html += await renderColumnContent(column, columnId);
        html += '</div>';
    }

    html += '</div>';
    return html;
}

/**
 * Render a column block content (the content blocks inside a column).
 * Content blocks go down (data-block-add="bottom").
 * Calls window._expandListingBlocks for nested listings.
 * @param {Object} column - Column block data with blocks/blocks_layout
 * @param {string} columnId - Column ID for expansion
 * @returns {Promise<string>} HTML string
 */
async function renderColumnContent(column, columnId) {
    let blocks = column.blocks || {};
    let items = column.blocks_layout?.items || [];
    const title = column.title || '';

    const { items: expandedItems } = await expandItems(blocks, items, columnId);

    let html = '';

    // Render editable title for column block
    if (title) {
        html += `<h4 data-edit-text="title" class="column-title" style="margin-bottom: 8px; font-size: 14px;">${title}</h4>`;
    }

    const itemsToRender = expandedItems;
    for (const item of itemsToRender) {
        const blockId = item['@uid'];
        const block = item;
        if (!block || !block['@type']) continue;

        // Render nested content block with data-block-uid and data-block-add="bottom"
        html += `<div data-block-uid="${blockId}" data-block-add="bottom">`;

        // Render inner content based on block type
        switch (block['@type']) {
            case 'slate':
                html += renderSlateBlock(block);
                break;
            case 'image':
                html += renderImageBlock(block);
                break;
            case 'teaser':
                html += renderTeaserBlock(block, null);
                break;
            case 'form':
                html += renderFormBlock(block);
                break;
            default:
                html += `<p data-unknown-block-type="${block['@type']}">[not implemented]</p>`;
        }

        html += '</div>';
    }

    return html || '<p style="color: #999;">Empty column</p>';
}

/**
 * Render a column block (standalone, if needed).
 * @param {Object} block - Column block data
 * @returns {string} HTML string
 */
function renderColumnBlock(block) {
    return renderColumnContent(block);
}

/**
 * Render a generic section block — vertical-stacked children with no
 * allowedBlocks restriction. Test-only block for container UX features
 * (wrap, unwrap, edge-drag, convert).
 * @param {Object} block
 * @returns {Promise<string>} HTML string
 */
/**
 * Conversion-test container renderer. Like renderSectionBlock but marks each
 * child `data-block-add="bottom"` so getAddDirection treats the vertically
 * stacked children as a vertical list (nested blocks default to 'right'/
 * horizontal without this) — keeping drop-position resolution on the Y axis.
 */
async function renderConvBox(block) {
    const blocks = block.blocks || {};
    const items = block.blocks_layout?.items || [];
    let html = '<div class="section-body" style="padding: 12px; border: 1px dashed #888; border-radius: 4px;">';
    for (const childId of items) {
        const child = blocks[childId];
        if (!child) continue;
        const rendered = await renderBlock(childId, child);
        let el = rendered;
        if (rendered instanceof DocumentFragment) {
            const c = document.createElement('div');
            c.appendChild(rendered);
            el = c.firstElementChild;
        }
        if (el && el.setAttribute) el.setAttribute('data-block-add', 'bottom');
        html += el ? el.outerHTML : '';
    }
    html += '</div>';
    return html;
}

/**
 * Nested-container renderer for the container→container conversion test. Stamps
 * `data-container-type` (the block's @type) so the test can assert a container's
 * converted type, and renders children with `data-block-add="bottom"` (vertical).
 */
async function renderConvGroup(block) {
    const blocks = block.blocks || {};
    const items = block.blocks_layout?.items || [];
    let html = `<div class="section-body" data-container-type="${block['@type']}" style="padding: 12px; border: 1px solid #4a90d9; border-radius: 4px;">`;
    for (const childId of items) {
        const child = blocks[childId];
        if (!child) continue;
        const rendered = await renderBlock(childId, child);
        let el = rendered;
        if (rendered instanceof DocumentFragment) {
            const c = document.createElement('div');
            c.appendChild(rendered);
            el = c.firstElementChild;
        }
        if (el && el.setAttribute) el.setAttribute('data-block-add', 'bottom');
        html += el ? el.outerHTML : '';
    }
    html += '</div>';
    return html;
}

async function renderSectionBlock(block) {
    const blocks = block.blocks || {};
    const items = block.blocks_layout?.items || [];

    let html = '<div class="section-body" style="padding: 12px; border: 1px dashed #888; border-radius: 4px;">';
    for (const childId of items) {
        const child = blocks[childId];
        if (!child) continue;
        const rendered = await renderBlock(childId, child);
        // renderBlock returns a DOM node with data-block-uid attr already set.
        if (rendered instanceof DocumentFragment) {
            const container = document.createElement('div');
            container.appendChild(rendered);
            html += container.innerHTML;
        } else {
            html += rendered.outerHTML;
        }
    }
    html += '</div>';
    return html;
}

/**
 * Render a contextNavigation block. Wraps its `items` children in <nav><ul>
 * with a mobile disclosure <button>. Children (navItem + listing) render
 * themselves; the wrapping <ul> provides the list semantics. Active /
 * in-path classes are computed inside renderNavItemBlock from each link's
 * href vs window.location.pathname.
 */
async function renderContextNavigationBlock(block, blockId) {
    const ariaLabel = block.ariaLabel;
    const blocks = block.blocks;
    const items = block.blocks_layout?.items || [];
    const uid = blockId;

    // Hydra seeds an '@type: empty' placeholder when a container has no defaultBlockType and
    // multiple allowedBlocks (getEmptyBlockType returns 'empty'). A custom container renderer
    // MUST tolerate that transient type — render it as a plain, selectable placeholder (not
    // throw). The admin then shows a '+' on the selected empty to pick its type; the renderer
    // doesn't need to make it clickable itself.
    const emptyChildId = items.find((id) => blocks[id]?.['@type'] === 'empty');
    if (emptyChildId) {
        return `<nav data-block-uid="${escapeAttr(uid)}" aria-label="${escapeHtml(ariaLabel)}" class="context-navigation">` +
            `<div data-block-uid="${escapeAttr(emptyChildId)}" style="display:block;min-height:40px;padding:0.5rem;color:#999;">` +
            `Empty navigation — pick a type` +
            `</div>` +
            `</nav>`;
    }

    // First pass: walk children and collect a flat list of {block, blockId}
    // entries. listing children are expanded inline so all their items
    // join the same flat list. b_size is large so nav listings never
    // paginate — paging in a sectionNav makes no UX sense.
    const NAV_LISTING_SIZE = 1000;
    const flat = [];
    for (const childId of items) {
        const child = blocks[childId];
        if (child['@type'] === 'navItem') {
            flat.push({ block: child, blockId: childId });
        } else if (child['@type'] === 'listing') {
            // The cnav listing's `relativePath ..` means "my section".
            // Fetched from the current page, Plone's @querystring-search
            // drops the current page — it always excludes its own context
            // object — so the page can't appear in its own nav. Fetch from
            // the PARENT folder instead and step the relativePath down one
            // level (`..` -> `.`): same tree slice, but the current page
            // comes back as a normal result with its getObjPositionInParent
            // (so it sorts into place); only the parent is excluded.
            const curPath = window.location.pathname.replace(/\/edit$/, '');
            const parentPath = curPath.replace(/\/[^/]+\/?$/, '') || '/';
            const stepDown = (v) => {
                const s = String(v || '').split('/').filter(Boolean);
                if (s[0] === '..') s.shift();
                return s.length ? s.join('/') : '.';
            };
            const shifted = {
                ...child,
                querystring: {
                    ...child.querystring,
                    query: (child.querystring?.query || []).map((c) =>
                        c.i === 'path' && c.o?.includes('relativePath')
                            ? { ...c, v: stepDown(c.v) }
                            : c,
                    ),
                },
            };
            const { items: expanded } = await window._expandListingBlocks(
                { [childId]: shifted },
                [childId],
                childId,
                { start: 0, size: NAV_LISTING_SIZE },
                parentPath,
            );
            for (const item of expanded) {
                flat.push({ block: item, blockId: item['@uid'] });
            }
        } else {
            throw new Error(`contextNavigation child of @type "${child['@type']}" is not allowed (expected navItem or listing)`);
        }
    }

    // Optional: prepend the section root itself (Volto's `includeTop`).
    // The section root is the parent of any shallowest item — listings
    // anchored on a single path always share that parent. We fetch the
    // root's basic data (just for label) and prepend before level/filter
    // passes so it gets level-1 and is treated as "current path ancestor"
    // by the smart-expansion filter.
    if (block.includeTop && flat.length > 0) {
        const pathSegsOf2 = (entry) => {
            const h = Array.isArray(entry.block.href) && entry.block.href.length > 0
                ? entry.block.href[0]['@id'] : null;
            return h ? new URL(h, window.location.origin).pathname.split('/').filter(Boolean) : [];
        };
        const segsList = flat.map(pathSegsOf2);
        const minDepthForRoot = Math.min(...segsList.map((s) => s.length));
        const shallow = segsList.find((s) => s.length === minDepthForRoot);
        const rootSegs = shallow.slice(0, -1);
        if (rootSegs.length > 0) {
            const rootPath = '/' + rootSegs.join('/');
            const res = await fetch(`${window._apiOrigin}/++api++${rootPath}`, {
                headers: { 'Accept': 'application/json' },
            });
            const rootData = await res.json();
            flat.unshift({
                block: {
                    '@type': 'navItem',
                    label: rootData.title,
                    href: [{ '@id': rootData['@id'] }],
                },
                blockId: `${uid}-top`,
            });
        }
    }

    // Second pass: compute level = depth(href) - minDepth + 1, clamped to 1..3.
    const pathSegsOf = (entry) => {
        // A fresh navItem has no href yet — treat it as depth 0 (a new top-level item)
        // rather than crashing on href[0].
        const h = Array.isArray(entry.block.href) && entry.block.href.length > 0
            ? entry.block.href[0]['@id'] : null;
        return h ? new URL(h, window.location.origin).pathname.split('/').filter(Boolean) : [];
    };
    let allSegs = flat.map(pathSegsOf);
    const depths = allSegs.map((s) => s.length);
    const minDepth = Math.min(...depths);
    flat.forEach((entry, i) => {
        entry.block._level = Math.max(1, Math.min(3, depths[i] - minDepth + 1));
    });

    // Orphan prune: a listing filter (e.g. exclude_from_nav) can drop a
    // folder while still returning its deeper, non-excluded descendants.
    // Those would otherwise surface as stray roots. Drop any entry with a
    // missing ancestor between the section root and itself — hiding a
    // folder should hide its whole subtree.
    let pruned = flat;
    {
        const pathSet = new Set(allSegs.map((s) => '/' + s.join('/')));
        const hasAllAncestors = (segs) => {
            for (let d = minDepth; d < segs.length; d++) {
                if (!pathSet.has('/' + segs.slice(0, d).join('/'))) return false;
            }
            return true;
        };
        const keep = allSegs.map(hasAllAncestors);
        pruned = flat.filter((_e, i) => keep[i]);
        allSegs = allSegs.filter((_s, i) => keep[i]);
    }

    // Third pass: optional smart-expansion filter — drop entries that are
    // descendants of unrelated siblings (typical docs sidebar UX). An
    // entry survives if it sits on the ancestor chain of the current page,
    // is a sibling along that chain, or is a descendant of the current
    // page. `expandCurrentOnly` defaults true (schema default).
    const expandCurrentOnly = block.expandCurrentOnly !== false;
    const visible = expandCurrentOnly
        ? filterByCurrentPath(pruned, allSegs, minDepth)
        : pruned;

    // `data-block-selector` carries the contextNavigation's uid + every
    // exposed child id (manual navItem ids and the listing block id
    // whose synthesised items share that uid). Word-list match in
    // the bridge means selecting any of those uids opens the disclosure.
    const exposedUids = [uid, ...items].join(' ');

    let html = `<nav data-block-uid="${escapeAttr(uid)}" aria-label="${escapeHtml(ariaLabel)}" class="context-navigation">`;
    // Mobile-first: rendered without `[open]`. syncCnavOpenState() runs
    // after every render and a global matchMedia listener resyncs on
    // resize. Below 768px the disclosure is naturally collapsed; at or
    // above, the bridge / matchMedia opens it. Native <details>
    // visibility semantics drive Playwright + screen readers, so the
    // `open` attribute is the single source of truth — not CSS.
    html += `<details class="context-navigation-disclosure">`;
    // Summary doubles as the visible header (desktop: styled as a small-
    // caps section label, à la Stripe/MDN/Primer; mobile: tap target for
    // the disclosure). block.ariaLabel renders inside [data-edit-text]
    // so authors can inline-edit the heading; clicking the span fires
    // <details>'s native toggle as a side-effect, but the summary stays
    // visible whether open or closed, so editing continues without
    // losing the cursor.
    html += `<summary class="context-navigation-summary" data-block-selector="${escapeAttr(exposedUids)}"><span data-edit-text="ariaLabel">${escapeHtml(ariaLabel)}</span></summary>`;
    html += `<ul role="list" id="${uid}-list" class="context-navigation-list">`;
    for (const entry of visible) {
        html += `<li>${renderNavItemBlock(entry.block, entry.blockId)}</li>`;
    }
    html += '</ul></details></nav>';
    return html;
}

/**
 * Smart-expansion filter for contextNavigation entries. Keeps:
 *   - any entry whose path is on the ancestor chain of the current page
 *   - any entry that's a sibling at some ancestor level (parent on chain)
 *   - any entry that's a descendant of the current page
 * Drops descendants of unrelated siblings.
 *
 * Comparison starts at `minDepth - 1` — the segment index where the
 * shallowest sibling sits — so the "section root" inferred from the
 * listing's path filter is treated as the shared common prefix.
 */
function filterByCurrentPath(flat, allSegs, minDepth) {
    const currSegs = window.location.pathname
        .replace(/\/edit$/, '')
        .split('/').filter(Boolean);
    const startIdx = minDepth - 1;

    return flat.filter((_entry, idx) => {
        const itemSegs = allSegs[idx];
        const lastItemIdx = itemSegs.length - 1;
        for (let i = startIdx; i < itemSegs.length; i++) {
            if (i >= currSegs.length) {
                // Item is deeper than current; previous segments matched,
                // so the item is a descendant of the current page.
                return true;
            }
            if (itemSegs[i] !== currSegs[i]) {
                // Divergence — survive only if it's the last segment
                // (sibling at an ancestor level).
                return i === lastItemIdx;
            }
        }
        // All matched up to item's length: item is current or an ancestor.
        return true;
    });
}

/**
 * Render a single navItem row. The block always has shape:
 *   { label: string, href: [{ '@id': string }] }
 * Manual authoring uses object_browser (produces that shape), listing-synth
 * uses fieldMappings with type='link' on @id (produces the same shape).
 * Level is auto-derived elsewhere and passed via block._level (set by
 * renderContextNavigationBlock after collecting all sibling depths).
 */
function renderNavItemBlock(block, blockId) {
    // A freshly-typed navItem (e.g. picked for a seeded empty) has no href/label yet —
    // render an editable placeholder instead of crashing on block.href[0].
    const hrefObj = Array.isArray(block.href) && block.href.length > 0 ? block.href[0] : null;
    const label = block.label || 'New navigation item';
    const level = block._level;
    const uid = blockId;

    const itemPath = hrefObj?.['@id']
        ? new URL(hrefObj['@id'], window.location.origin).pathname
        : '';
    const currentPath = window.location.pathname.replace(/\/edit$/, '');
    const active = !!itemPath && itemPath === currentPath;
    const inPath = !active && !!itemPath && currentPath.startsWith(itemPath.replace(/\/$/, '') + '/');

    const classes = [
        'nav-item',
        `level-${level}`,
        active ? 'current' : '',
        inPath ? 'in-path' : '',
    ].filter(Boolean).join(' ');
    const ariaCurrent = active ? ' aria-current="page"' : '';

    // Both annotations live here in edit mode:
    //   data-edit-link="href"   — clicking the link opens the picker for
    //                              navItem.href (the object_browser field)
    //   data-edit-text="label"  — clicking the label text inline-edits it
    // No data-linkable-allow: that would steal the click before either edit
    // annotation could fire — block-sanity flags that contradiction.
    return `<a href="${escapeAttr(itemPath || '#')}" data-block-uid="${escapeAttr(uid)}" class="${classes}"${ariaCurrent} data-edit-link="href">` +
        `<span data-edit-text="label">${escapeHtml(label)}</span>` +
        `</a>`;
}

// Minimal HTML escapers — renderer.js doesn't ship a helper module.
function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Render paging controls for listing/grid blocks.
 * @param {Object} paging - Paging object from computePagingUI
 * @param {string} blockId - Block ID for URL params
 * @returns {string} HTML string
 */
function renderPaging(paging, blockId) {
    const buildUrl = (page) => {
        const url = new URL(window.location.href);
        if (page > 0) {
            url.searchParams.set(`pg_${blockId}`, page);
        } else {
            url.searchParams.delete(`pg_${blockId}`);
        }
        return url.pathname + url.search;
    };

    // Step size for the reveal: data-block-selector="+N"/"-N" tells hydra how many
    // items one page-step moves, so tryMakeBlockVisible can synthesise clicks on
    // Next/Prev to page a hidden child into view — client-side, no reload (see the
    // delegated pager handler in index.html). Mirrors nuxt's Paging.vue.
    const step = paging.size || 6;
    let html = '<nav class="grid-paging" aria-label="Page Navigation" style="margin-top: 15px; text-align: center;">';

    if (paging.prev !== null) {
        html += `<a href="${buildUrl(paging.prev)}" data-linkable-allow data-block-selector="-${step}" class="paging-prev" style="margin: 0 5px; padding: 5px 10px; border: 1px solid #ccc; text-decoration: none;">← Prev</a>`;
    }

    paging.pages.forEach(p => {
        const pageIndex = p.page - 1;
        const isCurrent = pageIndex === paging.currentPage;
        const style = isCurrent
            ? 'margin: 0 3px; padding: 5px 10px; background: #007bff; color: white; border: 1px solid #007bff; text-decoration: none;'
            : 'margin: 0 3px; padding: 5px 10px; border: 1px solid #ccc; text-decoration: none;';
        html += `<a href="${buildUrl(pageIndex)}" data-linkable-allow class="paging-page${isCurrent ? ' current' : ''}" style="${style}">${p.page}</a>`;
    });

    if (paging.next !== null) {
        html += `<a href="${buildUrl(paging.next)}" data-linkable-allow data-block-selector="+${step}" class="paging-next" style="margin: 0 5px; padding: 5px 10px; border: 1px solid #ccc; text-decoration: none;">Next →</a>`;
    }

    html += '</nav>';
    return html;
}

/**
 * Render a standalone listing block with paging.
 * Returns a DocumentFragment so items appear at page level (multi-element block pattern).
 * @param {Object} block - Listing block data with querystring
 * @param {string} blockId - Block ID
 * @returns {Promise<DocumentFragment>} Fragment with listing items + paging
 */
async function renderListingBlock(block, blockId) {
    const fragment = document.createDocumentFragment();
    const blocks = { [blockId]: block };
    const layout = [blockId];

    const PAGE_SIZE = 6;
    const currentPage = (window._pagingPages || {})[blockId] || 0;
    const { items: expandedItems, paging } = await window._expandListingBlocks(blocks, layout, blockId, { start: currentPage * PAGE_SIZE, size: PAGE_SIZE });
    const showPaging = paging?.totalPages > 1 ? paging : null;

    for (const childBlock of expandedItems) {
        if (!childBlock) continue;
        const itemEl = await renderBlock(childBlock['@uid'], childBlock);
        if (itemEl) {
            fragment.appendChild(itemEl);
        }
    }

    if (paging) {
        const pagingContainer = document.createElement('div');
        pagingContainer.innerHTML = renderPaging(paging, blockId);
        fragment.appendChild(pagingContainer.firstElementChild);
    }

    return fragment;
}

/**
 * Render a grid block (Volto's built-in container).
 * NO explicit data-block-add attributes - tests automatic direction inference.
 * Calls window._expandListingBlocks for nested listings (set by index.html).
 * @param {Object} block - Grid block data with blocks/blocks_layout
 * @param {string} blockId - Block ID for paging URL
 * @returns {Promise<string>} HTML string
 */
async function renderGridBlock(block, blockId) {
    const PAGE_SIZE = 6;
    let blocks = block.blocks || {};
    let items = block.blocks_layout?.items || [];
    let paging = block._paging;

    const currentPage = (window._pagingPages || {})[blockId] || 0;
    const result = await expandItems(blocks, items, blockId, { start: currentPage * PAGE_SIZE, size: PAGE_SIZE });
    const expandedItems = result.items;
    paging = result.paging?.totalPages > 1 ? result.paging : null;

    let html = '<div class="grid-row" style="display: flex; flex-wrap: wrap; gap: 20px;">';

    const itemsToRender = expandedItems;

    for (const childBlock of itemsToRender) {
        if (!childBlock) continue;

        // Use @uid from block for data-block-uid
        const uid = childBlock['@uid'];

        // All grid cells have data-block-uid so clicking anywhere in the cell selects the block
        html += `<div data-block-uid="${uid}" class="grid-cell" style="flex: 0 0 calc(25% - 15px); padding: 10px; border: 1px dashed #999;">`;

        // Render inner content based on block type
        // Note: Don't pass uid to render functions - grid-cell already has data-block-uid
        switch (childBlock['@type']) {
            case 'teaser':
                html += renderTeaserBlock(childBlock, null);
                break;
            case 'slate':
                html += renderSlateBlock(childBlock);
                break;
            case 'image':
                html += renderImageBlock(childBlock);
                break;
            case 'summary':
                html += renderSummaryItemBlock(childBlock, null);
                break;
            case 'default':
                html += renderDefaultItemBlock(childBlock, null);
                break;
            case 'empty':
                html += renderEmptyBlock(childBlock);
                break;
            default:
                html += `<p data-unknown-block-type="${childBlock['@type']}">[not implemented]</p>`;
        }

        html += '</div>';
    }

    html += '</div>';

    if (paging) {
        html += renderPaging(paging, blockId);
    }

    return html;
}

/**
 * Render a carousel container block.
 * Carousel shows ONE slide at a time - others are hidden.
 * Has prev/next buttons with data-block-selector for navigation.
 *
 * When admin selects a hidden slide, hydra.js should click the appropriate
 * data-block-selector element to bring that slide into view.
 *
 * @param {Object} block - Carousel block data with slides/slides_layout
 * @returns {string} HTML string
 */
function renderCarouselBlock(block) {
    const slides = block.slides || {};
    const slidesLayout = block.slides_layout || { items: [] };
    const items = slidesLayout.items || [];

    // Track which slide is currently active (first by default)
    const activeSlideId = items[0] || null;

    let html = '<div class="carousel-container" style="position: relative; padding: 20px; background: #f5f5f5; border-radius: 8px; min-height: 120px;">';

    // Navigation button - Previous (selects previous sibling)
    html += '<button data-block-selector="-1" class="carousel-prev" style="position: absolute; left: 5px; top: 50%; transform: translateY(-50%); z-index: 10; padding: 10px; cursor: pointer;">←</button>';

    // Slides container - only ONE slide visible at a time
    html += '<div class="slides-wrapper" style="position: relative; margin: 0 50px; min-height: 80px;">';

    items.forEach((slideId, index) => {
        const slide = slides[slideId];
        if (!slide) return;

        // Only first slide is visible, others are hidden
        const isActive = slideId === activeSlideId;
        const displayStyle = isActive ? 'block' : 'none';

        // Render slide as nested block - hidden slides still have data-block-uid
        html += `<div data-block-uid="${slideId}" data-block-add="right" class="slide ${isActive ? 'active' : ''}" style="display: ${displayStyle}; padding: 15px; background: white; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">`;
        html += renderSlideBlock(slide);
        html += '</div>';
    });

    html += '</div>';

    // Navigation button - Next (selects next sibling)
    html += '<button data-block-selector="+1" class="carousel-next" style="position: absolute; right: 5px; top: 50%; transform: translateY(-50%); z-index: 10; padding: 10px; cursor: pointer;">→</button>';

    // Direct selector buttons for each slide (like dot indicators)
    // Only show dots for first half of slides to test both direct selector and +1/-1 fallback
    const halfLength = Math.ceil(items.length / 2);
    html += '<div class="slide-indicators" style="text-align: center; margin-top: 10px;">';
    items.forEach((slideId, index) => {
        if (index < halfLength) {
            // First half: show direct selector dot
            html += `<button data-block-selector="${slideId}" class="slide-dot" style="width: 12px; height: 12px; border-radius: 50%; margin: 0 4px; cursor: pointer; border: 1px solid #999; background: ${slideId === activeSlideId ? '#333' : '#fff'};">${index + 1}</button>`;
        } else {
            // Second half: no direct selector, must use +1/-1 navigation
            html += `<span class="slide-dot no-selector" style="width: 12px; height: 12px; border-radius: 50%; margin: 0 4px; display: inline-block; border: 1px solid #ccc; background: ${slideId === activeSlideId ? '#333' : '#eee'};">${index + 1}</span>`;
        }
    });
    html += '</div>';

    html += '</div>';
    return html;
}

/**
 * Render a slider block using object_list format (slides as array with @id).
 * This is the volto-slider-block format.
 *
 * @param {Object} block - Slider block data with slides array
 * @param {string} blockId - Block UID for state tracking
 * @returns {string} HTML string
 */
async function renderSliderBlock(block, blockId) {
    // Expand slides through template system (handles templateInstanceId, fixed, etc.)
    const rawSlides = block.slides || [];
    const slides = window._expandTemplatesSync
        ? window._expandTemplatesSync(rawSlides, { templateState: window._templateState, templates: {}, idField: '@id' })
        : rawSlides;

    // Convert object_list items to blocks dict + layout for expandItems
    const blocksDict = {};
    const layout = [];
    for (const slide of slides) {
        const slideId = slide['@id'];
        if (!slideId) continue;
        blocksDict[slideId] = slide;
        layout.push(slideId);
    }

    // Expand listing blocks into individual items
    const { items: expandedItems } = await expandItems(blocksDict, layout, blockId);

    const prevCount = sliderSlideCount[blockId] || 0;
    const newCount = expandedItems.length;

    // Detect if a new slide was added - show it instead of first slide
    let activeIndex = 0;
    if (newCount > prevCount && prevCount > 0) {
        activeIndex = newCount - 1;
    }
    sliderSlideCount[blockId] = newCount;

    const activeSlideId = expandedItems[activeIndex]?.['@uid'] || null;

    let html = '<div class="carousel-container" style="position: relative; padding: 20px; background: #f5f5f5; border-radius: 8px; min-height: 120px;">';

    // Navigation button - Previous (selects previous sibling)
    html += '<button data-block-selector="-1" class="carousel-prev" style="position: absolute; left: 5px; top: 50%; transform: translateY(-50%); z-index: 10; padding: 10px; cursor: pointer;">←</button>';

    // Slides container - only ONE slide visible at a time
    html += '<div class="slides-wrapper" style="position: relative; margin: 0 50px; min-height: 80px;">';

    expandedItems.forEach((item, index) => {
        const itemId = item['@uid'];
        if (!itemId) return;

        const isActive = index === activeIndex;
        const displayStyle = isActive ? 'block' : 'none';

        html += `<div data-block-uid="${itemId}" data-block-add="right" class="slide ${isActive ? 'active' : ''}" style="display: ${displayStyle}; padding: 15px; background: white; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">`;

        // Render based on item type
        switch (item['@type']) {
            case 'image':
                html += renderImageBlock(item);
                break;
            case 'teaser':
                html += renderTeaserBlock(item, null);
                break;
            default:
                html += renderSlideBlock(item);
                break;
        }

        html += '</div>';
    });

    html += '</div>';

    // Navigation button - Next (selects next sibling)
    html += '<button data-block-selector="+1" class="carousel-next" style="position: absolute; right: 5px; top: 50%; transform: translateY(-50%); z-index: 10; padding: 10px; cursor: pointer;">→</button>';

    // Direct selector buttons for each slide (like dot indicators)
    // Only show dots for first half of slides to test both direct selector and +1/-1 fallback
    const halfLength = Math.ceil(expandedItems.length / 2);
    html += '<div class="slide-indicators" style="text-align: center; margin-top: 10px;">';
    expandedItems.forEach((item, index) => {
        const itemId = item['@uid'];
        if (index < halfLength) {
            // First half: show direct selector dot
            html += `<button data-block-selector="${itemId}" class="slide-dot" style="width: 12px; height: 12px; border-radius: 50%; margin: 0 4px; cursor: pointer; border: 1px solid #999; background: ${index === activeIndex ? '#333' : '#fff'};">${index + 1}</button>`;
        } else {
            // Second half: no direct selector, must use +1/-1 navigation
            html += `<span class="slide-dot no-selector" style="width: 12px; height: 12px; border-radius: 50%; margin: 0 4px; display: inline-block; border: 1px solid #ccc; background: ${index === activeIndex ? '#333' : '#eee'};">${index + 1}</span>`;
        }
    });
    html += '</div>';

    html += '</div>';
    return html;
}

/**
 * Cookie consent: one block drawn in three places, two of them hidden.
 *
 * The bar is the block's own element (it carries data-block-uid, and is always
 * on screen). The wording an author writes is read somewhere else entirely: the
 * `message` in a banner and the `analyticsPurpose` beside a tick box in a
 * preferences dialog, both built into <body> — which is where a design system's
 * own JavaScript puts them — and both hidden until their trigger is pressed.
 *
 * So "is the block visible?" answers nothing here, and one handle cannot serve
 * two halves: each trigger names the FIELD its half holds, and the bridge opens
 * the half whose field the author reached for in the sidebar.
 *
 * @param {Object} block - Cookie consent block data
 * @param {string} blockId - Block ID
 * @returns {string} HTML string
 */
function renderCookieConsentBar(block, blockId) {
    return (
        '<div class="cookie-consent-bar" style="display: flex; gap: 12px; align-items: center; padding: 8px 12px; background: #f4f4f6; border: 1px solid #ddd;">' +
        '<strong>Cookie consent</strong>' +
        `<button type="button" data-block-selector="${blockId}#message" data-linkable-allow data-cookie-open="banner">Show the banner</button>` +
        `<button type="button" data-block-selector="${blockId}#analyticsPurpose" data-linkable-allow data-cookie-open="dialog">Show cookie preferences</button>` +
        '</div>'
    );
}

/**
 * Build (or rebuild) the two halves outside the block's element, and wire the
 * bar's triggers to them. Kept idempotent per uid: renderBlock runs again on
 * every change, and a second banner would mean a second data-edit-text="message".
 * @param {Object} block - Cookie consent block data
 * @param {string} blockId - Block ID
 */
function mountCookieConsentChrome(block, blockId) {
    document
        .querySelectorAll(`[data-cookie-chrome="${blockId}"]`)
        .forEach((el) => el.remove());

    let messageHtml = '';
    (block.message || []).forEach((node) => {
        const nodeIdAttr = node.nodeId !== undefined ? ` data-node-id="${node.nodeId}"` : '';
        messageHtml += `<p data-edit-text="message"${nodeIdAttr}>${renderChildren(node.children)}</p>`;
    });

    const banner = document.createElement('div');
    banner.setAttribute('data-cookie-chrome', blockId);
    // The half advertises the field it holds, as well as the bar's trigger doing
    // so. Without that the wording inside it belongs to no block at all — it is
    // outside the block's element, so `data-edit-text` there resolves to nothing
    // and the text is not editable. The bar's trigger is what the bridge clicks
    // (this one is hidden until it opens), and both name the same field.
    banner.setAttribute('data-block-selector', `${blockId}#message`);
    banner.className = 'cookie-banner';
    banner.hidden = true;
    banner.innerHTML = messageHtml + '<button type="button" data-cookie-close>Accept all</button>';

    const dialog = document.createElement('div');
    dialog.setAttribute('data-cookie-chrome', blockId);
    dialog.setAttribute('data-block-selector', `${blockId}#analyticsPurpose`);
    dialog.className = 'cookie-dialog';
    dialog.hidden = true;
    dialog.innerHTML =
        '<h2>Manage cookie preferences</h2>' +
        '<label><input type="checkbox" name="analytics"> Analytics</label>' +
        `<p data-edit-text="analyticsPurpose">${escapeHtml(block.analyticsPurpose || '')}</p>` +
        '<button type="button" data-cookie-close>Save</button>';

    // Rendered as SIBLINGS of the bar, not on <body>: the two halves are still
    // outside the block's element, which is the whole point, but they stay
    // inside the page the bridge walks. (A design system's own JavaScript does
    // put them on <body>; that shape is drawn the same way and is what the
    // frontends in docs/examples/cookie-consent.md show.)
    document.body.appendChild(banner);
    document.body.appendChild(dialog);

    document.addEventListener('click', (e) => {
        const opener = e.target.closest(`[data-block-uid="${blockId}"] [data-cookie-open]`);
        if (opener) {
            const half = opener.getAttribute('data-cookie-open') === 'banner' ? banner : dialog;
            half.hidden = false;
            return;
        }
        const closer = e.target.closest('[data-cookie-close]');
        if (closer && closer.parentElement.getAttribute('data-cookie-chrome') === blockId) {
            closer.parentElement.hidden = true;
        }
    });
}

/**
 * Render a codeExample block with tabs as child blocks.
 * Each tab has its own data-block-uid and the code is shown in a <pre> element.
 * @param {Object} block - Code example block data
 * @param {string} blockId - Block ID
 * @returns {string} HTML string
 */
function renderCodeExampleBlock(block, blockId) {
    const tabs = block.tabs || [];
    let html = '<div data-block-container="{add:\'horizontal\'}" style="background: #1a1a2e; border-radius: 8px; overflow: hidden; margin: 8px 0;">';

    // Tab bar (only when 2+ tabs)
    if (tabs.length > 1) {
        html += '<div data-tab-bar style="display: flex; background: #16213e; border-bottom: 1px solid #334;">';
        tabs.forEach((tab) => {
            const tabId = tab['@id'];
            // The BUTTON represents the tab; the PANEL below is the tab. Carrying
            // data-block-uid here too would tell the bridge the block is on screen
            // whenever the bar is, so selecting an inactive tab would never reveal
            // the code it holds. data-block-selector says "I represent this uid" —
            // the label still edits the tab, and clicking switches to it.
            // Two tokens: the bare uid reveals the tab (any field), and
            // `uid#code` says WHERE the code field is edited — the panel this
            // button opens. The label needs no handle: it is on this button,
            // already on screen, so a focus in it has nothing to reveal.
            html += `<button data-block-selector="${tabId} ${tabId}#code" data-linkable-allow style="padding: 8px 16px; color: #aaa; background: transparent; border: none; cursor: pointer; font-size: 13px;"><span data-edit-text="label">${tab.label || tab.language || 'Tab'}</span></button>`;
        });
        html += '</div>';
    }

    // Each tab is a child block - only first is visible
    tabs.forEach((tab, index) => {
        const tabId = tab['@id'];
        const display = index === 0 ? 'block' : 'none';
        const code = (tab.code || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<div data-block-uid="${tabId}" data-block-add="right" style="display: ${display};">`;
        html += `<pre data-edit-text="code" style="padding: 16px; margin: 0; color: #e0e0e0; white-space: pre-wrap; font-size: 13px;"><code>${code}</code></pre>`;
        html += '</div>';
    });

    html += '</div>';
    return html;
}

/**
 * Render a slide block (child of carousel/slider).
 * Supports both old format (title, content) and volto-slider-block format (title, description, head_title).
 * @param {Object} block - Slide block data
 * @returns {string} HTML string
 */
function renderSlideBlock(block) {
    const title = block.title ?? '';
    // Support both old format (content) and new format (description)
    const description = block.description || block.content || '';
    const headTitle = block.head_title || '';
    const imageSrc = getImageUrl(block.preview_image);

    let html = '';

    // Preview image (background image area)
    if (imageSrc) {
        html += `<div data-edit-media="preview_image" style="height: 100px; background: url('${imageSrc}') center/cover; margin-bottom: 8px; border-radius: 4px;"></div>`;
    } else {
        html += `<div data-edit-media="preview_image" style="height: 100px; background: #ddd; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; border-radius: 4px; cursor: pointer;">Click to add image</div>`;
    }

    if (headTitle) {
        html += `<div data-edit-text="head_title" style="font-size: 12px; color: #888; margin-bottom: 4px;">${headTitle}</div>`;
    }
    html += `<h4 data-edit-text="title" style="margin: 0 0 8px 0;">${title}</h4>`;
    html += `<p data-edit-text="description" style="margin: 0; color: #666;">${description}</p>`;
    // The slide's own link. Its `href` is a field of the SLIDE, so it needs an
    // annotation on the slide's own markup: a teaser nested inside a slide has
    // an `href` of its own, and borrowing that one would put an author's edit
    // in the wrong block.
    if (!block.hideButton) {
        const slideHref = getLinkUrl(block.href);
        // The label is annotated inside the link, and the link carries NO
        // `data-linkable-allow`: with it, a click navigates and tears the editor
        // down before an edit can happen, which is why an annotation inside such
        // an anchor is refused. Without it the click is the editor's.
        html += `<a href="${slideHref || '#'}" data-edit-link="href" style="display: inline-block; margin-top: 8px; color: #007eb1;"><span data-edit-text="buttonText">${escapeHtml(block.buttonText || 'Read more')}</span></a>`;
    }

    return html;
}

/**
 * Social links: one <a> per entry in `links`.
 *
 * Each link carries its OWN data-block-uid (the item's @id) so it can be
 * selected, moved and edited as a sub-item — the same shape the Nuxt and
 * Next.js examples render. The mock had no socialLinks case at all, so the
 * links appeared nowhere and sub-item selection had nothing to attach to.
 */
function renderSocialLinksBlock(block) {
    const links = block.links || [];
    let html = '<span>Follow us:</span>';
    for (const link of links) {
        const uid = link['@id'];
        html += `<a data-block-uid="${uid}" data-block-add="right" data-edit-link="url" ` +
            `href="${escapeAttr(link.url || '')}" target="_blank" rel="noopener noreferrer">` +
            `${escapeHtml(link.url || '')}</a>`;
    }
    return html;
}

/**
 * Render an accordion block — panels stored as object_list items.
 * Each panel has title, blocks, and blocks_layout.
 *
 * @param {Object} block - Accordion block data
 * @param {string} blockId - Accordion block ID
 * @returns {Promise<string>} HTML string
 */
async function renderAccordionBlock(block, blockId) {
    const panels = block.panels || [];

    let html = '<div class="accordion-container" style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">';

    for (const panel of panels) {
        const panelId = panel['@id'];
        html += `<div data-block-uid="${panelId}" data-block-add="bottom">`;
        html += await renderAccordionPanelBlock(panel, panelId);
        html += '</div>';
    }

    html += '</div>';
    return html;
}

/**
 * Render an accordion panel with title and content blocks.
 *
 * @param {Object} block - AccordionPanel block data
 * @param {string} blockId - Panel block ID
 * @returns {Promise<string>} HTML string
 */
async function renderAccordionPanelBlock(block, blockId) {
    const contentBlocks = block.blocks || {};
    const contentLayout = block.blocks_layout?.items || [];

    const { items: expandedItems } = await expandItems(contentBlocks, contentLayout, `${blockId}-content`);

    let html = '';

    // Panel header (title)
    html += '<div class="accordion-header" style="background: #f5f5f5; padding: 15px; border-bottom: 1px solid #ddd; cursor: pointer;">';
    html += `<strong data-edit-text="title">${block.title || ''}</strong>`;
    html += '</div>';

    // Panel content
    html += '<div class="accordion-content" style="padding: 15px;">';

    for (const childBlock of expandedItems) {
        if (!childBlock) continue;
        const uid = childBlock['@uid'];
        let inner;
        switch (childBlock['@type']) {
            case 'slate':
                inner = renderNestedSlateBlock(childBlock);
                break;
            case 'image':
                inner = renderImageBlock(childBlock);
                break;
            case 'teaser':
                inner = renderTeaserBlock(childBlock, null);
                break;
            case 'summary':
                inner = renderSummaryItemBlock(childBlock, null);
                break;
            default: {
                // Anything else — including CONTAINERS — goes through the normal
                // renderer so nested blocks render as they do anywhere else. The
                // old default treated an unknown type as a slate, so a grid in a
                // panel produced no children at all and its blocks existed
                // nowhere in the DOM.
                const el = await renderBlock(uid, childBlock);
                if (el) html += el.outerHTML;
                continue;
            }
        }
        html += `<div data-block-uid="${uid}" data-block-add="bottom">${inner}</div>`;
    }

    html += '</div>';
    return html;
}

/**
 * Known facet field options for rendering widgets.
 * Maps field name to array of { value, title } options.
 * Matches the options from @querystring endpoint in mock API.
 */
const FACET_FIELD_OPTIONS = {
    'review_state': [
        { value: 'private', title: 'Private' },
        { value: 'pending', title: 'Pending' },
        { value: 'published', title: 'Published' },
    ],
    'portal_type': [
        { value: 'Document', title: 'Page' },
        { value: 'News Item', title: 'News Item' },
        { value: 'Event', title: 'Event' },
        { value: 'Image', title: 'Image' },
        { value: 'File', title: 'File' },
        { value: 'Link', title: 'Link' },
    ],
};

/**
 * Render the appropriate widget for a facet based on its type.
 * @param {Object} facet - Facet configuration
 * @returns {string} HTML string for the facet widget
 */
function renderFacetWidget(facet) {
    const facetType = facet.type || 'checkboxFacet';
    // Field can be an object { label, value } from Volto's select widget, or a plain string
    const field = typeof facet.field === 'object' ? facet.field?.value : facet.field || '';
    const options = FACET_FIELD_OPTIONS[field] || [];

    if (options.length === 0) {
        return '<div class="facet-widget" style="font-size: 11px; color: #999;">No options available</div>';
    }

    if (facetType === 'selectFacet') {
        // Render as dropdown select
        let optionsHtml = '<option value="">Select...</option>';
        optionsHtml += options.map(opt =>
            `<option value="${opt.value}">${opt.title}</option>`
        ).join('');
        return `<select class="facet-widget facet-select" data-linkable-allow data-field="${field}" style="width: 100%; padding: 4px; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
            ${optionsHtml}
        </select>`;
    } else if (facetType === 'checkboxFacet') {
        // Get current facet values from URL
        const urlParams = new URLSearchParams(window.location.search);
        const currentValues = urlParams.getAll(`facet.${field}`);

        // Render as checkboxes with checked state from URL
        const checkboxesHtml = options.map(opt => {
            const isChecked = currentValues.includes(opt.value) ? 'checked' : '';
            return `<label style="display: block; margin-top: 4px;">
                <input type="checkbox" class="facet-checkbox" data-linkable-allow data-field="${field}" value="${opt.value}" ${isChecked} />
                ${opt.title}
            </label>`;
        }).join('');
        return `<div class="facet-widget facet-checkboxes" style="margin-top: 4px;">
            ${checkboxesHtml}
        </div>`;
    }

    if (facetType === 'daterangeFacet') {
        return `<div class="facet-widget facet-daterange" style="margin-top: 4px;">
            <input type="date" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px;" /> —
            <input type="date" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px;" />
        </div>`;
    }

    if (facetType === 'toggleFacet') {
        return `<div class="facet-widget facet-toggle" style="margin-top: 4px;">
            <label><input type="checkbox" /> ${options[0]?.title || 'Toggle'}</label>
        </div>`;
    }

    // Default: just show field name
    return '<div class="facet-widget" style="font-size: 11px; color: #999;">Widget not implemented</div>';
}

/**
 * Render a search block with facets and listing container.
 * The listing child is expanded via expandListingBlocks before rendering.
 *
 * @param {Object} block - Search block data with facets and shared blocks dict + listing layout
 * @param {string} blockId - Search block ID
 * @returns {Promise<string>} HTML string
 */
async function renderSearchBlock(block, blockId) {
    const headline = block.headline || '';
    const showSearchInput = block.showSearchInput;
    const showSortOn = block.showSortOn;
    const facets = block.facets || [];
    const sortOnOptions = block.sortOnOptions || [];
    const blocks = block.blocks || {};
    const listingLayout = block.blocks_layout?.listing || [];

    let html = '<div class="search-block" style="padding: 20px; border: 1px solid #ddd; border-radius: 8px;">';

    // Headline
    if (headline) {
        html += `<h2 data-edit-text="headline" style="margin-bottom: 15px;">${headline}</h2>`;
    }

    // A block that exists ONLY once a query has been asked — the quick-answer
    // region. Declared here so the form below can say how to reveal it: the
    // input carries the sample question, the submit button carries the uid.
    const quickAnswerLayout = block.blocks_layout?.quickAnswer || [];
    const quickAnswerUid = quickAnswerLayout[0] || '';
    const sampleQuestion = block.quickAnswerSample || '';

    // Search input
    if (showSearchInput) {
        // Get current search text from URL criteria (if available)
        const currentSearchText = window._searchCriteria?.SearchableText || '';
        // The input says WHAT to type, the button says WHICH block that reveals.
        // An element declaring a value is a field to fill; one that does not is
        // the thing to activate — which is how two handles can share a form.
        const revealInput = quickAnswerUid && sampleQuestion
            ? ` data-block-selector="${escapeAttr(quickAnswerUid)}" data-block-selector-input="${escapeAttr(sampleQuestion)}"`
            : '';
        const revealButton = quickAnswerUid ? ` data-block-selector="${escapeAttr(quickAnswerUid)}"` : '';
        html += `<div class="search-input" style="margin-bottom: 15px;">
            <form class="search-form" data-search-block="${blockId}" style="display: flex; gap: 10px;">
                <input type="text" name="SearchableText" placeholder="Search..." value="${currentSearchText}"
                    class="search-input-field"${revealInput}
                    style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
                <button type="submit" class="search-submit-button"${revealButton} style="padding: 8px 16px; background: #0066cc; color: white; border: none; border-radius: 4px;">
                    Search
                </button>
            </form>
        </div>`;
    }

    // Rendered only when a question has actually been asked. With no query there
    // is no element at all — not hidden, absent — which is the case a click-only
    // reveal cannot reach.
    if (quickAnswerUid && window._searchCriteria?.SearchableText) {
        const child = blocks[quickAnswerUid];
        if (child) {
            html += `<div class="quick-answer" data-block-uid="${escapeAttr(quickAnswerUid)}" style="margin: 15px 0; padding: 12px; background: #eef3fb; border-radius: 6px;">
                <div data-edit-text="answer">${escapeHtml(child.answer || '')}</div>
            </div>`;
        }
    }

    // Sort options
    if (showSortOn && sortOnOptions.length > 0) {
        html += `<div class="search-sort" style="margin-bottom: 15px;">
            <label style="margin-right: 8px;">Sort by:</label>
            <select style="padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px;">
                ${sortOnOptions.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
            </select>
        </div>`;
    }

    // Facets (rendered from object_list - each has data-block-uid for selection)
    const facetsTitle = block.facetsTitle || '';
    if (facets.length > 0) {
        html += '<div class="search-facets" style="margin-bottom: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px;">';
        html += `<div data-edit-text="facetsTitle" style="font-weight: bold; margin-bottom: 8px; color: #666; font-size: 12px;">${facetsTitle || 'FACETS'}</div>`;
        for (const facet of facets) {
            const facetId = facet['@id'] || facet.id || '';
            const facetType = facet.type || '';
            // For typed object_list: non-facet items (slate, image) get rendered differently
            if (facetType === 'slate' || facetType === 'image') {
                // Render as generic block inside facets container
                html += `<div data-block-uid="${facetId}" data-block-add="bottom" style="margin-bottom: 8px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">`;
                html += renderBlock(facet, facetId);
                html += '</div>';
            } else {
                html += `<div class="facet-item" data-block-uid="${facetId}" data-block-type="${facetType}" data-block-add="bottom" style="margin-bottom: 8px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">
                    <div data-edit-text="title" style="font-weight: bold;">${facet.title || ''}</div>
                    <div style="font-size: 12px; color: #666;">Field: ${typeof facet.field === 'object' ? facet.field?.value : facet.field || ''}</div>
                    ${renderFacetWidget(facet)}
                </div>`;
            }
        }
        html += '</div>';
    }

    // Listing container - expand and render child blocks
    html += '<div class="search-results" style="display: grid; gap: 15px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));">';

    // Expand listing blocks if we have the helper
    // expandListingBlocks returns { items, paging } where each item has @uid
    if (window._expandListingBlocks && listingLayout.length > 0) {
        const PAGE_SIZE = 6;
        const result = await window._expandListingBlocks(blocks, listingLayout, `${blockId}-listing`, { start: 0, size: PAGE_SIZE });
        const expandedItems = result.items;

        for (const childBlock of expandedItems) {
            if (!childBlock) continue;

            // Use general block renderer - it handles all block types
            const uid = childBlock['@uid'];
            const blockElement = await renderBlock(uid, childBlock);
            if (blockElement) {
                // Add data-block-add attribute for direction
                if (blockElement instanceof DocumentFragment) {
                    // For fragments (like hero), find the actual block element
                    const actualElement = blockElement.querySelector('[data-block-uid]');
                    if (actualElement) actualElement.setAttribute('data-block-add', 'bottom');
                    html += Array.from(blockElement.childNodes).map(n => n.outerHTML || n.textContent).join('');
                } else {
                    blockElement.setAttribute('data-block-add', 'bottom');
                    html += blockElement.outerHTML;
                }
            }
        }
    } else {
        html += '<p style="color: #999;">No results</p>';
    }

    html += '</div>';

    html += '</div>';
    return html;
}

/**
 * Render a nested slate block (simple paragraph rendering).
 * Used for accordion's nested text blocks.
 *
 * @param {Object} block - Slate block data
 * @returns {string} HTML string
 */
function renderNestedSlateBlock(block) {
    return renderSlateBlock(block);
}

/**
 * Render a slateTable block.
 * Each row and cell gets data-block-uid for selection.
 * Cell content is editable via data-edit-text="value".
 * @param {Object} block - slateTable block data
 * @returns {string} HTML string
 */
function renderSlateTableBlock(block) {
    const table = block.table || {};
    const rows = table.rows || [];

    let html = '<table style="border-collapse: collapse; width: 100%;">';

    rows.forEach((row) => {
        // Rows add downward (new row below)
        html += `<tr data-block-uid="${row.key}" data-block-add="bottom">`;
        const cells = row.cells || [];
        cells.forEach((cell) => {
            const tag = cell.type === 'header' ? 'th' : 'td';
            const style = 'border: 1px solid #ccc; padding: 8px;';

            // Render cell content from slate value. data-edit-text="value" belongs
            // on the CELL, not on each node: a cell's value is ONE field that may
            // hold several top-level nodes (a heading AND a paragraph). Tagging each
            // node made every node its own "value" region, so the round-trip reader
            // saw only the first node and the cell never matched its own value. One
            // region per cell, each node rendered with its real element tag.
            let cellContent = '';
            const value = cell.value || [];
            value.forEach((node) => {
                const nodeIdAttr = node.nodeId !== undefined ? ` data-node-id="${node.nodeId}"` : '';
                const text = renderChildren(node.children || []);
                const el = /^h[1-6]$/.test(node.type || '') ? node.type : 'p';
                cellContent += `<${el}${nodeIdAttr}>${text}</${el}>`;
            });

            // Cells add to the right (new column)
            html += `<${tag} data-block-uid="${cell.key}" data-block-add="right" data-edit-text="value" style="${style}">${cellContent}</${tag}>`;
        });
        html += '</tr>';
    });

    html += '</table>';
    return html;
}

/**
 * Render an Empty block.
 * Empty blocks are inserted into empty containers and can be clicked to add a real block.
 * @param {Object} block - Empty block data
 * @returns {string} HTML string
 */
function renderEmptyBlock(block) {
    return `<div class="empty-block" style="min-height: 60px;"></div>`;
}

/**
 * Update a block's content.
 * @param {string} blockId - Block UUID
 * @param {Object} newData - New block data
 */
function updateBlock(blockId, newData) {
    const blockElement = document.querySelector(`[data-block-uid="${blockId}"]`);
    if (!blockElement) return;

    const newBlock = renderBlock(blockId, newData);
    blockElement.innerHTML = newBlock.innerHTML;

    // Sync data-block-readonly attribute from new block to existing element
    // This is needed because innerHTML only updates children, not the element's own attributes
    if (newBlock.hasAttribute('data-block-readonly')) {
        blockElement.setAttribute('data-block-readonly', '');
    } else {
        blockElement.removeAttribute('data-block-readonly');
    }
}

/**
 * Add a new block to the layout.
 * @param {string} blockId - Block UUID
 * @param {Object} blockData - Block data
 * @param {number} index - Position to insert
 */
function addBlock(blockId, blockData, index) {
    const container = document.getElementById('content');
    const blockElement = renderBlock(blockId, blockData);

    if (index >= container.children.length) {
        container.appendChild(blockElement);
    } else {
        const referenceNode = container.children[index];
        container.insertBefore(blockElement, referenceNode);
    }
}

/**
 * Remove a block from the layout.
 * @param {string} blockId - Block UUID
 */
function removeBlock(blockId) {
    const blockElement = document.querySelector(`[data-block-uid="${blockId}"]`);
    if (blockElement) {
        blockElement.remove();
    }
}

/**
 * Initialize carousel navigation handlers.
 * This is called after rendering to attach click handlers to data-block-selector elements.
 * Handles:
 * - data-block-selector="+1" - show next sibling slide
 * - data-block-selector="-1" - show previous sibling slide
 * - data-block-selector="{uid}" - show slide with that specific UID
 */
function initCarouselNavigation() {
    // Use event delegation on the content container
    const content = document.getElementById('content');
    console.log('[RENDERER] initCarouselNavigation called, content:', content ? 'found' : 'NOT FOUND');
    if (!content) return;

    content.addEventListener('click', function(event) {
        console.log('[RENDERER] Content click received, target:', event.target.tagName, event.target.className);
        const selectorElement = event.target.closest('[data-block-selector]');
        console.log('[RENDERER] selectorElement:', selectorElement ? selectorElement.getAttribute('data-block-selector') : 'null');
        if (!selectorElement) return;

        const selector = selectorElement.getAttribute('data-block-selector');
        console.log('[RENDERER] Carousel navigation click:', selector);
        const carousel = selectorElement.closest('[data-block-uid].carousel-block');
        console.log('[RENDERER] Found carousel:', carousel?.getAttribute('data-block-uid'));
        if (!carousel) return;

        // Find all slides in this carousel
        const slidesWrapper = carousel.querySelector('.slides-wrapper');
        console.log('[RENDERER] slidesWrapper:', slidesWrapper ? 'found' : 'NOT FOUND');
        if (!slidesWrapper) return;

        const slides = Array.from(slidesWrapper.querySelectorAll('[data-block-uid].slide'));
        console.log('[RENDERER] slides found:', slides.length, slides.map(s => s.getAttribute('data-block-uid')));
        if (slides.length === 0) return;

        // Find currently active slide
        const currentSlide = slides.find(s => s.style.display !== 'none') || slides[0];
        const currentIndex = slides.indexOf(currentSlide);
        console.log('[RENDERER] currentSlide:', currentSlide?.getAttribute('data-block-uid'), 'index:', currentIndex);

        let targetSlide = null;
        let targetIndex = -1;

        if (selector === '+1') {
            targetIndex = currentIndex + 1;
            if (targetIndex < slides.length) {
                targetSlide = slides[targetIndex];
            }
        } else if (selector === '-1') {
            targetIndex = currentIndex - 1;
            if (targetIndex >= 0) {
                targetSlide = slides[targetIndex];
            }
        } else {
            // Direct UID selector
            targetSlide = slides.find(s => s.getAttribute('data-block-uid') === selector);
            targetIndex = slides.indexOf(targetSlide);
        }

        console.log('[RENDERER] targetSlide:', targetSlide?.getAttribute('data-block-uid'), 'index:', targetIndex);
        if (targetSlide && targetSlide !== currentSlide) {
            console.log('[RENDERER] Scheduling slide transition in 100ms');
            // Simulate animation delay (100ms) to test async waiting in hydra.js
            setTimeout(() => {
                console.log('[RENDERER] Executing slide transition to:', targetSlide?.getAttribute('data-block-uid'));
                // Hide all slides
                slides.forEach(s => {
                    s.style.display = 'none';
                    s.classList.remove('active');
                });
                // Show target slide
                targetSlide.style.display = 'block';
                targetSlide.classList.add('active');
                console.log('[RENDERER] Slide transition complete, slide-2 display:', targetSlide.style.display);

                // Update dot indicators
                const dots = carousel.querySelectorAll('.slide-dot');
                dots.forEach((dot, i) => {
                    dot.style.background = i === targetIndex ? '#333' : '#fff';
                });
            }, 100);
        }
    });
}

/**
 * Initialize search form submission handling.
 * Uses event delegation to handle all search forms.
 * Updates the URL with SearchableText param and reloads the page.
 */
function initSearchFormHandling() {
    document.addEventListener('submit', function(event) {
        const form = event.target.closest('.search-form');
        if (!form) return;

        event.preventDefault();

        const searchInput = form.querySelector('input[name="SearchableText"]');
        const searchText = searchInput?.value?.trim() || '';

        // Build new URL with search criteria
        const url = new URL(window.location.href);

        if (searchText) {
            url.searchParams.set('SearchableText', searchText);
        } else {
            url.searchParams.delete('SearchableText');
        }

        // Reload page with new search criteria
        console.log('[RENDERER] Search form submitted, navigating to:', url.toString());
        window.location.href = url.toString();
    });
}

/**
 * Initialize facet checkbox/select handling.
 * Uses event delegation to handle all facet widgets.
 * Updates the URL with facet.{field}={value} params and reloads the page.
 */
function initFacetHandling() {
    document.addEventListener('change', function(event) {
        const checkbox = event.target.closest('.facet-checkbox');
        const select = event.target.closest('.facet-select');

        if (!checkbox && !select) return;

        const url = new URL(window.location.href);

        if (checkbox) {
            const field = checkbox.dataset.field;
            const value = checkbox.value;
            const paramKey = `facet.${field}`;

            // Get current values for this facet (may be multiple)
            const currentValues = url.searchParams.getAll(paramKey);

            if (checkbox.checked) {
                // Add value if not already present
                if (!currentValues.includes(value)) {
                    url.searchParams.append(paramKey, value);
                }
            } else {
                // Remove this specific value
                url.searchParams.delete(paramKey);
                currentValues.filter(v => v !== value).forEach(v => {
                    url.searchParams.append(paramKey, v);
                });
            }
        } else if (select) {
            const field = select.dataset.field;
            const value = select.value;
            const paramKey = `facet.${field}`;

            if (value) {
                url.searchParams.set(paramKey, value);
            } else {
                url.searchParams.delete(paramKey);
            }
        }

        console.log('[RENDERER] Facet changed, navigating to:', url.toString());
        window.location.href = url.toString();
    });
}

// Initialize carousel navigation when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initCarouselNavigation();
        initSearchFormHandling();
        initFacetHandling();
    });
} else {
    initCarouselNavigation();
    initSearchFormHandling();
    initFacetHandling();
}

// Global cnav viewport listener — resyncs all contextNavigation
// disclosures when crossing the 768px breakpoint. Per-render sync is
// in renderContent(); this covers user resize + devtools toggle.
if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(min-width: 768px)').addEventListener('change', syncCnavOpenState);
}

// Tab bars switch on click. The buttons were inert, so a tab other than the
// first could never be shown — including when the bridge clicks the handle to
// reveal a tab an author selected in the sidebar.
document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab-bar] button[data-block-selector]');
    if (!button) return;
    // The FIRST token, not the whole attribute: a handle may name its block
    // twice — plainly and by field (`tab-py tab-py#code`) — and comparing the
    // raw attribute to a uid then matches no panel at all.
    const uid = (button.getAttribute('data-block-selector') || '')
        .trim()
        .split(/\s+/)[0];
    const bar = button.closest('[data-tab-bar]');
    const container = bar?.parentElement;
    if (!container) return;
    for (const panel of container.querySelectorAll(':scope > [data-block-uid]')) {
        panel.style.display = panel.getAttribute('data-block-uid') === uid ? 'block' : 'none';
    }
});
