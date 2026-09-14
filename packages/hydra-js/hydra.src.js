import { tabbable } from 'tabbable';

// Pure data helpers live in @volto-hydra/helpers — imported here ONLY
// for internal use by bridge methods (deepEqual, findChangedUnit,
// getFieldTypeString, the field-type predicates, and the template-aware
// block predicates). They are NOT re-exported: callers must import them
// from @volto-hydra/helpers directly so server-only code can pull them
// in without the Bridge class / DOM listeners coming along.
import {
  getFieldTypeString,
  isSlateFieldType,
  isTextareaFieldType,
  isPlainStringFieldType,
  isTextEditableFieldType,
  deepEqual,
  findChangedUnit,
  isBlockReadonly,
  isBlockPositionLocked,
  getBlockAddability,
  isTextOnlyBlockChange,
  findBlockInForm,
  slateNodesText,
  getAtPath,
  ensureMutablePath,
  getFieldValue,
  setFieldValue,
  getFieldDef,
  resolveFieldPath as resolveFieldPathHelper,
} from '@volto-hydra/helpers';
import { expelAllowedTypes, findOnlyEmptyChildUid } from './containerOps.js';
import { acceptableAt } from './conversionMap.js';
import { collectLinkableAnchors } from './linkableAnchors.js';
import { isStyleAllowed } from './slateStyles.js';

/**
 * This IS a large file and it needs to be written in one file so for better understanding and
 * usage of this file in future, Below is the lineup of methods this class provides and also
 * making it easier for other to understand how each section works :)
 */
////////////////////////////////////////////////////////////////////////////////
// Bridge Class Initialization and Navigation Event Handling
////////////////////////////////////////////////////////////////////////////////

// constructor
// init
// _setTokenCookie

////////////////////////////////////////////////////////////////////////////////
// Real-time Data Handling and Quanta Toolbar Creation
////////////////////////////////////////////////////////////////////////////////

// onEditChange
// createQuantaToolbar

////////////////////////////////////////////////////////////////////////////////
// Block Selection and Deselection
////////////////////////////////////////////////////////////////////////////////

// enableBlockClickListener
// selectBlock
// deselectBlock
// listenForSelectBlockMessage

////////////////////////////////////////////////////////////////////////////////
// Make Block Text Inline Editable and Text Changes Observation
////////////////////////////////////////////////////////////////////////////////

// makeBlockContentEditable
// observeBlockTextChanges
// elementIsVisibleInViewport
// observeForBlock

////////////////////////////////////////////////////////////////////////////////
// Adding NodeIds in Slate Block's Json
////////////////////////////////////////////////////////////////////////////////

// addNodeIds
// resetJsonNodeIds

////////////////////////////////////////////////////////////////////////////////
// Handling Text Changes in Blocks
////////////////////////////////////////////////////////////////////////////////

// handleTextChange
// readSlateValueFromDOM
// findParentWithAttribute

////////////////////////////////////////////////////////////////////////////////
// Text Formatting
////////////////////////////////////////////////////////////////////////////////

// getSelectionHTML
// isFormatted
// nextNode
// formatSelectedText
// unwrapFormatting
// unwrapSelectedPortion
// unwrapElement
// removeEmptyFormattingElements
// sendFormattedHTMLToAdminUI
// findEditableParent

// injectCSS

// Template-family helpers (isLayoutTemplate, findSlotRegions,
// isTemplateAllowedIn, getLayoutTemplates, getSnippetTemplates,
// cloneBlocksWithNewIds, insertSnippetBlocks, getTemplateBlocks,
// isFixedTemplateBlock, isPlaceholderContent, templateIdToPath,
// getUniqueTemplateIds, isBlockInEditedTemplate, isBlockReadonly,
// isBlockPositionLocked, getBlockAddability, canContainAll,
// loadTemplates, expandTemplates, expandTemplatesSync, TEMPLATE_MARKER)
// now live in @volto-hydra/helpers — SSR-safe, no Bridge state.

////////////////////////////////////////////////////////////////////////////////
// Methods provided by THIS hydra.js as export
////////////////////////////////////////////////////////////////////////////////

// initBridge
// getTokenFromCookie
// onEditChange

// Debug logging - disabled by default, enable via initBridge options,
// window.HYDRA_DEBUG, or _hydra_debug URL param (set by admin iframe src)
let debugEnabled = false;
try {
  debugEnabled = typeof window !== 'undefined' && !!(
    window.HYDRA_DEBUG ||
    (window.location?.search && new URLSearchParams(window.location.search).has('_hydra_debug'))
  );
} catch { /* SSR or restricted environment */ }
function log(...args) {
  // `window` is absent under SSR / `nuxt generate` — guard it, or this
  // throws and 500s every server-rendered page that calls log().
  if (
    !debugEnabled &&
    !(typeof window !== 'undefined' && window.HYDRA_DEBUG)
  )
    return;
  const runId = typeof window !== 'undefined' && window.__testRunId;
  const prefix = runId != null ? `[HYDRA][RUN-${runId}]` : '[HYDRA]';
  console.log(prefix, ...args);
}

/**
 * Validates a data-node-id value is a real Slate path (dot-separated integers like "0", "0.1").
 * Frontends may render invalid values (e.g. Next.js renders data-node-id="undefined" on text
 * leaves where nodeId is JS undefined). All code that reads data-node-id should use this.
 */
const isValidNodeId = (id) => id && /^\d+(\.\d+)*$/.test(id);

// How many nested closed containers a reveal will open before giving up.
const MAX_REVEAL_DEPTH = 5;

/**
 * Virtual block UID for page-level fields (title, description, preview_image, etc.)
 * Used to distinguish "page field selected" from "nothing selected" (null)
 */
export const PAGE_BLOCK_UID = '_page';

/**
 * Bridge class creating a two-way link between the Hydra and the frontend.
 * @exports Bridge - Exported for testing purposes
 */
export class Bridge {
  /**
   * Constructor for the Bridge class.
   *
   * @param {URL} adminOrigin - The origin of the adminUI.
   * @param {Object} options - Options for the bridge initialization:
   *   - page: { schema: { properties: { fieldName: { title, allowedBlocks, ... } } } }
   *           Page-level blocks fields. Default field is 'blocks_layout'.
   *   - blocks: { blockType: { id, title, blockSchema, ... } }
   *             Custom block definitions merged into the admin config.
   *   - voltoConfig: Other Volto config (non-block settings)
   *   - onEditChange: Callback for real-time form data updates
   *   - debug: Enable verbose logging (default: false)
   *   - pathToApiPath: Function to transform frontend path to API/admin path
   */
  constructor(adminOrigin, options = {}) {
    this.adminOrigin = adminOrigin;
    if (options.debug) debugEnabled = true;
    this.token = null;
    this.navigationHandler = null; // Handler for navigation events
    this.realTimeDataHandler = null; // Handler for message events
    this.blockClickHandler = null; // Handler for block click events
    this.selectBlockHandler = null; // Handler for select block events
    this.currentlySelectedBlock = null;
    this.prevSelectedBlock = null;
    this.clickOnBtn = false;
    this.currentUrl =
      typeof window !== 'undefined' ? new URL(window.location.href) : null;
    this.formData = null;
    this.blockTextMutationObserver = null;
    this.attributeMutationObserver = null;
    this.selectedBlockUid = null;
    // 'text' | 'block' — user switches via Escape / Enter / click. Defined
    // as an accessor so EVERY assignment also writes the body attribute
    // the injected CSS reads (`body[data-hydra-edit-mode="block"]`) to set
    // `user-select: none` on data-edit-text fields under
    // @media (pointer: coarse). That CSS is what stops iOS long-press =
    // word-select from firing while we're in block mode.
    let _editMode = 'text';
    let _focusedFieldName = null;
    Object.defineProperty(this, 'editMode', {
      get: () => _editMode,
      set: (v) => {
        _editMode = v;
        // Invariant (see focusedFieldName below): block mode has no focused text
        // field. Clearing on the transition drops any field a frontend focus set
        // moments earlier — e.g. the tap that selects a block focuses its
        // contenteditable (setting focusedFieldName) a beat BEFORE the click
        // handler flips us to block mode. Without this, block mode would keep a
        // stale focusedFieldName and the admin would show the text toolbar.
        if (v === 'block') _focusedFieldName = null;
        this._syncEditModeAttribute();
      },
      enumerable: true,
      configurable: true,
    });
    this.multiSelectedBlockUids = []; // Array of block UIDs in multi-selection
    // focusedFieldName = which editable text field within the block has focus. It
    // is the admin's TEXT-mode signal: a non-null value surfaces the slate format
    // toolbar. Guard it as an accessor so the invariant holds from ONE place
    // instead of the ~10 sites that assign it: it may be non-null only in text
    // mode. Frontends fire focus/selectionchange on their own contenteditable
    // during re-renders (e.g. autofocusing a field after a move/reorder) — those
    // must never flip block mode into text mode. In block mode the assignment is
    // dropped; a real user re-enters text via a tap (which sets editMode='text'
    // first, so genuine editing is unaffected).
    Object.defineProperty(this, 'focusedFieldName', {
      get: () => _focusedFieldName,
      set: (v) => {
        _focusedFieldName = v && _editMode === 'block' ? null : v;
      },
      enumerable: true,
      configurable: true,
    });
    this.focusedLinkableField = null; // Track which linkable field has focus (for link editing)
    this.focusedMediaField = null; // Track which media field has focus (for image selection)
    this.isInlineEditing = false;
    this.handleMouseUp = null;
    this.blockObserver = null;
    this.handleObjectBrowserMessage = null;
    this.pendingTransform = null; // Track the single pending transform request (only one at a time due to blocking)
    this.eventBuffer = []; // Buffer for keypresses during blocking (replayed after transform)
    this.pendingBufferReplay = null; // Marked for replay after DOM re-render
    this.savedSelection = null; // Store selection for format operations
    this.textUpdateTimer = null; // Timer for batching text updates
    this.pendingTextUpdate = null; // Pending text update data
    this.scrollTimeout = null; // Timer for scroll debouncing
    this.expectedSelectionFromAdmin = null; // Selection we're restoring from Admin - suppress sending it back
    this.blockPathMap = {}; // Maps blockUid -> { path: [...], parentId: string|null }
    this.conversionMap = {}; // { sourceType: [reachableTypes] } — for convert-reachable drop spots
    this.voltoConfig = null; // Store voltoConfig for allowedBlocks checking
    // Track active prospective inline element (link/format with ZWS) for Chrome workaround.
    // Chrome always positions cursor outside <a> elements, unlike <span> for bold.
    // See: https://www.w3.org/community/editing/wiki/ContentEditable
    this.prospectiveInlineElement = null;
    // Path transformer for frontends that embed state in URL (e.g., paging)
    this.pathToApiPath = options.pathToApiPath || ((path) => path);
    // True after INITIAL_DATA is received — block selection is deferred until then
    this.initialized = false;
    this._pendingSelectBlock = null;
    // Readonly registry - blocks marked readonly won't have fields collected
    // Set by expandListingBlocks() or frontend code, not persisted to backend
    this._readonlyBlocks = new Set();
    // Template edit mode - when set to an instanceId, blocks inside that instance
    // become editable (even if readOnly), and blocks outside become locked
    this.templateEditMode = []; // v2: set of unlocked template instance ids (string[])
    // Track iframe focus state via window focus/blur events.
    // document.hasFocus() is unreliable in headless browsers (always returns false),
    // but window focus/blur events are dispatched by Chromium's internal frame focus
    // manager regardless of OS-level window focus.
    this._iframeFocused = document.hasFocus();
    window.addEventListener('focus', () => { this._iframeFocused = true; });
    window.addEventListener('blur', () => {
      this._iframeFocused = false;
      // A click INTO a nested browsing context — a video, a map, a PDF preview —
      // never reaches our click listener: the event belongs to the embed's own
      // document, and does not bubble or capture across the boundary. So the
      // block could not be selected by clicking the thing itself; only by
      // finding some margin of it that wasn't the embed.
      //
      // One thing does cross: focus moves to the <iframe> ELEMENT in THIS
      // document, and blur fires here. Select from that, and let the click go
      // where it was going. The embed stays interactive — no shield, no
      // pointer-events games, nothing to click twice.
      //
      // Deferred a tick because activeElement is not yet the iframe when blur
      // fires.
      setTimeout(() => this.selectBlockFromFocusedEmbed(), 0);
    });
    // …and blur is not enough on its own.
    //
    // Whether the window blurs when focus moves into an embed depends on how
    // the frontend is nested: it fires when the frontend and the admin share an
    // origin, and does NOT when they differ — which is every real deployment,
    // and the nextjs example that failed while the same-origin test frontend
    // passed. In that case focus moves into the embed and the ONLY trace is
    // document.activeElement quietly becoming the <iframe>. No click (it
    // belongs to the embed's document), no focus event, no blur.
    //
    // So watch the one thing that does change. Reading activeElement is a
    // property access; at this interval it is nothing next to a render, and it
    // is the whole reason a video, map or PDF can be selected at all.
    clearInterval(this._embedFocusWatch);
    this._embedFocusWatch = setInterval(() => {
      const focused = document.activeElement;
      if (focused === this._lastActiveElement) return;
      this._lastActiveElement = focused;
      this.selectBlockFromFocusedEmbed();
    }, 200);
    // Register onEditChange callback BEFORE init() sends INIT message.
    // This eliminates the race where INITIAL_DATA arrives before the callback is set.
    //
    // Two ways to receive form updates, mutually exclusive:
    //
    //   - `onEditChange(formData)` — user-supplied callback. Used by
    //     reactive frontends (React/Vue/Svelte/Solid/Nuxt/Next) that take
    //     the formData and let their own framework reconcile the DOM.
    //
    //   - `renderEndpoint: '/api/render'` — bridge installs its own
    //     internal callback that diffs prev vs new formData via
    //     findChangedUnit, POSTs `{ unit, formData }` to the endpoint,
    //     and swaps the returned HTML in. Used by server-rendered
    //     frontends (Astro / PHP / Django / Rails) that have no
    //     client-side reactivity. Optional `renderContainer` selector
    //     names the DOM node whose innerHTML is replaced when the unit
    //     is the whole page (default: '#content').
    //
    // If both are set, `renderEndpoint` wins — the user's onEditChange is
    // ignored. (That's a configuration error; we don't try to merge the
    // semantics.)
    if (options.renderEndpoint) {
      this._installRenderEndpoint(options.renderEndpoint, options.renderContainer || '#content');
    } else if (options.onEditChange) {
      this.onEditChange(options.onEditChange);
    }
    this.init(options); // Initialize the bridge
  }

  /**
   * Wire a server-render endpoint to the FORM_DATA pipeline. Each
   * FORM_DATA arriving from the admin triggers a POST of the smallest
   * changed unit to the endpoint, then swaps the returned HTML into the
   * DOM. See findChangedUnit's docstring for the diff semantics.
   *
   * Race protection: if a render is already in flight (network round
   * trip) when the next FORM_DATA arrives, we drop the in-flight one.
   * The newer formData is what we diff next time — the dropped render
   * would have been stale anyway.
   *
   * Error handling: a non-OK response logs the failure but doesn't throw
   * — we don't want a transient server hiccup to break the bridge.
   * The next FORM_DATA will diff against an unchanged lastForm so the
   * change is retried (same unit, new attempt) implicitly.
   */
  _installRenderEndpoint(endpoint, container) {
    let lastForm = null;
    let inFlight = null;
    const swap = async (unit, formData) => {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit, formData }),
      });
      if (!resp.ok) {
        console.error('[HYDRA] server-render endpoint failed:', resp.status, await resp.text().catch(() => ''));
        // Reset lastForm so the next FORM_DATA re-attempts the same
        // change (otherwise we'd advance the diff baseline past an
        // unrendered state and the DOM would silently fall out of sync).
        lastForm = null;
        return;
      }
      const html = await resp.text();
      if (unit.unit === 'page') {
        const el = document.querySelector(container);
        if (el) el.innerHTML = html;
      } else {
        const el = document.querySelector(`[data-block-uid="${unit.blockId}"]`);
        if (el) el.outerHTML = html;
      }
    };
    this.onEditChange((formData) => {
      const prevForm = lastForm;
      const unit = prevForm == null ? { unit: 'page' } : findChangedUnit(prevForm, formData);
      lastForm = formData;
      if (!unit) return;

      // SKIP for text-only edits when the iframe DOM already shows the
      // new text. Two cases this catches:
      //   1. User typed directly into the iframe's contenteditable — the
      //      browser updated the DOM natively, then admin echoed the
      //      slate value back; the bridge sees a text-only diff, the DOM
      //      already has the new text, swap would only destroy cursor.
      //   2. Selection-induced echoes that don't change visible content.
      //
      // Forces a render for:
      //   - Transforms (bold / link / paragraph type / etc.) — they
      //     change the slate node structure, not just `.text`, so the
      //     classifier returns false and we fall through to swap.
      //     The bridge's existing blockedBlockId / replayBuffer
      //     mechanism handles cursor preservation across that swap.
      //   - Admin-side sidebar typing — the iframe DOM doesn't have the
      //     new text yet, so the DOM-matches check returns false.
      //
      // `_isTextOnlyAndDomMatches` is a no-op + falsy for unit='page' or
      // when prevForm is null (first render), so the first-paint path is
      // unaffected.
      if (this._isTextOnlyAndDomMatches(prevForm, formData, unit)) return;

      if (inFlight) return; // newer FORM_DATA will diff again against current lastForm
      inFlight = swap(unit, formData).finally(() => { inFlight = null; });
    });
  }

  /**
   * Decide whether `unit` represents a text-only change that the iframe
   * DOM already reflects, in which case the renderEndpoint can skip the
   * POST + outerHTML swap. See the SKIP comment in
   * `_installRenderEndpoint` for why this matters.
   *
   * Two gates, both must pass:
   *   - `isTextOnlyBlockChange` (helpers/index.js): the block-level diff
   *     touches only `.text` strings inside slate values, no node
   *     structure / marks / attrs / non-slate fields differ.
   *   - DOM textContent of the live block element equals the
   *     concatenated text leaves of the new slate value(s).
   *
   * Returns false on `unit='page'`, missing data, missing block element,
   * or any structural difference — i.e. forces the caller to render.
   */
  _isTextOnlyAndDomMatches(prevForm, newForm, unit) {
    if (!unit || unit.unit !== 'block' || !prevForm) return false;
    const prevBlock = findBlockInForm(prevForm, unit.blockId);
    const newBlock = findBlockInForm(newForm, unit.blockId);
    if (!isTextOnlyBlockChange(prevBlock, newBlock)) return false;
    const el = document.querySelector(`[data-block-uid="${unit.blockId}"]`);
    if (!el) return false;
    // Concatenate the new block's expected slate text. If multiple slate
    // fields, sum them all — the DOM's textContent contains all editable
    // text in document order, so summing matches.
    let expected = '';
    for (const v of Object.values(newBlock)) {
      if (Array.isArray(v) && v.length > 0 && v.every((n) => n && typeof n === 'object' && (typeof n.text === 'string' || Array.isArray(n.children)))) {
        expected += slateNodesText(v);
      }
    }
    // Normalise whitespace to be forgiving across rendering differences
    // (browsers may collapse / preserve in different ways).
    const normalise = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return normalise(expected) === normalise(el.textContent || '');
  }

  /**
   * Mark a block as readonly (or not). Readonly blocks won't have editable/linkable/media
   * fields collected - they're display-only. Used by expandListingBlocks() for listing items.
   * This is transient state, not persisted to the backend.
   *
   * @param {string} blockUid - The block UID to mark
   * @param {boolean} readonly - Whether the block is readonly (default: true)
   */
  setBlockReadonly(blockUid, readonly = true) {
    if (readonly) {
      this._readonlyBlocks.add(blockUid);
    } else {
      this._readonlyBlocks.delete(blockUid);
    }
  }

  /**
   * Check if a block is readonly. Checks in order:
   * 1. Template edit mode (uses shared isBlockReadonly function)
   * 2. Readonly registry (set by setBlockReadonly) - Bridge-specific
   * 3. Block data property (block.readOnly) - via shared function
   * DOM attribute (data-block-readonly) is checked separately in collectBlockFields.
   *
   * @param {string} blockUid - The block UID to check
   * @returns {boolean} Whether the block is readonly
   */
  isBlockReadonly(blockUid) {
    const blockData = this.getBlockData(blockUid);

    // v2: the shared gate handles both normal and template-edit cases at any
    // depth. The merge stamps every block with its resolved instance id, so a
    // block is editable iff its stamped instance is currently unlocked; every
    // other block keeps its own readOnly flag (page blocks stay editable — a
    // template being unlocked no longer locks the rest of the page). The
    // Bridge-specific registry still force-locks its own set.
    const readonlyFromShared = isBlockReadonly(blockData, this.templateEditMode);
    if (this._readonlyBlocks.has(blockUid)) {
      log('isBlockReadonly: TRUE (registry) for:', blockUid);
      return true;
    }

    log('isBlockReadonly:', readonlyFromShared ? 'TRUE (blockData)' : 'FALSE', 'for:', blockUid);
    return readonlyFromShared;
  }

  /**
   * Parse a hydra comment string into attributes and selectors.
   * Format: "hydra attr=value attr attr=value(selector) /"
   *
   * @param {string} commentText - The comment text (without <!-- and -->)
   * @returns {Object|null} Parsed attributes or null if not a hydra comment
   */
  parseHydraComment(commentText) {
    const text = commentText.trim();
    if (!text.startsWith('hydra ') && text !== 'hydra' && !text.startsWith('hydra/')) {
      return null;
    }

    const isSelfClosing = text.endsWith('/');
    const content = text.replace(/^hydra\s*/, '').replace(/\/$/, '').trim();

    // Parse attribute=value or attribute=value(selector) patterns
    // Supports multiple values for the same attribute (e.g., multiple edit-text)
    const attrs = {};
    // Match: word-name=value(selector) or word-name=value or word-name (boolean)
    // Value can contain paths like /page-name
    const attrRegex = /([\w-]+)(?:=([^(\s]+)(?:\(([^)]+)\))?)?/g;
    let match;
    while ((match = attrRegex.exec(content)) !== null) {
      const [, name, value, selector] = match;
      const entry = { value: value || true, selector: selector || null };
      // Support multiple entries for the same attribute name
      if (!attrs[name]) {
        attrs[name] = [];
      }
      attrs[name].push(entry);
    }

    return { attrs, selfClosing: isSelfClosing };
  }

  /**
   * Scan DOM for hydra comments and materialize attributes to elements.
   * Converts comment-based hydra attributes to actual DOM attributes.
   *
   * Called after content changes to support comment syntax for third-party components.
   */
  materializeHydraComments() {
    if (typeof document === 'undefined') return;

    const treeWalker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_COMMENT,
      null,
      false
    );

    while (treeWalker.nextNode()) {
      const comment = treeWalker.currentNode;
      const text = comment.textContent.trim();

      // Skip closing comments
      if (text === '/hydra') continue;

      // Check for hydra comment
      const parsed = this.parseHydraComment(text);
      if (!parsed) continue;

      // Find the next element sibling (skip text nodes)
      let nextElement = comment.nextSibling;
      while (nextElement && nextElement.nodeType !== Node.ELEMENT_NODE) {
        nextElement = nextElement.nextSibling;
      }

      if (!nextElement) {
        console.error('[hydra] Comment syntax found but no next element sibling:', text);
        continue;
      }

      // Which block this comment belongs to. Both declaration styles are legal and
      // in use: the mock frontend names the uid in the comment, while the Nuxt
      // example omits it because the central <Block> wrapper already carries
      // data-block-uid. Needed only to judge the selector warning below.
      const blockUid =
        parsed.attrs['block-uid']?.[0]?.value ??
        nextElement.closest('[data-block-uid]')?.getAttribute('data-block-uid');

      // Apply attributes to the element
      this.applyHydraAttributes(nextElement, parsed.attrs, this.getRenderedBlockData(blockUid));
    }

    log('materializeHydraComments: completed');
  }

  /**
   * The block's data AS RENDERED — i.e. after _projectForRender, so a revealed
   * field carries its sentinel here even though state has it empty.
   *
   * @param {string} blockUid
   * @returns {Object|undefined}
   */
  getRenderedBlockData(blockUid) {
    if (!blockUid || !this._lastRenderedData) return undefined;
    const pathInfo = this.blockPathMap?.[blockUid];
    if (!pathInfo?.path) return undefined;
    let current = this._lastRenderedData;
    for (const key of pathInfo.path) {
      if (!current || typeof current !== 'object') return undefined;
      current = current[key];
    }
    return current;
  }

  /**
   * Is a comment selector matching nothing the CORRECT outcome?
   *
   * Yes exactly when the field it names has no data: "no data ⇒ no element" is the
   * contract (issue #296), so a data-driven renderer is right to emit nothing and
   * shouting about it would train devs to ignore the console. Everything else stays
   * an error — a field WITH content and no element is a renderer bug, and that
   * includes a revealed sentinel, where it means the reveal silently did nothing.
   *
   * Only edit-* attributes name a field. block-uid, block-add, linkable-* and the
   * rest are structural, so a missing target is always wrong.
   */
  isFieldAbsentFromRender(name, fieldName, renderedBlock) {
    if (name !== 'edit-text' && name !== 'edit-link' && name !== 'edit-media') {
      return false;
    }
    // A leading slash means a PAGE field (/title, /description), which lives on the
    // form root rather than the block.
    const source = fieldName.startsWith('/')
      ? this._lastRenderedData
      : renderedBlock;
    if (!source) return false;
    const value = source[fieldName.replace(/^\//, '')];
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    );
  }

  /**
   * Apply hydra attributes to an element and its children based on selectors.
   *
   * @param {HTMLElement} element - The root element
   * @param {Object} attrs - Parsed attributes { name: [{ value, selector }, ...] }
   * @param {Object} [renderedBlock] - The block data the renderer was handed, used
   *   to judge whether a selector matching nothing is correct or a bug.
   */
  applyHydraAttributes(element, attrs, renderedBlock) {
    const attrMap = {
      'block-uid': 'data-block-uid',
      'block-readonly': 'data-block-readonly',
      'edit-text': 'data-edit-text',
      'edit-link': 'data-edit-link',
      'edit-media': 'data-edit-media',
      'block-add': 'data-block-add',
      'block-selector': 'data-block-selector',
      'block-container': 'data-block-container',
      'linkable-id': 'data-linkable-id',
      // Leveled heading anchors — the suffix carries the heading level so the
      // harvested anchor list has a hierarchy (see linkableAnchors.js).
      'linkable-h1': 'data-linkable-h1',
      'linkable-h2': 'data-linkable-h2',
      'linkable-h3': 'data-linkable-h3',
      'linkable-h4': 'data-linkable-h4',
      'linkable-h5': 'data-linkable-h5',
      'linkable-h6': 'data-linkable-h6',
    };

    for (const [name, entries] of Object.entries(attrs)) {
      const domAttr = attrMap[name];
      if (!domAttr) continue;

      // Each attribute can have multiple entries (e.g., multiple edit-text)
      for (const { value, selector } of entries) {
        // Determine target element(s)
        const targets = selector
          ? element.querySelectorAll(selector)
          : [element];

        if (selector && targets.length === 0 && !this.isFieldAbsentFromRender(name, value, renderedBlock)) {
          console.error(`[hydra] Comment selector "${selector}" for ${name}=${value} matched no elements in`, element.tagName, element.className);
        }

        for (const target of targets) {
          // Don't overwrite existing attributes
          if (!target.hasAttribute(domAttr)) {
            target.setAttribute(domAttr, value === true ? '' : value);
            log('applyHydraAttributes:', domAttr, '=', value, 'to', target.tagName, selector ? `(${selector})` : '');
          }
        }
      }
    }
  }

  /**
   * Central method for receiving form data from Admin UI.
   * Sets both formData and lastReceivedFormData for echo detection.
   * All incoming data (INITIAL_DATA, FORM_DATA) should use this.
   *
   * @param {Object} data - The form data from Admin UI
   * @param {string} source - Where the data came from (for logging)
   * @param {Object} [blockPathMap] - Optional blockPathMap for nested block lookup
   */
  setFormDataFromAdmin(data, source, blockPathMap) {
    if (blockPathMap === undefined) {
      throw new Error(`setFormDataFromAdmin: blockPathMap is required (source: ${source})`);
    }

    this.blockPathMap = blockPathMap;

    // Note: do NOT clear _readonlyBlocks here. The frontend re-registers readonly blocks
    // via expandListingBlocks(), but that's async (API call). Clearing here creates a race
    // window where blocks appear non-readonly. Stale entries are harmless.

    const seq = data?._editSequence || 0;
    // Use simple direct lookup for logging - getBlockData uses this.formData which isn't set yet
    const blockData = this.selectedBlockUid ? data?.blocks?.[this.selectedBlockUid] : null;
    const text = blockData?.value?.[0]?.children?.[0]?.text?.substring(0, 40);
    log(`[setFormDataFromAdmin] source: ${source}, seq: ${seq}, block: ${this.selectedBlockUid}, text: ${JSON.stringify(text)}`);

    // Save previous formData for echo detection (done after addNodeIdsToAllSlateFields)
    this._prevFormDataJson = this.formData ? JSON.stringify(this.formData) : null;

    const dataJson = JSON.stringify(data);
    this.formData = JSON.parse(dataJson);
    this.lastReceivedFormData = JSON.parse(dataJson);
  }

  /**
   * Get block data by UID, supporting nested blocks via blockPathMap.
   * Falls back to top-level lookup if not found in blockPathMap.
   *
   * @param {string} blockUid - The UID of the block to look up
   * @returns {Object|undefined} The block data or undefined if not found
   */
  getBlockData(blockUid) {
    // PAGE_BLOCK_UID means page-level data
    if (blockUid === PAGE_BLOCK_UID) {
      return this.formData;
    }

    // First try blockPathMap for nested block support
    const pathInfo = this.blockPathMap?.[blockUid];
    if (pathInfo?.path && this.formData) {
      // Walk the path to get the nested block
      let current = this.formData;
      for (const key of pathInfo.path) {
        if (current && typeof current === 'object') {
          current = current[key];
        } else {
          current = undefined;
          break;
        }
      }
      if (current) {
        // Return the block data directly - no @type mutation needed
        // Block types are looked up via blockPathMap.blockType (single source of truth)
        return current;
      }
    }
    // No fallback - blockPathMap is the single source of truth
    return undefined;
  }

  /**
   * Get the resolved schema for a block from its blockPathMap entry.
   * Looks up the deduplicated schema via _schemaRef in blockPathMap._schemas.
   */
  getBlockSchema(blockUid) {
    const pathInfo = this.blockPathMap?.[blockUid];
    if (!pathInfo?._schemaRef) {
      if (pathInfo) log('getBlockSchema: no _schemaRef for', blockUid, 'keys:', Object.keys(pathInfo));
      return null;
    }
    if (!this.blockPathMap?._schemas) {
      log('getBlockSchema: no _schemas in blockPathMap');
      return null;
    }
    const schema = this.blockPathMap._schemas[pathInfo._schemaRef];
    if (!schema) log('getBlockSchema: schema not found for ref:', pathInfo._schemaRef, 'available:', Object.keys(this.blockPathMap._schemas));
    return schema || null;
  }

  /**
   * Get the block type for a given block ID.
   * Uses blockPathMap as the single source of truth (works for both regular blocks and object_list items).
   * @param {string} blockId - The block ID
   * @returns {string|undefined} The block type
   */
  getBlockType(blockId) {
    return this.blockPathMap?.[blockId]?.blockType;
  }

  /**
   * Resolve a data-edit path's block scope (`/`, `..`) to { blockId, fieldName }.
   * Thin wrapper over the pure `resolveFieldPath` helper, passing this bridge's
   * blockPathMap. The whole path grammar (block scope + object descent) lives in
   * @volto-hydra/helpers.
   */
  resolveFieldPath(fieldPath, blockId) {
    return resolveFieldPathHelper(fieldPath, blockId, this.blockPathMap);
  }

  /**
   * Check if an editable field belongs directly to a block, not a nested block.
   * Container blocks (like columns) contain nested blocks with their own editable fields.
   * This method helps avoid accidentally interacting with nested blocks' fields.
   *
   * @param {HTMLElement} field - The editable field element
   * @param {HTMLElement} blockElement - The block element to check ownership against
   * @returns {boolean} True if the field belongs directly to blockElement
   */
  /**
   * Which block does this element belong to?
   *
   * Normally the nearest `data-block-uid` ancestor. But a block can be drawn in
   * two places — a tab's label lives in the tab bar while its code lives in a
   * panel that is hidden, or not rendered at all, until that tab is chosen. The
   * block itself is the panel: that is the thing that has to be on screen before
   * it can be edited, and putting the uid on the always-visible button instead
   * would tell the bridge the block is already visible when the half you want to
   * edit is not.
   *
   * So the button carries `data-block-selector` — "I represent this uid" — and
   * anything editable inside it edits that block, even though the uid element is
   * elsewhere. Only a selector naming exactly ONE uid counts: `+1` / `-1` and
   * `uid:direction` are navigation, and a word list belongs to a container
   * advertising its children rather than standing in for one block.
   *
   * @param {HTMLElement} el - element to resolve (usually an editable field)
   * @returns {string|undefined} the owning block's uid
   */
  owningBlockUid(el) {
    if (!el) return undefined;
    const blockEl = el.closest('[data-block-uid]');
    const handle = el.closest('[data-block-selector]');
    if (handle && (!blockEl || handle.contains(blockEl) === false)) {
      const single = Bridge.soleUidNamedBy(Bridge.selectorTokens(handle));
      if (single) {
        // Prefer the handle only when it is NEARER than the uid element, i.e. the
        // uid element is an ancestor of the handle (a container) rather than the
        // block the field sits in.
        if (!blockEl || blockEl.contains(handle)) return single;
      }
    }
    return blockEl?.getAttribute('data-block-uid') ?? undefined;
  }

  fieldBelongsToBlock(field, blockElement) {
    return this.owningBlockUid(field) === this.uidRepresentedBy(blockElement);
  }

  /**
   * Which block does this ELEMENT stand for — the uid it carries, or the one it
   * advertises. A tab's button has no data-block-uid (the uid belongs on the
   * panel, so the bridge can see when the block is off screen), but it does
   * carry data-block-selector naming that tab, and the label inside it is that
   * tab's field. Comparing against data-block-uid alone dropped every field on
   * such an element.
   */
  /**
   * The uid a selector token names, or undefined if the token is not a uid.
   *
   * `+1` / `-1` and `uid:direction` are navigation, not naming. `uid#field` IS
   * naming — it says WHERE a particular field of that uid is edited (see
   * `tryMakeBlockVisible`), and for every purpose but choosing which handle to
   * click, it means the same as the bare uid.
   */
  /**
   * The one block a selector's tokens name, or undefined if they name several.
   *
   * A word list of DIFFERENT uids is a container advertising its children — it
   * stands in for no single block, and never did. But a handle may now name the
   * same block twice, once plainly and once by field:
   *
   *     data-block-selector="tab-py tab-py#code"
   *
   * which is one block said two ways — reveal the tab, and reveal where its code
   * is edited — so it still stands in for that block. Counting tokens rather
   * than the blocks they name took the label on such a button away from its tab,
   * and with it the ability to select the tab at all.
   */
  static soleUidNamedBy(tokens) {
    const uids = new Set(
      (tokens || []).map((t) => Bridge.uidFromSelectorToken(t)).filter(Boolean),
    );
    return uids.size === 1 ? [...uids][0] : undefined;
  }

  /**
   * The tokens of a `data-block-selector`, from the element or the raw value.
   * Every reader of the attribute goes through here: the word list is the
   * grammar (`uid`, `uid#field`, `uid:direction`, `+1`, `-1`), and splitting it
   * by hand in five places is how a two-token handle broke three of them.
   */
  static selectorTokens(source) {
    const value =
      typeof source === 'string'
        ? source
        : source?.getAttribute?.('data-block-selector') || '';
    return value.trim().split(/\s+/).filter(Boolean);
  }

  /**
   * The block a handle is FOR: the first token names it, whatever the rest of
   * the list is there to reveal (an accordion header carries its panel first,
   * then its children).
   */
  static primaryUidOf(source) {
    return Bridge.selectorTokens(source)[0];
  }

  static uidFromSelectorToken(token) {
    if (!token || token === '+1' || token === '-1' || token.includes(':')) {
      return undefined;
    }
    const uid = token.split('#')[0];
    return uid || undefined;
  }

  uidRepresentedBy(element) {
    if (!element) return undefined;
    const own = element.getAttribute?.('data-block-uid');
    if (own) return own;
    return Bridge.soleUidNamedBy(Bridge.selectorTokens(element));
  }

  /**
   * The editable fields a block owns, in the order the bridge treats as the
   * block's own: what it draws itself first, then what stands in for it.
   *
   * Both of the questions asked about a block's fields — "all of them" and
   * "the one called X" — are this list, so there is one collector. It gathers:
   *
   *   - every element carrying the uid (a block can be several: a grid image's
   *     figure + caption, an accordion panel's title + content), and their
   *     descendants that resolve back to this block rather than a nested one;
   *   - the fields drawn on a HANDLE instead — a tab's label sits on the button
   *     that reveals its panel, so it is nowhere inside the uid element.
   *
   * @param {HTMLElement} blockElement - Any element of the block
   * @param {string|null} fieldName - Only this field, when given
   * @returns {HTMLElement[]} The matching field elements
   */
  editableFieldsOf(blockElement, fieldName = null) {
    const found = [];
    const add = (el) => {
      if (el && !found.includes(el)) found.push(el);
    };
    // `collectBlockFields` is the walk: every element carrying the uid AND
    // every element that stands in for the block, minus what belongs to a
    // nested block or is readonly. This is that walk, as text fields, in order.
    this.collectBlockFields(blockElement, 'data-edit-text', (el, name) => {
      if (fieldName === null || name === fieldName) add(el);
    });
    return found;
  }

  /**
   * Get editable fields that belong directly to a block, excluding nested blocks' fields.
   * Also checks if the blockElement itself has data-edit-text (Nuxt pattern).
   *
   * @param {HTMLElement} blockElement - The block element
   * @returns {HTMLElement[]} Array of editable field elements that belong to this block
   */
  getOwnEditableFields(blockElement) {
    return this.editableFieldsOf(blockElement);
  }

  /**
   * Compile a per-block list of editable fields, derived from the rendered DOM.
   * Each block's user-frontend renders elements with `data-edit-text` (slate),
   * `data-edit-link` (link), or `data-edit-media` (media) attributes — the
   * authoritative declaration of "this field is end-user editable in the
   * iframe." This is distinct from the block's full schema, which also
   * includes settings fields (placeholder, instructions, fixed, etc.) that
   * appear in the sidebar but aren't user content.
   *
   * Result shape: `{ blockId: [{ fieldName, type }, ...], ... }`
   *   type ∈ 'slate' | 'link' | 'media'
   *
   * Sent with SLATE_TRANSFORM_REQUEST so the admin's merge / transform
   * handlers can decide e.g. "is the previous block a single-slate-content
   * block?" without schema-introspecting (which double-counts settings).
   */
  getEditableFieldsByBlock() {
    const ATTR_TO_TYPE = {
      'data-edit-text': 'slate',
      'data-edit-link': 'link',
      'data-edit-media': 'media',
    };
    const result = {};
    if (!this.blockPathMap) return result;
    for (const blockUid of Object.keys(this.blockPathMap)) {
      if (blockUid === '_schemas' || blockUid === '_page') continue;
      const elements = this.getAllBlockElements(blockUid);
      if (!elements?.length) continue;
      const fields = [];
      const seen = new Set();
      for (const el of elements) {
        for (const [attr, type] of Object.entries(ATTR_TO_TYPE)) {
          // Block element itself may carry the attribute (Nuxt pattern).
          if (el.hasAttribute?.(attr)) {
            const fieldName = el.getAttribute(attr);
            const key = `${attr}:${fieldName}`;
            if (!seen.has(key)) {
              seen.add(key);
              fields.push({ fieldName, type });
            }
          }
          for (const node of el.querySelectorAll(`[${attr}]`)) {
            if (!this.fieldBelongsToBlock(node, el)) continue;
            const fieldName = node.getAttribute(attr);
            const key = `${attr}:${fieldName}`;
            if (!seen.has(key)) {
              seen.add(key);
              fields.push({ fieldName, type });
            }
          }
        }
      }
      // Fields drawn on something that stands in for the block — the same
      // elements `collectBlockFields` reaches, and for the same reason: this
      // list is what the admin reads to decide what a block is made of.
      for (const [attr, type] of Object.entries(ATTR_TO_TYPE)) {
        for (const node of this.fieldsOnHandlesFor(blockUid, { attr })) {
          const fieldName = node.getAttribute(attr);
          const key = `${attr}:${fieldName}`;
          if (fieldName && !seen.has(key)) {
            seen.add(key);
            fields.push({ fieldName, type });
          }
        }
      }
      if (fields.length) result[blockUid] = fields;
    }
    return result;
  }

  /**
   * Get the first editable field that belongs directly to a block, excluding nested blocks' fields.
   * Also checks if the blockElement itself has data-edit-text (Nuxt pattern).
   *
   * @param {HTMLElement} blockElement - The block element
   * @returns {HTMLElement|null} The first editable field or null if none
   */
  getOwnFirstEditableField(blockElement) {
    return this.editableFieldsOf(blockElement)[0] || null;
  }

  /**
   * Where a field of this block is edited, whatever KIND of field it is — text,
   * link or media. A field's place can be hidden or drawn elsewhere regardless
   * of which picker it opens, so anything asking "is this field reachable?"
   * needs an answer that does not assume text.
   *
   * @param {HTMLElement} blockElement - Any element of the block
   * @param {string} fieldName - The field name to find
   * @returns {HTMLElement|null} The element, or null if the block has no such field
   */
  editableElementFor(blockElement, fieldName) {
    const text = this.getEditableFieldByName(blockElement, fieldName);
    if (text) return text;
    const uid = blockElement?.getAttribute?.('data-block-uid');
    for (const attr of ['data-edit-link', 'data-edit-media']) {
      const own = blockElement?.querySelector?.(`[${attr}="${fieldName}"]`);
      if (own) return own;
      const onHandle = this.fieldsOnHandlesFor(uid, { attr, fieldName })[0];
      if (onHandle) return onHandle;
    }
    return null;
  }

  /**
   * Get an editable field by name that belongs to a block.
   * Also checks if the blockElement itself has the field (Nuxt pattern).
   *
   * @param {HTMLElement} blockElement - The block element
   * @param {string} fieldName - The field name to find
   * @returns {HTMLElement|null} The editable field or null if not found
   */
  getEditableFieldByName(blockElement, fieldName) {
    const matches = this.editableFieldsOf(blockElement, fieldName);
    if (matches.length <= 1) return matches[0] || null;

    // The SAME field can be rendered more than once — responsive chrome does
    // this routinely: the side nav prints its title in both a mobile toggle and
    // a desktop header, and only one is visible at a given width. Taking the
    // first in DOM order picked the hidden twin, whose getBoundingClientRect()
    // is all zeros, so the click coordinates resolved to the top-left of the
    // document and the caret landed in whatever block happens to be there.
    //
    // Prefer the element the author actually clicked; failing that, the visible
    // one; only then fall back to document order.
    const clicked = this.lastClickPosition?.target;
    const clickedMatch = matches.find((el) => el === clicked || el.contains(clicked));
    if (clicked && clickedMatch) return clickedMatch;
    return matches.find((el) => !this.isElementHidden(el)) || matches[0];
  }

  /**
   * Collect fields with a given attribute from all elements of a block.
   * For multi-element blocks, searches ALL elements with the same UID.
   * Checks both the element itself and its descendants.
   *
   * @param {HTMLElement} blockElement - Any element of the block
   * @param {string} attrName - Attribute name (e.g., 'data-edit-link')
   * @param {Function} processor - (fieldElement, fieldName, results) => void
   * @returns {Object} Collected results
   */
  collectBlockFields(blockElement, attrName, processor) {
    const blockUid = blockElement.getAttribute('data-block-uid');

    // Check if block is marked readonly (registry, block data, or DOM attribute)
    if (blockUid && this.isBlockReadonly(blockUid)) {
      return {};
    }

    const results = {};

    // For page-level fields (no blockUid), process the element directly
    // For block fields, get all elements with this block UID (multi-element blocks)
    const elementsToProcess = blockUid
      ? this.getAllBlockElements(blockUid)
      : [blockElement];

    for (const element of elementsToProcess) {
      // Skip if this element has data-block-readonly
      // Readonly blocks ignore editable/linkable/media fields
      if (element.hasAttribute('data-block-readonly')) {
        continue;
      }

      // Check if element itself has the attribute
      const selfField = element.getAttribute(attrName);
      if (selfField) {
        processor(element, selfField, results);
      }
      // Check descendants (for blocks only - page-level fields are self-contained)
      if (blockUid) {
        for (const field of element.querySelectorAll(`[${attrName}]`)) {
          // Skip fields inside a readonly ancestor
          if (field.closest('[data-block-readonly]')) {
            continue;
          }
          if (this.fieldBelongsToBlock(field, element)) {
            const fieldName = field.getAttribute(attrName);
            if (fieldName) {
              processor(field, fieldName, results);
            }
          }
        }
      }
    }

    // And the elements that stand in for the block rather than being it. A
    // field can be drawn anywhere the frontend says the block is: a tab's label
    // on the button that reveals its panel, a cookie banner the design system
    // builds into `<body>`. They say so with `data-block-selector`, and that is
    // as true of a link or an image as of text — so this walk, which every
    // field kind goes through, is where it belongs. Without it a field drawn
    // outside the block's own element is invisible to everything downstream:
    // the editor's field list, the admin's merge decisions, block sanity.
    for (const field of this.fieldsOnHandlesFor(blockUid, { attr: attrName })) {
      if (field.closest('[data-block-readonly]')) continue;
      const fieldName = field.getAttribute(attrName);
      if (fieldName) processor(field, fieldName, results);
    }
    return results;
  }

  /**
   * Get linkable fields that belong directly to a block.
   * For multi-element blocks, searches ALL elements with the same UID.
   */
  getLinkableFields(blockElement) {
    return this.collectBlockFields(blockElement, 'data-edit-link',
      (el, name, results) => { results[name] = true; });
  }

  /**
   * Get effective bounding rect for a media field element.
   * If element has zero dimensions but uses absolute positioning with inset-0,
   * fall back to the first ancestor with actual dimensions.
   */
  getEffectiveMediaRect(element, fieldName) {
    let rect = element.getBoundingClientRect();

    // If element has dimensions, use them directly
    if (rect.width > 0 && rect.height > 0) {
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }

    // Element has zero dimensions - try to find a parent with dimensions
    // This handles elements like empty <img> tags that rely on parent for sizing.
    // Stop at block boundary (data-block-uid) to avoid using a parent container's
    // rect when the block itself is hidden (e.g., inactive carousel slide).
    let current = element.parentElement;
    let depth = 0;
    const maxDepth = 10; // Safety limit

    while (current && depth < maxDepth) {
      // Stop at block boundary - don't escape into parent block's DOM
      if (current.hasAttribute('data-block-uid')) {
        const blockRect = current.getBoundingClientRect();
        if (blockRect.width > 0 && blockRect.height > 0) {
          log(
            `data-edit-media="${fieldName}" has zero dimensions. ` +
            `Using block element's dimensions (${blockRect.width}x${blockRect.height}).`
          );
          return { top: blockRect.top, left: blockRect.left, width: blockRect.width, height: blockRect.height };
        }
        // Block itself is hidden (e.g., inactive carousel slide) - no valid rect
        break;
      }

      const parentRect = current.getBoundingClientRect();

      if (parentRect.width > 0 && parentRect.height > 0) {
        log(
          `data-edit-media="${fieldName}" has zero dimensions. ` +
          `Using parent's dimensions (${parentRect.width}x${parentRect.height}).`
        );
        return { top: parentRect.top, left: parentRect.left, width: parentRect.width, height: parentRect.height };
      }

      // Parent also has zero dimensions, continue up the chain
      current = current.parentElement;
      depth++;
    }

    // No fallback available, warn the developer
    console.warn(
      `[HYDRA] data-edit-media="${fieldName}" has zero dimensions (${rect.width}x${rect.height}). ` +
      `The element must have visible width and height for the image picker to position correctly. ` +
      `Set explicit dimensions or use a different element.`,
      element
    );
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  }

  /**
   * Get media fields that belong directly to a block.
   * For multi-element blocks, searches ALL elements with the same UID.
   */
  getMediaFields(blockElement) {
    return this.collectBlockFields(blockElement, 'data-edit-media',
      (el, name, results) => {
        const rect = this.getEffectiveMediaRect(el, name);
        // Skip fields with zero dimensions (e.g., hidden carousel slides)
        if (rect && rect.width > 0 && rect.height > 0) {
          results[name] = { rect };
        }
      });
  }

  /**
   * Get the add direction for a block element.
   * Uses data-block-add attribute if set, otherwise infers from nesting depth.
   * Even depths (0, 2, ...) → 'bottom' (vertical), odd depths (1, 3, ...) → 'right' (horizontal)
   * Returns 'hidden' if block cannot have siblings added (empty, readonly, no insertion points).
   *
   * @param {HTMLElement} blockElement - The block element
   * @returns {string} 'right', 'bottom', or 'hidden'
   */
  /**
   * How this block's siblings are ACTUALLY laid out: 'right' when they sit in a
   * row, 'bottom' when they stack. Returns null when there is nothing to
   * measure — one child tells you nothing about the axis, so the caller falls
   * back to the guess.
   *
   * Reading it off the page beats declaring it: a container's layout is a CSS
   * decision (a footer's columns flow in a row, its links stack inside them),
   * and the frontend already made it by the time we look.
   */
  _measureAddDirection(blockElement) {
    const uid = blockElement.getAttribute('data-block-uid');
    const info = this.blockPathMap?.[uid];
    if (!info) return null;
    // SAME REGION only. A container can have several (a footer holds its menu
    // columns, its secondary links and its social icons), and they are laid out
    // on different axes — measuring a column against a link says the columns
    // stack, which is exactly the wrong answer.
    const siblings = this._getSiblingsByDomOrder(null, info.parentId)
      .filter((id) => id !== uid && this.blockPathMap?.[id]?.region === info.region);
    if (siblings.length === 0) return null; // one child: no axis to read

    const mine = blockElement.getBoundingClientRect();
    if (!mine.width || !mine.height) return null;
    for (const sibId of siblings) {
      const el = this.queryBlockElement(sibId);
      if (!el) continue;
      const other = el.getBoundingClientRect();
      if (!other.width || !other.height) continue;
      // Side by side: they overlap vertically and are apart horizontally.
      // Stacked: the reverse. Compare OVERLAP on each axis rather than centres,
      // so unequal heights (a tall column beside a short one) still read as a
      // row.
      const overlapY = Math.min(mine.bottom, other.bottom) - Math.max(mine.top, other.top);
      const overlapX = Math.min(mine.right, other.right) - Math.max(mine.left, other.left);
      if (overlapY > 0 && overlapX <= 0) return 'right';
      if (overlapX > 0 && overlapY <= 0) return 'bottom';
      // Ambiguous (overlapping both ways, or neither): try the next sibling.
    }
    return null;
  }

  /**
   * The old default, kept for when there is nothing to measure: nesting-depth
   * parity. It is a guess — page level stacks, one level in is a row — and it is
   * wrong for any container that stacks its children at an odd depth.
   */
  _guessAddDirectionByDepth(blockElement) {
    let depth = 0;
    let parent = blockElement.parentElement;
    while (parent) {
      if (parent.hasAttribute('data-block-uid')) depth++;
      parent = parent.parentElement;
    }
    return depth % 2 === 0 ? 'bottom' : 'right';
  }

  getAddDirection(blockElement) {
    const blockUid = blockElement.getAttribute('data-block-uid');

    // Page-level fields (no block-uid) should not have add button
    if (!blockUid) {
      return 'hidden';
    }

    // Use centralized addability logic to check if adding is allowed
    const blockData = this.getBlockData(blockUid);
    const addability = getBlockAddability(blockUid, this.blockPathMap, blockData, this.templateEditMode);

    // Hide the add button only if the block can neither take a sibling after it NOR be
    // replaced. An '@type: empty' placeholder can't take siblings (canInsertAfter is false)
    // but CAN be replaced (canReplace) — the + then opens the chooser to pick its type in
    // place. Without this, a seeded empty (no defaultBlockType + multiple allowedBlocks) is
    // stranded with no + and no way to be typed.
    if (!addability.canInsertAfter && !addability.canReplace) {
      return 'hidden';
    }

    let addDirection = blockElement.getAttribute('data-block-add');
    if (!addDirection) {
      // MEASURE the siblings before guessing. The direction decides where the +
      // sits, which edges a drag inserts at, and which axis the drop indicator
      // is drawn on — so getting it wrong makes a container's inner edges hard
      // to hit, and a drop lands beside the parent instead of inside it.
      addDirection = this._measureAddDirection(blockElement) ??
        this._guessAddDirectionByDepth(blockElement);
    }
    return addDirection;
  }

  /**
   * Get the adjacent block ID in a given direction, using blockPathMap siblings + DOM order.
   * For table vertical navigation (Up/Down on cells), finds the same-column cell in the adjacent row.
   *
   * @param {string} blockId - The current block ID
   * @param {'forward'|'backward'} direction - Navigation direction
   * @param {boolean} isTableVertical - True for Up/Down navigation in table mode (cross-row)
   * @returns {string|null} The adjacent block ID, or null if at boundary
   */
  getAdjacentBlockId(blockId, direction, isTableVertical = false) {
    const pathInfo = this.blockPathMap?.[blockId];
    if (!pathInfo) return null;
    // parentId can be null for top-level blocks — they're still siblings

    if (isTableVertical) {
      // Table vertical: find same-column cell in adjacent row
      // cellId → rowId (parentId) → tableId (row's parentId)
      const rowId = pathInfo.parentId;
      const rowInfo = this.blockPathMap?.[rowId];
      if (!rowInfo?.parentId) return null;
      const tableId = rowInfo.parentId;

      // Get all rows (siblings of rowId with same parentId=tableId), sorted by DOM
      const rows = this._getSiblingsByDomOrder(rowId, tableId);
      const rowIdx = rows.indexOf(rowId);
      if (rowIdx === -1) return null;

      // Get cells in current row to find column index
      const cellsInCurrentRow = this._getSiblingsByDomOrder(blockId, rowId);
      const colIdx = cellsInCurrentRow.indexOf(blockId);
      if (colIdx === -1) return null;

      // Find adjacent row
      const adjRowIdx = direction === 'forward' ? rowIdx + 1 : rowIdx - 1;
      if (adjRowIdx < 0 || adjRowIdx >= rows.length) return null;
      const adjRowId = rows[adjRowIdx];

      // Get cells in adjacent row and pick same column
      const cellsInAdjRow = Object.entries(this.blockPathMap)
        .filter(([, info]) => info.parentId === adjRowId)
        .map(([id]) => id);
      // Sort by DOM order
      cellsInAdjRow.sort((a, b) => {
        const elA = this.queryBlockElement(a);
        const elB = this.queryBlockElement(b);
        if (!elA || !elB) return 0;
        return elA.compareDocumentPosition(elB) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

      return colIdx < cellsInAdjRow.length ? cellsInAdjRow[colIdx] : null;
    }

    // Standard: find siblings with same parentId, sorted by DOM, pick adjacent
    const siblings = this._getSiblingsByDomOrder(blockId, pathInfo.parentId);
    const idx = siblings.indexOf(blockId);
    if (idx === -1) return null;
    const adjIdx = direction === 'forward' ? idx + 1 : idx - 1;
    return (adjIdx >= 0 && adjIdx < siblings.length) ? siblings[adjIdx] : null;
  }

  /**
   * Get sibling block IDs sorted by DOM position.
   * @param {string} blockId - A block to find siblings for
   * @param {string} parentId - The parent block ID
   * @returns {string[]} Sibling IDs sorted by DOM order
   */
  _getSiblingsByDomOrder(blockId, parentId) {
    const siblings = Object.entries(this.blockPathMap)
      .filter(([, info]) => info.parentId === parentId)
      .map(([id]) => id);
    siblings.sort((a, b) => {
      const elA = this.queryBlockElement(a);
      const elB = this.queryBlockElement(b);
      if (!elA || !elB) return 0;
      return elA.compareDocumentPosition(elB) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return siblings;
  }

  _sameUids(a, b) {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((uid) => setB.has(uid));
  }

  /** True if `ancestorUid` appears anywhere in `descendantUid`'s parent chain. */
  _isAncestor(ancestorUid, descendantUid) {
    if (!ancestorUid || !descendantUid) return false;
    let cur = this.blockPathMap?.[descendantUid]?.parentId;
    while (cur) {
      if (cur === ancestorUid) return true;
      cur = this.blockPathMap?.[cur]?.parentId;
    }
    return false;
  }

  /**
   * Auto-scroll helper for drag operations.
   *
   * Returns { onMouseMove(e), stop() } that the caller wires into a drag's
   * mousemove and mouseup. While the cursor is within `threshold` pixels of
   * the viewport top or bottom, the page scrolls at a speed proportional to
   * how close it is to the edge (faster nearer the edge). A synthetic
   * mousemove is dispatched on each scroll tick so the caller's drag
   * indicator updates while the mouse is stationary at the edge.
   *
   * Used by:
   *  - block DnD (existing drag-and-drop)
   *  - container edge-drag
   */
  _createAutoScroller() {
    const threshold = 80; // pixels from viewport edge to start scrolling
    const minSpeed = 10;
    const maxSpeed = 50;
    let direction = 0; // -1 up, 0 none, 1 down
    let speed = 0;
    let animId = null;
    let lastX = 0;
    let lastY = 0;

    const loop = () => {
      if (direction === 0) return;
      window.scrollTo({
        top: window.scrollY + direction * speed,
        behavior: 'instant',
      });
      // Synthetic mousemove so the drag indicator follows the scrolled content
      // even when the cursor is held still at the edge.
      document.dispatchEvent(new MouseEvent('mousemove', {
        clientX: lastX, clientY: lastY, bubbles: true,
      }));
      animId = requestAnimationFrame(loop);
    };

    const setDirection = (d) => {
      if (direction === d) return;
      direction = d;
      if (animId === null && d !== 0) {
        animId = requestAnimationFrame(loop);
      }
    };

    const stop = () => {
      direction = 0;
      if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    };

    const onMouseMove = (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      const vh = window.innerHeight;
      if (e.clientY < threshold) {
        const factor = 1 - e.clientY / threshold;
        speed = minSpeed + (maxSpeed - minSpeed) * factor;
        setDirection(-1);
      } else if (e.clientY > vh - threshold) {
        const factor = 1 - (vh - e.clientY) / threshold;
        speed = minSpeed + (maxSpeed - minSpeed) * factor;
        setDirection(1);
      } else {
        stop();
      }
    };

    return { onMouseMove, stop };
  }

  /**
   * Position all 4 edge handles for the selected container.
   * For each edge:
   *   - Show if absorb is possible: there's a sibling on the outward side
   *     (parent layout matches edge axis) whose @type the container accepts.
   *   - Show if expel is possible: the container has a child whose @type
   *     the parent accepts (children layout matches edge axis).
   * The drag handler reads dataset attributes to know what to do.
   */
  _positionEdgeHandles() {
    const hide = () => {
      this._lastCanResize = null;
      if (this._edgeHandles) {
        for (const h of Object.values(this._edgeHandles)) h.style.display = 'none';
      }
    };
    if (!this._edgeHandles) return;
    // While an edge-handle drag is in progress the container's absorb/expel
    // capability cannot change — only which children the cursor has crossed.
    // Re-probing here (triggered by autoscroll's scroll events) is pure churn
    // and would yank the invisible handle out from under the active drag, so
    // freeze: keep the capability flags computed at mousedown.
    if (this._edgeDragActive) return;
    const uid = this.selectedBlockUid;
    if (!uid || uid === PAGE_BLOCK_UID) { hide(); return; }
    const info = this.blockPathMap?.[uid];
    const el = uid ? this.queryBlockElement(uid) : null;
    if (!info || !el) { hide(); return; }

    const ownChildren = this._getSiblingsByDomOrder(null, uid);
    if (ownChildren.length === 0) { hide(); return; }

    // childAllowed = the types this container accepts as direct children.
    // Most reliable source: the container's first child's allowedSiblingTypes
    // (computed by buildBlockPathMap from the block-config + schema chain).
    // Falling back to scanning the block's schema for a blocks_layout/
    // object_list widget misses cases where allowedBlocks lives on the block
    // config (e.g. gridBlock has no blocks_layout in its blockSchema —
    // allowedBlocks is on blocksConfig.gridBlock).
    const firstChildInfo = this.blockPathMap?.[ownChildren[0]];
    let childAllowed = firstChildInfo?.allowedSiblingTypes || null;

    // parentAllowed = allowedBlocks of the field this container lives in.
    // Used to decide if expel can land children at the parent level.
    const parentInfo = this.blockPathMap?.[info.parentId];
    const parentSchema = parentInfo?._schemaRef
      ? this.blockPathMap?._schemas?.[parentInfo._schemaRef] : null;
    let parentAllowed = null;
    if (parentSchema?.properties && info.region) {
      const fd = parentSchema.properties[info.region];
      if (fd?.widget === 'blocks_layout' || fd?.widget === 'object_list') {
        parentAllowed = fd.allowedBlocks || null;
      }
    } else if (info.parentId === PAGE_BLOCK_UID) {
      parentAllowed = info.allowedSiblingTypes || null;
    }

    const r = el.getBoundingClientRect();

    // canAbsorb / canExpel per-edge: ask the shared _computeEdgePlan
    // "would dragging this edge to infinity in the outward (absorb) /
    // inward (expel) direction yield any blocks?". Single source of
    // truth — the at-rest visibility check and the drag-time chrome
    // (growth box / tints / MOVE_BLOCKS) use the exact same logic.
    const planFor = (edge, mode) => {
      const FAR = 1e7;
      let cursorCoord;
      if (mode === 'absorb') {
        // Cursor far in the outward direction.
        cursorCoord = (edge === 'bottom') ? r.bottom + FAR
          : (edge === 'top')   ? r.top - FAR
          : (edge === 'right') ? r.right + FAR
          :                       r.left - FAR;
      } else {
        // Cursor far in the inward direction (past the opposite edge).
        cursorCoord = (edge === 'bottom') ? r.top - FAR
          : (edge === 'top')   ? r.bottom + FAR
          : (edge === 'right') ? r.left - FAR
          :                       r.right + FAR;
      }
      return this._computeEdgePlan(uid, edge, mode, cursorCoord).blocks.length > 0;
    };

    const perEdge = {};
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      perEdge[edge] = {
        canAbsorb: planFor(edge, 'absorb'),
        canExpel:  planFor(edge, 'expel'),
      };
    }
    // canResize per-edge = either absorb or expel possible. This is the
    // admin-facing summary used to decide which edge handles to render.
    const canResize = {
      top: perEdge.top.canAbsorb || perEdge.top.canExpel,
      bottom: perEdge.bottom.canAbsorb || perEdge.bottom.canExpel,
      left: perEdge.left.canAbsorb || perEdge.left.canExpel,
      right: perEdge.right.canAbsorb || perEdge.right.canExpel,
    };
    if (!canResize.top && !canResize.bottom && !canResize.left && !canResize.right) {
      hide(); return;
    }
    this._lastCanResize = canResize;

    // Position the (invisible) event-capture divs in iframe coords. They
    // sit underneath the admin's visible chrome (pointer-events: none) so
    // mouse events pass through to be captured here for drag start.
    // Each handle is 1/3 of the edge length, centred — gives a clear hit
    // area without the chrome looking like a full-size frame.
    const w3 = r.width / 3;
    const h3 = r.height / 3;
    const positions = {
      top:    { left: r.left + w3, top: r.top - 3, width: w3, height: 6, axis: 'vertical' },
      bottom: { left: r.left + w3, top: r.bottom - 3, width: w3, height: 6, axis: 'vertical' },
      left:   { left: r.left - 3, top: r.top + h3, width: 6, height: h3, axis: 'horizontal' },
      right:  { left: r.right - 3, top: r.top + h3, width: 6, height: h3, axis: 'horizontal' },
    };
    for (const [edge, pos] of Object.entries(positions)) {
      const handle = this._edgeHandles[edge];
      if (!handle) continue;
      if (!canResize[edge]) {
        handle.style.display = 'none';
        continue;
      }
      handle.style.left = `${pos.left}px`;
      handle.style.top = `${pos.top}px`;
      handle.style.width = `${pos.width}px`;
      handle.style.height = `${pos.height}px`;
      handle.style.display = 'block';
      handle.dataset.edge = edge;
      handle.dataset.axis = pos.axis;
      handle.dataset.container = uid;
      handle.dataset.canAbsorb = perEdge[edge].canAbsorb ? '1' : '';
      handle.dataset.canExpel = perEdge[edge].canExpel ? '1' : '';
      handle.dataset.childAllowed = childAllowed ? childAllowed.join(',') : '';
      handle.dataset.parentAllowed = parentAllowed ? parentAllowed.join(',') : '';
    }
  }

  /**
   * Geometry helper: signed outward distance from the edge in the
   * direction the user would drag to absorb. Positive = outward
   * (absorb mode); negative = inward (expel mode).
   */
  _edgeGeometry(edge, rect, mouseX, mouseY) {
    switch (edge) {
      case 'bottom': return { axis: 'vertical',   edgePos: rect.bottom, mouseCoord: mouseY, outward: mouseY - rect.bottom };
      case 'top':    return { axis: 'vertical',   edgePos: rect.top,    mouseCoord: mouseY, outward: rect.top - mouseY };
      case 'right':  return { axis: 'horizontal', edgePos: rect.right,  mouseCoord: mouseX, outward: mouseX - rect.right };
      case 'left':   return { axis: 'horizontal', edgePos: rect.left,   mouseCoord: mouseX, outward: rect.left - mouseX };
      default:       return null;
    }
  }

  /**
   * Compute the absorb/expel plan for an edge of a container — the single
   * source of truth used by both at-rest edge-visibility (canResize) and
   * drag-time chrome (growth box / tints / MOVE_BLOCKS on release).
   *
   * @param {string} containerUid
   * @param {string} edge   - 'top' | 'bottom' | 'left' | 'right'
   * @param {'absorb'|'expel'} mode
   * @param {number} cursorCoord - cursor position on the edge's perpendicular
   *   axis. Pass ±Infinity to simulate "drag this edge as far as possible";
   *   that's how _positionEdgeHandles asks "is anything absorbable here?"
   *   without an actual mouse event.
   * @returns {{ kind: 'absorb'|'expel'|'none', blocks: string[], boundary: number }}
   */
  _computeEdgePlan(containerUid, edge, mode, cursorCoord) {
    const containerEl = this.queryBlockElement(containerUid);
    if (!containerEl) return { kind: 'none', blocks: [], boundary: 0 };
    const cRect = containerEl.getBoundingClientRect();
    const isVerticalEdge = edge === 'top' || edge === 'bottom';
    const geo = this._edgeGeometry(
      edge, cRect,
      isVerticalEdge ? cRect.left + cRect.width / 2 : cursorCoord,
      isVerticalEdge ? cursorCoord : cRect.top + cRect.height / 2,
    );
    if (!geo) return { kind: 'none', blocks: [], boundary: 0 };

    const containerInfo = this.blockPathMap?.[containerUid];
    const containerParentId = containerInfo?.parentId;

    // Resolve childAllowed / parentAllowed from blockPathMap (not from
    // handle dataset — this method is also called at rest, before any
    // handle exists).
    const ownChildren = this._getSiblingsByDomOrder(null, containerUid);
    const firstChildInfo = this.blockPathMap?.[ownChildren[0]];
    const childAllowed = firstChildInfo?.allowedSiblingTypes || null;
    // Expelled children become siblings of the container, so they must satisfy
    // the container's REGION (allowedSiblingTypes, already region-resolved by
    // buildBlockPathMap) — not the raw field-level allowedBlocks, which would
    // ignore a region's narrower allowed list. expelAllowedTypes encodes that
    // precedence; the field def is only a fallback.
    const parentInfo = this.blockPathMap?.[containerParentId];
    const parentSchema = parentInfo?._schemaRef
      ? this.blockPathMap?._schemas?.[parentInfo._schemaRef] : null;
    const parentFd = parentSchema?.properties && containerInfo?.region
      ? parentSchema.properties[containerInfo.region] : null;
    const parentFieldDef = (parentFd?.widget === 'blocks_layout' || parentFd?.widget === 'object_list')
      ? parentFd : null;
    const parentAllowed = expelAllowedTypes(containerInfo, parentFieldDef);

    const blockMid = (el, axis) => {
      const r = el.getBoundingClientRect();
      return axis === 'vertical' ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2;
    };
    const sign = (edge === 'top' || edge === 'left') ? -1 : 1;

    let candidates;
    let accepts;
    if (mode === 'absorb') {
      // Same drop-acceptance the DnD scan uses (native OR conversion via conversionMap),
      // NOT a bare allowed-types `.includes` — keep edge-drag and drag consistent (DRY).
      accepts = (t) => acceptableAt(t, childAllowed, false, this.conversionMap);
      candidates = new Set();
      for (const [uid, info] of Object.entries(this.blockPathMap)) {
        if (!uid || uid === containerUid) continue;
        if (info?.isFixed) continue;
        if (this._isAncestor(uid, containerUid)) continue;
        if (this._isAncestor(containerUid, uid)) continue;
        if (!this._isAncestor(containerParentId, uid) && uid !== containerParentId) continue;
        const el = this.queryBlockElement(uid);
        if (!el) continue;
        const mid = blockMid(el, geo.axis);
        const outwardOfEdge = (mid - geo.edgePos) * sign > 0;
        const inwardOfCursor = (mid - geo.mouseCoord) * sign < 0;
        if (outwardOfEdge && inwardOfCursor) candidates.add(uid);
      }
    } else {
      accepts = (t) => acceptableAt(t, parentAllowed, false, this.conversionMap);
      candidates = new Set();
      for (const [uid, info] of Object.entries(this.blockPathMap)) {
        if (!uid || uid === containerUid) continue;
        if (info?.isFixed) continue;
        if (!this._isAncestor(containerUid, uid)) continue;
        const el = this.queryBlockElement(uid);
        if (!el) continue;
        const mid = blockMid(el, geo.axis);
        const outwardOfCursor = (mid - geo.mouseCoord) * sign > 0;
        if (outwardOfCursor) candidates.add(uid);
      }
    }

    // Bottom-up promotion.
    let changed = true;
    while (changed) {
      changed = false;
      for (const uid of [...candidates]) {
        const info = this.blockPathMap[uid];
        const pid = info?.parentId;
        if (!pid) continue;
        if (mode === 'absorb' && pid === containerParentId) continue;
        if (mode === 'expel' && pid === containerUid) continue;
        const sibs = Object.entries(this.blockPathMap)
          .filter(([, i]) => i?.parentId === pid).map(([id]) => id);
        if (sibs.length === 0 || !sibs.every((c) => candidates.has(c))) continue;
        const pType = this.getBlockData(pid)?.['@type'];
        if (!accepts(pType)) continue;
        for (const c of sibs) candidates.delete(c);
        candidates.add(pid);
        changed = true;
      }
    }
    // Drop any orphan whose @type isn't accepted.
    for (const uid of [...candidates]) {
      const t = this.getBlockData(uid)?.['@type'];
      if (!accepts(t)) candidates.delete(uid);
    }

    const blocks = [...candidates].sort((a, b) => {
      const ea = this.queryBlockElement(a);
      const eb = this.queryBlockElement(b);
      if (!ea || !eb) return 0;
      return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    let boundary = geo.edgePos;
    for (const uid of blocks) {
      const el = this.queryBlockElement(uid);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (edge === 'bottom') boundary = Math.max(boundary, r.bottom);
      else if (edge === 'top') boundary = Math.min(boundary, r.top);
      else if (edge === 'right') boundary = Math.max(boundary, r.right);
      else if (edge === 'left') boundary = Math.min(boundary, r.left);
    }

    return { kind: blocks.length > 0 ? mode : 'none', blocks, boundary };
  }

  _setupEdgeHandleDrag(handle) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    // Per-drag visual state.
    let growthBox = null;
    const overlays = new Map(); // uid -> tinted overlay div
    let autoScroller = null;

    const ensureGrowthBox = () => {
      if (growthBox) return growthBox;
      growthBox = document.createElement('div');
      growthBox.className = 'volto-hydra-edge-growth';
      Object.assign(growthBox.style, {
        position: 'fixed',
        background: 'rgba(0, 126, 177, 0.08)',
        zIndex: '10000',
        pointerEvents: 'none',
        display: 'none',
      });
      document.body.appendChild(growthBox);
      return growthBox;
    };

    const tintBlock = (uid) => {
      if (overlays.has(uid)) return;
      const el = this.queryBlockElement(uid);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const overlay = document.createElement('div');
      overlay.className = 'volto-hydra-edge-absorb-tint';
      Object.assign(overlay.style, {
        position: 'fixed',
        left: `${r.left}px`, top: `${r.top}px`,
        width: `${r.width}px`, height: `${r.height}px`,
        background: 'rgba(0, 126, 177, 0.15)',
        outline: '2px dashed rgba(0, 126, 177, 0.6)',
        outlineOffset: '-2px',
        zIndex: '10000', pointerEvents: 'none',
      });
      document.body.appendChild(overlay);
      overlays.set(uid, overlay);
    };

    const cleanup = () => {
      if (growthBox) growthBox.style.display = 'none';
      for (const o of overlays.values()) o.remove();
      overlays.clear();
    };

    // Wraps the shared _computeEdgePlan method, deciding mode (absorb vs
    // expel) from the cursor's signed outward distance.
    const computePlan = (e) => {
      const edge = handle.dataset.edge;
      const containerUid = handle.dataset.container;
      const containerEl = this.queryBlockElement(containerUid);
      if (!containerEl || !edge) return { kind: 'none', blocks: [], boundary: 0 };
      const cRect = containerEl.getBoundingClientRect();
      const geo = this._edgeGeometry(edge, cRect, e.clientX, e.clientY);
      if (!geo) return { kind: 'none', blocks: [], boundary: 0 };
      // A few px of slop so a tiny drag in the "wrong" direction doesn't
      // immediately switch modes.
      const slop = 3;
      let mode = null;
      if (geo.outward > slop && handle.dataset.canAbsorb) mode = 'absorb';
      else if (geo.outward < -slop && handle.dataset.canExpel) mode = 'expel';
      if (!mode) return { kind: 'none', blocks: [], boundary: geo.edgePos };
      return this._computeEdgePlan(containerUid, edge, mode, geo.mouseCoord);
    };

    // Update the growth box to span between A's edge and the boundary, with
    // the moving edge of the box thickened when there's a non-empty plan.
    const updateGrowthBox = (e, plan) => {
      if (!growthBox) return;
      const containerEl = this.queryBlockElement(handle.dataset.container);
      if (!containerEl) return;
      const cRect = containerEl.getBoundingClientRect();
      const edge = handle.dataset.edge;
      const valid = plan.kind !== 'none' && plan.blocks.length > 0;
      const reset = (k, v) => growthBox.style.setProperty(k, v);
      ['borderTopWidth','borderBottomWidth','borderLeftWidth','borderRightWidth']
        .forEach((p) => reset(p, '0'));
      // Box spans from container's edge to the plan boundary (or cursor when no plan).
      const cursor = (edge === 'top' || edge === 'bottom') ? e.clientY : e.clientX;
      const dragKindIsExpel = plan.kind === 'expel';
      let endCoord;
      if (valid) endCoord = plan.boundary;
      else endCoord = (handle.dataset.canAbsorb || handle.dataset.canExpel) ? cursor : null;
      if (endCoord === null) { growthBox.style.display = 'none'; return; }

      if (edge === 'bottom' || edge === 'top') {
        const top = Math.min(edge === 'top' ? endCoord : cRect.bottom,
                              edge === 'top' ? cRect.top : endCoord);
        const bottom = Math.max(edge === 'top' ? endCoord : cRect.bottom,
                                 edge === 'top' ? cRect.top : endCoord);
        growthBox.style.left = `${cRect.left}px`;
        growthBox.style.width = `${cRect.width}px`;
        growthBox.style.top = `${top}px`;
        growthBox.style.height = `${Math.max(0, bottom - top)}px`;
        const moving = edge === 'top' ? 'borderTopWidth' : 'borderBottomWidth';
        growthBox.style[moving] = valid ? '6px' : '1px';
        growthBox.style.borderColor = '#007eb1';
        growthBox.style.borderStyle = 'solid';
      } else {
        const left = Math.min(edge === 'left' ? endCoord : cRect.right,
                              edge === 'left' ? cRect.left : endCoord);
        const right = Math.max(edge === 'left' ? endCoord : cRect.right,
                                edge === 'left' ? cRect.left : endCoord);
        growthBox.style.top = `${cRect.top}px`;
        growthBox.style.height = `${cRect.height}px`;
        growthBox.style.left = `${left}px`;
        growthBox.style.width = `${Math.max(0, right - left)}px`;
        const moving = edge === 'left' ? 'borderLeftWidth' : 'borderRightWidth';
        growthBox.style[moving] = valid ? '6px' : '1px';
        growthBox.style.borderColor = '#007eb1';
        growthBox.style.borderStyle = 'solid';
      }
      // Visually distinguish expel from absorb.
      growthBox.style.background = dragKindIsExpel
        ? 'rgba(220, 53, 69, 0.06)' : 'rgba(0, 126, 177, 0.08)';
      growthBox.style.display = 'block';
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      // Capability (canAbsorb/canExpel) was computed when the container was
      // selected and is fixed for the duration of this drag; freeze
      // _positionEdgeHandles so autoscroll's scroll events don't re-probe.
      this._edgeDragActive = true;
      lastX = e.clientX;
      lastY = e.clientY;
      autoScroller = this._createAutoScroller();
      ensureGrowthBox();
      updateGrowthBox(e, { kind: 'none', blocks: [], boundary: 0 });
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      lastX = e.clientX;
      lastY = e.clientY;
      autoScroller?.onMouseMove(e);

      const plan = computePlan(e);
      updateGrowthBox(e, plan);

      // Tint blocks in the plan; remove stale tints.
      const wanted = new Set(plan.blocks);
      for (const [uid, overlay] of overlays) {
        if (!wanted.has(uid)) {
          overlay.remove();
          overlays.delete(uid);
        }
      }
      for (const uid of plan.blocks) tintBlock(uid);
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      this._edgeDragActive = false;
      autoScroller?.stop();
      autoScroller = null;

      const plan = computePlan({ clientX: lastX, clientY: lastY });
      const containerUid = handle.dataset.container;
      const containerInfo = containerUid ? this.blockPathMap?.[containerUid] : null;
      const edge = handle.dataset.edge;
      cleanup();

      if (plan.kind === 'none' || plan.blocks.length === 0 || !containerUid) return;

      // selectAfterMove pins selection on the dragged container — the user
      // adjusted its boundary, not selected the moved block.
      const baseMessage = {
        type: 'MOVE_BLOCKS',
        blockIds: plan.blocks,
        selectAfterMove: containerUid,
      };

      if (plan.kind === 'absorb') {
        // Move plan blocks into the container. Two cases:
        //   - Container has children → target = lastChild / firstChild
        //     (insertAfter=true for bottom/right, false for top/left).
        //   - Container is empty → MOVE_BLOCKS targets containerUid itself
        //     with `insertInside: true` so the admin handler appends.
        const ownChildren = this._getSiblingsByDomOrder(null, containerUid);
        const insertAfter = (edge === 'bottom' || edge === 'right');
        const target = ownChildren.length > 0
          ? (insertAfter ? ownChildren[ownChildren.length - 1] : ownChildren[0])
          : containerUid;
        window.parent.postMessage({
          ...baseMessage,
          targetBlockId: target,
          insertAfter,
          targetParentId: containerUid,
        }, this.adminOrigin);
      } else if (plan.kind === 'expel') {
        // Move plan blocks out of the container to its parent. They land
        // before A (top/left edge) or after A (bottom/right edge).
        const insertAfter = (edge === 'bottom' || edge === 'right');
        window.parent.postMessage({
          ...baseMessage,
          targetBlockId: containerUid,
          insertAfter,
          targetParentId: containerInfo?.parentId,
        }, this.adminOrigin);
      }
    });
  }

  /**
   * Deepest render-order insertion target when a block ENTERS `containerUid`
   * from `enterEdge` ('top' → before the first child, 'bottom' → after the
   * last child). Follows the near-edge child chain down and returns the
   * DEEPEST sub-container whose region accepts `type` (so a slate entering
   * `columns` lands in the nearest column, not beside the columns). Returns
   * null when no reachable level accepts `type` — the caller then swaps/skips
   * past the container. Acceptance is the schema's region rule
   * (allowedSiblingTypes); which child to follow is DOM order (render).
   */
  _descendAbsorbTarget(containerUid, enterEdge, type) {
    const children = this._getSiblingsByDomOrder(null, containerUid);
    if (children.length === 0) return null; // leaf / empty container: not enterable here
    const insertAfter = enterEdge === 'bottom';
    const nearChild = insertAfter ? children[children.length - 1] : children[0];
    // Deepest-acceptable wins: try to descend into the near child first.
    if (this._getSiblingsByDomOrder(null, nearChild).length > 0) {
      const deeper = this._descendAbsorbTarget(nearChild, enterEdge, type);
      if (deeper) return deeper;
    }
    // Accept at THIS level if the container's region allows `type`.
    const childAllowed = this.blockPathMap?.[children[0]]?.allowedSiblingTypes || null;
    if (!childAllowed || (type && childAllowed.includes(type))) {
      return { targetBlockId: nearChild, insertAfter, targetParentId: containerUid };
    }
    return null;
  }

  /**
   * When a block is at its container's edge (no sibling in the move
   * direction), walk UP through ancestor containers until one whose region
   * accepts `type` is found, and place the block as a sibling of the highest
   * rejecting container in that region. e.g. a slate at the top of a column
   * escapes col → columns (rejects slate) → page (accepts). Null when nothing
   * up to the page accepts `type` (chevron stays disabled).
   */
  _ascendExpelTarget(blockUid, down) {
    const type = this.getBlockData(blockUid)?.['@type'];
    let container = this.blockPathMap?.[blockUid]?.parentId;
    while (container && container !== PAGE_BLOCK_UID) {
      const cInfo = this.blockPathMap[container];
      const grandparent = cInfo?.parentId;
      // Types allowed as siblings of `container` = the region the block would
      // land in if it escapes to this level.
      const regionAllowed = cInfo?.allowedSiblingTypes || null;
      if (!regionAllowed || (type && regionAllowed.includes(type))) {
        return {
          targetBlockId: container,
          insertAfter: down,
          targetParentId:
            grandparent && grandparent !== PAGE_BLOCK_UID ? grandparent : null,
        };
      }
      container = grandparent;
    }
    return null;
  }

  /**
   * Chevron (mobile up/down) move target. ONE rule for every case, computed
   * from render order (_getSiblingsByDomOrder) + the schema's region
   * acceptance, routed through the MOVE_BLOCKS → moveBlockBetweenContainers
   * container API. Moving `blockUid` one visual step in `direction`
   * ('up'|'down'):
   *   - neighbour in that direction is a container that accepts us at some
   *     reachable level → ABSORB into it (deepest near-edge position);
   *   - neighbour is a plain sibling (or a container that rejects us at every
   *     level) → SWAP past it within this region;
   *   - no neighbour (at the container edge) → EXPEL to the nearest ancestor
   *     region that accepts us.
   * Returns { targetBlockId, insertAfter, targetParentId } or null (disabled).
   */
  _computeChevronMove(blockUid, direction) {
    if (!blockUid || blockUid === PAGE_BLOCK_UID) return null;
    const info = this.blockPathMap?.[blockUid];
    if (!info) return null;
    if (this._filterMutableBlockUids([blockUid], 'move').length === 0) return null;

    const parentId = info.parentId;
    const down = direction === 'down';
    const type = this.getBlockData(blockUid)?.['@type'];

    // Render-order siblings sharing this block's region.
    const siblings = this._getSiblingsByDomOrder(null, parentId).filter(
      (id) => this.blockPathMap?.[id]?.region === info.region,
    );
    const idx = siblings.indexOf(blockUid);
    if (idx < 0) return null;
    const neighborId = siblings[down ? idx + 1 : idx - 1];

    if (neighborId) {
      // ABSORB into the neighbour if it's a container that accepts us at some
      // reachable level; otherwise SWAP past it within this region.
      const neighborIsContainer =
        this._getSiblingsByDomOrder(null, neighborId).length > 0;
      if (neighborIsContainer) {
        const target = this._descendAbsorbTarget(
          neighborId,
          down ? 'top' : 'bottom',
          type,
        );
        if (target) return target;
      }
      return {
        targetBlockId: neighborId,
        insertAfter: down,
        targetParentId: parentId === PAGE_BLOCK_UID ? null : parentId,
      };
    }

    // At the container edge → EXPEL to the nearest ancestor region that accepts us.
    if (parentId && parentId !== PAGE_BLOCK_UID) {
      return this._ascendExpelTarget(blockUid, down);
    }
    return null;
  }

  /**
   * Filter a list of block UIDs to those that can be mutated by `op`.
   * Single source of truth for locked-block protection on the iframe side.
   * op: 'delete' | 'move' | 'edit'.
   */
  _filterMutableBlockUids(uids, op = 'delete') {
    return uids.filter((uid) => {
      if (!uid) return false;
      const blockData = this.getBlockData(uid);
      if ((op === 'delete' || op === 'move')
          && isBlockPositionLocked(blockData, this.templateEditMode)) {
        return false;
      }
      if ((op === 'delete' || op === 'edit')
          && isBlockReadonly(blockData, this.templateEditMode)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Detects text selections that span multiple blocks and converts them into
   * a multi-block selection. Fires on each selectionchange.
   * Only active in text mode — block-mode Shift+Click extends text selection
   * as a side effect; block-level click handlers own that state transition.
   */
  _checkCrossBlockSelection(range) {
    if (!this.focusedFieldName) return;
    const anchorBlock = this._closestBlockElement(range.startContainer);
    const focusBlock = this._closestBlockElement(range.endContainer);
    if (!anchorBlock || !focusBlock) return;
    const anchorUid = anchorBlock.getAttribute('data-block-uid');
    const focusUid = focusBlock.getAttribute('data-block-uid');
    if (!anchorUid || !focusUid || anchorUid === focusUid) return;

    // Collect all blocks intersecting the range, preserve DOM order
    const uids = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('[data-block-uid]')) {
      if (!range.intersectsNode(el)) continue;
      const uid = el.getAttribute('data-block-uid');
      if (!uid || seen.has(uid)) continue;
      // Skip containers: only include blocks whose entire UID doesn't contain another selected block
      // (keeps the selection at the leaf level the user dragged across)
      seen.add(uid);
      uids.push(uid);
    }
    if (uids.length < 2) return;

    // Prune containers: remove any block that is an ancestor of another selected block
    const pruned = uids.filter((uid) => {
      const el = this.queryBlockElement(uid);
      if (!el) return false;
      return !uids.some((other) => {
        if (other === uid) return false;
        const otherEl = this.queryBlockElement(other);
        return otherEl && el !== otherEl && el.contains(otherEl);
      });
    });
    if (pruned.length < 2) return;

    if (this._sameUids(pruned, this.multiSelectedBlockUids)) return;
    this.multiSelectedBlockUids = pruned;
    this.selectedBlockUid = pruned[pruned.length - 1];
    this._sendMultiBlockSelected();
  }

  _closestBlockElement(node) {
    let current = node;
    while (current) {
      if (current.nodeType === Node.ELEMENT_NODE && current.hasAttribute?.('data-block-uid')) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  /**
   * Handle arrow key press when cursor is at the edge of an editable field.
   * Navigates between fields within a block, or to adjacent blocks.
   *
   * @param {string} key - The arrow key ('ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown')
   * @param {string} blockUid - The current block UID
   * @param {HTMLElement} editableField - The currently focused editable field
   * @param {HTMLElement} blockElement - The block element
   */
  /**
   * Handle keys in block mode (no contenteditable field focused).
   * Called from the document keyboard blocker for body-focused and
   * block-focused keys. Returns true if the key was handled (caller
   * should not buffer it for text replay).
   *
   * Covers: Arrow navigation, Shift+Arrow multi-select, Delete/Backspace,
   * Cmd+A select-all escalation, Enter to add block.
   */
  _handleBlockModeKey(e) {
    // Arrow keys: navigate between sibling blocks or extend multi-selection
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const blockEl = this.queryBlockElement(this.selectedBlockUid);
      const nav = this.getArrowNavigationTarget(e.key, this.selectedBlockUid, blockEl);
      if (!nav) return false; // at boundary or wrong direction for layout
      const { adjacentId, adjacentEl } = nav;

      e.preventDefault();

      if (e.shiftKey) {
        // Shift+Arrow: extend/shrink multi-selection
        if (this.multiSelectedBlockUids.length === 0) {
          this.multiSelectedBlockUids = [this.selectedBlockUid, adjacentId];
        } else if (this.multiSelectedBlockUids.includes(adjacentId)) {
          this.multiSelectedBlockUids = this.multiSelectedBlockUids.filter(
            uid => uid !== this.selectedBlockUid,
          );
        } else {
          this.multiSelectedBlockUids.push(adjacentId);
        }
        this.selectedBlockUid = adjacentId;
        if (this.multiSelectedBlockUids.length <= 1) {
          const singleUid = this.multiSelectedBlockUids[0] || adjacentId;
          this.multiSelectedBlockUids = [];
          this.selectedBlockUid = singleUid;
          this.focusedFieldName = null;
          window.getSelection()?.removeAllRanges();
          const el = this.queryBlockElement(singleUid);
          if (el) this.sendBlockSelected('shiftArrowSingle', el, { focusedFieldName: null });
        } else {
          this._sendMultiBlockSelected();
        }
      } else {
        // Plain arrow: navigate to adjacent block, stay in block mode
        // editMode is already 'block', selectBlock reads it
        this.multiSelectedBlockUids = [];
        this._navigatingToBlock = true;
        this.selectBlock(adjacentEl);
        this._navigatingToBlock = false;
      }
      return true;
    }

    // Delete/Backspace: delete selected block(s) — locked blocks are spared
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (this.multiSelectedBlockUids.length > 0) {
        const deletable = this._filterMutableBlockUids(
          this.multiSelectedBlockUids, 'delete',
        );
        log('Block mode Delete: deleting', deletable.length, '/', this.multiSelectedBlockUids.length, 'blocks');
        if (deletable.length > 0) {
          this.sendMessageToParent({ type: 'DELETE_BLOCKS', uids: deletable });
        }
        this.multiSelectedBlockUids = [];
        this.selectedBlockUid = null;
      } else if (
        this.selectedBlockUid
        && this._filterMutableBlockUids([this.selectedBlockUid], 'delete').length > 0
      ) {
        log('Block mode Delete: deleting single block', this.selectedBlockUid);
        this.sendMessageToParent({ type: 'DELETE_BLOCK', uid: this.selectedBlockUid });
      }
      return true;
    }

    // Cmd+A: escalate selection up the parent chain
    // Press 1 (in block mode, no multi): select siblings of current block
    // Press 2+: replace with siblings of the current selection's parent (walk up)
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      let anchorUid;
      if (this.multiSelectedBlockUids.length > 0) {
        // Already multi-selected: escalate by walking up from any selected block's parent
        anchorUid = this.multiSelectedBlockUids[0];
      } else {
        anchorUid = this.selectedBlockUid;
      }
      const anchorInfo = this.blockPathMap?.[anchorUid];
      if (!anchorInfo) return true;
      // Current "container" of the selection is anchor's parentId.
      // For escalation, select siblings at that level; next press walks up.
      let containerId = anchorInfo.parentId || null;
      if (this.multiSelectedBlockUids.length > 0) {
        // Escalate: move up one level — select siblings of the container itself
        const containerInfo = this.blockPathMap?.[containerId];
        if (!containerInfo) return true; // already at root (page-level)
        containerId = containerInfo.parentId || null;
        anchorUid = anchorInfo.parentId;
      }
      const siblings = this._getSiblingsByDomOrder(anchorUid, containerId);
      if (siblings.length > 0 && !this._sameUids(siblings, this.multiSelectedBlockUids)) {
        this.multiSelectedBlockUids = siblings;
        this._sendMultiBlockSelected();
      }
      return true;
    }

    // Cmd+C / Cmd+X: copy/cut blocks (uses Volto's blocksClipboard)
    if ((e.key === 'c' || e.key === 'x') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const uids = this.multiSelectedBlockUids.length > 0
        ? [...this.multiSelectedBlockUids]
        : [this.selectedBlockUid];
      const action = e.key === 'c' ? 'copy' : 'cut';
      log('Block mode', action, uids.length, 'blocks');
      // Cut drops locked blocks entirely: you can't "move" what can't move.
      // Copy is non-destructive so locked blocks are fine.
      const transferUids = action === 'cut'
        ? this._filterMutableBlockUids(uids, 'delete')
        : uids;
      if (transferUids.length > 0) {
        this.sendMessageToParent({ type: 'COPY_BLOCKS', uids: transferUids, action });
      }
      if (action === 'cut' && transferUids.length > 0) {
        this.sendMessageToParent({ type: 'DELETE_BLOCKS', uids: transferUids });
        this.multiSelectedBlockUids = [];
        this.selectedBlockUid = null;
      }
      return true;
    }

    // Cmd+V: paste blocks from clipboard (admin handles actual insertion)
    if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const afterUid = this.multiSelectedBlockUids.length > 0
        ? this.multiSelectedBlockUids[this.multiSelectedBlockUids.length - 1]
        : this.selectedBlockUid;
      log('Block mode paste after:', afterUid);
      this.sendMessageToParent({ type: 'PASTE_BLOCKS', afterBlockId: afterUid });
      return true;
    }

    // Enter: add block after. We reach _handleBlockModeKey only when no
    // editable field is active (line 4104 returns early otherwise), so
    // we're in block mode by definition — gating on `isInlineEditing`
    // here just blocks Enter when the user has selected a container as
    // a whole (e.g. via Escape-to-parent) and wants to insert after it.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessageToParent({
        type: 'ADD_BLOCK_AFTER',
        blockId: this.selectedBlockUid,
      });
      return true;
    }

    return false;
  }

  /**
   * Single source of truth for arrow-key → adjacent block navigation.
   * Maps the arrow key to a direction based on layout mode (vertical,
   * horizontal, table), then resolves the navigation target via blockPathMap.
   *
   * @returns {{ adjacentId, adjacentEl, direction, isTableVertical }} or null
   */
  getArrowNavigationTarget(key, blockUid, blockElement) {
    const pathInfo = this.blockPathMap?.[blockUid];
    if (!pathInfo) return null;

    let addDirection = blockElement?.getAttribute('data-block-add');
    if (!addDirection && blockElement) {
      let depth = 0;
      let parent = blockElement.parentElement;
      while (parent) {
        if (parent.hasAttribute('data-block-uid')) depth++;
        parent = parent.parentElement;
      }
      addDirection = depth % 2 === 0 ? 'bottom' : 'right';
    }
    const isTableMode = pathInfo.parentAddMode === 'table';

    const isForwardKey = (key === 'ArrowDown' || key === 'ArrowRight');
    const isVerticalKey = (key === 'ArrowUp' || key === 'ArrowDown');
    const isHorizontalKey = (key === 'ArrowLeft' || key === 'ArrowRight');

    let shouldNavigate = false;
    let isTableVertical = false;

    if (isTableMode) {
      if (isHorizontalKey) shouldNavigate = true;
      else if (isVerticalKey) { shouldNavigate = true; isTableVertical = true; }
    } else if (addDirection === 'bottom' && isVerticalKey) {
      shouldNavigate = true;
    } else if (addDirection === 'right' && isHorizontalKey) {
      shouldNavigate = true;
    }

    if (!shouldNavigate) return null;

    const direction = isForwardKey ? 'forward' : 'backward';
    const adjacentId = this._resolveNavigationTarget(blockUid, direction, isTableVertical);
    if (!adjacentId) return null;
    const adjacentEl = this.queryBlockElement(adjacentId);
    if (!adjacentEl) return null;

    return { adjacentId, adjacentEl, direction, isTableVertical };
  }

  handleArrowAtEdge(key, blockUid, editableField, blockElement) {
    const nav = this.getArrowNavigationTarget(key, blockUid, blockElement);
    if (!nav) return;
    const { adjacentId, adjacentEl, direction, isTableVertical } = nav;

    // Check multi-field: navigate between fields within the block first
    const ownFields = this.getOwnEditableFields(blockElement);
    if (ownFields.length > 1 && !isTableVertical) {
      const fieldIdx = ownFields.indexOf(editableField);
      if (fieldIdx !== -1) {
        if (direction === 'forward' && fieldIdx < ownFields.length - 1) {
          // Move to next field in same block
          const nextField = ownFields[fieldIdx + 1];
          nextField.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(nextField);
          range.collapse(true); // Cursor at start
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        if (direction === 'backward' && fieldIdx > 0) {
          // Move to previous field in same block
          const prevField = ownFields[fieldIdx - 1];
          prevField.focus();
          this._placeCursorAtEnd(prevField);
          return;
        }
      }
    }

    log('handleArrowAtEdge: navigating from', blockUid, 'to', adjacentId, 'direction:', direction);

    // editMode stays 'text' — selectBlock will set up contenteditable
    this._navigatingToBlock = true;
    this.selectBlock(adjacentEl, {
      fieldToFocus: direction === 'backward' ? 'last' : 'first',
      cursorAt: direction === 'backward' ? 'end' : 'start',
    });
    this._navigatingToBlock = false;
  }

  /**
   * Resolve the navigation target from a block in a given direction.
   * Handles template instance boundaries:
   * - When leaving a template instance (no sibling), skips the virtual parent
   *   and finds the adjacent sibling of the template instance.
   * - When entering a template instance (adjacent is virtual), drills into
   *   its first/last child depending on direction.
   *
   * @param {string} blockId - Current block ID
   * @param {string} direction - 'forward' or 'backward'
   * @param {boolean} isTableVertical - Whether navigating vertically in a table
   * @returns {string|null} Target block ID with a DOM element, or null
   */
  _resolveNavigationTarget(blockId, direction, isTableVertical = false) {
    let currentId = blockId;
    const visited = new Set();

    while (!visited.has(currentId)) {
      visited.add(currentId);

      let adjacentId = this.getAdjacentBlockId(currentId, direction, isTableVertical);

      if (!adjacentId) {
        // At boundary of container — try to navigate up
        const currentInfo = this.blockPathMap?.[currentId];
        if (!currentInfo?.parentId) return null;

        const parentInfo = this.blockPathMap?.[currentInfo.parentId];
        if (parentInfo?.isTemplateInstance) {
          // Parent is a virtual template instance — skip it and find ITS adjacent sibling
          currentId = currentInfo.parentId;
          continue;
        }
        // Regular container boundary — navigate to parent block
        adjacentId = currentInfo.parentId;
      }

      // If adjacent is a virtual template instance, drill into it
      const adjacentInfo = this.blockPathMap?.[adjacentId];
      if (adjacentInfo?.isTemplateInstance) {
        const children = this._getSiblingsByDomOrder(null, adjacentId);
        if (children.length === 0) return null;
        adjacentId = direction === 'forward' ? children[0] : children[children.length - 1];
      }

      // Verify the target has a DOM element
      if (this.queryBlockElement(adjacentId)) {
        return adjacentId;
      }
      return null;
    }
    return null;
  }

  /**
   * Place cursor at the end of the last text node in an element.
   * @param {HTMLElement} element - The element to place cursor in
   */
  _placeCursorAtEnd(element) {
    const sel = window.getSelection();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let lastText = walker.firstChild();
    while (walker.nextNode()) lastText = walker.currentNode;
    if (lastText) {
      const range = document.createRange();
      range.setStart(lastText, lastText.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // No text nodes — place at end of element
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  /**
   * Move cursor with an arrow key and detect if at edge of field.
   * Shared by keydown handler and buffer replay.
   *
   * @param {string} key - Arrow key name (ArrowLeft, ArrowRight, ArrowUp, ArrowDown)
   * @param {HTMLElement} editableField - The editable field element
   * @param {boolean} shiftKey - Whether shift is held (extend selection)
   */
  /**
   * Replay a single non-text key action (arrow, delete, home, end, etc.)
   * on the given editable field. Handles ZWS/BOM nodes that interfere with
   * cursor movement. Used by buffer replay and testable independently.
   * @returns {boolean} true if handled
   */
  /**
   * Handle structural/special key actions that need preventDefault.
   * Shared by both live (_handleFieldKeydown) and replay (replayOneKey).
   * Returns true if the key was fully handled (caller should preventDefault).
   * Returns false if the key is a content key (text char, normal delete, space
   * without markdown) — caller decides: live lets native handle, replay uses
   * _insertTextAtCursor / execCommand.
   */
  handleSpecialKey(blockId, evt, editableField) {
    const { key, shiftKey = false, ctrlKey = false, metaKey = false } = evt;
    const hasMod = ctrlKey || metaKey;

    // Clear prospective inline on navigation keys
    const navigationKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Tab', 'Home', 'End', 'PageUp', 'PageDown'];
    if ((navigationKeys.includes(key) || hasMod || evt.altKey) && this.prospectiveInlineElement) {
      this.prospectiveInlineElement = null;
    }

    // Slash menu navigation
    if (this._slashMenuActive) {
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        this.sendMessageToParent({ type: 'SLASH_MENU', action: key === 'ArrowUp' ? 'up' : 'down', blockId });
        return true;
      }
      if (key === 'Enter' && !shiftKey) {
        this.sendMessageToParent({ type: 'SLASH_MENU', action: 'select', blockId });
        return true;
      }
      if (key === 'Escape') {
        this._slashMenuActive = false;
        this.sendMessageToParent({ type: 'SLASH_MENU', action: 'hide', blockId });
        return true;
      }
    }

    // Paste: replay has clipboard data stored at buffer time (evt.html).
    // Live Ctrl+V reads clipboard now (user gesture is active).
    if (evt._type === 'paste') {
      if (evt.html) this._doPaste(blockId, evt.html);
      return true;
    }
    if (hasMod && key?.toLowerCase() === 'v') {
      // Read clipboard async (user gesture active for live keys)
      navigator.clipboard.read().then(async (items) => {
        for (const item of items) {
          if (item.types.includes('text/html')) {
            this._doPaste(blockId, await (await item.getType('text/html')).text());
            return;
          }
          if (item.types.includes('text/plain')) {
            this._doPaste(blockId, await (await item.getType('text/plain')).text());
            return;
          }
        }
      }).catch(() => {
        navigator.clipboard.readText().then(text => {
          if (text) this._doPaste(blockId, text);
        }).catch(() => {});
      });
      return true;
    }

    // Save, Undo, Redo
    if (hasMod && key === 's' && !shiftKey) {
      this.sendMessageToParent({ type: 'SAVE_REQUEST' });
      return true;
    }
    if (hasMod && key === 'z' && !shiftKey) {
      this.flushPendingTextUpdates();
      this.sendMessageToParent({ type: 'SLATE_UNDO_REQUEST', blockId });
      return true;
    }
    if (hasMod && ((key === 'z' && shiftKey) || key === 'y')) {
      this.flushPendingTextUpdates();
      this.sendMessageToParent({ type: 'SLATE_REDO_REQUEST', blockId });
      return true;
    }

    // Format hotkeys (Ctrl+B, Ctrl+I, etc.)
    if (hasMod && this.slateConfig?.hotkeys) {
      for (const [shortcut, config] of Object.entries(this.slateConfig.hotkeys)) {
        const parts = shortcut.toLowerCase().split('+');
        const hasmod = parts.includes('mod');
        const hasShift = parts.includes('shift');
        const hasAlt = parts.includes('alt');
        const hotkey = parts[parts.length - 1];
        if ((hasmod ? hasMod : true) &&
            (hasShift ? shiftKey : !shiftKey) &&
            (hasAlt ? evt.altKey : !evt.altKey) &&
            key?.toLowerCase() === hotkey && config.type === 'inline') {
          if (!this.isSlateField(blockId, this.focusedFieldName)) return true;
          // Swallow rather than fall through: letting Ctrl+B reach the browser
          // would apply ITS bold to the contenteditable, which is the format we
          // were asked to withhold.
          if (!this.slateStylePermits(blockId, config.format)) return true;
          this.sendTransformRequest(blockId, 'format', { format: config.format });
          return true;
        }
      }
    }

    // Cmd+A, Cmd+C, Cmd+X
    if (hasMod && key?.toLowerCase() === 'a') {
      const sel = window.getSelection();
      if (sel && editableField) {
        const walker = document.createTreeWalker(editableField, NodeFilter.SHOW_TEXT);
        const firstText = walker.firstChild();
        let lastText = firstText;
        while (walker.nextNode()) lastText = walker.currentNode;
        if (firstText && lastText) {
          const range = document.createRange();
          range.setStart(firstText, 0);
          range.setEnd(lastText, lastText.length);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      return true;
    }
    if (hasMod && key?.toLowerCase() === 'c') {
      // Option A: cross-block multi-selection copies whole blocks, not text
      if (this.multiSelectedBlockUids.length > 1) {
        this.sendMessageToParent({
          type: 'COPY_BLOCKS',
          uids: [...this.multiSelectedBlockUids],
          action: 'copy',
        });
        return true;
      }
      document.execCommand('copy');
      return true;
    }
    if (hasMod && key?.toLowerCase() === 'x') {
      if (this.multiSelectedBlockUids.length > 1) {
        const transferUids = this._filterMutableBlockUids(
          [...this.multiSelectedBlockUids], 'delete',
        );
        if (transferUids.length > 0) {
          this.sendMessageToParent({ type: 'COPY_BLOCKS', uids: transferUids, action: 'cut' });
          this.sendMessageToParent({ type: 'DELETE_BLOCKS', uids: transferUids });
        }
        this.multiSelectedBlockUids = [];
        return true;
      }
      this._doCut(blockId);
      return true;
    }

    // Space: markdown shortcut only (text insertion is NOT special)
    if (key === ' ' && !hasMod) {
      if (this.handleSpaceKey(blockId)) return true;
      return false; // let caller handle as text
    }

    // Delete/Backspace: boundary cases only (normal delete is NOT special)
    if (key === 'Backspace') {
      if (this.handleDeleteKey(blockId, 'Backspace')) return true;
      return false; // let caller handle as native delete
    }
    if (key === 'Delete') {
      this._skipZwsNode('forward');
      if (this.handleDeleteKey(blockId, 'Delete')) return true;
      return false; // let caller handle as native delete
    }

    // Arrow keys
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
      if (!hasMod && !evt.altKey) {
        this.moveArrowKey(key, editableField, shiftKey);
      }
      return true;
    }

    // Home/End
    if (key === 'Home' || key === 'End') {
      if (!hasMod && !evt.altKey) {
        const sel = window.getSelection();
        if (sel) {
          const dir = key === 'Home' ? 'backward' : 'forward';
          sel.modify(shiftKey ? 'extend' : 'move', dir, 'lineboundary');
          this._skipZwsNode(dir === 'backward' ? 'forward' : 'backward');
        }
      }
      return true;
    }

    // Tab
    if (key === 'Tab' && !hasMod) {
      const isPreElement = editableField?.tagName === 'PRE' || !!editableField?.closest('pre');
      if (isPreElement) {
        const sel = window.getSelection();
        if (sel?.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const spaces = document.createTextNode('  ');
          range.insertNode(spaces);
          range.setStartAfter(spaces);
          range.setEndAfter(spaces);
          sel.removeAllRanges();
          sel.addRange(range);
          editableField.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      }
      if (this.isSlateField(blockId, this.focusedFieldName)) {
        const selection = window.getSelection();
        if (selection?.rangeCount) {
          const tabNode = selection.getRangeAt(0).startContainer;
          const tabEl = this._toElement(tabNode);
          if (tabEl?.closest('li')) {
            this.sendTransformRequest(blockId, shiftKey ? 'outdent' : 'indent', {});
            return true;
          }
        }
      }
      // Focus navigation via tabbable
      {
        const ordered = tabbable(document.documentElement);
        const currentIdx = ordered.indexOf(editableField || document.activeElement);
        if (currentIdx !== -1 && ordered.length > 1) {
          const nextIdx = shiftKey
            ? (currentIdx - 1 + ordered.length) % ordered.length
            : (currentIdx + 1) % ordered.length;
          ordered[nextIdx].focus();
        }
      }
      return true;
    }

    // Enter
    if (key === 'Enter' && !shiftKey) {
      const isPreElement = editableField?.tagName === 'PRE' || !!editableField?.closest('pre');
      if (isPreElement) {
        const sel = window.getSelection();
        if (sel?.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const textNode = document.createTextNode('\n');
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          sel.removeAllRanges();
          sel.addRange(range);
          editableField.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      }
      // Plain string fields: navigate to next field or add block.
      // Textarea and unknown types: let native handle (inserts newline).
      // Slate fields: multi-field check then split via transform.
      const fieldType = this.getFieldType(blockId, this.focusedFieldName);
      if (!this.isSlateField(blockId, this.focusedFieldName) &&
          !this.fieldTypeIsPlainString(fieldType)) {
        // Textarea or unknown — let native insert newline
        return false;
      }
      if (this.fieldTypeIsPlainString(fieldType)) {
        const blockEl = editableField?.closest('[data-block-uid]');
        if (!blockEl) return true;
        const ownFields = this.getOwnEditableFields(blockEl);
        const idx = editableField ? ownFields.indexOf(editableField) : -1;
        if (idx >= 0 && idx < ownFields.length - 1) {
          const nextField = ownFields[idx + 1];
          nextField.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(nextField);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          this.sendMessageToParent({ type: 'ADD_BLOCK_AFTER', blockId });
        }
        return true;
      }
      // Slate: multi-field then split
      const blockElement = editableField?.closest('[data-block-uid]');
      if (!blockElement) return true;
      const ownFields = this.getOwnEditableFields(blockElement);
      const currentIndex = editableField ? ownFields.indexOf(editableField) : -1;
      if (currentIndex >= 0 && currentIndex < ownFields.length - 1) {
        const nextField = ownFields[currentIndex + 1];
        nextField.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(nextField);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
      this.correctInvalidWhitespaceSelection();
      const selection = window.getSelection();
      if (!selection?.rangeCount) return true;
      const node = selection.getRangeAt(0).startContainer;
      const parentElement = this._toElement(node);
      if (parentElement?.closest('[data-node-id]')) {
        this.sendTransformRequest(blockId, 'enter', {});
      }
      return true;
    }

    return false; // Not a special key
  }

  /**
   * Replay a buffered key. Calls handleSpecialKey first, then handles
   * content keys (text insertion, normal delete) that can't go native.
   */
  replayOneKey(blockId, evt, editableField) {
    // Try special/structural handling first (shared with live _handleFieldKeydown)
    if (this.handleSpecialKey(blockId, evt, editableField)) return true;

    const { key, ctrlKey = false, metaKey = false } = evt;
    const hasMod = ctrlKey || metaKey;

    // Content keys: in replay, no native events — handle explicitly.
    // (For live keys, _handleFieldKeydown lets these go native instead.)

    // Text character (including space that wasn't a markdown shortcut)
    if (key?.length === 1 && !hasMod) {
      this.correctInvalidWhitespaceSelection();
      this.ensureValidInsertionTarget();
      this._insertTextAtCursor(key, editableField);
      return true;
    }

    // Backspace (not handled by handleSpecialKey = normal char delete)
    if (key === 'Backspace') {
      if (!this.preserveLastCharDelete()) {
        document.execCommand('delete', false);
      }
      return true;
    }

    // Delete (not handled by handleSpecialKey = normal char delete)
    if (key === 'Delete') {
      if (!this.preserveLastCharDelete()) {
        const sel = window.getSelection();
        if (sel?.isCollapsed && sel.focusNode?.nodeType === Node.TEXT_NODE) {
          const text = sel.focusNode.textContent || '';
          let offset = sel.focusOffset;
          while (offset < text.length &&
            (text[offset] === '\uFEFF' || text[offset] === '\u200B')) {
            offset++;
          }
          if (offset < text.length) {
            const range = document.createRange();
            range.setStart(sel.focusNode, offset);
            range.setEnd(sel.focusNode, offset + 1);
            range.deleteContents();
          }
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Check if a node contains only ZWS/BOM characters (no visible text).
   * Does NOT treat whitespace as invisible — spaces between words are real content.
   */
  _hasNoVisibleText(node) {
    if (!node) return true;
    return this.stripZeroWidthSpaces(node.textContent || '') === '';
  }

  /**
   * If the cursor is on a node with no visible text (ZWS/BOM-only text node
   * or empty Element on Firefox), move it to the nearest visible text node
   * in the given direction. Prevents keys from acting on invisible content.
   */
  _skipZwsNode(direction) {
    const sel = window.getSelection();
    if (!sel?.focusNode) return;

    const node = sel.focusNode;
    // Two cases where cursor needs to be moved:
    // 1. Text node with only ZWS/BOM — skip to real text
    // 2. Element node (Firefox can leave cursor on <p>, <span> instead of
    //    inside text nodes) — move into the nearest text node
    if (node.nodeType === Node.TEXT_NODE) {
      if (!this._hasNoVisibleText(node)) return; // real text, nothing to skip
    }
    // Element nodes always need repositioning into a text node

    // Walk from contenteditable root to find text across element boundaries
    const root = this._toElement(node)
      ?.closest?.('[contenteditable="true"]') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    const target = direction === 'forward' ? walker.nextNode() : walker.previousNode();
    if (target) {
      const range = document.createRange();
      range.setStart(target, direction === 'forward' ? 0 : target.textContent.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  moveArrowKey(key, editableField, shiftKey = false) {
    const navActions = {
      ArrowLeft: ['backward', 'character'],
      ArrowRight: ['forward', 'character'],
      ArrowUp: ['backward', 'line'],
      ArrowDown: ['forward', 'line'],
    };
    if (!navActions[key]) return;

    const sel = window.getSelection();
    if (!sel) return;

    if (shiftKey) {
      sel.modify('extend', navActions[key][0], navActions[key][1]);
      return;
    }

    if (!sel.isCollapsed || this._slashMenuActive || this.blockedBlockId) {
      sel.modify('move', navActions[key][0], navActions[key][1]);
      return;
    }

    const beforeNode = sel.focusNode;
    const beforeOffset = sel.focusOffset;
    // Skip out of ZWS-only nodes before moving — otherwise the move
    // crosses the invisible node boundary instead of a visible character.
    this._skipZwsNode(navActions[key][0]);

    sel.modify('move', navActions[key][0], navActions[key][1]);

    if (sel.focusNode === beforeNode && sel.focusOffset === beforeOffset) {
      const blockEl = editableField.closest('[data-block-uid]');
      if (blockEl) {
        const uid = blockEl.getAttribute('data-block-uid');
        this.handleArrowAtEdge(key, uid, editableField, blockEl);
      }
    }
  }

  /**
   * Handles Backspace/Delete special cases: unwrap, delete block, delete across
   * formatted nodes. Shared between the live keydown handler and buffer replay.
   *
   * @param {string} blockUid - The block UID
   * @param {string} key - 'Backspace' or 'Delete'
   * @returns {boolean} true if handled (caller should preventDefault / skip native action)
   */
  /**
   * Insert text at the current cursor position using Range API.
   * Handles NBSP conversion for spaces, ZWS cleanup, and triggers
   * handleTextChange. Used by replayOneKey for all text insertion.
   */
  _insertTextAtCursor(text, editableField) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);

    // NBSP for spaces to prevent CSS whitespace collapse in inline elements.
    // handleTextChange converts NBSP back to regular space in the model.
    const insertionText = text.replace(/^ /, '\u00A0').replace(/ $/, '\u00A0');

    if (!range.collapsed) range.deleteContents();

    const textNode = document.createTextNode(insertionText);
    range.insertNode(textNode);

    // Clean up adjacent ZWS/BOM nodes (left by restoreSlateSelection)
    const parent = textNode.parentNode;
    if (parent) {
      for (const sibling of [...parent.childNodes]) {
        if (sibling !== textNode && sibling.nodeType === Node.TEXT_NODE &&
            sibling.textContent.replace(/[\uFEFF\u200B]/g, '') === '') {
          sibling.remove();
        }
      }
    }

    // Position cursor after inserted text
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    this.prospectiveInlineElement = null;

    // Trigger handleTextChange — insertNode creates childList mutation
    // but MutationObserver only watches characterData
    if (editableField) {
      const editField = editableField.closest?.('[data-edit-text]') || editableField;
      if (this.isInlineEditing) {
        this.handleTextChange(editField, textNode.parentElement, textNode);
      }
    }
  }

  /**
   * Get the nearest Element from a node (returns node itself if Element,
   * or parentElement if text node). Used for closest() lookups.
   */
  _toElement(node) {
    return node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  }

  handleDeleteKey(blockUid, key) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;

    // Backspace at start of a slate element → send to admin as a structural transform.
    // Two cases:
    // 1. Absolute start of field (textBefore === '') → unwrapBlock (merge/delete)
    // 2. Start of an interior node-id element → let Slate handle (demote list item, etc.)
    // In both cases the browser's native Backspace would corrupt the DOM structure.
    if (key === 'Backspace' && this.isSlateField(blockUid, this.focusedFieldName)) {
      const blockEl = this._toElement(node);
      const editField = blockEl?.closest('[data-edit-text]');
      if (editField) {
        // Check if the field is empty (only ZWS/BOM) — regardless of selection state.
        // After preserveLastCharDelete, the field may contain only ZWS and the
        // selection may be non-collapsed spanning multiple ZWS text nodes.
        if (this._hasNoVisibleText(editField) && range.collapsed === false) {
          // Empty field with non-collapsed selection — treat as empty block backspace
          const blockElement = editField.closest('[data-block-uid]');
          const firstField = blockElement ? this.getOwnFirstEditableField(blockElement) : null;
          const isFirstField = firstField === editField;

          log('Backspace in empty slate field (non-collapsed ZWS selection) - sending unwrapBlock, isFirstField:', isFirstField);
          this.sendTransformRequest(blockUid, 'unwrapBlock', {
            isFirstField,
            isEmpty: true,
          });
          return true;
        }

        if (range.collapsed) {
          // Check if cursor is at offset 0 of a data-node-id element
          const nodeIdEl = blockEl.closest('[data-node-id]');
          // nodeIdEl may equal editField when a single <p> has both data-edit-text
          // and data-node-id (e.g. simple mock frontends). Treat that the same as
          // having a separate nodeIdEl inside editField.
          const effectiveNodeIdEl = nodeIdEl || editField;
          if (effectiveNodeIdEl) {
            const elRange = document.createRange();
            elRange.setStart(effectiveNodeIdEl, 0);
            elRange.setEnd(range.startContainer, range.startOffset);
            const textBeforeInEl = this.stripZeroWidthSpaces(elRange.toString());

            if (textBeforeInEl === '') {
              // Check if there's content before this element (not the first node in the field)
              const textBeforeInField = this.getFieldTextAroundCursor(range, editField, 'before');

              if (textBeforeInField !== '') {
                // Interior element boundary — send as delete transform for Slate to handle
                log('Backspace at start of interior element - sending delete transform');
                this.sendTransformRequest(blockUid, 'delete', {
                  direction: 'backward',
                });
                return true;
              }

              // Absolute start of field — unwrapBlock
              const blockElement = editField.closest('[data-block-uid]');
              const firstField = blockElement ? this.getOwnFirstEditableField(blockElement) : null;
              const isFirstField = firstField === editField;
              const isEmpty = this._hasNoVisibleText(editField);

              log('Backspace at start of slate field - sending unwrapBlock, isFirstField:', isFirstField, 'isEmpty:', isEmpty);
              this.sendTransformRequest(blockUid, 'unwrapBlock', {
                isFirstField,
                isEmpty,
              });
              return true;
            }
          }
        }
      }
    }

    // Backspace in empty first simple text field → delete block
    if (key === 'Backspace' && !this.isSlateField(blockUid, this.focusedFieldName)) {
      const blockEl = this._toElement(node);
      const editField = blockEl.closest('[data-edit-text]');
      if (editField) {
        if (this._hasNoVisibleText(editField) || (editField.textContent || '').trim() === '') {
          const blockElement = editField.closest('[data-block-uid]');
          const firstField = blockElement ? this.getOwnFirstEditableField(blockElement) : null;
          if (firstField === editField) {
            log('Backspace in empty first simple text field - sending DELETE_BLOCK');
            this.sendMessageToParent({
              type: 'DELETE_BLOCK',
              uid: blockUid,
            });
            return true;
          }
        }
      }
    }

    // Selection spans element nodes (formatted content) → delete transform
    if (!range.collapsed) {
      const hasElementNodes = this.selectionContainsElementNodes(range);
      if (hasElementNodes) {
        log('Delete selection contains element nodes, sending transform');
        this.sendTransformRequest(blockUid, 'delete', {
          direction: key === 'Backspace' ? 'backward' : 'forward',
        });
        return true;
      }
    }

    // At node boundary with different formatting → delete transform
    const atStart = range.startOffset === 0;
    // Check if cursor is at the end of the entire field, not just the current
    // node. An empty wrapper element (e.g. <span></span> on Firefox) has
    // offset 0 = length 0, but there may be content after it in the field.
    const editFieldForEnd = this._toElement(node)?.closest('[data-edit-text]');
    let atEnd = false;
    if (editFieldForEnd && range.startOffset === (node.textContent?.length ?? node.length ?? 0)) {
      atEnd = this.getFieldTextAroundCursor(range, editFieldForEnd, 'after') === '';
    }

    if ((key === 'Backspace' && atStart) || (key === 'Delete' && atEnd)) {
      const parentElement = this._toElement(node);
      const hasNodeId = parentElement?.closest('[data-node-id]');

      if (hasNodeId) {
        this.sendTransformRequest(blockUid, 'delete', {
          direction: key === 'Backspace' ? 'backward' : 'forward',
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Check if there's real text content before or after the cursor in the field.
   * Used by handleDeleteKey to distinguish block boundaries from interior positions.
   * @param {Range} range - current selection range
   * @param {HTMLElement} editField - the [data-edit-text] field element
   * @param {'before'|'after'} direction - check text before or after cursor
   * @returns {string} stripped text content (empty = at boundary)
   */
  getFieldTextAroundCursor(range, editField, direction) {
    const fieldRange = document.createRange();
    if (direction === 'before') {
      fieldRange.setStart(editField, 0);
      fieldRange.setEnd(range.startContainer, range.startOffset);
    } else {
      fieldRange.setStart(range.endContainer, range.endOffset);
      fieldRange.setEnd(editField, editField.childNodes.length);
    }
    return this.stripZeroWidthSpaces(fieldRange.toString());
  }

  /**
   * Protect the last real character in a text node from deletion by replacing
   * it with ZWS. Keeps the text node alive so MutationObserver fires
   * characterData (not childList) and preserves inline formatting context.
   *
   * Called from both the beforeinput handler (native keyboard) and buffer
   * replay (execCommand doesn't fire beforeinput in headless browsers).
   *
   * @returns {boolean} true if handled (last char replaced with ZWS)
   */
  preserveLastCharDelete() {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return false;

    const textNode = sel.getRangeAt(0).startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return false;

    const realText = this.stripZeroWidthSpaces(textNode.textContent);
    if (realText.length !== 1) return false;

    textNode.textContent = '\uFEFF';
    const r = document.createRange();
    // Position AFTER ZWS (offset 1) — browsers normalize offset 0 of a
    // ZWS-only inline element to be OUTSIDE it, losing formatting context.
    r.setStart(textNode, 1);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }

  /**
   * Checks text before cursor for markdown shortcut patterns (Space triggers autoformat).
   * Handles both block-level (##, >, -, etc.) and inline (**bold**, __bold__, etc.) patterns.
   * Shared between the live keydown handler and buffer replay.
   *
   * @param {string} blockUid - The block UID
   * @returns {boolean} true if a markdown pattern was detected and transform sent
   */
  handleSpaceKey(blockUid) {
    if (!this.isSlateField(blockUid, this.focusedFieldName)) return false;

    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;

    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const blockEl = this._toElement(node);
    const editableField = blockEl.closest('[data-edit-text]');
    if (!editableField) return false;

    // Walk up to find the block-level element (p, h2, li, blockquote, etc.)
    const blockNode = blockEl.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, div[data-node-id]')
                      || editableField;

    // Get text from start of block node to cursor position
    const textRange = document.createRange();
    textRange.setStart(blockNode, 0);
    textRange.setEnd(range.startContainer, range.startOffset);
    // Strip ZWS/NBSP artifacts from contenteditable — they prevent exact pattern matches
    const textBeforeCursor = this.stripZeroWidthSpaces(textRange.toString());
    log('Markdown check - textBeforeCursor:', JSON.stringify(textBeforeCursor));

    // Block-level patterns: entire text must match (longer patterns first)
    // Skip when cursor is inside a list item — block-level shortcuts
    // should only convert paragraphs, not transform existing list items
    const isInsideListItem = blockNode.nodeName === 'LI' || !!blockEl.closest('li');
    if (!isInsideListItem) {
      const blockPatterns = [
        { markup: '###', type: 'h3' },
        { markup: '##', type: 'h2' },
        { markup: '>', type: 'blockquote' },
        { markup: '1.', type: 'ol' },
        { markup: '1)', type: 'ol' },
        { markup: '-', type: 'ul' },
        { markup: '+', type: 'ul' },
      ];

      for (const pattern of blockPatterns) {
        if (textBeforeCursor === pattern.markup) {
          // Not permitted here → not a shortcut at all: fall through so the
          // space just types, leaving the literal "> " the author wrote.
          if (!this.slateStylePermits(blockUid, pattern.type)) break;
          log('Markdown block shortcut detected:', pattern.markup, '→', pattern.type);
          this.sendTransformRequest(blockUid, 'markdown', {
            markdownType: 'block',
            blockType: pattern.type,
          });
          return true;
        }
      }

      // Check * separately for block-level (UL) — only when it's the full text
      // This avoids conflict with inline *text* pattern
      if (textBeforeCursor === '*' && this.slateStylePermits(blockUid, 'ul')) {
        log('Markdown block shortcut detected: * → ul');
        this.sendTransformRequest(blockUid, 'markdown', {
          markdownType: 'block',
          blockType: 'ul',
        });
        return true;
      }
    }

    // Inline patterns: **text**, __text__, ~~text~~, *text*, _text_
    // Longer delimiters checked first to avoid false matches
    const inlinePatterns = [
      { between: ['**', '**'], type: 'strong' },
      { between: ['__', '__'], type: 'strong' },
      { between: ['~~', '~~'], type: 'del' },
      { between: ['*', '*'], type: 'em' },
      { between: ['_', '_'], type: 'em' },
    ];

    for (const pattern of inlinePatterns) {
      const [open, close] = pattern.between;
      if (!textBeforeCursor.endsWith(close)) continue;
      // Find the opening delimiter before the closing one
      const searchText = textBeforeCursor.slice(0, -close.length);
      const openIdx = searchText.lastIndexOf(open);
      if (openIdx === -1) continue;
      const inner = searchText.slice(openIdx + open.length);
      if (inner.length === 0 || inner.trim() !== inner) continue;
      // Opening delimiter must be preceded by whitespace or be at start
      if (openIdx > 0 && !/\s/.test(searchText[openIdx - 1])) continue;
      if (!this.slateStylePermits(blockUid, pattern.type)) continue;
      log('Markdown inline shortcut detected:', open + '...' + close, '→', pattern.type);
      this.sendTransformRequest(blockUid, 'markdown', {
        markdownType: 'inline',
        inlineType: pattern.type,
      });
      return true;
    }

    return false;
  }

  /**
   * Gets all DOM elements for a block UID.
   * A block may render as multiple elements (e.g., listing block renders multiple cards).
   * For template instances (virtual containers), returns elements from all child blocks.
   *
   * @param {string} blockUid - The block UID to find elements for
   * @returns {Array} All elements for the block (array, not NodeList, for template instances)
   */
  /**
   * Bounding box of the elements that stand in for a block without being it —
   * a tab's label on its trigger. Null when the block has none, which is every
   * block that is drawn in one place.
   */
  getStandInRect(blockUid) {
    if (!blockUid || blockUid === PAGE_BLOCK_UID) return null;
    const all = this.getAllBlockElements(blockUid);
    const own = new Set(this.getAllBlockElements(blockUid, { includeStandIns: false }));
    const standIns = all.filter((el) => !own.has(el));
    if (!standIns.length) return null;
    const box = this.getBoundingBoxForElements(standIns);
    return box
      ? { top: box.top, left: box.left, width: box.width, height: box.height }
      : null;
  }

  getAllBlockElements(blockUid, options = {}) {
    // includeStandIns: false asks for only the elements that ARE the block.
    // Chrome (outline, toolbar) measures the block's box, and a stand-in sits
    // somewhere else entirely — a tab's label is up in the tab bar while its
    // panel is below, so the union of the two drew the outline around the whole
    // tab strip ("Outline box not around block").
    const includeStandIns = options.includeStandIns !== false;
    // Check if this is a template instance (virtual container)
    // Template instances don't have DOM elements - their children do
    const pathInfo = this.blockPathMap?.[blockUid];
    if (pathInfo?.isTemplateInstance) {
      const childBlockIds = Object.entries(this.blockPathMap)
        .filter(([, info]) => info.parentId === blockUid)
        .map(([id]) => id);
      log('getAllBlockElements: template instance', blockUid, 'childBlockIds:', childBlockIds);
      // Get elements for all child blocks and flatten
      const elements = childBlockIds.flatMap(id => [...document.querySelectorAll(`[data-block-uid="${id}"]`)]);
      log('getAllBlockElements: found', elements.length, 'elements for template instance');
      return elements;
    }
    // A block can also be drawn by an element that STANDS IN for it: a tab's
    // label lives on the button that reveals the tab, which carries
    // data-block-selector rather than the uid (the uid belongs on the content,
    // so the bridge can tell the block is off screen). Those elements hold real
    // fields of this block, so every caller asking where a block is drawn needs
    // them too — otherwise the label is collected nowhere and never becomes
    // editable.
    const own = [...document.querySelectorAll(`[data-block-uid="${blockUid}"]`)];
    for (const handle of document.querySelectorAll(
      `[data-block-selector~="${blockUid}"]`,
    )) {
      const advertised = Bridge.selectorTokens(handle);
      if (!includeStandIns) continue;
      // Naming ONE block is what makes a handle a stand-in for it — but a
      // handle may name that block twice, plainly and by field
      // (`tab-py tab-py#code`), which is still one block. Counting tokens
      // instead of the blocks they name dropped the tab's own label.
      if (!Bridge.soleUidNamedBy(advertised) || own.includes(handle)) continue;
      // Advertising a uid makes something a TRIGGER, not part of the block: a
      // carousel dot names the slide it scrolls to and holds none of its
      // content. Only an element that carries the block's own editable content
      // stands in for it — a tab button holding its label. Counting every
      // trigger as an element of the block broke plain selection and +1/-1
      // navigation, which resolve through this.
      const carriesContent =
        handle.hasAttribute('data-edit-text') ||
        handle.hasAttribute('data-edit-media') ||
        !!handle.querySelector('[data-edit-text], [data-edit-media]');
      if (carriesContent) own.push(handle);
    }
    const elements = own;
    if (elements.length === 0) {
      log('getAllBlockElements: no DOM elements for', blockUid, 'pathInfo:', pathInfo ? 'exists' : 'missing', 'isTemplateInstance:', pathInfo?.isTemplateInstance);
    }
    return elements;
  }

  /**
   * Computes a bounding box that encompasses all given elements.
   * Used for multi-element blocks where one block renders as multiple DOM elements.
   *
   * @param {NodeList|Array} elements - Elements to compute bounding box for
   * @returns {Object|null} Bounding box with {top, left, width, height, right, bottom} or null if no elements
   */
  getBoundingBoxForElements(elements) {
    if (!elements || elements.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      // Skip zero-size elements (might be hidden or not rendered yet)
      if (rect.width === 0 && rect.height === 0) continue;
      minX = Math.min(minX, rect.left);
      minY = Math.min(minY, rect.top);
      maxX = Math.max(maxX, rect.right);
      maxY = Math.max(maxY, rect.bottom);
    }

    // If all elements were zero-size, return null
    if (minX === Infinity) return null;

    return {
      top: minY,
      left: minX,
      width: maxX - minX,
      height: maxY - minY,
      right: maxX,
      bottom: maxY,
    };
  }

  /**
   * Centralized method to send BLOCK_SELECTED message to Admin UI.
   * Ensures all required fields are always present.
   *
   * @param {string} src - Source identifier for debugging (e.g., 'selectBlock', 'resizeObserver')
   * @param {HTMLElement|null} blockElement - The block element (null for deselection)
   * @param {Object} options - Optional overrides
   * @param {string} [options.focusedFieldName] - Override focused field name
   * @param {Object} [options.selection] - Serialized selection to include
   */
  /**
   * Progressive step-up state machine (the "Escape" gesture).
   *
   * Walks ONE step up from the current selection state:
   *   1. Multi-select       → single anchor block
   *   2. Nothing selected   → confirm-deselect (no-op signal to admin)
   *   3. Text mode          → block mode of the same block
   *   4. Block mode (nested) → parent block
   *   5. Block mode (root)  → deselect (page mode)
   *
   * Triggered by:
   *   - Escape key (admin-side handler when iframe doesn't have focus,
   *     and iframe-side handler when it does)
   *   - STEP_UP postMessage from the admin (e.g., the ⬆ button in Quanta
   *     on mobile — touch devices have no Escape key)
   *
   * Returns true if the gesture was consumed (so the caller can
   * preventDefault on the event); false otherwise.
   */
  stepUpSelection(opts = {}) {
    // 1. Multi-select → single block (anchor)
    if (this.multiSelectedBlockUids.length > 0) {
      const anchorUid = this.multiSelectedBlockUids[0];
      this.multiSelectedBlockUids = [];
      this.selectedBlockUid = anchorUid;
      const anchorEl = this.queryBlockElement(anchorUid);
      if (anchorEl) {
        this.sendBlockSelected(opts.source || 'stepUpMultiSelect', anchorEl, {
          focusedFieldName: null,
        });
      }
      return true;
    }

    // 2. No block selected: confirm deselect to admin
    if (!this.selectedBlockUid) {
      this.sendBlockSelected(opts.source || 'stepUp', null);
      return true;
    }

    // 3. Text mode → Block mode (when an inline edit field is active)
    const activeEditField = document.activeElement?.closest?.(
      '[data-edit-text][contenteditable="true"]',
    );
    // Also accept this.editMode === 'text' so a STEP_UP message that
    // arrives AFTER focus has shifted off the inline editor (which is
    // what happens when the user taps the admin-side ⬆ button) still
    // recognises text mode.
    if (activeEditField || this.editMode === 'text') {
      log('stepUp: text → block mode for', this.selectedBlockUid);
      this.editMode = 'block';
      const blockElement = this.queryBlockElement(this.selectedBlockUid);
      if (blockElement) {
        this.collectBlockFields(blockElement, 'data-edit-text', (el) => {
          if (el.getAttribute('contenteditable') === 'true') {
            el.setAttribute('contenteditable', 'false');
          }
        });
      }
      if (activeEditField) activeEditField.blur();
      this.focusedFieldName = null;
      if (blockElement) {
        this.sendBlockSelected(opts.source || 'stepUpToBlockMode', blockElement, {
          focusedFieldName: null,
        });
      }
      return true;
    }

    // 4 & 5. Block mode → Parent (or deselect)
    this.editMode = 'block';
    const pathInfo = this.blockPathMap?.[this.selectedBlockUid];
    const parentId = pathInfo?.parentId || null;
    log('stepUp: block → parent', parentId, 'from', this.selectedBlockUid);
    if (parentId && parentId !== PAGE_BLOCK_UID) {
      if (this.blockPathMap?.[parentId]?.isTemplateInstance) {
        this.selectBlock(parentId);
      } else {
        const parentElement = this.queryBlockElement(parentId);
        if (parentElement) this.selectBlock(parentElement);
      }
    } else {
      this.selectedBlockUid = null;
      this.editMode = 'text';
      this.sendBlockSelected(opts.source || 'stepUp', null);
    }
    return true;
  }

  sendBlockSelected(src, blockElement, options = {}) {
    // Suppress position-tracking updates during carousel/selector navigation
    // Allow initial selection sources (fieldFocusListener, selectionChangeListener, etc.) through
    // so the admin UI can show the sidebar and toolbar for the newly selected block
    if (this._blockSelectorNavigating) {
      const isPositionTrackingSource = src === 'transitionTracker' || src === 'transitionEnd' || src === 'scrollHandler';
      if (isPositionTrackingSource) {
        return;
      }
    }

    // Get blockUid from options or element attribute
    const blockUid = options.blockUid || blockElement?.getAttribute('data-block-uid') || PAGE_BLOCK_UID;

    // Deselection case - no element and no blockUid in options
    if (!blockElement && !options.blockUid) {
      this.sendMessageToParent({
        type: 'BLOCK_SELECTED',
        src,
        blockUid: null,
        rect: null,
      }, this.adminOrigin);
      return;
    }

    // Get all elements for this block (multi-element blocks, template instances)
    // For multi-selection, gather elements from ALL selected blocks for combined rect
    const multiBlockUids = options.isMultipleSelection ? (options.blockUids || []) : [];
    const allElements = multiBlockUids.length > 1
      ? multiBlockUids.flatMap(uid => [
          ...this.getAllBlockElements(uid, { includeStandIns: false }),
        ])
      : (blockUid !== PAGE_BLOCK_UID
          ? this.getAllBlockElements(blockUid, { includeStandIns: false })
          : []);

    // Use first element for field detection if no element was passed
    const elementForFields = blockElement || allElements[0] || null;

    // Compute rect from all elements (combined bounding box for multi-element)
    let rect;
    if (allElements.length > 0) {
      rect = this.getBoundingBoxForElements(allElements);
      // Fall back to single element rect if bounding box computation failed
      if (!rect && elementForFields) {
        const singleRect = elementForFields.getBoundingClientRect();
        rect = { top: singleRect.top, left: singleRect.left, width: singleRect.width, height: singleRect.height };
      }
    } else if (elementForFields) {
      // Page-level field or single element: use its rect directly
      const singleRect = elementForFields.getBoundingClientRect();
      rect = { top: singleRect.top, left: singleRect.left, width: singleRect.width, height: singleRect.height };
    }

    // For field operations, use elementForFields (first element if none passed)
    const editableFields = elementForFields ? this.getEditableFields(elementForFields) : {};
    const linkableFields = elementForFields ? this.getLinkableFields(elementForFields) : {};
    const mediaFields = elementForFields ? this.getMediaFields(elementForFields) : {};
    const addDirection = elementForFields ? this.getAddDirection(elementForFields) : 'bottom';
    // Text-mode invariant at the ONE boundary that reaches the admin:
    // focusedFieldName is the admin's text-mode signal (it surfaces the slate
    // format toolbar), so it may be non-null only in text mode. Force null in
    // block mode regardless of what the caller passes — a stale field, or one a
    // frontend focus/selectionchange set during a re-render, must never flip
    // block mode into text mode. Media/linkable fields pass through (they're
    // needed for image/link blocks in block mode too).
    const focusedFieldName = this.editMode === 'block'
      ? null
      : options.focusedFieldName !== undefined
        ? options.focusedFieldName
        : this.focusedFieldName;
    const focusedLinkableField = options.focusedLinkableField !== undefined
      ? options.focusedLinkableField
      : this.focusedLinkableField;
    const focusedMediaField = options.focusedMediaField !== undefined
      ? options.focusedMediaField
      : this.focusedMediaField;

    // Update iframe drag handle position using the same rect
    // This ensures alignment with Volto toolbar which uses this rect
    const dragHandle = document.querySelector('.volto-hydra-drag-button');
    if (dragHandle && blockUid && blockUid !== PAGE_BLOCK_UID) {
      const handlePos = calculateDragHandlePosition(
        rect,
        { top: 0, left: 0 },
        this.getStandInRect(blockUid),
      );
      dragHandle.style.left = `${handlePos.left}px`;
      dragHandle.style.top = `${handlePos.top}px`;
      dragHandle.style.display = 'block';
    }
    // Position edge handle on the selected container's bottom, if applicable.
    this._positionEdgeHandles();

    // Get focused field rect for text-mode underline positioning
    // Round to integers to avoid sub-pixel jitter causing unnecessary state updates
    let focusedFieldRect = null;
    if (focusedFieldName && elementForFields) {
      const focusedEl = elementForFields.querySelector(`[data-edit-text="${focusedFieldName}"]`)
        || (elementForFields.getAttribute('data-edit-text') === focusedFieldName ? elementForFields : null);
      if (focusedEl) {
        const fr = focusedEl.getBoundingClientRect();
        focusedFieldRect = {
          top: Math.round(fr.top),
          left: Math.round(fr.left),
          width: Math.round(fr.width),
          height: Math.round(fr.height),
        };
      }
    }

    const message = {
      type: 'BLOCK_SELECTED',
      src,
      blockUid,
      // Where the block IS (outline) stays tight to its own elements. A
      // stand-in — a tab's label on the button that reveals it — is somewhere
      // else, and the toolbar must not be placed on top of it: that is a field
      // the author clicks to edit. Sent separately so chrome can avoid it
      // without the outline swallowing the whole tab strip.
      standInRect: this.getStandInRect(blockUid),
      // Does this block's content live in a nested browsing context — a video,
      // a map, a PDF preview? The bridge is the only side that can see it, and
      // the admin needs it for the toolbar: fading is right for an ordinary
      // block (the toolbar sits over content the author is reading, and their
      // mouse keeps it alive), but an embed swallows the mouse. Fade there and
      // the controls vanish seconds into the interaction with nothing to bring
      // them back.
      hasEmbed: this.blockHasEmbed(blockUid),
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      editableFields,
      linkableFields,
      mediaFields,
      // Reveal (#296): which optional fields COULD be revealed, and whether they
      // currently are. Rides BLOCK_SELECTED exactly like mediaFields, so the
      // quanta toolbar can show/hide the toggle with no extra round-trip.
      revealableFields: this.revealableFields(blockUid),
      revealed: !!this._revealedBlocks?.has(blockUid),
      focusedFieldName,
      focusedFieldRect,
      focusedLinkableField,
      focusedMediaField,
      addDirection,
      // canResize tells admin which edge handles to render as visible chrome
      // (per docs/architecture.md). Iframe keeps invisible event-capture
      // divs at the same coords for mousedown.
      canResize: this._lastCanResize || null,
      // Chevron (mobile up/down) move targets, computed HERE from render geometry
      // (reusing _computeEdgePlan) rather than by a data-order walk in the admin.
      // The admin uses them for the chevrons' enabled state and, on press,
      // dispatches the target straight through the existing MOVE_BLOCKS path.
      moveUpTarget: blockUid && blockUid !== PAGE_BLOCK_UID ? this._computeChevronMove(blockUid, 'up') : null,
      moveDownTarget: blockUid && blockUid !== PAGE_BLOCK_UID ? this._computeChevronMove(blockUid, 'down') : null,
      isMultiElement: blockUid && blockUid !== PAGE_BLOCK_UID ? this.getAllBlockElements(blockUid).length > 1 : false,
    };

    // Include selection if provided
    if (options.selection !== undefined) {
      message.selection = options.selection;
    }

    // Multi-selection: include block UIDs and per-block rects
    if (options.isMultipleSelection) {
      message.isMultipleSelection = true;
      message.blockUids = options.blockUids;
      message.rects = options.rects;
    }

    // Selection mode: include updated rects for all checkbox blocks.
    // If caller provided explicit rects, use those; otherwise auto-include
    // current selection mode rects when active so admin keeps checkboxes.
    if (options.selectionModeRects) {
      message.selectionModeRects = options.selectionModeRects;
    } else if (this._selectionModeBlockUids) {
      const rects = {};
      for (const uid of this._selectionModeBlockUids) {
        const el = this.queryBlockElement(uid);
        if (el) {
          const r = el.getBoundingClientRect();
          rects[uid] = { top: r.top, left: r.left, width: r.width, height: r.height };
        }
      }
      message.selectionModeRects = rects;
    }

    log('sendBlockSelected:', src, 'blockUid:', blockUid, 'isMulti:', !!message.isMultipleSelection, 'rect:', !!rect);
    window.parent.postMessage(message, this.adminOrigin);
  }

  /**
   * Handle Shift/Ctrl/Meta click for multi-block selection.
   * Updates multiSelectedBlockUids and sends combined rect to admin.
   */
  _handleMultiSelectClick(blockUid, event) {
    if (event.shiftKey) {
      // Shift+Click: select range from anchor to clicked block
      // Find siblings at the same container level using DOM, not page-level layout
      const anchor = this.multiSelectedBlockUids.length > 0
        ? this.multiSelectedBlockUids[0]
        : this.selectedBlockUid;
      const anchorEl = anchor ? this.queryBlockElement(anchor) : null;
      const parentBlock = anchorEl?.parentElement?.closest('[data-block-uid]');
      const allBlocks = document.querySelectorAll('[data-block-uid]');
      const siblings = parentBlock
        ? Array.from(allBlocks).filter(el =>
            el.parentElement?.closest('[data-block-uid]') === parentBlock,
          )
        : Array.from(allBlocks).filter(el =>
            !el.parentElement?.closest('[data-block-uid]'),
          );
      const siblingUids = siblings.map(el => el.getAttribute('data-block-uid'));
      const anchorIdx = siblingUids.indexOf(anchor);
      const focusIdx = siblingUids.indexOf(blockUid);

      if (anchorIdx >= 0 && focusIdx >= 0) {
        const start = Math.min(anchorIdx, focusIdx);
        const end = Math.max(anchorIdx, focusIdx);
        this.multiSelectedBlockUids = siblingUids.slice(start, end + 1);
      } else {
        // Cross-container Shift+Click: fall through to toggle (Ctrl-like)
        const current = this.multiSelectedBlockUids.length > 0
          ? [...this.multiSelectedBlockUids]
          : this.selectedBlockUid ? [this.selectedBlockUid] : [];
        const idx = current.indexOf(blockUid);
        if (idx >= 0) {
          current.splice(idx, 1);
        } else {
          current.push(blockUid);
        }
        this.multiSelectedBlockUids = current;
      }
    } else {
      // Ctrl/Meta+Click: toggle block in/out of selection
      const current = this.multiSelectedBlockUids.length > 0
        ? [...this.multiSelectedBlockUids]
        : this.selectedBlockUid ? [this.selectedBlockUid] : [];

      const idx = current.indexOf(blockUid);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(blockUid);
      }
      this.multiSelectedBlockUids = current;
    }

    log('Multi-select:', this.multiSelectedBlockUids.length, 'blocks:', this.multiSelectedBlockUids);

    // Clear single selection — multi-selection takes over
    this.selectedBlockUid = null;
    this.isInlineEditing = false;

    this._sendMultiBlockSelected();
  }

  /**
   * Enter touch selection mode. Sends all sibling block rects to admin
   * so it can render checkbox overlays for toggling selection.
   * @param {string} blockUid - The long-pressed block (initially checked)
   */
  _enterSelectionMode(blockUid) {
    // Get ALL blocks in the document, not just siblings, so checkboxes
    // appear on every visible block regardless of container hierarchy.
    const blockElements = document.querySelectorAll('[data-block-uid]');
    const seen = new Set();
    const allVisibleUids = [];
    for (const el of blockElements) {
      const uid = el.getAttribute('data-block-uid');
      if (uid && !seen.has(uid)) {
        seen.add(uid);
        allVisibleUids.push(uid);
      }
    }

    const allBlockRects = {};
    for (const uid of allVisibleUids) {
      const el = this.queryBlockElement(uid);
      if (el) {
        const r = el.getBoundingClientRect();
        allBlockRects[uid] = { top: r.top, left: r.left, width: r.width, height: r.height };
      }
    }

    // Store UIDs so scroll handler can re-send updated rects
    this._selectionModeBlockUids = allVisibleUids;

    this.sendMessageToParent({
      type: 'ENTER_SELECTION_MODE',
      blockUid,
      allBlockRects,
    });
  }

  /**
   * Enter selection mode without toggling any block.
   * Used when admin (sidebar) initiates — admin already set multiSelected.
   * Iframe just needs to start showing checkboxes on all visible blocks.
   */
  _enterSelectionModeActivateOnly() {
    const blockElements = document.querySelectorAll('[data-block-uid]');
    const seen = new Set();
    const allVisibleUids = [];
    for (const el of blockElements) {
      const uid = el.getAttribute('data-block-uid');
      if (uid && !seen.has(uid)) {
        seen.add(uid);
        allVisibleUids.push(uid);
      }
    }
    const allBlockRects = {};
    for (const uid of allVisibleUids) {
      const el = this.queryBlockElement(uid);
      if (el) {
        const r = el.getBoundingClientRect();
        allBlockRects[uid] = { top: r.top, left: r.left, width: r.width, height: r.height };
      }
    }
    this._selectionModeBlockUids = allVisibleUids;
    // Send without blockUid so admin does not toggle
    this.sendMessageToParent({
      type: 'ENTER_SELECTION_MODE',
      allBlockRects,
    });
  }

  /**
   * Send BLOCK_SELECTED with all multi-selected block UIDs and their rects.
   * The admin uses these to render combined outline and determine common parent.
   */
  _sendMultiBlockSelected() {
    const rects = {};
    for (const uid of this.multiSelectedBlockUids) {
      const el = this.queryBlockElement(uid);
      if (el) {
        const r = el.getBoundingClientRect();
        rects[uid] = { top: r.top, left: r.left, width: r.width, height: r.height };
      }
    }

    // Use sendBlockSelected with the anchor block — it handles drag handle
    // positioning, combined rect computation, and the BLOCK_SELECTED message.
    const anchorUid = this.multiSelectedBlockUids[0];
    const anchorEl = this.queryBlockElement(anchorUid);
    if (!anchorEl) return;

    this.sendBlockSelected('multiSelect', anchorEl, {
      blockUid: anchorUid,
      blockUids: this.multiSelectedBlockUids,
      rects,
      isMultipleSelection: true,
      focusedFieldName: null,
    });
  }

  /**
   * Shows a developer warning overlay in the iframe.
   * Used to alert developers about configuration issues.
   *
   * @param {string} title - Warning title
   * @param {string} message - Detailed message with DOM info
   */
  showDeveloperWarning(title, message) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'hydra-dev-warning';
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      max-width: 500px;
      max-height: 80vh;
      background: #fef2f2;
      border: 2px solid #dc2626;
      border-radius: 8px;
      padding: 16px;
      z-index: 999999;
      font-family: ui-monospace, monospace;
      font-size: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      overflow: auto;
    `;

    overlay.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
        <strong style="color: #dc2626; font-size: 14px;">⚠️ ${title}</strong>
        <button id="hydra-warning-close" style="background: none; border: none; cursor: pointer; font-size: 18px; color: #666;">&times;</button>
      </div>
      <pre style="white-space: pre-wrap; word-break: break-word; margin: 0; color: #1f2937;">${message}</pre>
    `;

    document.body.appendChild(overlay);

    // Close button
    document.getElementById('hydra-warning-close')?.addEventListener('click', () => {
      overlay.remove();
    });

    // Auto-hide after 30 seconds
    setTimeout(() => overlay.remove(), 30000);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Bridge Class Initialization and Navigation Event Handling
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Initializes the bridge, setting up event listeners and communication channels.
   *
   * @typedef {import('@plone/registry').ConfigData} VoltoConfigData
   * @param {Object} options - Options for initialization.
   * @param {string[]} options.allowedBlocks - List of allowed blocks.
   * @param {VoltoConfigData} options.voltoConfig - Extra config to add to Volto in edit mode.
   */
  init(options = {}) {
    if (typeof window === 'undefined') {
      return; // Exit if not in a browser environment
    }

    // Register document-level keyboard handlers early so no keystrokes are lost
    // during block transitions (field destroyed → new field not ready yet).
    this._ensureDocumentKeyboardBlocker();

    if (window.self !== window.top) {
      // ... (iframe-specific setup: navigation detection, token retrieval, etc.)
      // This will set the listners for hashchange & pushstate
      function detectNavigation(callback) {
        let currentUrl = window.location.href;
        log('Setting up navigation detection, currentUrl:', currentUrl);

        function checkNavigation() {
          const newUrl = window.location.href;
          if (newUrl !== currentUrl) {
            log('Navigation detected:', currentUrl, '->', newUrl);
            callback(currentUrl);
            currentUrl = newUrl;
          }
        }

        // Handle hash changes & popstate events (only happens when browser back/forward buttons is clicked)
        window.addEventListener('hashchange', checkNavigation);
        window.addEventListener('popstate', checkNavigation);

        // Intercept pushState and replaceState to detect navigation changes
        const originalPushState = window.history.pushState;
        window.history.pushState = function (...args) {
          originalPushState.apply(this, args);
          checkNavigation();
        };

        const originalReplaceState = window.history.replaceState;
        window.history.replaceState = function (...args) {
          originalReplaceState.apply(this, args);
          checkNavigation();
        };

        // Fallback: poll for URL changes every 200ms
        // This catches navigation from frameworks that cache history.pushState
        // before hydra.js patches it (e.g., Vue Router in Nuxt)
        setInterval(() => {
          checkNavigation();
        }, 200);

        // Modern Navigation API (Chrome 102+) - more reliable than polling
        if (typeof navigation !== 'undefined') {
          navigation.addEventListener('navigatesuccess', checkNavigation);
        }
      }

      log('Setting up detectNavigation with adminOrigin:', this.adminOrigin);
      detectNavigation((currentUrl) => {
        const currentUrlObj = new URL(currentUrl);
        if (window.location.pathname !== currentUrlObj.pathname) {
          const apiPath = this.pathToApiPath(window.location.pathname);
          // Check if this is in-page navigation (e.g., paging link with data-linkable-allow)
          const inPageNavTime = sessionStorage.getItem('hydra_in_page_nav_time');
          const isInPage = inPageNavTime && (Date.now() - parseInt(inPageNavTime, 10)) < 5000;
          if (isInPage) {
            sessionStorage.removeItem('hydra_in_page_nav_time');
          }
          log('Sending PATH_CHANGE:', window.location.pathname, '-> apiPath:', apiPath, 'inPage:', !!isInPage, 'to', this.adminOrigin);
          window.parent.postMessage(
            {
              type: 'PATH_CHANGE',
              path: apiPath,
              inPage: !!isInPage,
            },
            this.adminOrigin,
          );
          // Update lastKnownPath so initBridge re-init won't send a duplicate PATH_CHANGE
          this.lastKnownPath = window.location.pathname;
        } else if (window.location.hash !== currentUrlObj.hash) {
          const hash = window.location.hash;
          const i = hash.indexOf('/');
          const rawPath = (i !== -1 ? hash.slice(i) || '/' : '/').replace(/\/+/g, '/');
          const apiPath = this.pathToApiPath(rawPath);
          log('Sending PATH_CHANGE (hash):', rawPath, '-> apiPath:', apiPath, 'to', this.adminOrigin);
          window.parent.postMessage(
            {
              type: 'PATH_CHANGE',
              path: apiPath,
            },
            this.adminOrigin,
          );
        }
      });

      // Hydra bridge is enabled via iframe name (persists across navigation)
      // Format: hydra-edit:<origin> or hydra-view:<origin>
      // Also check _edit URL param as fallback (ensures reload on mode change)
      const url = new URL(window.location.href);
      const editParam = url.searchParams.get('_edit');
      const isHydraEdit = window.name.startsWith('hydra-edit:') || editParam === 'true';
      const isHydraView = window.name.startsWith('hydra-view:') || (editParam === 'false');
      const hydraBridgeEnabled = isHydraEdit || isHydraView || editParam !== null;
      const isEditMode = isHydraEdit;
      // Remember whether this bridge is in EDIT mode. View mode has no block
      // selection / inline editing, so edit-only keyboard handling (the Escape
      // step-up machine) must not run there — otherwise it hijacks the
      // frontend's own Escape (e.g. closing a search box) and sends the admin a
      // deselect it can't handle (no onSelectBlock in view mode).
      this._isEditMode = isEditMode;

      // Extract admin origin from iframe name
      if ((isHydraEdit || isHydraView) && !this.adminOrigin) {
        const prefix = isHydraEdit ? 'hydra-edit:' : 'hydra-view:';
        this.adminOrigin = window.name.slice(prefix.length);
        log('Got admin origin from window.name:', this.adminOrigin);
      }

      // Get the access token from URL or sessionStorage
      let access_token = url.searchParams.get('access_token');
      const hasUrlToken = !!access_token;

      // Store token in sessionStorage if found in URL, or retrieve from sessionStorage
      if (access_token) {
        sessionStorage.setItem('hydra_access_token', access_token);
        log('Stored access_token in sessionStorage');
      } else {
        access_token = sessionStorage.getItem('hydra_access_token');
        log('Retrieved access_token from sessionStorage:', access_token ? 'found' : 'not found');
      }

      if (access_token) {
        this.token = access_token;
        this._setTokenCookie(access_token);
      }

      // In view mode, we only need navigation detection (already set up above)
      // Skip all the edit mode setup to avoid slowing down page load
      if (isEditMode) {
        this.enableBlockClickListener();
        this.injectCSS();
        this.listenForSelectBlockMessage();
        this.setupScrollHandler();
        this.setupResizeHandler();
        this.setupMouseActivityReporter();
        this.setupStructuralObserver();

        // Add beforeunload warning to prevent accidental navigation
        window.addEventListener('beforeunload', (e) => {
          // Skip warning for explicitly allowed link navigation (e.g., paging)
          if (this._allowLinkNavigation) {
            this._allowLinkNavigation = false;
            return;
          }
          e.preventDefault();
          e.returnValue = '';
          return '';
        });

        // INITIAL_DATA is the ONLY acknowledgement of INIT, and INIT used to be
        // posted exactly once. A message posted before the admin has mounted its
        // listener is simply gone — the iframe then sits there fully loaded and
        // completely inert, and the only thing hydra did about it was paint a
        // "Not Connected" diagnostic five seconds later. Reloading was the user's
        // only recovery. Waiting on the acknowledgement and re-posting until it
        // comes turns that dead editor into a slow one.
        //
        // Backs off rather than spinning: a lost INIT is recovered in a quarter
        // of a second, and an admin that is genuinely absent is given up on
        // after ~7.75s instead of being asked forever.
        this._retryInitUntilAcknowledged = (initMessage) => {
          const delays = [250, 500, 1000, 2000, 4000];
          let attempt = 0;
          const again = () => {
            if (this.initialized || attempt >= delays.length) {
              if (!this.initialized) {
                // Out of attempts with no acknowledgement. THIS is the moment
                // the diagnostic is entitled to speak — a handshake that has
                // actually failed, not a clock that ran out while it was still
                // in progress.
                this._initHandshakeGaveUp = true;
                _showBridgeDiagnostic({
                  windowName: window.name,
                  hasHydraName: window.name.startsWith('hydra-edit:'),
                  inIframe: window.self !== window.top,
                  adminOrigin: this.adminOrigin || null,
                  bridgeCreated: true,
                  bridgeInitialized: false,
                });
              }
              return;
            }
            this._initRetryTimer = setTimeout(() => {
              if (this.initialized) return;
              log(`INIT not acknowledged, retrying (attempt ${attempt + 1})`);
              window.parent.postMessage(initMessage, this.adminOrigin);
              attempt += 1;
              again();
            }, delays[attempt]);
          };
          again();
        };

        this._stopInitRetries = () => {
          if (this._initRetryTimer) {
            clearTimeout(this._initRetryTimer);
            this._initRetryTimer = null;
          }
        };

        // Send single INIT message with config - admin merges config before responding
        // This ensures blockPathMap is built with complete schema knowledge
        // Include current path so admin can navigate if iframe URL differs (e.g., after client-side nav)
        // Support hash-based routing variants: #/path, #!/path, #path
        let currentPath = window.location.pathname;
        const hash = window.location.hash;
        if (hash) {
          // Find where the path starts in the hash
          const pathIndex = hash.indexOf('/');
          if (pathIndex !== -1) {
            currentPath = hash.slice(pathIndex); // Extract /path from #/path or #!/path
          }
        }

        // Check if this is SPA navigation:
        // - window.name indicates we're in admin iframe (hydra-edit:...)
        // - No token in URL (not admin-initiated navigation)
        // - But we DO have a token in sessionStorage (we were previously initialized)
        // Without stored token, it's initial load even if URL has no token (e.g., mock-parent tests)
        const hasStoredToken = !!sessionStorage.getItem('hydra_access_token');
        const isSpaNavigation = isHydraEdit && !hasUrlToken && hasStoredToken;

        // Check if this is in-page navigation (e.g., paging) - send PATH_CHANGE with inPage flag
        const inPageNavTime = sessionStorage.getItem('hydra_in_page_nav_time');
        const isInPageNavigation = inPageNavTime && (Date.now() - parseInt(inPageNavTime, 10)) < 5000;
        if (isInPageNavigation) {
          sessionStorage.removeItem('hydra_in_page_nav_time');
          const apiPath = this.pathToApiPath(currentPath);
          log('In-page navigation detected (paging), sending PATH_CHANGE with inPage flag, apiPath:', apiPath);
          window.parent.postMessage(
            { type: 'PATH_CHANGE', path: apiPath, inPage: true },
            this.adminOrigin,
          );
          // Admin will resend form data without changing URL
        } else if (isSpaNavigation) {
          const apiPath = this.pathToApiPath(currentPath);
          log('SPA navigation detected (window.name present, access_token missing), sending PATH_CHANGE, apiPath:', apiPath);
          window.parent.postMessage(
            { type: 'PATH_CHANGE', path: apiPath },
            this.adminOrigin,
          );
          // Don't send INIT - admin will just update its URL
        } else {
          const initMessage = {
            type: 'INIT',
            currentPath: this.pathToApiPath(currentPath),
          };
          if (options?.page) {
            initMessage.page = options.page;
          }
          if (options?.blocks) {
            initMessage.blocks = options.blocks;
          }
          if (options?.voltoConfig) {
            initMessage.voltoConfig = options.voltoConfig;
          }
          window.parent.postMessage(initMessage, this.adminOrigin);
          this._retryInitUntilAcknowledged(initMessage);
        }

        const receiveInitialData = (e) => {
          if (e.origin === this.adminOrigin) {
            if (e.data.type === 'INITIAL_DATA') {
              // Central method sets formData, lastReceivedFormData, and blockPathMap
              this.setFormDataFromAdmin(e.data.data, 'INITIAL_DATA', e.data.blockPathMap);
              // Static conversion graph for convert-reachable drop spots (drag).
              if (e.data.conversionMap) this.conversionMap = e.data.conversionMap;

              // Store Slate configuration for keyboard shortcuts and toolbar
              this.slateConfig = e.data.slateConfig || { hotkeys: {}, toolbarButtons: [] };

              // Add nodeIds to all slate fields in all blocks
              this.addNodeIdsToAllSlateFields();

              // Trigger initial render through shared render path
              if (this.onContentChangeCallback) {
                this._executeRender(this.onContentChangeCallback);
              }

              // Focus the iframe window so keyboard events reach it on page load.
              // Must happen inside the iframe (window.focus()) because the parent
              // cannot call contentWindow.focus() on a cross-origin iframe.
              window.focus();

              // Mark bridge as initialized — block selection is now allowed
              this.initialized = true;
              // The handshake is acknowledged: stop retrying, and take down any
              // diagnostic that was raised while we were still trying.
              this._stopInitRetries();
              _removeBridgeDiagnostic();

              // Restore block selection if provided (e.g., after adding a new block)
              // A block carried across an in-page navigation wins over the
              // admin's copy, which predates the click that caused the reload.
              // Read it ONCE and always drop it: sessionStorage outlives the
              // page, so a leftover entry would hijack selection on every
              // later load and point at a block that isn't on the new page.
              const carriedRaw = sessionStorage.getItem('hydra_in_page_nav_block');
              sessionStorage.removeItem('hydra_in_page_nav_block');
              const [carriedAt, carriedBlock] = (carriedRaw || '').split('|');
              const carriedIsFresh =
                !!carriedBlock && Date.now() - parseInt(carriedAt || '0', 10) < 5000;
              if (e.data.selectedBlockUid || carriedIsFresh) {
                const blockUidToSelect = carriedIsFresh ? carriedBlock : e.data.selectedBlockUid;
                const bridge = this;
                // Wait for element to appear AND position to stabilize before selecting
                // This prevents race conditions during frontend re-render/animation
                let lastRect = null;
                let stableCount = 0;
                const STABLE_THRESHOLD = 3;
                const POSITION_TOLERANCE = 2; // pixels
                const MAX_RETRIES = 40; // ~2 seconds at 50ms interval

                const waitForStable = (retries = MAX_RETRIES) => {
                  const element = this.queryBlockElement(blockUidToSelect);
                  if (!element) {
                    if (retries > 0) {
                      bridge._pendingInitialSelectTimer = setTimeout(() => waitForStable(retries - 1), 50);
                    } else {
                      bridge._pendingInitialSelectTimer = null;
                      log('Could not find element for selectedBlockUid:', blockUidToSelect);
                    }
                    return;
                  }

                  const rect = element.getBoundingClientRect();
                  const positionStable = lastRect !== null &&
                    Math.abs(rect.left - lastRect.left) < POSITION_TOLERANCE &&
                    Math.abs(rect.top - lastRect.top) < POSITION_TOLERANCE;

                  if (positionStable) {
                    stableCount++;
                  } else {
                    stableCount = 0;
                  }
                  lastRect = rect;

                  if (stableCount >= STABLE_THRESHOLD) {
                    bridge._pendingInitialSelectTimer = null;
                    bridge.selectBlock(blockUidToSelect);
                  } else if (retries > 0) {
                    bridge._pendingInitialSelectTimer = setTimeout(() => waitForStable(retries - 1), 50);
                  } else {
                    // Timed out waiting for stable - select anyway
                    bridge._pendingInitialSelectTimer = null;
                    bridge.selectBlock(blockUidToSelect);
                  }
                };
                waitForStable();
              }
            }
          }
        };
        window.removeEventListener('message', receiveInitialData);
        window.addEventListener('message', receiveInitialData);
        // Add a single document-level focus listener to track field changes
        // This avoids adding duplicate listeners and works for all blocks
        if (!this.fieldFocusListenerAdded) {
          this.fieldFocusListenerAdded = true;
          // Track mouse button state so fieldFocusListener can distinguish
          // keyboard navigation (Tab) from mouse click side-effects.
          // During mouse clicks, the click handler handles block selection —
          // the focus event between mousedown and click must not call selectBlock
          // because restoreContentEditableOnFields would change the DOM and
          // shift event.target before the click event fires.
          // When the author last pressed a key, so a focus change can be told
          // apart from one the frontend made on its own (see the focus listener).
          document.addEventListener('keydown', () => { this._lastKeyDownAt = Date.now(); }, true);
          document.addEventListener('mousedown', () => { this._mouseButtonDown = true; }, true);
          document.addEventListener('mouseup', () => { this._mouseButtonDown = false; }, true);
          document.addEventListener('focus', (e) => {
            // Firefox may fire focus on text nodes; get the nearest Element
            const target = e.target instanceof Element ? e.target : e.target?.parentElement;
            const blockElement = target?.closest('[data-block-uid]');
            const blockUid = blockElement?.getAttribute('data-block-uid');
            if (!blockUid || !this.selectedBlockUid) return;

            // Focus tracking is a TEXT-mode concern. This listener exists to (a)
            // follow the caret to a different block (Tab) and (b) record which
            // field is focused so the admin shows the right format toolbar — both
            // only meaningful while editing text. In BLOCK mode, selection is
            // driven by taps and the chevrons, so a focus event here is
            // FRONTEND-initiated (e.g. Volto autofocusing a container's first
            // child after re-rendering it on a move) rather than a user gesture.
            // Acting on it hijacks selection (jumping off a moved grid onto its
            // first child, leaving the grid's handles behind) or sets
            // focusedFieldName (silently flipping to the text toolbar). Ignore
            // all focus in block mode; a real user re-enters text via a tap,
            // which goes through the click handler (it sets editMode='text'
            // BEFORE focusing, so genuine editing is unaffected).
            if (this.editMode === 'block') return;

            if (blockUid !== this.selectedBlockUid) {
              // Skip if block-selector or arrow-key navigation is in progress —
              // those flows manage their own block selection
              if (this._blockSelectorNavigating || this._navigatingToBlock) {
                return;
              }
              // During mouse clicks, defer to the click handler for block selection.
              // The focus event fires between mousedown and click — calling selectBlock
              // here would run restoreContentEditableOnFields before click, which can
              // change event.target and break linkable/media field detection.
              if (this._mouseButtonDown) {
                return;
              }
              // Only a focus the AUTHOR moved may move the selection. Tab is
              // theirs; a focus the frontend moves is not — a container
              // refocusing itself after re-rendering, a tab strip restoring
              // focus to its active tab, a carousel after a slide change.
              //
              // Acting on those steals the selection: adding a block into a doc
              // page's Example tab left the TAB selected, so the sidebar offered
              // the container's settings instead of the block just added, and
              // there was no way to configure it. Same argument the block-mode
              // branch above already makes; just as true here.
              //
              // Not "is the target editable": Tab legitimately lands on a
              // button or a link in another block, and selection should follow
              // there too (block-navigation.spec.ts pins exactly that).
              if (Date.now() - (this._lastKeyDownAt || 0) > 300) return;
              // Focus moved to a different block (e.g., via Tab) — select it
              log('Focus moved to different block:', blockUid, 'from:', this.selectedBlockUid);
              // Cancel any pending initial-selection — user navigated away
              if (this._pendingInitialSelectTimer) {
                clearTimeout(this._pendingInitialSelectTimer);
                this._pendingInitialSelectTimer = null;
              }
              this.selectBlock(blockElement);
              return;
            }

            // Focus changed within the currently selected block
            const editableField = target.getAttribute('data-edit-text');
            if (editableField) {
              log('Field focused:', editableField);
              const previousFieldName = this.focusedFieldName;
              this.focusedFieldName = editableField;

              // Only update toolbar if field actually changed
              if (previousFieldName !== editableField) {
                log('Field changed from', previousFieldName, 'to', editableField, '- updating toolbar');
                const blockEl = this.queryBlockElement(blockUid);
                if (blockEl) {
                  this.sendBlockSelected('fieldFocusListener', blockEl, { focusedFieldName: editableField });
                }
              }
            }
          }, true); // Use capture phase to catch focus events before they bubble
        }
      } else if (isHydraView) {
        // View mode: just send INIT so admin knows the current path (no edit setup needed)
        let currentPath = window.location.pathname;
        const hash = window.location.hash;
        if (hash) {
          const pathIndex = hash.indexOf('/');
          if (pathIndex !== -1) {
            currentPath = hash.slice(pathIndex);
          }
        }
        window.parent.postMessage(
          { type: 'INIT', currentPath: this.pathToApiPath(currentPath) },
          this.adminOrigin,
        );
      }
    }
  }

  /**
   * Sets the access token in a cookie.
   *
   * @param {string} token - The access token to store.
   * @private
   */
  _setTokenCookie(token) {
    const expiryDate = new Date();
    expiryDate.setTime(expiryDate.getTime() + 12 * 60 * 60 * 1000); // 12 hours

    const url = new URL(window.location.href);
    const domain = url.hostname;
    document.cookie = `access_token=${token}; expires=${expiryDate.toUTCString()}; path=/; domain=${domain}; SameSite=None; Secure`;
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Real-time Data Handling and Quanta Toolbar Creation
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Registers a callback to handle real-time data updates from the adminUI.
   *
   * @param {function} callback - The function to call when form data is received.
   */
  onEditChange(callback) {
    // Store callback so INITIAL_DATA handler can use it
    this.onContentChangeCallback = callback;
    this.realTimeDataHandler = (event) => {
      if (
        event.origin === this.adminOrigin ||
        event.origin === window.location.origin
      ) {
        if (
          event.data.type === 'FORM_DATA' ||
          event.data.type === 'TOGGLE_MARK_DONE'
        ) {
          log('Received', event.data.type, 'message');
          if (event.data.data) {
            // Don't set isInlineEditing to false - user is still editing
            // Check if focused field content changed - if so, this is a sidebar edit,
            // not just a sync. Clear savedClickPosition to prevent stealing focus.
            if (this.savedClickPosition && !this.focusedFieldValuesEqual(this.formData, event.data.data)) {
              log('FORM_DATA: content changed, clearing savedClickPosition (sidebar edit)');
              this.savedClickPosition = null;
            }

            // Check if Admin wants to select a different block (e.g., after Enter creates new block)
            // NOTE: Don't set this.selectedBlockUid here - let selectBlock() set it so isSelectingSameBlock
            // is calculated correctly (important for scroll-into-view behavior)
            const adminSelectedBlockUid = event.data.selectedBlockUid;
            const needsBlockSwitch = adminSelectedBlockUid && adminSelectedBlockUid !== this.selectedBlockUid;
            if (needsBlockSwitch) {
              log('Switching selectedBlockUid from', this.selectedBlockUid, 'to', adminSelectedBlockUid);
              // Cancel any pending initial-selection — admin is switching to a new block
              if (this._pendingInitialSelectTimer) {
                clearTimeout(this._pendingInitialSelectTimer);
                this._pendingInitialSelectTimer = null;
              }
            }

            // Check if incoming FORM_DATA is stale (our local sequence is higher)
            // EXCEPTION: Never reject format responses - they have formatRequestId and are
            // the result of a format operation we requested
            const incomingSeq = event.data.data?._editSequence || 0;
            const localSeq = this.formData?._editSequence || 0;
            const isFormatResponse = !!event.data.formatRequestId;
            const isStale = incomingSeq < localSeq && !isFormatResponse;

            if (isStale) {
              log('FORM_DATA: skipping stale data, incoming seq:', incomingSeq, 'local seq:', localSeq,
                  'isFormatResponse:', isFormatResponse, 'blockedBlockId:', this.blockedBlockId);
              // Don't unblock here - the stale FORM_DATA is not the response we're waiting for
              // Wait for the actual format response (which will have formatRequestId)
              return;
            }

            // Central method for setting form data with logging (also sets blockPathMap)
            if (event.data.blockPathMap === undefined) {
              log('WARNING: FORM_DATA received without blockPathMap!',
                'message keys:', Object.keys(event.data),
                'hasData:', !!event.data.data,
                'formatRequestId:', event.data.formatRequestId,
                'selectedBlockUid:', event.data.selectedBlockUid);
            }
            if (event.data._sentAt) {
              log('FORM_DATA postMessage delivery:', (Date.now() - event.data._sentAt) + 'ms');
            }
            if (this._transformSentAt && event.data.formatRequestId) {
              log('FORM_DATA total round-trip:', (performance.now() - this._transformSentAt).toFixed(0) + 'ms');
              this._transformSentAt = null;
            }
            // If a render is already in progress, queue this FORM_DATA.
            // Don't call setFormDataFromAdmin — this.formData must stay in sync
            // with what onEditChange rendered, otherwise isContentReady compares
            // DOM against data the framework never received.
            if (this._renderInProgress) {
              log('FORM_DATA: render in progress, queuing');
              this._formDataQueue = event.data;
              return;
            }

            this.setFormDataFromAdmin(event.data.data, 'FORM_DATA', event.data.blockPathMap);

            // Add nodeIds to all slate blocks before rendering
            this.addNodeIdsToAllSlateFields();

            // Detect echo: compare after addNodeIdsToAllSlateFields so both
            // old and new formData have nodeIds.
            const echoT0 = performance.now();
            this._isEchoFormData = this._prevFormDataJson
              && JSON.stringify(this.formData) === this._prevFormDataJson;
            log('echo detection took', (performance.now() - echoT0).toFixed(1) + 'ms, isEcho:', this._isEchoFormData);

            // Extract formatRequestId early so it's available in rAF callbacks
            const formatRequestId = event.data.formatRequestId;
            // Set expectedSelectionFromAdmin BEFORE the render so that any
            // selectionchange from DOM re-render is suppressed. Without this,
            // the selectionchange fires before afterContentRender's double-rAF
            // sets it, sending a stale [0,0] selection back to the admin.
            if (event.data.transformedSelection) {
              this.expectedSelectionFromAdmin = event.data.transformedSelection;
            }
            // skipRender: data didn't change (e.g. link cancel) — skip the
            // framework re-render but still run afterContentRender for
            // selection restore, unblock, observer reattachment, etc.
            const renderFn = event.data.skipRender ? () => {} : callback;
            log(event.data.skipRender
              ? 'FORM_DATA: skipRender — running afterContentRender without re-render'
              : 'Calling onEditChange callback to trigger re-render');
            this._executeRender(renderFn, {
              transformedSelection: event.data.transformedSelection,
              formatRequestId,
              needsBlockSwitch,
              adminSelectedBlockUid,
              skipRender: !!event.data.skipRender,
            });
          } else {
            throw new Error('No form data has been sent from the adminUI');
          }
        } else if (event.data.type === 'FLUSH_BUFFER') {
          // Parent is requesting a buffer flush before applying format
          // This ensures the parent's Slate editor has the latest text
          const requestId = event.data.requestId;
          log('Received FLUSH_BUFFER request, requestId:', requestId, 'savedSelection:', this.savedSelection);

          // If a render is in progress, defer FLUSH_BUFFER until afterContentRender
          // completes. During render, DOM nodes may be detached (nodeIds stripped),
          // and serializeSelection() would fail. Process it once the DOM is stable.
          if (this._renderInProgress) {
            log('FLUSH_BUFFER: render in progress, queuing');
            this._flushBufferQueue = event.data;
            return;
          }

          this._processFlushBuffer(requestId, event.data.setBlocking);
        } else if (event.data.type === 'SLATE_ERROR') {
          // Handle errors from Slate formatting operations
          console.error('[HYDRA] Received SLATE_ERROR:', event.data.error);
          const blockId = event.data.blockId;

          // Clear the processing state if it matches this block
          if (blockId && this.pendingTransform?.blockId === blockId) {
            log('Clearing processing state due to SLATE_ERROR');
            this.setBlockProcessing(blockId, false);
          }
        } else if (event.data.type === 'TOGGLE_OPTIONAL_FIELDS') {
          // Editor pressed the reveal toggle on the quanta toolbar.
          log('Received TOGGLE_OPTIONAL_FIELDS:', event.data.blockUid);
          this.toggleOptionalFields(event.data.blockUid);
        } else if (event.data.type === 'FOCUS_FIELD') {
          // The sidebar is on this field. Two things follow from that, and only
          // one of them is always wanted:
          //
          //   REVEAL — show where the field is edited, if the page is not
          //            showing it. Always right: the author is working on that
          //            field, and it may be inside something closed.
          //   CARET  — move the cursor into the page. Right when the admin is
          //            handing editing back (a LinkEditor closing), wrong while
          //            someone is typing in the sidebar, which is where the
          //            caret would be taken from.
          //
          // So it is one message with an intent, not two messages: `moveCaret`
          // defaults to true, which is what every existing sender means.
          const { blockId, fieldName, moveCaret = true } = event.data;
          log('Received FOCUS_FIELD:', blockId, fieldName, { moveCaret });

          this.revealFieldPlace(blockId, fieldName);
          const blockElement = moveCaret ? this.queryBlockElement(blockId) : null;
          if (blockElement) {
            // Find the specific field by data-field-id attribute
            const field =
              blockElement.querySelector(
                `[data-field-id="${fieldName}"][contenteditable="true"]`,
              ) || this.getEditableFieldByName(blockElement, fieldName);
            if (field) {
              field.focus();
              log('Focused field:', fieldName);
            } else {
              // Fallback to first editable field if specific field not found
              const firstEditable = this.getOwnFirstEditableField(blockElement);
              if (firstEditable) {
                firstEditable.focus();
                log('Focused first editable field (fallback)');
              }
            }
          }
        } else if (event.data.type === 'SLASH_MENU_CLOSED') {
          // Admin closed the slash menu (user selected a block type or dismissed)
          log('Received SLASH_MENU_CLOSED');
          this._slashMenuActive = false;
        } else if (event.data.type === 'ENTER_SELECTION_MODE') {
          log('Received ENTER_SELECTION_MODE from admin');
          // Admin (sidebar Ctrl+Click) asked us to enter selection mode.
          // Enter without toggling any block — admin already set multiSelected.
          this._enterSelectionModeActivateOnly();
        } else if (event.data.type === 'EXIT_SELECTION_MODE') {
          log('Received EXIT_SELECTION_MODE');
          this._selectionModeBlockUids = null;
          this.multiSelectedBlockUids = [];
          // Ack back to admin so it can clear selectionMode
          this.sendMessageToParent({ type: 'EXIT_SELECTION_MODE' });
        } else if (event.data.type === 'STEP_UP') {
          // Admin-side ⬆ button (mobile, where no Escape key exists)
          // routes through the same state machine as the desktop
          // Escape key. The button click is just a relay — all the
          // text → block → parent → deselect logic lives in
          // stepUpSelection() so there is one source of truth.
          log('Received STEP_UP');
          this.stepUpSelection({ source: 'stepUpMessage' });
        } else if (event.data.type === 'TEMPLATE_EDIT_MODE') {
          // v2: the set of currently-unlocked template instance ids (string[]).
          // Multiple templates can be unlocked at once; an empty array means none.
          // Affects which blocks are editable/movable via isBlockReadonly /
          // isBlockPositionLocked.
          this.templateEditMode = Array.isArray(event.data.instanceIds)
            ? event.data.instanceIds
            : [];
          log('Template edit mode:', this.templateEditMode.length
            ? `editing instances ${this.templateEditMode.join(', ')}`
            : 'disabled');

          // Update visual state of all blocks (grey out readonly blocks)
          this.applyReadonlyVisuals();

          // Refresh contenteditable on the currently selected block
          if (this.selectedBlockUid) {
            const blockElement = this.queryBlockElement(this.selectedBlockUid);
            if (blockElement) {
              this.restoreContentEditableOnFields(blockElement, 'TEMPLATE_EDIT_MODE');
            }
          }
        }
      }
    };

    // Ensure we don't add multiple listeners
    window.removeEventListener('message', this.realTimeDataHandler);
    window.addEventListener('message', this.realTimeDataHandler);
  }

  /**
   * Detects which field should be focused and updates the toolbar accordingly.
   * Called after DOM updates to ensure editable fields exist.
   * Also sets contenteditable on text and slate fields.
   *
   * @param {string} blockUid - The UID of the block to detect field for.
   */
  detectFocusedFieldAndUpdateToolbar(blockUid) {
    const blockElement = this.queryBlockElement(blockUid);
    if (!blockElement) {
      log('Block element not found for field detection:', blockUid);
      return;
    }

    // Set contenteditable on text and slate fields
    this.restoreContentEditableOnFields(blockElement, 'detectFocusedFieldAndUpdateToolbar');

    let fieldToFocus = null;

    if (this.lastClickPosition?.target) {
      // Find the clicked editable field - only accept if it belongs to THIS block
      const clickedElement = this.lastClickPosition.target;
      const clickedField = clickedElement.closest('[data-edit-text]');
      log('Click event path - found clickedField:', !!clickedField);
      if (clickedField && this.fieldBelongsToBlock(clickedField, blockElement)) {
        fieldToFocus = clickedField.getAttribute('data-edit-text');
        log('Got field from click:', fieldToFocus);
      }
    }

    // If no clicked field found, use the first editable field that belongs to THIS block
    if (!fieldToFocus) {
      const firstEditableField = this.getOwnFirstEditableField(blockElement);
      log('querySelector path - found:', !!firstEditableField);
      if (firstEditableField) {
        fieldToFocus = firstEditableField.getAttribute('data-edit-text');
        log('Got field from querySelector:', fieldToFocus);
      }
    }


    // Update focusedFieldName and recreate toolbar if field changed
    if (fieldToFocus !== this.focusedFieldName) {
      log('Updating focusedFieldName from', this.focusedFieldName, 'to', fieldToFocus);
      this.focusedFieldName = fieldToFocus;

      // Send BLOCK_SELECTED message to update toolbar visibility
      const blockElement = this.queryBlockElement(blockUid);
      if (blockElement) {
        this.sendBlockSelected('detectFieldChange', blockElement, { focusedFieldName: fieldToFocus });
      }
    }
  }

  /**
   * Creates the Quanta toolbar for the selected block.
   *
   * @param {string} blockUid - The UID of the selected block.
   * @param {Object} show - Options for showing/hiding toolbar elements:
   *   - formatBtns: Whether to show format buttons (true/false).
   */
  enableBlockClickListener() {
    this.blockClickHandler = (event) => {
      // Selection mode: clicks toggle blocks instead of selecting
      if (this._selectionModeBlockUids) {
        const blockElement = event.target.closest('[data-block-uid]');
        if (blockElement) {
          event.preventDefault();
          event.stopPropagation();
          const blockUid = blockElement.getAttribute('data-block-uid');
          log('blockClickHandler: selection mode toggle:', blockUid);
          this.sendMessageToParent({
            type: 'ENTER_SELECTION_MODE',
            blockUid,
          });
        }
        return;
      }
      log('blockClickHandler: event target:', event.target.tagName, event.target.className);
      log('blockClickHandler: _isDragging:', this._isDragging, '_navigatingToBlock:', this._navigatingToBlock);

      // Handle data-block-selector clicks (carousel nav buttons, etc.)
      // Don't stopPropagation or preventDefault - let frontend handle visibility changes
      // Skip if tryMakeBlockVisible is currently navigating (to avoid interference)
      const selectorElement = event.target.closest('[data-block-selector]');
      if (selectorElement) {
        // tryMakeBlockVisible reveals a hidden block by SYNTHESISING a click on
        // its selector (`clickedSelector.click()`); that must not re-enter this
        // handler. But a genuine user click arriving mid-navigation was being
        // dropped by the same guard — click an accordion header or a <summary>
        // while the editor is still scrolling to the initially selected block
        // and nothing happens at all, silently.
        //
        // `isTrusted` is exactly this distinction: false for a programmatic
        // .click(), true for real user input. So the bridge ignores only its
        // own click; a user's click wins and cancels the navigation it
        // interrupted.
        if (this._navigatingToBlock && !event.isTrusted) {
          log('blockClickHandler: skipping handleBlockSelector, tryMakeBlockVisible in progress');
          return;
        }
        if (this._navigatingToBlock) {
          log('blockClickHandler: user click overrides in-progress navigation to', this._navigatingToBlock);
          this._navigatingToBlock = null;
        }
        const selector = selectorElement.getAttribute('data-block-selector');
        // A reveal trigger can also BE the block's editable heading: accordion
        // panel titles and <details>/<summary> disclosures carry
        // data-block-selector and data-edit-text on the same element (or the
        // heading nested inside the trigger). Revealing must not cost the author
        // inline editing, so record the clicked field BEFORE navigating — the
        // selectBlock that follows the reveal is what promotes it.
        const promoted = this.noteEditableFromSelectorClick(event, selector);
        this.handleBlockSelector(selector, selectorElement);
        if (promoted) {
          // The trigger is a <button>, so the browser puts focus on IT, not on
          // the contenteditable label inside it — the author clicked to type and
          // the caret went to the button. The field only becomes editable once
          // the block is selected, and that cannot happen until the panel this
          // button reveals is actually on screen.
          //
          // So the caret is placed by the reveal, not on a clock of its own.
          // This used to poll for 30 animation frames (~500-900ms) alongside
          // waitForBlockVisibleAndSelect, which is entitled to take 2s: two
          // clocks for one dependency, the shorter one owned by the code that
          // depends on the longer one's outcome.
          const uid = Bridge.primaryUidOf(selector);
          this._pendingSelectorCaret = { uid, fieldName: this.focusedFieldName };
        }
        return;
      }

      // Defer block selection until INITIAL_DATA is received and render completes.
      // Save the click point and poll until init + render are done, then resolve
      // the block via elementFromPoint (DOM may re-render during init).
      if (!this.initialized) {
        log('blockClickHandler: deferred — INITIAL_DATA not yet received');
        const x = event.clientX;
        const y = event.clientY;
        const bridge = this;
        const waitForInit = () => {
          if (bridge.initialized && !bridge._renderInProgress) {
            const el = document.elementFromPoint(x, y);
            const blockEl = el?.closest('[data-block-uid]');
            if (blockEl) {
              log('Processing deferred block click, uid:', blockEl.getAttribute('data-block-uid'));
              bridge.selectBlock(blockEl);
            }
          } else {
            setTimeout(waitForInit, 50);
          }
        };
        setTimeout(waitForInit, 50);
        return;
      }

      // Skip block selection during carousel/selector navigation
      // (a click on the carousel button can also trigger blockClickHandler for the old slide)
      if (this._blockSelectorNavigating) {
        log('blockClickHandler: skipping, _blockSelectorNavigating active');
        return;
      }

      // Check if clicked element (or ancestor) has data-linkable-allow - allows navigation
      // Works for paging links, checkboxes, selects, etc. regardless of block context
      // Must be checked before blockElement since paging links may be outside block elements
      const allowedElement = event.target.closest('[data-linkable-allow]');
      if (allowedElement) {
        this._allowLinkNavigation = true;
        // Reset flag after short delay if navigation didn't happen
        setTimeout(() => { this._allowLinkNavigation = false; }, 100);
        // Store timestamp for in-page navigation - checked on reload to skip PATH_CHANGE
        sessionStorage.setItem('hydra_in_page_nav_time', String(Date.now()));
        // ...and WHAT was selected. Applying a search facet reloads the page by
        // design, and the author's selection should survive it. Relying on the
        // admin to remember is a race: the navigation can beat the
        // BLOCK_SELECTED it was told about, so it restores what it had before.
        if (this.selectedBlockUid) {
          // Carries its OWN timestamp: hydra_in_page_nav_time is consumed by the
          // PATH_CHANGE branch earlier in the load, so borrowing it made this
          // always look stale.
          sessionStorage.setItem(
            'hydra_in_page_nav_block',
            `${Date.now()}|${this.selectedBlockUid}`,
          );
        }
      }

      const blockElement = event.target.closest('[data-block-uid]');
      if (blockElement) {
        // Skip synthetic clicks (keyboard activation like space on button) on contenteditable elements
        // event.detail === 0 indicates keyboard-triggered click
        const target = event.target;
        if (target.isContentEditable && event.detail === 0) {
          event.preventDefault(); // Prevent button activation
          return; // Don't re-select block - preserves cursor for text input
        }

        // Check if we're inside a readonly block (e.g., listing items with _blockUid)
        // Readonly blocks ignore editable/linkable/media fields and prevent link navigation
        // Check both DOM attribute and readonly registry
        const blockUid = blockElement.getAttribute('data-block-uid');
        const isInsideReadonly = event.target.closest('[data-block-readonly]') || this.isBlockReadonly(blockUid);

        // Handle link clicks in edit mode
        const linkElement = event.target.closest('a');
        if (linkElement && !allowedElement) {
          // Prevent link navigation inside readonly blocks (skip for data-linkable-allow)
          if (isInsideReadonly) {
            event.preventDefault();
          } else {
            // Only prevent if this is a linkable field (opens link editor in sidebar)
            const isLinkableField = linkElement.closest('[data-edit-link]');
            if (isLinkableField) {
              event.preventDefault();
            }
          }
        }

        // Store click position relative to the editable element for cursor positioning
        // Using relative coordinates ensures focus()/scroll doesn't invalidate the position
        // Also store the target for field detection
        // Inside readonly blocks, ignore editable/linkable/media fields (they're from query results, not editable)
        const clickedEditableField = isInsideReadonly ? null : event.target.closest('[data-edit-text]');
        const editableField = clickedEditableField || (isInsideReadonly ? null : blockElement.querySelector('[data-edit-text]'));

        // Detect clicked linkable and media fields (ignored inside readonly blocks)
        const clickedLinkableField = isInsideReadonly ? null : event.target.closest('[data-edit-link]');
        const clickedMediaField = isInsideReadonly ? null : event.target.closest('[data-edit-media]');

        // Clicking a data-edit-text element starts INLINE text editing, so prevent
        // the element's OWN default action. A data-edit-text submit button would
        // otherwise submit the form (showing the success state) instead of letting
        // you edit its label. Links are handled above (data-edit-link); a plain
        // <h3>/<p>/<label> has no default action so this is a no-op for them.
        if (clickedEditableField) {
          event.preventDefault();
        }

        this.recordClickPosition(event, editableField, !!isInsideReadonly);
        // Cancel any pending initial-selection from waitForStable —
        // user click takes priority over automatic block restoration
        if (this._pendingInitialSelectTimer) {
          clearTimeout(this._pendingInitialSelectTimer);
          this._pendingInitialSelectTimer = null;
        }

        // Multi-selection: Shift or Ctrl/Meta click
        // Only in block mode — in text mode, Shift+Click extends text selection (browser native)
        // Ctrl/Meta+Click always toggles block selection regardless of mode
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          const isTextMode = this.editMode === 'text';
          // Shift+Click on the same block in block mode → enter text mode (not multi-select)
          const isSameBlock = blockUid === this.selectedBlockUid;
          if ((!isTextMode && !isSameBlock) || event.ctrlKey || event.metaKey) {
            this._handleMultiSelectClick(blockUid, event);
            return;
          }
          // In text mode with Shift — fall through to normal click handling (text selection)
        }

        // Plain click clears multi-selection
        if (this.multiSelectedBlockUids.length > 0) {
          this.multiSelectedBlockUids = [];
        }

        // Only a block that HAS text lands in text mode.
        //
        // Clicking an image, a card, a container with no title — any block with no
        // editable text — has no cursor to place, so text mode is a lie: the editor
        // sees no caret, yet Escape / the ⬆ button spend their first press "leaving"
        // an inline editor that was never entered, and deselecting takes two presses.
        //
        // Keyed on the block OWNING an editable field, not on the click landing
        // exactly on the glyphs: clicking a text block's padding must still place the
        // cursor, and `target.closest()` only walks ANCESTORS, so a click on the
        // block's own <div> would never find the `data-edit-text` child below it.
        // getOwnEditableFields excludes nested blocks' fields (fieldBelongsToBlock).
        //
        // Touch-aware on top of that:
        //   - Mouse (fine pointer)     → text mode if the click was on this block's text.
        //   - Touch (coarse pointer):
        //       1st tap on a DIFFERENT block → block mode (no contenteditable,
        //         no cursor). iOS native long-press = word-select can't fire
        //         because the field is contenteditable=false in this state.
        //         Block-multi-select long-press has a clean canvas to grab.
        //       2nd tap on the SAME block    → text mode (cursor in field).
        // Without that gate, long-press on a freshly selected block races
        // the OS word-select handles on top of the bridge's multi-select
        // timer, putting editors into both modes simultaneously.
        const coarsePointer =
          typeof matchMedia === 'function' &&
          matchMedia('(pointer: coarse)').matches;
        const alreadySelected = blockUid === this.selectedBlockUid;
        const hasOwnText =
          !this.isBlockReadonly(blockUid) &&
          this.getOwnEditableFields(blockElement).length > 0;
        const enterTextMode = hasOwnText && (!coarsePointer || alreadySelected);
        this.editMode = enterTextMode ? 'text' : 'block';
        this.selectBlock(blockElement, { fromUserClick: true });
      } else {
        // No block - check for page-level fields
        const pageField = event.target.closest('[data-edit-media], [data-edit-link], [data-edit-text]');
        if (pageField) {
          event.preventDefault();
          this.selectedBlockUid = PAGE_BLOCK_UID;

          // Detect focused field type
          this.focusedMediaField = pageField.getAttribute('data-edit-media');
          this.focusedLinkableField = pageField.getAttribute('data-edit-link');
          this.focusedFieldName = pageField.getAttribute('data-edit-text');

          // Make page-level text fields editable and focusable
          if (this.focusedFieldName) {
            // Check if field was already editable (user may be re-clicking an edited field)
            const wasAlreadyEditable = pageField.getAttribute('contenteditable') === 'true';

            this.editMode = 'text';
            this.isInlineEditing = true;
            this.activateEditableField(pageField, this.focusedFieldName, null, 'pageFieldClick', {
              wasAlreadyEditable,
              saveClickPosition: true, // Save for FORM_DATA handler after re-render
            });
          }

          // Send BLOCK_SELECTED with pageField as "block" - blockUid will be PAGE_BLOCK_UID
          this.sendBlockSelected('pageFieldClick', pageField);
        } else {
          // No block, no page-level field — check for navigation link clicks.
          // In edit mode, let the browser navigate the iframe naturally so the
          // iframe's beforeunload handler fires a warning dialog. We must
          // stopPropagation to prevent SPA routers (Vue Router, etc.) from
          // intercepting the click as client-side navigation (which wouldn't
          // trigger beforeunload). We do NOT preventDefault — the browser's
          // default <a> navigation is exactly what we want.
          const linkEl = event.target.closest('a[href]');
          if (linkEl && !allowedElement) {
            const href = linkEl.getAttribute('href');
            try {
              const linkUrl = new URL(href, window.location.origin);
              if (linkUrl.origin === window.location.origin) {
                event.stopPropagation();
                log('Nav link click in edit mode — letting browser navigate (triggers beforeunload):', href);
              }
            } catch (e) {
              // Invalid URL - let browser handle it
            }
          }
        }
      }
    };

    document.removeEventListener('click', this.blockClickHandler, true);
    document.addEventListener('click', this.blockClickHandler, true);

    // Set _blockSelectorNavigating on mousedown (before focus fires) so the
    // focus listener doesn't incorrectly select the container block when a
    // block-selector button (e.g., carousel +1/-1) is clicked.
    if (!this._blockSelectorMousedownHandler) {
      this._blockSelectorMousedownHandler = (event) => {
        if (event.target.closest('[data-block-selector]')) {
          this._blockSelectorNavigating = true;
        }
      };
      document.addEventListener('mousedown', this._blockSelectorMousedownHandler, true);
    }

    // Long press detection for touch devices (mobile selection mode)
    if (!this._longPressHandlersAttached) {
      this._longPressHandlersAttached = true;
      this._longPressTimer = null;
      const LONG_PRESS_MS = 600;
      const MOVE_THRESHOLD = 10;
      let startX = 0, startY = 0;

      document.addEventListener('touchstart', (e) => {
        if (this._longPressTimer) clearTimeout(this._longPressTimer);

        // Don't fire the block multi-select long-press while the user is
        // editing text. The OS-native long-press = word-select gesture
        // must win cleanly on a focused contenteditable. Without this
        // gate the timer fires AND the word-select handles appear at the
        // same time, putting the editor into multi-block-select mode
        // while they were trying to copy a word.
        // Test: tap a slate field to focus it, long-press to word-select
        //   → should ONLY show word-selection, not enter multi-select.
        const ae = document.activeElement;
        const inTextMode = !!(
          ae &&
          ae !== document.body &&
          ae.closest &&
          ae.closest('[contenteditable="true"]')
        );
        if (inTextMode) return;

        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const blockEl = target?.closest('[data-block-uid]');
        if (!blockEl) return;
        const blockUid = blockEl.getAttribute('data-block-uid');

        this._longPressTimer = setTimeout(() => {
          this._longPressTimer = null;
          if (this._selectionModeBlockUids) {
            // Already in selection mode — send toggle to admin
            log('Long press in selection mode, toggling:', blockUid);
            this.sendMessageToParent({
              type: 'ENTER_SELECTION_MODE',
              blockUid,
            });
          } else {
            log('Long press detected on block:', blockUid);
            this._enterSelectionMode(blockUid);
          }
        }, LONG_PRESS_MS);
      }, { passive: true });

      document.addEventListener('touchmove', (e) => {
        if (!this._longPressTimer) return;
        const touch = e.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
          clearTimeout(this._longPressTimer);
          this._longPressTimer = null;
        }
      }, { passive: true });

      document.addEventListener('touchend', () => {
        if (this._longPressTimer) {
          clearTimeout(this._longPressTimer);
          this._longPressTimer = null;
        }
      }, { passive: true });
    }

    // Space on interactive contenteditable elements (buttons, etc.) is handled
    // by _handleFieldKeydown → replayOneKey which preventDefault + insertText.

    // All keyboard handling (Escape, arrows, delete, Cmd+A, Enter) is
    // consolidated in _documentKeyboardBlocker → _handleKeydown.
    // No separate document-level keydown handlers needed.
  }

  // Sync `document.body.dataset.hydraEditMode` to the current editMode.
  // The injected CSS uses this attribute (gated by @media (pointer: coarse))
  // to set `user-select: none` on data-edit-text fields when in block mode
  // — which is what actually suppresses the iOS / Android Chrome
  // OS-level long-press = word-select gesture. contenteditable=false
  // alone doesn't do it: the browsers happily word-select non-editable
  // text via long-press.
  _syncEditModeAttribute() {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.dataset.hydraEditMode = this.editMode || 'text';
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Transform Blocking API - Prevent user input during Slate transforms
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Blocks or unblocks user input on a block while Slate transforms are processing.
   * This prevents race conditions where the user makes changes while waiting for
   * the Admin UI to process and return transformed content.
   *
   * @param {string} blockId - Block UID to block/unblock
   * @param {boolean} processing - true to block input, false to unblock
   */
  /**
   * Ensures the document-level keyboard blocker is attached.
   * The blocker intercepts keydown/keypress/input/beforeinput when blockedBlockId is set,
   * buffering keydown events in eventBuffer for later replay.
   * Created once and reused — the handler checks blockedBlockId before acting.
   */
  _ensureDocumentKeyboardBlocker() {
    if (this._documentKeyboardBlocker) return;
    this._documentKeyboardBlocker = (e) => {
      // DEBUG: log events through the blocker (only when blocked)
      if (this.blockedBlockId) {
        log('DEBUG blocker:', e.type, e.key || e.inputType || '?', 'target:', e.target?.nodeName,
          'block:', e.target?.closest?.('[data-block-uid]')?.getAttribute('data-block-uid'));
      }
      // Not blocked — handle all keydown events based on current mode.
      if (!this.blockedBlockId) {
        if (e.type !== 'keydown') return;
        if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
        if (e.defaultPrevented) return; // Already handled by field-level handler

        // DEBUG: trace arrow events through blocker
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
          log('BLOCKER arrow:', e.key, 'ts:', Math.round(e.timeStamp), 'trusted:', e.isTrusted,
            'target:', e.target?.nodeName, 'class:', e.target?.className?.substring?.(0, 30),
            'activeEl:', document.activeElement?.nodeName, 'selected:', this.selectedBlockUid);
        }

        const activeEditField = document.activeElement?.closest?.('[data-edit-text][contenteditable="true"]');

        // === Escape: three-state machine (edit mode only) ===
        if (e.key === 'Escape') {
          // View mode has nothing to step up (no selection/editing) and its
          // admin has no onSelectBlock handler. Don't hijack the frontend's own
          // Escape (e.g. closing a search box) or send a deselect it can't
          // handle — let Escape pass through to the page.
          if (!this._isEditMode) return;
          // Don't interfere with slash menu, modals, dropdowns
          if (this._slashMenuActive) return;
          const isInPopup = e.target?.closest?.('.volto-hydra-dropdown-menu, .blocks-chooser, [role="dialog"]');
          if (isInPopup) return;

          // The state machine itself lives in stepUpSelection() — that
          // way the SAME progression is reachable from a STEP_UP
          // postMessage (sent by the admin-side ⬆ button), with zero
          // duplicated logic.
          if (this.stepUpSelection({ source: 'escapeKey' })) {
            e.preventDefault();
            // Also stop propagation so this editor key (escape-to-parent) does not
            // reach the FRONTEND's own window/document keydown handlers. Otherwise an
            // app-level ESC shortcut — e.g. a slide-out menu that closes on ESC —
            // fires too, dismissing UI mid-edit. The blocker is capture-phase, so
            // this halts the event before it bubbles to the page's listeners. Safe
            // here: only when stepUpSelection actually consumed the Escape (the
            // no-block / popup / slash cases already returned or return false).
            e.stopPropagation();
          }
          return;
        }

        // === Cmd+A: escalation (text → block → all siblings) ===
        if (e.key === 'a' && (e.ctrlKey || e.metaKey) && this.selectedBlockUid) {
          if (activeEditField) {
            // Text mode: if all text already selected, escalate to block mode
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const fieldText = activeEditField.textContent || '';
            const selText = sel.toString();
            if (selText.length < fieldText.replace(/[\uFEFF\u200B]/g, '').length) return; // let field handler select all
            // Escalate to block mode
            e.preventDefault();
            this.editMode = 'block';
            const blockElement = this.queryBlockElement(this.selectedBlockUid);
            if (blockElement) {
              this.collectBlockFields(blockElement, 'data-edit-text', (el) => {
                if (el.getAttribute('contenteditable') === 'true') {
                  el.setAttribute('contenteditable', 'false');
                }
              });
            }
            activeEditField.blur();
            window.getSelection()?.removeAllRanges();
            this.focusedFieldName = null;
            if (blockElement) {
              this.sendBlockSelected('selectAllBlock', blockElement, { focusedFieldName: null });
            }
            return;
          }
          // Block mode Cmd+A handled by _handleBlockModeKey below
        }

        // === Text mode: let field-level handlers deal with everything else ===
        if (activeEditField) return;

        // === Multi-select: handle keys before the no-block guard ===
        // After Ctrl+Click multi-select, selectedBlockUid may be null but
        // multiSelectedBlockUids is populated. _handleBlockModeKey handles
        // Cmd+C, Cmd+X, Cmd+V, Delete, Escape for multi-selection.
        if (this.multiSelectedBlockUids.length > 0) {
          if (this._handleBlockModeKey(e)) return;
        }

        // === No block selected: Arrow selects first/last page-level block ===
        if (!this.selectedBlockUid) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const allBlocks = document.querySelectorAll('[data-block-uid]');
            const pageBlocks = Array.from(allBlocks).filter(el =>
              !el.parentElement?.closest('[data-block-uid]'),
            );
            if (pageBlocks.length === 0) return;
            e.preventDefault();
            this.editMode = 'text';
            this.selectBlock(e.key === 'ArrowDown' ? pageBlocks[0] : pageBlocks[pageBlocks.length - 1]);
          }
          return;
        }

        // === Text mode on non-editable block (no field to focus): use same
        // edge navigation as text mode at field boundary ===
        if (this.editMode === 'text' &&
            ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          const blockEl = this.queryBlockElement(this.selectedBlockUid);
          if (blockEl) {
            e.preventDefault();
            this.handleArrowAtEdge(e.key, this.selectedBlockUid, null, blockEl);
            return;
          }
        }

        // === Block mode: structural keys handled immediately ===
        if (this._handleBlockModeKey(e)) return;

        // === Remaining body-focused keys: buffer for text replay ===
        // (keys that arrive on body during block transitions, before new field is ready)
        const isBodyTarget = e.target === document.body || e.target === document.documentElement;
        if (isBodyTarget) {
          log('Buffering body-focused key:', e.key, 'for', this.selectedBlockUid);
          this.eventBuffer.push({
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
          });
          e.preventDefault();
        }
        return;
      }

      // During transforms, the renderer replaces innerHTML which destroys the
      // focused element. Focus falls to document.body, so keystrokes arrive
      // targeting BODY instead of the block. We must also buffer these events,
      // otherwise characters typed during re-render are silently lost.
      const isBodyTarget = e.target === document.body || e.target === document.documentElement;
      if (!isBodyTarget) {
        const targetBlock = e.target.closest?.('[data-block-uid]');
        if (!targetBlock || targetBlock.getAttribute('data-block-uid') !== this.blockedBlockId) {
          if (e.type === 'keydown') {
            log('DEBUG blocker: key', e.key, 'target block mismatch. target:', e.target?.nodeName,
                'closest block:', targetBlock?.getAttribute('data-block-uid'), 'blockedBlockId:', this.blockedBlockId);
          }
          return;
        }
      }

      if (e.type === 'keydown') {
        // Skip modifier-only keys — they don't produce actions on their own
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        // Paste (Cmd+V): read clipboard data now while we have user gesture
        // context, store in buffer entry for replay. The async read completes
        // well before the transform finishes and replay starts.
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
          const entry = { _type: 'paste', html: null };
          this.eventBuffer.push(entry);
          navigator.clipboard.read().then(async (items) => {
            for (const item of items) {
              if (item.types.includes('text/html')) {
                entry.html = await (await item.getType('text/html')).text();
                return;
              }
              if (item.types.includes('text/plain')) {
                entry.html = await (await item.getType('text/plain')).text();
              }
            }
          }).catch(() => {
            navigator.clipboard.readText().then(text => { entry.html = text; }).catch(() => {});
          });
          log('BUFFERED paste with clipboard read, buffer size:', this.eventBuffer.length);
        } else {
          this.eventBuffer.push({
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
          });
          log('BUFFERED keyboard event:', e.key, 'buffer size:', this.eventBuffer.length);
        }
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    document.addEventListener('keydown', this._documentKeyboardBlocker, true);
    document.addEventListener('keypress', this._documentKeyboardBlocker, true);
    document.addEventListener('input', this._documentKeyboardBlocker, true);
    document.addEventListener('beforeinput', this._documentKeyboardBlocker, true);

  }

  setBlockProcessing(blockId, processing = true, requestId = null) {
    log('setBlockProcessing:', { blockId, processing, requestId });

    if (processing) {
      log('BLOCKING input for', blockId);
      // Clear any existing buffer when starting new blocking
      this.eventBuffer = [];
      this.blockedBlockId = blockId;

      this._ensureDocumentKeyboardBlocker();

      // Block pointer events on whole page via injected <style> (survives innerHTML replacement)
      this._setPointerBlocking(true);

      // Store pending transform to match with FORM_DATA for unblocking
      this.pendingTransform = {
        blockId: blockId,
        requestId: requestId,
      };
    } else {
      log('UNBLOCKING input for', blockId);

      // Clear blocked state
      this.blockedBlockId = null;

      // Unblock pointer events
      this._setPointerBlocking(false);

      // Clear pending transform
      this.pendingTransform = null;

      // Mark buffer for replay - actual replay happens after DOM re-render
      // and selection restore in the FORM_DATA handler
      if (this.eventBuffer.length > 0) {
        this.pendingBufferReplay = {
          blockId,
          buffer: [...this.eventBuffer],
        };
        this.eventBuffer = [];
        log('Marked', this.pendingBufferReplay.buffer.length, 'events for replay after DOM ready');
      }
    }
  }

  /**
   * Replays buffered events and unblocks input after a transform completes.
   * This is the safe sequence: prepare buffer → replay → unblock
   * Called from FORM_DATA handler after DOM is updated.
   */
  replayBufferAndUnblock(context = '') {
    if (!this.pendingTransform) {
      log('[HYDRA-DEBUG] replayBufferAndUnblock: no pendingTransform, returning');
      return;
    }

    const { blockId, requestId: originalRequestId } = this.pendingTransform;
    log('[HYDRA-DEBUG] replayBufferAndUnblock:', { blockId, requestId: originalRequestId, bufferLen: this.eventBuffer.length, remainderLen: this._replayRemainder?.length || 0, context });
    const editEl = this.queryBlockElement(blockId)?.querySelector('[data-edit-text]') || this.queryBlockElement(blockId);
    if (editEl) log('[HYDRA-DEBUG] replayBufferAndUnblock DOM:', editEl.innerHTML?.substring(0, 200));

    // Prepare buffer for replay. Include any remainder from a previous replay
    // that was interrupted by a transform (e.g. Enter→split mid-replay).
    const remainder = this._replayRemainder || [];
    this._replayRemainder = null;

    if (remainder.length > 0 || this.eventBuffer.length > 0) {
      this.pendingBufferReplay = {
        blockId,
        buffer: [...remainder, ...this.eventBuffer],
      };
      this.eventBuffer = [];
      log('Prepared', this.pendingBufferReplay.buffer.length, 'events for replay',
          remainder.length ? `(${remainder.length} from previous cycle)` : '');
    }

    // Replay buffered events (may send new format request with new requestId)
    this.replayBufferedEvents();

    // Only unblock if replay didn't start a new transform (check if requestId changed)
    const hasNewPendingTransform = this.pendingTransform?.requestId &&
                                    this.pendingTransform.requestId !== originalRequestId;
    if (!hasNewPendingTransform) {
      // Unblock AFTER replay to prevent keystrokes arriving in the gap
      log('Unblocking input for', blockId, '- after replay' + (context ? ` (${context})` : ''));
      this.setBlockProcessing(blockId, false);
    } else {
      log('Skipping unblock - new transform pending:', this.pendingTransform.requestId);
    }
  }

  /**
   * Replays buffered keyboard events after DOM is ready.
   * Called after selection is restored following a transform.
   */
  replayBufferedEvents(retryCount = 0) {
    if (!this.pendingBufferReplay) {
      return;
    }

    const { blockId, buffer } = this.pendingBufferReplay;

    log('Replaying', buffer.length, 'buffered events, retry:', retryCount);

    // Re-query editable field in case DOM was re-rendered
    const currentBlock = this.queryBlockElement(blockId);
    const currentEditable = currentBlock ? this.getOwnFirstEditableField(currentBlock) : null;
    if (!currentEditable) {
      // Retry a few times with RAF to wait for Vue/Nuxt re-render
      if (retryCount < 5) {
        requestAnimationFrame(() => this.replayBufferedEvents(retryCount + 1));
        return;
      }
      console.warn('[HYDRA] Cannot replay buffer - editable field not found after retries');
      this.pendingBufferReplay = null;
      return;
    }

    this.pendingBufferReplay = null;

    // Ensure field is focused before replay — sel.modify (Home/End) and
    // execCommand (Delete/Backspace) require focus to work correctly.
    if (currentEditable &&
        document.activeElement !== currentEditable &&
        !currentEditable.contains(document.activeElement)) {
      currentEditable.focus({ preventScroll: true });
    }

    // Clear blockedBlockId so the capture-phase blocker doesn't interfere;
    // if a replayed event starts a new transform, blockedBlockId gets re-set.
    const savedBlockedId = this.blockedBlockId;
    this.blockedBlockId = null;

    for (let i = 0; i < buffer.length; i++) {
      // A replayed event started a new transform — save remainder for next cycle
      if (this.blockedBlockId) {
        this._replayRemainder = buffer.slice(i);
        log('Replay interrupted by transform, saved', this._replayRemainder.length, 'events for next cycle');
        break;
      }

      const evt = buffer[i];
      log('Replaying buffered key:', evt.key || evt._type, { ctrl: evt.ctrlKey, meta: evt.metaKey, shift: evt.shiftKey });

      this.replayOneKey(blockId, evt, currentEditable);
    }

    // Restore blockedBlockId if no replayed event started a new transform.
    // replayBufferAndUnblock will then unblock normally.
    if (!this.blockedBlockId) {
      this.blockedBlockId = savedBlockedId;
    }
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Whitespace & Zero-Width Space (ZWS) Strategy
  //
  // BACKGROUND — CSS Whitespace Collapsing in Contenteditable
  //
  //   Under `white-space: normal` (the default), the CSS rendering engine
  //   collapses whitespace in two phases:
  //     Phase I:  Consecutive spaces/tabs collapse to a single space.
  //     Phase II: Spaces at the start and end of each line are trimmed.
  //
  //   A text node containing ONLY collapsible whitespace (e.g. " " inside an
  //   otherwise-empty <p>) gets fully trimmed — it exists in the DOM but has
  //   NO CSS layout box (zero rendered width/height).
  //
  //   The browser's editing engine positions the caret based on rendered layout,
  //   not the raw DOM. With no layout box, there is no caret position. When the
  //   user types, the browser creates a new text node at the nearest valid
  //   insertion point — typically on the parent element, OUTSIDE the intended
  //   Slate node structure. Text "leaks" out of <p data-node-id> elements.
  //
  //   However, if the whitespace text node is adjacent to visible content in the
  //   same inline formatting context (e.g. a space between "Hello" and "world"),
  //   it collapses to a single rendered space but STILL HAS a layout position.
  //   The browser can insert into it fine.
  //
  //   References:
  //     CSS Text Module Level 4 §4 — https://drafts.csswg.org/css-text-4/
  //     MDN "How whitespace is handled" — https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace
  //     Mozilla Bug 681626 — inconsistent insertion point with trailing space
  //     Slate-react string.tsx — uses U+FEFF for empty text nodes, void elements,
  //       and inline edges: https://github.com/ianstormtaylor/slate/blob/main/packages/slate-react/src/components/string.tsx
  //     ProseMirror cursorWrapper — uses U+FEFF for mark state during typing:
  //       https://discuss.prosemirror.net/t/what-does-the-cursorwrapper-solve/1892
  //     Tiptap white-space: pre-wrap — https://github.com/ueberdosis/tiptap/issues/2265
  //
  // ALTERNATIVE CONSIDERED — white-space: pre-wrap
  //
  //   Tiptap and Slate-react set `white-space: pre-wrap` on contenteditable
  //   elements, which preserves all whitespace and eliminates this problem
  //   entirely. We can't do this because the iframe renders the frontend's
  //   actual theme (Nuxt/Vue). `pre-wrap` would make Vue template whitespace
  //   artifacts (newlines/indentation between tags like "\n  ") visible during
  //   editing, causing layout differences between edit mode and published view.
  //
  // OUR APPROACH — ZWS Characters + Whitespace Correction
  //
  //   We handle three distinct whitespace problems:
  //
  //   Problem 1: Template whitespace (cursor lands on "\n  " between Vue tags)
  //     → correctInvalidWhitespaceSelection() moves cursor to valid position
  //     → isOnInvalidWhitespace() detects these nodes
  //     → getValidPositionForWhitespace() finds nearest valid text position
  //
  //   Problem 2: Empty element whitespace (Nuxt renders <p> </p> for empty blocks)
  //     → ensureValidInsertionTarget() replaces artifact space with U+FEFF (BOM)
  //       so the text node has a layout box and the browser can insert into it
  //     → Only fires when ALL data-node-id ancestors are empty. If any ancestor
  //       has visible content, the whitespace has layout and needs no fix.
  //
  //   Problem 3: Prospective formatting (user toggles bold/italic with no selection)
  //     When the user presses Ctrl+B without a selection, Slate creates an empty
  //     inline node: <strong>{ text: '' }</strong>. The frontend renders this as
  //     an empty <strong> element. The browser can't position a caret inside an
  //     empty element, so we insert a BOM text node for cursor placement.
  //
  //     Flow:
  //       1. Ctrl+B → sendTransformRequest('format', { format: 'strong' })
  //       2. Admin applies Slate transform → sends FORM_DATA with empty inline
  //       3. Frontend re-renders → empty <strong data-node-id="X"></strong>
  //       4. restoreSlateSelection → ensureZwsPosition() creates BOM text node
  //          inside the empty <strong> and positions cursor after it
  //       5. this.prospectiveInlineElement = the <strong> element (tracked for
  //          Chrome workaround where cursor escapes the inline)
  //       6. User types → characters go inside <strong> → bold text
  //       7. On navigation keys, prospectiveInlineElement is cleared
  //
  //     Critical interaction with Problem 2:
  //       After typing in a prospective inline and toggling format again, the
  //       user may type a space that ends up in a NEW prospective inline (e.g.
  //       <strong data-node-id="0.3"> </strong>). This space is user content,
  //       not an artifact. ensureValidInsertionTarget must NOT replace it — the
  //       walk-up-all-ancestors check detects that the parent <p> has content
  //       ("Hello bold normal") and skips the replacement.
  //
  //   ZWS lifecycle — adding:
  //     ensureValidInsertionTarget()  — BOM in empty-block artifact whitespace
  //     ensureZwsPosition()           — BOM in/around inline elements for cursor
  //                                     positioning after format operations
  //                                     (in restoreSlateSelection)
  //     getValidPositionForWhitespace() — BOM in empty elements during cursor
  //                                       correction
  //     beforeinput handler            — BOM to keep text nodes alive when user
  //                                      deletes the last real character
  //
  //   ZWS lifecycle — stripping:
  //     stripZeroWidthSpaces()         — strips from text strings during
  //                                      serialization, offset calculation
  //     stripZeroWidthSpacesFromDOM()  — strips from DOM text nodes that have
  //                                      other content (not ZWS-only nodes)
  //     Copy/cut handlers              — strips before writing to clipboard
  //     Frontend re-render             — FORM_DATA triggers re-render which
  //                                      naturally replaces ZWS-containing nodes
  //     NOTE: ZWS is NOT stripped during typing to avoid cursor corruption.
  //
  //   ZWS-aware offset calculation:
  //     findPositionByVisibleOffset()  — skips ZWS when counting char offsets
  //     findTextNodeInChild()          — positions cursor AFTER ZWS in ZWS-only
  //                                      nodes
  //     calculateNormalizedOffset()    — uses range.toString() which excludes
  //                                      collapsed whitespace
  //
  // CRITICAL TESTS
  //
  //   tests-playwright/mock-parent/navigation-keys.spec.ts:
  //     "Typing into whitespace-only text node stays inside data-node-id element"
  //       — Verifies ensureValidInsertionTarget prevents text leaking outside <p>
  //         in empty paragraphs (the core browser bug this code works around)
  //
  //   tests-playwright/integration/inline-editing-formatting.spec.ts:
  //     "prospective formatting: toggle on, type, off, type, on again does not
  //      double text"
  //       — Verifies user-typed spaces between format toggles are preserved
  //         (the bug where ensureValidInsertionTarget destroyed user spaces)
  //
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Checks if a node is on invalid whitespace (text node outside any data-node-id element).
   * This happens when cursor lands on template whitespace in Vue/Nuxt templates.
   * Part of "Problem 1" in the whitespace strategy above.
   *
   * @param {Node} node - The DOM node to check
   * @returns {boolean} True if the node is on invalid whitespace
   */
  isOnInvalidWhitespace(node) {
    if (!node) return false;

    // Handle ELEMENT nodes - cursor can land on wrapper DIV when clicking at edge of block
    if (node.nodeType === Node.ELEMENT_NODE) {
      // If this element has a valid data-node-id, cursor position is valid
      if (node.hasAttribute?.('data-node-id') && isValidNodeId(node.getAttribute('data-node-id'))) {
        return false;
      }

      // If this element is an editable field itself, check if it has data-node-id children
      // If so, cursor should be inside those children, not on the container
      if (node.hasAttribute?.('data-edit-text')) {
        const hasNodeIdChildren = node.querySelector?.('[data-node-id]');
        if (hasNodeIdChildren) {
          log('isOnInvalidWhitespace: cursor on edit-text container but has nodeId children, needs correction');
          return true;
        }
        return false;
      }

      // Check if this element is inside a block that has slate fields
      const blockElement = node.closest?.('[data-block-uid]');
      if (!blockElement) {
        return false;
      }

      // Check if there's any data-node-id element inside the block
      // (could be nested or on same element as edit-text)
      const nodeIdElement = blockElement.querySelector('[data-node-id]');
      if (nodeIdElement && !node.closest?.('[data-node-id]')) {
        // Element is inside a block with slate content but outside data-node-id
        log('isOnInvalidWhitespace: element inside block but outside data-node-id, tagName:', node.tagName);
        return true;
      }

      return false;
    }

    // Only TEXT nodes can be "invalid whitespace" (Vue template artifacts like "\n  ")
    if (node.nodeType !== Node.TEXT_NODE) {
      return false;
    }

    // BOM/ZWS-only text nodes inside wrapper elements without data-node-id
    // are invalid. This catches nextjs BOM spans (<span>﻿</span>) inside a
    // valid data-node-id ancestor. But ZWS nodes that are DIRECT children
    // of a data-node-id element (cursor exit positioning) are valid.
    const visibleText = node.textContent?.replace(/[\uFEFF\u200B\s]/g, '');
    if (visibleText === '' && node.parentElement && !node.parentElement.hasAttribute?.('data-node-id')) {
      return true;
    }

    // Find the editable field container
    let editableField = null;
    let current = node.parentNode;
    while (current) {
      if (current.nodeType === Node.ELEMENT_NODE && current.hasAttribute?.('data-edit-text')) {
        editableField = current;
        break;
      }
      current = current.parentNode;
    }

    // Not inside an editable field at all
    if (!editableField) {
      return false;
    }

    // If the editable field has no data-node-id elements, it's not Slate-rendered
    // (e.g., Nuxt simple HTML) - don't try to correct whitespace
    if (!editableField.querySelector('[data-node-id]')) {
      return false;
    }

    // Walk up from node to find if there's a data-node-id ancestor (including editableField itself)
    current = node.parentNode;
    while (current) {
      // If we hit an element with a valid data-node-id, cursor is valid
      if (current.nodeType === Node.ELEMENT_NODE && current.hasAttribute?.('data-node-id')
          && isValidNodeId(current.getAttribute('data-node-id'))) {
        return false;
      }
      // Stop at editable field boundary
      if (current === editableField) {
        break;
      }
      current = current.parentNode;
    }

    // Reached editable field without finding data-node-id - cursor is on whitespace
    return true;
  }

  /**
   * Gets the valid position for a node on invalid whitespace.
   * Whitespace can only be before first block or after last block.
   *
   * @param {Node} node - The text node that's on invalid whitespace
   * @param {boolean} isRangeEnd - If true, this is the end of a range selection (return end position)
   * @returns {{textNode: Node, offset: number}|null} Target position, or null if not found
   */
  getValidPositionForWhitespace(node, isRangeEnd = false) {
    if (!node) return null;

    log('getValidPositionForWhitespace: node=', node.nodeType === Node.TEXT_NODE ? 'TEXT' : node.tagName, 'content=', JSON.stringify(node.textContent?.substring(0, 20)), 'isRangeEnd=', isRangeEnd);

    // Find the editable field container
    let container = null;

    // For element nodes, check if the node itself is the container
    if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute?.('data-edit-text')) {
      container = node;
    }
    // Check if we can find editable field by walking up
    if (!container) {
      let current = node.parentNode;
      while (current && !current.hasAttribute?.('data-edit-text')) {
        current = current.parentNode;
      }
      container = current;
    }
    // For element nodes (like block wrapper), also check inside for editable field
    if (!container && node.nodeType === Node.ELEMENT_NODE) {
      container = node.querySelector?.('[data-edit-text]');
    }

    if (!container) {
      log('getValidPositionForWhitespace: no container found');
      return null;
    }

    // Get first and last elements with valid data-node-id
    // Check if container itself has data-node-id first, then look for descendants
    const containerHasValidId = container.hasAttribute?.('data-node-id') && isValidNodeId(container.getAttribute('data-node-id'));
    const allDescendants = [...container.querySelectorAll('[data-node-id]')].filter(el => isValidNodeId(el.getAttribute('data-node-id')));
    const firstNodeIdEl = containerHasValidId
      ? container
      : allDescendants[0] || null;
    const allNodeIdEls = containerHasValidId
      ? [container, ...allDescendants]
      : allDescendants;
    const lastNodeIdEl = allNodeIdEls[allNodeIdEls.length - 1];

    if (!firstNodeIdEl) {
      log('getValidPositionForWhitespace: no firstNodeIdEl found');
      return null;
    }

    // If isRangeEnd is specified, use that to determine position (for serializing range selections)
    // Otherwise, determine based on DOM position of the whitespace
    let returnEndPosition = isRangeEnd;
    if (!isRangeEnd) {
      // Determine if whitespace is before first or after last by comparing DOM positions
      const position = node.compareDocumentPosition(firstNodeIdEl);
      const isBeforeFirst = position & Node.DOCUMENT_POSITION_FOLLOWING;
      returnEndPosition = !isBeforeFirst; // After content = return end position
      log('getValidPositionForWhitespace: isBeforeFirst=', isBeforeFirst, 'firstNodeIdEl=', firstNodeIdEl.tagName, 'nodeId=', firstNodeIdEl.getAttribute('data-node-id'));
    }

    if (!returnEndPosition) {
      // Start position → start of first text node
      const walker = document.createTreeWalker(firstNodeIdEl, NodeFilter.SHOW_TEXT, null, false);
      let textNode = walker.nextNode();

      // If no text node exists, create one with ZWS for cursor positioning
      if (!textNode) {
        textNode = document.createTextNode('\uFEFF');
        firstNodeIdEl.appendChild(textNode);
        log('getValidPositionForWhitespace: created ZWS text node in empty element');
        return { textNode, offset: 1 }; // Position after ZWS
      }

      // If text node is empty, prepend ZWS for cursor positioning
      // This ensures browser types into this node rather than creating a new one
      const visibleText = textNode.textContent.replace(/[\uFEFF\u200B]/g, '');
      if (visibleText === '') {
        if (!textNode.textContent.includes('\uFEFF')) {
          textNode.textContent = '\uFEFF' + textNode.textContent;
          log('getValidPositionForWhitespace: prepended ZWS to empty text node');
        }
        return { textNode, offset: 1 }; // Position after ZWS
      }

      log('getValidPositionForWhitespace: returning start of first text node:', textNode?.textContent?.substring(0, 20));
      return { textNode, offset: 0 };
    } else {
      // End position → end of last text node
      const walker = document.createTreeWalker(lastNodeIdEl, NodeFilter.SHOW_TEXT, null, false);
      let lastText = null;
      while (walker.nextNode()) {
        lastText = walker.currentNode;
      }
      log('getValidPositionForWhitespace: returning end of last text node:', lastText?.textContent?.substring(0, 20), 'offset:', lastText?.textContent?.length);
      return lastText ? { textNode: lastText, offset: lastText.textContent.length } : null;
    }
  }

  /**
   * Validates a position and returns a corrected position if on invalid whitespace.
   * @param {Node} node - The node containing the position
   * @param {number} offset - The offset within the node
   * @returns {{node: Node, offset: number}} The validated (possibly corrected) position
   */
  getValidatedPosition(node, offset) {
    if (this.isOnInvalidWhitespace(node)) {
      const validPos = this.getValidPositionForWhitespace(node);
      if (validPos) {
        return { node: validPos.textNode, offset: validPos.offset };
      }
    }
    return { node, offset };
  }

  /**
   * Cross-browser caret-at-point. Chromium/WebKit implement the non-standard
   * `document.caretRangeFromPoint` directly; Firefox only implements the W3C
   * `document.caretPositionFromPoint` which returns a CaretPosition
   * ({offsetNode, offset}). Wrap both so callers always get a collapsed Range.
   *
   * @param {number} x - Viewport X coordinate
   * @param {number} y - Viewport Y coordinate
   * @returns {Range|null} Collapsed Range at (x,y), or null if no API available
   */
  caretRangeFromPoint(x, y) {
    if (typeof document.caretRangeFromPoint === 'function') {
      return document.caretRangeFromPoint(x, y);
    }
    if (typeof document.caretPositionFromPoint === 'function') {
      const pos = document.caretPositionFromPoint(x, y);
      if (!pos || !pos.offsetNode) return null;
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
    return null;
  }

  /**
   * Corrects cursor/selection if it's on invalid whitespace.
   * For collapsed selections, moves cursor to nearest valid position.
   * For range selections, corrects each end independently.
   *
   * @returns {boolean} True if selection was corrected
   */
  correctInvalidWhitespaceSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return false;

    const range = selection.getRangeAt(0);
    const anchorOnWhitespace = this.isOnInvalidWhitespace(range.startContainer);
    const focusOnWhitespace = this.isOnInvalidWhitespace(range.endContainer);

    if (!anchorOnWhitespace && !focusOnWhitespace) return false;

    // Only log when actually correcting
    log('correctInvalidWhitespaceSelection: correcting cursor on invalid whitespace', {
      anchorOnWhitespace,
      focusOnWhitespace,
      anchorContent: range.startContainer.textContent?.substring(0, 20),
      anchorParent: range.startContainer.parentElement?.tagName,
    });

    // Disconnect observer during DOM modification — getValidatedPosition may create
    // ZWS text nodes, and we must not let the observer treat those as user edits.
    // Must disconnect (not just set a flag) because MutationObserver fires async.
    this._suppressObserver();

    // Get corrected positions using shared helper.
    // For range selections, if both endpoints are on invalid whitespace,
    // move anchor to start of first visible text and focus to end of last
    // visible text — otherwise both resolve to the same position and the
    // range collapses.
    let anchorPos, focusPos;
    if (!range.collapsed && anchorOnWhitespace && focusOnWhitespace) {
      const editField = range.startContainer.parentElement?.closest('[data-edit-text], [contenteditable="true"]');
      if (editField) {
        const walker = document.createTreeWalker(editField, NodeFilter.SHOW_TEXT);
        let firstVisible = null;
        let lastVisible = null;
        let node;
        while ((node = walker.nextNode())) {
          const vis = node.textContent?.replace(/[\uFEFF\u200B\s]/g, '');
          if (vis) {
            if (!firstVisible) firstVisible = node;
            lastVisible = node;
          }
        }
        anchorPos = firstVisible ? { node: firstVisible, offset: 0 } : this.getValidatedPosition(range.startContainer, range.startOffset);
        focusPos = lastVisible ? { node: lastVisible, offset: lastVisible.textContent.length } : this.getValidatedPosition(range.endContainer, range.endOffset);
      } else {
        anchorPos = this.getValidatedPosition(range.startContainer, range.startOffset);
        focusPos = this.getValidatedPosition(range.endContainer, range.endOffset);
      }
    } else {
      anchorPos = this.getValidatedPosition(range.startContainer, range.startOffset);
      focusPos = this.getValidatedPosition(range.endContainer, range.endOffset);
    }

    log('correctInvalidWhitespaceSelection: anchorPos:', anchorPos, 'focusPos:', focusPos);

    if (!anchorPos.node || !focusPos.node) {
      this._resumeObserver();
      return false;
    }

    // Check if corrected position is same as current - if so, don't update (avoids infinite loop)
    const anchorSame = anchorPos.node === range.startContainer && anchorPos.offset === range.startOffset;
    const focusSame = focusPos.node === range.endContainer && focusPos.offset === range.endOffset;
    if (anchorSame && focusSame) {
      log('correctInvalidWhitespaceSelection: corrected position same as current, skipping to avoid loop');
      this._resumeObserver();
      return false;
    }

    // Set corrected selection
    const newRange = document.createRange();
    newRange.setStart(anchorPos.node, anchorPos.offset);
    newRange.setEnd(focusPos.node, focusPos.offset);
    selection.removeAllRanges();
    selection.addRange(newRange);

    this._resumeObserver();
    log('correctInvalidWhitespaceSelection: Corrected selection');
    return true;
  }

  /**
   * Handles Problem 2 in the ZWS strategy above.
   *
   * When a text node contains only collapsible whitespace and the entire
   * container tree is empty (no visible content in any data-node-id ancestor),
   * the whitespace is a rendering artifact (e.g. Nuxt's <p> </p>). The CSS
   * engine strips its layout box, so the browser can't position a caret or
   * insert typed characters into it — it creates a new text node on the parent
   * instead, leaking text outside the Slate node structure.
   *
   * Fix: replace the artifact whitespace with U+FEFF (BOM), giving the text
   * node a layout box. Like Slate-react's string.tsx approach.
   *
   * If ANY data-node-id ancestor has visible content, the whitespace has a
   * layout position (it's adjacent to rendered content) and the browser can
   * insert into it fine — we leave it alone. This prevents destroying
   * user-typed spaces in prospective formatting elements (Problem 3).
   *
   * @returns {boolean} True if the text node was fixed
   */
  ensureValidInsertionTarget() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return false;

    const node = selection.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;

    // Only fix whitespace-only text nodes
    const text = node.textContent;
    if (!text || text.trim() !== '' || /[\uFEFF\u200B]/.test(text)) return false;

    // Walk up through ALL data-node-id ancestors. If any ancestor has visible
    // content, this whitespace has a CSS layout box (it's between rendered
    // content) and the browser can insert into it fine — don't touch it.
    // Only replace with BOM when the entire container tree is empty, meaning
    // the whitespace is a rendering artifact (e.g. Nuxt's <p> </p>) with no
    // layout box that the browser can't insert into.
    let current = node.parentNode;
    let foundDataNodeId = false;
    while (current) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        // Check data-node-id BEFORE data-edit-text because elements
        // can have both attrs (e.g. <p data-edit-text="value" data-node-id="0">).
        // We must check the element's content before potentially breaking out.
        if (current.hasAttribute?.('data-node-id') && isValidNodeId(current.getAttribute('data-node-id'))) {
          foundDataNodeId = true;
          const elementText = this.stripZeroWidthSpaces(current.textContent);
          if (elementText.trim() !== '') {
            log('ensureValidInsertionTarget: skipping, ancestor has content:', elementText.substring(0, 30));
            return false;
          }
        }
        if (current.hasAttribute?.('data-edit-text')) {
          // Before giving up, check if the field itself has visible content.
          // A space inside an empty inline (e.g. bold span) is still valid
          // content if the surrounding field has text — the user typed it.
          const fieldText = this.stripZeroWidthSpaces(current.textContent);
          if (fieldText.trim() !== '') {
            log('ensureValidInsertionTarget: skipping, field has content:', fieldText.substring(0, 30));
            return false;
          }
          break;
        }
      }
      current = current.parentNode;
    }

    if (!foundDataNodeId) return false;

    // All ancestors are empty — whitespace is a rendering artifact with no
    // CSS layout box. Replace with BOM so the browser has a valid target.
    // Disconnect observer to prevent this DOM change from being treated as user typing.
    this._suppressObserver();
    node.textContent = '\uFEFF';
    const range = selection.getRangeAt(0);
    range.setStart(node, 1);
    range.setEnd(node, 1);
    selection.removeAllRanges();
    selection.addRange(range);
    this._resumeObserver();
    log('ensureValidInsertionTarget: replaced artifact whitespace with FEFF');

    return false;
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Selection Serialization - Convert DOM selection to Slate selection
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Serializes the current DOM selection to Slate selection format.
   * Converts browser Selection/Range into Slate's {anchor, focus} format.
   *
   * @returns {Object|null} Slate selection with anchor and focus points, or null if no selection
   */
  serializeSelection() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) {
      // No live DOM selection - use savedSelection if available
      // This happens when iframe loses focus (e.g., toolbar button click)
      if (this.savedSelection) {
        log('serializeSelection: using savedSelection (no live selection)');
        return this.savedSelection;
      }
      return null;
    }

    const range = selection.getRangeAt(0);

    // Get anchor and focus points
    const anchorNode = range.startContainer;
    const focusNode = range.endContainer;

    // Serialize both points
    const anchor = this.serializePoint(anchorNode, range.startOffset);
    const focus = this.serializePoint(focusNode, range.endOffset);

    if (!anchor || !focus) {
      // Only warn if this is a Slate field (has data-node-id elements)
      // Non-Slate fields (simple text) can't be serialized and that's expected
      let editableField = range.commonAncestorContainer;
      while (editableField && !editableField.hasAttribute?.('data-edit-text')) {
        editableField = editableField.parentNode;
      }
      if (editableField && editableField.querySelector('[data-node-id]')) {
        console.warn('[HYDRA] Could not serialize selection points in Slate field');
      }
      return null;
    }

    // Validate the selection paths against the actual Slate value
    // Log detailed debugging info if invalid, but still send the path so the error is visible
    const validationResult = this.validateSelectionPaths(anchor, focus, range.commonAncestorContainer);
    if (!validationResult.valid) {
      console.error('[HYDRA] Invalid selection path detected! This will cause a Slate error.\n\n' +
        `Anchor path: [${anchor.path.join(', ')}], offset: ${anchor.offset}\n` +
        `Focus path: [${focus.path.join(', ')}], offset: ${focus.offset}\n\n` +
        `Error: ${validationResult.error}\n\n` +
        `DOM structure:\n${validationResult.domStructure}\n\n` +
        `Slate structure:\n${validationResult.slateStructure}`
      );
      // Still return the selection so it blows up visibly in Volto
    }

    return { anchor, focus };
  }

  /**
   * Validates that selection paths exist in the Slate structure.
   * Returns detailed debugging info if invalid.
   */
  validateSelectionPaths(anchor, focus, commonAncestor) {
    // Find the editable field container and block
    let editableField = commonAncestor;
    while (editableField && !editableField.hasAttribute?.('data-edit-text')) {
      editableField = editableField.parentNode;
    }
    if (!editableField) {
      return { valid: true }; // Can't validate without editable field
    }

    // Find the block element
    let blockElement = editableField;
    while (blockElement && !blockElement.hasAttribute?.('data-block-uid')) {
      blockElement = blockElement.parentNode;
    }
    if (!blockElement) {
      return { valid: true }; // Can't validate without block
    }

    const blockUid = blockElement.getAttribute('data-block-uid');
    const fieldName = editableField.getAttribute('data-edit-text');
    const blockData = this.getBlockData(blockUid);

    if (!blockData || !getFieldValue(blockData, fieldName)) {
      return { valid: true }; // Can't validate without Slate value
    }

    const slateValue = getFieldValue(blockData, fieldName);
    if (!Array.isArray(slateValue)) {
      return { valid: true }; // Not a Slate field
    }

    // Validate anchor path
    const anchorValid = this.isPathValidInSlate(anchor.path, slateValue);
    const focusValid = this.isPathValidInSlate(focus.path, slateValue);

    if (anchorValid && focusValid) {
      return { valid: true };
    }

    // Build DOM structure for debugging
    const domStructure = this.buildDomStructureForDebug(editableField);
    const slateStructure = JSON.stringify(slateValue, null, 2).substring(0, 500);

    return {
      valid: false,
      error: !anchorValid
        ? `Anchor path [${anchor.path.join(', ')}] not found in Slate`
        : `Focus path [${focus.path.join(', ')}] not found in Slate`,
      domStructure,
      slateStructure,
    };
  }

  /**
   * Checks if a path exists in a Slate value
   */
  isPathValidInSlate(path, value) {
    let current = { children: value };
    for (let i = 0; i < path.length; i++) {
      const index = path[i];
      if (!current.children || !Array.isArray(current.children)) {
        return false;
      }
      if (index < 0 || index >= current.children.length) {
        return false;
      }
      current = current.children[index];
    }
    return true;
  }

  /**
   * Builds a string representation of the DOM structure for debugging
   */
  buildDomStructureForDebug(element, depth = 0) {
    const indent = '  '.repeat(depth);
    let result = '';

    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent.substring(0, 30);
        result += `${indent}TEXT: "${text}"${child.textContent.length > 30 ? '...' : ''}\n`;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        const nodeId = child.getAttribute('data-node-id');
        const nodeIdAttr = nodeId ? ` data-node-id="${nodeId}"` : '';
        result += `${indent}<${tag}${nodeIdAttr}>\n`;
        if (depth < 3) {
          result += this.buildDomStructureForDebug(child, depth + 1);
        }
      } else if (child.nodeType === Node.COMMENT_NODE) {
        result += `${indent}<!-- comment -->\n`;
      }
    }
    return result;
  }

  /**
   * Serializes a single point (anchor or focus) to Slate format.
   *
   * @param {Node} node - DOM node
   * @param {number} offset - Character offset within the node
   * @returns {Object|null} Slate point with path and offset, or null if invalid
   */
  serializePoint(node, offset) {
    // Find the text node (might be element node in some cases)
    let textNode = node;
    let textOffset = offset;

    if (node.nodeType === Node.ELEMENT_NODE) {
      // Element node with offset means "before/after child at offset"
      // For Ctrl+A: anchor is (element, 0), focus is (element, childCount)

      if (offset === 0) {
        // Offset 0 = start of first child
        textNode = node.firstChild;
        textOffset = 0;
      } else {
        // Offset N = after Nth child, so we want end of Nth child
        // childNodes[offset-1] is the last child included in selection
        const childNode = node.childNodes[offset - 1];
        if (childNode) {
          if (childNode.nodeType === Node.TEXT_NODE) {
            textNode = childNode;
            textOffset = childNode.textContent.length;
          } else if (childNode.nodeType === Node.ELEMENT_NODE) {
            // Recurse into element to find last text node
            textNode = this.getLastTextNode(childNode);
            textOffset = textNode ? textNode.textContent.length : 0;
          }
        } else {
          // Fallback to first child if offset is invalid
          textNode = node.firstChild;
          textOffset = 0;
        }
      }
    }

    // Handle empty element case (no text nodes) - cursor is at start of element
    if (!textNode && node.nodeType === Node.ELEMENT_NODE) {
      // Find the element's path by walking up from the element itself
      const elementPath = this.getElementPath(node);
      if (elementPath) {
        // For empty paragraph, selection should be at [0, 0] offset 0
        // (paragraph path + text child index 0)
        return { path: [...elementPath, 0], offset: 0 };
      }
      return null;
    }

    // Walk up to find the path through the Slate structure
    let path = this.getNodePath(textNode);
    if (!path) {
      // Text node might be a Vue template artifact (whitespace text node outside data-node-id)
      // Use getValidPositionForWhitespace to find the first/last valid text node
      // isRangeEnd=true for end position (offset > 0), false for start (offset === 0)
      const isEndPosition = offset > 0;
      const validPos = this.getValidPositionForWhitespace(textNode, isEndPosition);
      if (validPos) {
        textNode = validPos.textNode;
        textOffset = validPos.offset;
        path = this.getNodePath(textNode);
      }
      if (!path) {
        // getNodePath returns null for non-Slate fields (expected) or missing data-node-id (error logged there)
        return null;
      }
    }

    // Calculate offset using range.toString() for proper whitespace normalization
    // This handles Vue/Nuxt whitespace artifacts that don't match Slate's model
    const normalizedOffset = this.calculateNormalizedOffset(textNode, textOffset);

    return { path, offset: normalizedOffset };
  }

  /**
   * Calculate text offset using range.toString() for whitespace normalization.
   * Finds the start of the current Slate text leaf and measures to cursor.
   */
  calculateNormalizedOffset(textNode, domOffset) {
    const parent = textNode.parentNode;
    if (!parent) return domOffset;

    // Find the start point for measuring - either:
    // 1. End of preceding element with data-node-id (text is after formatted span)
    // 2. Start of parent element with data-node-id (text is inside formatted span)
    // 3. Start of parent if no preceding element (first text in block)

    let startNode = null;
    let startAtEnd = false;

    // First check for preceding sibling with data-node-id (e.g., text after <strong>)
    // This takes priority over parent having data-node-id
    const siblings = Array.from(parent.childNodes);
    const nodeIndex = siblings.indexOf(textNode);

    for (let i = nodeIndex - 1; i >= 0; i--) {
      const sib = siblings[i];
      if (sib.nodeType === Node.ELEMENT_NODE && sib.hasAttribute('data-node-id') && isValidNodeId(sib.getAttribute('data-node-id'))) {
        startNode = sib;
        startAtEnd = true; // Measure from end of preceding element
        break;
      }
    }

    // If no preceding sibling with data-node-id, check if parent has valid data-node-id
    // (text is inside formatted element like <strong>)
    if (!startNode && parent.hasAttribute?.('data-node-id') && isValidNodeId(parent.getAttribute('data-node-id'))) {
      startNode = parent;
      startAtEnd = false; // Measure from start of parent
    }

    // Create range from start point to cursor
    const range = document.createRange();

    if (startNode && startAtEnd) {
      // Measure from end of preceding element
      range.setStartAfter(startNode);
    } else if (startNode) {
      // Measure from start of parent element
      range.setStart(startNode, 0);
    } else {
      // No preceding element - measure from start of parent
      range.setStart(parent, 0);
    }

    range.setEnd(textNode, domOffset);

    // range.toString() normalizes whitespace as the browser renders it
    // Strip ZWS characters since they don't exist in Slate's model
    return this.stripZeroWidthSpaces(range.toString()).length;
  }

  /**
   * Helper to find the last text node within an element
   */
  getLastTextNode(element) {
    if (element.nodeType === Node.TEXT_NODE) {
      return element;
    }

    // Recursively find last text node
    for (let i = element.childNodes.length - 1; i >= 0; i--) {
      const child = element.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        return child;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const result = this.getLastTextNode(child);
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Gets the Slate path for a DOM node by walking up the tree.
   * Uses data-node-id to identify Slate nodes.
   *
   * @param {Node} node - DOM node to find path for
   * @returns {Array|null} Slate path as array of indices, or null if not found
   */
  /**
   * Calculate the Slate index of a node among its siblings.
   * Elements with data-node-id use their ID's last component.
   * Text nodes use the next index after the previous sibling.
   * Empty/whitespace text nodes (Vue artifacts) map to the previous real content.
   */
  getSlateIndexAmongSiblings(node, parent) {
    // For elements with a valid data-node-id, use the index from the ID
    if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-node-id')) {
      const nodeId = node.getAttribute('data-node-id');
      if (isValidNodeId(nodeId)) {
        const parts = nodeId.split('.');
        return parseInt(parts[parts.length - 1], 10);
      }
    }

    // For text nodes (including whitespace), find the preceding element with valid data-node-id
    // The text node's index = (preceding element's last id part) + 1
    // This works regardless of whitespace because all text after an element
    // belongs to the next Slate text leaf
    const siblings = Array.from(parent.childNodes);
    const nodeIndex = siblings.indexOf(node);

    for (let i = nodeIndex - 1; i >= 0; i--) {
      const sib = siblings[i];
      if (sib.nodeType === Node.ELEMENT_NODE && sib.hasAttribute('data-node-id')) {
        const nodeId = sib.getAttribute('data-node-id');
        if (!isValidNodeId(nodeId)) continue;
        const parts = nodeId.split('.');
        return parseInt(parts[parts.length - 1], 10) + 1;
      }
    }

    // No preceding element with node-id - this is the first child (index 0)
    return 0;
  }

  /**
   * Gets the Slate path for an element node (not text node) by checking data-node-id
   * Used when selection is in an empty element with no text children
   *
   * @param {Element} element - DOM element to find path for
   * @returns {Array|null} Slate path as array of indices, or null if not found
   */
  getElementPath(element) {
    // Walk up to find the element with data-node-id
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (current.hasAttribute('data-node-id') && isValidNodeId(current.getAttribute('data-node-id'))) {
        const nodeId = current.getAttribute('data-node-id');
        const parts = nodeId.split('.').map((p) => parseInt(p, 10));
        log('getElementPath: Found node-id', nodeId, '-> path:', parts);
        return parts;
      }
      if (current.hasAttribute('data-edit-text')) {
        // Reached the container without finding a node-id
        // For empty containers, return [0] (first paragraph)
        log('getElementPath: Reached container, returning [0]');
        return [0];
      }
      current = current.parentElement;
    }
    console.warn('[HYDRA] getElementPath: Could not find path for element');
    return null;
  }

  getNodePath(node) {
    const path = [];
    let current = node;

    // Inline elements that wrap text content (used to detect text leaf wrappers)
    const INLINE_WRAPPER_ELEMENTS = [
      'SPAN',
      'STRONG',
      'EM',
      'B',
      'I',
      'U',
      'S',
      'CODE',
      'A',
      'SUB',
      'SUP',
      'MARK',
    ];

    // Helper to check if element is an inline wrapper (using CSS if available)
    const isInlineElement = (el) => {
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        const display = window.getComputedStyle(el).display;
        if (display && display !== '') {
          return display === 'inline' || display === 'inline-block';
        }
      }
      // Fall back to tag name (JSDOM or no CSS)
      return INLINE_WRAPPER_ELEMENTS.includes(el.nodeName);
    };

    // If starting with a text node, calculate its Slate index
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentNode;

      // Check if parent has VALID data-node-id AND is an inline element (span, strong, etc.)
      // Inline elements wrap their text directly, blocks (p, div) may have multiple text children
      // Skip empty or "undefined" nodeId values (from frontends that render undefined as string)
      const parentNodeId = parent.hasAttribute?.('data-node-id')
        ? parent.getAttribute('data-node-id')
        : null;
      const hasValidNodeId =
        isValidNodeId(parentNodeId);
      if (
        hasValidNodeId &&
        parent.nodeName !== 'P' &&
        parent.nodeName !== 'DIV' &&
        !parent.hasAttribute?.('data-edit-text')
      ) {
        // Parse the parent's path from its node ID
        const parts = parentNodeId.split('.').map((p) => parseInt(p, 10));

        // Text node index within the parent element (filtered for Vue artifacts)
        const textIndex = this.getSlateIndexAmongSiblings(node, parent);

        // Build path: parent path + text index
        path.push(...parts, textIndex);
        return path;
      } else {
        // Parent doesn't have nodeId - is it a block element or inline wrapper?
        // Inline wrappers (span, etc.) represent text leaves - don't count text inside
        // Block elements (p, h1-h6, li, etc.) contain multiple children - count text position
        const isWrapper =
          isInlineElement(parent) &&
          !parent.hasAttribute?.('data-edit-text');

        if (isWrapper) {
          // Parent is an inline wrapper without nodeId (like Nuxt spans for text leaves)
          // Don't add textIndex - the wrapper represents the whole text leaf
          // Let the while loop calculate the wrapper's position in the block
          current = parent;
        } else {
          // Parent is a block element - calculate text's Slate index among siblings
          const slateIndex = this.getSlateIndexAmongSiblings(node, parent);
          path.push(slateIndex);
          current = parent;
        }
      }
    }

    // Walk up the DOM tree building the path
    let depth = 0;
    let foundContainer = false;
    let foundNodeIdInWalk = false;
    while (current) {
      const hasEditableField = current.hasAttribute?.('data-edit-text');
      const hasSlateEditor = current.hasAttribute?.('data-slate-editor');

      // Track if we've found an editable container
      if (hasEditableField || hasSlateEditor) {
        foundContainer = true;
      }

      // Check for valid nodeId (skip empty or "undefined" values from frontends)
      const nodeId = current.hasAttribute?.('data-node-id')
        ? current.getAttribute('data-node-id')
        : null;
      const hasValidNodeId =
        isValidNodeId(nodeId);

      // Process current node if it has a valid nodeId
      // Must process BEFORE checking edit-text since element can have both
      if (hasValidNodeId) {
        foundNodeIdInWalk = true;
        // Parse node ID to get path components (e.g., "0.1" -> [0, 1] or "0-1" -> [0, 1])
        const parts = nodeId.split('.').map((p) => parseInt(p, 10));

        // Prepend these path components
        for (let i = parts.length - 1; i >= 0; i--) {
          path.unshift(parts[i]);
        }

        // NodeIds are ABSOLUTE paths - stop after finding the first valid one
        // e.g., nodeId "1-1" means [1, 1], don't continue to add parent's nodeId
        break;
      }

      // Stop if we've reached the editable field container or slate editor (without nodeId)
      if (hasEditableField || hasSlateEditor) {
        break;
      }

      // Element without nodeId - only calculate index for inline wrapper elements
      // that could contain text (span, strong, etc.). Skip void elements (br, img, hr).
      const parent = current.parentNode;
      if (
        parent &&
        current.nodeType === Node.ELEMENT_NODE &&
        INLINE_WRAPPER_ELEMENTS.includes(current.nodeName)
      ) {
        const slateIndex = this.getSlateIndexAmongSiblings(current, parent);
        path.unshift(slateIndex);
      }

      current = parent;
      depth++;
    }

    // Verify we're within an editable container - if not found, continue walking up
    if (!foundContainer && current) {
      let checkNode = current.parentNode;
      while (checkNode) {
        if (
          checkNode.hasAttribute?.('data-edit-text') ||
          checkNode.hasAttribute?.('data-slate-editor')
        ) {
          foundContainer = true;
          break;
        }
        checkNode = checkNode.parentNode;
      }
    }

    // If we didn't find the editable field or slate editor, path is invalid
    if (!current || !foundContainer) {
      console.warn('[HYDRA] getNodePath - no container found, returning null');
      return null;
    }

    // If no nodeId was found, cursor may be on invalid whitespace or DOM is missing data-node-id.
    // Log detailed debug info to help diagnose the issue.
    if (!foundNodeIdInWalk) {
      // Find the editable container for context
      let container = node;
      while (container && !container.hasAttribute?.('data-edit-text')) {
        container = container.parentNode;
      }
      const blockElement = container?.closest?.('[data-block-uid]');
      // owningBlockUid, not the nearest uid element: a field can live on an
      // element standing in for its block (a tab's label sits on the button that
      // reveals the tab). Resolving to the container AROUND it looks the field
      // up in the wrong schema, comes back undefined, and warns that a
      // perfectly well declared field is not registered.
      const blockUid = (container ? this.owningBlockUid(container) : null)
        || blockElement?.getAttribute('data-block-uid')
        || null;
      const fieldName = container?.getAttribute?.('data-edit-text') || null;

      // Skip error for readonly blocks - they don't need selection sync
      if (blockUid && this.isBlockReadonly(blockUid)) {
        return null;
      }

      // Skip error if the field is not contenteditable — the user clicked on a
      // display-only field (e.g. a plain text field not yet activated for editing).
      // The data-node-id warning only matters when the field is actually being edited.
      if (container && container.getAttribute('contenteditable') !== 'true') {
        return null;
      }

      // Check if this field is supposed to be a Slate field
      // Use getFieldType which handles page-level fields (blockUid === null) correctly
      const fieldType = this.getFieldType(blockUid, fieldName);

      // Only skip error for KNOWN non-Slate fields
      // If fieldType is undefined (not registered), assume it could be Slate and show error
      if (fieldType && !this.fieldTypeIsSlate(fieldType)) {
        // This is a known non-Slate text field, just return null without error
        return null;
      }

      // Check if container has ANY data-node-id elements
      // If it does, the cursor is likely on whitespace and serializePoint will recover
      // via getValidPositionForWhitespace - don't show warning yet
      if (container?.querySelector('[data-node-id]')) {
        // Container has valid slate elements - let caller try recovery
        return null;
      }

      // Build DOM path showing which elements are missing data-node-id
      const domPath = [];
      let walkNode = node;
      while (walkNode && walkNode !== current?.parentNode) {
        if (walkNode.nodeType === Node.ELEMENT_NODE) {
          const tag = walkNode.tagName.toLowerCase();
          const nodeId = walkNode.getAttribute?.('data-node-id');
          const classes = walkNode.className ? `.${walkNode.className.split(' ').join('.')}` : '';
          if (nodeId) {
            domPath.unshift(`<${tag}${classes} data-node-id="${nodeId}">`);
          } else {
            domPath.unshift(`<${tag}${classes}> ⚠️ MISSING data-node-id`);
          }
        } else if (walkNode.nodeType === Node.TEXT_NODE) {
          const text = walkNode.textContent?.slice(0, 30) || '';
          domPath.unshift(`"${text}${walkNode.textContent?.length > 30 ? '...' : ''}"`);
        }
        walkNode = walkNode.parentNode;
      }

      // Get container innerHTML for debugging (truncated)
      const containerHtml = container?.innerHTML?.slice(0, 200) || 'N/A';

      const fieldTypeDesc = fieldType
        ? `"${fieldType}" (registered but no data-node-id rendered)`
        : 'undefined — field not registered in blockSchema.properties; if this is a Slate field, add it with widget: "slate"; if plain text, add type: "string"';

      const errorMsg =
        `Block: ${blockUid}, Field: ${fieldName}\nField type: ${fieldTypeDesc}\n\n` +
        'DOM path (text node → container):\n' +
        domPath.map((p, i) => '  '.repeat(i) + p).join('\n') +
        '\n\nContainer HTML:\n' + containerHtml + (container?.innerHTML?.length > 200 ? '...' : '');

      console.error('[HYDRA] Selection sync failed - missing data-node-id\n\n' + errorMsg);

      // Show visible warning overlay in iframe (only once per session)
      if (!this._shownNodeIdWarning) {
        this._shownNodeIdWarning = true;
        this.showDeveloperWarning(
          'Hydra: Missing data-node-id attributes',
          'Selection sync disabled. Your frontend must render data-node-id on Slate elements.\n\n' +
            errorMsg +
            '\n\nSee browser console for details.'
        );
      }
      return null;
    }

    // Ensure path has at least block index
    if (path.length === 0) {
      console.warn('[HYDRA] getNodePath - empty path, defaulting to [0, 0]');
      return [0, 0]; // Default to first block, first text
    }

    return path;
  }

  /**
   * Restores contenteditable attributes on editable fields within a block.
   * This is needed after renderer updates that may have replaced DOM elements.
   *
   * @param {HTMLElement} blockElement - The block element to restore contenteditable on
   * @param {string} caller - The caller for debugging (e.g., 'selectBlock', 'FORM_DATA')
   */
  restoreContentEditableOnFields(blockElement, caller = 'unknown') {
    // In block mode, don't set contenteditable on any fields
    if (this.editMode === 'block') {
      log(`restoreContentEditableOnFields: skipped (editMode=block) caller=${caller}`);
      return;
    }

    // Get blockUid from the element - don't rely on this.selectedBlockUid as it may not be set yet
    const blockUid = blockElement.getAttribute('data-block-uid');

    // If block is readonly, remove contenteditable from all its editable fields
    if (blockUid && this.isBlockReadonly(blockUid)) {
      const editableFields = blockElement.querySelectorAll('[data-edit-text][contenteditable="true"]');
      editableFields.forEach((field) => {
        field.removeAttribute('contenteditable');
      });
      log(`restoreContentEditableOnFields called from ${caller}: block ${blockUid} is readonly, removed contenteditable`);
      return;
    }

    // For multi-element blocks, collect fields from ALL elements with this UID
    const editableFields = [];

    if (blockUid) {
      // Block-level field - use collectBlockFields to gather from all elements with this UID
      this.collectBlockFields(blockElement, 'data-edit-text',
        (el) => { editableFields.push(el); });
    } else {
      // Page-level field (no blockUid) - process the element directly
      // The element itself has data-edit-text (e.g., #page-title)
      if (blockElement.hasAttribute('data-edit-text')) {
        editableFields.push(blockElement);
      }
      // Also check any children with data-edit-text, plus any that live on an
      // element standing in for this block (a tab's label sits on the button
      // that reveals it, outside the block's own subtree).
      blockElement.querySelectorAll('[data-edit-text]').forEach((el) => {
        editableFields.push(el);
      });
      for (const field of this.getOwnEditableFields(blockElement)) {
        if (!editableFields.includes(field)) editableFields.push(field);
      }
    }
    log(`restoreContentEditableOnFields called from ${caller}: found ${editableFields.length} fields for block ${blockUid}`);
    editableFields.forEach((field) => {
      const fieldPath = field.getAttribute('data-edit-text');
      // Use getFieldType which handles page-level fields (e.g., /title) correctly
      const fieldType = this.getFieldType(blockUid, fieldPath);
      const wasEditable = field.getAttribute('contenteditable') === 'true';
      // Only set contenteditable for text-editable fields (string, textarea, slate)
      if (this.fieldTypeIsTextEditable(fieldType)) {
        field.setAttribute('contenteditable', 'true');
        // Set placeholder from schema or block data
        const placeholder = this.getFieldPlaceholder(blockUid, fieldPath);
        if (placeholder) {
          field.setAttribute('data-placeholder', placeholder);
        }
        this.updateEmptyState(field);
        log(`  ${fieldPath}: ${wasEditable ? 'already editable' : 'SET editable'} (type: ${fieldType})${placeholder ? ` placeholder: "${placeholder}"` : ''}`);

        // Register keydown handler on every editable field (not just the focused one).
        // One handler per field, all keys go through _handleFieldKeydown → replayOneKey.
        if (!field._hydraKeydownHandler) {
          field._hydraKeydownHandler = (e) => {
            this._handleFieldKeydown(e, blockUid, field);
          };
          field.addEventListener('keydown', field._hydraKeydownHandler);
        }
      } else {
        log(`  ${fieldPath}: skipped (type: ${fieldType})`);
      }
    });

    // Clean up stale contenteditable attributes from elements that are no longer editable
    // This happens when a field was editable but is no longer (e.g., teaser overwrite unchecked)
    const allContentEditable = blockElement.querySelectorAll('[contenteditable="true"]');
    allContentEditable.forEach((el) => {
      // Skip if this element belongs to a nested block
      const elBlock = el.closest('[data-block-uid]');
      if (elBlock !== blockElement) return;

      // If element has no data-edit-text, remove contenteditable
      if (!el.hasAttribute('data-edit-text')) {
        el.removeAttribute('contenteditable');
        log(`  Removed stale contenteditable from element without data-edit-text`);
      }
    });
  }

  /**
   * Activate an editable field: make it contenteditable, set up observers, focus it, and position cursor.
   * This is the common logic used by both block selection and page-level field clicks.
   *
   * @param {HTMLElement} fieldElement - The element with data-edit-text
   * @param {string} fieldName - The field name (e.g., 'value', 'title')
   * @param {string|null} blockUid - The block UID (null for page-level fields)
   * @param {string} caller - Caller name for debugging
   * @param {Object} options - Optional settings:
   *   - skipContentEditable: Don't call restoreContentEditableOnFields (already done)
   *   - skipObservers: Don't set up text change observers (already done)
   *   - preventScroll: Pass to focus() to prevent scrolling
   *   - wasAlreadyEditable: Field was contenteditable before click (trust browser positioning if also focused)
   *   - saveClickPosition: Save position for FORM_DATA handler to restore after re-render
   */
  activateEditableField(fieldElement, fieldName, blockUid, caller, options = {}) {
    log(`activateEditableField called from ${caller}:`, { fieldName, blockUid, options });

    // Make field contenteditable (unless already done)
    if (!options.skipContentEditable) {
      this.restoreContentEditableOnFields(fieldElement, caller);
    }

    // Set up text change observers (unless already done)
    if (!options.skipObservers) {
      this.observeBlockTextChanges(fieldElement);
    }

    // Get field type to determine if it's text-editable
    const fieldType = this.getFieldType(blockUid, fieldName);

    if (!this.fieldTypeIsTextEditable(fieldType)) {
      return;
    }

    // Check if already focused (avoid disrupting cursor position)
    const isAlreadyFocused = document.activeElement === fieldElement;
    log('activateEditableField focus check:', { isAlreadyFocused, activeElement: document.activeElement?.tagName });

    // Focus the field if not already focused
    if (!isAlreadyFocused) {
      fieldElement.focus({ preventScroll: options.preventScroll });
      log(`activateEditableField: focused field`);
    }

    // A frontend may replace this very element on its next render; watch for it
    // so the caret can be put back (see observeFocusedFieldReplacement).
    this.observeFocusedFieldReplacement(fieldElement);

    // Make sure data-empty reflects current text content. data-empty no
    // longer flips based on focus — the placeholder ::before is held
    // invisible by :focus::before { visibility: hidden } and its
    // layout space keeps the field's height stable across focus,
    // empty-typing, and content states without any host-CSS rule.
    this.updateEmptyState(fieldElement);

    // If field was already editable AND already focused, browser already handled
    // cursor positioning on click - don't redo it (causes race with typing)
    // BUT: still check if cursor is on invalid whitespace (e.g., on DIV container
    // instead of inside P element) and correct if needed
    // NOTE: Use requestAnimationFrame to run after browser's default click positioning completes
    //
    // "Focused" only implies "the browser placed a caret" for an ordinary
    // element. When the editable field is ITSELF focusable — a card whose title
    // is its cover <a>, a nav link, a button — clicking it gives the element
    // focus and NO caret, so trusting the browser here left the author focused
    // on a field with nothing to type into. Require a caret actually inside the
    // field before deferring to the browser; otherwise fall through and place
    // one ourselves from the click coordinates.
    const activeSelection = window.getSelection();
    const caretInField =
      activeSelection?.rangeCount > 0 &&
      fieldElement.contains(activeSelection.getRangeAt(0).startContainer);
    // Only a click ON THIS FIELD earns the fall-through. Activations that come
    // from anywhere else — the admin driving selection, a re-render, a
    // programmatic select — must keep deferring to the browser, or we yank
    // focus into the iframe mid-edit and clobber what the admin is doing.
    const clickedThisField = this.lastClickPosition?.editableField === fieldName;
    if (options.wasAlreadyEditable && isAlreadyFocused && (caretInField || !clickedThisField)) {
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        const anchorNode = selection?.anchorNode;
        const anchorNeedsCorrection = anchorNode && this.isOnInvalidWhitespace(anchorNode);
        log('activateEditableField: deferred check -', {
          anchorNodeName: anchorNode?.nodeName,
          anchorOffset: selection?.anchorOffset,
          needsCorrection: anchorNeedsCorrection,
        });
        if (anchorNeedsCorrection) {
          log('activateEditableField: already focused but cursor on invalid whitespace, correcting');
          this.correctInvalidWhitespaceSelection();
        } else {
          log('activateEditableField: field already editable and focused, browser positioning OK');
        }
      });
      this.lastClickPosition = null;
      return;
    }

    // Position cursor at click location if we have coordinates
    if (!this.lastClickPosition) {
      // No click position (e.g., new block created via Enter) - ensure cursor
      // is inside a valid data-node-id element using the existing correction logic
      const selection = window.getSelection();
      const selectionInfo = selection?.rangeCount ? {
        rangeCount: selection.rangeCount,
        anchorNode: selection.anchorNode?.nodeName,
        anchorOffset: selection.anchorOffset,
        anchorNodeId: selection.anchorNode?.parentElement?.getAttribute?.('data-node-id') ||
                      selection.anchorNode?.getAttribute?.('data-node-id'),
      } : { noSelection: true };
      log('activateEditableField: no lastClickPosition, selection state:', selectionInfo);
      const corrected = this.correctInvalidWhitespaceSelection();
      log('activateEditableField: correction result:', corrected);
      return;
    }

    const currentRect = fieldElement.getBoundingClientRect();
    const clientX = currentRect.left + this.lastClickPosition.relativeX;
    const clientY = currentRect.top + this.lastClickPosition.relativeY;

    log('activateEditableField: positioning cursor at click location:', {
      relativeX: this.lastClickPosition.relativeX,
      relativeY: this.lastClickPosition.relativeY,
      clientX,
      clientY,
    });

    // Save click position for FORM_DATA handler if requested (for re-render scenarios)
    if (options.saveClickPosition) {
      this.savedClickPosition = {
        relativeX: this.lastClickPosition.relativeX,
        relativeY: this.lastClickPosition.relativeY,
        editableField: this.lastClickPosition.editableField,
      };
    }

    // Only restore click position if there's no existing non-collapsed selection
    const currentSelection = window.getSelection();
    const hasNonCollapsedSelection = currentSelection &&
      currentSelection.rangeCount > 0 &&
      !currentSelection.getRangeAt(0).collapsed;

    if (hasNonCollapsedSelection) {
      log('activateEditableField: skipping cursor positioning - non-collapsed selection exists');
    } else {
      let range = this.caretRangeFromPoint(clientX, clientY);
      // The point is only a hint. The stored click is relative to the FIELD, so
      // that a scroll can't invalidate it — but converting it back gives a
      // viewport point, and by then the page may have moved something else
      // under it: a sticky header, or simply different content at that spot.
      // caretRangeFromPoint answers for whatever is there, so an unchecked
      // result drops the author's caret into another element entirely (a page
      // heading, in the case that surfaced this). If the range isn't inside the
      // field, fall back to the field's own text.
      if (range && !fieldElement.contains(range.startContainer)) {
        log('activateEditableField: point resolved outside the field, using its own text instead');
        const walker = document.createTreeWalker(fieldElement, NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        if (textNode) {
          range = document.createRange();
          range.setStart(textNode, 0);
          range.collapse(true);
        } else {
          range = null;
          const fallback = document.createRange();
          fallback.selectNodeContents(fieldElement);
          fallback.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(fallback);
        }
      }
      if (range) {
        log('activateEditableField: caretRangeFromPoint result:', {
          startContainer: range.startContainer.nodeName,
          startOffset: range.startOffset,
          isOnInvalid: this.isOnInvalidWhitespace(range.startContainer),
        });
        const validPos = this.getValidatedPosition(range.startContainer, range.startOffset);
        log('activateEditableField: getValidatedPosition result:', {
          nodeName: validPos.node?.nodeName,
          offset: validPos.offset,
          nodeId: validPos.node?.parentElement?.getAttribute?.('data-node-id') || validPos.node?.getAttribute?.('data-node-id'),
        });
        const finalRange = document.createRange();
        finalRange.setStart(validPos.node, validPos.offset);
        finalRange.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(finalRange);
        log('activateEditableField: cursor positioned at offset:', validPos.offset);
      }
    }

    // Clear lastClickPosition - we've used it
    this.lastClickPosition = null;

  }

  /**
   * Ensure all interactive elements have minimum size so users can click/select them.
   * Called after FORM_DATA to handle newly added blocks that haven't been selected yet.
   * Only sets min dimensions on elements that have zero width or height (respects existing styling).
   */
  ensureElementsHaveMinSize() {
    // Helper: only set min-size if element has no size
    const ensureSize = (el, minWidth, minHeight) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        el.style.minWidth = minWidth;
        el.style.minHeight = minHeight;
      } else if (rect.width === 0) {
        el.style.minWidth = minWidth;
      } else if (rect.height === 0) {
        el.style.minHeight = minHeight;
      }
      // If element already has both width and height, don't touch it
    };

    // Editable fields need min-height for text cursor
    document.querySelectorAll('[data-edit-text]').forEach((el) => {
      ensureSize(el, 'auto', '1.5em');
    });

    // Media fields need min dimensions for image picker overlay
    document.querySelectorAll('[data-edit-media]').forEach((el) => {
      ensureSize(el, '100px', '100px');
    });

    // Blocks need min-height for click selection
    document.querySelectorAll('[data-block-uid]').forEach((el) => {
      ensureSize(el, 'auto', '2em');
    });
  }

  /**
   * Ensure empty inline elements have zero-width spaces for cursor positioning.
   * Called after DOM is updated to allow cursor placement in empty formatting elements.
   * Uses \uFEFF (zero-width no-break space) like slate-react.
   *
   * @param {HTMLElement} container - The container element to process
   */
  /**
   * Find empty inline elements in Slate value that need ZWS for cursor positioning.
   * Returns array of nodeIds that should have ZWS.
   *
   * An inline element is any node with a type AND children (not a text leaf).
   * We detect empty inlines by checking if children is just [{text: ''}].
   */
  /**
   * Strip zero-width spaces from text content.
   * Part of ZWS lifecycle (stripping) — see "Whitespace & ZWS Strategy".
   * ZWS characters are added for cursor positioning and should be removed
   * when serializing text back to Slate. Also converts NBSP to regular space.
   *
   * @param {string} text - Text content that may contain ZWS
   * @returns {string} - Text with ZWS removed
   */
  stripZeroWidthSpaces(text) {
    if (!text) return text;
    // Remove ZWS characters and convert NBSP to regular space
    return text.replace(/[\uFEFF\u200B]/g, '').replace(/\u00A0/g, ' ');
  }

  /**
   * Clean HTML content for clipboard - removes internal data attributes and ZWS/NBSP.
   * Only strips ZWS/NBSP from text within editable fields, preserving other content.
   *
   * @param {DocumentFragment|HTMLElement} fragment - DOM fragment or element to clean
   * @returns {string} - Cleaned HTML string
   */
  cleanHtmlForClipboard(fragment) {
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(fragment.cloneNode(true));

    // Find editable fields and clean text nodes within them
    const editableFields = tempDiv.querySelectorAll('[data-edit-text]');
    editableFields.forEach((field) => {
      const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        // Strip ZWS and convert NBSP to regular space
        node.textContent = node.textContent
          .replace(/[\uFEFF\u200B]/g, '')
          .replace(/\u00A0/g, ' ');
      }
    });

    // Remove internal data attributes from all elements
    const internalAttrs = [
      'data-node-id',
      'data-field-name',
      'data-slate-node',
      'data-slate-leaf',
      'data-slate-string',
      'data-block-uid',
      'data-edit-text',
    ];
    tempDiv.querySelectorAll('*').forEach((el) => {
      internalAttrs.forEach((attr) => el.removeAttribute(attr));
    });

    return tempDiv.innerHTML;
  }

  /**
   * Handle copy event — clean selection and write to clipboard.
   * Single function called from both native copy events and execCommand('copy') replay.
   * Strips ZWS/NBSP from text, removes internal data-* attributes from HTML.
   */
  _doCopy(e) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);

    // Strip ZWS and NBSP (contenteditable artifacts) from text
    let cleanText = this.stripZeroWidthSpaces(selection.toString());
    cleanText = cleanText.replace(/\u00A0/g, ' ');

    // cleanHtmlForClipboard only cleans within [data-edit-text] elements
    const cleanHtml = this.cleanHtmlForClipboard(range.cloneContents());

    log('Copy event - cleaning clipboard');
    e.preventDefault();
    e.clipboardData.setData('text/plain', cleanText);
    e.clipboardData.setData('text/html', cleanHtml);
  }

  /**
   * Handle cut — copy cleaned selection to clipboard, then delete via transform.
   * Single function called from both normal keydown handler and buffered replay.
   */
  _doCut(blockUid) {
    // execCommand('copy') triggers a trusted copy event → _doCopy cleans clipboard
    document.execCommand('copy');
    // Delete the selected content via transform
    this.sendTransformRequest(blockUid, 'delete', {});
  }

  /**
   * Handle paste — send paste transform with HTML content.
   * Single function called from both native paste event handler and buffered replay.
   */
  _doPaste(blockUid, html) {
    this.sendTransformRequest(blockUid, 'paste', { html });
  }

  /**
   * Strip zero-width spaces from DOM text nodes within a container.
   * Part of ZWS lifecycle (stripping) — see "Whitespace & ZWS Strategy".
   * Only removes ZWS from text nodes that have other content (not from
   * empty-except-ZWS nodes, which still need ZWS for cursor positioning).
   *
   * @param {HTMLElement} container - Container element to search for text nodes
   */
  stripZeroWidthSpacesFromDOM(container) {
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null,
    );

    const nodesToUpdate = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      // Only strip ZWS if there's other content - don't strip from ZWS-only nodes
      // (ZWS-only nodes are still needed for cursor positioning in empty elements)
      if (text && text.length > 1 && /[\uFEFF\u200B]/.test(text)) {
        nodesToUpdate.push(node);
      }
    }

    if (nodesToUpdate.length === 0) {
      return; // Nothing to strip
    }

    // Update nodes after walking to avoid modifying during iteration
    // Note: This function is NOT called during typing to avoid cursor corruption.
    // It may be used for cleanup in other contexts if needed.
    for (const textNode of nodesToUpdate) {
      const newText = textNode.textContent.replace(/[\uFEFF\u200B]/g, '');
      if (newText !== textNode.textContent) {
        log('stripZeroWidthSpacesFromDOM: Stripping ZWS from:', JSON.stringify(textNode.textContent), '→', JSON.stringify(newText));
        textNode.textContent = newText;
      }
    }
  }

  /**
   * Post-render DOM updates shared by both INITIAL_DATA and FORM_DATA handlers.
   * Runs inside a double requestAnimationFrame to ensure the renderer has finished.
   *
   * For INITIAL_DATA, all optional params are absent so the cursor/resize/block-switch
   * code paths are no-ops.
   *
   * @param {Object} [options]
   * @param {Object} [options.transformedSelection] - Slate selection from admin
   * @param {string} [options.formatRequestId] - Format operation request id
   * @param {boolean} [options.needsBlockSwitch] - Whether admin selected a different block
   * @param {string} [options.adminSelectedBlockUid] - Block uid admin wants selected
   */
  afterContentRender({ transformedSelection, formatRequestId, needsBlockSwitch, adminSelectedBlockUid } = {}) {
    // _executeRender already ensured content is ready before calling us.
    // No polling needed here — just run the post-render tasks.

    const doAfterContentRender = () => {
        const elapsed = this._renderStartTime ? (performance.now() - this._renderStartTime).toFixed(0) : '?';
        log('doAfterContentRender START +' + elapsed + 'ms');

        // All-blocks operations (materializeHydraComments, markEmptyBlocks,
        // applyReadonlyVisuals, applyPlaceholders) are handled by the
        // structural observer — it fires whenever the framework patches the
        // DOM, so these run at the right time regardless of sync/async render.

        // Re-attach observers/editors for the currently selected block
        if (this.selectedBlockUid) {
          const blockElement = this.queryBlockElement(this.selectedBlockUid);
          if (blockElement) {
            // NOTE: observeBlockTextChanges is NOT called here — it's deferred
            // to the very end of afterContentRender, after restoreSlateSelection
            // and replayBufferAndUnblock complete. Reconnecting the observer
            // earlier causes it to fire on DOM mutations from selection
            // restoration (ZWS creation) or late Vue render passes, corrupting
            // this.formData via handleTextChange reading mid-render DOM.
            this.makeBlockContentEditable(blockElement);

            const editableFields = this.getEditableFields(blockElement);
            const isSidebarEdit = !transformedSelection;
            const blockElements = [...this.getAllBlockElements(this.selectedBlockUid)];
            this.observeBlockResize(blockElements, this.selectedBlockUid, editableFields, isSidebarEdit);

            const newBlockRect = blockElement.getBoundingClientRect();
            const newMediaFields = this.getMediaFields(blockElement);

            const blockRectChanged = !this.lastBlockRect ||
              Math.abs(newBlockRect.top - this.lastBlockRect.top) > 1 ||
              Math.abs(newBlockRect.left - this.lastBlockRect.left) > 1 ||
              Math.abs(newBlockRect.width - this.lastBlockRect.width) > 1 ||
              Math.abs(newBlockRect.height - this.lastBlockRect.height) > 1;

            let mediaFieldsChanged = false;
            const newFieldNames = Object.keys(newMediaFields);
            const lastFieldNames = Object.keys(this.lastMediaFields || {});
            if (newFieldNames.length !== lastFieldNames.length) {
              mediaFieldsChanged = true;
            } else {
              for (const fieldName of newFieldNames) {
                const newRect = newMediaFields[fieldName]?.rect;
                const lastRect = this.lastMediaFields?.[fieldName]?.rect;
                if (!newRect || !lastRect ||
                    Math.abs(newRect.top - lastRect.top) > 1 ||
                    Math.abs(newRect.left - lastRect.left) > 1 ||
                    Math.abs(newRect.width - lastRect.width) > 1 ||
                    Math.abs(newRect.height - lastRect.height) > 1) {
                  mediaFieldsChanged = true;
                  break;
                }
              }
            }

            log('afterContentRender check:', {
              blockRectChanged,
              mediaFieldsChanged,
              newBlockRect: { top: newBlockRect.top, height: newBlockRect.height },
              newMediaFields,
              lastMediaFields: this.lastMediaFields,
            });

            if (transformedSelection || blockRectChanged || mediaFieldsChanged) {
              log('afterContentRender sending BLOCK_SELECTED with mediaFields:', newMediaFields);
              this.sendBlockSelected('afterContentRender', blockElement, {
                selection: transformedSelection || undefined,
              });
              this.lastBlockRect = { top: newBlockRect.top, left: newBlockRect.left, width: newBlockRect.width, height: newBlockRect.height };
              this.lastMediaFields = JSON.parse(JSON.stringify(newMediaFields));
            }
          }
        }

        // Update block UI overlay positions after form data changes
        // Detect focus lost due to re-render: user was editing a field but
        // focus is now on body (Vue/Nuxt replaced the DOM element).
        // Use _iframeFocused (tracked via window focus/blur events) instead of
        // document.hasFocus() — the latter is unreliable in headless browsers
        // (always returns false), but window focus/blur events fire correctly
        // because they're dispatched by Chromium's internal frame focus manager.
        // This avoids stealing focus from the sidebar: when the user is typing
        // in the sidebar, the iframe receives a blur event → _iframeFocused=false.
        const focusLost = this.focusedFieldName &&
            this._iframeFocused &&
            (!document.activeElement ||
             document.activeElement === document.body ||
             document.activeElement === document.documentElement);
        const skipFocus = !transformedSelection && !focusLost;

        if (transformedSelection) {
          this.savedClickPosition = null;
        }

        const blockUidToProcess = needsBlockSwitch ? adminSelectedBlockUid : this.selectedBlockUid;
        const blockHandler = needsBlockSwitch
          ? (el) => {
              // Admin-initiated block switch (e.g. new block after Enter):
              // mirror the SELECT_BLOCK direct path — switch to text mode and
              // focus the first editable field so the user can type without
              // an extra click. Without this, blocks created from block-mode
              // Enter land selected-but-not-focused.
              //
              // Skip fieldToFocus when admin sends a transformedSelection:
              // that means a slate transform (split/merge) ran and is
              // shipping an explicit cursor position to apply on the new
              // DOM (e.g. backspace-merge places the cursor at the join
              // point). Forcing focus to "first editable" would clobber
              // that selection — regression introduced in 97dd597b.
              log('Selecting new block from afterContentRender:', blockUidToProcess, 'transformedSelection:', !!transformedSelection);
              this.editMode = 'text';
              this.selectBlock(el, transformedSelection ? {} : { fieldToFocus: 'first' });
            }
          : (el) => this.updateBlockUIAfterFormData(el, skipFocus);

        if (blockUidToProcess) {
          const blockElement = this.queryBlockElement(blockUidToProcess);

          // Navigation is handled by the poller in _executeRender — not here.
          // We only proceed if the block is visible. If it's hidden/missing
          // after a block switch, the poller already timed out or navigation
          // failed — selecting a hidden block would produce a zero-rect
          // BLOCK_SELECTED that confuses the admin UI.
          this.ensureElementsHaveMinSize();
          if (blockElement && !this.isElementHidden(blockElement)) {
            blockHandler(blockElement);
          } else if (needsBlockSwitch) {
            log('afterContentRender: block not visible, skipping select:', blockUidToProcess);
          }
        }

        // Content is ready — isContentReady() confirmed before calling, or
        // pollUntilReady() polled until ready.

        let selectionRestored = true;
        if (transformedSelection) {
          // expectedSelectionFromAdmin was already set before the render
          // (in the FORM_DATA handler) to suppress re-render selectionchanges.
          try {
            selectionRestored = this.restoreSlateSelection(transformedSelection, this.formData);
            const sel = document.getSelection();
            log('restoreSlateSelection result:', selectionRestored,
              'selection:', sel?.toString()?.substring(0, 30),
              'collapsed:', sel?.isCollapsed,
              'anchorNode:', sel?.anchorNode?.nodeName,
              'anchorOffset:', sel?.anchorOffset,
              'focusOffset:', sel?.focusOffset);
            // Track selection changes after restore to find what clears it
            const trackTimer = setInterval(() => {
              const s = document.getSelection();
              const text = s?.toString() || '';
              if (text !== this._lastTrackedSel) {
                log('SELECTION SHIFTED to:', JSON.stringify(text?.substring(0, 30)),
                  'collapsed:', s?.isCollapsed,
                  'anchorNode:', s?.anchorNode?.nodeName,
                  '+' + (performance.now() - this._renderStartTime).toFixed(0) + 'ms');
                this._lastTrackedSel = text;
              }
            }, 16);
            setTimeout(() => clearInterval(trackTimer), 2000);
            this._lastTrackedSel = sel?.toString() || '';
          } catch (e) {
            console.error('[HYDRA] Error restoring selection:', e);
            selectionRestored = false;
          }
          if (!selectionRestored) {
            log('Selection restore failed — dropping', this.eventBuffer.length, 'buffered events to avoid wrong-selection replay');
            this.eventBuffer = [];
          }

          // Clear after a brief settling period to catch trailing selectionchanges
          // from DOM attribute updates (contenteditable, nodeIds, etc.)
          setTimeout(() => { this.expectedSelectionFromAdmin = null; }, 100);
        }

        if (needsBlockSwitch && adminSelectedBlockUid) {
          if (this.pendingTransform) {
            log('Redirecting buffer from', this.pendingTransform.blockId, 'to new block:', adminSelectedBlockUid);
            this.pendingTransform.blockId = adminSelectedBlockUid;
          }
          if (this.eventBuffer.length > 0) {
            log('Redirecting eventBuffer to new block:', adminSelectedBlockUid);
          }
        }

        // Replay keystrokes buffered during re-render (separate from format op replay)
        if (this._reRenderBlocking) {
          this._reRenderBlocking = false;

          // Restore pre-render cursor position when no transformedSelection was
          // provided (echo or sidebar FORM_DATA). The DOM re-render may reset
          // cursor to position 0; we need to put it back before replaying events.
          // Only restore when iframe has focus — restoring selection calls .focus()
          // which would steal focus from sidebar fields. Note: skipFocus (based on
          // focusLost) can't be used here because frameworks like Vue may patch the
          // DOM without destroying the focused element, so focus isn't "lost" even
          // though the cursor position was reset to 0.
          if (!transformedSelection && this._preRenderSelection && this._iframeFocused) {
            log('Restoring pre-render selection for buffer replay:', JSON.stringify(this._preRenderSelection));
            try {
              this.restoreSlateSelection(this._preRenderSelection, this.formData);
            } catch (e) {
              log('Pre-render selection restore failed:', e.message);
            }
          }
          this._preRenderSelection = null;

          if (this.eventBuffer.length > 0) {
            log('Replaying', this.eventBuffer.length, 're-render buffered events');
            this.pendingBufferReplay = {
              blockId: this.selectedBlockUid,
              buffer: [...this.eventBuffer],
            };
            this.eventBuffer = [];
            this.replayBufferedEvents();
          }
          // Clear blocking only if no format op is pending
          if (!this.pendingTransform) {
            this.blockedBlockId = null;
            this._setPointerBlocking(false);
          }
        }

        this.replayBufferAndUnblock();

        // Render cycle complete — process any queued FORM_DATA.
        // Only the latest queued message matters (earlier ones are stale).
        // NOTE: _renderInProgress stays true until AFTER the observer is reconnected
        // at the end of this function. This prevents late framework DOM patches from
        // triggering handleTextChange which would read mid-render DOM.
        if (this._formDataQueue) {
          const queued = this._formDataQueue;
          this._formDataQueue = null;
          log('Processing queued FORM_DATA after render complete');
          // Re-dispatch as a message event so it goes through the full
          // FORM_DATA handler (stale check, addNodeIds, etc.)
          // Any queued FLUSH_BUFFER will be processed after this render completes.
          window.postMessage(queued, window.location.origin);
        } else if (this._flushBufferQueue) {
          // Process queued FLUSH_BUFFER after render complete and FORM_DATA processed.
          // Now the DOM is stable with nodeIds, so serializeSelection() will work.
          const queuedFlush = this._flushBufferQueue;
          this._flushBufferQueue = null;
          log('Processing queued FLUSH_BUFFER after render complete');
          this._processFlushBuffer(queuedFlush.requestId, queuedFlush.setBlocking);
        }

        // Re-attach text change observer LAST, after all DOM operations
        // (restoreSlateSelection, replayBufferAndUnblock, queue processing)
        // are complete. Reconnecting earlier causes the observer to fire on
        // ZWS creation from restoreSlateSelection or late Vue render passes,
        // and handleTextChange reads mid-render DOM, corrupting this.formData.
        if (this.selectedBlockUid) {
          const currentBlockEl = this.queryBlockElement(this.selectedBlockUid);
          if (currentBlockEl) {
            const editField = currentBlockEl.querySelector('[data-edit-text]') || currentBlockEl;
            this.observeBlockTextChanges(currentBlockEl);
          }
        }
        // Mark render complete AFTER observer reconnection
        this._renderInProgress = false;
    };

    // _executeRender already ensured content is ready (via polling,
    // settlement, or fast path) before calling afterContentRender.
    doAfterContentRender();
  }

  /**
   * Harvest linkable anchors from the live DOM and, when the full map changed
   * since the last send, push it to the admin so it can merge
   * block._linkableAnchors into the canonical formData (see the LINKABLE_ANCHORS
   * handler in View.jsx). Guarded by a JSON snapshot so a FORM_DATA echo →
   * re-render never loops.
   */
  /**
   * Harvest deep-link anchors from the live DOM, dropping any block hydra
   * considers read-only. Read-only for TEMPLATE content is hydra's call, not the
   * frontend's — the merge stamps block.readOnly, so isBlockReadonly knows it
   * from the data on every frontend (a real frontend needn't mark
   * data-block-readonly for template blocks). That content is owned by the
   * template (which carries its own anchors), so it must not be harvested onto
   * the instance. collectLinkableAnchors still honours a frontend's OWN
   * data-block-readonly (its escape hatch to lock a block for its own reasons);
   * this adds the template-aware determination. Shared by the inline fold-in and
   * the structural-settle send.
   */
  _harvestLinkableAnchors() {
    const anchors = collectLinkableAnchors(document);
    for (const uid of Object.keys(anchors)) {
      if (this.isBlockReadonly(uid)) delete anchors[uid];
    }
    return anchors;
  }

  /**
   * STRUCTURAL path: after a settled render (add/remove/reorder heading blocks —
   * no inline edit fired), push the anchors so the admin can fold them into
   * formData. Inline edits do NOT come through here — they carry their anchors on
   * the INLINE_EDIT_DATA message itself (see flushPendingTextUpdates), which is
   * why this only sends when the map changed since the last send of EITHER path.
   */
  _maybeSendLinkableAnchors() {
    const anchors = this._harvestLinkableAnchors();
    const json = JSON.stringify(anchors);
    // Treat an unset baseline as "{}" so a page with no anchors never sends a
    // spurious empty map on its first flush — that dispatch would re-render the
    // admin Form mid-edit and perturb inline-edit dirty tracking.
    if (json === (this._lastSentAnchors ?? '{}')) return;
    this._lastSentAnchors = json;
    this.sendMessageToParent({ type: 'LINKABLE_ANCHORS', anchors });
  }

  /**
   * Read the text content of a data-node-id element from the DOM.
   * Shared by handleTextChange (single node) and readSlateValueFromDOM (full field).
   */
  readNodeText(nodeEl) {
    return this.stripZeroWidthSpaces(nodeEl.innerText)?.replace(/\n$/, '');
  }

  /**
   * Build a map of nodeId → metadata from a Slate JSON value.
   * Metadata is everything except text, children, and nodeId — e.g.
   * type, data, bold, italic, href, etc. Used by readSlateValueFromDOM
   * to preserve formatting when reconstructing the value from the DOM.
   *
   * Also tracks which nodeIds are inline (appeared alongside text children
   * in the existing value) in map._inlineNodeIds. This drives Slate
   * normalization — inline nodes need empty text nodes around them.
   */
  buildNodeMetadataMap(slateValue, map = {}) {
    if (!map._inlineNodeIds) map._inlineNodeIds = new Set();
    if (Array.isArray(slateValue)) {
      for (const item of slateValue) this.buildNodeMetadataMap(item, map);
    } else if (slateValue && typeof slateValue === 'object') {
      if (slateValue.nodeId) {
        const meta = {};
        for (const key of Object.keys(slateValue)) {
          if (key !== 'text' && key !== 'children' && key !== 'nodeId') {
            meta[key] = slateValue[key];
          }
        }
        map[slateValue.nodeId] = meta;
      }
      if (slateValue.children) {
        // Recurse first so child entries exist in the map
        this.buildNodeMetadataMap(slateValue.children, map);
        // Detect inline nodeIds: if children mix text and typed nodes,
        // the typed ones are inline elements in Slate
        const hasText = slateValue.children.some(c => c.hasOwnProperty('text'));
        if (hasText) {
          for (const child of slateValue.children) {
            if (child.nodeId) {
              map._inlineNodeIds.add(child.nodeId);
            }
          }
        }
      }
    }
    return map;
  }

  /**
   * Collect all attribute values from an element and its descendants.
   * Used by domNodeToSlate in matchMetadataFromDom mode to check which
   * formData metadata values are visible in the rendered DOM.
   * @param {HTMLElement} el
   * @returns {Set<string>} all attribute values found
   */
  _collectDomAttributeValues(el) {
    const values = new Set();
    const walk = (node) => {
      if (!(node instanceof HTMLElement)) return;
      for (const attr of node.attributes) {
        if (attr.value) values.add(attr.value);
      }
      for (const child of node.children) walk(child);
    };
    walk(el);
    return values;
  }

  /**
   * Filter metadata to only include values that appear in the DOM.
   * Walks the metadata object and keeps only leaf values (strings, numbers,
   * booleans) that match an attribute value found in the DOM element.
   * @param {Object} fullMeta - metadata from formData metadataMap
   * @param {Set<string>} domValues - attribute values from _collectDomAttributeValues
   * @returns {Object} filtered metadata with only DOM-visible values
   */
  _filterMetadataByDom(fullMeta, domValues) {
    const result = {};
    for (const [key, val] of Object.entries(fullMeta)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const filtered = this._filterMetadataByDom(val, domValues);
        if (Object.keys(filtered).length > 0) result[key] = filtered;
      } else if (typeof val === 'string' && domValues.has(val)) {
        result[key] = val;
      } else if ((typeof val === 'number' || typeof val === 'boolean') && domValues.has(String(val))) {
        result[key] = val;
      }
    }
    return result;
  }

  /**
   * Convert a DOM element with data-node-id into a Slate JSON node.
   * Text nodes become {text: "..."}, elements with data-node-id recurse.
   *
   * @param {HTMLElement} el - Element with data-node-id
   * @param {Object} metadataMap - nodeId → metadata from formData
   * @param {boolean} matchMetadataFromDom - When true, only include metadata
   *   values that are visible in the DOM (as attribute values). Used by
   *   isContentReady to detect rendered changes like link URL updates.
   *   When false (default), include all metadata from metadataMap.
   */
  domNodeToSlate(el, metadataMap, matchMetadataFromDom = false) {
    const nodeId = el.getAttribute('data-node-id');
    const fullMeta = (nodeId && metadataMap[nodeId]) || {};
    let metadata;
    if (matchMetadataFromDom) {
      const domValues = this._collectDomAttributeValues(el);
      metadata = this._filterMetadataByDom(fullMeta, domValues);
      // type is the node identity (comes with nodeId), not a rendered value
      if (fullMeta.type) metadata.type = fullMeta.type;
    } else {
      metadata = fullMeta;
    }
    const children = [];

    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const raw = child.textContent || '';
        const text = this.stripZeroWidthSpaces(raw);
        children.push({ text });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childNodeId = child.getAttribute('data-node-id');
        if (childNodeId && isValidNodeId(childNodeId)) {
          children.push(this.domNodeToSlate(child, metadataMap, matchMetadataFromDom));
        } else if (
          child.getAttribute('contenteditable') === 'false' ||
          child.getAttribute('aria-hidden') === 'true'
        ) {
          // Non-editable / decorative island with no data-node-id — e.g. a
          // frontend's external-link icon after a link's text, or any generated
          // chrome the editor should ignore. `contenteditable="false"` is the
          // browser's marker for a non-editable island (the caret steps over it,
          // backspace deletes it whole); `aria-hidden` marks pure decoration.
          // Either means "not editable content", so skip it rather than read its
          // textContent into the value — reading it would corrupt the Slate
          // value on every edit/select/delete over it. A framework wrapper span
          // holds real text and carries NEITHER attribute, so it is still read
          // below. (Frontends should set BOTH on such content: contenteditable
          // =false so the caret skips it, aria-hidden if it is decorative.)
          continue;
        } else {
          // Element without valid nodeId (e.g. Vue wrapper span, Next.js leaf span)
          // — treat its text content as a text node, including empty text which
          // Slate requires around inline elements like strong/link
          const text = this.stripZeroWidthSpaces(child.textContent || '');
          children.push({ text });
        }
      }
    }

    // Merge adjacent text nodes (browser/framework may split them)
    const merged = [];
    for (const child of children) {
      const prev = merged[merged.length - 1];
      if (prev && prev.hasOwnProperty('text') && child.hasOwnProperty('text') && !child.type) {
        prev.text += child.text;
      } else {
        merged.push(child);
      }
    }

    // Remove whitespace-only text nodes between non-inline elements.
    // These come from HTML indentation (e.g. newlines between <li> tags)
    // and are not Slate content. We detect this by checking: if none of
    // the element children are inline (per the metadata), then any
    // whitespace-only text is just HTML formatting.
    const inlineNodeIds = metadataMap._inlineNodeIds || new Set();
    const hasInlineChild = merged.some(c => c.nodeId && inlineNodeIds.has(c.nodeId));
    if (!hasInlineChild) {
      for (let i = merged.length - 1; i >= 0; i--) {
        if (merged[i].hasOwnProperty('text') && merged[i].text.trim() === '') {
          merged.splice(i, 1);
        }
      }
    }

    // Ensure at least one child (Slate requires non-empty children)
    if (merged.length === 0) {
      merged.push({ text: '' });
    }

    // Slate normalization: inline nodes must have text nodes
    // before, after, and between them.
    const isInline = (child) => child.nodeId && inlineNodeIds.has(child.nodeId);
    const hasInline = merged.some(isInline);
    if (hasInline) {
      const normalized = [];
      for (let i = 0; i < merged.length; i++) {
        const child = merged[i];
        if (isInline(child)) {
          const prev = normalized[normalized.length - 1];
          if (!prev || !prev.hasOwnProperty('text')) {
            normalized.push({ text: '' });
          }
        }
        normalized.push(child);
        if (isInline(child)) {
          const next = merged[i + 1];
          if (!next || !next.hasOwnProperty('text')) {
            normalized.push({ text: '' });
          }
        }
      }
      return { ...metadata, children: normalized, nodeId };
    }

    return { ...metadata, children: merged, nodeId };
  }

  /**
   * Read an editable field's current DOM content as a fresh Slate value.
   * Walks the DOM tree and builds the value from scratch using nodeIds
   * for structure and a metadata map for formatting/type info.
   *
   * This is the single source of truth for DOM → Slate conversion.
   * Used by both handleTextChange and waitForContentReady.
   */
  readSlateValueFromDOM(fieldEl, existingValue, { matchMetadataFromDom = false } = {}) {
    const metadataMap = this.buildNodeMetadataMap(existingValue);

    // Two valid DOM patterns:
    // 1. Field element IS the first node: <div data-edit-text="value" data-node-id="0">...</div>
    // 2. Nodes nested inside field: <div data-edit-text="value"><p data-node-id="0">...</p></div>
    // Both produce the same Slate value.
    const fieldNodeId = fieldEl.getAttribute('data-node-id');
    if (fieldNodeId && isValidNodeId(fieldNodeId)) {
      return [this.domNodeToSlate(fieldEl, metadataMap, matchMetadataFromDom)];
    }

    const topNodes = [];
    for (const child of fieldEl.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const nodeId = child.getAttribute('data-node-id');
        if (nodeId && isValidNodeId(nodeId)) {
          topNodes.push(this.domNodeToSlate(child, metadataMap, matchMetadataFromDom));
        }
      }
    }

    return topNodes;
  }


  /**
   * Wait for the rendered DOM to match this.formData for a block's editable fields.
   * Reads the full contenteditable back via readSlateValueFromDOM and compares
   * against the formData value. Returns immediately when content matches (zero
   * cost on mock); on Nuxt/Vue waits for secondary renders to complete.
   */
  /**
   * Synchronous check: does the DOM content match formData right now?
   */
  /**
   * Checks if the current and target blocks are ready in the DOM.
   * - Current block: if its data is in formData, check DOM content matches.
   *   If data is gone (block deleted), check element is gone from DOM.
   * - Target block (if switching): must exist in DOM with matching content.
   * Returns false if any block needs rendering.
   */
  /**
   * Pure readiness check — no side effects.
   *
   * A block is "ready" when it's visible in the viewport AND its rendered DOM
   * matches the formData (isContentReady). We cannot assume a block is rendered
   * but hidden — some implementations (carousels, tabs, lazy containers) may
   * not render a block's content at all until it is navigated to. "Not in DOM"
   * and "in DOM but not visible" are treated the same: not ready.
   *
   * @returns {{ ready: boolean, targetVisible: boolean }} ready=true means all
   *   blocks are ready to proceed. targetVisible indicates whether the target
   *   block (if switching) is visible — used by the poller to decide whether
   *   to navigate or give up on timeout.
   */
  _areBlocksReady(blockId, blockEl, afterRenderOptions = {}) {
    // Determine status of current block
    let currentReady = true; // Default: no current block = ready
    if (blockId) {
      if (!blockEl) {
        // Not in DOM — deleted (data gone) = ready, otherwise not rendered yet
        currentReady = !this.getBlockData(blockId);
      } else if (this.getBlockData(blockId)) {
        currentReady = this.isContentReady(blockEl);
      } else {
        currentReady = false; // In DOM but data gone — stale element
      }
    }

    // Determine status of target block (if switching selection)
    const newBlockId = afterRenderOptions.adminSelectedBlockUid;
    if (!newBlockId || newBlockId === blockId) {
      return { ready: currentReady, targetVisible: true };
    }

    const newEl = this.queryBlockElement(newBlockId);
    const targetVisible = newEl && !this.isElementHidden(newEl);
    const targetReady = targetVisible && this.isContentReady(newEl);

    return {
      ready: currentReady && targetReady,
      targetVisible: !!targetVisible,
    };
  }

  isContentReady(blockElement) {
    const blockUid = blockElement.getAttribute('data-block-uid');
    const blockData = this.getBlockData(blockUid);
    if (!blockData) return true;
    const editableFields = this.getEditableFields(blockElement);
    for (const [fieldName, fieldType] of Object.entries(editableFields)) {
      const fieldEl = blockElement.querySelector(`[data-edit-text="${fieldName}"]`)
        || (blockElement.getAttribute('data-edit-text') === fieldName ? blockElement : null);
      if (!fieldEl) continue;

      if (this.fieldTypeIsSlate(fieldType)) {
        const slateValue = getFieldValue(blockData, fieldName);
        if (!slateValue || !Array.isArray(slateValue)) continue;
        const domValue = this.readSlateValueFromDOM(fieldEl, slateValue, { matchMetadataFromDom: true });
        if (!this._deepEqual(domValue, slateValue)) {
          log('isContentReady MISMATCH:', blockUid, fieldName, '+' + (this._renderStartTime ? (performance.now() - this._renderStartTime).toFixed(0) : '?') + 'ms');
          log('  DOM:', JSON.stringify(domValue)?.substring(0, 300));
          log('  EXP:', JSON.stringify(slateValue)?.substring(0, 300));
          log('  HTML:', fieldEl.innerHTML?.substring(0, 300));
          return false;
        }
      } else {
        // Non-slate text fields: compare using same read as handleTextChange
        const resolved = this.resolveFieldPath(fieldName, blockUid);
        const targetData = this.getBlockData(resolved.blockId);
        const expected = getFieldValue(targetData, resolved.fieldName) ?? '';
        const domText = this.stripZeroWidthSpaces(fieldEl.innerText || '');
        if (domText !== String(expected)) return false;
      }
    }
    return true;
  }

  async waitForContentReady(blockElement, maxRetries = 20) {
    const blockUid = blockElement.getAttribute('data-block-uid');
    const blockData = this.getBlockData(blockUid);
    if (!blockData) return;

    const editableFields = this.getEditableFields(blockElement);
    for (const [fieldName, fieldType] of Object.entries(editableFields)) {
      if (!this.fieldTypeIsSlate(fieldType)) continue;
      const slateValue = getFieldValue(blockData, fieldName);
      if (!slateValue || !Array.isArray(slateValue)) continue;

      const fieldEl = blockElement.querySelector(`[data-edit-text="${fieldName}"]`)
        || (blockElement.getAttribute('data-edit-text') === fieldName ? blockElement : null);
      if (!fieldEl) continue;

      for (let retry = 0; retry < maxRetries; retry++) {
        const domValue = this.readSlateValueFromDOM(fieldEl, slateValue);
        if (this._deepEqual(domValue, slateValue)) {
          log('waitForContentReady: MATCH on retry', retry, 'innerHTML:', fieldEl.innerHTML?.substring(0, 200));
          break;
        }
        if (retry === 0) {
          log('waitForContentReady: content mismatch, waiting for render to complete. DOM:', fieldEl.innerHTML?.substring(0, 200), 'expected:', JSON.stringify(slateValue).substring(0, 100));
        }
        await new Promise(r => requestAnimationFrame(r));
      }
    }
  }

  /**
   * Marks empty blocks in the DOM with a data attribute for styling.
   * This allows hydra to style empty blocks without requiring the renderer
   * to add special attributes.
   */
  markEmptyBlocks() {
    const allBlocks = document.querySelectorAll('[data-block-uid]');
    allBlocks.forEach((blockElement) => {
      const blockUid = blockElement.getAttribute('data-block-uid');
      if (this.getBlockType(blockUid) === 'empty') {
        blockElement.setAttribute('data-hydra-empty', 'true');
      } else {
        blockElement.removeAttribute('data-hydra-empty');
      }
    });
  }

  /**
   * Blocks or unblocks pointer events on all editable text fields.
   * Uses a <style> element injected into <head> so it survives innerHTML
   * replacement by framework re-renders (unlike CSS classes on elements).
   * Called during re-render blocking and format-op blocking to prevent
   * user clicks from racing with restoreSlateSelection.
   */
  _setPointerBlocking(blocking) {
    if (!this._pointerBlockStyleEl) {
      this._pointerBlockStyleEl = document.createElement('style');
      this._pointerBlockStyleEl.type = 'text/css';
      document.head.appendChild(this._pointerBlockStyleEl);
    }
    const newCSS = blocking
      ? 'body { pointer-events: none !important; cursor: wait !important; }'
      : '';
    if (this._pointerBlockStyleEl.textContent !== newCSS) {
      this._pointerBlockStyleEl.textContent = newCSS;
    }
  }

  /**
   * Marks readonly blocks so the admin/tests can detect the LIVE readonly state
   * (it recomputes on every TEMPLATE_EDIT_MODE change), WITHOUT visually dimming
   * them. Locked template blocks are no longer greyed out — the Quanta toolbar's
   * lock icon (shown on selection) is the read-only affordance instead.
   *
   * A block is readonly when isBlockReadonly() returns true: in normal mode, a
   * readonly template block; in template edit mode, a template block whose
   * instance is not unlocked (the rest of the page is never locked in v2).
   *
   * Uses a dynamic CSS rule keyed by data-block-uid (resilient to framework
   * re-renders) that sets the custom property `--hydra-block-locked: 1`. It has
   * no visual effect; it's the marker the admin queries.
   */
  applyReadonlyVisuals() {
    const readonlyUids = [];
    const allBlocks = document.querySelectorAll('[data-block-uid]');
    allBlocks.forEach((blockElement) => {
      const blockUid = blockElement.getAttribute('data-block-uid');
      const blockData = this.getBlockData(blockUid);
      if (isBlockReadonly(blockData, this.templateEditMode)) {
        readonlyUids.push(blockUid);
      }
    });

    // Update or create the dynamic style element
    if (!this._readonlyStyleEl) {
      this._readonlyStyleEl = document.createElement('style');
      this._readonlyStyleEl.type = 'text/css';
      document.head.appendChild(this._readonlyStyleEl);
    }
    let newCSS = '';
    if (readonlyUids.length > 0) {
      const selector = readonlyUids.map(uid => `[data-block-uid="${uid}"]`).join(', ');
      newCSS = `${selector} { --hydra-block-locked: 1; }`;
    }
    // Only update DOM when CSS actually changes to avoid unnecessary style recalculations
    if (this._readonlyStyleEl.textContent !== newCSS) {
      this._readonlyStyleEl.textContent = newCSS;
    }
  }

  /**
   * Apply placeholder attributes to all editable text fields in the document.
   * Sets data-placeholder (from schema) and data-empty (based on content) on
   * every [data-edit-text] element whose block has a resolvedBlockSchema.
   * Called from afterContentRender so placeholders survive framework re-renders.
   */
  applyPlaceholders() {
    const editableFields = document.querySelectorAll('[data-edit-text]');
    editableFields.forEach((field) => {
      const blockEl = field.closest('[data-block-uid]');
      // Page-level fields (outside any block) use _page as blockId
      const blockUid = blockEl ? blockEl.getAttribute('data-block-uid') : PAGE_BLOCK_UID;
      const fieldPath = field.getAttribute('data-edit-text');
      const placeholder = this.getFieldPlaceholder(blockUid, fieldPath);
      if (placeholder) {
        field.setAttribute('data-placeholder', placeholder);
      } else {
        field.removeAttribute('data-placeholder');
      }
      this.updateEmptyState(field);
    });
  }

  /**
   * Updates block UI positions and states after form data changes.
   * Centralizes all UI updates that need to happen when blocks are re-rendered,
   * including after drag-and-drop reordering.
   *
   * @param {HTMLElement} blockElement - The currently selected block element.
   */
  /**
   * Watch the field the author is editing for being replaced.
   *
   * observeBlockDomChanges watches the BLOCK — it asks whether elements
   * carrying the block's uid were added, and a framework that re-renders only
   * the field inside an unchanged block never trips it. That is the case in the
   * Framework7 example, and it is the one that costs the caret.
   *
   * The restore itself is the bridge's existing one: savedClickPosition, looked
   * up by field NAME so a replaced element is found, re-derived against the new
   * element. No timer — the trigger is the mutation, and the position is
   * consumed once and cleared by the existing paths when the sidebar edits or
   * the selection moves.
   */
  observeFocusedFieldReplacement(fieldElement) {
    this._focusedFieldObserver?.disconnect();
    if (!fieldElement) return;
    const observer = new MutationObserver(() => {
      if (fieldElement.isConnected) return;
      observer.disconnect();
      this._focusedFieldObserver = null;
      const block = this.queryBlockElement(this.selectedBlockUid);
      if (block) this.restoreFocusIfFieldLost(block);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this._focusedFieldObserver = observer;
  }

  /**
   * Restore the caret ONLY if this re-render actually cost us the field.
   *
   * A frontend re-renders a block several times over one interaction, and most
   * of those leave focus intact. Restoring on every one of them looks harmless
   * but is not: the saved click position is consumed on first use, so an early
   * benign re-render spends it, and the later re-render that DOES detach the
   * field has nothing left to restore from — which is exactly how this failed.
   */
  restoreFocusIfFieldLost(blockElement) {
    if (!this.savedClickPosition || this.editMode !== 'text' || !this.focusedFieldName) return;
    const field = this.getEditableFieldByName(blockElement, this.focusedFieldName);
    if (!field || document.activeElement === field) return;
    log('observeBlockDomChanges: re-render lost the focused field, restoring', this.focusedFieldName);
    // Make it editable BEFORE focusing it. What brought us here is the old
    // node being detached, so this one is new and nothing has restored its
    // contenteditable yet — the domChange pass that does runs after us. And
    // focus() on an element that is not editable is a silent no-op: the
    // element is connected and on screen, the attribute is simply absent, so
    // activeElement stays on the body and the author's next keystroke goes
    // nowhere. The FORM_DATA path has always restored editability first
    // (updateBlockUIAfterFormData); this one only looked like it did.
    // Idempotent — the later pass logs "already editable" and moves on.
    this.restoreContentEditableOnFields(blockElement, 'restoreFocusIfFieldLost');
    this.restoreFocusFromSavedClick(blockElement);
  }

  /**
   * Put the caret back where the click put it, after the block's DOM was
   * replaced by a re-render.
   *
   * Looked up by field NAME, not by element: a re-render replaces the node, so
   * the element the click landed on no longer exists. The position is stored
   * relative to the field (savedClickPosition), so it survives the element
   * moving, and is re-derived against whatever element now carries the field.
   *
   * Called from two places, and it matters that both are re-renders rather than
   * timers: after FORM_DATA from the admin, and — see observeBlockDomChanges —
   * when the FRONTEND re-renders the selected block for its own reasons, which
   * is what Vue does in the Framework7 example on almost every activation.
   */
  restoreFocusFromSavedClick(blockElement, { skipFocus = false, fieldType = null } = {}) {
    const hasSavedClickPosition = !!this.savedClickPosition;
    if (!this.focusedFieldName || (skipFocus && !hasSavedClickPosition)) return;

    const focusedField = this.getEditableFieldByName(blockElement, this.focusedFieldName);
    const type = fieldType ?? this.getFieldType(this.selectedBlockUid, this.focusedFieldName);
    if (!focusedField || !this.fieldTypeIsTextEditable(type)) return;

    if (!skipFocus || hasSavedClickPosition) {
      focusedField.focus();
    }
    if (!this.savedClickPosition) return;

    const selection = window.getSelection();
    // An existing non-collapsed selection is the author's; don't overwrite it.
    if (selection && (!selection.rangeCount || selection.isCollapsed)) {
      const currentRect = focusedField.getBoundingClientRect();
      const clientX = currentRect.left + this.savedClickPosition.relativeX;
      const clientY = currentRect.top + this.savedClickPosition.relativeY;
      let range = this.caretRangeFromPoint(clientX, clientY);
      // The point can land outside the field once the page has moved under it;
      // fall back to the field's own text rather than caret somewhere else.
      if (range && !focusedField.contains(range.startContainer)) {
        const walker = document.createTreeWalker(focusedField, NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        range = null;
        if (textNode) {
          range = document.createRange();
          range.setStart(textNode, 0);
          range.collapse(true);
        }
      }
      if (range) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    this.savedClickPosition = null;
  }

  updateBlockUIAfterFormData(blockElement, skipFocus = false) {
    // Restore contenteditable on fields after renderer updates
    // The renderer may have replaced DOM elements, removing contenteditable attributes
    this.restoreContentEditableOnFields(blockElement, 'FORM_DATA');

    // Note: ZWS for cursor positioning is added just-in-time in restoreSlateSelection

    // Determine field type for focused field (supports page-level and nested blocks)
    const fieldType = this.focusedFieldName ? this.getFieldType(this.selectedBlockUid, this.focusedFieldName) : null;

    // Focus and position cursor in the focused field
    // This ensures clicking a field focuses it immediately (no double-click required)
    // Skip focus if editing from sidebar - don't steal focus from sidebar fields
    // EXCEPTION: If we have savedClickPosition, restore cursor because the re-render
    // may have destroyed the DOM element where cursor was positioned.
    // Note: savedClickPosition is cleared in FORM_DATA handler when content changes (sidebar edit)
    this.restoreFocusFromSavedClick(blockElement, { skipFocus, fieldType });

    // Scroll to block if not visible - BUT skip if we just finished dragging this block.
    // After drag-drop, the async renderer may not have completed yet and we'd be
    // scrolling to the OLD position. observeBlockDomChanges will scroll after re-render.
    let didScroll = false;
    const justDraggedThisBlock = this._justFinishedDragBlockId === this.selectedBlockUid;
    if (!this.elementIsVisibleInViewport(blockElement) && !justDraggedThisBlock) {
      log('updateBlockUIAfterFormData: scrolling to block', this.selectedBlockUid);
      this.scrollBlockIntoView(blockElement);
      didScroll = true;
    }

    // Send updated block position to Admin UI for toolbar/overlay positioning
    // For multi-element blocks, use combined bounding box
    const allElements = this.getAllBlockElements(this.selectedBlockUid);
    // Always convert to plain object - DOMRect is live and would cause comparison issues
    let currentRect = this.getBoundingBoxForElements(allElements);
    if (!currentRect) {
      const domRect = blockElement.getBoundingClientRect();
      currentRect = { top: domRect.top, left: domRect.left, width: domRect.width, height: domRect.height };
    }

    // For skipFocus (sidebar edits): only send if position actually changed (e.g., after drag-and-drop)
    // For !skipFocus (format operations): always send
    // IMPORTANT: Always send if we just scrolled to the block - Admin needs the new rect
    let shouldSendBlockSelected = !skipFocus || didScroll;

    if (skipFocus && !didScroll && this._lastBlockRect) {
      const topChanged = Math.abs(currentRect.top - this._lastBlockRect.top) > 1;
      const leftChanged = Math.abs(currentRect.left - this._lastBlockRect.left) > 1;

      if (topChanged || leftChanged) {
        log('Block position changed after re-render, updating toolbar');
        shouldSendBlockSelected = true;
      }
    }

    if (shouldSendBlockSelected) {
      this.sendBlockSelected('updateBlockUIAfterFormData', blockElement);
    }

    // Update _lastBlockRect for future comparisons (only if valid rect)
    if (currentRect.width > 0 && currentRect.height > 0) {
      this._lastBlockRect = currentRect;
    }
    // Drag handle position is now set in sendBlockSelected

    // Re-attach ResizeObserver to the new DOM element
    // React re-renders may have replaced the block element, so our old observer
    // would be watching a detached element. This ensures we catch future size
    // changes (e.g., image loading after a re-render).
    // For sidebar edits: pass skipInitialUpdate to prevent spurious BLOCK_SELECTED from immediate observer fire
    const editableFields = this.getEditableFields(blockElement);
    const blockElements = [...this.getAllBlockElements(this.selectedBlockUid)];
    this.observeBlockResize(blockElements, this.selectedBlockUid, editableFields, skipFocus);

    // NOTE: text change observer is NOT re-attached here — it's deferred to
    // the end of afterContentRender to avoid firing on DOM mutations from
    // restoreSlateSelection or late framework render passes.
  }

  /**
   * Mark a SELECT_BLOCK as pending because its element hasn't rendered yet, and
   * return the predicate its deferred completion must consult. Any selection
   * that lands in the meantime — the author clicking another block, a newer
   * SELECT_BLOCK — clears the mark in selectBlock(), so the late completion
   * abandons instead of yanking the selection back.
   *
   * @param {string} uid - Block uid being waited for
   * @returns {() => boolean} True if this pending selection is still wanted
   */
  awaitPendingSelect(uid) {
    this._pendingSelectUid = uid;
    return () => {
      if (this._pendingSelectUid !== uid) {
        log('Deferred SELECT_BLOCK abandoned, selection moved on:', uid);
        return false;
      }
      this._pendingSelectUid = null;
      return true;
    };
  }

  /**
   * Selects a block and communicates the selection to the adminUI.
   *
   * @param {HTMLElement|string} blockElementOrUid - The block element or block UID to select.
   */
  /**
   * Select a block. The caller decides the editing intent via options.fieldToFocus:
   *   undefined → auto (focus first editable field, set contenteditable — text mode)
   *   null      → block mode (no contenteditable, no field focus)
   *   'value'   → focus specific field
   */
  /**
   * Select the block an embed belongs to, when focus has moved into the embed.
   *
   * The companion to blockClickHandler for content we cannot receive clicks
   * from: <iframe>, <embed>, <object>. The click itself is not ours to see and
   * not ours to interfere with — the author is playing a video or scrolling a
   * PDF, and that must keep working — so selection is inferred from focus
   * instead.
   *
   * Block mode deliberately (fieldToFocus: null): pulling focus into a text
   * field would take it straight back out of the embed the author just clicked.
   */
  /**
   * Does any element of this block hold a nested browsing context?
   *
   * <iframe>, <embed> and <object> all swallow the mouse: their events belong
   * to their own document and never reach us. Used for the BLOCK_SELECTED
   * payload, and it is the same test selectBlockFromFocusedEmbed relies on.
   */
  blockHasEmbed(blockUid) {
    const holdsEmbed = (root) => {
      if (!root?.querySelector) return false;
      if (root.querySelector('iframe, embed, object')) return true;
      // querySelector does not pierce shadow DOM, and the PDF viewer keeps its
      // iframe in one — so ask each custom element that has a shadow root.
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && holdsEmbed(el.shadowRoot)) return true;
      }
      return false;
    };
    for (const element of this.getAllBlockElements(blockUid)) {
      if (holdsEmbed(element)) return true;
    }
    return false;
  }

  selectBlockFromFocusedEmbed() {
    // Window blur means focus left this browsing context, which is what a click
    // into an embed does. Whatever took the focus is still an element of THIS
    // document — the <iframe> itself, or the custom element that wraps one — so
    // asking which block it sits in is the whole test. No tag list, and no
    // shadow-root walking: closest() cannot cross a shadow boundary anyway, and
    // the host is the thing focus lands on.
    if (document.hidden) return; // a tab or app switch, not a click into an embed
    const focused = document.activeElement;
    // Only when focus went INTO something that holds a nested browsing context.
    // The window also blurs when the author clicks the admin around the iframe,
    // and activeElement is then still whatever they last focused in a block —
    // acting on that re-selects it and overrides what the admin just did.
    //
    // Asked as a property, not a tag list: an <iframe>, <embed> or <object> has
    // a contentWindow, and a custom element that wraps one (the PDF preview is
    // `<pdfjs-viewer-element>`) has a shadow root. Focus lands on the host in
    // both cases, which is what we want — closest() cannot cross out of a
    // shadow root, so the block is only reachable from the host.
    const holdsNestedContext =
      !!focused && ('contentWindow' in focused || !!focused.shadowRoot);
    if (!holdsNestedContext) return;
    const blockElement = focused.closest?.('[data-block-uid]');
    const blockUid = blockElement?.getAttribute('data-block-uid');
    if (!blockUid || blockUid === this.selectedBlockUid) return;
    log('selectBlockFromFocusedEmbed: focus left the page inside', blockUid);
    this.selectBlock(blockElement, { fieldToFocus: null });
  }

  selectBlock(blockElementOrUid, options = {}) {
    // Back-compat: old callers pass a string as second arg (caller name for logging)
    const opts = typeof options === 'string' ? {} : options;
    const fieldToFocus = opts.fieldToFocus; // undefined=auto, null=block mode, string=specific field
    // Accept either a DOM element (from click handlers) or a block UID string
    const blockUidFromArg = typeof blockElementOrUid === 'string' ? blockElementOrUid : null;

    // Get blockUid - either from argument or from element attribute
    const blockUid = blockUidFromArg || blockElementOrUid?.getAttribute?.('data-block-uid');
    if (!blockUid) return;

    // Check if this is a virtual template instance (no DOM element, but has child blocks)
    const isTemplateInstance = this.blockPathMap?.[blockUid]?.isTemplateInstance;

    // Get all elements for this block (handles multi-element blocks and template instances)
    // getAllBlockElements returns child block elements for template instances
    const blockElements = [...this.getAllBlockElements(blockUid)];

    const caller = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
    log('selectBlock called for:', blockUid, 'from:', caller, 'elements:', blockElements.length);
    if (blockElements.length === 0) return;

    // Any selection that actually lands supersedes a SELECT_BLOCK still waiting
    // for its element to render (see awaitPendingSelect). Without this the late
    // arrival steals the block the author has since clicked.
    if (this._pendingSelectUid && this._pendingSelectUid !== blockUid) {
      log('selectBlock: superseding pending SELECT_BLOCK for', this._pendingSelectUid);
      this._pendingSelectUid = null;
    }

    // Primary element for operations that need a single element
    const blockElement = blockElements[0];

    // Safety timeout: clear flag after 1500ms in case stability detection in
    // trackPosition() didn't fire (e.g., tracker was stopped by transitionend).
    // If stability detection already cleared the flag, this is a no-op.
    if (this._blockSelectorNavigating) {
      setTimeout(() => {
        if (this._blockSelectorNavigating) {
          log('selectBlock: navigation safety timeout for', blockUid);
          this._blockSelectorNavigating = false;
          if (this.selectedBlockUid === blockUid) {
            this.sendBlockSelected('navigationSettled', null, { blockUid });
          }
        }
      }, 1500);
    }

    const isSelectingSameBlock = this.selectedBlockUid === blockUid;

    // Store for use in async callback (focus handler uses this to decide preventScroll)
    this._isReselectingSameBlock = isSelectingSameBlock;

    // Only scroll block into view when selecting a NEW block (not reselecting same block)
    // This prevents unwanted scroll-back when user has scrolled the selected block off screen
    //
    // Two further reasons NOT to scroll:
    //
    // The author clicked it. They are looking at it and pointing at it, so
    // moving the page is pure interference — and worse than cosmetic: the
    // content slides out from under the pointer between the press and the next
    // click, so the next click lands on whatever took its place. That is what
    // broke editing a codeExample's tab labels — the click meant for a tab
    // landed in the code panel.
    //
    // And `partiallyVisible`, because the strict test demands the WHOLE block
    // fit inside the viewport (top >= 0 && bottom <= innerHeight). A block
    // taller than the window can never satisfy that, so selecting it scrolled
    // every single time, forever. Most real sections are taller than the window.
    const cameFromUserClick = options.fromUserClick === true;
    // `partiallyVisible` ONLY for a block that cannot satisfy the strict test:
    // taller than the window, so top >= 0 && bottom <= innerHeight is never
    // true and selecting it scrolled every single time. For anything that does
    // fit, keep demanding it fits — dropping to "partially visible" everywhere
    // left blocks half off screen where callers reasonably expect a selected
    // block to be shown in full (it broke container-edge-drag, which aims at a
    // sibling's live box after selecting its neighbour).
    const blockTallerThanViewport =
      !!blockElement && blockElement.getBoundingClientRect().height > window.innerHeight;
    const visibleEnough =
      !!blockElement &&
      this.elementIsVisibleInViewport(blockElement, blockTallerThanViewport);
    // The chrome an author just summoned has to be reachable. Toolbar, chevrons
    // and add-buttons all hang off the block's TOP edge, which for a tall block
    // is usually above the viewport — so "don't scroll, they clicked it" left
    // the quanta toolbar rendered off screen and its move chevrons unclickable.
    // Anchor visible means there is room for the toolbar above the block's top.
    const anchorRect = blockElement?.getBoundingClientRect();
    const toolbarAnchorVisible =
      !!anchorRect &&
      anchorRect.top >= Bridge.TOOLBAR_ANCHOR_MARGIN &&
      anchorRect.top < window.innerHeight;
    // Suppress the jump only when the author can already see the chrome.
    const suppressForUserClick = cameFromUserClick && toolbarAnchorVisible;
    const needsScroll = !visibleEnough || !toolbarAnchorVisible;
    if (!isSelectingSameBlock && blockElement && needsScroll && !suppressForUserClick) {
      this.scrollBlockIntoView(blockElement);
    }

    // Flush any pending text updates from the previous block before switching
    // Also clear event buffer - user is reorienting to a new block
    if (!isSelectingSameBlock) {
      this.flushPendingTextUpdates();
      this.eventBuffer = [];
    }

    // editMode is controlled by user actions only (Escape → block, click/Enter → text).
    // selectBlock never changes editMode — it just respects the current mode.
    const isBlockMode = this.editMode === 'block';

    if (!isTemplateInstance && !isBlockMode) {
      this.isInlineEditing = true;

      // Set contenteditable on all text-editable fields
      this.restoreContentEditableOnFields(blockElement, 'selectBlock');

      // For slate blocks (value field), also set up paste/keydown handlers
      let valueField = blockElement.hasAttribute('data-edit-text') &&
                       blockElement.getAttribute('data-edit-text') === 'value'
                       ? blockElement
                       : blockElement.querySelector('[data-edit-text="value"]');
      if (valueField) {
        this.makeBlockContentEditable(valueField);
      }

      // Focus specific field + cursor placement after DOM settles
      if (fieldToFocus === 'first' || fieldToFocus === 'last' || typeof fieldToFocus === 'string') {
        const cursorAt = opts.cursorAt || 'start';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const currentElement = this.queryBlockElement(blockUid);
            if (!currentElement) return;
            let targetField;
            if (fieldToFocus === 'last') {
              const fields = this.getOwnEditableFields(currentElement);
              targetField = fields[fields.length - 1] || null;
            } else if (fieldToFocus === 'first') {
              targetField = this.getOwnFirstEditableField(currentElement);
            } else {
              // Specific field name
              targetField = currentElement.querySelector(`[data-edit-text="${fieldToFocus}"]`);
            }
            if (targetField && targetField.getAttribute('contenteditable') === 'true') {
              targetField.focus();
              if (cursorAt === 'end') {
                this._placeCursorAtEnd(targetField);
              } else {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(targetField);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
              }
            }
          });
        });
      }
    }

    if (isBlockMode) {
      this.focusedFieldName = null;
    }

    // For non-editable blocks (no text fields), make the block focusable so
    // the document-level keyboard blocker receives key events. Without focus
    // in the iframe, keydown events go to the parent page instead.
    if (!isTemplateInstance) {
      const isReadonly = this.isBlockReadonly(blockUid);
      const hasEditableFields = !isReadonly && this.getOwnEditableFields(blockElement).length > 0;
      // "No editable fields" is true of a CONTAINER whose text all belongs to
      // its children — a codeExample's labels and code live on its tabs, not on
      // the wrapper. Focusing the wrapper then rips the caret out of the field
      // the author is typing in: click a tab's label, and selection of the
      // container that follows moves focus to a non-editable <div>, so the next
      // keystroke goes nowhere. The focus grab is only here so keyboard events
      // reach the iframe when there is nothing to type into — which is not the
      // case when the caret is already in something editable inside this block.
      const active = document.activeElement;
      const caretAlreadyInside =
        !!active && blockElement.contains(active) && active.isContentEditable;
      if (!hasEditableFields && !caretAlreadyInside) {
        if (!blockElement.hasAttribute('tabindex')) {
          blockElement.setAttribute('tabindex', '-1');
        }
        blockElement.focus({ preventScroll: true });
      }
    }

    // Remove border and button from the previously selected block
    const prevBlockUid = this.prevSelectedBlock?.getAttribute('data-block-uid');
    if (this.prevSelectedBlock === null || prevBlockUid !== blockUid) {
      if (this.currentlySelectedBlock) {
        this.deselectBlock(
          this.currentlySelectedBlock?.getAttribute('data-block-uid'),
          blockUid,
        );
      }

      // For template instances, there's no single element to track
      this.currentlySelectedBlock = isTemplateInstance ? null : blockElement;
      this.prevSelectedBlock = isTemplateInstance ? null : blockElement;
      if (!this.clickOnBtn) {
        window.parent.postMessage(
          { type: 'OPEN_SETTINGS', uid: blockUid },
          this.adminOrigin,
        );
      } else {
        this.clickOnBtn = false;
      }
    }

    // Set the currently selected block (do this every time)
    this.selectedBlockUid = blockUid;

    // Reset focused fields for new block - don't keep stale values from previous block
    this.focusedFieldName = null;
    this.focusedLinkableField = null;
    this.focusedMediaField = null;
    // Reset cached sizes so first FORM_DATA will send updated rects
    this.lastBlockRect = null;
    this.lastMediaFields = null;

    // Detect focused fields from click location (skip for template instances)
    if (!isTemplateInstance && this.lastClickPosition?.target) {
      // Find the clicked editable field
      const clickedElement = this.lastClickPosition.target;
      const clickedField = clickedElement.closest('[data-edit-text]');
      if (clickedField) {
        this.focusedFieldName = clickedField.getAttribute('data-edit-text');
        log('Detected focused field from click:', this.focusedFieldName);
      }

      // Detect clicked linkable and media fields
      this.focusedLinkableField = this.lastClickPosition.linkableField || null;
      this.focusedMediaField = this.lastClickPosition.mediaField || null;
      if (this.focusedLinkableField) {
        log('Detected focused linkable field from click:', this.focusedLinkableField);
      }
      if (this.focusedMediaField) {
        log('Detected focused media field from click:', this.focusedMediaField);
      }
    }

    // If no clicked field, use the first editable field that belongs to THIS block
    // Skip for template instances and block mode (no field should be focused)
    if (!isTemplateInstance && !isBlockMode && !this.focusedFieldName && blockElement) {
      const firstEditableField = this.getOwnFirstEditableField(blockElement);
      if (firstEditableField) {
        this.focusedFieldName = firstEditableField.getAttribute('data-edit-text');
        log('Set focusedFieldName to first editable field:', this.focusedFieldName);
      } else {
        // No editable fields in this block (e.g., image blocks or container blocks)
        log('No editable fields found, focusedFieldName remains null');
      }
    }

    // Store rect and show flags for BLOCK_SELECTED message (sent after selection is established)
    // Use combined bounding box for multi-element blocks and template instances
    const isMultiElement = blockElements.length > 1;
    const rect = isMultiElement
      ? this.getBoundingBoxForElements(blockElements)
      : blockElement.getBoundingClientRect();

    // For template instances, don't collect editable/linkable/media fields (they're virtual containers)
    const editableFields = isTemplateInstance ? {} : this.getEditableFields(blockElement);
    const linkableFields = isTemplateInstance ? {} : this.getLinkableFields(blockElement);
    const mediaFields = isTemplateInstance ? {} : this.getMediaFields(blockElement);
    // Get add button direction (right, bottom, hidden) - uses attribute or infers from nesting depth
    const addDirection = this.getAddDirection(blockElement);

    log('Setting _pendingBlockSelected for:', blockUid, '_justFinishedDragBlockId:', this._justFinishedDragBlockId);
    this._pendingBlockSelected = {
      blockUid,
      rect: rect ? {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      } : null,
      editableFields, // Map of fieldName -> fieldType from DOM
      linkableFields, // Map of fieldName -> true for URL/link fields
      mediaFields, // Map of fieldName -> true for image/media fields
      focusedFieldName: this.focusedFieldName,
      focusedLinkableField: this.focusedLinkableField,
      focusedMediaField: this.focusedMediaField,
      addDirection, // Direction for add button positioning
      isMultiElement, // Signal that this is a multi-element selection
    };

    log('Block selected, sending UI messages:', {
      blockUid,
      focusedFieldName: this.focusedFieldName,
      focusedLinkableField: this.focusedLinkableField,
      focusedMediaField: this.focusedMediaField,
      editableFields,
      linkableFields,
      mediaFields,
    });

    // Create drag handle for block reordering (works for all block types including template instances)
    // This creates an invisible button in the iframe positioned under the parent's visual drag handle
    // Mouse events pass through the parent's visual (which has pointerEvents: 'none') to this button
    this.createDragHandle(blockElements);

    // Observe block size changes (e.g., image loading, content changes)
    // This updates the selection outline when block dimensions change
    this.observeBlockResize(blockElements, blockUid, editableFields);

    // Observe block text changes for inline editing (skip for template instances - they're virtual)
    if (!isTemplateInstance) {
      this.observeBlockTextChanges(blockElement);
    }

    // Send BLOCK_SELECTED immediately when selectionchange won't fire:
    // - Template instances (no DOM element)
    // - Non-editable blocks (no contenteditable field)
    // - Block mode (contenteditable not set)
    {
      const isReadonly = this.isBlockReadonly(blockUid);
      const hasEditableFields = !isReadonly && this.getOwnEditableFields(blockElement).length > 0;
      const needsImmediateSend = isTemplateInstance || isBlockMode || !hasEditableFields;
      if (needsImmediateSend && this._pendingBlockSelected) {
        const pending = this._pendingBlockSelected;
        this._pendingBlockSelected = null;
        const src = isTemplateInstance ? 'templateInstance'
          : isBlockMode ? 'blockMode'
          : 'nonEditableBlock';
        log('Sending BLOCK_SELECTED immediately for:', pending.blockUid, `(${src})`,
            'mediaField:', pending.focusedMediaField, 'hasEditable:', hasEditableFields, 'isBlockMode:', isBlockMode);
        // focusedFieldName: null for a non-editable block (no text field). Block
        // mode is handled centrally by sendBlockSelected (the invariant), so it
        // needn't be re-checked here. Media/linkable fields always pass through —
        // they're set from the click and the toolbar needs them regardless.
        this.sendBlockSelected(src, blockElement, {
          blockUid: pending.blockUid,
          focusedFieldName: hasEditableFields ? pending.focusedFieldName : null,
          focusedLinkableField: pending.focusedLinkableField,
          focusedMediaField: pending.focusedMediaField,
        });
        if (isTemplateInstance) return;
      }
    }

    // Track selection changes to preserve selection across format operations
    if (!this.selectionChangeListener) {
      this.selectionChangeListener = () => {
        // Skip if we're correcting selection (prevents infinite loop)
        if (this._isCorrectingWhitespaceSelection) return;

        const selection = window.getSelection();
        const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : null;
        log('selectionchange fired:', {
          anchorOffset: selection?.anchorOffset,
          focusOffset: selection?.focusOffset,
          rangeStart: range?.startOffset,
          rangeEnd: range?.endOffset,
          collapsed: selection?.isCollapsed,
        });

        // Cross-block text drag: if selection spans multiple blocks, enter multi-block mode
        if (selection && !selection.isCollapsed && range) {
          this._checkCrossBlockSelection(range);
        }

        // Save both cursor positions (collapsed) and text selections (non-collapsed)
        if (selection && selection.rangeCount > 0) {
          // Correct cursor if it's on invalid whitespace (template artifacts)
          this._isCorrectingWhitespaceSelection = true;
          const corrected = this.correctInvalidWhitespaceSelection();
          this._isCorrectingWhitespaceSelection = false;
          if (corrected) {
            // Selection was corrected, this will trigger another selectionchange
            return;
          }

          this.savedSelection = this.serializeSelection();

          // Check if this selection matches what Admin just sent us
          // If so, this is the result of restoring their selection - don't echo it back
          if (this.expectedSelectionFromAdmin) {
            // Admin sent a selection to restore (via FORM_DATA transformedSelection).
            // Suppress ALL selectionchanges while set — they're either the
            // successful restore or re-render artifacts from DOM replacement.
            // afterContentRender clears this after restoreSlateSelection completes.
            log('selectionchange: expectedSelectionFromAdmin set, suppressing');
            return;
          } else {
            log('selectionchange: no expectedSelectionFromAdmin, sending new selection');
          }

          // IMPORTANT: Buffer selection changes WITH the text content.
          // This ensures text and selection are always atomic/in-sync. If sent
          // separately, Admin could receive stale selection that doesn't match
          // the text content, causing formats to be applied incorrectly.
          if (this.selectedBlockUid) {
            this.bufferUpdate('selectionChange');
          }
        }
      };
      document.addEventListener('selectionchange', this.selectionChangeListener);
    }

    // Use double requestAnimationFrame to wait for ALL DOM updates including rendering editable fields
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const currentBlockElement = this.queryBlockElement(this.selectedBlockUid);
        log('selectBlock focus handler:', { blockUid: this.selectedBlockUid, found: !!currentBlockElement });

        if (currentBlockElement) {
          // Detect which field should be focused if needed, and update toolbar
          if (this.needsFieldDetection) {
            this.detectFocusedFieldAndUpdateToolbar(this.selectedBlockUid);
            this.needsFieldDetection = false;
          }

          // In block mode, don't set up contenteditable or focus fields.
          // (sendBlockSelected forces focusedFieldName null in block mode.)
          if (this.editMode === 'block') {
            this.sendBlockSelected('blockMode', currentBlockElement);
          } else if (this.editMode === 'text') {

          // Check if field was already editable before we do anything
          const editableField = this.getOwnFirstEditableField(currentBlockElement);
          const wasAlreadyEditable = editableField?.getAttribute('contenteditable') === 'true';

          // Set contenteditable on editable fields immediately (not waiting for FORM_DATA)
          this.restoreContentEditableOnFields(currentBlockElement, 'selectBlock');

          // Focus and position cursor for editable fields (text or slate type)
          // Use focusedFieldName to find the specific field that was clicked, not just the first one
          let contentEditableField = this.focusedFieldName
            ? this.getEditableFieldByName(currentBlockElement, this.focusedFieldName)
            : currentBlockElement.querySelector('[contenteditable="true"]');

          // Verify the field belongs to THIS block, not a nested block
          // Container blocks (like columns) contain nested blocks with their own editable fields
          // If we find a field that belongs to a nested block, don't focus it
          //
          // Compared by UID, not element identity: a multi-element block spreads
          // one uid across sibling elements, so its own field routinely sits in
          // an element other than the one selectBlock is holding. Identity
          // comparison rejected those as "belongs to a nested block".
          if (contentEditableField) {
            const fieldBlockUid = contentEditableField
              .closest('[data-block-uid]')
              ?.getAttribute('data-block-uid');
            if (fieldBlockUid !== currentBlockElement.getAttribute('data-block-uid')) {
              log('selectBlock: editable field belongs to nested block, skipping focus');
              contentEditableField = null;
            }
          }

          if (contentEditableField) {
            const fieldPath = contentEditableField.getAttribute('data-edit-text');
            // Use activateEditableField for focus and cursor positioning
            this.activateEditableField(contentEditableField, fieldPath, this.selectedBlockUid, 'selectBlock', {
              skipContentEditable: true, // Already done above
              skipObservers: true, // Text observers set up elsewhere for blocks
              preventScroll: this._isReselectingSameBlock,
              wasAlreadyEditable,
              saveClickPosition: true, // Save for FORM_DATA handler after re-render
            });
          } else if (this.lastClickPosition) {
            // No editable field found, clear click position
            log('selectBlock: no editable field found, clearing lastClickPosition');
            this.lastClickPosition = null;
          }

          } // end editMode === 'text'

          // Now send BLOCK_SELECTED with selection - both arrive atomically
          // This prevents race conditions where toolbar gets new block but old selection
          if (this._pendingBlockSelected) {
            const serializedSelection = this.serializeSelection();
            const pendingBlockUid = this._pendingBlockSelected.blockUid;
            const pendingFocusedFieldName = this._pendingBlockSelected.focusedFieldName;
            const pendingFocusedLinkableField = this._pendingBlockSelected.focusedLinkableField;
            const pendingFocusedMediaField = this._pendingBlockSelected.focusedMediaField;
            this._pendingBlockSelected = null;
            this.sendBlockSelected('selectionChangeListener', currentBlockElement, {
              blockUid: pendingBlockUid,
              focusedFieldName: pendingFocusedFieldName,
              focusedLinkableField: pendingFocusedLinkableField,
              focusedMediaField: pendingFocusedMediaField,
              selection: serializedSelection,
            });
            log('Sent BLOCK_SELECTED with selection:', { blockUid: pendingBlockUid, selection: serializedSelection });
          }
        }
      });
    });
  }

  /**
   * Remember where a click landed, for cursor positioning once the field is
   * editable. Coordinates are relative to the FIELD, not the viewport: focus(),
   * scrolling, or a reveal can move the field before activateEditableField
   * turns them back into a caret position (caretRangeFromPoint) against its
   * rect as it is by then. Absolute coordinates would land wherever the field
   * used to be — usually collapsing the caret to the start of the text.
   *
   * @param {MouseEvent} event - The click event
   * @param {HTMLElement|null} editableField - The text field the click resolved
   *   to, or null when the click wasn't on one (the target is still recorded,
   *   for field detection).
   * @param {boolean} isInsideReadonly - Inside a readonly block (listing items
   *   and friends) linkable/media fields come from query results, not editable
   *   content, so they are ignored.
   */
  recordClickPosition(event, editableField, isInsideReadonly = false) {
    const rect = editableField?.getBoundingClientRect();
    const fieldAttr = (attr) =>
      (isInsideReadonly ? null : event.target.closest(`[${attr}]`)?.getAttribute(attr)) || null;
    this.lastClickPosition = {
      ...(editableField && {
        relativeX: event.clientX - rect.left,
        relativeY: event.clientY - rect.top,
        editableField: editableField.getAttribute('data-edit-text'),
      }),
      target: event.target, // For field detection
      linkableField: fieldAttr('data-edit-link'),
      mediaField: fieldAttr('data-edit-media'),
    };
  }

  /**
   * A data-block-selector click that landed on one of the SELECTED block's own
   * editable fields must still start inline editing.
   *
   * The plain-click path further down blockClickHandler decides text vs block
   * mode from "did this click land on a field this block owns". The selector
   * branch returns before reaching it, so a trigger that doubles as a heading —
   * an accordion panel title, a <summary> — only ever became editable when text
   * mode happened to leak in from a previously selected block. From block mode
   * (Escape, or selecting a container first) clicking the heading revealed the
   * block and left it uneditable.
   *
   * Recording the field + click point here is enough: the selectBlock that runs
   * once the target is visible reads focusedFieldName / lastClickPosition and
   * promotes the field itself, so the reveal and the caret can't race.
   *
   * Deliberately NO preventDefault: the element's default action IS the reveal
   * (a <summary> toggling its <details>). The plain-click path prevents it for
   * exactly the opposite reason — there, the default action would compete with
   * editing rather than enable it.
   *
   * @param {MouseEvent} event - The click event
   * @param {string} selector - The data-block-selector value
   */
  noteEditableFromSelectorClick(event, selector) {
    // '+1'/'-1' navigate to a SIBLING, so a field under the trigger belongs to
    // a different block than the one about to be selected — nothing to promote.
    if (selector === '+1' || selector === '-1') return;

    const field = event.target.closest('[data-edit-text]');
    if (!field) return;

    // Only when the reveal selects the very block that owns the field. A
    // carousel dot labelled with its slide's text points elsewhere; promoting
    // that field would put the caret in a block that is about to scroll away.
    // owningBlockUid, not the nearest uid element: a tab's label sits on the
    // button that reveals it, so its nearest uid ancestor is the codeExample
    // AROUND the tabs. Resolving that way made this bail, and clicking a tab
    // label stopped putting the caret in it.
    const ownerUid = this.owningBlockUid(field);
    if (ownerUid !== Bridge.primaryUidOf(selector)) return;

    // Readonly blocks (listing items and friends) render query results, not
    // editable content — same exclusion the plain-click path applies.
    if (event.target.closest('[data-block-readonly]') || this.isBlockReadonly(ownerUid)) return;

    // Touch: the first tap on a not-yet-selected block selects it without a
    // caret, so iOS word-select and long-press multi-select have a clean
    // canvas; the second tap enters text mode. Mirrors the plain-click path.
    const coarsePointer =
      typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (coarsePointer && ownerUid !== this.selectedBlockUid) {
      this.editMode = 'block';
      return;
    }

    this.recordClickPosition(event, field);
    // editMode FIRST: focusedFieldName is an accessor that drops any value
    // assigned while the mode is still 'block' (block mode has no focused
    // field). Assigning the other way round silently loses the field name, and
    // selectBlock then falls back to the block's FIRST editable field — right by
    // luck for a single-field block, wrong for every multi-field one.
    this.editMode = 'text';
    this.focusedFieldName = field.getAttribute('data-edit-text');
    log('noteEditableFromSelectorClick: will edit', this.focusedFieldName, 'of', ownerUid, 'after reveal');
    return true;
  }

  /**
   * Handle data-block-selector click to navigate between sibling blocks.
   * Used for carousel prev/next buttons, tab selectors, etc.
   *
   * @param {string} selector - The selector value: "+1", "-1", or a block UID
   * @param {HTMLElement} triggerElement - The element that was clicked
   */
  handleBlockSelector(selector, triggerElement) {
    log('handleBlockSelector:', selector, 'trigger:', triggerElement.className);

    // Direct UID selector. The value is either a single uid (e.g. a
    // carousel dot → that slide) or a space-separated word-list whose
    // FIRST uid is the block to select — accordion panel headers carry
    // `[panelUid, ...childUids]` (panel first), the rest of the list is
    // only there for tryMakeBlockVisible's `~=` reveal match. Take the
    // first token either way.
    //
    // Handled BEFORE any container/sibling lookup: a named uid says exactly
    // which block to select, so what surrounds the trigger is irrelevant. The
    // sibling scan below is only meaningful for the relative '+1'/'-1' form,
    // and requiring it here silently dropped every trigger that IS its own
    // block — an accordion panel title or tab label carrying the panel's uid,
    // whose content is a same-uid SIBLING rather than a descendant, has no
    // nested blocks to find. Those clicks reached "no child blocks found" and
    // returned, so the panel was never selected and its title never editable.
    if (selector !== '+1' && selector !== '-1') {
      const targetUid = Bridge.primaryUidOf(selector);
      log('handleBlockSelector: direct selector targetUid =', targetUid);
      // Hide outline during transition (same as +1/-1 path)
      this._blockSelectorNavigating = true;
      this.stopTransitionTracking();
      window.parent.postMessage({ type: 'HIDE_BLOCK_UI' }, this.adminOrigin);
      // Each selector navigation gets a number, and only the newest one is
      // allowed to select. The wait below is deliberately patient — it polls
      // until the revealed block has stopped moving — so a click on another
      // trigger routinely arrives while an older chain is still counting. That
      // chain would then select ITS target, and since its caret intent has
      // already been spent, `selectBlock` falls back to the block's FIRST field
      // and focuses it: click a tab label, and the caret lands in the code of
      // whichever tab you clicked before. Numbering makes the stale chain
      // notice it has been superseded and stop.
      const seq = (this._selectorNavSeq = (this._selectorNavSeq || 0) + 1);
      this.waitForBlockVisibleAndSelect(targetUid, 40, 0, null, seq);
      return;
    }

    // Relative navigation ('+1'/'-1') moves between the SIBLINGS around the
    // trigger, so from here on the container and its child blocks are required.
    const containerBlock = triggerElement.closest('[data-block-uid]');
    if (!containerBlock) {
      log('handleBlockSelector: no container found');
      return;
    }
    const containerUid = containerBlock.getAttribute('data-block-uid');
    log('handleBlockSelector: container =', containerUid);

    // Direct UID selector. The value is either a single uid (e.g. a
    // carousel dot → that slide) or a space-separated word-list whose
    // FIRST uid is the block to select — accordion panel headers carry
    // `[panelUid, ...childUids]` (panel first), the rest of the list is
    // only there for tryMakeBlockVisible's `~=` reveal match. Take the
    // first token either way.
    //
    // This MUST run before the childBlocks===0 early-return below: the trigger
    // can itself be the block's own node (a tab nav link carries data-block-uid)
    // with the rest of the block as flat siblings, so it has zero nested
    // children — returning early there swallowed the click and the block (e.g. a
    // tab, so you could edit its title) never got selected.
    if (selector !== '+1' && selector !== '-1') {
      const targetUid = selector.trim().split(/\s+/)[0];
      log('handleBlockSelector: direct selector targetUid =', targetUid);
      // Hide outline during transition (same as +1/-1 path)
      this._blockSelectorNavigating = true;
      this.stopTransitionTracking();
      window.parent.postMessage({ type: 'HIDE_BLOCK_UI' }, this.adminOrigin);
      this.waitForBlockVisibleAndSelect(targetUid);
      return;
    }

    // Get all child blocks in this container (only the +1/-1 cycling path needs
    // them).
    const allNestedBlocks = containerBlock.querySelectorAll('[data-block-uid]');
    const childBlocks = Array.from(allNestedBlocks).filter((el) => {
      const parentContainer = el.parentElement?.closest('[data-block-uid]');
      return parentContainer?.getAttribute('data-block-uid') === containerUid;
    });
    log('handleBlockSelector: childBlocks =', childBlocks.length, childBlocks.map(el => el.getAttribute('data-block-uid')));

    if (childBlocks.length === 0) {
      log('handleBlockSelector: no child blocks found');
      return;
    }

    // Helper to get fresh child blocks (DOM may re-render)
    const getFreshChildBlocks = () => {
      const container = this.queryBlockElement(containerUid);
      if (!container) return [];
      const allNested = container.querySelectorAll('[data-block-uid]');
      return Array.from(allNested).filter((el) => {
        const parent = el.parentElement?.closest('[data-block-uid]');
        return parent?.getAttribute('data-block-uid') === containerUid;
      });
    };

    // Find the child block that's most centered within the container
    // Only returns a child if it's actually visible (center within container bounds)
    const findMostCenteredChild = (children, container) => {
      const containerRect = container.getBoundingClientRect();
      const containerCenter = containerRect.left + containerRect.width / 2;

      let best = null;
      let bestDistance = Infinity;

      for (const child of children) {
        const rect = child.getBoundingClientRect();
        const childCenter = rect.left + rect.width / 2;

        // Only consider children whose center is within the container bounds
        if (childCenter < containerRect.left || childCenter > containerRect.right) {
          continue;
        }

        const distance = Math.abs(childCenter - containerCenter);

        if (distance < bestDistance) {
          bestDistance = distance;
          best = child;
        }
      }
      return best;
    };

    // For +1/-1, calculate the target block and wait for it to become visible
    // Stop any existing tracking and hide the block UI immediately
    // Set flag to prevent scroll/resize handlers from sending stale BLOCK_SELECTED
    this._blockSelectorNavigating = true;
    this.stopTransitionTracking();
    window.parent.postMessage({ type: 'HIDE_BLOCK_UI' }, this.adminOrigin);

    const currentlyVisibleElement = findMostCenteredChild(childBlocks, containerBlock);
    const currentVisibleUid = currentlyVisibleElement?.getAttribute('data-block-uid');

    // Debug: log position of all children
    childBlocks.forEach(el => {
      const uid = el.getAttribute('data-block-uid');
      const rect = el.getBoundingClientRect();
      log(`handleBlockSelector: ${uid} rect.left=${Math.round(rect.left)}`);
    });
    log('handleBlockSelector: currently visible =', currentVisibleUid);

    // Calculate the expected target block based on +1/-1
    // Compare by element reference (not UID) since multiple elements can share the same UID
    let currentIndex = childBlocks.findIndex(
      el => el === currentlyVisibleElement
    );
    if (currentIndex === -1) currentIndex = 0;

    const offset = parseInt(selector, 10);
    let targetIndex = currentIndex + offset;

    // Handle wrapping
    if (targetIndex < 0) {
      targetIndex = childBlocks.length - 1;
    } else if (targetIndex >= childBlocks.length) {
      targetIndex = 0;
    }

    const targetUid = childBlocks[targetIndex]?.getAttribute('data-block-uid');
    log('handleBlockSelector: target =', targetUid, '(index', currentIndex, '+', offset, '→', targetIndex, ')');

    // Check if target block is visible (centered within container bounds)
    // Also returns position for stability tracking
    let visibilityPollCount = 0;
    const getTargetVisibility = (container) => {
      const targetEl = this.queryBlockElement(targetUid);
      if (!targetEl || !container) {
        return { visible: false, x: null };
      }

      const containerRect = container.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const targetCenter = targetRect.left + targetRect.width / 2;

      // Target is visible if its center is within container bounds
      const visible = targetCenter >= containerRect.left && targetCenter <= containerRect.right;
      visibilityPollCount++;
      if (visibilityPollCount <= 5 || visibilityPollCount % 10 === 0) {
        log('getTargetVisibility:', targetUid, 'class:', targetEl.className.substring(0, 120),
          'rect:', JSON.stringify({l: Math.round(targetRect.left), w: Math.round(targetRect.width)}),
          'container:', JSON.stringify({l: Math.round(containerRect.left), r: Math.round(containerRect.right)}),
          'visible:', visible);
      }
      return { visible, x: targetRect.left };
    };

    // Track stability - target must be visible AND position stable
    let stableCount = 0;
    let lastX = null;
    const STABLE_THRESHOLD = 3;
    const POSITION_TOLERANCE = 2; // pixels

    // Snapshot which blocks are currently visible before the animation starts.
    // We won't accept any target position as stable until this set changes,
    // proving the carousel animation has actually begun.
    const containerForSnapshot = this.queryBlockElement(containerUid);
    const containerRectSnapshot = containerForSnapshot?.getBoundingClientRect();
    // Track initially visible elements (not just UIDs) since multiple elements
    // can share the same data-block-uid (e.g., listing items in a carousel).
    const initialVisibleElements = new Set();
    if (containerRectSnapshot) {
      for (const child of childBlocks) {
        const rect = child.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        if (center >= containerRectSnapshot.left && center <= containerRectSnapshot.right) {
          initialVisibleElements.add(child);
        }
      }
    }
    let visibilityChanged = false;
    log('handleBlockSelector: initial visible blocks:', [...initialVisibleElements].map(el => el.getAttribute('data-block-uid')));

    // Get the set of child block UIDs for checking if user navigated away
    const childUids = new Set(childBlocks.map(el => el.getAttribute('data-block-uid')));

    // Wait for target to become visible AND position to stabilize
    const waitForTarget = (retries = 40) => {
      // Check if user has navigated away (e.g., pressed Escape, clicked different block)
      // Cancel if the selected block is no longer one of the children we're navigating
      if (this.selectedBlockUid && !childUids.has(this.selectedBlockUid)) {
        log('handleBlockSelector: user navigated away, canceling child selection. selected:', this.selectedBlockUid);
        return;
      }

      const container = this.queryBlockElement(containerUid);
      const freshChildBlocks = getFreshChildBlocks();

      const { visible, x } = getTargetVisibility(container);

      // Check if the set of visible blocks has changed from the initial snapshot.
      // During carousel transitions, multiple slides can be visible simultaneously.
      // We must wait until the visible set changes before accepting any position as stable,
      // otherwise we might catch a transient state before the animation has even begun.
      if (!visibilityChanged && container) {
        const containerRect = container.getBoundingClientRect();
        const currentVisible = new Set();
        for (const child of freshChildBlocks) {
          const rect = child.getBoundingClientRect();
          const center = rect.left + rect.width / 2;
          if (center >= containerRect.left && center <= containerRect.right) {
            currentVisible.add(child);
          }
        }
        // Check if the visible set differs from the initial snapshot (by element reference)
        if (currentVisible.size !== initialVisibleElements.size ||
            [...currentVisible].some(el => !initialVisibleElements.has(el))) {
          visibilityChanged = true;
          log('handleBlockSelector: visible blocks changed, animation started');
        }
      }

      if (visible && visibilityChanged) {
        // Check if position is also stable (not animating)
        const positionStable = lastX !== null && Math.abs(x - lastX) < POSITION_TOLERANCE;

        if (positionStable) {
          stableCount++;
        } else {
          stableCount = 0; // Reset if position changed
        }
        lastX = x;

        if (retries === 40 || retries === 30 || retries === 20 || retries === 10 || retries === 1) {
          log(`handleBlockSelector poll: retries=${retries} target=${targetUid} visible=true x=${Math.round(x)} stableCount=${stableCount}`);
        }

        if (stableCount >= STABLE_THRESHOLD) {
          log('handleBlockSelector: target visible and position stable, selecting', targetUid);
          // Keep _blockSelectorNavigating true - selectBlock will clear it after 1500ms
          // sendBlockSelected allows initial selection sources through while suppressing position tracking
          const targetElement = this.queryBlockElement(targetUid);
          if (targetElement) {
            this.selectBlock(targetElement);
          }
          return;
        }
      } else {
        stableCount = 0;
        lastX = null;
        if (retries === 40 || retries === 30 || retries === 20 || retries === 10 || retries === 1) {
          log(`handleBlockSelector poll: retries=${retries} target=${targetUid} visible=false`);
        }
      }

      if (retries > 0) {
        setTimeout(() => waitForTarget(retries - 1), 50);
      } else {
        // Target never became visible - fall back to most centered child
        log('handleBlockSelector: target not visible after settling, finding most centered');
        const centeredChild = container ? findMostCenteredChild(freshChildBlocks, container) : null;
        const centeredUid = centeredChild?.getAttribute('data-block-uid');
        log('handleBlockSelector: fallback to most centered =', centeredUid);
        // Keep _blockSelectorNavigating true - selectBlock will clear it after 1500ms
        if (centeredChild) {
          this.selectBlock(centeredChild);
        } else if (container) {
          // No child found - select the parent container
          log('handleBlockSelector: no centered child found, selecting parent container');
          this.selectBlock(container);
        }
      }
    };

    // Start after a short delay to let click event propagate to frontend
    setTimeout(waitForTarget, 50);
  }

  /**
   * Fallback for +1/-1 selection when visibility doesn't change.
   * Used for carousels that use transforms instead of hiding elements.
   */
  handleBlockSelectorFallback(selector, childBlocks, currentVisibleUid) {
    let currentIndex = childBlocks.findIndex(
      el => el.getAttribute('data-block-uid') === currentVisibleUid
    );
    if (currentIndex === -1) currentIndex = 0;

    const offset = parseInt(selector, 10);
    let targetIndex = currentIndex + offset;

    // Handle wrapping
    if (targetIndex < 0) {
      targetIndex = childBlocks.length - 1;
    } else if (targetIndex >= childBlocks.length) {
      targetIndex = 0;
    }

    const targetUid = childBlocks[targetIndex]?.getAttribute('data-block-uid');
    log('handleBlockSelector fallback: targetUid =', targetUid);

    if (targetUid) {
      const targetElement = this.queryBlockElement(targetUid);
      if (targetElement) {
        this.selectBlock(targetElement);
      }
    }
  }

  /**
   * Wait for a specific block to become visible AND position stable, then select it.
   * Uses same stability check as the +1/-1 path to avoid selecting during animation.
   */
  /**
   * Put the caret back in the field the author clicked, once the reveal that
   * click started has finished and the block is selected.
   *
   * Only for a field that lives OUTSIDE the block's own element — a tab's label
   * sits on the button that reveals the panel, and the uid is on the panel. When
   * the field is inside the block (an accordion summary that is both trigger and
   * heading) selection already handles it, and stepping in here would spend
   * savedClickPosition, which is consumed on first use — leaving the real
   * restore with nothing and the caret at position 0.
   */
  restoreSelectorCaret(targetUid) {
    const pending = this._pendingSelectorCaret;
    if (!pending || pending.uid !== targetUid) return;
    this._pendingSelectorCaret = null;

    const blockElement = this.queryBlockElement(targetUid);
    const field = blockElement
      ? this.getEditableFieldByName(blockElement, pending.fieldName)
      : null;
    if (!field || blockElement.contains(field)) return;
    if (field.getAttribute('contenteditable') !== 'true') return;

    // Already in the field — including a caret the browser placed inside it —
    // leave it exactly where the author clicked. Focusing again resets the caret
    // to the start, which turned typing into "XSection navigation" instead of
    // "Section Xnavigation".
    const active = document.activeElement;
    if (active === field || field.contains(active)) return;

    // The intent is re-stated from the record, not read back out of live state.
    // Selection is deliberately deferred until the revealed block has stopped
    // moving, and in that window the block the author was editing BEFORE
    // finishes its own selection work — which clears `lastClickPosition` and
    // drops `focusedFieldName` on the way out. Those are what the restore below
    // reads, so a click that took the slow path lost its caret silently.
    this.editMode = 'text';
    this.focusedFieldName = pending.fieldName;

    // restoreFocusFromSavedClick, not focus(): it puts the caret back where the
    // click landed, where focus() would drop it at position 0.
    this.restoreFocusFromSavedClick(blockElement);
    // …and when the saved click is gone as well, the field itself is still the
    // right place to be: the start of the field the author clicked beats a caret
    // left in another block entirely.
    if (document.activeElement !== field && !field.contains(document.activeElement)) {
      field.focus();
    }
  }

  waitForBlockVisibleAndSelect(targetUid, retries = 40, stableCount = 0, lastX = null, seq = 0) {
    // Superseded: a newer trigger has been clicked since this chain started, so
    // selecting now would move the author away from what they just clicked.
    if (seq && seq !== this._selectorNavSeq) {
      log('handleBlockSelector: chain for', targetUid, 'superseded, stopping');
      return;
    }
    const STABLE_THRESHOLD = 3;
    const POSITION_TOLERANCE = 2;

    const targetElement = this.queryBlockElement(targetUid);
    if (targetElement && !this.isElementHidden(targetElement)) {
      const rect = targetElement.getBoundingClientRect();
      const x = rect.left;
      const positionStable = lastX !== null && Math.abs(x - lastX) < POSITION_TOLERANCE;

      if (positionStable) {
        stableCount++;
      } else {
        stableCount = 0;
      }

      if (stableCount >= STABLE_THRESHOLD) {
        log('handleBlockSelector: selecting (position stable)', targetUid);
        this.selectBlock(targetElement, { fromUserClick: !!this._pendingSelectorCaret });
        this.restoreSelectorCaret(targetUid);
        return;
      }

      // Visible but not stable yet - keep polling
      if (retries > 0) {
        setTimeout(() => this.waitForBlockVisibleAndSelect(targetUid, retries - 1, stableCount, x, seq), 50);
      } else {
        log('handleBlockSelector: selecting (retries exhausted)', targetUid);
        this.selectBlock(targetElement, { fromUserClick: !!this._pendingSelectorCaret });
        this.restoreSelectorCaret(targetUid);
      }
    } else if (retries > 0) {
      setTimeout(() => this.waitForBlockVisibleAndSelect(targetUid, retries - 1, 0, null, seq), 50);
    } else {
      log('handleBlockSelector: block not visible after retries', targetUid);
    }
  }

  /**
   * Deselects a block and updates the frontend accordingly.
   *
   * @param {string} prevSelectedBlockUid - The UID of the previously selected block.
   * @param {string} currentSelectedBlockUid - The UID of the currently selected block.
   */
  deselectBlock(prevBlockUid, currBlockUid) {
    const prevBlockElement = document.querySelector(
      `[data-block-uid="${prevBlockUid}"]`,
    );

    if (
      prevBlockUid !== null &&
      prevBlockUid !== currBlockUid &&
      prevBlockElement
    ) {
      // Send HIDE_BLOCK_UI message to parent to hide selection outline, toolbar, and add button
      window.parent.postMessage(
        { type: 'HIDE_BLOCK_UI' },
        this.adminOrigin,
      );

      // Remove drag handle and its event listeners
      const dragHandle = document.querySelector('.volto-hydra-drag-button');
      if (dragHandle) {
        dragHandle.remove();
      }
      if (this.dragHandleScrollListener) {
        window.removeEventListener('scroll', this.dragHandleScrollListener, true);
        this.dragHandleScrollListener = null;
      }
      this.dragHandlePositioner = null;

      if (this.blockObserver) {
        this.blockObserver.disconnect();
      }

      // Remove contenteditable attribute
      prevBlockElement.removeAttribute('contenteditable');
      const childNodes = prevBlockElement.querySelectorAll('[data-node-id]');
      childNodes.forEach((node) => {
        node.removeAttribute('contenteditable');
      });

      // Clean up JSON structure
      // if (this.formData.blocks[this.selectedBlockUid]["@type"] === "slate") this.resetJsonNodeIds(this.formData.blocks[this.selectedBlockUid]);
    }
    document.removeEventListener('mouseup', this.handleMouseUp);
    // Disconnect the mutation observer
    if (this.blockTextMutationObserver) {
      this.blockTextMutationObserver.disconnect();
      this.blockTextMutationObserver = null;
    }
    if (this.attributeMutationObserver) {
      this.attributeMutationObserver.disconnect();
      this.attributeMutationObserver = null;
    }
    if (this.handleObjectBrowserMessage) {
      window.removeEventListener('message', this.handleObjectBrowserMessage);
      this.handleObjectBrowserMessage = null;
    }
    // Clean up block resize observer
    if (this.blockResizeObserver) {
      this.blockResizeObserver.disconnect();
      this.blockResizeObserver = null;
    }
  }

  /**
   * Observes the selected block for size changes (e.g., image loading, content changes).
   * When the block's size changes, sends an updated BLOCK_SELECTED message to update the selection outline.
   * For multi-element blocks, observes ALL elements and recomputes combined bounding box.
   *
   * @param {Array} blockElements - Array of DOM elements for the block (used for initial rect fallback).
   * @param {string} blockUid - The block's UID.
   * @param {Object} editableFields - Map of fieldName -> fieldType for editable fields in this block.
   */
  observeBlockResize(blockElements, blockUid, editableFields, skipInitialUpdate = false) {
    log('observeBlockResize called for block:', blockUid, 'skipInitialUpdate:', skipInitialUpdate);

    // Skip if already observing the same block AND the current DOM elements match observed
    // ResizeObserver fires immediately when attached - recreating it causes spurious updates
    // After re-render, element references change but we're still on same block
    // For multi-element blocks, we must check ALL elements, not just one
    if (this._lastBlockRectUid === blockUid && this.blockResizeObserver && this._observedElements?.length > 0) {
      // Check if ALL observed elements are still in the DOM
      const allStillConnected = this._observedElements.every(el => document.body.contains(el));
      // Also check if current DOM elements match what we're observing
      // (re-render may have created new elements)
      const currentElements = this.getAllBlockElements(blockUid);
      const elementsMatch = currentElements.length === this._observedElements.length &&
        Array.from(currentElements).every(el => this._observedElements.includes(el));
      log('observeBlockResize: allStillConnected:', allStillConnected, 'elementsMatch:', elementsMatch, 'observed:', this._observedElements.length, 'current:', currentElements.length);
      if (allStillConnected && elementsMatch) {
        log('observeBlockResize: already observing this block, skipping');
        return;
      }
      log('observeBlockResize: elements changed, re-attaching to new elements');
    }

    // Clean up any existing observer
    if (this.blockResizeObserver) {
      this.blockResizeObserver.disconnect();
    }

    // Get all elements for multi-element blocks
    const allElements = this.getAllBlockElements(blockUid);

    // Store initial dimensions using combined bounding box for multi-element blocks
    // Use instance variable so it persists across observer recreations
    // Only reset if this is a different block
    // Always convert to plain object - DOMRect is live and would cause comparison issues
    let currentRect = this.getBoundingBoxForElements(allElements);
    if (!currentRect && blockElements?.[0]) {
      const domRect = blockElements[0].getBoundingClientRect();
      currentRect = { top: domRect.top, left: domRect.left, width: domRect.width, height: domRect.height };
    }
    if (!this._lastBlockRect || this._lastBlockRectUid !== blockUid) {
      this._lastBlockRect = currentRect;
      this._lastBlockRectUid = blockUid;
    } else if (skipInitialUpdate) {
      // Don't update _lastBlockRect - let updateBlockUIAfterFormData compare and update it
      // This preserves the pre-update position for comparison after re-render
    }
    this._observedElements = Array.from(allElements);
    log('observeBlockResize initial rect:', { width: currentRect.width, height: currentRect.height }, 'observing', allElements.length, 'elements');

    this.blockResizeObserver = new ResizeObserver((entries) => {
      log('ResizeObserver callback fired for:', blockUid);
      // Only process if this is still the selected block
      if (this.selectedBlockUid !== blockUid) {
        log('ResizeObserver: block no longer selected, ignoring');
        return;
      }

      // For multi-element blocks, recompute the combined bounding box from fresh DOM query
      // Don't check entries[0].isConnected - for multi-element blocks, some elements may
      // be detached while others are still valid. The fresh query handles this.
      const freshElements = this.getAllBlockElements(blockUid);
      if (freshElements.length === 0) {
        log('ResizeObserver: no elements found, ignoring');
        return;
      }
      const newRect = this.getBoundingBoxForElements(freshElements);
      if (!newRect) {
        log('ResizeObserver: could not compute bounding box, ignoring');
        return;
      }
      const lastRect = this._lastBlockRect;

      // Compare with last rect if we have one, or update if we now have valid dimensions
      const hadValidLastRect = lastRect && (lastRect.width > 0 || lastRect.height > 0);
      const widthChanged = hadValidLastRect ? Math.abs(newRect.width - lastRect.width) > 1 : false;
      const heightChanged = hadValidLastRect ? Math.abs(newRect.height - lastRect.height) > 1 : false;
      const topChanged = hadValidLastRect ? Math.abs(newRect.top - lastRect.top) > 1 : false;
      const leftChanged = hadValidLastRect ? Math.abs(newRect.left - lastRect.left) > 1 : false;
      const dimensionsChanged = widthChanged || heightChanged || topChanged || leftChanged;

      // Update if: dimensions changed, OR we went from invalid/zero to valid rect
      const shouldUpdate = dimensionsChanged || (!hadValidLastRect && newRect.height > 0);

      log('ResizeObserver: comparing rects - last:', lastRect?.height || 0, 'new:', newRect.height, 'shouldUpdate:', shouldUpdate);

      // Always update _lastBlockRect if we have a valid new rect
      this._lastBlockRect = newRect;

      if (shouldUpdate) {
        log('Block size changed, updating selection outline:', blockUid,
          'old:', lastRect?.top || 0, lastRect?.left || 0, lastRect?.width || 0, lastRect?.height || 0,
          'new:', newRect.top, newRect.left, newRect.width, newRect.height);

        // Send updated BLOCK_SELECTED with new rect
        // Pass blockUid so template instances use the correct UID (not the child element's UID)
        this.sendBlockSelected('resizeObserver', null, { blockUid });
      }
    });

    // Observe ALL elements of multi-element blocks
    for (const element of allElements) {
      this.blockResizeObserver.observe(element, { box: 'border-box' });
    }

    // Also observe DOM structure changes for async rendering
    // (e.g., listing blocks that fetch results after initial render)
    this.observeBlockDomChanges(blockUid);

    // Also track position during CSS transitions (e.g., carousel slide animations)
    this.observeBlockTransition(blockElements, blockUid);
  }

  /**
   * Observes DOM structure changes for the selected block.
   * Async rendering (e.g., listing blocks fetching results) may replace elements
   * after we've attached ResizeObserver. This MutationObserver detects when that
   * happens and re-attaches the ResizeObserver to the new elements.
   *
   * @param {string} blockUid - The block's UID to watch for.
   */
  observeBlockDomChanges(blockUid) {
    // Clean up existing observer
    if (this._domMutationObserver) {
      this._domMutationObserver.disconnect();
    }

    // Observe document.body to catch all DOM changes including footer blocks
    const container = document.body;

    this._domMutationObserver = new MutationObserver((mutations) => {
      // Only process if this is still the selected block
      if (this.selectedBlockUid !== blockUid) {
        return;
      }

      // Check if any mutations added elements with our block UID
      let relevantChange = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check added nodes for our block UID
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                node.getAttribute?.('data-block-uid') === blockUid ||
                node.querySelector?.(`[data-block-uid="${blockUid}"]`)
              ) {
                relevantChange = true;
                break;
              }
            }
          }
          if (relevantChange) break;
        }
      }

      if (!relevantChange) return;

      log('observeBlockDomChanges: detected relevant DOM change for', blockUid);

      // Materialize any new hydra comments (e.g., from async Suspense content)
      this.materializeHydraComments();

      // Check if our observed elements are still in the DOM
      if (!this._observedElements?.length) return;

      const currentElements = this.getAllBlockElements(blockUid);
      const elementsMatch =
        currentElements.length === this._observedElements.length &&
        Array.from(currentElements).every((el) =>
          this._observedElements.includes(el),
        );

      if (elementsMatch) {
        // The block's own elements survived — but a framework re-renders as
        // little as it can, and replacing just the FIELD is enough to lose the
        // caret: the node the author was typing in is detached, focus falls back
        // to BODY, and the next selection picks the block's first field instead
        // of theirs. Restore from the same saved click position.
        this.restoreFocusIfFieldLost(currentElements[0]);
        log('observeBlockDomChanges: elements still match, no action needed');
        return;
      }

      log(
        'observeBlockDomChanges: elements changed, re-attaching ResizeObserver',
        'old:',
        this._observedElements.length,
        'new:',
        currentElements.length,
      );

      // The selected block's elements were REPLACED. Whatever the author was
      // editing is now a detached node, so focus and the caret are gone —
      // activeElement falls back to BODY and the next selection lands on the
      // block's first field instead of theirs. This is the same loss FORM_DATA
      // already restores from; the only difference is that the frontend
      // re-rendered for its own reasons (Vue patching a block in the Framework7
      // example) rather than because the admin sent data. Same saved position,
      // same restore.
      this.restoreFocusIfFieldLost(currentElements[0]);

      // Elements have changed - re-attach ResizeObserver
      if (this.blockResizeObserver) {
        this.blockResizeObserver.disconnect();

        // Update _lastBlockRect BEFORE observing - observe() fires callback immediately
        const newRect = this.getBoundingBoxForElements(currentElements);
        if (newRect && (newRect.width > 0 || newRect.height > 0)) {
          this._lastBlockRect = newRect;
        }

        // Observe the new elements
        this._observedElements = Array.from(currentElements);
        for (const element of currentElements) {
          this.blockResizeObserver.observe(element, { box: 'border-box' });
        }

        // Send updated selection (debounced to wait for animations to settle)
        if (newRect && (newRect.width > 0 || newRect.height > 0)) {
          const firstElement = currentElements[0];
          if (firstElement) {
            // Restore contenteditable on fields - DOM elements may have been replaced
            // This is needed when the renderer re-renders (e.g., after checkbox toggle)
            this.restoreContentEditableOnFields(firstElement, 'domChange');

            // Debounce BLOCK_SELECTED to wait for animations (carousel transitions, etc.)
            // This prevents sending intermediate positions during animation
            if (this._domChangeDebounce) {
              clearTimeout(this._domChangeDebounce);
            }
            this._domChangeDebounce = setTimeout(() => {
              this._domChangeDebounce = null;
              // Only send BLOCK_SELECTED if this block is still the selected block
              // When adding a child block, the parent's DOM changes but selection has moved
              if (blockUid !== this.selectedBlockUid) {
                log('observeBlockDomChanges: skipping BLOCK_SELECTED, selection changed to', this.selectedBlockUid);
                return;
              }
              // Re-check element is still valid and get fresh rect
              const freshElements = this.getAllBlockElements(blockUid);
              if (freshElements.length > 0) {
                // Scroll to block if not visible AND we were waiting for this dragged block
                // (prevents unwanted scrolling on normal DOM changes like size updates)
                if (this._justFinishedDragBlockId === blockUid) {
                  if (!this.elementIsVisibleInViewport(freshElements[0])) {
                    log('observeBlockDomChanges: scrolling to dragged block', blockUid);
                    this.scrollBlockIntoView(freshElements[0]);
                  }
                  // Always clear after processing - drag is complete
                  this._justFinishedDragBlockId = null;
                }
                this.sendBlockSelected('domChange', null, { blockUid });
              }
            }, 150); // Wait for animation to settle
            // Drag handle position is now set in sendBlockSelected
          }
        }
      }
    });

    // Observe the container for childList changes in the subtree
    this._domMutationObserver.observe(container, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Stops all block position tracking immediately.
   * Called when navigating to a new block to prevent stale position updates.
   */
  stopTransitionTracking() {
    if (this._transitionAnimationFrame) {
      cancelAnimationFrame(this._transitionAnimationFrame);
      this._transitionAnimationFrame = null;
    }
    if (this._initialTrackingTimeout) {
      clearTimeout(this._initialTrackingTimeout);
      this._initialTrackingTimeout = null;
    }
    if (this._transitionMutationObserver) {
      this._transitionMutationObserver.disconnect();
      this._transitionMutationObserver = null;
    }
    // Remove transitionend listener from the tracked element
    if (this._transitionEndHandler && this._trackedBlockElement) {
      this._trackedBlockElement.removeEventListener(
        'transitionend',
        this._transitionEndHandler,
      );
      this._transitionEndHandler = null;
      this._trackedBlockElement = null;
    }
    // Also disconnect resize observer to prevent stale updates
    if (this.blockResizeObserver) {
      this.blockResizeObserver.disconnect();
      this.blockResizeObserver = null;
    }
    // Also disconnect DOM mutation observer
    if (this._domMutationObserver) {
      this._domMutationObserver.disconnect();
      this._domMutationObserver = null;
    }
    // Clear scroll timeout that might re-send position updates
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
    // Clear the uid to stop any in-flight tracking loops
    this._trackingBlockUid = null;
  }

  /**
   * Tracks block position during CSS transitions/animations.
   * ResizeObserver doesn't fire for transform changes, so we poll during transitions.
   * For multi-element blocks, observes ALL elements and uses combined bounding box.
   *
   * @param {Array} blockElements - Array of DOM elements to observe.
   * @param {string} blockUid - The block's UID.
   */
  observeBlockTransition(blockElements, blockUid) {
    if (!blockElements || blockElements.length === 0) return;

    // Clean up existing transition tracking
    if (this._transitionAnimationFrame) {
      cancelAnimationFrame(this._transitionAnimationFrame);
      this._transitionAnimationFrame = null;
    }
    // Remove listeners from previously tracked elements
    if (this._transitionEndHandler && this._trackedBlockElements) {
      for (const el of this._trackedBlockElements) {
        el.removeEventListener('transitionend', this._transitionEndHandler);
      }
    }
    if (this._initialTrackingTimeout) {
      clearTimeout(this._initialTrackingTimeout);
      this._initialTrackingTimeout = null;
    }

    let isTracking = false;
    this._trackingBlockUid = blockUid;

    const trackPosition = () => {
      // Stop if tracking was cancelled or block changed
      if (!isTracking || this._trackingBlockUid !== blockUid) {
        return;
      }
      // During carousel navigation, keep tracking position internally but don't
      // send updates to the admin UI. Detect when the animation settles (position
      // stable for ~200ms) and then send the final position.
      if (this._blockSelectorNavigating) {
        const newRect = this.getBoundingBoxForElements(blockElements);
        if (newRect) {
          const lastRect = this._lastBlockRect;
          const positionChanged = !lastRect ||
            Math.abs(newRect.left - lastRect.left) > 1 ||
            Math.abs(newRect.top - lastRect.top) > 1;
          this._lastBlockRect = newRect;

          if (positionChanged) {
            this._navStableFrames = 0;
          } else {
            this._navStableFrames = (this._navStableFrames || 0) + 1;
            // Position stable for ~200ms (12 frames at 60fps) — animation settled
            if (this._navStableFrames >= 12) {
              log('trackPosition: navigation settled for', blockUid);
              this._blockSelectorNavigating = false;
              this._navStableFrames = 0;
              this.sendBlockSelected('navigationSettled', blockElements[0]);
              stopTracking();
              return;
            }
          }
        }
        this._transitionAnimationFrame = requestAnimationFrame(trackPosition);
        return;
      }

      // Use combined bounding box for multi-element blocks
      const newRect = this.getBoundingBoxForElements(blockElements);
      if (!newRect) {
        this._transitionAnimationFrame = requestAnimationFrame(trackPosition);
        return;
      }
      const lastRect = this._lastBlockRect;

      if (lastRect) {
        const topChanged = Math.abs(newRect.top - lastRect.top) > 1;
        const leftChanged = Math.abs(newRect.left - lastRect.left) > 1;

        if (topChanged || leftChanged) {
          this._lastBlockRect = newRect;
          // Pass blockUid explicitly: for template instances (virtual
          // containers) blockElements[0] is a CHILD element whose
          // data-block-uid is the child's, not the instance's. Without
          // an explicit uid, sendBlockSelected resolves the wrong block
          // and fires BLOCK_SELECTED with isNewBlock:true mid-transition,
          // which can trip react-beautiful-dnd's "changing droppableId
          // during drag" invariant in the sidebar.
          this.sendBlockSelected('transitionTracker', blockElements[0], { blockUid });
        }
      }

      this._transitionAnimationFrame = requestAnimationFrame(trackPosition);
    };

    // Start tracking when transition starts (detected by style changes)
    const startTracking = () => {
      if (!isTracking) {
        isTracking = true;
        log('observeBlockTransition: starting position tracking for:', blockUid);
        trackPosition();
      }
    };

    const stopTracking = () => {
      // During carousel navigation, don't stop — the stability detection in
      // trackPosition() needs the rAF loop to keep running
      if (this._blockSelectorNavigating) {
        log('observeBlockTransition: deferring stop during navigation for:', blockUid);
        return;
      }

      isTracking = false;
      if (this._transitionAnimationFrame) {
        cancelAnimationFrame(this._transitionAnimationFrame);
        this._transitionAnimationFrame = null;
      }
      log('observeBlockTransition: stopped tracking for:', blockUid);

      // Final position update using combined bounding box
      if (this.selectedBlockUid === blockUid) {
        const finalRect = this.getBoundingBoxForElements(blockElements);
        if (finalRect && this._lastBlockRect) {
          const moved = Math.abs(finalRect.left - this._lastBlockRect.left) > 1 ||
                        Math.abs(finalRect.top - this._lastBlockRect.top) > 1;
          if (moved) {
            this._lastBlockRect = finalRect;
            this.sendBlockSelected('transitionEnd', blockElements[0]);
          }
        }
      }
    };

    // Stop tracking when transition ends on ANY element
    this._transitionEndHandler = stopTracking;
    this._trackedBlockElements = blockElements;

    // Attach listeners to ALL elements
    for (const el of blockElements) {
      el.addEventListener('transitionend', this._transitionEndHandler);
    }

    // Use MutationObserver to detect when transform/translate classes change on ANY element
    if (this._transitionMutationObserver) {
      this._transitionMutationObserver.disconnect();
    }

    this._transitionMutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' &&
            (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
          const style = window.getComputedStyle(mutation.target);
          // Check if element has a transition and transform
          if (style.transition && style.transition !== 'none' &&
              (style.transform !== 'none' || style.translate !== 'none')) {
            startTracking();
          }
        }
      }
    });

    // Observe ALL elements for attribute changes
    for (const el of blockElements) {
      this._transitionMutationObserver.observe(el, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }

    // Always do initial position tracking for 500ms after selection
    // This catches animations on parent elements (e.g., Flowbite carousel)
    // where the transform is not directly on the selected block
    startTracking();
    this._initialTrackingTimeout = setTimeout(() => {
      // Only stop if no ongoing transition was detected
      // (transitionend handler will stop it if one was detected)
      // During carousel navigation, keep tracking — stability detection
      // in trackPosition() will handle the stop when animation settles
      if (isTracking && this.selectedBlockUid === blockUid && !this._blockSelectorNavigating) {
        stopTracking();
      }
    }, 500);
  }

  /**
   * Sets up mouse tracking to position drag handle dynamically.
   * The drag handle is positioned on mousemove to avoid being destroyed by re-renders.
   *
   * @param {Array} blockElements - Array of DOM elements for the selected block (not used directly,
   *                                but included for API consistency - we use getAllBlockElements internally)
   */
  createDragHandle(blockElements) {

    // Remove any existing drag handle
    const existingDragHandle = document.querySelector('.volto-hydra-drag-button');
    if (existingDragHandle) {
      existingDragHandle.remove();
    }

    // Create a single persistent drag button that follows the mouse
    const dragButton = document.createElement('button');
    dragButton.className = 'volto-hydra-drag-button';
    Object.assign(dragButton.style, {
      position: 'fixed',
      width: '40px',
      height: '48px',
      opacity: '0', // Invisible - parent shows the visual
      cursor: 'grab',
      zIndex: '9999',
      background: 'transparent',
      border: 'none',
      padding: '0',
      pointerEvents: 'auto',
      display: 'none', // Hidden until positioned
    });

    document.body.appendChild(dragButton);

    // Container edge handles — one per side. Each handle is shown only when
    // its edge has something actionable: a compatible neighbour to absorb
    // (in the parent's layout axis) or a child to expel (in the container's
    // own layout axis). Drag outward absorbs neighbours; drag inward (back
    // into the container's rect) expels the closest children to the parent.
    document.querySelectorAll('.volto-hydra-edge-handle').forEach((el) => el.remove());
    this._edgeHandles = {};
    // Edge handles follow the chrome pattern (see docs/architecture.md):
    //   - the visible chrome is rendered by the admin from blockUI.edgeRects;
    //   - this iframe-side div is *invisible* and only exists to capture
    //     mouse events that pass through the admin's pointer-events:none
    //     visual on top of it.
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      const h = document.createElement('div');
      h.className = 'volto-hydra-edge-handle';
      h.setAttribute('data-edge', edge);
      const isVertical = edge === 'top' || edge === 'bottom';
      Object.assign(h.style, {
        position: 'fixed',
        background: 'transparent',
        cursor: isVertical ? 'ns-resize' : 'ew-resize',
        zIndex: '9998',
        display: 'none',
        pointerEvents: 'auto',
      });
      // Thickness on the perpendicular axis
      if (isVertical) h.style.height = '6px'; else h.style.width = '6px';
      document.body.appendChild(h);
      this._edgeHandles[edge] = h;
      this._setupEdgeHandleDrag(h);
    }

    // Position the drag handle immediately (not on mousemove)
    const positionDragHandle = () => {
      if (!this.selectedBlockUid) {
        dragButton.style.display = 'none';
        return;
      }

      // Get all elements for this block (multi-element blocks like listings)
      // Chrome measures the block itself; a stand-in is handled by the
      // placement helper below, not by widening the rect.
      const allElements = this.getAllBlockElements(this.selectedBlockUid, {
        includeStandIns: false,
      });
      if (allElements.length === 0) {
        dragButton.style.display = 'none';
        return;
      }

      // Use bounding box for multi-element blocks
      let rect;
      if (allElements.length > 1) {
        rect = this.getBoundingBoxForElements(allElements);
        if (!rect) {
          rect = allElements[0].getBoundingClientRect();
        }
      } else {
        rect = allElements[0].getBoundingClientRect();
      }

      // Hide if block is completely out of view
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        dragButton.style.display = 'none';
        return;
      }

      // Position using shared calculation (same as Volto toolbar) — including
      // the stand-in, or a reposition on scroll would drop the handle back onto
      // the block while the toolbar stayed clear of the label, and the two are
      // asserted to align.
      const handlePos = calculateDragHandlePosition(
        rect,
        { top: 0, left: 0 },
        this.getStandInRect(this.selectedBlockUid),
      );

      dragButton.style.right = 'auto';
      dragButton.style.left = `${handlePos.left}px`;
      dragButton.style.top = `${handlePos.top}px`;
      dragButton.style.display = 'block';
    };

    // Drag handle position is now set in sendBlockSelected() to ensure
    // alignment with Volto toolbar (both use the same rect at the same time)
    // No scroll listener needed - sendBlockSelected handles position updates

    // Create the drag handler
    const dragHandler = (e) => {
      e.preventDefault();

      // Set flag to suppress scrollHandler during drag
      this._isDragging = true;

      // Get all elements for dragged blocks — supports multi-selection.
      // Drop locked blocks from the dragged set: they can't be moved.
      // For single-block drag: if the sole block is locked, abort.
      const rawDraggedUids = this.multiSelectedBlockUids.length > 0
        ? [...this.multiSelectedBlockUids]
        : [this.selectedBlockUid];
      const draggedUids = this._filterMutableBlockUids(rawDraggedUids, 'move');
      if (draggedUids.length === 0) {
        this._isDragging = false;
        return;
      }
      const allElements = draggedUids.flatMap(uid => [...this.getAllBlockElements(uid)]);
      if (allElements.length === 0) return;

      // Compute bounding box for all elements
      const rect = this.getBoundingBoxForElements(allElements);
      if (!rect) return;

      document.querySelector('body').classList.add('grabbing');

      // Create a visual ghost for dragging
      let draggedBlock;
      if (draggedUids.length > 1 || allElements.length > 1) {
        // Multi-block or multi-element: create a placeholder box
        draggedBlock = document.createElement('div');
        draggedBlock.classList.add('dragging', 'multi-element-ghost');
        draggedBlock.style.cssText = `
          background: rgba(0, 123, 255, 0.2);
          border: 2px dashed rgba(0, 123, 255, 0.5);
          border-radius: 4px;
        `;
      } else {
        // Single element: clone it as before
        draggedBlock = allElements[0].cloneNode(true);
        draggedBlock.classList.add('dragging');
        // Remove data-block-uid from shadow so it doesn't interfere with selectors
        draggedBlock.removeAttribute('data-block-uid');
      }

      // IMPORTANT: Set styles BEFORE appending to avoid brief layout flash
      // where element is in document flow before position:fixed takes effect
      Object.assign(draggedBlock.style, {
        position: 'fixed',
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        left: `${e.clientX}px`,
        top: `${e.clientY}px`,
        opacity: '0.5',
        pointerEvents: 'none',
        zIndex: '10000',
      });

      document.body.appendChild(draggedBlock);

      let closestBlockUid = null;
      let insertAt = null; // 0 for top, 1 for bottom
      let dropIndicatorVisible = false; // Track if drop indicator is shown - drop only allowed when visible
      // Replace mode: target is an 'empty' placeholder created by
      // ensureEmptyBlockIfEmpty when its container has no real children.
      // On drop we delete the placeholder and insert the dragged block in
      // its position — the only-child placeholder gets REPLACED, not
      // dropped-next-to. Visualised as a shade overlay rather than a line.
      let replaceTargetUid = null;

      // Auto-scroll: continuous scroll near viewport edges. Dispatches synthetic
      // mousemove on each scroll tick so the drop-indicator-update path below
      // re-runs even while the cursor is held stationary at an edge.
      const scroller = this._createAutoScroller();

      // Droppability is FIXED for the whole drag: the dragged block types are
      // set at drag start and each container's allowedSiblingTypes is stable
      // while dragging (the pathmap doesn't mutate mid-drag). So resolve "can
      // the dragged blocks drop beside block X" ONCE per container and memoize —
      // only the nearest-edge GEOMETRY in onMouseMove needs the cursor. This
      // avoids re-running the acceptance walk on every mousemove/scroll tick,
      // which is exactly when the drag needs to stay responsive.
      const draggedBlockUids = allElements.map(el => el.getAttribute('data-block-uid'));
      const draggedBlockTypes = draggedBlockUids.map(uid => this.getBlockType(uid)).filter(Boolean);
      const isMultiDrag = draggedBlockTypes.length > 1;
      const uidOf = (el) => el && el.getAttribute('data-block-uid');
      const _dropAcceptById = new Map();
      // Can the dragged blocks drop as a sibling of `el` (into el's parent)?
      // Allowed natively, or reachable via the conversionMap (single: any option;
      // multi: exactly one — auto-only). Mirrors the walk-up's acceptance test.
      const isDroppableBeside = (el) => {
        const id = uidOf(el);
        if (!id) return false;
        if (_dropAcceptById.has(id)) return _dropAcceptById.get(id);
        const ok = draggedBlockTypes.every((t) =>
          acceptableAt(t, this.blockPathMap?.[id]?.allowedSiblingTypes, isMultiDrag, this.conversionMap),
        );
        _dropAcceptById.set(id, ok);
        return ok;
      };

      // Handle mouse movement
      const onMouseMove = (e) => {
        scroller.onMouseMove(e);

        draggedBlock.style.left = `${e.clientX}px`;
        draggedBlock.style.top = `${e.clientY}px`;

        // Find element under cursor (no throttle - these operations are fast)
        const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
        let closestBlock = elementBelow;

        // Find the closest ancestor with 'data-block-uid'
        while (closestBlock && !closestBlock.hasAttribute('data-block-uid')) {
          closestBlock = closestBlock.parentElement;
        }

        // Exclude the dragged block(s) and ghost from being drop targets
        // For multi-element blocks (listings, template instances), exclude all elements
        const isSelfOrGhost = closestBlock &&
          (closestBlock === draggedBlock || allElements.includes(closestBlock) ||
           draggedBlockUids.includes(closestBlock.getAttribute('data-block-uid')));
        if (isSelfOrGhost) closestBlock = null;

        // draggedBlockTypes / isMultiDrag / uidOf / isDroppableBeside are
        // computed ONCE at drag start (above) — droppability can't change
        // mid-drag, only which edge is nearest the cursor.

        // NEAREST DROPPABLE EDGE — the single resolution for "the cursor isn't on a
        // droppable leaf": either over NOTHING (the old overshoot) or over a
        // CONTAINER's own chrome (its padding / the gap between children, where
        // elementFromPoint resolves to the container, not a child). Both used to be
        // handled separately and wrongly: over-nothing picked the nearest block
        // without checking it accepts the drop, and on-a-container the walk-up saw
        // only the container's OUTER sibling level and dropped the blocks BESIDE it
        // (for a convert-drop, skipping the conversion — because these blocks are
        // usually allowed at the outer level too, the walk-up stopped there and never
        // descended). Instead, scan every candidate block, measure its nearest edge to
        // the cursor, and take the nearest edge the dragged blocks can actually drop at
        // (native, or via the conversionMap). "Drop at the nearest place it can go":
        // deep inside a container a child edge wins (drop in); at its outer border a
        // sibling edge wins (drop beside); a leaf the cursor is on picks that leaf's own
        // nearest edge. This ONE scan is the sole resolver — it replaces BOTH the old
        // up-only walk-up and the over-nothing overshoot, and it ALWAYS runs, so
        // resolution is uniform for every cursor position (it effectively walks both up
        // and down and takes the nearest droppable edge). Enable HYDRA_DEBUG to trace.
        {
          const candidates = Array.from(document.querySelectorAll('[data-block-uid]'))
            .filter(el => el !== draggedBlock && !draggedBlockUids.includes(uidOf(el)));
          // For each candidate, measure BOTH insert edges along the axis its siblings
          // are laid out on — a horizontal row (columns / data-block-add="right") uses
          // the left/right edges + clientX, a vertical stack uses top/bottom + clientY
          // (the same axis the drop indicator is drawn on downstream, getAddDirection) —
          // and take the nearer: the leading edge inserts BEFORE (insertAt 0), the
          // trailing edge inserts AFTER (insertAt 1). Measuring both edges per block
          // (rather than only the add edge) keeps a dense set of candidates so the
          // nearest inside edge reliably wins near a container boundary.
          let bestEdge = null;
          // Accumulate a compact per-candidate trace and emit it as ONE log line per
          // move (below), not one line PER candidate: with HYDRA_DEBUG on in tests the
          // scan runs every mousemove, and a log() per candidate floods the CDP console
          // channel enough to starve mouse.move/boundingBox (60s timeouts). Batching to
          // a single message per move keeps the "why each candidate didn't match" trace
          // the design calls for at ~1/30th the message volume.
          const edgeTrace = (debugEnabled || window.HYDRA_DEBUG) ? [] : null;
          for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            const horizontal = this.getAddDirection(el) === 'right';
            // True 2D distance from the cursor to each insert-edge LINE SEGMENT, not
            // just the perpendicular axis — otherwise blocks that share the insertion
            // axis but sit at a different offset on the other axis (e.g. children of
            // DIFFERENT columns at the same Y) are indistinguishable and the wrong one
            // can win. The edge is a segment along the block's span on the OTHER axis;
            // `over` is how far the cursor is outside that span (0 when within it, so a
            // vertical stack the cursor is over reduces to the plain perpendicular dy).
            let dStart, dEnd;
            if (horizontal) {
              // vertical insert edges (left/right); segment spans rect.top..rect.bottom
              const over = e.clientY < rect.top ? rect.top - e.clientY
                : e.clientY > rect.bottom ? e.clientY - rect.bottom : 0;
              dStart = Math.hypot(e.clientX - rect.left, over);
              dEnd = Math.hypot(e.clientX - rect.right, over);
            } else {
              // horizontal insert edges (top/bottom); segment spans rect.left..rect.right
              const over = e.clientX < rect.left ? rect.left - e.clientX
                : e.clientX > rect.right ? e.clientX - rect.right : 0;
              dStart = Math.hypot(over, e.clientY - rect.top);
              dEnd = Math.hypot(over, e.clientY - rect.bottom);
            }
            const at = dStart <= dEnd ? 0 : 1; // 0 = before (top/left), 1 = after (bottom/right)
            const dist = Math.min(dStart, dEnd);
            const droppable = isDroppableBeside(el);
            // Nesting depth (block ancestors). A container's insert edge ~coincides with
            // its last/first child's edge, so at an exact-or-near distance tie a pure
            // `dist <` picks whichever comes FIRST in DOM order — the ANCESTOR container —
            // and a reorder meant to stay inside the container ejects the block to the
            // outer level. Depth breaks that tie toward the INNER (deeper) edge so the
            // block reorders within the container the cursor is over. (object-blocks:213:
            // ob-1 and child-2 both at d6 → without this, ob-1 wins and child-1 ejects.)
            let depth = 0;
            for (let p = el.parentElement; p; p = p.parentElement) {
              if (p.hasAttribute && p.hasAttribute('data-block-uid')) depth++;
            }
            if (edgeTrace) edgeTrace.push(`${uidOf(el)}${horizontal ? 'H' : 'V'}@${at}d${Math.round(dist)}${droppable ? 'ok' : 'x'}`);
            if (droppable) {
              const NEST_EPS = 8; // px within which two edges count as coincident
              let better = false;
              if (!bestEdge) {
                better = true;
              } else if (dist < bestEdge.dist - NEST_EPS) {
                better = true; // clearly closer — cursor is genuinely nearer this edge
              } else if (dist <= bestEdge.dist + NEST_EPS) {
                // near-coincident: prefer the deeper (inner) edge; tie at equal depth → closer
                better =
                  depth > bestEdge.depth ||
                  (depth === bestEdge.depth && dist < bestEdge.dist);
              }
              if (better) bestEdge = { el, at, dist, depth };
            }
          }
          if (edgeTrace) log('[drag-edge] candidates', edgeTrace.join(' '));
          if (bestEdge) {
            log('[drag-edge] nearest droppable edge ->', uidOf(bestEdge.el), 'insertAt', bestEdge.at);
            closestBlock = bestEdge.el;
            insertAt = bestEdge.at;
          } else {
            // Nothing anywhere accepts these blocks — no valid drop.
            closestBlock = null;
          }
        }

        if (closestBlock) {
          // Walk up the parent chain to the first level that accepts the dragged
          // block type(s) — natively or via conversion. When the cursor was over a
          // container's chrome or over nothing, closestBlock is already the nearest
          // DROPPABLE edge resolved above, so this normally accepts immediately; it
          // still runs so a directly-hovered leaf that can't take the drop escapes to
          // an ancestor that can.

          // Find a valid drop target by walking up the parent chain
          let validDropTarget = closestBlock;
          let validDropTargetUid = validDropTarget.getAttribute('data-block-uid');

          while (validDropTarget) {
            const targetPathInfo = this.blockPathMap?.[validDropTargetUid];
            const allowedSiblingTypes = targetPathInfo?.allowedSiblingTypes;

            // Check if drop is allowed here — each dragged type must be allowed
            // natively OR reachable via conversion (single-block: 1=auto, >1=popup;
            // multi-block: auto-only). See acceptableAt / conversionMap.
            const isMulti = draggedBlockTypes.length > 1;
            const allTypesAllowed = draggedBlockTypes.length === 0 ||
              draggedBlockTypes.every(type =>
                acceptableAt(type, allowedSiblingTypes, isMulti, this.conversionMap));
            // Trace WHY this level did/didn't accept — native fit vs conversion vs
            // no-fit — so a mis-resolved drop is diagnosable from the log alone
            // (enable HYDRA_DEBUG). A line like `level box-1 ACCEPT convSource:native`
            // means it matched at the container's OUTER sibling level natively and
            // never descended; `convert(convTargetA)` means it descended + converts.
            log('[drag-walk] level', validDropTargetUid, allTypesAllowed ? 'ACCEPT' : 'escape->parent',
              draggedBlockTypes.map((t) => {
                if (!allowedSiblingTypes) return t + ':any';
                if (allowedSiblingTypes.includes(t)) return t + ':native';
                const opts = ((this.conversionMap && this.conversionMap[t]) || []).filter((x) => allowedSiblingTypes.includes(x));
                return t + ':' + (opts.length === 0 ? 'no-fit' : opts.length === 1 ? 'convert(' + opts[0] + ')' : 'convert-choose');
              }).join(','));
            if (allTypesAllowed) {
              // Drop is allowed at this level
              break;
            }

            // Not allowed here, try parent block
            const parentElement = validDropTarget.parentElement?.closest('[data-block-uid]');
            if (!parentElement) {
              // No more parents to check - drop not allowed anywhere
              validDropTarget = null;
              validDropTargetUid = null;
              break;
            }

            validDropTarget = parentElement;
            validDropTargetUid = validDropTarget.getAttribute('data-block-uid');

            // Don't allow dropping on any of the blocks we're dragging
            if (draggedBlockUids.includes(validDropTargetUid)) {
              validDropTarget = null;
              validDropTargetUid = null;
              break;
            }
          }

          // If no valid drop target found, hide indicator and skip
          if (!validDropTarget) {
            const existingIndicator = document.querySelector('.volto-hydra-drop-indicator');
            if (existingIndicator) {
              existingIndicator.style.display = 'none';
            }
            const existingShade = document.querySelector('.volto-hydra-drop-shade');
            if (existingShade) existingShade.style.display = 'none';
            dropIndicatorVisible = false;
            closestBlockUid = null;
            replaceTargetUid = null;
            return;
          }

          // Use the valid drop target (may be the original or a parent)
          closestBlock = validDropTarget;
          closestBlockUid = validDropTargetUid;

          // Replace path: target is — or contains as its only child — an
          // 'empty' placeholder (the slot block ensureEmptyBlockIfEmpty
          // creates when a container has no real children). Resolve to the
          // placeholder uid, render a shade overlay over the container's
          // rect, and remember the placeholder uid so onMouseUp can ask
          // the admin to delete it. Skip the line-indicator flow.
          //
          // The "only-child-is-empty" case matters because for grid-like
          // containers the 25%-wide cell is much smaller than the
          // container's whole rect — a cursor in the empty whitespace
          // doesn't hit the placeholder's element directly, but the user
          // still means "drop into this empty container".
          let emptyTargetUid = null;
          let emptyShadeEl = closestBlock;
          const validTargetInfo = this.blockPathMap?.[closestBlockUid];
          if (validTargetInfo?.blockType === 'empty') {
            emptyTargetUid = closestBlockUid;
          } else {
            // Region-aware: find the container's only child via blockPathMap (covers an
            // object_list container's `slides`, which a blocks_layout.items read missed).
            emptyTargetUid = findOnlyEmptyChildUid(
              this.blockPathMap,
              closestBlockUid,
            );
          }
          if (emptyTargetUid) {
            const lineIndicator = document.querySelector('.volto-hydra-drop-indicator');
            if (lineIndicator) lineIndicator.style.display = 'none';
            let shade = document.querySelector('.volto-hydra-drop-shade');
            if (!shade) {
              shade = document.createElement('div');
              shade.className = 'volto-hydra-drop-shade';
              shade.style.cssText = 'position:absolute;background:rgba(0,123,255,0.15);border:2px dashed #007bff;border-radius:4px;pointer-events:none;z-index:9998;';
              document.body.appendChild(shade);
            }
            const shadeRect = emptyShadeEl.getBoundingClientRect();
            Object.assign(shade.style, {
              top: `${shadeRect.top + window.scrollY}px`,
              left: `${shadeRect.left + window.scrollX}px`,
              width: `${shadeRect.width}px`,
              height: `${shadeRect.height}px`,
              display: 'block',
            });
            // Switch the drop target to the placeholder. We always insert
            // *before* it, so the moved block lands at position 0 in its
            // container; then the admin's MOVE_BLOCKS handler deletes the
            // placeholder via replaceTargetId.
            closestBlockUid = emptyTargetUid;
            replaceTargetUid = emptyTargetUid;
            dropIndicatorVisible = true;
            insertAt = 0;
            return;
          }
          // Not in replace mode — clear any lingering shade from a previous
          // mousemove tick and fall through to the line-indicator path.
          replaceTargetUid = null;
          const existingShade = document.querySelector('.volto-hydra-drop-shade');
          if (existingShade) existingShade.style.display = 'none';

          // Get or create drop indicator
          let dropIndicator = document.querySelector('.volto-hydra-drop-indicator');
          if (!dropIndicator) {
            dropIndicator = document.createElement('div');
            dropIndicator.className = 'volto-hydra-drop-indicator';
            dropIndicator.style.cssText = 'position:absolute;background:transparent;pointer-events:none;z-index:9998;display:none;';
            document.body.appendChild(dropIndicator);
          }

          // Check if this is a multi-element block (multiple elements with same UID)
          const allElements = this.getAllBlockElements(closestBlockUid);
          const isMultiElement = allElements.length > 1;

          // For multi-element blocks, use combined bounding box and first/last elements
          let targetElement = closestBlock;
          let rect;

          if (isMultiElement) {
            // Use combined bounding box for positioning decision
            rect = this.getBoundingBoxForElements(allElements);
          } else {
            rect = closestBlock.getBoundingClientRect();
          }

          const isHorizontal = this.getAddDirection(closestBlock) === 'right';

          // Determine insertion point based on mouse position relative to block center
          const mousePos = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top;
          const blockSize = isHorizontal ? rect.width : rect.height;
          const preferredInsertAt = mousePos < blockSize / 2 ? 0 : 1; // 0 = before, 1 = after

          // Check if insert position is allowed using centralized addability logic
          // This handles fixed blocks, readonly blocks, and templateEditMode
          // Pass source block data to enable dragging blocks into templates
          const targetBlockData = this.getBlockData(closestBlockUid);
          const sourceBlockData = this.getBlockData(this.selectedBlockUid);
          const addability = getBlockAddability(closestBlockUid, this.blockPathMap, targetBlockData, this.templateEditMode, sourceBlockData);

          // Use preferred position if allowed, otherwise try the other side
          if (preferredInsertAt === 0 && addability.canInsertBefore) {
            insertAt = 0;
          } else if (preferredInsertAt === 1 && addability.canInsertAfter) {
            insertAt = 1;
          } else if (addability.canInsertBefore) {
            insertAt = 0;
          } else if (addability.canInsertAfter) {
            insertAt = 1;
          } else {
            // Neither side is allowed - hide indicator
            const existingIndicator = document.querySelector('.volto-hydra-drop-indicator');
            if (existingIndicator) {
              existingIndicator.style.display = 'none';
            }
            const existingShade = document.querySelector('.volto-hydra-drop-shade');
            if (existingShade) existingShade.style.display = 'none';
            dropIndicatorVisible = false;
            closestBlockUid = null;
            replaceTargetUid = null;
            return;
          }

          // For multi-element blocks, use first or last element for indicator positioning
          if (isMultiElement) {
            targetElement = insertAt === 0 ? allElements[0] : allElements[allElements.length - 1];
          }

          // Calculate indicator position in the gap between blocks
          // For sibling lookup, use targetElement (first/last of multi-element, or the single element)
          const sibling = insertAt === 0 ? targetElement.previousElementSibling : targetElement.nextElementSibling;
          // Don't use sibling if it has the same UID (another element of same multi-element block)
          const siblingUid = sibling?.getAttribute('data-block-uid');
          const siblingRect = sibling?.hasAttribute('data-block-uid') && siblingUid !== closestBlockUid
            ? sibling.getBoundingClientRect() : null;
          const indicatorSize = 4;

          let indicatorPos;
          if (isHorizontal) {
            const edge = insertAt === 0 ? rect.left : rect.right;
            const siblingEdge = siblingRect ? (insertAt === 0 ? siblingRect.right : siblingRect.left) : edge;
            const gap = insertAt === 0 ? rect.left - (siblingRect?.right || rect.left) : (siblingRect?.left || rect.right) - rect.right;
            indicatorPos = (insertAt === 0 ? siblingRect?.right || rect.left : rect.right) + window.scrollX + gap / 2 - indicatorSize / 2;

            Object.assign(dropIndicator.style, {
              left: `${indicatorPos}px`, top: `${rect.top + window.scrollY}px`,
              width: `${indicatorSize}px`, height: `${rect.height}px`,
              borderTop: 'none', borderLeft: '3px dashed #007bff', display: 'block'
            });
          } else {
            const edge = insertAt === 0 ? rect.top : rect.bottom;
            const siblingEdge = siblingRect ? (insertAt === 0 ? siblingRect.bottom : siblingRect.top) : edge;
            const gap = insertAt === 0 ? rect.top - (siblingRect?.bottom || rect.top) : (siblingRect?.top || rect.bottom) - rect.bottom;
            indicatorPos = (insertAt === 0 ? siblingRect?.bottom || rect.top : rect.bottom) + window.scrollY + gap / 2 - indicatorSize / 2;

            Object.assign(dropIndicator.style, {
              top: `${indicatorPos}px`, left: `${rect.left}px`,
              width: `${rect.width}px`, height: `${indicatorSize}px`,
              borderLeft: 'none', borderTop: '3px dashed #007bff', display: 'block'
            });
          }
          dropIndicatorVisible = true;
          // TODO(scroll-into-view): if the resolved edge is off-screen, scroll it into
          // view — deferred; scrolling mid-drag fights a held cursor, needs its own design.
        } else {
          // No valid drop target - hide indicator and mark as not droppable
          const existingIndicator = document.querySelector('.volto-hydra-drop-indicator');
          if (existingIndicator) {
            existingIndicator.style.display = 'none';
          }
          const existingShade = document.querySelector('.volto-hydra-drop-shade');
          if (existingShade) existingShade.style.display = 'none';
          dropIndicatorVisible = false;
          closestBlockUid = null;
          replaceTargetUid = null;
        }
      };

      // Cleanup on mouseup & update blocks layout
      const onMouseUp = () => {
        // Clear drag flag
        this._isDragging = false;

        // Clear any pending scroll timeout from auto-scroll
        // This prevents stale BLOCK_SELECTED from firing after drop
        if (this.scrollTimeout) {
          clearTimeout(this.scrollTimeout);
          this.scrollTimeout = null;
        }

        // Stop auto-scroll
        scroller.stop();

        document.querySelector('body').classList.remove('grabbing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        draggedBlock.remove();

        // Always clean up drop indicator on mouseup
        const dropIndicator = document.querySelector('.volto-hydra-drop-indicator');
        if (dropIndicator) {
          log('Hiding drop indicator on mouseup');
          dropIndicator.style.display = 'none';
        } else {
          log('No drop indicator to hide on mouseup');
        }
        const dropShade = document.querySelector('.volto-hydra-drop-shade');
        if (dropShade) dropShade.style.display = 'none';

        // Only allow drop if indicator was visible - this ensures all validation passed
        if (closestBlockUid && dropIndicatorVisible) {
          // Mark which block we just finished dragging - prevents scrollIntoView race condition
          // with async renderers. Cleared when FORM_DATA arrives with this block selected.
          // Only set on successful drop, not on cancelled drags.
          this._justFinishedDragBlockId = this.selectedBlockUid;

          const targetPathInfo = this.blockPathMap?.[closestBlockUid];

          log('DnD: Moving', draggedUids.length, 'blocks relative to', closestBlockUid, 'insertAfter:', insertAt === 1, 'replace:', !!replaceTargetUid);
          window.parent.postMessage(
            {
              type: 'MOVE_BLOCKS',
              blockIds: draggedUids,
              targetBlockId: closestBlockUid,
              insertAfter: insertAt === 1,
              targetParentId: targetPathInfo?.parentId || null,
              // When set, the admin deletes this block after the move so the
              // 'empty' placeholder is replaced rather than dropped beside.
              replaceTargetId: replaceTargetUid || null,
            },
            this.adminOrigin,
          );
        } else if (closestBlockUid && !dropIndicatorVisible) {
          log('DnD: Drop rejected - indicator was not visible (block type not allowed in target)');
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    // Add the event listener
    dragButton.addEventListener('mousedown', dragHandler);

    // Store reference for cleanup
    dragButton._dragHandler = dragHandler;
  }

  /**
   * Listens for 'SELECT_BLOCK' messages from the adminUI to select a block.
   */
  listenForSelectBlockMessage() {
    this.selectBlockHandler = (event) => {
      if (event.origin !== this.adminOrigin) {
        return;
      }

      // Handle SELECT_BLOCK - select a new block from Admin UI
      if (event.data.type === 'SELECT_BLOCK') {
        const { uid } = event.data;

        // Handle deselection: Admin sends uid=null when user clicks "Page"
        if (!uid) {
          const prevUid = this.selectedBlockUid;
          this.selectedBlockUid = null;
          if (prevUid) {
            this.deselectBlock(prevUid, null);
          }
          // Send BLOCK_SELECTED(null) so Admin knows iframe acknowledged deselection
          this.editMode = 'text';
          this.sendBlockSelected('adminDeselect', null);
          return;
        }

        // Check if already selected BEFORE updating selectedBlockUid
        // This prevents ping-pong when Admin echoes back the selection from iframe click
        const alreadySelected = this.selectedBlockUid === uid;

        this.selectedBlockUid = uid;
        // Don't update formData here - it's managed via FORM_DATA messages
        // Don't post FORM_DATA - form data syncing is handled separately

        // Handle template instances (virtual containers with no DOM element)
        // selectBlock handles these by computing bounding box from child elements
        if (this.blockPathMap?.[uid]?.isTemplateInstance) {
          if (!alreadySelected) {
            this.selectBlock(uid);
          }
          return;
        }

        // console.log("select block", event.data?.method);
        let blockElement = document.querySelector(
          `[data-block-uid="${uid}"]`,
        );

        // If block doesn't exist or is hidden, try to make it visible
        // using data-block-selector navigation (e.g., carousel slides)
        if (!blockElement || this.isElementHidden(blockElement)) {
          // Wait for block to become visible (e.g., carousel animation in progress)
          const waitForVisible = async () => {
            for (let i = 0; i < 30; i++) {
              await new Promise((resolve) => setTimeout(resolve, 50));
              blockElement = document.querySelector(
                `[data-block-uid="${uid}"]`,
              );
              if (blockElement && !this.isElementHidden(blockElement)) {
                return true;
              }
            }
            return false;
          };

          if (alreadySelected || this._blockSelectorNavigating) {
            // Navigation already in progress (carousel click or handleBlockSelector) -
            // just wait for the animation to complete, don't try to navigate again
            const stillWanted = this.awaitPendingSelect(uid);
            waitForVisible().then((visible) => {
              if (visible && stillWanted()) {
                this.selectBlock(blockElement);
              }
            });
            return;
          }

          // Block not yet selected and no navigation in progress - try to navigate to it
          const madeVisible = this.tryMakeBlockVisible(uid);
          if (madeVisible) {
            const stillWanted = this.awaitPendingSelect(uid);
            waitForVisible().then((visible) => {
              if (visible && stillWanted()) {
                this.selectBlock(blockElement);
              }
            });
            return; // Exit early - selection will happen in the async callback
          }
        }

        if (blockElement && !this.isElementHidden(blockElement)) {
          // Skip if this block was already selected - no need to re-select
          if (alreadySelected) {
            log('SELECT_BLOCK: block already selected, skipping:', uid);
            return;
          }

          // Scroll into view for new block selection. selectBlock's internal scroll check
          // compares this.selectedBlockUid === blockUid, but we already set selectedBlockUid
          // above (line 5303) so it always thinks it's a re-select and skips the scroll.
          if (!this.elementIsVisibleInViewport(blockElement)) {
            this.scrollBlockIntoView(blockElement);
          }

          // Call selectBlock() to properly set up toolbar and contenteditable
          // This ensures blocks selected via Order tab work the same as clicking
          this.editMode = 'text';
          this.selectBlock(blockElement);

          // Focus the contenteditable element for blocks with editable fields
          // This includes slate, string, and textarea field types
          const schemaProps = this.getBlockSchema(uid)?.properties;
          const hasEditableFields = schemaProps && Object.keys(schemaProps).length > 0;

          if (hasEditableFields) {
            // Use double requestAnimationFrame to wait for ALL DOM updates including Quanta toolbar
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                // Re-query the block element to ensure we get the updated DOM element
                const currentBlockElement = this.queryBlockElement(uid);
                if (currentBlockElement) {
                  // Find the first contenteditable field that belongs to THIS block
                  // (not a nested block's field) to avoid ping-pong selection issues
                  const editableField = this.getOwnFirstEditableField(currentBlockElement);
                  if (editableField && editableField.getAttribute('contenteditable') === 'true') {
                    // Only focus the field, don't manipulate the selection
                    // The selection may have been carefully set by a format operation
                    // or other operation, so we should preserve it
                    editableField.focus();

                    // Don't manipulate selection here - just focus is enough
                    // If there's no selection, the browser will place cursor at the beginning
                    // which is fine for a newly selected block
                  }
                }
              });
            });
          }
        } else {
          // Block element not found — content may not be rendered yet.
          // Wait for it to appear via MutationObserver instead of a fixed
          // retry timer. The original 100ms-once retry assumed the
          // framework re-render is synchronous-fast (React / Vue / Svelte
          // reconciliation). For server-rendered frontends like Astro
          // the render is async (POST /api/render network round trip),
          // can easily exceed 100ms, and a single fixed retry races.
          // The observer fires the moment the block actually appears,
          // with a safety timeout to bail out so we don't leak handlers
          // when a SELECT_BLOCK references a nonexistent uid.
          log('Block element not found for SELECT_BLOCK, observing for it:', uid);
          const stillWanted = this.awaitPendingSelect(uid);
          const observer = new MutationObserver(() => {
            const el = document.querySelector(`[data-block-uid="${uid}"]`);
            if (el) {
              observer.disconnect();
              clearTimeout(safetyTimer);
              if (!stillWanted()) return;
              log('Block element appeared via observer, selecting:', uid);
              this.selectBlock(el);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          const safetyTimer = setTimeout(() => {
            observer.disconnect();
            console.warn('[HYDRA] Block element never appeared after SELECT_BLOCK (5s):', uid);
          }, 5000);
        }
        // this.isInlineEditing = true;
        // this.observeForBlock(uid);
      }
    };

    window.removeEventListener('message', this.selectBlockHandler);
    window.addEventListener('message', this.selectBlockHandler);
  }

  /**
   * Sets up scroll handler to hide/show block UI overlays on scroll
   */
  setupScrollHandler() {
    const handleScroll = () => {
      // Hide overlays immediately when scrolling
      // Skip during block selector navigation — carousel animation handles its own
      // UI state, and scrollBlockIntoViewWithToolbarRoom can trigger scroll events
      // that would hide the toolbar with no BLOCK_SELECTED to restore it (the
      // debounced handler below also skips when _blockSelectorNavigating is true).
      if ((this.selectedBlockUid || this.multiSelectedBlockUids.length > 0) && !this._blockSelectorNavigating) {
        window.parent.postMessage(
          { type: 'HIDE_BLOCK_UI' },
          this.adminOrigin,
        );
      }

      // Clear any existing timeout
      if (this.scrollTimeout) {
        clearTimeout(this.scrollTimeout);
      }

      // After scroll stops, re-send BLOCK_SELECTED with updated positions
      // Skip during drag - auto-scroll causes misleading position updates
      // Skip during block selector navigation - carousel animations cause stale position updates
      this.scrollTimeout = setTimeout(() => {
        if (this._isDragging || this._blockSelectorNavigating) {
          return; // Don't send BLOCK_SELECTED during drag or carousel navigation
        }

        // Re-send multi-select with updated rects after scroll
        // (checked before selectedBlockUid — Ctrl+Click sets selectedBlockUid to null)
        if (this.multiSelectedBlockUids.length > 1) {
          this._sendMultiBlockSelected();
          return;
        }

        if (this.selectedBlockUid) {
          let element;
          if (this.selectedBlockUid === PAGE_BLOCK_UID) {
            // Page-level field - find element using focused field info
            if (this.focusedMediaField) {
              element = document.querySelector(`[data-edit-media="${this.focusedMediaField}"]`);
            } else if (this.focusedLinkableField) {
              element = document.querySelector(`[data-edit-link="${this.focusedLinkableField}"]`);
            } else if (this.focusedFieldName) {
              element = document.querySelector(`[data-edit-text="${this.focusedFieldName}"]`);
            }
          } else {
            // Use getAllBlockElements to handle template instances (virtual containers)
            // which don't have their own DOM element but have child block elements
            const elements = this.getAllBlockElements(this.selectedBlockUid);
            element = elements[0] || null;
          }

          if (element) {
            // Single block: include selection mode rects if active
            const extra = {};
            if (this._selectionModeBlockUids) {
              const selectionModeRects = {};
              for (const uid of this._selectionModeBlockUids) {
                const el = this.queryBlockElement(uid);
                if (el) {
                  const r = el.getBoundingClientRect();
                  selectionModeRects[uid] = { top: r.top, left: r.left, width: r.width, height: r.height };
                }
              }
              extra.selectionModeRects = selectionModeRects;
            }
            this.sendBlockSelected('scrollHandler', element, { blockUid: this.selectedBlockUid, ...extra });
          }
        }
      }, 150);
    };

    window.addEventListener('scroll', handleScroll);
  }

  /**
   * Sets up window resize handler to update block UI overlay positions
   */
  setupResizeHandler() {
    const handleResize = () => {
      // After resize, re-send BLOCK_SELECTED with updated positions
      if (this.selectedBlockUid) {
        // Use getAllBlockElements to handle template instances (virtual containers)
        const elements = this.getAllBlockElements(this.selectedBlockUid);
        const blockElement = elements[0] || null;

        if (blockElement) {
          // Pass blockUid explicitly to preserve template instance selection
          this.sendBlockSelected('resizeHandler', blockElement, { blockUid: this.selectedBlockUid });
        }
      }
    };

    window.addEventListener('resize', handleResize);
  }

  /**
   * Sends throttled MOUSE_ACTIVITY messages to admin on mouse use.
   * The admin uses this to show the toolbar (which starts hidden).
   * Listens for both mousemove and mousedown (click without prior movement).
   * Throttled to 1 message per second to avoid flooding.
   */
  setupMouseActivityReporter() {
    let lastSent = 0;
    const sendActivity = () => {
      const now = Date.now();
      if (now - lastSent < 1000) return;
      lastSent = now;
      window.parent.postMessage({ type: 'MOUSE_ACTIVITY' }, this.adminOrigin);
    };
    document.addEventListener('mousemove', sendActivity);
    document.addEventListener('mousedown', sendActivity);
    // Touch fires MOUSE_ACTIVITY too. Without this, a real touch tap on
    // a phone might never trigger mousedown (the browser is free to
    // delay or skip mouse synthesis), so the Quanta toolbar stays at
    // opacity:0 after the user taps a block — they can see the toolbar
    // is mounted but can't aim at the chevron-up / chevron-down buttons.
    // Reported bug: "in block mode I can't move the block up and down".
    document.addEventListener('touchstart', sendActivity, { passive: true });
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Make Block Text Inline Editable and Text Changes Observation
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Makes the content of a block editable.
   *
   * @param {HTMLElement} blockElement - The block element to make editable.
   */
  makeBlockContentEditable(elementOrBlock) {
    // Handle being called with either a block element or an editable field directly
    let blockUid;
    let editableField;

    let blockElement;

    if (elementOrBlock.hasAttribute('data-edit-text')) {
      // Called with the editable field directly - find block-uid from parent
      editableField = elementOrBlock;
      blockElement = elementOrBlock.closest('[data-block-uid]');
      blockUid = blockElement?.getAttribute('data-block-uid');
    } else {
      // Called with a block element - query for child editable field
      // Use getOwnFirstEditableField to avoid getting nested blocks' fields
      blockElement = elementOrBlock;
      blockUid = elementOrBlock.getAttribute('data-block-uid');
      editableField = this.getOwnFirstEditableField(elementOrBlock);
    }

    // Skip making readonly blocks editable
    if (blockUid && this.isBlockReadonly(blockUid)) {
      return;
    }

    if (editableField) {
      // Make the field contenteditable - child inline elements inherit this
      editableField.setAttribute('contenteditable', 'true');

      // Ensure minimum dimensions if element has no height (empty content)
      // This keeps empty fields visible/clickable for user interaction
      const rect = editableField.getBoundingClientRect();
      if (rect.height === 0) {
        editableField.style.minHeight = '1.5em';
      }
      if (rect.width === 0) {
        editableField.style.minWidth = '1em';
      }
    }

    if (editableField && blockUid) {
      // Skip if listeners already attached to this element
      if (editableField._hydraListenersAttached) {
        return;
      }
      editableField._hydraListenersAttached = true;

      // Handle Chrome's cursor-outside-anchor quirk for prospective inline elements.
      // Chrome moves cursor outside <a> elements during text insertion.
      // We intercept beforeinput to manually insert text into the prospective inline.
      // See: https://www.w3.org/community/editing/wiki/ContentEditable
      //      https://github.com/ianstormtaylor/slate/issues/4704
      editableField.addEventListener('beforeinput', (e) => {
        // Handle Chrome's cursor-outside-anchor quirk for prospective inline elements.
        // Chrome moves cursor outside <a> elements DURING DOM insertion (after keydown/beforeinput).
        // We intercept beforeinput and manually insert text into the prospective inline.
        // See: https://www.w3.org/community/editing/wiki/ContentEditable
        //      https://github.com/ianstormtaylor/slate/issues/4704
        if (e.inputType !== 'insertText' || !e.data) return;
        if (!this.prospectiveInlineElement) return;

        const prospectiveInline = this.prospectiveInlineElement;
        if (!prospectiveInline.isConnected) {
          this.prospectiveInlineElement = null;
          return;
        }

        // Redirect text into prospective inline
        e.preventDefault();

        // Find the text node inside the inline
        let inlineTextNode = null;
        for (const child of prospectiveInline.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            inlineTextNode = child;
            break;
          }
        }

        if (inlineTextNode) {
          // Insert the character at the end of the inline's text
          const selection = window.getSelection();
          inlineTextNode.textContent += e.data;
          // Position cursor at end
          const newRange = document.createRange();
          newRange.setStart(inlineTextNode, inlineTextNode.textContent.length);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      });

      // Add paste event listener
      editableField.addEventListener('paste', (e) => {
        e.preventDefault(); // Prevent default paste
        const html = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
        this._doPaste(blockUid, html);
      });

      // Add copy event listener on document - strip ZWS/NBSP and internal data attributes from clipboard
      // Listen on document because keyboard shortcuts may not bubble through contenteditable
      document.addEventListener('copy', (e) => this._doCopy(e));

      // Document-level paste handler (registered once) — catches paste events
      // that don't reach a field-level handler: when no block is focused (body),
      // or during transforms when the editable field was destroyed by re-render.
      if (!this._documentPasteHandler) {
        this._documentPasteHandler = (e) => {
          // Skip if a field-level paste handler already handled this
          if (e.defaultPrevented) return;

          // During transforms: buffer clipboard data for replay
          if (this.blockedBlockId) {
            e.preventDefault();
            const html = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
            this.eventBuffer.push({ _type: 'paste', html });
            log('BUFFERED paste data (document handler), buffer size:', this.eventBuffer.length);
            return;
          }

          // No transform: paste into selected block if available
          if (this.selectedBlockUid) {
            e.preventDefault();
            const html = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
            this._doPaste(this.selectedBlockUid, html);
          }
        };
        document.addEventListener('paste', this._documentPasteHandler);
      }

      // Prevent browser from removing text nodes on last-char deletion.
      // Like slate-react (string.tsx), we keep empty text nodes alive with
      // ZWS (\uFEFF) so MutationObserver always fires characterData (not
      // childList). Part of ZWS lifecycle — see "Whitespace & ZWS Strategy".
      editableField.addEventListener('beforeinput', (e) => {
        if (e.inputType !== 'deleteContentBackward' && e.inputType !== 'deleteContentForward') return;
        if (this.preserveLastCharDelete()) {
          e.preventDefault();
        }
      });

      // Keydown handler is registered per-field in restoreContentEditableOnFields
      // (_hydraKeydownHandler). No duplicate listener needed here.

      // Replay any keys buffered during block transition (focus was on body,
      // document-level handler captured them). Uses the same replay logic as
      // transform unblock — handles transform interruption mid-replay.
      if (this.eventBuffer.length > 0 && !this.blockedBlockId) {
        const buffer = this.eventBuffer.splice(0);
        log('activateEditableField: replaying', buffer.length, 'buffered keys for', blockUid);
        this.pendingBufferReplay = { blockId: blockUid, buffer };
        this.replayBufferedEvents();
      }
    }
  }

  /**
   * Handle live keydown events for an editable field.
   * Default: replayOneKey handles everything (same code path as buffered replay).
   * Exceptions let native handle: text characters (performance, IME compat),
   * Paste/Copy (need native clipboard events).
   * If performance issues arise, more keys can be moved to native.
   */
  _handleFieldKeydown(e, blockUid, editableField) {
        // Skip modifier-only keys
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

        // IME composition: let native handle entirely
        if (e.isComposing) return;

        // Try special/structural handling (shared with replayOneKey).
        // If handled, preventDefault to suppress native action.
        if (this.handleSpecialKey(blockUid, {
          key: e.key, code: e.code,
          shiftKey: e.shiftKey, ctrlKey: e.ctrlKey,
          metaKey: e.metaKey, altKey: e.altKey,
        }, editableField)) {
          e.preventDefault();
          return;
        }

        // Content keys: let native handle.
        // Text chars: browser inserts, MutationObserver detects.
        // Space (non-markdown): browser inserts space.
        // Delete/Backspace (non-boundary): browser deletes, beforeinput
        //   handles preserveLastCharDelete.
        // Paste/Copy: native clipboard events.
        // Pre-processing for text input:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          this.correctInvalidWhitespaceSelection();
          this.ensureValidInsertionTarget();
        }
  }


  /**
   * Observes changes in the text content of a block.
   * For multi-element blocks, observes ALL elements with the same block UID.
   *
   * @param {HTMLElement} blockElement - The block element to observe.
   */
  /**
   * Temporarily disconnect the text MutationObserver. Call _resumeObserver() to reconnect.
   * Used during internal DOM modifications (whitespace correction, ZWS insertion)
   * that should not be treated as user edits.
   */
  _suppressObserver() {
    if (this.blockTextMutationObserver) {
      // takeRecords() flushes pending mutations so they don't fire after reconnect
      this.blockTextMutationObserver.takeRecords();
      this.blockTextMutationObserver.disconnect();
    }
  }

  /**
   * Reconnect the text MutationObserver to the currently selected block.
   */
  _resumeObserver() {
    if (!this.blockTextMutationObserver || !this.selectedBlockUid) return;
    const allElements = this.getAllBlockElements(this.selectedBlockUid);
    for (const element of allElements) {
      this.blockTextMutationObserver.observe(element, {
        subtree: true,
        characterData: true,
        childList: true,
      });
    }
  }

  /**
   * Sets up a MutationObserver on document.body that watches for structural
   * DOM changes (childList). When the framework adds/removes block elements,
   * this runs all-blocks operations: materializeHydraComments, markEmptyBlocks,
   * applyReadonlyVisuals, applyPlaceholders.
   *
   * Separate from blockTextMutationObserver (which tracks text changes in the
   * selected block for inline editing). This observer is never disconnected
   * during renders — it fires whenever the framework patches the DOM.
   * Debounced via rAF to batch rapid mutations from a single render pass.
   */
  setupStructuralObserver() {
    if (this._structuralObserver) return;

    let pendingRAF = null;
    const runAllBlocksOps = () => {
      pendingRAF = null;
      const t0 = performance.now();
      this.materializeHydraComments();
      const t1 = performance.now();
      this.markEmptyBlocks();
      const t2 = performance.now();
      this.applyReadonlyVisuals();
      const t3 = performance.now();
      this.applyPlaceholders();
      const t4 = performance.now();
      const total = t4 - t0;
      if (total > 5) {
        log('runAllBlocksOps:', total.toFixed(0) + 'ms (materialize:', (t1-t0).toFixed(0), 'empty:', (t2-t1).toFixed(0), 'readonly:', (t3-t2).toFixed(0), 'placeholders:', (t4-t3).toFixed(0) + ')');
      }
      // Harvest deep-link anchors at DOM-settle — the reliable moment a newly
      // added/transformed heading has its final slug id, NOT mid-typing. This is
      // why it belongs on the structural settle (like the rect/UI updates) and
      // not only on the inline-text flush, whose timing races the render that
      // finalizes the id (dropped a just-added heading's anchor intermittently).
      // Safe to run on every settle: the admin merges LINKABLE_ANCHORS into
      // formData WITHOUT bouncing a FORM_DATA back (the inline-edit counter
      // guard in View.jsx suppresses the send), so it never re-renders the
      // iframe; the echo guard in _maybeSendLinkableAnchors sends only when the
      // map changes.
      this._maybeSendLinkableAnchors();
      // Signal DOM settled — but only if no new mutations arrived during
      // this rAF callback. If new mutations come, the observer will fire
      // again and we'll wait for the next settlement.
      if (this._onDomSettled && !pendingRAF) {
        const cb = this._onDomSettled;
        this._onDomSettled = null;
        cb();
      }
    };

    this._structuralObserver = new MutationObserver(() => {
      // Cancel previous pending rAF and schedule a new one.
      // This ensures we wait for the LAST mutation, not the first.
      if (pendingRAF) cancelAnimationFrame(pendingRAF);
      pendingRAF = requestAnimationFrame(runAllBlocksOps);
    });

    this._structuralObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  observeBlockTextChanges(blockElement) {
    const blockUid = blockElement.getAttribute('data-block-uid');
    log('observeBlockTextChanges called for block:', blockUid);
    if (this.blockTextMutationObserver) {
      this.blockTextMutationObserver.disconnect();
    }
    this.blockTextMutationObserver = new MutationObserver((mutations) => {
      log('MutationObserver fired, mutations:', mutations.length, 'isInlineEditing:', this.isInlineEditing);
      mutations.forEach((mutation) => {
        log('Mutation:', mutation.type, 'target:', mutation.target?.nodeName, 'text:', mutation.target?.textContent?.substring(0, 50));
        if (mutation.type === 'characterData' && this.isInlineEditing && !this._renderInProgress) {
          // Find the editable field element (works for both Slate and non-Slate fields)
          const mutatedTextNode = mutation.target; // The actual text node that changed
          const parentEl = mutation.target?.parentElement;
          const targetElement = parentEl?.closest('[data-edit-text]');
          log('characterData mutation: parentEl=', parentEl?.tagName, 'targetElement=', targetElement?.tagName, 'targetElement has attr:', targetElement?.hasAttribute?.('data-edit-text'));

          if (targetElement) {
            // Pass parentEl so handleTextChange can find the actual node that changed
            // (e.g., SPAN for inline formatting) rather than the whole editable field (P)
            // Also pass the mutated text node so we can identify which child to update
            this.handleTextChange(targetElement, parentEl, mutatedTextNode);
          } else {
            console.warn('[HYDRA] No targetElement found, parent chain:', parentEl?.outerHTML?.substring(0, 100));
          }
        }
        // childList mutations: when text is inside wrapper elements without
        // data-node-id (e.g., Vue/F7 <span>), the browser may REPLACE the
        // text node (childList) rather than modify it in place (characterData).
        // This happens on select-all + type, backspace across node boundaries,
        // or browser DOM normalization.
        // NOTE: the observer is disconnected during framework re-renders
        // (_executeRender disconnects, afterContentRender reconnects) so
        // structural changes from FORM_DATA don't trigger this.
        if (mutation.type === 'childList' && this.isInlineEditing && !this._renderInProgress) {
          const parent = mutation.target;
          if (parent?.nodeType === Node.ELEMENT_NODE) {
            const targetElement = parent.closest?.('[data-edit-text]');
            if (targetElement) {
              const addedTextNode = Array.from(mutation.addedNodes).find(
                n => n.nodeType === Node.TEXT_NODE
              );
              if (addedTextNode) {
                this.handleTextChange(targetElement, parent, addedTextNode);
              }
            }
          }
        }
      });
    });

    // For multi-element blocks, observe ALL elements with the same block UID
    // For page-level fields (no blockUid), observe the element directly
    if (blockUid) {
      const allElements = this.getAllBlockElements(blockUid);
      for (const element of allElements) {
        this.blockTextMutationObserver.observe(element, {
          subtree: true,
          characterData: true,
          childList: true,
        });
      }
    } else {
      // Page-level field - observe the element directly
      this.blockTextMutationObserver.observe(blockElement, {
        subtree: true,
        characterData: true,
        childList: true,
      });
    }
  }

  /**
   * Checks if an element is visible in the viewport
   * @param {HTMLElement} el
   * @param {Boolean} partiallyVisible
   * @returns
   */
  elementIsVisibleInViewport(el, partiallyVisible = false) {
    if (!el) return true;
    const { top, left, bottom, right } = el.getBoundingClientRect();
    const { innerHeight, innerWidth } = window;
    return partiallyVisible
      ? ((top > 0 && top < innerHeight) ||
          (bottom > 0 && bottom < innerHeight)) &&
          ((left > 0 && left < innerWidth) || (right > 0 && right < innerWidth))
      : top >= 0 && left >= 0 && bottom <= innerHeight && right <= innerWidth;
  }

  /**
   * Scrolls an element into view, centering if it fits or showing top if too tall.
   * @param {HTMLElement} el - Element to scroll into view
   * @param {Object} options - Options
   * @param {number} options.toolbarMargin - Space to reserve at top (default 50)
   * @param {number} options.bottomMargin - Space to reserve at bottom (default 50)
   */
  // Same reservation scrollBlockIntoView keeps for the toolbar, so the two
  // agree on what "the toolbar fits above this block" means.
  static get TOOLBAR_ANCHOR_MARGIN() { return 50; }

  scrollBlockIntoView(el, { toolbarMargin = 50, bottomMargin = 50 } = {}) {
    const scrollRect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const availableHeight = viewportHeight - toolbarMargin - bottomMargin;
    // Center if block fits, otherwise show top
    const blockPosition = scrollRect.height > availableHeight ? 'start' : 'center';
    el.scrollIntoView({ behavior: 'instant', block: blockPosition });
  }

  /**
   * Shared render logic for INITIAL_DATA and FORM_DATA handlers.
   * Sets _renderInProgress, disconnects MutationObserver, calls the callback,
   * and invokes afterContentRender when done.
   *
   * During INITIAL_DATA, keyboard blocking and DOM mutation waiting are
   * naturally skipped because isInlineEditing is false and pendingTransform
   * / _reRenderBlocking are unset.
   */
  /**
   * Build the copy of formData the RENDERER sees. `this.formData` is never
   * mutated — it stays exactly what the admin sent, so echo detection and the
   * data that goes back up stay truthful.
   *
   * Today this does one job: make "cleared" read as "absent".
   *
   * A frontend's natural rule for an optional field is plain truthiness —
   * `{block.heading && …}`, `v-if="block.buttonLink"`. That's the rule we want
   * developers to write without thinking about edit mode. It works for every
   * state except one: a field the editor CLEARED. Volto's ObjectBrowserWidget
   * writes `[]` on remove (removeItem, ObjectBrowserWidget.jsx:163), not
   * undefined — and `[]` is truthy in JS, so the natural rule would render an
   * element for a field that has nothing in it. Making every renderer write
   * `.length` to dodge that is exactly the per-block complexity issue #296 is
   * removing, so the bridge collapses it here instead.
   *
   * Safe because `undefined` is ALREADY a legal state for every one of these
   * fields (a never-set field arrives that way), so this introduces no state a
   * renderer isn't already handling.
   *
   * Scoped by schema, deliberately: a blind recursive sweep would also strip
   * `blocks_layout.items: []` on an empty container and break renderers that
   * map over it. Only declared, non-container schema fields are touched.
   */
  /**
   * Zero-width space. The reveal sentinel for every text-ish shape.
   * Not a new convention — the bridge already inserts ZWS into empty inline
   * elements for cursor positioning (_ensureZeroWidthSpaces) and already ignores
   * it when deciding emptiness (updateFieldEmptyState), and the admin plants it
   * so empty inline slate nodes survive withEmptyInlineRemoval.
   */
  static get REVEAL_ZWS() { return '\u200B'; }

  /**
   * The reveal sentinel for a string-URL image field: a fully transparent SVG
   * with REAL intrinsic dimensions.
   *
   * Not a 1x1. The size matters — the frontend styles this exactly as it styles
   * any other image, so the editor gets a correctly-shaped click target and
   * hydra's zero-dimension media guard is satisfied naturally. The alternative
   * (a 1x1 plus injected min-width/min-height CSS) would have been the one
   * injection that reshapes the host page's layout, which the existing injected
   * rules deliberately avoid — they use `outline` precisely so "the host element
   * position is NOT mutated".
   *
   * Transparent, so nothing of ours is ever painted into the frontend.
   */
  static get REVEAL_PIXEL() {
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'/%3E";
  }

  /**
   * The sentinel for a field, chosen by WIDGET — never by inspecting the current
   * value, which is absent precisely when a sentinel is needed.
   *
   * Shape-preserving is the whole point: a renderer reading an object_browser
   * field does `block.href?.[0]?.['@id']` or maps over it, so handing it a bare
   * string would make it iterate characters.
   *
   * Returns undefined for a field that has no inline affordance (select, boolean,
   * number …) — those are sidebar-only and nothing can be revealed for them.
   */
  _revealSentinelFor(fieldDef, fieldType) {
    const Z = Bridge.REVEAL_ZWS;
    // The admin DECORATES field defs — a copyFromTargetField wrapper keeps the real
    // one under `baseWidget`. Read the wrapper and every media/link field looks like
    // an unknown widget and silently yields no sentinel, so it never reveals.
    let def = fieldDef;
    while (def?.baseWidget) def = def.baseWidget;
    const widget = def?.widget;
    fieldDef = def;

    if (widget === 'object_browser') return [{ '@id': Z, title: Z }];
    if (widget === 'image' || fieldDef?.type === 'image') return Bridge.REVEAL_PIXEL;
    if (widget === 'url' || fieldDef?.type === 'url') return Z;
    if (isSlateFieldType(fieldType)) return [{ type: 'p', children: [{ text: Z }] }];
    if (isTextEditableFieldType(fieldType)) return Z;
    return undefined;
  }

  /** True when a value is (or contains) a reveal sentinel rather than real content. */
  _isRevealSentinel(value) {
    const Z = Bridge.REVEAL_ZWS;
    if (value === Z || value === Bridge.REVEAL_PIXEL) return true;
    if (Array.isArray(value) && value.length === 1) {
      const only = value[0];
      if (only && only['@id'] === Z) return true;
      if (only?.children?.length === 1 && only.children[0]?.text === Z) return true;
    }
    return false;
  }

  /**
   * The block's schema fields that COULD be revealed: ones with an inline
   * affordance that the frontend is currently rendering no element for.
   *
   * Purely observational — no schema annotation, no dependence on `required`
   * (most block schemas here don't declare it).
   *
   * DELIBERATELY OVER-INCLUSIVE, don't "fix" this. The widget/type only says a
   * field COULD be edited inline, not that this frontend renders it: alt text, a
   * css class, a free-text style value are all plain strings that live in the
   * sidebar. Telling them apart from an empty heading is impossible without data,
   * since "renders nothing because it's empty" and "never renders inline" look
   * identical — it would need a schema annotation or a frontend-side declaration,
   * i.e. exactly the per-field bookkeeping #296 exists to remove.
   *
   * So reveal is BEST-EFFORT: it seeds every candidate, the ones the frontend
   * renders appear, and the rest are a no-op. A sentinel for a field nobody
   * renders is harmless — it lives only in the render projection, never in state
   * and never in saved content — and the editor fills those from the sidebar as
   * before. No warning is raised for them: a frontend that legitimately keeps a
   * field sidebar-only is not misconfigured.
   */
  revealableFields(blockUid) {
    const schema = this.getBlockSchema(blockUid);
    const properties = schema?.properties;
    const block = this.getBlockData(blockUid);
    if (!properties || !block) return [];

    const isEmpty = (v) =>
      v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

    return Object.entries(properties)
      .filter(([fieldName, fieldDef]) => {
        // Has an inline affordance at all. Returns undefined for select /
        // boolean / number, so sidebar-only fields drop out for free.
        if (!this._revealSentinelFor(fieldDef, this.getFieldType(blockUid, fieldName))) {
          return false;
        }
        // A REQUIRED field is rendered unconditionally by the frontend (a value
        // is guaranteed, so no `{field && …}` guard), which means its element
        // always exists and there is nothing to reveal. Excluding it keeps the
        // button's "N empty optional fields" count honest. If a required field
        // ever IS missing an element, that's a renderer bug for the dev-warning
        // to shout about — not something reveal should paper over.
        if (schema.required?.includes(fieldName)) return false;
        return isEmpty(block[fieldName]);
      })
      .map(([fieldName]) => fieldName);
  }

  /**
   * Blocks currently in reveal mode, as a Set of blockUid.
   *
   * Per BLOCK, not per field: reveal is one mode ("show me this block's empty
   * optional fields"), so whatever is empty at render time shows. That keeps it
   * consistent while revealed — empty a field and its element stays, because the
   * block is still in reveal mode — without any second, invisible way for a field
   * to become revealed.
   *
   * Deliberately NOT sticky per field on edit. Emptying a field has to mean the
   * field is gone, or there is no single action for "I want no image": the editor
   * would delete, then have to dismiss the leftover placeholder through a
   * block-level control. Swapping an image costs nothing either way — the quanta
   * toolbar's image button (SyncedSlateToolbar.jsx, gated on focusedMediaField)
   * replaces it in one click without deleting first.
   */
  get revealedBlocks() {
    if (!this._revealedBlocks) this._revealedBlocks = new Set();
    return this._revealedBlocks;
  }

  /**
   * Toggle reveal for a block. Reveal is ALWAYS EXPLICIT — nothing here runs on
   * selection, on insert, or on a field becoming empty.
   */
  toggleOptionalFields(blockUid) {
    if (this.revealedBlocks.has(blockUid)) this.revealedBlocks.delete(blockUid);
    else this.revealedBlocks.add(blockUid);
    if (this.onContentChangeCallback) this._executeRender(this.onContentChangeCallback);
  }

  _projectForRender(formData) {
    if (!formData || !this.blockPathMap) return formData;

    // Container fields hold structure, not content — an empty one still has to
    // arrive as an array for the renderer to map over.
    const CONTAINER_WIDGETS = new Set(['blocks_layout', 'object_list']);

    let projected = null; // cloned lazily; most renders change nothing
    for (const blockUid of Object.keys(this.blockPathMap)) {
      if (blockUid === '_schemas' || blockUid === '_page') continue;
      const schema = this.getBlockSchema(blockUid);
      const properties = schema?.properties;
      if (!properties) continue;

      const pathInfo = this.blockPathMap[blockUid];
      const source = this.getBlockData(blockUid);
      if (!source || !pathInfo?.path) continue;

      for (const [fieldName, fieldDef] of Object.entries(properties)) {
        if (CONTAINER_WIDGETS.has(fieldDef?.widget)) continue;
        const value = source[fieldName];
        if (!Array.isArray(value) || value.length > 0) continue;

        // First actual change on this render — clone before touching anything.
        if (!projected) projected = JSON.parse(JSON.stringify(formData));
        let target = projected;
        for (const key of pathInfo.path) target = target?.[key];
        if (target) delete target[fieldName];
      }

      // Reveal: seed a sentinel into each empty inline field of a revealed
      // block, so the renderer's own `{field && …}` rule fires and produces an
      // element to click. Nothing here is persisted — the sentinel exists only
      // in this projection and in the DOM.
      // Re-derived every render, and stable BECAUSE sentinels never enter state:
      // the projection reads this.formData, which stays empty for these fields, so
      // the answer doesn't change once revealed. (The old DOM-based rule asked "is
      // there no element?" — a question revealing itself falsified, so the field
      // flickered back out on the next render.)
      if (!this._revealedBlocks?.has(blockUid)) continue;
      // revealableFields is already "empty AND has an inline affordance", so a
      // field the editor has since filled drops out on its own and no sentinel is
      // written over real content.
      for (const fieldName of this.revealableFields(blockUid)) {
        const fieldDef = properties[fieldName];
        const sentinel = this._revealSentinelFor(
          fieldDef,
          this.getFieldType(blockUid, fieldName),
        );
        if (sentinel === undefined) continue;
        if (!projected) projected = JSON.parse(JSON.stringify(formData));
        let target = projected;
        for (const key of pathInfo.path) target = target?.[key];
        if (target) target[fieldName] = sentinel;
      }
    }
    // What the renderer was actually handed. materializeHydraComments needs this
    // (not this.formData) to tell "field is empty, so no element is CORRECT" from
    // "field has content but the renderer produced no element" — including a
    // revealed sentinel, whose element failing to appear means reveal did nothing.
    this._lastRenderedData = projected || formData;
    return this._lastRenderedData;
  }

  _executeRender(callbackFn, afterRenderOptions = {}) {
    this._renderInProgress = true;
    this._renderStartTime = performance.now();

    const blockId = this.selectedBlockUid;
    const blockEl = blockId && this.queryBlockElement(blockId);

    // Skip re-render when formData is identical to what we already have
    // (echo from admin after inline editing). Calling the callback with
    // unchanged data would replace DOM nodes, destroying cursor/observer.
    // Never skip when blockedBlockId is set — afterContentRender must run
    // to clear blocking state (replayBufferAndUnblock / setBlockProcessing).
    if (this._isEchoFormData && !afterRenderOptions.skipRender && !this.blockedBlockId) {
      log('_executeRender: echo FORM_DATA (identical data), skipping re-render');
      this._renderInProgress = false;
      return;
    }

    // Block keyboard input during re-render to prevent keystrokes hitting
    // detached DOM elements. The re-render callback replaces innerHTML, which
    // destroys the focused element; any keystroke arriving between now and
    // afterContentRender (where focus is restored) would be lost.
    // Only block when inline editing and not already blocked by a format op.
    if (this.isInlineEditing && this.focusedFieldName && !this.blockedBlockId) {
      this._ensureDocumentKeyboardBlocker();
      this.blockedBlockId = this.selectedBlockUid;
      this._reRenderBlocking = true;
      this._setPointerBlocking(true);
      // Save cursor position before re-render so we can restore it when
      // no transformedSelection is provided (e.g. sidebar-originated FORM_DATA).
      // Without this, the browser resets cursor to position 0 after DOM
      // replacement and buffered keystrokes replay at the wrong position.
      this._preRenderSelection = this.savedSelection;
    }

    // Disconnect MutationObserver before rendering. The framework
    // re-render will mutate DOM (text nodes, elements) and we must
    // not run handleTextChange on framework-generated mutations.
    // The observer is re-attached in afterContentRender.
    if (this.blockTextMutationObserver) {
      this.blockTextMutationObserver.disconnect();
    }

    // Call the callback to trigger the render. The renderer never sees
    // this.formData directly — it gets a projection (see _projectForRender).
    callbackFn(this._projectForRender(this.formData));

    const afterRender = () => {
      this.afterContentRender(afterRenderOptions);
    };

    // Check if content is ready and whether cursor needs immediate restoration.
    // Fast path (synchronous): only when iframe has active cursor at risk
    //   - pendingTransform: format/Enter/Backspace operation in flight
    //   - _reRenderBlocking + _iframeFocused: echo FORM_DATA during inline typing
    // Delayed path (rAF): everything else — gives async frameworks (Nuxt/Vue)
    //   one frame to patch the DOM before afterContentRender reads it.
    const { ready: contentReady } = this._areBlocksReady(blockId, blockEl, afterRenderOptions);
    // adminSelectedBlockUid signals a structural change (block add/delete/move)
    // — always give the framework time to render, even if content looks ready.
    const isStructuralChange = !!afterRenderOptions.adminSelectedBlockUid;
    const needsFastPath = this.pendingTransform
      || (this._reRenderBlocking && this._iframeFocused && !isStructuralChange);

    // Poll until blocks are ready, then call afterRender.
    //
    // Navigation rules for target blocks (carousel slides, tabs, etc.):
    // - Target visible → poll content ready. On timeout, give up and proceed
    //   (rendered, just can't verify content match).
    // - Target not visible, navigation possible → trigger tryMakeBlockVisible
    //   once, keep polling. When target becomes visible, reset content retries.
    // - Target not visible, no navigation possible → wait for framework to
    //   render. On timeout, give up without selecting (block never appeared).
    let navigationTriggered = false;
    let contentRetryBudget = 0; // set when target becomes visible after navigation
    const CONTENT_RETRIES = 60; // ~1s at rAF rate
    const NAV_CONTENT_RETRIES = 60; // fresh budget after navigation completes

    const pollBlocksReady = (retries = CONTENT_RETRIES) => {
      const newBlockId = afterRenderOptions.adminSelectedBlockUid;
      const result = this._areBlocksReady(blockId, blockId && this.queryBlockElement(blockId), afterRenderOptions);

      if (result.ready) {
        const elapsed = this._renderStartTime ? (performance.now() - this._renderStartTime).toFixed(0) : '?';
        log('pollBlocksReady: DONE +' + elapsed + 'ms ready=true');
        afterRender();
        return;
      }

      // Target not visible — try navigation (once)
      if (newBlockId && !result.targetVisible && !navigationTriggered) {
        if (!this._navigatingToBlock) {
          this.tryMakeBlockVisible(newBlockId);
        }
        navigationTriggered = true;
      }

      // Target just became visible after navigation — reset content retries (once)
      if (navigationTriggered && result.targetVisible && !contentRetryBudget) {
        contentRetryBudget = NAV_CONTENT_RETRIES;
        log('pollBlocksReady: target visible after navigation, resetting content retries');
      }

      // Use post-navigation budget if active, otherwise pre-navigation retries
      if (contentRetryBudget > 0) {
        contentRetryBudget--;
        if (contentRetryBudget <= 0) {
          // Post-navigation content retries exhausted — target is visible but
          // content doesn't match. Give up and proceed (rendered, can't verify).
          const elapsed = this._renderStartTime ? (performance.now() - this._renderStartTime).toFixed(0) : '?';
          log('pollBlocksReady: TIMEOUT +' + elapsed + 'ms target visible after nav, proceeding');
          afterRender();
          return;
        }
      } else if (retries <= 0) {
        const elapsed = this._renderStartTime ? (performance.now() - this._renderStartTime).toFixed(0) : '?';
        if (result.targetVisible || !newBlockId) {
          // No navigation needed, content just doesn't match — give up and proceed.
          log('pollBlocksReady: TIMEOUT +' + elapsed + 'ms proceeding anyway');
          afterRender();
        } else {
          // Target never became visible. Fall back to selecting whatever IS
          // visible: previous block, parent container, or deselect.
          log('pollBlocksReady: TIMEOUT +' + elapsed + 'ms target NOT visible, falling back');
          const prevEl = blockId && this.queryBlockElement(blockId);
          if (prevEl && !this.isElementHidden(prevEl)) {
            log('pollBlocksReady: fallback to previous block:', blockId);
            afterRenderOptions.adminSelectedBlockUid = null;
            afterRenderOptions.needsBlockSwitch = false;
            this.selectBlock(prevEl);
          } else {
            // Check parent container
            const targetEl = newBlockId && this.queryBlockElement(newBlockId);
            const container = (targetEl || prevEl)?.closest?.('[data-block-uid]');
            if (container && !this.isElementHidden(container)) {
              const containerId = container.getAttribute('data-block-uid');
              log('pollBlocksReady: fallback to parent container:', containerId);
              afterRenderOptions.adminSelectedBlockUid = null;
              this.selectBlock(container);
            } else {
              log('pollBlocksReady: nothing visible, deselecting');
              this.sendMessageToParent({ type: 'BLOCK_DESELECTED' });
            }
          }
          afterRender();
        }
        return;
      }

      requestAnimationFrame(() => pollBlocksReady(retries - 1));
    };

    log('_executeRender: contentReady:', contentReady, 'skipRender:', !!afterRenderOptions.skipRender, 'pendingTransform:', !!this.pendingTransform, '_reRenderBlocking:', !!this._reRenderBlocking, 'needsFastPath:', needsFastPath, 'isStructuralChange:', isStructuralChange);
    if (afterRenderOptions.skipRender) {
      afterRender();
    } else if (needsFastPath && contentReady) {
      afterRender();
    } else if (isStructuralChange) {
      // Structural change (block add/delete/move): wait for the DOM to settle
      // (framework finishes rendering), then poll for target block readiness.
      // Can't trust contentReady here — old DOM may still match while the
      // framework hasn't rendered the new/deleted block yet.
      const settleTimeout = setTimeout(() => {
        if (this._onDomSettled) {
          this._onDomSettled = null;
          pollBlocksReady();
        }
      }, 200);
      this._onDomSettled = () => {
        clearTimeout(settleTimeout);
        pollBlocksReady();
      };
    } else if (contentReady) {
      // Content matches but the framework may still be rendering async
      // (innerHTML replacement, Vue patching, etc.). Wait for the structural
      // observer to signal DOM settlement before running afterContentRender.
      // Fallback timeout ensures we don't wait forever if no mutation fires
      // (e.g. echo FORM_DATA where the render produces identical DOM).
      const settleTimeout = setTimeout(() => {
        if (this._onDomSettled) {
          this._onDomSettled = null;
          afterRender();
        }
      }, 200);
      this._onDomSettled = () => {
        clearTimeout(settleTimeout);
        afterRender();
      };
    } else {
      // Content not ready — poll until ready
      requestAnimationFrame(() => pollBlocksReady());
    }
  }

  /**
   * Waits for a DOM mutation on the given element before calling the callback.
   * Used after sync onEditChange callbacks to wait for framework re-renders
   * (Vue, React, etc.) before proceeding with selection restore and buffer replay.
   * Falls back to calling the callback after a timeout if no mutation occurs.
   */
  _waitForDomMutation(element, callback) {
    let called = false;
    const proceed = (source) => {
      if (called) return;
      called = true;
      observer.disconnect();
      log('_waitForDomMutation proceed via:', source);
      callback();
    };
    const observer = new MutationObserver(() => {
      // Proceed immediately on mutation — content readiness is checked
      // by isContentReady/pollUntilReady in afterContentRender.
      proceed('mutation');
    });
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    // Fallback if no mutation (e.g., data didn't change visible content)
    setTimeout(() => proceed('timeout'), 200);
  }

  /**
   * Checks if an element is hidden (display: none, visibility: hidden, or zero dimensions)
   * @param {HTMLElement} el - The element to check
   * @returns {boolean} True if the element is hidden
   */
  isElementHidden(el) {
    if (!el) return true;
    // Platform API: covers every hiding mechanism the browser knows
    // about — display:none, visibility:hidden, content-visibility:auto,
    // AND the closed <details> internal-slot case that computed style
    // and getBoundingClientRect both miss. Same primitive Playwright
    // uses for its own visibility checks.
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkVisibilityCSS: true })) return true;
    } else {
      // Fallback for older runtimes (shouldn't fire on current evergreen
      // browsers — Chromium 105+, Safari 17.4+, Firefox 125+).
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
      const rect0 = el.getBoundingClientRect();
      if (rect0.width === 0 && rect0.height === 0) return true;
    }
    // checkVisibility() doesn't catch off-screen translates (e.g. Flowbite
    // carousel uses translate-x-full to hide slides while keeping them
    // rendered). Element is hidden if it's completely outside its
    // [data-block-uid] container's horizontal bounds.
    const rect = el.getBoundingClientRect();
    const container = el.parentElement?.closest('[data-block-uid]');
    if (container) {
      const containerRect = container.getBoundingClientRect();
      if (rect.right <= containerRect.left || rect.left >= containerRect.right) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find the visible DOM element for a block uid.
   * When multiple elements share the same data-block-uid (e.g. listing items
   * expanded into carousel slides), querySelector returns the first which may
   * be hidden.  This method returns the first *visible* match, falling back
   * to the first match if none are visible.
   * @param {string} uid - The block uid to search for
   * @returns {HTMLElement|null}
   */
  queryBlockElement(uid) {
    let all = document.querySelectorAll(`[data-block-uid="${uid}"]`);
    if (all.length === 0) {
      // Block not found — frontend may use hydra comments instead of
      // data attributes. Materialize any comments and retry.
      this.materializeHydraComments();
      all = document.querySelectorAll(`[data-block-uid="${uid}"]`);
      if (all.length === 0) return null;
    }
    if (all.length === 1) return all[0];
    for (const el of all) {
      if (!this.isElementHidden(el)) return el;
    }
    return all[0];
  }

  /**
   * Tries to make a block visible by clicking data-block-selector elements.
   * First looks for a direct selector (data-block-selector="{uid}"),
   * then tries +1/-1 navigation to reach the target block.
   * @param {string} targetUid - The UID of the block to make visible
   * @returns {boolean} True if a selector was clicked (block may now be visible)
   */

  /**
   * Show the place a FIELD is edited, if it is not already on screen.
   *
   * Not the same question as "is the block visible". A block can be drawn in
   * several places with a different field in each: the design system's cookie
   * consent puts its message in a banner and its category wording in a
   * preferences dialog, each built in JavaScript into `<body>`, each hidden
   * until its own trigger is pressed — while the block's own element (its
   * editing bar) sits on screen the whole time. Asking about the block would
   * always answer "visible" and reveal nothing.
   *
   * Does nothing when the field is already showing, and nothing when no handle
   * advertises it — so it is safe to call on every sidebar focus.
   *
   * @returns {boolean} whether a reveal was attempted
   */
  revealFieldPlace(blockId, fieldName) {
    if (!blockId || !fieldName) return false;
    // OPT-IN, and strictly so: unless a handle advertises this exact field,
    // there is nothing to reveal and nothing to do.
    //
    // Falling back to the block's own handle here was wrong, and wrong in a way
    // that reached far beyond this feature: most sidebar fields have no element
    // on the canvas at all — alignment, a link's href, any setting — so "no
    // element" is the ordinary case rather than a hidden one. With a fallback,
    // every focus in the sidebar clicked whatever handle the block or its
    // ANCESTORS published, opening containers nobody asked to open. Five of
    // hydra's own integration tests failed on it.
    if (!this.fieldHandleFor(blockId, fieldName)) return false;
    const blockElement = this.queryBlockElement(blockId);
    // Any kind of field: an image or a link can sit in the half a trigger opens
    // just as a paragraph can, and the sidebar focus that asks for this reveal
    // does not care which picker the field opens.
    const fieldElement =
      blockElement && this.editableElementFor(blockElement, fieldName);
    if (fieldElement && !this.isElementHidden(fieldElement)) return false;
    return this.tryMakeBlockVisible(blockId, 0, fieldName);
  }

  /**
   * Every element advertising this block — as the block (`uid`) or as the place
   * one of its fields is edited (`uid#field`). `~=` matches whole tokens, so
   * the field form needs its own pattern.
   */
  handlesFor(uid, fieldName = null) {
    if (!uid) return [];
    const selector =
      fieldName === null
        ? `[data-block-selector~="${uid}"], [data-block-selector*="${uid}#"]`
        : `[data-block-selector~="${uid}#${fieldName}"]`;
    // An element that declares a VALUE is a field to fill on the way to the
    // block, not something standing in for it. Excluding it here is what keeps
    // two handles able to share one form: the button is the activator, the
    // inputs beside it are not, and every existing caller — field handles,
    // owningBlockUid, the label on a tab button — sees exactly what it did
    // before, because no page carried this attribute until now.
    return [...document.querySelectorAll(selector)].filter(
      (el) => !el.hasAttribute('data-block-selector-input'),
    );
  }

  /**
   * The inputs a block declares as the way to bring it into being.
   *
   * `data-block-selector` reveals by CLICKING — a tab, a carousel dot, a step.
   * That cannot reach a block which does not exist until a question is asked:
   * a search's answer, a filtered listing, anything downstream of a query.
   * There is nothing to click that produces a question. So the frontend puts
   * the question next to the thing to click, joined by the same uid:
   *
   *     <input  data-block-selector="answer" data-block-selector-input="what is inka">
   *     <button data-block-selector="answer">Search</button>
   */
  fillersFor(uid) {
    if (!uid) return [];
    return [
      ...document.querySelectorAll(
        `[data-block-selector~="${uid}"][data-block-selector-input], ` +
          `[data-block-selector*="${uid}#"][data-block-selector-input]`,
      ),
    ];
  }

  /**
   * Put a declared value into a field so the FRAMEWORK sees it.
   *
   * Assigning `.value` does not notify Vue's v-model or React's controlled
   * inputs — the field looks filled, submits empty, and the reveal times out
   * with nothing to explain it. React in particular tracks the last value on
   * the node and skips the change unless the NATIVE setter is used.
   */
  static setDeclaredValue(el, value) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      const on = value !== 'false' && value !== '0' && value !== '';
      if (el.checked === on) return;
      el.checked = on;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const proto =
      el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Fill every field this block declares. Returns the fields filled, so the
   * caller can submit one of their forms when there is no separate activator.
   */
  fillDeclaredInputs(uid) {
    const fillers = this.fillersFor(uid);
    for (const el of fillers) {
      Bridge.setDeclaredValue(el, el.getAttribute('data-block-selector-input'));
    }
    if (fillers.length) {
      log(`tryMakeBlockVisible: filled ${fillers.length} declared input(s) for ${uid}`);
    }
    return fillers;
  }

  /** The handle advertising where one field of a block is edited, if any. */
  fieldHandleFor(blockId, fieldName) {
    return this.handlesFor(blockId, fieldName)[0] || null;
  }

  /**
   * The block's editable elements that live on a handle rather than inside the
   * block's own element — a tab's label on the button that reveals its panel,
   * the wording of a cookie banner the design system builds into `<body>`.
   *
   * Any kind of field, not just text: a link or an image can be drawn in the
   * same place, and `attr` says which annotation to look for. Pass a
   * `fieldName` to ask for one field.
   *
   * The handle's OWN text counts by virtue of advertising the uid (an accordion
   * header carrying both attributes IS the panel's title, and may advertise its
   * children as well); anything nested inside is only this block's if it
   * resolves to it.
   */
  fieldsOnHandlesFor(uid, { attr = 'data-edit-text', fieldName = null } = {}) {
    const found = [];
    const wanted = (el) => fieldName === null || el.getAttribute(attr) === fieldName;
    for (const handle of this.handlesFor(uid)) {
      if (handle.hasAttribute(attr) && wanted(handle) && !found.includes(handle)) {
        found.push(handle);
      }
      for (const field of handle.querySelectorAll(`[${attr}]`)) {
        if (!wanted(field) || found.includes(field)) continue;
        if (this.owningBlockUid(field) === uid) found.push(field);
      }
    }
    return found;
  }

  tryMakeBlockVisible(targetUid, depth = 0, fieldName = null) {
    log(`tryMakeBlockVisible: ${targetUid}`);
    // Nested closed containers need one pass each. Bounded so a container that
    // never opens can't spin.
    if (depth > MAX_REVEAL_DEPTH) {
      log(`tryMakeBlockVisible: giving up after ${depth} passes for ${targetUid}`);
      this._navigatingToBlock = null;
      return false;
    }
    // Set flag to prevent handleBlockSelector from interfering
    this._navigatingToBlock = targetUid;
    // Word-list match (`~=`) lets a single trigger element expose many
    // descendants — `data-block-selector="uid-a uid-b uid-c"` matches
    // any listed uid. Used by collapsible containers like a
    // contextNavigation `<summary>` that carries every child's uid.
    //
    // A block can also be drawn in SEVERAL places at once, with a different
    // field in each: the design system's cookie consent puts its message in a
    // banner and its category wording in a preferences dialog, both built into
    // `<body>`, both hidden until their own trigger is pressed. One handle per
    // uid cannot serve that — whichever half it opened, the other's wording
    // would stay unreachable. So a handle may name a FIELD as well:
    //
    //     data-block-selector="uid#message"   → opens where `message` is edited
    //     data-block-selector="uid"           → opens the block, any field
    //
    // `#` rather than `:`, which already means navigation (`uid:direction`).
    // The field handle is preferred when the caller says which field it is
    // after, and the plain one remains the fallback — so nothing that exists
    // today changes.
    // Every element that advertises the field, then every one that advertises
    // the block — in that order of preference, but ALL of them: a place a field
    // is edited may advertise itself as well as being opened by a trigger
    // elsewhere (the cookie-consent banner does exactly that, so that the
    // wording inside it belongs to a block at all). Taking only the first match
    // in document order would then hand back the hidden half and give up.
    const candidates = [
      ...(fieldName ? this.handlesFor(targetUid, fieldName) : []),
      ...this.handlesFor(targetUid, null).filter((el) =>
        Bridge.selectorTokens(el).includes(targetUid),
      ),
    ];
    const directCandidate = candidates[0] || null;
    // A handle that is itself hidden — inside a container that is still closed —
    // cannot be used yet: clicking it opens ITS container while the outer one
    // stays shut, so the target never appears. Use the first one that IS
    // reachable; if none is, fall through to the ancestor walk and open from the
    // outside in, and these become usable on a later pass.
    const directSelector =
      candidates.find((el) => !this.isElementHidden(el)) || null;
    if (directCandidate && !directSelector) {
      log(`tryMakeBlockVisible: handle for ${targetUid} is itself hidden, opening its ancestors first`);
    }
    // Click the appropriate selector to navigate toward the target block.
    // For direct selectors (data-block-selector="{uid}"), one click suffices.
    // For +1/-1 selectors, we click once and may recurse if more steps are needed.
    let clickedSelector = null;
    let nextUid = targetUid; // UID we expect to become visible after one click

    // Nothing published a handle for this uid: ask its ANCESTORS. A container
    // that can reveal its contents publishes one handle carrying its own uid;
    // making every frontend also enumerate each descendant duplicates what
    // blockPathMap already knows, and a descendant it forgets is simply
    // unreachable. Walk up and use the nearest ancestor that published one.
    //
    // The +1/-1 path below can't cover this case: it needs the target element
    // already in the DOM, and a block inside a closed container often isn't
    // rendered at all.
    let ancestorSelector = null;
    let ancestorUid = null;
    // Only ancestor passes count toward the depth bound. A +1/-1 walk recurses
    // once per step and terminates on its own index arithmetic — counting those
    // made a carousel with more than MAX_REVEAL_DEPTH slides give up partway.
    let usedAncestor = false;
    if (!directSelector) {
      // Collect every ancestor that published a handle, then use the OUTERMOST.
      // Order matters when containers nest: an inner container's handle can
      // itself be inside a closed outer one, and opening the inner first leaves
      // the target hidden with nothing left to click. Opening from the outside
      // in always makes progress.
      const seen = new Set([targetUid]);
      const handles = [];
      // `child` is what sits one step BELOW this ancestor on the way to the
      // target — the thing that actually appears when this container opens.
      let childUid = targetUid;
      let parentUid = this.blockPathMap?.[targetUid]?.parentId;
      while (parentUid && !seen.has(parentUid)) {
        seen.add(parentUid);
        // A handle naming the ancestor's REGION counts as naming what is in it:
        // `uid#field` says where that field is edited, and when the field is a
        // region — a blocks_layout or an object_list — the blocks inside it are
        // edited exactly there. A container publishes one handle for the region
        // rather than enumerating children it cannot know in advance, and the
        // bare-uid form still works for a container that reveals everything.
        const childRegion = this.blockPathMap?.[childUid]?.region;
        const handle =
          (childRegion &&
            document.querySelector(
              `[data-block-selector~="${parentUid}#${childRegion}"]`,
            )) ||
          document.querySelector(`[data-block-selector~="${parentUid}"]`);
        if (handle) handles.push({ uid: parentUid, handle, child: childUid });
        childUid = parentUid;
        parentUid = this.blockPathMap?.[parentUid]?.parentId;
      }
      // Skip handles whose container is ALREADY open: on the second pass the
      // outer one is open, and re-picking it would loop instead of descending
      // to the handle that pass just made reachable.
      const stillClosed = handles.filter(({ handle }) => {
        if (handle.getAttribute('aria-expanded') === 'true') return false;
        const details = handle.tagName === 'SUMMARY' ? handle.closest('details') : null;
        if (details && details.open) return false;
        return !this.isElementHidden(handle);
      });
      // NEAREST reachable ancestor, not the outermost. The reachability filter
      // above already skips handles buried in a closed container, so the nearest
      // survivor is the right one to click — and picking the outermost instead
      // sent carousel reveals to a container far above the slider that owns the
      // slide.
      const outermost = stillClosed[0];
      if (outermost) {
        log(`tryMakeBlockVisible: no handle for ${targetUid}, using ancestor ${outermost.uid}`);
        ancestorSelector = outermost.handle;
        // Wait on the CHILD, not the container. A collapsed panel's own element
        // is already visible — only its contents are hidden — so watching the
        // container reported success on the first frame and recursed before
        // anything had rendered.
        ancestorUid = outermost.child;
      }
    }

    if (directSelector) {
      log(`tryMakeBlockVisible: found direct selector for ${targetUid}`);
      clickedSelector = directSelector;
    } else if (ancestorSelector) {
      usedAncestor = true;
      // Opening the ancestor may expose the target directly, or reveal another
      // closed container inside it. Waiting on the ANCESTOR rather than the
      // target is what lets the existing check recurse: once the ancestor is
      // open we run again, and the handle that was buried inside it is now
      // reachable. Waiting on the target instead just polled a hidden element
      // until the timeout.
      clickedSelector = ancestorSelector;
      nextUid = ancestorUid;
    } else if (this.fillersFor(targetUid).length) {
      // Declared inputs but no separate activator: the field IS the trigger, so
      // fill it and submit its own form (the Enter case). Handled before the
      // +1/-1 walk because that walk needs the target element to exist, and the
      // whole point of this branch is that it does not yet.
      const filled = this.fillDeclaredInputs(targetUid);
      const form = filled[filled.length - 1]?.closest('form');
      if (!form) {
        log(`tryMakeBlockVisible: declared inputs for ${targetUid} but no form to submit`);
        return false;
      }
      log(`tryMakeBlockVisible: submitting the form holding ${targetUid}'s declared input`);
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    } else {
      // No direct selector - try +1/-1 navigation
      log(`tryMakeBlockVisible: no direct selector, trying +1/-1 navigation`);

      const targetElement = this.queryBlockElement(targetUid);
      if (!targetElement) {
        log(`tryMakeBlockVisible: target element not in DOM`);
        return false;
      }

      const containerBlock = targetElement.parentElement?.closest('[data-block-uid]');
      if (!containerBlock) {
        log(`tryMakeBlockVisible: no container block found`);
        return false;
      }
      const containerUid = containerBlock.getAttribute('data-block-uid');

      const directParent = targetElement.parentElement;
      if (!directParent) {
        log(`tryMakeBlockVisible: no parent element`);
        return false;
      }

      const siblings = Array.from(
        directParent.querySelectorAll(':scope > [data-block-uid]'),
      );
      log(`tryMakeBlockVisible: found ${siblings.length} siblings in container ${containerUid}`);

      const targetIndex = siblings.findIndex(
        (el) => el.getAttribute('data-block-uid') === targetUid,
      );
      if (targetIndex === -1) {
        log(`tryMakeBlockVisible: target not in siblings`);
        return false;
      }

      const currentIndex = siblings.findIndex((el) => !this.isElementHidden(el));
      const currentUid = currentIndex >= 0 ? siblings[currentIndex].getAttribute('data-block-uid') : null;
      log(`tryMakeBlockVisible: currentIndex=${currentIndex} (${currentUid}), targetIndex=${targetIndex}`);

      if (currentIndex === -1) {
        log(`tryMakeBlockVisible: no visible sibling`);
        return false;
      }

      const stepsNeeded = targetIndex - currentIndex;
      if (stepsNeeded === 0) {
        log(`tryMakeBlockVisible: already at target`);
        return false;
      }

      const direction = stepsNeeded > 0 ? '+1' : '-1';

      const explicitSelector = document.querySelector(
        `[data-block-selector="${currentUid}:${direction}"]`,
      );
      if (explicitSelector) {
        log(`tryMakeBlockVisible: found explicit selector ${currentUid}:${direction}`);
        clickedSelector = explicitSelector;
      } else {
        const simpleSelector = containerBlock.querySelector(
          `[data-block-selector="${direction}"]`,
        );
        if (simpleSelector) {
          log(`tryMakeBlockVisible: found simple selector ${direction} inside container`);
          clickedSelector = simpleSelector;
        }
      }

      if (!clickedSelector) {
        log(`tryMakeBlockVisible: no ${direction} selector found`);
        return false;
      }

      // For +1/-1, the next visible block is one step from current
      const nextIndex = currentIndex + (stepsNeeded > 0 ? 1 : -1);
      const nextBlock = siblings[nextIndex];
      nextUid = nextBlock?.getAttribute('data-block-uid');
      log(`tryMakeBlockVisible: clicking ${direction}, expecting ${nextUid} to become visible`);
    }

    // Idempotency: clicking a toggle that's already in the "open" state
    // would CLOSE it — the opposite of "make visible". For each container
    // pattern we know about, skip the toggle when it's already open.
    //
    //   <summary>  — read `details.open` directly; setting `open = true`
    //                is idempotent (no-op when already true).
    //   accordion  — the toggle button carries `aria-expanded`; if it's
    //                already "true" the panel is open, skip the click.
    //   carousel/slider — no aria-expanded; one click always moves it.
    // Whatever we are about to activate, put the declared values in first: a
    // submit button that reveals a query-gated block does nothing with an empty
    // field. No-op for every block that declares none, which is all of them
    // until a frontend opts in.
    this.fillDeclaredInputs(targetUid);

    const summaryDetails =
      clickedSelector.tagName === 'SUMMARY'
        ? clickedSelector.closest('details')
        : null;
    const expandedAttr = clickedSelector.getAttribute('aria-expanded');
    if (summaryDetails) {
      summaryDetails.open = true;
      log(`tryMakeBlockVisible: opened <details> via summary`);
    } else if (expandedAttr === 'true') {
      log(`tryMakeBlockVisible: target trigger already expanded, skipping click`);
    } else {
      clickedSelector.click();
      log(`tryMakeBlockVisible: click() called`);
    }

    const startTime = performance.now();
    const MAX_WAIT_MS = 2000;

    const checkVisibility = () => {
      const elapsed = performance.now() - startTime;
      const currentNextBlock = this.queryBlockElement(nextUid);

      if (elapsed > 0 && Math.floor(elapsed / 500) !== Math.floor((elapsed - 16) / 500)) {
        if (currentNextBlock) {
          const rect = currentNextBlock.getBoundingClientRect();
          const container = currentNextBlock.parentElement?.closest('[data-block-uid]');
          const containerRect = container?.getBoundingClientRect();
          log(`tryMakeBlockVisible debug: rect=${Math.round(rect.width)}x${Math.round(rect.height)} left=${Math.round(rect.left)} containerLeft=${containerRect ? Math.round(containerRect.left) : 'none'} containerRight=${containerRect ? Math.round(containerRect.right) : 'none'}`);
        } else {
          log(`tryMakeBlockVisible debug: element not found in DOM`);
        }
      }

      if (currentNextBlock && !this.isElementHidden(currentNextBlock)) {
        log(`tryMakeBlockVisible: ${nextUid} is now visible after ${Math.round(elapsed)}ms`);
        if (nextUid === targetUid) {
          log(`tryMakeBlockVisible: reached target ${targetUid}`);
          this._navigatingToBlock = null;
          return;
        }
        // Need more clicks - recurse
        log(`tryMakeBlockVisible: not at target yet, continuing navigation`);
        this.tryMakeBlockVisible(targetUid, usedAncestor ? depth + 1 : depth);
        return;
      }

      if (elapsed < MAX_WAIT_MS) {
        requestAnimationFrame(checkVisibility);
      } else {
        log(`tryMakeBlockVisible: timeout waiting for ${nextUid} after ${Math.round(elapsed)}ms`);
        this._navigatingToBlock = null;
      }
    };

    // Start checking on next frame (after click event has propagated)
    requestAnimationFrame(checkVisibility);
    return true;
  }

  /**
   * Collects all editable fields from a block element.
   * For multi-element blocks, searches ALL elements with the same UID.
   * @returns {Object} Map of field names to their types
   */
  getEditableFields(blockElement) {
    if (!blockElement) return {};
    const blockUid = blockElement.getAttribute('data-block-uid');
    return this.collectBlockFields(blockElement, 'data-edit-text',
      (el, name, results) => { results[name] = this.getFieldType(blockUid, name) || 'string'; });
  }

  /**
   * Observe the DOM for the changes to select and scroll the block with the given UID into view
   * @param {String} uid - UID of the block
   */
  observeForBlock(uid) {
    if (this.blockObserver) this.blockObserver.disconnect();
    this.blockObserver = new MutationObserver((mutationsList, observer) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList') {
          const blockElement = document.querySelector(
            `[data-block-uid="${uid}"]`,
          );

          if (blockElement && this.isInlineEditing) {
            this.selectBlock(blockElement);
            !this.elementIsVisibleInViewport(blockElement, true) &&
              blockElement.scrollIntoView({ behavior: 'smooth' });
            observer.disconnect();
            return;
          }
        }
      }
    });

    this.blockObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Adding NodeIds in Slate Block's Json
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Add nodeIds to all Slate fields in all blocks (including nested)
   * Uses blockPathMap to find all blocks, including those in containers
   */
  addNodeIdsToAllSlateFields() {
    const t0 = performance.now();
    if (!this.formData) return;

    if (!this.blockPathMap) {
      throw new Error('[HYDRA] blockPathMap is required but was not provided by admin');
    }

    // Debug: log all blocks in blockPathMap and formData.blocks
    const pathMapBlocks = Object.keys(this.blockPathMap);
    const formDataBlocks = Object.keys(this.formData.blocks || {});
    const missingFromPathMap = formDataBlocks.filter(id => !pathMapBlocks.includes(id));
    log('addNodeIdsToAllSlateFields: pathMap has', pathMapBlocks.length, 'blocks, formData has', formDataBlocks.length, 'blocks, missing:', missingFromPathMap.length > 0 ? missingFromPathMap : 'none');

    let slateCalls = 0;
    Object.entries(this.blockPathMap).forEach(([blockId, pathInfo]) => {
      const block = this.getBlockData(blockId);
      if (!block) return;

      const schema = this.getBlockSchema(blockId);
      if (!schema?.properties) return;

      // Walk the block's fields, descending into widget:'object' wrappers so a
      // slate field nested on an object (e.g. content.headline, #245) also gets
      // nodeIds — otherwise inline-editing it fails with "missing data-node-id".
      const addToFields = (obj, props) => {
        if (!obj || !props) return;
        Object.entries(props).forEach(([fieldName, fieldDef]) => {
          if (fieldDef.widget === 'object' && fieldDef.schema?.properties) {
            addToFields(obj[fieldName], fieldDef.schema.properties);
            return;
          }
          if (isSlateFieldType(getFieldTypeString(fieldDef)) && obj[fieldName]) {
            obj[fieldName] = this.addNodeIds(obj[fieldName]);
            slateCalls++;
          }
        });
      };
      addToFields(block, schema.properties);
    });
    log('addNodeIdsToAllSlateFields took', (performance.now() - t0).toFixed(1) + 'ms, slate fields:', slateCalls);
  }

  /**
   * Add path-based nodeIds to each element in the Slate block's children
   * @param {JSON} json Selected Block's data
   * @param {string} path Path in the Slate structure (e.g., "0.1.2")
   * @returns {JSON} block's data with nodeIds added
   */
  addNodeIds(json, path = '') {
    if (Array.isArray(json)) {
      return json.map((item, index) => {
        const itemPath = path ? `${path}.${index}` : `${index}`;
        return this.addNodeIds(item, itemPath);
      });
    } else if (typeof json === 'object' && json !== null) {
      // Clone the object to ensure it's extensible
      json = JSON.parse(JSON.stringify(json));

      // Skip text-only nodes - they shouldn't have nodeIds
      // A proper Slate text node has 'text' but NO 'children' and NO 'type'
      // Note: Some malformed data might have both 'text' AND 'children' on element nodes
      // (like li) - these should be treated as elements, not text nodes
      const isTextNode = json.hasOwnProperty('text') &&
                         !json.hasOwnProperty('children') &&
                         !json.hasOwnProperty('type');
      if (isTextNode) {
        return json;
      }

      // Assign path-based nodeId to this element
      json.nodeId = path;

      // Only process children array - don't recurse into metadata like 'data'
      if (json.children && Array.isArray(json.children)) {
        json.children = json.children.map((child, index) => {
          const childPath = `${path}.${index}`;
          return this.addNodeIds(child, childPath);
        });
      }
    }
    return json;
  }

  /**
   * Save current cursor/selection position
   * @returns {Object|null} Saved cursor state or null if no selection
   */
  saveCursorPosition() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    try {
      const range = selection.getRangeAt(0);
      const startContainer = range.startContainer;
      const endContainer = range.endContainer;

      // Find the closest element with data-node-id for both start and end
      const startElement = startContainer.nodeType === Node.TEXT_NODE
        ? startContainer.parentElement
        : startContainer;
      const endElement = endContainer.nodeType === Node.TEXT_NODE
        ? endContainer.parentElement
        : endContainer;

      // Walk up to find elements with VALID data-node-id (skip "undefined" etc.)
      let startNode = startElement;
      while (startNode && !(startNode.hasAttribute?.('data-node-id') && isValidNodeId(startNode.getAttribute('data-node-id')))) {
        startNode = startNode.parentElement;
      }
      let endNode = endElement;
      while (endNode && !(endNode.hasAttribute?.('data-node-id') && isValidNodeId(endNode.getAttribute('data-node-id')))) {
        endNode = endNode.parentElement;
      }

      if (!startNode || !endNode) {
        return null;
      }

      return {
        startNodeId: startNode.getAttribute('data-node-id'),
        endNodeId: endNode.getAttribute('data-node-id'),
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        isCollapsed: range.collapsed,
      };
    } catch (e) {
      console.error('[HYDRA] Error saving cursor position:', e);
      return null;
    }
  }

  /**
   * Restore cursor/selection position
   * @param {Object|null} savedCursor Saved cursor state from saveCursorPosition()
   */
  restoreCursorPosition(savedCursor) {
    if (!savedCursor) {
      return;
    }

    try {
      // Scope to current block to avoid selecting wrong element when multiple blocks visible
      const blockElement = this.selectedBlockUid
        ? this.queryBlockElement(this.selectedBlockUid)
        : document;
      const startNode = blockElement?.querySelector(`[data-node-id="${savedCursor.startNodeId}"]`);
      const endNode = blockElement?.querySelector(`[data-node-id="${savedCursor.endNodeId}"]`);

      if (!startNode || !endNode) {
        return;
      }

      // Get the text nodes inside the elements
      const startTextNode = startNode.childNodes[0] || startNode;
      const endTextNode = endNode.childNodes[0] || endNode;

      const range = document.createRange();
      const selection = window.getSelection();

      // Ensure offsets are within bounds
      const startOffset = Math.min(savedCursor.startOffset, startTextNode.textContent?.length || 0);
      const endOffset = Math.min(savedCursor.endOffset, endTextNode.textContent?.length || 0);

      range.setStart(startTextNode, startOffset);
      range.setEnd(endTextNode, endOffset);

      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch (e) {
      console.error('[HYDRA] Error restoring cursor position:', e);
    }
  }

  /**
   * Restore cursor/selection from Slate selection format
   * @param {Object} slateSelection - Slate selection object with anchor and focus
   * @param {Object} formData - Form data with Slate JSON (containing nodeIds)
   */
  /**
   * Restore cursor/selection from Slate selection format.
   * @param {Object} slateSelection - Slate selection object with anchor and focus
   * @param {Object} formData - Form data with Slate JSON (containing nodeIds)
   * @returns {boolean} true if selection was restored, false if it failed
   */
  restoreSlateSelection(slateSelection, formData) {
    log('restoreSlateSelection called with:', JSON.stringify(slateSelection));
    if (!slateSelection || !slateSelection.anchor || !slateSelection.focus) {
      console.warn('[HYDRA] restoreSlateSelection failed: invalid selection', slateSelection);
      return false;
    }

    try {
      // Find the selected block and determine field type
      if (!this.selectedBlockUid || !this.focusedFieldName) {
        log('restoreSlateSelection failed: missing selectedBlockUid or focusedFieldName');
        return false;
      }

      // Use getBlockData to handle nested blocks (formData.blocks[uid] only works for top-level)
      const block = this.getBlockData(this.selectedBlockUid);
      if (!block) {
        log('restoreSlateSelection failed: block not found', this.selectedBlockUid);
        return false;
      }

      // Resolve field path and get field type (supports page-level and nested blocks)
      const resolved = this.resolveFieldPath(this.focusedFieldName, this.selectedBlockUid);
      const fieldData = this.getBlockData(resolved.blockId);
      const fieldType = this.getFieldType(this.selectedBlockUid, this.focusedFieldName);
      const fieldValue = getFieldValue(fieldData, resolved.fieldName);

      // Find the block element for locating editable fields
      const blockElement = this.queryBlockElement(this.selectedBlockUid);
      if (!blockElement) {
        log('restoreSlateSelection failed: block element not in DOM', this.selectedBlockUid);
        return false;
      }

      // Check if this is a slate field with nodeIds
      const isSlateWithNodeIds = this.fieldTypeIsSlate(fieldType) && Array.isArray(fieldValue) && fieldValue.length > 0 && fieldValue[0]?.nodeId !== undefined;

      let anchorElement, focusElement;
      let anchorPos = null;
      let focusPos = null;

      let anchorOffset = slateSelection.anchor.offset;
      let focusOffset = slateSelection.focus.offset;

      if (isSlateWithNodeIds) {
        // Find the parent elements by nodeId from path
        const anchorResult = this.getNodeIdFromPath(fieldValue, slateSelection.anchor.path);
        const focusResult = this.getNodeIdFromPath(fieldValue, slateSelection.focus.path);

        if (!anchorResult || !focusResult) {
          console.warn('[HYDRA] restoreSlateSelection failed: could not get nodeId from path');
          return false;
        }

        // Scope to current block to avoid selecting wrong element when multiple blocks visible
        anchorElement = blockElement.querySelector(`[data-node-id="${anchorResult.nodeId}"]`);
        focusElement = blockElement.querySelector(`[data-node-id="${focusResult.nodeId}"]`);

        if (!anchorElement || !focusElement) {
          console.warn('[HYDRA] restoreSlateSelection failed: nodeId elements not found',
            { anchorNodeId: anchorResult.nodeId, focusNodeId: focusResult.nodeId });
          return false;
        }

        log('restoreSlateSelection: looking for nodeIds', {
          anchorNodeId: anchorResult.nodeId,
          focusNodeId: focusResult.nodeId,
          anchorElementFound: !!anchorElement,
          focusElementFound: !!focusElement,
          anchorElementTag: anchorElement?.tagName,
          focusElementTag: focusElement?.tagName,
          anchorElementHTML: anchorElement?.outerHTML?.substring(0, 100),
        });

        if (!anchorElement || !focusElement) {
          console.warn('[HYDRA] restoreSlateSelection failed: could not find elements by nodeId');
          return false;
        }

        // Helper to create ZWS position for cursor placement.
        // Handles Problem 3 (prospective formatting) in the ZWS strategy.
        // See "Whitespace & Zero-Width Space (ZWS) Strategy" comment block.
        const ensureZwsPosition = (result, offset, parentChildren) => {
          // Case 1: Cursor exit - offset 0 in text after an inline element
          // When there's existing text after the inline element, DON'T create ZWS or position at offset 0.
          // This avoids the browser creating a new text node when typing at offset 0.
          // Instead, return null to let findPositionByVisibleOffset handle it naturally.
          if (result.textChildIndex !== null && offset === 0 && result.textChildIndex > 0) {
            const prevChild = parentChildren[result.textChildIndex - 1];
            if (prevChild && prevChild.type && prevChild.nodeId) {
              const inlineElement = blockElement.querySelector(`[data-node-id="${prevChild.nodeId}"]`);
              if (inlineElement) {
                // Check if there's already a text node after the inline element
                const existingTextNode = inlineElement.nextSibling;
                log('restoreSlateSelection: cursor exit check - inlineElement.nextSibling:', existingTextNode?.nodeType, 'text:', JSON.stringify(existingTextNode?.textContent));
                if (existingTextNode && existingTextNode.nodeType === Node.TEXT_NODE) {
                  const existingText = existingTextNode.textContent.replace(/[\uFEFF\u200B]/g, '');
                  if (existingText.length > 0) {
                    // There's existing text - prepend ZWS to it and position after the ZWS
                    // This ensures typing modifies this text node rather than creating a new one
                    if (!existingTextNode.textContent.startsWith('\uFEFF')) {
                      existingTextNode.textContent = '\uFEFF' + existingTextNode.textContent;
                    }
                    log('restoreSlateSelection: cursor exit - prepended ZWS to existing text, positioning after ZWS');
                    return { node: existingTextNode, offset: 1 };
                  }
                }
                // No existing text or empty text - create ZWS text node right after the inline element
                const zwsNode = document.createTextNode('\uFEFF');
                inlineElement.parentNode.insertBefore(zwsNode, inlineElement.nextSibling);
                log('restoreSlateSelection: cursor exit - created ZWS after inline:', prevChild.nodeId);
                return { node: zwsNode, offset: 1 }; // Position after ZWS
              }
            }
          }

          // Case 2: Prospective formatting - offset 0 inside an empty inline element
          const targetElement = blockElement.querySelector(`[data-node-id="${result.nodeId}"]`);
          if (targetElement && offset === 0) {
            const visibleText = targetElement.textContent.replace(/[\uFEFF\u200B]/g, '');
            if (visibleText === '') {
              // Empty inline - add ZWS inside and position after it
              const zwsNode = document.createTextNode('\uFEFF');
              targetElement.appendChild(zwsNode);
              log('restoreSlateSelection: prospective formatting - created ZWS inside empty inline:', result.nodeId);
              // Track this as the active prospective inline (for handling Chrome's cursor-outside-anchor quirk)
              this.prospectiveInlineElement = targetElement;
              return { node: zwsNode, offset: 1 }; // Position after ZWS
            }
          }

          return null; // Not a ZWS case, use normal positioning
        };

        // ZWS cursor-exit positioning only for collapsed selections (caret).
        // Range selections must not create ZWS — it would shift the focus
        // and include the ZWS character in the selected text.
        const isCollapsed = slateSelection.anchor.path.toString() === slateSelection.focus.path.toString()
          && slateSelection.anchor.offset === slateSelection.focus.offset;
        if (isCollapsed) {
          if (anchorResult.parentChildren) {
            anchorPos = ensureZwsPosition(anchorResult, slateSelection.anchor.offset, anchorResult.parentChildren);
          }
          if (focusResult.parentChildren) {
            focusPos = ensureZwsPosition(focusResult, slateSelection.focus.offset, focusResult.parentChildren);
          }
        }

        // Fall back to offset calculation for non-ZWS cases
        if (!anchorPos) {
          if (anchorResult.textChildIndex !== null && anchorResult.parentChildren) {
            anchorOffset = this.calculateAbsoluteOffset(
              anchorResult.parentChildren,
              anchorResult.textChildIndex,
              slateSelection.anchor.offset
            );
            log('Calculated absolute anchor offset:', anchorOffset, 'from textChildIndex:', anchorResult.textChildIndex);
          }
          anchorPos = this.findPositionByVisibleOffset(anchorElement, anchorOffset);
        }
        if (!focusPos) {
          if (focusResult.textChildIndex !== null && focusResult.parentChildren) {
            focusOffset = this.calculateAbsoluteOffset(
              focusResult.parentChildren,
              focusResult.textChildIndex,
              slateSelection.focus.offset
            );
            log('Calculated absolute focus offset:', focusOffset, 'from textChildIndex:', focusResult.textChildIndex);
          }
          focusPos = this.findPositionByVisibleOffset(focusElement, focusOffset);
        }
      } else {
        // Simple field - use the editable field directly
        const editableField = this.getEditableFieldByName(blockElement, this.focusedFieldName);
        if (!editableField) {
          console.warn('[HYDRA] restoreSlateSelection failed: editable field not found:', this.focusedFieldName);
          return false;
        }
        anchorElement = focusElement = editableField;
        // For simple fields, use findPositionByVisibleOffset
        anchorPos = this.findPositionByVisibleOffset(anchorElement, anchorOffset);
        focusPos = this.findPositionByVisibleOffset(focusElement, focusOffset);
      }


      if (!anchorPos || !focusPos) {
        console.warn('[HYDRA] restoreSlateSelection failed: could not find positions by visible offset');
        return false;
      }

      // Set the actual selection
      const selection = window.getSelection();
      if (!selection) return false;

      // Focus the contenteditable element BEFORE setting selection
      // After re-render, focus goes to BODY - we need to restore it
      const editableElement = anchorElement.closest('[contenteditable="true"]') || anchorElement;
      if (editableElement && typeof editableElement.focus === 'function') {
        editableElement.focus();
      }

      const range = document.createRange();
      range.setStart(anchorPos.node, anchorPos.offset);
      range.setEnd(focusPos.node, focusPos.offset);

      selection.removeAllRanges();
      selection.addRange(range);
      return true;

    } catch (e) {
      console.error('[HYDRA] restoreSlateSelection failed with error:', e);
      return false;
    }
  }

  /**
   * Find DOM position (node + offset) by visible character offset.
   * Uses Range.toString().length to match the browser's text model,
   * which naturally handles empty text nodes, whitespace normalization, etc.
   *
   * @param {HTMLElement} element - Element to search within
   * @param {number} targetOffset - Target character offset in visible text
   * @returns {{node: Node, offset: number}|null} DOM position or null
   */
  findPositionByVisibleOffset(element, targetOffset) {
    const zwsPattern = /[\uFEFF\u200B]/g;

    // Helper to count visible chars (excluding ZWS)
    const visibleLength = (text) => text.replace(zwsPattern, '').length;

    log('findPositionByVisibleOffset: element=', element.tagName, 'nodeId=', element.getAttribute('data-node-id'), 'targetOffset=', targetOffset);

    // Handle offset 0 - return start of first text node
    if (targetOffset === 0) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
      let firstText = walker.nextNode();
      // Skip empty text nodes (Vue/Nuxt renders {{ node.text }} as empty text nodes)
      while (firstText && firstText.textContent.length === 0) {
        log('findPositionByVisibleOffset: offset=0, skipping empty text node');
        firstText = walker.nextNode();
      }
      if (firstText) {
        // If this is a ZWS-only text node, position AFTER the ZWS
        // This helps browsers preserve the cursor inside inline elements when typing
        if (visibleLength(firstText.textContent) === 0) {
          log('findPositionByVisibleOffset: offset=0, ZWS-only node, returning end:', firstText.textContent.length);
          return { node: firstText, offset: firstText.textContent.length };
        }
        log('findPositionByVisibleOffset: offset=0, returning start of first text');
        return { node: firstText, offset: 0 };
      }
      return null;
    }

    // Walk through text nodes, counting visible chars (excluding ZWS)
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let visibleOffset = 0;
    let node;
    let nodeIndex = 0;

    while ((node = walker.nextNode())) {
      const text = node.textContent;
      const nodeVisibleLen = visibleLength(text);
      log('findPositionByVisibleOffset: node[' + nodeIndex + ']:', {
        text: JSON.stringify(text),
        visibleLen: nodeVisibleLen,
        visibleOffset,
        parentTag: node.parentElement?.tagName,
        parentNodeId: node.parentElement?.getAttribute('data-node-id'),
      });
      nodeIndex++;

      // Count visible chars in this node
      for (let i = 0; i <= text.length; i++) {
        const visibleCharsUpToI = visibleLength(text.substring(0, i));
        const totalVisible = visibleOffset + visibleCharsUpToI;

        if (totalVisible === targetOffset) {
          // If we're at the END of this text node, check if there's a next text node
          if (i === text.length) {
            let nextNode = walker.nextNode();
            // Skip empty text nodes (Vue/Nuxt renders empty text nodes)
            while (nextNode && nextNode.textContent.length === 0) {
              log('findPositionByVisibleOffset: at end of node, skipping empty nextNode');
              nextNode = walker.nextNode();
            }
            if (nextNode) {
              // Prefer start of next text node (for cursor exit from inline elements)
              // BUT if nextNode is ZWS-only, position AFTER the ZWS (offset = length)
              // This ensures cursor is clearly inside the ZWS text node, not at boundary
              const nextVisibleLen = visibleLength(nextNode.textContent);
              if (nextVisibleLen === 0 && nextNode.textContent.length > 0) {
                // ZWS-only node - position after the ZWS
                log('findPositionByVisibleOffset: at end of node, nextNode is ZWS, positioning AFTER ZWS');
                return { node: nextNode, offset: nextNode.textContent.length };
              }
              log('findPositionByVisibleOffset: at end of node, preferring next node');
              return { node: nextNode, offset: 0 };
            }
            walker.currentNode = node;
          }
          log('findPositionByVisibleOffset: FOUND at node offset', i);
          return { node, offset: i };
        }

        if (totalVisible > targetOffset) {
          // We've passed it - return previous position
          log('findPositionByVisibleOffset: PASSED target, returning', i - 1);
          return i > 0 ? { node, offset: i - 1 } : null;
        }
      }
      visibleOffset += nodeVisibleLen;
    }

    // If we exhausted all nodes, return end of last NON-EMPTY text node
    // Vue/Nuxt creates empty text nodes ("") at the end, so we skip those
    const lastWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let lastNonEmptyNode = null;
    while ((node = lastWalker.nextNode())) {
      if (node.textContent.length > 0) {
        lastNonEmptyNode = node;
      }
    }
    if (lastNonEmptyNode) {
      log('findPositionByVisibleOffset: exhausted nodes, returning end of last non-empty node');
      return { node: lastNonEmptyNode, offset: lastNonEmptyNode.textContent.length };
    }

    return null;
  }

  /**
   * Find DOM child node at a given Slate child index.
   *
   * Walks through parentElement.childNodes counting Slate children:
   * - Text nodes count as 1 Slate child
   * - Elements with data-node-id count as 1 Slate child
   * - Elements with SAME data-node-id as previous are skipped (they're wrappers)
   *
   * This allows renderers to add wrapper elements as long as they have the same node-id.
   *
   * @param {HTMLElement} parentElement - The parent element to search within
   * @param {number} slateChildIndex - The Slate child index to find
   * @returns {Node|null} The DOM node at that Slate index, or null if not found
   */
  findChildBySlateIndex(parentElement, slateChildIndex) {
    let slateIndex = 0;
    let lastNodeId = null;

    for (const child of parentElement.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        // Skip empty text nodes - Vue creates these from {{ node.text }} when undefined
        // They don't correspond to any Slate children
        if (child.textContent.length === 0) {
          continue;
        }
        if (slateIndex === slateChildIndex) {
          return child;
        }
        slateIndex++;
        lastNodeId = null;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const nodeId = child.getAttribute('data-node-id');
        if (isValidNodeId(nodeId) && nodeId !== lastNodeId) {
          // New valid node-id element = new Slate child
          if (slateIndex === slateChildIndex) {
            return child;
          }
          slateIndex++;
          lastNodeId = nodeId;
        }
        // Elements without node-id or with same node-id are skipped (wrappers)
      }
    }
    return null;
  }

  /**
   * Find text node and validate offset within a DOM child (text node or element)
   * For text nodes: returns the node directly
   * For elements: walks to find the first text node within
   *
   * @param {Node} child - DOM node (text node or element)
   * @param {number} offset - Offset within the text content
   * @returns {{node: Text, offset: number}|null} Text node and validated offset, or null
   */
  findTextNodeInChild(child, offset) {
    // Helper to check if a text node is empty (has no visible content)
    // Vue/Nuxt creates empty text nodes from {{ node.text }} when text is undefined
    const isEmptyTextNode = (textNode) => {
      return textNode.textContent.length === 0;
    };

    // Helper to adjust offset for ZWS-only text nodes
    // If offset is 0 in a ZWS-only node, position AFTER the ZWS
    // This helps browsers preserve the cursor inside inline elements when typing
    const adjustOffsetForZWS = (textNode, requestedOffset) => {
      const zwsPattern = /^[\uFEFF\u200B]+$/;
      if (requestedOffset === 0 && zwsPattern.test(textNode.textContent)) {
        log('findTextNodeInChild: ZWS node detected, positioning after ZWS');
        return textNode.textContent.length;
      }
      return Math.min(requestedOffset, textNode.textContent.length);
    };

    if (child.nodeType === Node.TEXT_NODE) {
      // Direct text node - skip if empty
      if (isEmptyTextNode(child)) {
        return null;
      }
      const validOffset = adjustOffsetForZWS(child, offset);
      return { node: child, offset: validOffset };
    }

    if (child.nodeType === Node.ELEMENT_NODE) {
      // Element node - find the first NON-EMPTY text node within
      const walker = document.createTreeWalker(
        child,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let textNode = walker.nextNode();
      // Skip empty text nodes (Vue artifact from {{ node.text }} when undefined)
      while (textNode && isEmptyTextNode(textNode)) {
        textNode = walker.nextNode();
      }
      if (textNode) {
        const validOffset = adjustOffsetForZWS(textNode, offset);
        return { node: textNode, offset: validOffset };
      }
    }

    return null;
  }

  /**
   * Get nodeId from a Slate path by walking the tree
   * @param {Array} slateValue - Slate document value
   * @param {Array} path - Path array from Slate selection
   * @returns {{nodeId: string, textChildIndex: number|null, parentChildren: Array|null}|null}
   *          Returns object with nodeId, and for text nodes: child index and parent's children array
   */
  getNodeIdFromPath(slateValue, path) {
    let node = slateValue;
    let parentNode = null;
    let lastIndex = null;

    // Walk the path
    for (let i = 0; i < path.length; i++) {
      const index = path[i];

      parentNode = node;
      lastIndex = index;

      if (Array.isArray(node)) {
        node = node[index];
      } else if (node.children) {
        node = node.children[index];
      } else {
        console.warn('[HYDRA] Could not follow path:', path, 'at index', i);
        return null;
      }

      if (!node) {
        console.warn('[HYDRA] Node not found at path:', path, 'index', i);
        return null;
      }
    }

    // If this is a text node (has 'text' property), use the parent element's nodeId
    // Text nodes don't have nodeIds in the DOM - only element nodes do
    // Also return the child index so we can calculate absolute offset
    if (node.hasOwnProperty('text') && parentNode && parentNode.nodeId) {
      log('Path points to text node at index', lastIndex, 'using parent nodeId:', parentNode.nodeId);
      return {
        nodeId: parentNode.nodeId,
        textChildIndex: lastIndex,
        parentChildren: parentNode.children || null,
      };
    }

    // Return the nodeId if it exists (not a text node, no child info needed)
    return node.nodeId ? { nodeId: node.nodeId, textChildIndex: null, parentChildren: null } : null;
  }

  /**
   * Calculate absolute character offset for a text node within its parent
   * Used for selection restoration when Slate path points to a specific child
   * @param {Array} children - Parent's children array
   * @param {number} childIndex - Index of the target text node child
   * @param {number} offsetWithinChild - Character offset within the target child
   * @returns {number} Absolute character offset from start of parent's text
   */
  calculateAbsoluteOffset(children, childIndex, offsetWithinChild) {
    let absoluteOffset = 0;

    for (let i = 0; i < childIndex; i++) {
      const child = children[i];
      absoluteOffset += this.getTextLength(child);
    }

    return absoluteOffset + offsetWithinChild;
  }

  /**
   * Get total text length of a Slate node recursively
   * @param {Object} node - Slate node
   * @returns {number} Total text length
   */
  getTextLength(node) {
    if (node.hasOwnProperty('text')) {
      return node.text.length;
    }
    if (node.children) {
      return node.children.reduce((sum, child) => sum + this.getTextLength(child), 0);
    }
    return 0;
  }

  /**
   * Remove the nodeIds from the JSON object
   * @param {JSON} json Selected Block's data
   */
  resetJsonNodeIds(json) {
    if (Array.isArray(json)) {
      json.forEach((item) => this.resetJsonNodeIds(item));
    } else if (typeof json === 'object' && json !== null) {
      if (json.hasOwnProperty('nodeId')) {
        delete json.nodeId;
      }
      for (const key in json) {
        if (json.hasOwnProperty(key) && key !== 'data') {
          this.resetJsonNodeIds(json[key]);
        }
      }
    }
  }

  /** Delegate to standalone deepEqual for key-order-independent comparison. */
  _deepEqual(a, b) {
    return deepEqual(a, b);
  }

  /**
   * Get formData with nodeIds stripped for sending to Admin UI
   * NodeIds are internal to hydra.js for DOM<->Slate translation
   * @returns {Object} Deep copy of formData without nodeIds
   */
  getFormDataWithoutNodeIds() {
    const formDataCopy = JSON.parse(JSON.stringify(this.formData));

    // Strip nodeIds from slate fields only (value arrays in slate blocks)
    const stripNodeIdsFromSlateFields = (blocks) => {
      if (!blocks || typeof blocks !== 'object') return;
      for (const blockId of Object.keys(blocks)) {
        const block = blocks[blockId];
        const schema = this.getBlockSchema(blockId);
        if (block && schema?.properties) {
          // Descend widget:'object' wrappers so a slate field nested on an
          // object (content/headline, #245) is stripped too — top-level is just
          // the depth-0 case of the same walk.
          const stripFields = (obj, props) => {
            if (!obj || !props) return;
            for (const [fieldName, fieldDef] of Object.entries(props)) {
              if (fieldDef.widget === 'object' && fieldDef.schema?.properties) {
                stripFields(obj[fieldName], fieldDef.schema.properties);
                continue;
              }
              if (isSlateFieldType(getFieldTypeString(fieldDef)) && obj[fieldName]) {
                this.resetJsonNodeIds(obj[fieldName]);
              }
            }
          };
          stripFields(block, schema.properties);
          // Also check nested blocks in container fields
          if (block.blocks) {
            stripNodeIdsFromSlateFields(block.blocks);
          }
        }
      }
    };

    if (formDataCopy.blocks) {
      stripNodeIdsFromSlateFields(formDataCopy.blocks);
    }
    return formDataCopy;
  }

  /**
   * Compare focused field value between two formData objects
   * @param {Object} formDataA - First formData object (old/current, may have nodeIds)
   * @param {Object} formDataB - Second formData object (new/incoming, no nodeIds)
   * @returns {boolean} True if values are equal (ignoring nodeIds)
   */
  focusedFieldValuesEqual(formDataA, formDataB) {
    // selectedBlockUid is PAGE_BLOCK_UID for page-level fields, so only check focusedFieldName
    if (!this.focusedFieldName) {
      return true; // No focused field to compare
    }

    // Resolve field path to handle page-level fields (e.g., /title)
    const resolved = this.resolveFieldPath(this.focusedFieldName, this.selectedBlockUid);

    let fieldA, fieldB;
    if (resolved.blockId === PAGE_BLOCK_UID) {
      // Page-level field - compare directly on formData
      fieldA = getFieldValue(formDataA, resolved.fieldName);
      fieldB = getFieldValue(formDataB, resolved.fieldName);
      log('focusedFieldValuesEqual (page-level):', fieldA === fieldB, 'field:', resolved.fieldName, 'A:', fieldA, 'B:', fieldB);
      return fieldA === fieldB;
    }

    // Block field - use blockPathMap to find nested blocks (object_list items, etc.)
    const pathInfo = this.blockPathMap?.[resolved.blockId];
    let blockA, blockB;
    if (pathInfo?.path) {
      // Navigate path in both formData objects
      blockA = formDataA;
      blockB = formDataB;
      for (const key of pathInfo.path) {
        blockA = blockA?.[key];
        blockB = blockB?.[key];
      }
    } else {
      // Fallback to top-level lookup
      blockA = formDataA?.blocks?.[resolved.blockId];
      blockB = formDataB?.blocks?.[resolved.blockId];
    }
    if (!blockA || !blockB) {
      return false; // Can't find block - assume not equal (safe default)
    }
    // Deep copy and strip nodeIds before comparing (old formData has nodeIds, incoming doesn't)
    fieldA = getFieldValue(blockA, resolved.fieldName);
    fieldB = getFieldValue(blockB, resolved.fieldName);
    if (fieldA === undefined || fieldB === undefined) {
      return fieldA === fieldB;
    }
    const copyA = JSON.parse(JSON.stringify(fieldA));
    const copyB = JSON.parse(JSON.stringify(fieldB));
    this.resetJsonNodeIds(copyA);
    this.resetJsonNodeIds(copyB);
    const isEqual = deepEqual(copyA, copyB);
    log('focusedFieldValuesEqual:', isEqual, 'A:', JSON.stringify(copyA).substring(0, 100), 'B:', JSON.stringify(copyB).substring(0, 100));
    return isEqual;
  }

  /**
   * Get the field type for a given block and field name
   * @param {string} blockUid - The block UID
   * @param {string} fieldName - The field name (e.g., 'value', 'text', '/title' for page-level)
   * @returns {string|undefined} Field type in "type:widget" format (e.g., 'array:slate', 'string:textarea', 'string') or undefined
   */
  getFieldType(blockUid, fieldName) {
    const resolved = this.resolveFieldPath(fieldName, blockUid);
    const schema = this.getBlockSchema(resolved.blockId);
    const fieldDef = this.getNestedFieldDef(schema, resolved.fieldName);
    if (!fieldDef) return undefined;
    return getFieldTypeString(fieldDef);
  }

  /**
   * Resolve a `/`-path field name to its schema fieldDef, descending through
   * widget:'object' wrappers (#245). "headline" reads schema.properties.headline;
   * "content/headline" descends schema.properties.content.schema.properties.headline
   * — the object key(s) mirror the storage path. The block-scope prefix (`/`, `..`)
   * is consumed by resolveFieldPath before this; the remainder is `/`-separated
   * object hops. Returns undefined if any segment is missing.
   */
  getNestedFieldDef(schema, fieldName) {
    if (!fieldName) return undefined;
    return getFieldDef(schema, fieldName);
  }

  /**
   * Read a `/`-path field value from a block (central field-access API).
   */
  getFieldValueByPath(obj, fieldName) {
    if (!obj || !fieldName) return undefined;
    return getFieldValue(obj, fieldName);
  }

  /**
   * Write a `/`-path field value into a block IN PLACE (hydra's `obj` is a live
   * formData ref). Routes through the shared immutable setFieldValue, then
   * Object.assign's the result back so the ref reflects the change.
   */
  setFieldValueByPath(obj, fieldName, value) {
    if (!obj || !fieldName) return;
    Object.assign(obj, setFieldValue(obj, fieldName, value));
  }

  /**
   * Get the placeholder text for a given block field.
   * Checks three sources in priority order:
   * 1. Instance-level: block.fieldPlaceholders[fieldName] (from template authoring)
   * 2. Schema-level: resolvedBlockSchema.properties[fieldName].placeholder
   * 3. Universal fallback: 'Click to edit' — ensures every empty
   *    editable field has something rendered via ::before, which in turn
   *    gives the host element natural height. Without the fallback, plain
   *    div wrappers (slate blocks) collapse to 0px when empty and we have
   *    to force host CSS to keep them clickable.
   * @param {string} blockUid - The block UID
   * @param {string} fieldName - The field name
   * @returns {string} Placeholder text (never undefined — universal fallback)
   */
  getFieldPlaceholder(blockUid, fieldName) {
    const resolved = this.resolveFieldPath(fieldName, blockUid);
    // 1. Instance-level placeholder from template (fieldPlaceholders)
    const block = this.getBlockData(resolved.blockId);
    const instancePlaceholder = block?.fieldPlaceholders?.[resolved.fieldName];
    if (instancePlaceholder) {
      // For string fields, return directly. For slate arrays, extract text.
      if (typeof instancePlaceholder === 'string') return instancePlaceholder;
      if (Array.isArray(instancePlaceholder)) {
        const text = instancePlaceholder.map(n =>
          (n.children || []).map(c => c.text || '').join('')
        ).join(' ').trim();
        if (text) return text;
      }
    }
    // 2. Schema-level placeholder
    const fieldDef = this.getNestedFieldDef(this.getBlockSchema(resolved.blockId), resolved.fieldName);
    if (fieldDef?.placeholder) return fieldDef.placeholder;
    // 3. Universal fallback
    return 'Click to edit';
  }

  /**
   * Update the data-empty attribute on an editable field based on its text content.
   * Treats ZWS-only content as empty.
   * @param {HTMLElement} field - The editable field element
   */
  updateEmptyState(field) {
    const text = field.textContent?.replace(/[\u200B\uFEFF]/g, '').trim();
    const isEmpty = !text;
    // Don't show placeholder (data-empty) while the field is focused —
    // it would flash between keystrokes as the user types/deletes.
    const doc = field.ownerDocument;
    const isFocused = doc && (doc.activeElement === field || field.contains(doc.activeElement));
    // data-empty depends purely on whether the field has content. We
    // do NOT toggle it based on focus — keeping it set even during
    // focus means the placeholder ::before stays in the layout (held
    // invisible by :focus::before { visibility: hidden }). That keeps
    // the field's height stable across unfocused / focused / typing
    // without any host-CSS min-height override.
    field.toggleAttribute('data-empty', isEmpty);
  }

  /**
   * Check if a field type string indicates a slate field
   * Formats: "array:slate", ":slate", "array:richtext", ":richtext"
   * @param {string} fieldType - The field type string
   * @returns {boolean} True if the field is a slate field
   */
  fieldTypeIsSlate(fieldType) {
    return isSlateFieldType(fieldType);
  }

  /**
   * Check if a field type string indicates a textarea field
   * Formats: "string:textarea", ":textarea"
   * @param {string} fieldType - The field type string
   * @returns {boolean} True if the field is a textarea field
   */
  fieldTypeIsTextarea(fieldType) {
    return isTextareaFieldType(fieldType);
  }

  /**
   * Check if a field type string indicates a plain string field (single-line text)
   * This is a string field without textarea or slate widget.
   * Formats: "string", "string:" (no widget means default TextWidget)
   * @param {string} fieldType - The field type string
   * @returns {boolean} True if the field is a plain string field
   */
  fieldTypeIsPlainString(fieldType) {
    return isPlainStringFieldType(fieldType);
  }

  /**
   * Check if a field type string indicates a text-editable field (string, textarea, or slate)
   * @param {string} fieldType - The field type string
   * @returns {boolean} True if the field is text-editable
   */
  fieldTypeIsTextEditable(fieldType) {
    return isTextEditableFieldType(fieldType);
  }

  /**
   * Check if a field is a slate field
   * @param {string} blockUid - The block UID
   * @param {string} fieldName - The field name
   * @returns {boolean} True if the field is a slate field
   */
  isSlateField(blockUid, fieldName) {
    return this.fieldTypeIsSlate(this.getFieldType(blockUid, fieldName));
  }

  /**
   * May a slate node of this type exist in this block? (#295)
   *
   * The allow-list is resolved per region by buildBlockPathMap and rides on the
   * pathMap entry, which the bridge already receives whole — no extra message.
   * Checked HERE rather than admin-side because a hotkey and a markdown
   * shortcut both consume the keystroke before the admin sees it: rejecting the
   * transform after the fact would leave the character eaten.
   *
   * @param {string} blockUid
   * @param {string} type - a slate element type ('blockquote', 'h2', 'strong')
   * @returns {boolean} true when unrestricted or explicitly allowed
   */
  slateStylePermits(blockUid, type) {
    return isStyleAllowed(type, this.blockPathMap?.[blockUid]?.slateRules);
  }

  /**
   * Send a transform request (format, paste, delete) with current form data included.
   * This ensures admin receives the latest text buffer along with the transform action.
   * All transforms use unified SLATE_TRANSFORM_REQUEST message type.
   * @param {string} blockUid - The block UID
   * @param {string} transformType - The transform type ('format', 'paste', 'delete')
   * @param {Object} transformFields - Additional fields specific to the transform (format, html, direction, etc.)
   * @returns {string} The requestId for this transform
   */
  sendTransformRequest(blockUid, transformType, transformFields) {
    const requestId = `transform-${transformType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Clear any pending text timer since we're including current formData
    if (this.textUpdateTimer) {
      clearTimeout(this.textUpdateTimer);
      this.textUpdateTimer = null;
    }
    this.pendingTextUpdate = null;

    // Block the editor
    this.setBlockProcessing(blockUid, true, requestId);

    // Increment sequence — this is a new state. If the text debounce timer
    // already fired (sending INLINE_EDIT_DATA at seq N), the echo FORM_DATA
    // will arrive at seq N which is now < our local seq N+1 → stale → skipped.
    this.formData._editSequence = (this.formData?._editSequence || 0) + 1;

    // Get current form data (includes any typed text since formData is updated immediately)
    const data = this.getFormDataWithoutNodeIds();

    // Send the unified transform request with form data included.
    // editableFieldsByBlock tells the admin what's user-editable per block
    // (derived from data-edit-* attributes the user's frontend renders);
    // admin's merge / transform handlers use it instead of schema-counting,
    // which would over-count settings fields like placeholder/instructions.
    window.parent.postMessage({
      type: 'SLATE_TRANSFORM_REQUEST',
      transformType: transformType,
      blockId: blockUid,
      fieldName: this.focusedFieldName || 'value',
      data: data,
      selection: this.serializeSelection() || {},
      requestId: requestId,
      editableFieldsByBlock: this.getEditableFieldsByBlock(),
      ...transformFields,
    }, this.adminOrigin);

    this._transformSentAt = performance.now();
    this._transformSentDateNow = Date.now();
    log(`SLATE_TRANSFORM_REQUEST (${transformType}) sent with data, requestId:`, requestId);
    return requestId;
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Handling Text Changes in Blocks
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Handle the text changed in the block element with attr data-edit-text,
   * by getting changed text from DOM and send it to the adminUI
   * @param {HTMLElement} target
   * @param {Node} mutatedTextNode - The actual text node that was modified (optional)
   */
  handleTextChange(target, mutatedNodeParent = null, mutatedTextNode = null) {
    const blockElement = target.closest('[data-block-uid]');
    const blockUid = blockElement?.getAttribute('data-block-uid') || null;
    const editableField = target.getAttribute('data-edit-text');

    if (!editableField) {
      console.warn('[HYDRA] handleTextChange: No data-edit-text found');
      return;
    }

    // Determine field type (supports page-level fields via getFieldType)
    const fieldType = this.getFieldType(blockUid, editableField);

    // Note: We intentionally do NOT strip ZWS from DOM during typing.
    // Like slate-react, we let the frontend re-render (triggered by FORM_DATA)
    // naturally remove ZWS. Stripping during typing corrupts cursor position.
    // See "Whitespace & ZWS Strategy" for the full ZWS lifecycle.

    if (this.fieldTypeIsSlate(fieldType)) {
      // Read the full Slate value from the DOM and compare to formData.
      // The DOM is the source of truth for structure (which children exist,
      // their order, their text). Metadata (type, data, marks) comes from
      // the existing JSON via a nodeId → metadata map.
      // Resolve blockId (../ , /) then read/write the field at its storage path,
      // which may be nested inside a widget:'object' (dotted, e.g.
      // content.headline, #245). getFieldValueByPath/setFieldValueByPath walk
      // the dotted path so a bare "value" behaves exactly as before.
      const resolved = this.resolveFieldPath(editableField, blockUid);
      const block = this.getBlockData(resolved.blockId);
      const currentValue = this.getFieldValueByPath(block, resolved.fieldName);
      if (!block || !currentValue) {
        log('handleTextChange: block or field not found for', blockUid, editableField);
        return;
      }

      const freshValue = this.readSlateValueFromDOM(target, currentValue);

      const freshStr = JSON.stringify(freshValue);
      const currentStr = JSON.stringify(currentValue);

      if (freshStr === currentStr) {
        log('handleTextChange: DOM matches formData, skipping');
        return;
      }

      // Debug: show full values when they differ
      log('handleTextChange: DIFF fresh=', freshStr);
      log('handleTextChange: DIFF current=', currentStr);

      this.setFieldValueByPath(block, resolved.fieldName, freshValue);
      log('handleTextChange: updated', editableField);
    } else {
      // Non-Slate field - update field directly with text content
      // Resolve field path to handle /fieldName (page) and ../fieldName (parent) syntax
      const resolved = this.resolveFieldPath(editableField, blockUid);
      const targetData = this.getBlockData(resolved.blockId);
      if (targetData) {
        this.setFieldValueByPath(targetData, resolved.fieldName, this.stripZeroWidthSpaces(target.innerText));
        log('handleTextChange: updated field:', resolved.fieldName);
      }
    }

    // Update empty state for placeholder visibility
    this.updateEmptyState(target);

    // Buffer the update - text and selection are captured together
    this.bufferUpdate(this.fieldTypeIsSlate(fieldType) ? 'textChangeSlate' : 'textChange');

    // Check for slash menu pattern (entire field content is /[letters]*)
    if (this.fieldTypeIsSlate(fieldType)) {
      const plaintext = this.stripZeroWidthSpaces(target.textContent || '').trim();
      const slashMatch = plaintext.match(/^\/([\p{L}\p{N}]*)$/u);

      if (slashMatch) {
        this._slashMenuActive = true;
        // Send field rect so admin can position the menu under the field
        const fieldRect = target.getBoundingClientRect();
        this.sendMessageToParent({
          type: 'SLASH_MENU',
          action: 'filter',
          blockId: blockUid,
          filter: slashMatch[1],
          fieldRect: {
            top: fieldRect.top,
            bottom: fieldRect.bottom,
            left: fieldRect.left,
            width: fieldRect.width,
          },
        });
      } else if (this._slashMenuActive) {
        this._slashMenuActive = false;
        this.sendMessageToParent({
          type: 'SLASH_MENU',
          action: 'hide',
          blockId: blockUid,
        });
      }
    }
  }

  /**
   * Buffer an update to be sent after debounce.
   * Text and selection are always sent together to keep them atomic/in-sync.
   *
   * @param {string} [from] - Source of the update for debugging
   */
  bufferUpdate(from = 'unknown') {
    if (!this.formData) {
      return;
    }
    // Always capture BOTH current data and current selection together
    const data = this.getFormDataWithoutNodeIds();
    const currentSeq = this.formData?._editSequence || 0;
    const text = this.getBlockData(this.selectedBlockUid)?.value?.[0]?.children?.[0]?.text?.substring(0, 30);

    // Check against lastReceivedFormData to avoid buffering echoes of what we just received/rendered
    if (this.lastReceivedFormData) {
      const isEcho = this.focusedFieldValuesEqual(data, this.lastReceivedFormData);
      if (isEcho) {
        // Text unchanged — send selection-only update (e.g., Ctrl+A, Shift+Arrow)
        // Safe because data is already in sync; atomicity only matters when text changes
        if (from === 'selectionChange') {
          const selection = this.serializeSelection();
          if (selection) {
            window.parent.postMessage({ type: 'SELECTION_CHANGE', selection }, this.adminOrigin);
          }
        }
        log('bufferUpdate: echo, skipping. from:', from, 'seq:', currentSeq);
        return;
      }
    } else {
      // No baseline yet - can't determine if this is an echo
      log('bufferUpdate: no baseline, skipping. from:', from);
      return;
    }

    // Increment sequence immediately when we have local changes
    // This marks our local state as "ahead" of Admin, so any incoming FORM_DATA
    // at a lower sequence will be rejected as stale
    const isNewPending = !this.pendingTextUpdate;
    if (isNewPending) {
      const newSeq = currentSeq + 1;
      this.formData._editSequence = newSeq;
      log('bufferUpdate: NEW pending, incrementing seq to:', newSeq, 'from:', from, 'text:', JSON.stringify(text));
    } else {
      log('bufferUpdate: updating existing pending, seq:', this.formData._editSequence, 'from:', from, 'text:', JSON.stringify(text));
    }

    // Buffer the update with current sequence
    this.pendingTextUpdate = {
      type: 'INLINE_EDIT_DATA',
      data: data,
      selection: this.serializeSelection(),
      from: from,
    };

    // Reset the debounce timer
    if (this.textUpdateTimer) {
      clearTimeout(this.textUpdateTimer);
    }
    this.textUpdateTimer = setTimeout(() => {
      this.flushPendingTextUpdates();
    }, 300);
  }

  /**
   * Flush any pending batched text updates immediately
   * Call this before any operation that needs current state (format, cut, paste, undo, etc.)
   * Process a FLUSH_BUFFER request. Extracted so it can be called immediately
   * or deferred until afterContentRender when a render is in progress.
   * @param {string} requestId - The FLUSH_BUFFER requestId
   */
  _processFlushBuffer(requestId, setBlocking = false) {
    // Only block when a format operation follows (setBlocking=true).
    // Non-format flushes (save, template exit) just sync text.
    if (setBlocking && this.selectedBlockUid) {
      this.setBlockProcessing(this.selectedBlockUid, true, requestId);
    }

    // Re-capture the CURRENT editor value before flushing. `pendingTextUpdate` can
    // lag the live contenteditable: a debounced flush may already have shipped an
    // intermediate value while the latest keystrokes' bufferUpdate hasn't run yet.
    // A flush is supposed to give current state (its own contract), so snapshot the
    // live DOM here — bufferUpdate reads it via getFormDataWithoutNodeIds() and its
    // echo-guard makes this a no-op when nothing actually changed.
    if (this.selectedBlockUid) {
      this.bufferUpdate('flush');
    }

    // Flush with requestId - if there's pending text, it will be included in INLINE_EDIT_DATA
    const hadPendingText = this.flushPendingTextUpdates(requestId);

    if (hadPendingText) {
      log('Flushed pending text with requestId, waiting for Redux sync');
    } else {
      // No pending text - send BUFFER_FLUSHED immediately
      const selection = this.serializeSelection();
      log('No pending text, sending BUFFER_FLUSHED with selection:', selection);
      this.sendMessageToParent({
        type: 'BUFFER_FLUSHED',
        requestId: requestId,
        selection: selection,
      });
    }
  }

  /**
   * @param {string} [flushRequestId] - Optional requestId to include with the update (for FLUSH_BUFFER coordination)
   * @returns {boolean} - True if there was pending text to flush, false otherwise
   */
  flushPendingTextUpdates(flushRequestId) {
    if (this.textUpdateTimer) {
      clearTimeout(this.textUpdateTimer);
      this.textUpdateTimer = null;
    }
    if (this.pendingTextUpdate) {
      // Use the sequence that was already incremented in bufferUpdate
      // This ensures we send with the same seq that we used to reject stale FORM_DATA
      const seq = this.formData?._editSequence || 1;
      this.pendingTextUpdate.data._editSequence = seq;

      // Include requestId if provided (for FLUSH_BUFFER coordination)
      if (flushRequestId) {
        this.pendingTextUpdate.flushRequestId = flushRequestId;
      }

      // Fold the harvested anchors INTO this inline update. Editing a heading
      // re-slugs it on every keystroke, so this is the common anchor-change path.
      // Riding them on INLINE_EDIT_DATA — the message carrying the FRESH formData
      // the admin adopts wholesale — means the admin never merges them into a
      // stale snapshot (the cause of a lost-keystroke race), and there's no
      // second message per keystroke. Keep _lastSentAnchors in sync so the
      // structural-settle send (_maybeSendLinkableAnchors) doesn't re-emit these.
      const anchors = this._harvestLinkableAnchors();
      this.pendingTextUpdate.anchors = anchors;
      this._lastSentAnchors = JSON.stringify(anchors);

      log('flushPendingTextUpdates: sending buffered update, seq:', seq,
          'anchor:', this.pendingTextUpdate.selection?.anchor,
          'focus:', this.pendingTextUpdate.selection?.focus);
      window.parent.postMessage(this.pendingTextUpdate, this.adminOrigin);

      // Update lastReceivedFormData to the data we just sent
      // This is needed because admin doesn't send FORM_DATA back for inline edits (echo prevention)
      this.lastReceivedFormData = JSON.parse(JSON.stringify(this.pendingTextUpdate.data));
      this.pendingTextUpdate = null;
      return true; // Had pending update
    }
    return false; // No pending update
  }

  /**
   * Send a message to the parent, automatically flushing pending text updates first
   * if this is not an inline edit message
   * @param {Object} message - The message to send
   */
  sendMessageToParent(message) {
    // If this is NOT an inline text edit, flush any pending text changes first
    if (message.type !== 'INLINE_EDIT_DATA') {
      this.flushPendingTextUpdates();
    }
    window.parent.postMessage(message, this.adminOrigin);
  }


  /**
   * Update the JSON object with the new text,
   * finds the node in json with given nodeId and update the text in it
   * @param {JSON} json Block's data
   * @param {BigInteger} nodeId Node ID of the element
   * @param {String} newText Updated text
   * @param {Number} childIndex Optional index of child to update (for paragraphs with inline elements)
   * @returns {JSON} Updated JSON object
   */


  findParentWithAttribute(node, attribute) {
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute(attribute)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Text Formatting
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Check if a selection range involves formatted content (nested elements).
   * Uses getNodePath to determine if selection is inside or spans inline formatting.
   *
   * Path length indicates nesting:
   * - [0, 0] = text directly in paragraph (plain text)
   * - [0, 1, 0] = text inside inline element like strong (formatted)
   *
   * @param {Range} range - The selection range
   * @returns {boolean} True if selection involves formatted/structured content
   */
  selectionContainsElementNodes(range) {
    // Get paths for start and end of selection
    const startPath = this.getNodePath(range.startContainer);
    const endPath = this.getNodePath(range.endContainer);

    if (!startPath || !endPath) return false;

    // Path length > 2 means inside nested element (e.g., strong inside p)
    if (startPath.length > 2) return true;
    if (endPath.length > 2) return true;

    // If paths are identical, selection is within same text node - no structure
    if (startPath.join('.') === endPath.join('.')) return false;

    // Different paths means selection spans multiple children
    // Could have elements between them (e.g., start [0,0], end [0,2] has [0,1] between)
    return true;
  }

  getSelectionHTML(range) {
    const div = document.createElement('div');
    div.appendChild(range.cloneContents());
    return div.innerHTML;
  }

  /**
   * Checks if the selected text has which types of formatting.
   * @param {Range} range - The selection range
   * @returns {Object} An object indicating the presence of bold, italic, del, and link formatting
   */
  isFormatted(range) {
    const formats = {
      bold: { present: false, enclosing: false },
      italic: { present: false, enclosing: false },
      del: { present: false, enclosing: false },
      link: { present: false, enclosing: false },
    };

    // Check if the selection is collapsed (empty)
    // if (range.collapsed) return formats;

    // Get the common ancestor container of the selection
    let container = range.commonAncestorContainer;

    // Traverse upwards until we find the editable parent or the root
    while (
      container &&
      container !== document &&
      !(container.dataset && container.dataset.editableField === 'value')
    ) {
      // Check if the container itself has any of the formatting
      if (container.nodeName === 'STRONG' || container.nodeName === 'B') {
        if (
          container.contains(range.startContainer) &&
          container.contains(range.endContainer)
        ) {
          formats.bold.enclosing = true;
          formats.bold.present = true;
        }
      }
      if (container.nodeName === 'EM' || container.nodeName === 'I') {
        if (
          container.contains(range.startContainer) &&
          container.contains(range.endContainer)
        ) {
          formats.italic.enclosing = true;
          formats.italic.present = true;
        }
      }
      if (container.nodeName === 'DEL') {
        if (
          container.contains(range.startContainer) &&
          container.contains(range.endContainer)
        ) {
          formats.del.enclosing = true;
          formats.del.present = true;
        }
      }
      if (container.nodeName === 'A') {
        if (
          container.contains(range.startContainer) &&
          container.contains(range.endContainer)
        ) {
          formats.link.enclosing = true;
          formats.link.present = true;
        }
      }

      container = container.parentNode;
    }

    // Check for formatting within the selection
    const selectionHTML = this.getSelectionHTML(range).toString();
    if (selectionHTML.includes('</strong>') || selectionHTML.includes('</b>')) {
      formats.bold.present = true;
    }
    if (selectionHTML.includes('</em>') || selectionHTML.includes('</i>')) {
      formats.italic.present = true;
    }
    if (selectionHTML.includes('</del>')) {
      formats.del.present = true;
    }
    if (selectionHTML.includes('</a>')) {
      formats.link.present = true;
    }

    return formats;
  }

  /**
   * Helper function to get the next node in the selection
   * @param {Node} node - The current node
   * @returns {Node|null} The next node in the selection, or null if at the end
   */
  nextNode(node) {
    if (!node) return null; // Handle the case where node is null

    if (node.firstChild) return node.firstChild;

    while (node) {
      if (node.nextSibling) return node.nextSibling;
      node = node.parentNode;
    }

    return null; // Reached the end, return null
  }

  /**
   * Formats the selected text within a block.
   *
   * @param {string} format - The format to apply (e.g., 'bold', 'italic', 'del').
   * @param {boolean} remove - Whether to remove the format (true) or apply it (false).
   */
  formatSelectedText(format, remove) {
    // Don't set isInlineEditing to false - keep it true for text changes
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    if (remove) {
      this.unwrapFormatting(range, format);
    } else {
      // Handle selections that include non-Text nodes
      const fragment = range.extractContents(); // Extract the selected content
      const newNode = document.createElement(
        format === 'bold'
          ? 'strong'
          : format === 'italic'
            ? 'em'
            : format === 'del'
              ? 'del'
              : 'span',
      );
      newNode.appendChild(fragment); // Append the extracted content to the new node
      range.insertNode(newNode); // Insert the new node back into the document
    }
    this.sendFormattedHTMLToAdminUI(selection);
  }

  // Helper function to unwrap formatting while preserving other formatting
  unwrapFormatting(range, format) {
    const formattingElements = {
      bold: ['STRONG', 'B'],
      italic: ['EM', 'I'],
      del: ['DEL'],
      link: ['A'],
    };

    // Check if the selection is entirely within a formatting element of the specified type
    let container = range.commonAncestorContainer;
    let topmostParent = false;
    while (container && container !== document && !topmostParent) {
      if (container.dataset && container.dataset.editableField === 'value')
        topmostParent = true;
      if (formattingElements[format].includes(container.nodeName)) {
        // Check if the entire content of the formatting element is selected
        const isEntireContentSelected =
          range.startOffset === 0 &&
          range.endOffset === container.textContent.length;

        if (isEntireContentSelected) {
          // Unwrap the entire element
          this.unwrapElement(container);
        } else {
          // Unwrap only the selected portion
          this.unwrapSelectedPortion(
            container,
            range,
            format,
            formattingElements,
          );
        }
        return; // No need to check further
      }
      container = container.parentNode;
    }

    // If the selection is not entirely within a formatting element, remove all occurrences of the format within the selection
    let node = range.startContainer;
    while (node && node !== range.endContainer) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        formattingElements[format].includes(node.nodeName)
      ) {
        this.unwrapElement(node);
      } else if (
        node.nodeType === Node.TEXT_NODE &&
        node.parentNode &&
        formattingElements[format].includes(node.parentNode.nodeName)
      ) {
        // Handle the case where the text node itself is within the formatting element
        this.unwrapElement(node.parentNode);
      }
      node = this.nextNode(node);
    }
  }

  // Helper function to unwrap the selected portion within a formatting element
  unwrapSelectedPortion(element, range, format, formattingElements) {
    const formattingTag = formattingElements[format][0];

    // Check if selection starts at the beginning of the formatting element
    const selectionStartsAtBeginning = range.startOffset === 0;

    // Check if selection ends at the end of the formatting element
    const selectionEndsAtEnd = range.endOffset === element.textContent.length;

    // Extract the contents before the selection (only if not at the beginning)
    let beforeFragment = null;
    if (!selectionStartsAtBeginning) {
      const beforeRange = document.createRange();
      beforeRange.setStart(element, 0);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      beforeFragment = beforeRange.extractContents();
    }

    // Extract the selected contents
    const selectionFragment = range.extractContents();

    // Extract the contents after the selection (only if not at the end)
    let afterFragment = null;
    if (!selectionEndsAtEnd) {
      const afterRange = document.createRange();
      afterRange.setStart(range.endContainer, range.endOffset);
      afterRange.setEnd(element, element.childNodes.length);
      afterFragment = afterRange.extractContents();
    }

    // Create new elements to wrap the before and after fragments, keeping the original formatting (only if fragments exist)
    const beforeWrapper = beforeFragment
      ? document.createElement(formattingTag)
      : null;
    if (beforeWrapper) {
      beforeWrapper.appendChild(beforeFragment);
    }
    const afterWrapper = afterFragment
      ? document.createElement(formattingTag)
      : null;
    if (afterWrapper) {
      afterWrapper.appendChild(afterFragment);
    }

    // Replace the original element with the unwrapped selection and the formatted before/after parts
    const parent = element.parentNode;
    if (beforeWrapper) {
      parent.insertBefore(beforeWrapper, element);
    }
    parent.insertBefore(selectionFragment, element);
    if (afterWrapper) {
      parent.insertBefore(afterWrapper, element);
    }
    parent.removeChild(element);
    // Check and remove any empty formatting elements that might have been created
    this.removeEmptyFormattingElements(parent);
  }

  // Helper function to unwrap a single formatting element
  unwrapElement(element) {
    const parent = element.parentNode;
    if (!parent) return; // Handle the case where the element has no parent

    // Store the next sibling of the element before modifying the DOM
    const nextSibling = element.nextSibling;

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    // Remove the element itself
    parent.removeChild(element);

    this.removeEmptyFormattingElements(parent);

    // If there was a next sibling, set the selection to the beginning of it
    if (nextSibling) {
      const range = document.createRange();
      range.setStart(nextSibling, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } // Helper function to remove empty formatting elements
  removeEmptyFormattingElements(parent) {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const child = parent.childNodes[i];
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        (child.nodeName === 'STRONG' ||
          child.nodeName === 'EM' ||
          child.nodeName === 'DEL' ||
          child.nodeName === 'A') &&
        child.textContent.trim() === ''
      ) {
        parent.removeChild(child);
        i--; // Decrement i since we removed a child
      }
    }
  }
  sendFormattedHTMLToAdminUI(selection) {
    if (!selection.rangeCount) return; // No selection

    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;

    const editableParent = this.findEditableParent(commonAncestor);
    if (!editableParent) return; // Couldn't find the editable parent

    const htmlString = editableParent.outerHTML;

    window.parent.postMessage(
      {
        type: 'TOGGLE_MARK',
        html: htmlString,
      },
      this.adminOrigin,
    );
  }
  findEditableParent(node) {
    if (!node || node === document) return null; // Reached the top without finding

    if (node.dataset && node.dataset.nodeId === '1') {
      return node;
    }

    return this.findEditableParent(node.parentNode);
  }

  /**
   * Injects custom CSS into the iframe for styling the adminUI components which we are
   * injecting into frontend's DOM like borders, toolbar etc..
   */
  injectCSS() {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = `
        [contenteditable] {
          outline: 0px solid transparent;
        }
        /* In block mode, suppress OS-level long-press = word-select on
           the selected block AND all of its descendants. iOS Safari and
           Chrome on Android treat ANY text as long-press-selectable —
           even when contenteditable=false — so we have to disable text
           selection at the CSS level. Without this, a long-press on the
           selected block fires the bridge's multi-select gesture AND
           the OS word-select handles in the same beat.
           Scope is intentionally WIDE: every descendant of a
           [data-block-uid] wrapper as well as of [data-edit-text]
           in block mode. Anything narrower lets the OS resolve the
           long-press to an ancestor of the editable field and start
           selection from there (reported regression on Chrome devtools
           mobile-emulation: only the inner field had the rule, the
           wrapper didn't, the OS picked the wrapper, selection ran).
           The rule is NOT gated by @media (pointer: coarse). Block
           mode is by design a transient state where text-selection
           isn't the user's intent. Gating to coarse pointers also
           missed Chrome devtools mobile-emulation in practice, which
           reintroduced the bug. */
        [data-hydra-edit-mode="block"] [data-edit-text],
        [data-hydra-edit-mode="block"] [data-edit-text] *,
        [data-hydra-edit-mode="block"] [data-block-uid],
        [data-hydra-edit-mode="block"] [data-block-uid] * {
          -webkit-user-select: none !important;
          user-select: none !important;
          -webkit-touch-callout: none !important;
        }
        /* Placeholder text for empty editable fields. The ::before is in
           normal flow (no position: absolute) so the placeholder text
           contributes its natural line-height to the parent. That holds
           the field open at exactly one line of text — same height
           whether the placeholder is visible (unfocused), invisible
           (focused), or replaced by typed content (single line). No
           min-height override needed. */
        [data-edit-text][data-placeholder][data-empty]::before {
          content: attr(data-placeholder);
          color: #aaa;
          font-style: italic;
          pointer-events: none;
        }
        /* Hide the placeholder TEXT while the user is focused, but keep
           the ::before in layout (visibility:hidden, NOT display:none) so
           the parent's height stays the same. The bridge no longer needs
           to mutate host CSS to keep the focused-empty field clickable —
           the invisible ::before is doing the job. */
        [data-edit-text][data-placeholder][data-empty]:focus::before {
          visibility: hidden;
        }
        /* If the frontend renders its own empty-paragraph placeholder
           inside the editable field (e.g. Slate's <p><br></p> convention
           which contributes one line of layout via the <br> and any ZWS
           the bridge has inserted for cursor preservation), don't ALSO
           render the bridge's ::before placeholder — it would stack on
           top of the empty paragraph and the field would be 2 lines tall
           when empty but 1 line tall after the first keystroke. We only
           suppress ::before when the editable has a NON-EMPTY child
           element (one that itself has children/text). A truly bare
           <p></p> doesn't provide layout, so ::before still fires for it
           (covers the fixture-empty case where the frontend renders no
           empty-paragraph marker). */
        [data-edit-text][data-placeholder][data-empty]:has(*:not(:empty))::before {
          content: none;
        }
        /* Linkable field hover styles - indicate clickable link areas.
           Uses CSS outline (renders outside the box, ignores layout) so the
           host element position is NOT mutated. */
        /* Exclude fields inside readonly blocks (listing items, non-overwrite teasers) */
        [data-edit-link]:not([data-block-readonly] [data-edit-link]):not([data-block-readonly][data-edit-link]) {
          cursor: pointer;
        }
        [data-edit-link]:not([data-block-readonly] [data-edit-link]):not([data-block-readonly][data-edit-link]):hover {
          outline: 2px dashed rgba(0, 126, 177, 0.5);
          outline-offset: 2px;
          border-radius: 4px;
        }
        /* Media field hover styles - indicate clickable image areas.
           Same outline approach — host CSS untouched. */
        /* Exclude fields inside readonly blocks */
        [data-edit-media]:not([data-block-readonly] [data-edit-media]):not([data-block-readonly][data-edit-media]) {
          cursor: pointer;
        }
        [data-edit-media]:not([data-block-readonly] [data-edit-media]):not([data-block-readonly][data-edit-media]):hover {
          outline: 2px dashed rgba(120, 192, 215, 0.5);
          outline-offset: 2px;
          border-radius: 4px;
        }
        /* Readonly block styles are applied dynamically via applyReadonlyVisuals() */
        .volto-hydra-add-button {
          position: absolute;
          background: none;
          display: flex;
          justify-content: center;
          align-items: center;
          cursor: pointer;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          padding: 8px;
          border-radius: 36px;
          background-color: var(--gray-snow, #f3f5f7);
          border: 2px solid rgb(37 151 244 / 50%);
        }
        .volto-hydra-add-button {
          bottom: -49px;
          right: 0;
          transform: translateX(-50%);
        }
        .volto-hydra-quantaToolbar {
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          background: white;
          box-shadow: 3px 3px 10px rgb(0 0 0 / 53%);
          border-radius: 6px;
          z-index: 10;
          top: -45px;
          left: 0;
          box-sizing: border-box;
          width: fit-content;
          height: 40px;
        }
        .volto-hydra-drag-button,
        .volto-hydra-menu-button,
        .volto-hydra-format-button {
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px;
          margin: 0;
        }
        .volto-hydra-format-button {
          border-radius: 5px;
          margin: 1px;
          display: none;
          height: 32px;
          width: 32px;
        }
        .volto-hydra-format-button svg {
          display: block;
          height: 100%;
          width: 100%;
        }

        .volto-hydra-format-button.show {
          display: block !important;
        }
        .volto-hydra-format-button.active,
        .volto-hydra-format-button:hover {
          background-color: #ddd;
        }
        .volto-hydra-drag-button {
          cursor: grab;
          background: #E4E8EC;
          border-radius: 6px;
          padding: 9px 6px;
          height: 40px;
          display: flex;
        }
        .grabbing {
          cursor: grabbing !important;
        }
        /* During drag operations, disable pointer events on toolbar so elementFromPoint can detect blocks underneath */
        .grabbing .quanta-toolbar,
        .grabbing .volto-hydra-add-button,
        .grabbing .volto-hydra-block-outline {
          pointer-events: none !important;
        }
        .dragging {
          position: fixed !important;
          opacity: 0.5;
          pointer-events: none;
          z-index: 1000;
        }
        .link-input-container {
          position: absolute;
          top: 0;
          left: 0;
          width: fit-content;
          display: flex;
          background: white;
          box-shadow: 3px 3px 10px rgb(0 0 0 / 53%);
          border: 1px solid #00ff00;
          border-radius: 6px;
          z-index: 10;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          visibility: visible;
        }
        .link-input {
          height: 40px;
          width: 270px;
          padding: 10px 10px;
          border: none;
          margin: 0 5px;
          background: transparent;
          color: black
        }
        .link-input:focus {
          outline: none;
        }
        .link-input::placeholder {
          color: #0B78D0;
        }
        .link-invalid-url {
          border: 1px solid red;
        }
        .link-folder-btn,
        .link-submit-btn,
        .link-cancel-btn {
          width: 32px;
          height: 32px;
          border: none;
          background: white;
          cursor: pointer;
          border-radius: 8px;
          margin-right: 2px
          display: flex;
          align-items: center;
        }
        .link-folder-btn:hover,
        .link-submit-btn:hover,
        .link-cancel-btn:hover {
          background-color: #ddd;
        }
        .link-submit-btn,
        .link-cancel-btn {
          border-radius: 100%;
          background-color: #0B78D0;
        }
        .link-cancel-btn.hide,
        .link-submit-btn.hide {
          display: none;
        }
        .volto-hydra-dropdown-menu {
          display: none;
          position: absolute;
          top: 100%;
          right: -80%;
          background: white;
          border: 1px solid #ccc;
          border-radius: 4px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          z-index: 100;
          margin-top: -8px;
          width: 180px;
          box-sizing: border-box;
          height: 80px;
        }
        .volto-hydra-dropdown-menu.visible {
          display: block;
        }
        .volto-hydra-dropdown-item {
          display: flex;
          justify-content: flex-start;
          align-items: center;
          padding: 10px;
          cursor: pointer;
          transition: background 0.2s;
          height: 40px;
          box-sizing: border-box;
        }
        .volto-hydra-dropdown-text {
          font-size: 15px;
          font-weight: 500;
        }
        .volto-hydra-dropdown-item svg {
          margin-right: 1em;
        }
        .volto-hydra-dropdown-item:hover {
          background: #f0f0f0;
        }
        .volto-hydra-divider {
          height: 1px;
          background: rgba(0, 0, 0, 0.1);
          margin: 0 1em;
        }
        /* Empty block visual indicator - always visible */
        /* Hydra adds data-hydra-empty attribute to blocks with @type: 'empty' in formData */
        [data-hydra-empty] {
          border: 2px dashed #b8c6c8 !important;
          border-radius: 4px;
          background: rgba(200, 200, 200, 0.1);
          min-height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        [data-hydra-empty]::after {
          content: '+';
          font-size: 24px;
          color: #b8c6c8;
          pointer-events: none;
        }
      `;
    document.head.appendChild(style);
  }
}

// Export an instance of the Bridge class
// Use window.__hydraBridge to survive module hot-reloading in frameworks like Nuxt/Vite
let bridgeInstance = (typeof window !== 'undefined' && window.__hydraBridge) || null;

////////////////////////////////////////////////////////////////////////////////
// Bridge Connection Diagnostic
////////////////////////////////////////////////////////////////////////////////

let _diagnosticShown = false;

/**
 * Show a diagnostic popup when the bridge can't connect.
 * Automatically called when hydra.js detects it's in an iframe with edit signals
 * but the bridge doesn't initialize within a timeout.
 */
/**
 * Take down a diagnostic that has been overtaken by events. A bridge that
 * connects late is a slow bridge, not a broken one, and leaving a red
 * "Not Connected" panel over a working editor is its own bug.
 */
function _removeBridgeDiagnostic() {
  _diagnosticShown = false;
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('hydra-bridge-diagnostic');
  if (existing) existing.remove();
}

function _showBridgeDiagnostic(info) {
  if (_diagnosticShown) return;
  if (typeof document === 'undefined') return;
  _diagnosticShown = true;

  const el = document.createElement('div');
  el.id = 'hydra-bridge-diagnostic';
  el.setAttribute('style', [
    'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
    'max-width:440px', 'background:#fef2f2', 'border:2px solid #dc2626',
    'border-radius:8px', 'padding:16px', 'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
    'font-family:monospace', 'font-size:13px', 'line-height:1.6', 'color:#7f1d1d',
  ].join(';'));

  const rows = [
    `<strong>window.name:</strong> "${info.windowName || '(empty)'}"`,
    `<strong>In iframe:</strong> ${info.inIframe}`,
    `<strong>Admin origin:</strong> ${info.adminOrigin || '(none)'}`,
    `<strong>initBridge called:</strong> ${info.bridgeCreated}`,
    `<strong>INITIAL_DATA received:</strong> ${info.bridgeInitialized}`,
  ];

  let hint = '';
  if (info.inIframe && !info.hasHydraName) {
    hint = 'The admin should set the iframe name to "hydra-edit:&lt;origin&gt;". ' +
      'Check that Volto sets window.name on the iframe element.';
  } else if (info.bridgeCreated && !info.bridgeInitialized) {
    hint = 'INIT was sent but admin did not respond with INITIAL_DATA. ' +
      'Check that adminOrigin matches the parent window origin.';
  } else if (!info.bridgeCreated) {
    hint = 'hydra.js was imported but initBridge() was never called. ' +
      'The frontend should call initBridge() in edit mode.';
  }

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <strong style="color:#dc2626;font-size:14px">Hydra Bridge: Not Connected</strong>
      <button id="hydra-diag-dismiss" style="background:none;border:none;cursor:pointer;font-size:18px;color:#666">&times;</button>
    </div>
    <div>${rows.join('<br>')}</div>
    ${hint ? `<div style="margin-top:8px;padding:8px;background:#fee2e2;border-radius:4px;font-size:12px">${hint}</div>` : ''}
  `;

  document.body.appendChild(el);
  document.getElementById('hydra-diag-dismiss').addEventListener('click', () => el.remove());
}

// Auto-detect bridge connection issues when hydra.js is loaded in an iframe
// with edit signals (window.name or _edit param) but bridge doesn't connect.
if (typeof window !== 'undefined' && window.self !== window.top) {
  const _url = new URL(window.location.href);
  const _editParam = _url.searchParams.get('_edit');
  const _isEditMode = window.name.startsWith('hydra-edit:');
  const _expectsHydra = _isEditMode || _editParam === 'true';

  if (_expectsHydra) {
    // Check after page load + 5 seconds — enough time for bridge to connect
    const _checkConnection = () => {
      setTimeout(() => {
        // Only the "initBridge was never called" case is left to a timer, and
        // only because there is no event for something that never happens. A
        // bridge that HAS been created is mid-handshake: it retries INIT and
        // reports for itself when it runs out of attempts, so the clock must
        // not pre-empt it.
        const stillHandshaking =
          bridgeInstance && !bridgeInstance.initialized && !bridgeInstance._initHandshakeGaveUp;
        if (!stillHandshaking && (!bridgeInstance || !bridgeInstance.initialized)) {
          _showBridgeDiagnostic({
            windowName: window.name,
            hasHydraName: _isEditMode,
            inIframe: true,
            adminOrigin: bridgeInstance?.adminOrigin || null,
            bridgeCreated: !!bridgeInstance,
            bridgeInitialized: bridgeInstance?.initialized || false,
          });
        }
      }, 5000);
    };
    if (document.readyState === 'complete') {
      _checkConnection();
    } else {
      window.addEventListener('load', _checkConnection);
    }
  }
}

/**
 * Initialize the bridge
 *
 * @param {Object|string} [adminOriginOrOptions] - Options object or admin origin URL
 * @param {Object} [options] - Options (if first param is adminOrigin)
 * @returns {Bridge} The bridge instance
 */
export function initBridge(adminOriginOrOptions, options = {}) {
  let adminOrigin;

  // Support both calling conventions:
  // - initBridge({ options }) - just options, no adminOrigin
  // - initBridge(adminOrigin, { options }) - with explicit adminOrigin
  if (
    typeof adminOriginOrOptions === 'object' &&
    adminOriginOrOptions !== null
  ) {
    // First argument is options object
    options = adminOriginOrOptions;
    adminOrigin = options.adminOrigin; // Can optionally include adminOrigin in options
  } else {
    // First argument is adminOrigin (string or null/undefined)
    adminOrigin = adminOriginOrOptions;
  }

  // 1. Explicit parameter (highest priority)
  if (adminOrigin) {
    log('Using explicit admin origin:', adminOrigin);
  }
  // 2. Extract from window.name (set by Volto, persists across iframe navigation)
  else if (window.name.startsWith('hydra-edit:') || window.name.startsWith('hydra-view:')) {
    const prefix = window.name.startsWith('hydra-edit:') ? 'hydra-edit:' : 'hydra-view:';
    adminOrigin = window.name.slice(prefix.length);
    log('Got admin origin from window.name:', adminOrigin);
  }
  // 3. No window.name means we're not in a Volto iframe - nothing to communicate with
  else {
    log('No hydra window.name set - not in Volto iframe, skipping bridge setup');
    adminOrigin = null;
  }

  if (!bridgeInstance) {
    bridgeInstance = new Bridge(adminOrigin, options);
    bridgeInstance.lastKnownPath = window.location.pathname;
    // Store on window to survive module hot-reload
    if (typeof window !== 'undefined') {
      window.__hydraBridge = bridgeInstance;
    }
  } else {
    // Bridge already exists - check if URL changed (e.g., after SPA navigation + remount)
    const currentPath = window.location.pathname;
    // Update pathToApiPath if provided in new options
    if (options.pathToApiPath) {
      bridgeInstance.pathToApiPath = options.pathToApiPath;
    }
    if (bridgeInstance.lastKnownPath && bridgeInstance.lastKnownPath !== currentPath) {
      const apiPath = bridgeInstance.pathToApiPath(currentPath);
      // Check if this is in-page navigation (paging) — don't send PATH_CHANGE again
      const inPageNavTime = sessionStorage.getItem('hydra_in_page_nav_time');
      const isInPage = inPageNavTime && (Date.now() - parseInt(inPageNavTime, 10)) < 5000;
      if (!isInPage) {
        log('initBridge: URL changed since last init, sending PATH_CHANGE:', bridgeInstance.lastKnownPath, '->', currentPath, '-> apiPath:', apiPath);
        window.parent.postMessage(
          { type: 'PATH_CHANGE', path: apiPath },
          bridgeInstance.adminOrigin,
        );
      } else {
        log('initBridge: URL changed since last init but in-page nav, skipping PATH_CHANGE');
      }
    }
    bridgeInstance.lastKnownPath = currentPath;
  }
  return bridgeInstance;
}

/**
 * Get the access token from URL (preferred), sessionStorage, or cookie (fallback)
 * Token is stored in sessionStorage when first received from URL params
 * @returns {String|null} token
 */
export function getAccessToken() {
  if (typeof window === 'undefined') {
    return null;
  }
  // Try URL first (admin sends token via URL on initial load)
  const urlToken = new URL(window.location.href).searchParams.get('access_token');
  if (urlToken) {
    // Store for future SPA navigations
    sessionStorage.setItem('hydra_access_token', urlToken);
    return urlToken;
  }
  // Try sessionStorage (persists across SPA navigations)
  const sessionToken = sessionStorage.getItem('hydra_access_token');
  if (sessionToken) {
    return sessionToken;
  }
  // Fallback to cookie
  return getTokenFromCookie();
}

/**
 * Check if we're in edit mode (hydra iframe connected to admin for editing).
 * Uses window.name (set by admin) and _edit URL param as signals.
 * @returns {boolean} True if in edit mode
 */
export function isEditMode() {
  if (typeof window === 'undefined') {
    return false;
  }
  const url = new URL(window.location.href);
  const editParam = url.searchParams.get('_edit');
  return window.name.startsWith('hydra-edit:') || editParam === 'true';
}

/**
 * Get the token from cookie (legacy method, prefer getAccessToken)
 * @returns {String|null} token
 */
export function getTokenFromCookie() {
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


// ============================================================================
// Listing/Search API Utilities (fetch-agnostic helpers)
// ============================================================================

/**
 * Get authorization headers for API requests.
 * Uses the access token from URL, sessionStorage, or cookie.
 * @returns {Object} Headers object with Authorization if token exists
 */
export function getAuthHeaders() {
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


/**
 * Calculate drag handle/toolbar position for a block.
 * Used by both iframe drag handle and Volto toolbar to ensure alignment.
 *
 * Chrome must also clear a STAND-IN — an element that represents the block
 * without being it, such as a tab's label on the button that reveals it. That
 * element usually sits above the block, and placing the handle against the
 * block alone drops it on top of a field the author needs to click. Both
 * callers pass it, so the rule lives here rather than being written out twice
 * and drifting: the iframe handle and the admin toolbar are asserted to align.
 *
 * @param {Object} blockRect - Block's bounding rect {top, left}
 * @param {Object} viewportOffset - Viewport offset {top, left}
 *        For iframe: {top: 0, left: 0}
 *        For parent: iframe.getBoundingClientRect()
 * @param {Object} [standInRect] - Bounding rect of the block's stand-in, if any
 * @returns {Object} {top, left} position
 */
export function calculateDragHandlePosition(
  blockRect,
  viewportOffset = { top: 0, left: 0 },
  standInRect = null,
) {
  const HANDLE_OFFSET_TOP = 40;
  const effectiveTop =
    standInRect && standInRect.top < blockRect.top ? standInRect.top : blockRect.top;
  const top = Math.max(viewportOffset.top, viewportOffset.top + effectiveTop - HANDLE_OFFSET_TOP);
  const left = viewportOffset.left + blockRect.left;
  return { top, left };
}


// Make initBridge available globally
if (typeof window !== 'undefined') {
  window.initBridge = initBridge;
}

//////////////////////////////////////////////////////////////////////////////
// SVGs & Images should be exported using CDN to reduce the size of this file
// Icons from https://github.com/plone/quanta-icons/tree/main/icons unless specified as Pastanaga, in which case they're from https://pastanaga.io/icons/
//////////////////////////////////////////////////////////////////////////////
const deleteSVG = `<svg width="18px" height="18px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 6H20M16 6L15.7294 5.18807C15.4671 4.40125 15.3359 4.00784 15.0927 3.71698C14.8779 3.46013 14.6021 3.26132 14.2905 3.13878C13.9376 3 13.523 3 12.6936 3H11.3064C10.477 3 10.0624 3 9.70951 3.13878C9.39792 3.26132 9.12208 3.46013 8.90729 3.71698C8.66405 4.00784 8.53292 4.40125 8.27064 5.18807L8 6M18 6V16.2C18 17.8802 18 18.7202 17.673 19.362C17.3854 19.9265 16.9265 20.3854 16.362 20.673C15.7202 21 14.8802 21 13.2 21H10.8C9.11984 21 8.27976 21 7.63803 20.673C7.07354 20.3854 6.6146 19.9265 6.32698 19.362C6 18.7202 6 17.8802 6 16.2V6M14 10V17M10 10V17" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
const dragSVG = `<svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g id="SVGRepo_bgCarrier" stroke-width="0"/>
  <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"/>
  <g id="SVGRepo_iconCarrier"> <path d="M8 6.5C9.38071 6.5 10.5 5.38071 10.5 4C10.5 2.61929 9.38071 1.5 8 1.5C6.61929 1.5 5.5 2.61929 5.5 4C5.5 5.38071 6.61929 6.5 8 6.5Z" fill="#4A5B68"/> <path d="M15.5 6.5C16.8807 6.5 18 5.38071 18 4C18 2.61929 16.8807 1.5 15.5 1.5C14.1193 1.5 13 2.61929 13 4C13 5.38071 14.1193 6.5 15.5 6.5Z" fill="#4A5B68"/> <path d="M10.5 12C10.5 13.3807 9.38071 14.5 8 14.5C6.61929 14.5 5.5 13.3807 5.5 12C5.5 10.6193 6.61929 9.5 8 9.5C9.38071 9.5 10.5 10.6193 10.5 12Z" fill="#4A5B68"/> <path d="M15.5 14.5C16.8807 14.5 18 13.3807 18 12C18 10.6193 16.8807 9.5 15.5 9.5C14.1193 9.5 13 10.6193 13 12C13 13.3807 14.1193 14.5 15.5 14.5Z" fill="#4A5B68"/> <path d="M10.5 20C10.5 21.3807 9.38071 22.5 8 22.5C6.61929 22.5 5.5 21.3807 5.5 20C5.5 18.6193 6.61929 17.5 8 17.5C9.38071 17.5 10.5 18.6193 10.5 20Z" fill="#4A5B68"/> <path d="M15.5 22.5C16.8807 22.5 18 21.3807 18 20C18 18.6193 16.8807 17.5 15.5 17.5C14.1193 17.5 13 18.6193 13 20C13 21.3807 14.1193 22.5 15.5 22.5Z" fill="#4A5B68"/> </g>
  </svg>`;
const boldSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M4.83252 20.9999H14.2185C17.6505 20.9999 20.0945 19.0239 20.0945 16.1639C20.0945 14.1879 18.8725 12.5239 16.7925 11.5879C18.3785 10.7559 19.3145 9.42994 19.3145 7.60994C19.3145 5.00994 17.0785 3.13794 13.8805 3.13794H4.83252V20.9999ZM8.65452 10.3399V6.41394H12.9445C14.3485 6.41394 15.3625 7.24594 15.3625 8.36394C15.3625 9.50794 14.3485 10.3399 12.9445 10.3399H8.65452ZM8.65452 17.7239V13.3559H13.5165C15.0505 13.3559 16.1425 14.2659 16.1425 15.5399C16.1425 16.8139 15.0505 17.7239 13.5165 17.7239H8.65452Z" fill="black"/>
</svg>`;
const italicSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M10 3H17V5H14.3584L11.4443 19H14V21L11.028 21H9L7 21V19H9.4163L12.3304 5H10V3Z" fill="black"/>
</svg>`;
// Pastanaga
const delSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 36 36" fill="none">
  <path fill-rule="evenodd" d="M31,17 L19.114,17 C18.533,16.863 15.451,16.107 13.666,15.066 C13.115,14.746 12.68,14.223 12.441,13.594 C11.776,11.844 11.589,9.432 14.551,7.834 C14.579,7.816 17.423,5.99 21.531,7.883 C21.556,7.897 24.074,9.269 24,11.911 L24,12 L25,12 L26,12.041 L26,12 L26,6 L24,6 L24,7.281 C23.227,6.53 22.507,6.138 22.419,6.092 C17.265,3.714 13.603,6.064 13.526,6.119 C8.981,8.563 9.946,12.657 10.572,14.304 C10.973,15.36 11.714,16.245 12.659,16.795 C12.779,16.865 12.905,16.933 13.033,17 L5,17 L5,19 L18.863,19 C23.002,20.084 24.039,22.3 24.057,22.333 C25.122,25.348 23.361,27.222 23.323,27.264 C20.638,29.732 16.212,29.021 16.103,29.005 C11.896,28.569 11.02,24.017 10.984,23.824 L10,24 L9,24 L9,30 L11,30 L11,28.359 C12.089,29.669 13.657,30.761 15.831,30.985 C15.909,30.999 16.631,31.118 17.683,31.118 C19.562,31.118 22.498,30.739 24.708,28.706 C24.821,28.593 27.438,25.9 25.924,21.617 C25.889,21.534 25.338,20.264 23.608,19 L31,19 L31,17 Z" fill="black"></path>
</svg>`;
const underlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M6 19V21H18V19H6Z" fill="black"/>
  <path d="M8 3V11C8 13.2091 9.79086 15 12 15C14.2091 15 16 13.2091 16 11V3H14V11C14 12.1046 13.1046 13 12 13C10.8954 13 10 12.1046 10 11V3H8Z" fill="black"/>
</svg>`;
const addSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M13 3H11V11H3V13H11V21H13V13H21V11H13V3Z" fill="black"/>
</svg>`;
const linkSVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M15 7V10H17V7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7V10H9V7C9 5.34315 10.3431 4 12 4C13.6569 4 15 5.34315 15 7Z" fill="black"/>
  <path d="M15 17V14H17V17C17 19.7614 14.7614 22 12 22C9.23858 22 7 19.7614 7 17V14H9V17C9 18.6569 10.3431 20 12 20C13.6569 20 15 18.6569 15 17Z" fill="black"/>
  <path d="M13 8H11V16H13V8Z" fill="black"/>
</svg>`;
const threeDotsSVG = `<svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 10C6.10457 10 7 10.8954 7 12C7 13.1046 6.10457 14 5 14C3.89543 14 3 13.1046 3 12C3 10.8954 3.89543 10 5 10Z" fill="#000000"/>
  <path d="M12 10C13.1046 10 14 10.8954 14 12C14 13.1046 13.1046 14 12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10Z" fill="#000000"/>
  <path d="M21 12C21 10.8954 20.1046 10 19 10C17.8954 10 17 10.8954 17 12C17 13.1046 17.8954 14 19 14C20.1046 14 21 13.1046 21 12Z" fill="#000000"/>
  </svg>`;
const settingsSVG = `<svg width="18px" height="18px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="3" stroke="#1C274C" stroke-width="1.5"/>
  <path d="M13.7654 2.15224C13.3978 2 12.9319 2 12 2C11.0681 2 10.6022 2 10.2346 2.15224C9.74457 2.35523 9.35522 2.74458 9.15223 3.23463C9.05957 3.45834 9.0233 3.7185 9.00911 4.09799C8.98826 4.65568 8.70226 5.17189 8.21894 5.45093C7.73564 5.72996 7.14559 5.71954 6.65219 5.45876C6.31645 5.2813 6.07301 5.18262 5.83294 5.15102C5.30704 5.08178 4.77518 5.22429 4.35436 5.5472C4.03874 5.78938 3.80577 6.1929 3.33983 6.99993C2.87389 7.80697 2.64092 8.21048 2.58899 8.60491C2.51976 9.1308 2.66227 9.66266 2.98518 10.0835C3.13256 10.2756 3.3397 10.437 3.66119 10.639C4.1338 10.936 4.43789 11.4419 4.43786 12C4.43783 12.5581 4.13375 13.0639 3.66118 13.3608C3.33965 13.5629 3.13248 13.7244 2.98508 13.9165C2.66217 14.3373 2.51966 14.8691 2.5889 15.395C2.64082 15.7894 2.87379 16.193 3.33973 17C3.80568 17.807 4.03865 18.2106 4.35426 18.4527C4.77508 18.7756 5.30694 18.9181 5.83284 18.8489C6.07289 18.8173 6.31632 18.7186 6.65204 18.5412C7.14547 18.2804 7.73556 18.27 8.2189 18.549C8.70224 18.8281 8.98826 19.3443 9.00911 19.9021C9.02331 20.2815 9.05957 20.5417 9.15223 20.7654C9.35522 21.2554 9.74457 21.6448 10.2346 21.8478C10.6022 22 11.0681 22 12 22C12.9319 22 13.3978 22 13.7654 21.8478C14.2554 21.6448 14.6448 21.2554 14.8477 20.7654C14.9404 20.5417 14.9767 20.2815 14.9909 19.902C15.0117 19.3443 15.2977 18.8281 15.781 18.549C16.2643 18.2699 16.8544 18.2804 17.3479 18.5412C17.6836 18.7186 17.927 18.8172 18.167 18.8488C18.6929 18.9181 19.2248 18.7756 19.6456 18.4527C19.9612 18.2105 20.1942 17.807 20.6601 16.9999C21.1261 16.1929 21.3591 15.7894 21.411 15.395C21.4802 14.8691 21.3377 14.3372 21.0148 13.9164C20.8674 13.7243 20.6602 13.5628 20.3387 13.3608C19.8662 13.0639 19.5621 12.558 19.5621 11.9999C19.5621 11.4418 19.8662 10.9361 20.3387 10.6392C20.6603 10.4371 20.8675 10.2757 21.0149 10.0835C21.3378 9.66273 21.4803 9.13087 21.4111 8.60497C21.3592 8.21055 21.1262 7.80703 20.6602 7C20.1943 6.19297 19.9613 5.78945 19.6457 5.54727C19.2249 5.22436 18.693 5.08185 18.1671 5.15109C17.9271 5.18269 17.6837 5.28136 17.3479 5.4588C16.8545 5.71959 16.2644 5.73002 15.7811 5.45096C15.2977 5.17191 15.0117 4.65566 14.9909 4.09794C14.9767 3.71848 14.9404 3.45833 14.8477 3.23463C14.6448 2.74458 14.2554 2.35523 13.7654 2.15224Z" stroke="#1C274C" stroke-width="1.5"/>
  </svg>`;
const linkSubmitSVG = `<img width="20px" height="20px" src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAxNiAxMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTkuMDc2OTIgMTAuNDEwOEwxMC4yNTU0IDExLjU4OTNMMTUuODQ0NyA2LjAwMDAyTDEwLjI1NTQgMC40MTA3NjdMOS4wNzY5MiAxLjU4OTI4TDEyLjY1NDMgNS4xNjY2OUgwLjQ5OTUxMlY2LjgzMzM1SDEyLjY1NDNMOS4wNzY5MiAxMC40MTA4WiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+Cg==" />`;
const linkFolderSVG = `<img width="20px" height="20px" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAaklEQVR4nO2WywmAQAwF52IXWoBFWIvl2JFWJnh74nkFXQmExTeQc4b8CBhTopuYSRbYgSlTQMABLMAIdBkCCgoLPKK3paqkugXRWEBuAR5CvIb4EKmpU9wHJh++CKxBElfyramHxJh/cQJpdrBykxDdigAAAABJRU5ErkJggg==">`;
const linkCancelSVG = `<svg width="20px" height="20px" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="100" height="100" viewBox="0,0,256,256">
<g fill="#ffffff" fill-rule="nonzero" stroke="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="" stroke-dashoffset="0" font-family="none" font-weight="none" font-size="none" text-anchor="none" style="mix-blend-mode: normal"><g transform="scale(8.53333,8.53333)"><path d="M7,4c-0.25587,0 -0.51203,0.09747 -0.70703,0.29297l-2,2c-0.391,0.391 -0.391,1.02406 0,1.41406l7.29297,7.29297l-7.29297,7.29297c-0.391,0.391 -0.391,1.02406 0,1.41406l2,2c0.391,0.391 1.02406,0.391 1.41406,0l7.29297,-7.29297l7.29297,7.29297c0.39,0.391 1.02406,0.391 1.41406,0l2,-2c0.391,-0.391 0.391,-1.02406 0,-1.41406l-7.29297,-7.29297l7.29297,-7.29297c0.391,-0.39 0.391,-1.02406 0,-1.41406l-2,-2c-0.391,-0.391 -1.02406,-0.391 -1.41406,0l-7.29297,7.29297l-7.29297,-7.29297c-0.1955,-0.1955 -0.45116,-0.29297 -0.70703,-0.29297z"></path></g></g>
</svg>`;

// Container UX shared predicates / transforms (used by both iframe and admin).
// canContainAll moved to @volto-hydra/helpers (SSR-safe).
export { canContain, findConversionPath, mapLayoutItems } from './containerOps.js';

// buildAnchorTree turns the flat, leveled deep-link anchor list into a nested
// contents tree — re-exported so the admin (fragment picker) and frontends (an
// in-page navigation block) build the hierarchy from ONE source.
export { buildAnchorTree } from './linkableAnchors.js';
