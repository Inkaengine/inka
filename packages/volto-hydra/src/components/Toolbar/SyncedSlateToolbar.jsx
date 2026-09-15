import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, Component } from 'react';
import { Slate, ReactEditor, useSlate } from 'slate-react';
import { Transforms, Node, Range, Editor, Element, Point } from 'slate';
import { isEqual, cloneDeep } from 'lodash';
import config from '@plone/volto/registry';
import { Icon } from '@plone/volto/components';
import { makeEditor, toggleInlineFormat, isBlockActive } from '@plone/volto-slate/utils';
import { BlockButton } from '@plone/volto-slate/editor/ui';
import slateTransforms, { withEmptyInlineRemoval } from '../../utils/slateTransforms';
import { syncCreateSlateBlock } from '@plone/volto-slate/utils/volto-blocks';
import { getBlockById, updateBlockById, getResolvedSchema } from '../../utils/blockPath';
import { calculateDragHandlePosition, PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import { isSlateFieldType, isBlockPositionLocked, isBlockReadonly, getFieldValue, getFieldDef } from '@volto-hydra/helpers';
import { isStyleAllowed } from '../../../../hydra-js/slateStyles.js';
import { useDispatch, useSelector } from 'react-redux';
import FormatDropdown from './FormatDropdown';
import DropdownMenu from './DropdownMenu';
import TemplateLockToggle from './TemplateLockToggle';
import OptionalFieldsToggle from './OptionalFieldsToggle';
import linkSVG from '@plone/volto/icons/link.svg';
import imageSVG from '@plone/volto/icons/image.svg';
import clearSVG from '@plone/volto/icons/clear.svg';
import upSVG from '@plone/volto/icons/up.svg';
import lockSVG from '@plone/volto/icons/lock.svg';
import AddLinkForm from '@plone/volto/components/manage/AnchorPlugin/components/LinkButton/AddLinkForm';
import { ImageInput } from '@plone/volto/components/manage/Widgets/ImageWidget';
import { createLog } from '../../utils/log';

const log = createLog('TOOLBAR');

// Buttons that open a UI before applying a transform. These get flushed
// (text synced) but without input blocking — the user needs pointer events
// to interact with the UI and cancel by clicking back to the editor.
const DEFERRED_BUTTONS = ['link'];

/**
 * Validates if a selection is valid for the given document structure.
 * Returns true if all paths in the selection exist in the document.
 */
function isSelectionValidForDocument(selection, children) {
  if (!selection) return true; // No selection is always valid
  if (!children || !Array.isArray(children)) return false;

  // Create a temporary object to check paths against
  const doc = { children };

  try {
    // Check if both anchor and focus paths exist in the document
    if (selection.anchor?.path) {
      Node.get(doc, selection.anchor.path);
    }
    if (selection.focus?.path) {
      Node.get(doc, selection.focus.path);
    }
    return true;
  } catch (e) {
    // Path doesn't exist in document
    return false;
  }
}

/**
 * Error boundary to catch ReactEditor DOM errors from toolbar editors
 * The toolbar editor isn't in a resolvable DOM tree, so Slate DOM operations fail
 */
class SlateErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    // Suppress Slate DOM errors for toolbar editor
    if (error?.message?.includes('Cannot resolve a DOM node')) {
      return { hasError: false }; // Don't show error UI, just suppress it
    }
    // Re-throw other errors
    throw error;
  }

  render() {
    return this.props.children;
  }
}

/**
 * Checks if a button factory creates a BlockButton component.
 *
 * Button factories in config.settings.slate.buttons are arrow functions that
 * return React elements: (props) => <MarkElementButton ... /> or <BlockButton ... />
 *
 * We call the factory (with empty props) to get the element, then compare the
 * element's type to the imported BlockButton component reference.
 *
 * BlockButtons are used for block-level formatting (headings, lists, blockquote).
 * They should go in the FormatDropdown. Other buttons (MarkElementButton for bold,
 * italic, etc.) stay in the toolbar.
 *
 * NOTE: We compare element.type === BlockButton directly, which works in both
 * development and production builds because it's a reference comparison, not
 * a string name comparison that would be affected by minification.
 */
function isBlockButton(Btn, BlockButtonRef) {
  if (!Btn || !BlockButtonRef) return false;
  try {
    // Call the factory function to get the React element
    // The factory is like: (props) => <BlockButton format="h2" ... />
    // Calling it returns the element {type: BlockButton, props: {...}}
    const element = Btn({});
    // Compare element.type to the imported BlockButton component reference
    // This is a reference comparison that works in production builds
    return element?.type === BlockButtonRef;
  } catch (e) {
    // If the factory throws (shouldn't happen), treat as non-block button
    return false;
  }
}

/**
 * The element type a toolbar button applies, or undefined when it doesn't name
 * one (the link editor, the style menu). Both button kinds carry it as
 * `format`: BlockButton for block-level types, MarkElementButton for the inline
 * ones — volto-slate models bold/italic as inline ELEMENTS, so one prop covers
 * both. A button with no `format` is left alone rather than guessed at.
 */
function buttonFormat(Btn) {
  try {
    return Btn({})?.props?.format;
  } catch (e) {
    return undefined;
  }
}

/**
 * Bring the editor's content inside the region's slate style allow-list (#295).
 *
 * Used after a PASTE, which is the one surface that can introduce a disallowed
 * node without a keystroke to intercept. Mirrors the `unwrapBlock` transform
 * below: an aliased type is renamed, an inline node unwraps (retyping it would
 * nest a paragraph inside a paragraph), and a top-level node becomes the
 * default block type. Innermost-first (`mode: 'lowest'`) so unwrapping never
 * invalidates a path we still hold.
 */
function enforceSlateStyles(editor, rules, aliases, defaultType) {
  if (!rules) return;
  // Every pass either retypes a node to something allowed or removes it, so
  // this terminates; the cap is a backstop against a config that can't settle.
  for (let guard = 0; guard < 500; guard++) {
    const [entry] = Editor.nodes(editor, {
      at: [],
      match: (n) =>
        Element.isElement(n) && !Editor.isEditor(n) && !isStyleAllowed(n.type, rules),
      mode: 'lowest',
    });
    if (!entry) return;
    const [node, path] = entry;
    const alias = aliases[node.type];
    const target = alias && isStyleAllowed(alias, rules)
      ? alias
      : (isStyleAllowed(defaultType, rules) ? defaultType : null);
    const isBlockWrapper =
      node.children?.length > 0 && node.children.every((c) => Element.isElement(c));
    if (alias && target === alias) {
      Transforms.setNodes(editor, { type: target }, { at: path });
    } else if (path.length > 1 || isBlockWrapper) {
      Transforms.unwrapNodes(editor, { at: path });
    } else if (target) {
      Transforms.setNodes(editor, { type: target }, { at: path });
    } else {
      // The fallback type is itself disallowed — a config error, and unwrapping
      // a top-level node would lift bare text to the editor root. Leave the
      // node and say so rather than corrupting the value.
      console.error(
        `[slateStyles] defaultBlockType "${defaultType}" is disallowed here, so "${node.type}" cannot be downgraded. Fix the region's allowedStyles.`,
      );
      return;
    }
  }
}

/**
 * Synced Slate Toolbar - Renders real Slate buttons with synchronized editor
 *
 * This component creates a real Slate editor that stays synchronized with:
 * - The current block's value (from Redux form data)
 * - The current selection (from iframe)
 *
 * Real Slate buttons are rendered inside the Slate context, allowing them to:
 * - Access the editor via useSlate() hook
 * - Determine their own active state via isBlockActive/isMarkActive
 * - Execute transforms directly on the editor
 * - Work automatically including custom plugin buttons
 *
 * When a button modifies the editor, onChange fires and we send the updated
 * value back to Redux and the iframe.
 *
 * For detailed data flow architecture (format buttons, sidebar editing, hotkeys,
 * block selection), see: docs/slate-transforms-architecture.md
 */

// DEBUG: Component inside <Slate> context to verify useSlate() subscriber re-renders
let _debugSlateChildRenderCount = 0;
const DebugSlateChild = () => {
  const editor = useSlate();
  _debugSlateChildRenderCount++;
  const hasStrong = editor.children?.[0]?.children?.some(c => c.type === 'strong');
  const active = hasStrong ? isBlockActive(editor, 'strong') : false;
  const selPath = editor.selection?.anchor?.path;
  if (hasStrong) {
    log('DEBUG_SLATE_CHILD render #' + _debugSlateChildRenderCount +
      ': hasStrong:', hasStrong, 'isBlockActive(strong):', active,
      'selection:', JSON.stringify(selPath),
      'children:', JSON.stringify(editor.children?.[0]?.children?.map(c => ({ type: c.type, text: c.text?.substring(0,10) }))));
  }
  return null;
};

const SyncedSlateToolbar = ({
  selectedBlock,
  form,
  blockPathMap,
  currentSelection,
  _selectionSource,
  mouseActivityCounter,
  blockHasEmbed,
  onChangeFormData,
  completedFlushRequestId,
  transformAction,
  onTransformApplied,
  blockUI,
  blockFieldTypes,
  iframeElement,
  onDeleteBlock,
  onSelectBlock,
  parentId,
  maxToolbarWidth,
  blockActions, // { toolbar: [...], dropdown: [...] } from pathMap.actions
  onBlockAction, // Handler for block actions: (actionId) => void
  onFieldLinkChange, // Handler for link field changes: (fieldName, url) => void
  onOpenObjectBrowser, // Handler to open object browser for media fields
  onFileUpload, // Handler for file uploads: (fieldName, file) => void
  convertibleTypes = [], // Array of { type, title } for block type conversion
  onConvertBlock, // Handler for block conversion: (newType) => void
  onOpenConvertChooser, // Handler to open BlockChooser for convert: () => void
  canWrap = false, // True when there's a multi-selection that can be wrapped
  onOpenWrapChooser, // Handler to open BlockChooser for wrap: () => void
  canUnwrap = false, // True when selected container can be unwrapped into its parent
  onUnwrap, // Handler for unwrap: () => void
  onMakeTemplate, // Handler for "Make Template" action
  templateEditMode, // instanceId of template being edited, or null
  onToggleTemplateEditMode, // Enter/exit template edit mode: (instanceId|null) => void
  templatePermissions, // Map templateId -> { can_edit } (defaults to editable)
}) => {

  // Helper to get block data using path lookup (supports nested blocks)
  // For page-level fields (blockId is PAGE_BLOCK_UID), return form itself
  const getBlock = useCallback((blockId) => {
    if (blockId === PAGE_BLOCK_UID) {
      return form; // Page-level fields access form directly
    }
    return getBlockById(form, blockPathMap, blockId);
  }, [form, blockPathMap]);

  // Helper to update block data using path lookup (supports nested blocks)
  const updateBlockInForm = useCallback((blockId, newBlockData) => {
    return updateBlockById(form, blockPathMap, blockId, newBlockData);
  }, [form, blockPathMap]);

  // Slate styles this block's REGION permits (#295), resolved by
  // buildBlockPathMap and carried on the pathmap entry. null → unrestricted.
  const slateRules = blockPathMap?.[selectedBlock]?.slateRules || null;
  // Read from the config singleton at USE time, not captured into a value here.
  // `config.settings.slate?.styleAliases || {}` built a NEW object on every
  // render; with that in the transform effect's dependency array the effect
  // re-ran on every render, and the format transform it processes was the
  // casualty — bold stopped applying. Everything else in this component reads
  // `config.settings.slate.*` the same way, without deps, because the registry
  // is process-stable.
  const slateStyleAliases = () => config.settings.slate?.styleAliases || {};
  const slateDefaultType = () => config.settings.slate?.defaultBlockType || 'p';


  // The move target is computed by hydra.js from RENDER geometry (reusing the
  // container edge-handle machinery) and delivered on BLOCK_SELECTED. The chevron
  // just dispatches it through the existing MOVE_BLOCKS → moveBlockBetweenContainers
  // path; the admin no longer re-derives the tree from data order.
  const moveSelectedBlock = (direction) => {
    const target =
      direction === 'up' ? blockUI?.moveUpTarget : blockUI?.moveDownTarget;
    if (!target) return;
    document.dispatchEvent(
      new CustomEvent('hydra-move-block', {
        detail: { blockId: selectedBlock, ...target },
      }),
    );
  };

  // null target => no move that way => chevron disabled.
  const isAtTopOfParent = !blockUI?.moveUpTarget;
  const isAtBottomOfParent = !blockUI?.moveDownTarget;

  // Create Slate editor once using Volto's makeEditor (includes all plugins)
  // Add withEmptyInlineRemoval to clean up empty formatting elements after delete
  const [editor] = useState(() => {
    const ed = withEmptyInlineRemoval(makeEditor());

    // Skip normalizeExternalData (like the Text block does) so that pasted
    // inline elements (images, tables) survive deserialization intact.
    // The base normalizeExternalData strips them during Editor.normalize().
    ed.normalizeExternalData = (fragment) => fragment;

    // Implement savedSelection for link plugin (stores selection from iframe)
    ed.savedSelection = null;
    ed.getSavedSelection = () => ed.savedSelection;
    ed.setSavedSelection = (selection) => {
      ed.savedSelection = selection;
    };
    ed.isSidebarOpen = false;

    // Ensure editor has a UID for Redux state keys (required for persistent helpers)
    if (!ed.uid) {
      ed.uid = `toolbar-${selectedBlock}`;
    }

    // Mark as toolbar editor
    ed.isToolbarEditor = true;

    return ed;
  });

  // Redux dispatch for closing persistent helpers
  const dispatch = useDispatch();
  const blocksClipboard = useSelector((state) => state?.blocksClipboard || {});

  // Wrap ReactEditor.focus to handle toolbar editor gracefully
  // The toolbar editor isn't in a resolvable DOM tree, so focus calls will fail
  useEffect(() => {
    const originalFocus = ReactEditor.focus;

    ReactEditor.focus = (editorToFocus) => {
      // Skip focus for our toolbar editor
      if (editorToFocus === editor || editorToFocus?.isToolbarEditor) {
        return;
      }
      // Call original for other editors
      try {
        return originalFocus(editorToFocus);
      } catch (e) {
        // Silently catch DOM resolution errors for toolbar editor
        log('[ReactEditor.focus] Focus error caught:', e.message);
      }
    };

    // Global error handler for synchronous focus errors (e.g., Clear button in AddLinkForm)
    // When this.input.focus() is called and this.input is null, the error would break
    // React's event handling and prevent onClear changes from being committed
    const handleError = (event) => {
      const error = event.error || event.reason;
      if (error?.message?.includes("Cannot read properties of null (reading 'focus')")) {
        event.preventDefault();
        return true;
      }
    };

    window.addEventListener('error', handleError, true);

    return () => {
      ReactEditor.focus = originalFocus;
      window.removeEventListener('error', handleError, true);
    };
  }, [editor]);


  // Detect clicks in iframe to close popups like LinkEditor
  // Clicks in iframe don't bubble to parent document, so handleClickOutside never fires
  // Solution: When Admin window loses focus to iframe, dispatch synthetic mousedown
  useEffect(() => {
    const handleWindowBlur = () => {
      // Check if focus went to the iframe
      const iframe = document.getElementById('previewIframe');
      if (document.activeElement === iframe) {
        // Dispatch a synthetic mousedown so Volto's Toolbar handleClickOutside runs
        // and closes any open toolbar menu now that focus left for the iframe.
        //
        // Dispatch on document.body, NOT document. handleClickOutside does
        // `e.target.closest('.ui.modal')`, and `document` has no `.closest` — dispatching
        // on document made `e.target === document` and threw
        // `TypeError: target.closest is not a function`, aborting handleClickOutside
        // before closeMenu() ran, on EVERY focus-to-iframe transition (e.g. cancelling
        // the LinkEditor). body is an Element with .closest and the event still bubbles
        // to the document-level listener, so the menu actually closes.
        const mousedownEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        document.body.dispatchEvent(mousedownEvent);
      }
    };

    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, []);

  // Track internal value to detect external changes (like Volto does)
  const internalValueRef = useRef(null);

  // Force re-renders when value changes (to update button active states)
  // State for dropdown menu
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuButtonRect, setMenuButtonRect] = useState(null);
  const [pasteAllowed, setPasteAllowed] = useState(true);

  // Listen for paste-allowed state from View.jsx
  useEffect(() => {
    const handler = (e) => setPasteAllowed(e.detail.allowed);
    document.addEventListener('hydra-paste-state', handler);
    return () => document.removeEventListener('hydra-paste-state', handler);
  }, []);

  // State for field link editor popup
  const [fieldLinkEditorOpen, setFieldLinkEditorOpen] = useState(false);
  const [fieldLinkEditorField, setFieldLinkEditorField] = useState(null);

  // State for field image editor popup
  const [fieldImageEditorOpen, setFieldImageEditorOpen] = useState(false);
  const [fieldImageEditorField, setFieldImageEditorField] = useState(null);

  // Close image editor when block is deselected or changes
  useEffect(() => {
    if (!selectedBlock || !blockUI) {
      setFieldImageEditorOpen(false);
      setFieldImageEditorField(null);
    }
  }, [selectedBlock, blockUI]);

  // Helper to replace editor content using proper Slate APIs
  // Direct assignment (editor.children = X) bypasses Slate-react's state tracking,
  // causing "Cannot find descendant at path" errors when transforms run afterward
  // Optional transformCallback runs INSIDE the same withoutNormalizing block
  // so all operations are batched together
  const replaceEditorContent = useCallback((newValue, selection, transformCallback) => {
    Editor.withoutNormalizing(editor, () => {
      // Remove all existing nodes
      while (editor.children.length > 0) {
        Transforms.removeNodes(editor, { at: [0] });
      }
      // Insert new content (cloned to prevent Slate normalization from mutating Redux state)
      const newNodes = cloneDeep(newValue);
      for (let i = 0; i < newNodes.length; i++) {
        Transforms.insertNodes(editor, newNodes[i], { at: [i] });
      }
      // Restore selection if valid
      if (selection && isSelectionValidForDocument(selection, newValue)) {
        try {
          Transforms.select(editor, selection);
        } catch (e) {
          // Selection invalid, ignore
        }
      }
      // Run transform callback inside the same batch if provided
      if (transformCallback) {
        transformCallback();
      }
    });
  }, [editor]);

  // Track pending flush request for button click coordination
  const pendingFlushRef = useRef(null); // { requestId, button }
  // Track the requestId of active format operation (persists through handleChange)
  const activeFormatRequestIdRef = useRef(null);
  // Track processed transform requestIds to prevent double-application
  const processedTransformRequestIdRef = useRef(null);
  // Track LinkEditor visibility across effect restarts (persists when dependencies change)
  const linkEditorWasVisibleRef = useRef(false);
  // Refs for stable access inside the polling useEffect (avoids volatile deps that restart the interval)
  const currentSelectionRef = useRef(currentSelection);
  currentSelectionRef.current = currentSelection;
  const onChangeFormDataRef = useRef(onChangeFormData);
  onChangeFormDataRef.current = onChangeFormData;

  // ── Toolbar auto-fade on inactivity ──────────────────────────────────
  // Toolbar starts hidden on each block selection. Only mouse activity or
  // text selection shows it. Clicking a block fires MOUSE_ACTIVITY which
  // shows it; keyboard navigation (arrow, Enter, Tab) keeps it hidden.
  const [isFaded, setIsFaded] = useState(true);
  const fadeTimerRef = useRef(null);
  const isCollapsedRef = useRef(true);

  // Determine if currentSelection is collapsed (anchor === focus)
  const isSelectionCollapsed = !currentSelection ||
    (currentSelection.anchor && currentSelection.focus &&
     isEqual(currentSelection.anchor, currentSelection.focus));

  // Keep ref in sync for use in event handlers
  isCollapsedRef.current = isSelectionCollapsed;

  // Fading is for blocks the author is READING past: the toolbar sits over their
  // content, their mouse keeps it alive, and it gets out of the way when they
  // stop. A block whose content is an EMBED — a video, a map, a PDF preview —
  // reports no mouse activity at all: those events belong to the embed's own
  // document and never reach us. Fade there and the controls disappear seconds
  // into the interaction, with nothing able to bring them back.
  const startFadeTimer = useCallback(() => {
    clearTimeout(fadeTimerRef.current);
    if (blockHasEmbed) return;
    fadeTimerRef.current = setTimeout(() => setIsFaded(true), 5000);
  }, [blockHasEmbed]);

  // Reset to faded on block change — each block starts hidden, EXCEPT one whose
  // activity the embed is taking.
  useEffect(() => {
    setIsFaded(!blockHasEmbed);
    clearTimeout(fadeTimerRef.current);
  }, [selectedBlock, blockHasEmbed]);

  // Text selection shows toolbar; collapsing starts fade timer
  useEffect(() => {
    if (!isSelectionCollapsed) {
      clearTimeout(fadeTimerRef.current);
      setIsFaded(false);
    } else {
      startFadeTimer();
    }
    return () => clearTimeout(fadeTimerRef.current);
  }, [isSelectionCollapsed, startFadeTimer]);

  // Mouse activity from iframe: show toolbar, restart fade timer if collapsed
  useEffect(() => {
    if (mouseActivityCounter === 0) return; // Skip initial mount
    setIsFaded(false);
    if (isCollapsedRef.current) {
      startFadeTimer();
    }
  }, [mouseActivityCounter, startFadeTimer]);

  // The LinkEditor (.add-link) closed: unblock the iframe with the formatRequestId and
  // hand back the selection captured when the link button was clicked. Focus restoration
  // then happens in the iframe (the FORM_DATA useEffect focuses the iframe element, and
  // afterContentRender restores the field selection). Uses only refs, so it's stable and
  // safe to call from either the event or the poll.
  //
  // Idempotent: guarded by activeFormatRequestIdRef (nulled after firing), so if the
  // event AND the poll both notice the same close it's a no-op the second time.
  const handleLinkEditorClosed = useCallback(() => {
    if (activeFormatRequestIdRef.current) {
      onChangeFormDataRef.current(
        null,
        currentSelectionRef.current,
        activeFormatRequestIdRef.current,
      );
      activeFormatRequestIdRef.current = null;
    }
    // Don't clear pendingFlushRef here — it's cleared when the flush completes. A stale
    // close can arrive while a new button click is pending; don't disturb it.
  }, []);

  // Event-driven close for the CANCEL path. The LinkEditor's real close signal is React
  // state inside Volto's useLinkEditor (setShowLinkEditor(false)), which this component
  // can't observe — the helper renders generically via persistentHelpers. Escape / cancel
  // route through AddLinkForm.onClose (our shadow), which dispatches this event, so we
  // react the instant it closes instead of up to 100ms later on the next poll tick — that
  // detection gap is what raced the async selection-restore (the flaky "cancelling
  // LinkEditor" test).
  useEffect(() => {
    const onClose = () => {
      linkEditorWasVisibleRef.current = false;
      handleLinkEditorClosed();
    };
    document.addEventListener('hydra:linkeditor-close', onClose);
    return () => document.removeEventListener('hydra:linkeditor-close', onClose);
  }, [handleLinkEditorClosed]);

  // Poll fallback for close paths that do NOT route through AddLinkForm.onClose — most
  // notably applying a link, which Volto's useLinkEditor closes directly via
  // setShowLinkEditor(false). Converting those to events too would mean shadowing the
  // Volto hook; the poll is a cheap safety net and the event above already makes the
  // flaky cancel path deterministic.
  useEffect(() => {
    const checkVisibility = () => {
      const popup = document.querySelector('.add-link');

      if (!popup) {
        if (linkEditorWasVisibleRef.current) {
          linkEditorWasVisibleRef.current = false;
          handleLinkEditorClosed();
        }
        return;
      }

      const style = window.getComputedStyle(popup);
      const isVisible = style.opacity !== '0' && style.display !== 'none' && style.visibility !== 'hidden';

      if (linkEditorWasVisibleRef.current && !isVisible) {
        handleLinkEditorClosed();
      }
      linkEditorWasVisibleRef.current = isVisible;
    };

    const intervalId = setInterval(checkVisibility, 100);
    return () => clearInterval(intervalId);
  }, [handleLinkEditorClosed]);

  // Helper function for applying inline format with prospective formatting support
  // Used by both hotkey transforms and toolbar button clicks
  const applyInlineFormat = useCallback((format, requestId) => {
    if (!editor) return;

    // Store requestId so handleChange includes it in FORM_DATA for iframe unblocking
    if (requestId) {
      activeFormatRequestIdRef.current = requestId;
    }

    const isCollapsed = editor.selection && Range.isCollapsed(editor.selection);
    const formatIsActive = isBlockActive(editor, format);

    if (isCollapsed) {
      // Prospective formatting - handle differently for collapsed selections
      if (formatIsActive) {
        // Cursor is inside the format element - exit it (move cursor after)
        const [inlineEntry] = Editor.nodes(editor, {
          match: n => n.type === format,
          mode: 'lowest',
        });

        if (inlineEntry) {
          const [, inlinePath] = inlineEntry;
          const afterPoint = Editor.after(editor, inlinePath);
          const formBlock = getBlockById(form, blockPathMap, selectedBlock);
          const formBlockValue = formBlock?.value?.[0]?.children;
          log('FORMAT: Cursor exit: inlinePath:', JSON.stringify(inlinePath), 'afterPoint:', JSON.stringify(afterPoint), 'editor.children:', JSON.stringify(editor.children?.[0]?.children), 'form.blocks.value:', JSON.stringify(formBlockValue));
          if (afterPoint) {
            Transforms.select(editor, afterPoint);
            // Selection-only change won't trigger handleChange, so manually send FORM_DATA
            if (requestId) {
              const exitSel = editor.selection ? {
                anchor: { path: [...editor.selection.anchor.path], offset: editor.selection.anchor.offset },
                focus: { path: [...editor.selection.focus.path], offset: editor.selection.focus.offset },
              } : null;
              onChangeFormData(null, exitSel, requestId);
              activeFormatRequestIdRef.current = null;
            }
          } else {
            log('FORMAT: Cursor exit: NO afterPoint, inserting empty text node');
            Transforms.insertNodes(editor, { text: '' }, { at: [...inlinePath.slice(0, -1), inlinePath[inlinePath.length - 1] + 1] });
            const newAfterPoint = Editor.after(editor, inlinePath);
            if (newAfterPoint) {
              Transforms.select(editor, newAfterPoint);
            }
          }
        }
      } else {
        // Cursor is NOT inside the format element - enable prospective formatting
        // Use zero-width space (ZWS) to prevent withEmptyInlineRemoval from removing the node
        // ZWS is invisible but makes the node non-empty, so normalization won't delete it
        log('FORMAT: Before insertNodes:', JSON.stringify(editor.children?.[0]?.children), 'selection:', JSON.stringify(editor.selection));
        const inlineNode = { type: format, children: [{ text: '\u200B' }] };
        Transforms.insertNodes(editor, inlineNode);
        log('FORMAT: After insertNodes:', JSON.stringify(editor.children?.[0]?.children), 'ops:', editor.operations.length);

        const [insertedEntry] = Editor.nodes(editor, {
          match: n => n.type === format && n.children?.length === 1 && n.children[0].text === '\u200B',
          mode: 'lowest',
          reverse: true,
        });

        if (insertedEntry) {
          const [, insertedPath] = insertedEntry;
          Transforms.select(editor, { path: [...insertedPath, 0], offset: 0 });
          log('FORMAT: After select, insertedPath:', JSON.stringify(insertedPath), 'selection:', JSON.stringify(editor.selection));
        } else {
          log('FORMAT: WARNING: Could not find inserted node!');
        }
        // handleChange will fire because we changed children
      }
    } else {
      // Range selection - use toggleInlineFormat to wrap/unwrap selected text
      const t0 = performance.now();
      const rangeRef = Editor.rangeRef(editor, editor.selection);
      toggleInlineFormat(editor, format);
      console.log(`[TOOLBAR-TIMING] toggleInlineFormat: ${(performance.now() - t0).toFixed(0)}ms`);
      // Restore selection from tracked range (handles path shifts from wrapping/normalization)
      if (rangeRef.current) {
        try {
          Transforms.select(editor, rangeRef.current);
        } catch (e) {
          log('Failed to restore selection after format:', e.message);
        }
        rangeRef.unref();
      }
    }
  }, [editor, form, onChangeFormData]);

  // Sync editor state when form data, selection, or transform changes
  useEffect(() => {
    // === SETUP ===
    const block = getBlock(selectedBlock);
    if (!selectedBlock || !block) return;

    const fieldName = blockUI?.focusedFieldName || 'value';
    const fieldValue = getFieldValue(block, fieldName);

    // Only sync for slate fields
    const blockType = block?.['@type'];
    const fieldType = blockFieldTypes?.[blockType]?.[fieldName];
    if (!isSlateFieldType(fieldType)) {
      internalValueRef.current = null;
      return;
    }

    // === DETERMINE WHAT NEEDS TO HAPPEN ===
    // Echo prevention is handled by View.jsx (editSequenceRef filters stale INLINE_EDIT_DATA
    // before it reaches iframeSyncState.formData), so the toolbar only needs to check
    // whether content has actually changed.
    const contentIsDifferent = fieldValue && !isEqual(fieldValue, editor.children);
    const contentNeedsSync = contentIsDifferent;
    const hasUnprocessedTransform = transformAction &&
      transformAction.requestId !== processedTransformRequestIdRef.current;

    log('SYNC: contentNeedsSync:', contentNeedsSync,
      'hasUnprocessedTransform:', hasUnprocessedTransform);

    // Debug: check for ZWS differences
    if (fieldValue && editor.children) {
      const fieldText = fieldValue[0]?.children?.[0]?.text;
      const editorText = editor.children[0]?.children?.[0]?.text;
      if (fieldText !== editorText) {
        log('SYNC: Text mismatch - fieldValue:', JSON.stringify(fieldText?.substring(0,40)),
          'editor:', JSON.stringify(editorText?.substring(0,40)),
          'fieldHasZWS:', fieldText?.includes('\u200B'),
          'editorHasZWS:', editorText?.includes('\u200B'));
      }
    }

    // Helper to apply transform based on type.
    // Wraps all transforms in _batchingTransform to suppress intermediate onChange
    // calls (many transforms do multiple Slate operations, each firing onChange).
    // When called standalone, handleChange fires once in the finally block.
    // When called inside replaceEditorContent (outer batching), the caller is
    // responsible for calling handleChange after replaceEditorContent returns.
    const applyTransform = () => {
      const { type, requestId } = transformAction;
      const outerBatching = editor._batchingTransform;
      editor._batchingTransform = true;
      try {
      switch (type) {
        case 'format':
          // Backstop: every entry point is gated at its own surface, but this is
          // where a format actually gets written, so a surface added later
          // without an allow-list check still can't slip one through.
          if (isStyleAllowed(transformAction.format, slateRules)) {
            applyInlineFormat(transformAction.format, requestId);
          }
          break;
        case 'paste': {
          // Use volto-slate's full insertData pipeline (handles text/plain with
          // newline splitting, text/html with tables/images/lists, and Slate fragments).
          const dt = new DataTransfer();
          const pasteContent = transformAction.html;
          if (pasteContent.trimStart().startsWith('<')) {
            dt.setData('text/html', pasteContent);
          } else {
            dt.setData('text/plain', pasteContent);
          }
          editor.insertData(dt);

          // Paste is the one surface with no keystroke to intercept — the HTML
          // is deserialized by volto-slate before we see it — so the allow-list
          // is applied to the result instead. Before the split below, so the
          // blocks that split out are already normalized.
          enforceSlateStyles(editor, slateRules, slateStyleAliases(), slateDefaultType());

          // Run voltoBlockEmiters (extractImages, extractTables) on the editor
          // to extract inline images/tables into separate block tuples.
          // Then split extra top-level children into new slate blocks.
          // First child stays in the editor (original block), rest become extraBlocks.
          const { voltoBlockEmiters } = config.settings.slate;
          if (editor.children.length > 1) {
            const pathRefs = Array.from(Node.children(editor, []))
              .map(([, path]) => Editor.pathRef(editor, path));
            const extraBlocks = [];

            // Process all children in order (matching deconstructToVoltoBlocks).
            // For each child: run emitters (extract images/tables), then keep
            // remaining text. First child's text stays in the editor; the rest
            // become new slate blocks. Emitter results follow each child's text.
            for (let i = 0; i < pathRefs.length; i++) {
              const pathRef = pathRefs[i];
              const extras = voltoBlockEmiters
                .map((emit) => emit(editor, pathRef))
                .flat(1);
              // First child stays in editor — only extract emitter results
              if (i > 0 && pathRef.current) {
                const [childNode] = Editor.node(editor, pathRef.current);
                if (childNode && !Editor.isEmpty(editor, childNode)) {
                  extraBlocks.push(syncCreateSlateBlock([childNode]));
                }
              }
              extraBlocks.push(...extras);
            }

            // Keep only first child in editor
            Editor.withoutNormalizing(editor, () => {
              for (let i = editor.children.length - 1; i > 0; i--) {
                Transforms.removeNodes(editor, { at: [i] });
              }
            });

            pathRefs.forEach((ref) => ref.unref());

            if (extraBlocks.length > 0) {
              editor._extraBlocks = extraBlocks;
            }
          } else if (voltoBlockEmiters.length > 0) {
            // Single child — still check for inline images/tables
            const pathRef = Editor.pathRef(editor, [0]);
            const extras = voltoBlockEmiters
              .map((emit) => emit(editor, pathRef))
              .flat(1);
            pathRef.unref();
            if (extras.length > 0) {
              editor._extraBlocks = extras;
            }
          }
          break;
        }
        case 'delete':
          // When selection is collapsed, use Editor.deleteBackward/deleteForward
          // (goes through Slate plugin system for list unwrapping etc.)
          // When selection is a range, delete the entire selection.
          if (editor.selection && Range.isCollapsed(editor.selection)) {
            if (transformAction.direction === 'backward') {
              Editor.deleteBackward(editor, { unit: 'character' });
            } else {
              Editor.deleteForward(editor, { unit: 'character' });
            }
          } else {
            Transforms.delete(editor);
          }
          break;
        case 'markdown':
          // Trigger Slate's withAutoformat plugin by calling editor.insertText(' ')
          // The editor content was already synced (replaceEditorContent) with the
          // markdown markup text (e.g., "##" or "**bold**"). The space triggers
          // autoformat which recognizes the pattern and applies the transform.
          editor.insertText(' ');
          break;
        case 'unwrapBlock': {
          // Backspace at start of a slate field: unwrap any non-default structure.
          // Converts headings/blockquotes/lists → paragraph, removes inline marks.
          if (!editor.selection) {
            log('unwrapBlock: no editor.selection, skipping');
            break;
          }
          const { slate } = config.settings;
          const defaultType = slate?.defaultBlockType || 'p';

          Transforms.select(editor, Editor.start(editor, []));

          // Find the deepest non-default element (e.g., LI inside UL, or H2)
          const [entry] = Editor.nodes(editor, {
            match: (n) => Element.isElement(n) && !Editor.isEditor(n) && n.type !== defaultType,
            mode: 'lowest',
          });

          if (entry) {
            const [, path] = entry;
            log('unwrapBlock: found non-default element at path:', JSON.stringify(path), 'type:', entry[0]?.type);
            // Check if this element is nested inside another non-editor element
            // (e.g., LI inside UL/OL) — unwrap the parent wrapper first
            const parentEntry = Editor.above(editor, {
              at: path,
              match: (n) => Element.isElement(n) && !Editor.isEditor(n) && n.type !== defaultType,
            });
            if (parentEntry) {
              Transforms.unwrapNodes(editor, {
                at: parentEntry[1],
                split: true,
              });
            }
            // Convert the remaining non-default node to paragraph
            Transforms.setNodes(editor, { type: defaultType });
          } else {
            // No non-default elements — remove any inline marks at cursor
            const marks = Editor.marks(editor);
            if (marks) {
              Object.keys(marks).forEach((mark) => {
                Editor.removeMark(editor, mark);
              });
            }
            // If the block is already the defaultBlockType, empty, and this is the
            // first field — delete it. We verify all three conditions on the admin side:
            // 1. Already in else branch = no non-default elements found
            // 2. Editor text is empty (protects against stale isEmpty flag from iframe)
            // 3. Root element type matches defaultBlockType explicitly
            // Clear transformAction before delete to prevent stale re-processing on remount.
            const editorText = Editor.string(editor, []);
            const rootType = editor.children?.[0]?.type;
            log('unwrapBlock: isFirstField:', transformAction.isFirstField,
              'isEmpty:', transformAction.isEmpty, 'editorText:', JSON.stringify(editorText),
              'rootType:', rootType, 'selectedBlock:', selectedBlock);
            if (transformAction.isFirstField && transformAction.isEmpty) {
              if (editorText === '' && rootType === defaultType) {
                log('unwrapBlock: deleting empty block:', selectedBlock);
                onTransformApplied?.();
                onDeleteBlock(selectedBlock, true);
              }
            }
          }
          break;
        }
        case 'indent': {
          // Tab in list: indent list item (wrap in nested list)
          const { increaseItemDepth } = require('@plone/volto-slate/blocks/Text/keyboard/indentListItems');
          const indentMockEvent = { preventDefault: () => {}, stopPropagation: () => {} };
          increaseItemDepth(editor, indentMockEvent);
          break;
        }
        case 'outdent': {
          // Shift+Tab in list: outdent list item (unwrap from parent list)
          // Inline core logic from decreaseItemDepth, skipping deconstructToVoltoBlocks
          const { slate: slateConfig } = config.settings;
          const { getCurrentListItem, mergeWithPreviousList, mergeWithNextList } = require('@plone/volto-slate/utils/lists');
          const { Path } = require('slate');
          const [listItemNode, listItemPath] = getCurrentListItem(editor);
          if (listItemNode) {
            const [, parentListPath] = Editor.parent(editor, listItemPath);
            const listItemRef = Editor.pathRef(editor, listItemPath);

            Transforms.unwrapNodes(editor, {
              at: listItemPath,
              split: true,
              mode: 'lowest',
              match: (node) => slateConfig.listTypes.includes(node.type),
            });

            if (listItemRef.current.length > 1) mergeWithPreviousList(editor, Path.parent(listItemRef.current));
            if (listItemRef.current.length > 1) mergeWithNextList(editor, Path.parent(listItemRef.current));

            if (parentListPath.length === 1) {
              // Top-level list: convert li to paragraph
              Transforms.setNodes(
                editor,
                { type: slateConfig.defaultBlockType },
                { at: listItemRef.current, match: (n) => n === listItemNode },
              );
            }
            listItemRef.unref();
          }
          break;
        }
        default:
          log('ERROR: Unknown transform type:', type);
      }
      } finally {
        if (!outerBatching) {
          // We own the batching — finalize: un-batch and send one handleChange
          editor._batchingTransform = false;

          const hasStrongAfter = editor.children?.[0]?.children?.some(c => c.type === 'strong');
          log('FINALLY: _batchingTransform=false, calling handleChange. hasStrong:', hasStrongAfter);
          handleChange(editor.children);
          // If handleChange skipped (values equal — e.g., View.jsx handled the
          // merge instead of the toolbar), the formatRequestId ref is still set.
          // Clear it so it doesn't leak into a later re-sync handleChange.
          // The requestId flows through View.jsx's pendingFormatRequestId instead.
          activeFormatRequestIdRef.current = null;
        }
        // else: outer batching context (replaceEditorContent) will call
        // handleChange once after withoutNormalizing exits + normalizes
      }
    };

    // === EXECUTE: single unified flow for sync + transform ===
    // 1. Sync content if needed
    // 2. Apply transform if needed
    // 3. Call handleChange once
    // 4. Clean up transform state
    const needsSync = contentNeedsSync || (hasUnprocessedTransform && contentIsDifferent);
    const needsTransform = hasUnprocessedTransform;

    if (needsSync || needsTransform) {
      // Mark transform as processed early to prevent re-processing on re-render
      if (needsTransform) {
        processedTransformRequestIdRef.current = transformAction.requestId;
        activeFormatRequestIdRef.current = transformAction.requestId;
      }

      // Batch all operations (sync + transform) into a single handleChange
      editor._batchingTransform = true;

      if (needsSync) {
        log('SYNC: Syncing content', needsTransform ? '+ transform' : '(no transform)');
        const transformCallback = needsTransform ? () => {
          log('SYNC: Applying transform in batch');
          applyTransform();
        } : null;
        replaceEditorContent(fieldValue, currentSelection, transformCallback);
      } else if (needsTransform) {
        log('SYNC: Applying transform (content already synced)');
        // Apply selection from iframe before transform
        if (currentSelection && !isEqual(currentSelection, editor.selection) &&
            isSelectionValidForDocument(currentSelection, editor.children)) {
          log('SYNC: Applying selection before transform:', JSON.stringify(currentSelection));
          try {
            Transforms.select(editor, currentSelection);
          } catch (e) {
            log('Failed to apply selection before transform:', e.message);
          }
        }
        applyTransform();
      }

      // Single handleChange with final state
      editor._batchingTransform = false;
      handleChange(editor.children);

      // Clean up: clear stale refs and notify View.jsx
      activeFormatRequestIdRef.current = null;
      if (needsTransform) {
        onTransformApplied?.();
      }

      internalValueRef.current = editor.children;
      log('SYNC: Done. selection:', JSON.stringify(editor.selection));

    } else if (!contentNeedsSync && !hasUnprocessedTransform) {
      // Log editor state when no sync/transform needed — helps trace format overwrite
      const hasStrong = editor.children?.[0]?.children?.some(c => c.type === 'strong');
      const selPath = editor.selection?.anchor?.path;
      if (hasStrong) {
        log('SYNC: idle with strong in editor, selection path:', JSON.stringify(selPath), 'children:', JSON.stringify(editor.children?.[0]?.children?.map(c => c.type || c.text?.substring(0,10))));
      }
    }

    if (!contentNeedsSync && !hasUnprocessedTransform && currentSelection && !isEqual(currentSelection, editor.selection)) {
      // Check if selection needs update
      const isValid = isSelectionValidForDocument(currentSelection, editor.children);
      if (isValid) {
        // Selection-only change - update editor's selection
        // This handles clicks that move cursor without changing content
        log('SYNC: Selection-only change, updating editor.selection:', JSON.stringify(currentSelection), 'source:', _selectionSource);
        try {
          Transforms.select(editor, currentSelection);
        } catch (e) {
          // Selection invalid, ignore
        }
      } else {
        log('SYNC: Selection invalid for document:', JSON.stringify(currentSelection),
          'editor.children[0]:', JSON.stringify(editor.children?.[0]?.children?.map(c => ({ type: c.type, text: c.text?.substring(0,20) }))));
      }
    }

    // Update savedSelection from editor.selection AFTER all operations complete
    // This ensures Link plugin gets the correct position after transforms
    if (editor.selection) {
      editor.savedSelection = editor.selection;
    }

    // Update internal ref if content matches but ref is stale
    if (fieldValue && !isEqual(fieldValue, internalValueRef.current)) {
      internalValueRef.current = fieldValue;
    }

    // === HANDLE TOOLBAR BUTTON FLUSH REQUESTS ===
    if (completedFlushRequestId && pendingFlushRef.current) {
      const { requestId, button } = pendingFlushRef.current;
      if (requestId === completedFlushRequestId) {
        pendingFlushRef.current = null;
        const buttonName = button.dataset.toolbarButton;
        const buttonToFormat = {
          bold: 'strong', italic: 'em', underline: 'u',
          strikethrough: 'del', sub: 'sub', sup: 'sup', code: 'code',
        };
        const format = buttonToFormat[buttonName];

        if (format) {
          applyInlineFormat(format, requestId);
        } else {
          // Non-format button (link editor, etc.) - flush already synced text.
          // Re-dispatch the click. Set activeFormatRequestIdRef so the next
          // onChange (from selection change or link apply) includes the
          // requestId for unblocking. For cancel, the onChange with no data
          // change sends skipRender FORM_DATA to unblock.
          activeFormatRequestIdRef.current = requestId;
          button.dataset.bypassCapture = 'true';
          const clickable = button.querySelector('a.ui.button') || button.querySelector('button') || button;
          const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
          event._hydraReDispatch = true;
          window._hydraReDispatchEvent = event;
          clickable.dispatchEvent(event);
          setTimeout(() => { window._hydraReDispatchEvent = null; }, 0);
          delete button.dataset.bypassCapture;
        }
      }
    }
  }, [selectedBlock, form, currentSelection, editor, blockUI?.focusedFieldName, dispatch, completedFlushRequestId, blockFieldTypes, getBlock, applyInlineFormat, replaceEditorContent, transformAction, onTransformApplied, slateRules]);

  // NOTE: editor.hydra is set later (after toolbar position is calculated)
  // to include toolbarTop/toolbarLeft for LinkEditor positioning

  // Handle changes from button clicks (like Volto's handleChange)
  const handleChange = useCallback(
    (newValue) => {
      // Skip intermediate onChange calls during transform batching (many transforms
      // do multiple Slate operations; handleChange fires once in applyTransform's finally)
      if (editor._batchingTransform) return;

      const newText = newValue?.[0]?.children?.[0]?.text?.substring(0, 40);
      log('onChange: called, newText:', JSON.stringify(newText), 'selection:', JSON.stringify(editor.selection));

      // Update internal value tracker
      internalValueRef.current = newValue;

      // Only call onChange if value actually changed (like Volto line 108)
      const block = getBlock(selectedBlock);
      const fieldName = blockUI?.focusedFieldName || 'value';
      const currentFieldValue = getFieldValue(block, fieldName);
      const currentText = currentFieldValue?.[0]?.children?.[0]?.text?.substring(0, 40);

      if (isEqual(newValue, currentFieldValue)) {
        log('onChange: values equal, skipping');
        return;
      }
      log('onChange: values DIFFER! newText:', JSON.stringify(newText), 'currentText:', JSON.stringify(currentText), '- SENDING TO REDUX');

      const formatRequestId = activeFormatRequestIdRef.current;
      activeFormatRequestIdRef.current = null; // Clear after use

      // Pick up extra blocks from paste emitter extraction
      const extraBlocks = editor._extraBlocks || null;
      editor._extraBlocks = null;

      // Snapshot selection to prevent Slate's Object.assign mutation from
      // corrupting iframeSyncState through shared reference (Slate mutates
      // editor.selection in-place via Object.assign in apply/set_selection)
      const selSnapshot = editor.selection ? {
        anchor: { path: [...editor.selection.anchor.path], offset: editor.selection.anchor.offset },
        focus: { path: [...editor.selection.focus.path], offset: editor.selection.focus.offset },
      } : null;
      // Send field value change — View.jsx applies it to latest iframeSyncState
      // (not the stale form prop) inside setIframeSyncState(prev => ...)
      onChangeFormData(newValue, selSnapshot, formatRequestId, extraBlocks);
    },
    [form, selectedBlock, onChangeFormData, blockUI?.focusedFieldName, editor, getBlock],
  );

  // Get button configuration
  const toolbarButtons = config.settings.slate?.toolbarButtons || [];
  const buttons = config.settings.slate?.buttons || {};
  const persistentHelpers = config.settings.slate?.persistentHelpers || [];

  // Capture handlers for toolbar buttons - shared between main toolbar and overflow menu
  // These intercept mousedown to flush the iframe buffer before applying formatting
  const handleButtonMouseDownCapture = useCallback(
    (e) => {
      // Don't intercept clicks inside popups (like LinkEditor's Clear/Submit buttons)
      if (e.target.closest('.add-link')) {
        return;
      }

      // Don't intercept format dropdown trigger - it just opens a menu, no formatting
      if (e.target.closest('.format-dropdown-trigger')) {
        return;
      }

      // Nor the design-system style menu. It is a dropdown, not a format button:
      // intercepting its mousedown preventDefault'd the click that opens it, so
      // the menu never appeared and every DS style was unreachable — the buffer
      // flushed and nothing else happened. Its ITEMS live inside the trigger's
      // subtree (Dropdown.Item renders as a span), so excluding the trigger alone
      // would still leave them swallowed; the whole menu is excluded.
      if (e.target.closest('#style-menu')) {
        return;
      }

      const button =
        e.target.closest('button') || e.target.closest('[data-toolbar-button]');
      if (!button) return;

      // Check if this is a re-triggered event after flush
      if (button.dataset.bypassCapture === 'true') {
        return;
      }

      // Prevent the immediate mousedown - we'll re-trigger after flush
      e.preventDefault();
      e.stopPropagation();

      // Generate unique request ID and store pending request
      const requestId = `flush-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      pendingFlushRef.current = { requestId, button };

      // Deferred buttons (link editor) flush text but don't block —
      // user needs pointer events to interact with the UI and cancel.
      const buttonName = button.dataset?.toolbarButton
        || button.closest('[data-toolbar-button]')?.dataset?.toolbarButton;
      const shouldBlock = !DEFERRED_BUTTONS.includes(buttonName);

      // Send FLUSH_BUFFER to iframe - response will come via completedFlushRequestId prop
      const iframe = document.getElementById('previewIframe');
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'FLUSH_BUFFER', requestId, setBlocking: shouldBlock }, '*');
      }
    },
    [],
  );

  const handleButtonClickCapture = useCallback(
    (e) => {
      // Same exclusion as the mousedown handler: a style-menu click must reach
      // the dropdown.
      if (e.target.closest('#style-menu')) return;
      const button =
        e.target.closest('button') || e.target.closest('[data-toolbar-button]');
      if (!button) return;

      if (button.dataset.bypassCapture === 'true') {
        return;
      }

      // If pendingFlushRef has a request, the mousedown was intercepted
      // Block this click to prevent double-application
      if (pendingFlushRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [],
  );

  // Classify buttons into block buttons (FormatDropdown) and inline buttons (toolbar)
  // Computed inline (not in useMemo) because isBlockButton() calls the factory
  // function which may use hooks - calling hooks inside useMemo violates Rules of Hooks
  const blockButtons = [];
  const allInlineButtons = [];

  toolbarButtons.forEach((name) => {
    if (name === 'separator') return;
    const Btn = buttons[name];
    if (!Btn) return;

    // A button whose format this region disallows isn't offered. Cosmetic on
    // its own — paste, hotkeys and markdown are gated at their own surfaces —
    // but this is the one the author sees.
    const format = buttonFormat(Btn);
    if (format && !isStyleAllowed(format, slateRules)) return;

    // Create element for later rendering. The region's rules go to every
    // button: a plain format button is already gated by name above, but the
    // style menu holds MANY styles behind one button and has to filter its own
    // entries. Ignored by the buttons that don't take it.
    const element = <Btn slateRules={slateRules} />;

    // Check if this is a BlockButton (block-level format like h2, h3, ul, ol)
    // isBlockButton compares element.type to imported BlockButton reference
    if (isBlockButton(Btn, BlockButton)) {
      blockButtons.push({ name, element });
    } else {
      allInlineButtons.push({ name, element });
    }
  });

  // Multi-selection: simplified toolbar with drag handle + count
  const isMultiSelected = blockUI?.multiSelectedUids?.length > 1;

  // Render toolbar when we have a rect (either block or page-level field)
  if (!blockUI?.rect) {
    return null;
  }

  // DEFENSIVE: Verify we have form data with blocks
  if (!form) {
    throw new Error(`[SyncedSlateToolbar] form is ${form} - cannot render toolbar without form data`);
  }

  if (!form.blocks) {
    throw new Error(`[SyncedSlateToolbar] form.blocks is ${form.blocks} - form object doesn't have blocks property. Form keys: ${Object.keys(form).join(', ')}`);
  }

  // Check if we have block data for this specific block (supports nested blocks via path lookup)
  const block = getBlock(selectedBlock);
  if (!block) {
    return null; // No block data yet - this is OK during initial render
  }

  const fieldName = blockUI?.focusedFieldName || 'value';
  const fieldValue = getFieldValue(block, fieldName);

  // Template instance the selected block belongs to (walk up to the TOP-level
  // instance, skipping nested ones) so the ⋯ dropdown can offer "Edit template" /
  // "Save template" straight from the Quanta toolbar — i.e. unlock AND
  // lock/save a template WITHOUT opening the settings sidebar.
  let toolbarTemplateInstanceId = null;
  {
    let cur = selectedBlock;
    while (cur) {
      const pi = blockPathMap?.[cur];
      if (!pi) break;
      if (pi.isTemplateInstance && !pi.isNestedTemplateInstance) toolbarTemplateInstanceId = cur;
      cur = pi.parentId;
    }
  }
  const toolbarTemplateId = toolbarTemplateInstanceId
    ? blockPathMap?.[toolbarTemplateInstanceId]?.templateId
    : null;
  const canEditToolbarTemplate =
    templatePermissions?.[toolbarTemplateId]?.can_edit ?? true;
  const isEditingToolbarTemplate = (templateEditMode || []).includes(
    toolbarTemplateInstanceId,
  );

  // Determine if we should show format buttons based on field type
  // Also hide for readonly blocks (e.g., fixed template blocks, or blocks outside template in edit mode)
  const blockType = block?.['@type'];
  const blockTypeFields = blockFieldTypes?.[blockType] || {};
  const fieldType = blockTypeFields[fieldName];
  const blockIsReadonly = isBlockReadonly(block, templateEditMode);
  // Text-format controls (bold/italic/link/… and the block-format dropdown) only
  // apply while a text field is actually focused. focusedFieldName is null in block
  // mode (block selected, no cursor) — the same signal the selection outline uses
  // (View.jsx isTextMode). Gate on it so the format buttons don't appear on a block
  // that isn't being text-edited (e.g. the first tap on a coarse-pointer device).
  const isTextMode = !!blockUI?.focusedFieldName;
  const showFormatButtons =
    isTextMode && isSlateFieldType(fieldType) && !blockIsReadonly && !isMultiSelected;

  // CRITICAL: Only show Slate if we actually have a valid field value array
  const hasValidSlateValue = fieldValue && Array.isArray(fieldValue) && fieldValue.length > 0;

  // For controlled mode, we need the current value from form data
  // Always provide a valid array to avoid Slate errors
  // IMPORTANT: Use internalValueRef if available (means we just applied formatting)
  // This prevents the editor from resetting to old value when it remounts with new renderKey
  const currentValue = internalValueRef.current
    ? internalValueRef.current
    : hasValidSlateValue
    ? fieldValue
    : [{type: 'p', children: [{text: ''}]}];

  // DEBUG: Check what the bold button SHOULD see during render
  const _debugStrongActive = isBlockActive(editor, 'strong');
  const _debugHasStrong = editor.children?.[0]?.children?.some(c => c.type === 'strong');
  const _debugSelPath = editor.selection?.anchor?.path;
  if (_debugHasStrong) {
    log('RENDER: isBlockActive(strong):', _debugStrongActive, 'hasStrong:', _debugHasStrong, 'editorSel:', JSON.stringify(_debugSelPath), 'propSel:', JSON.stringify(currentSelection?.anchor?.path), 'children:', editor.children?.[0]?.children?.length, 'selSameRef:', currentSelection === editor.selection);
  }

  // DEBUG: Log first li keys during render to trace when corruption happens
  if (currentValue?.[0]?.children?.[0]) {
    const firstChild = currentValue[0].children[0];
  }

  // Calculate toolbar position - add iframe offset and position above the BLOCK CONTAINER
  // NOTE: blockUI.rect comes from BLOCK_SELECTED message and is the block container rect, NOT field rect
  const toolbarIframeRect = iframeElement?.getBoundingClientRect() || { top: 0, left: 0, width: 800, height: 600 };

  // Check if block is visible in the iframe viewport
  const blockTopInPage = toolbarIframeRect.top + blockUI.rect.top;
  const blockBottomInPage = blockTopInPage + blockUI.rect.height;
  const iframeBottom = toolbarIframeRect.top + toolbarIframeRect.height;
  const isBlockVisible = blockBottomInPage > toolbarIframeRect.top && blockTopInPage < iframeBottom;

  // Use shared calculation (same as iframe drag handle in hydra.js)
  // Stand-in passed through so the toolbar clears a field that represents the
  // block from somewhere else (a tab's label). The rule itself lives in
  // calculateDragHandlePosition, shared with the iframe's drag handle — they
  // are asserted to stay aligned.
  const { top: toolbarTop, left: toolbarLeft } = calculateDragHandlePosition(
    blockUI.rect,
    { top: toolbarIframeRect.top, left: toolbarIframeRect.left },
    blockUI.standInRect,
  );

  // Update hydraData with toolbar position for LinkEditor positioning
  // This must be set SYNCHRONOUSLY during render (not in an effect) because
  // persistentHelpers (like LinkEditor) render after this and need the data
  editor.hydra = {
    iframeRect: { top: toolbarIframeRect.top, left: toolbarIframeRect.left },
    blockUIRect: blockUI?.rect,
    toolbarTop,
    toolbarLeft,
  };
  if (typeof window !== 'undefined') {
    window.voltoHydraData = editor.hydra;
  }

  // Calculate max width so toolbar doesn't extend past iframe right edge (sidebar boundary)
  const iframeRight = toolbarIframeRect.left + toolbarIframeRect.width;
  const availableWidth = Math.max(100, iframeRight - toolbarLeft); // Min 100px for basic controls
  const constrainedMaxWidth = Math.min(maxToolbarWidth || 400, availableWidth);

  // Calculate how many buttons fit based on constrained width.
  // The toolbar reserves fixed-width affordances at both ends:
  //   - Desktop: drag handle (30) + menu/⋯ button (30) + gaps (10) = 70
  //   - Mobile  (@media max-width:767px): mobile-tablet.css HIDES the drag
  //     handle and SHOWS chevron-up/down (~64). And step-up-btn
  //     (~32) is rendered when any block is selected. Plus menu/⋯ (30) +
  //     gaps (10) = 136.
  // If we use the desktop number on mobile, the slot system thinks more
  // buttons fit than actually do → inline format buttons spill past the
  // toolbar's max-width → `overflow: hidden` clips the rightmost ones,
  // which is the user-reported "icons clipping at the top of the bar"
  // on phones. Detect coarse-pointer / phone-width and bump FIXED_WIDTH
  // so the slot system shifts inline buttons into the overflow ⋯ menu
  // before they fall off the visible canvas.
  const BUTTON_WIDTH = 32;
  const FORMAT_DROPDOWN_WIDTH = 50;
  const isPhoneViewport =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(max-width: 767px)').matches;
  const FIXED_WIDTH = isPhoneViewport ? 136 : 70;
  const availableForButtons = constrainedMaxWidth - FIXED_WIDTH;

  // Format dropdown counts as ~1.5 buttons worth of space
  const hasFormatDropdown = blockButtons.length > 0;
  const formatDropdownSlots = hasFormatDropdown ? Math.ceil(FORMAT_DROPDOWN_WIDTH / BUTTON_WIDTH) : 0;
  const availableSlots = Math.max(0, Math.floor(availableForButtons / BUTTON_WIDTH));

  // Block action buttons (e.g., add row/column for tables) also need slots
  const blockActionToolbarItems = blockActions?.toolbar || [];

  // Reveal empty optional fields on the selected block (#296). Hydra owns the
  // revealed set — it's ephemeral edit state that must never reach the admin's
  // formData, so the admin only sends the intent and reads the result back off
  // BLOCK_SELECTED (blockUI.revealableFields / blockUI.revealed).
  // NOT a hook: this sits below the component's early returns, so a useCallback
  // here would change hook order between renders ("Rendered more hooks than
  // during the previous render"). It needs no memoisation anyway.
  const toggleOptionalFields = (blockUid) => {
    const iframe = document.getElementById('previewIframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'TOGGLE_OPTIONAL_FIELDS', blockUid },
        '*',
      );
    }
  };

  // Slate buttons come first in toolbar, so they get priority for slots
  // Calculate slots for Slate (format dropdown + inline buttons) first
  const slotsAfterFormatDropdown = Math.max(0, availableSlots - formatDropdownSlots);
  const slotsForInlineButtons = Math.min(allInlineButtons.length, slotsAfterFormatDropdown);
  const slotsUsedBySlate = formatDropdownSlots + slotsForInlineButtons;

  // Block actions get remaining slots after Slate buttons
  const slotsForBlockActions = Math.max(0, availableSlots - slotsUsedBySlate);
  const visibleBlockActions = blockActionToolbarItems.slice(0, slotsForBlockActions);
  const overflowBlockActions = blockActionToolbarItems.slice(slotsForBlockActions);

  // Show format dropdown only if there's room for it plus at least 1 inline button
  const showFormatDropdown = hasFormatDropdown && availableSlots >= formatDropdownSlots + 1;

  const visibleButtons = allInlineButtons.slice(0, slotsForInlineButtons);
  const overflowButtons = allInlineButtons.slice(slotsForInlineButtons);




  return (
    <>
      <div
        className="quanta-toolbar"
        data-multi-select={isMultiSelected ? 'true' : undefined}
        style={{
          position: 'fixed',
          top: `${toolbarTop}px`,
          left: `${toolbarLeft}px`,
          maxWidth: `${constrainedMaxWidth}px`,
          zIndex: 10,
          display: isBlockVisible ? 'flex' : 'none',
          opacity: isFaded ? 0 : 1,
          transition: 'opacity 0.3s',
          gap: '2px',
          background: '#fff',
          border: '1px solid #e0e0e0',
          borderRadius: '3px',
          padding: '2px',
          // Quanta floats ABOVE the frontend's own content, so it needs enough
          // elevation to read as a separate layer. At 0.08/3px it blended into
          // whatever was behind it and the bar looked pasted onto the page.
          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.15)',
          pointerEvents: 'none', // Allow events to pass through to iframe drag button
          overflow: 'hidden', // Ensure buttons don't extend past maxWidth
        }}
      >
      {/* Mobile-only chevron move buttons. Hidden on desktop/tablet via
       * .quanta-toolbar .chevron-buttons { display: none } in
       * mobile-tablet.css. Within-parent move only. */}
      {(() => {
        if (!selectedBlock || selectedBlock === PAGE_BLOCK_UID) return null;
        const block = getBlock(selectedBlock);
        if (isBlockPositionLocked(block, templateEditMode)) return null;
        return (
          <div className="chevron-buttons">
            <button
              type="button"
              className="chevron-up"
              aria-label="Move block up"
              disabled={isAtTopOfParent}
              onClick={() => moveSelectedBlock('up')}
            >▲</button>
            <button
              type="button"
              className="chevron-down"
              aria-label="Move block down"
              disabled={isAtBottomOfParent}
              onClick={() => moveSelectedBlock('down')}
            >▼</button>
          </div>
        );
      })()}

      {/* Drag handle + template lock/unlock toggle — only for blocks, not page fields.
          A template block the user can edit shows a lock/unlock toggle in a CONSISTENT
          spot next to the drag handle: 🔒 to enter template edit (unlock), 🔓 to lock &
          save. While editing the block is movable, so the drag handle sits beside it —
          same location for both lock and unlock. Clicking raises the unlock-warning /
          lock-decision modal, so a template can be saved WITHOUT opening the sidebar. */}
      {(() => {
        if (!selectedBlock || selectedBlock === PAGE_BLOCK_UID) {
          return <div style={{ width: '8px' }} />; // Spacer for page-level fields
        }
        const block = getBlock(selectedBlock);
        const instanceId = toolbarTemplateInstanceId;

        const dragHandle = (
          <div
            className="drag-handle"
            style={{
              cursor: 'move',
              padding: '4px 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              color: '#666',
              fontSize: '14px',
              background: '#e8e8e8',
              borderRadius: '2px',
            }}
          >
            ⠿
          </div>
        );

        // The lock/unlock toggle shows for the template's fixed "chrome" (🔒, tap to
        // edit) and for ANY block while its template is unlocked (🔓, tap to lock &
        // save). Editable slot content in a LOCKED template is just normal movable
        // content — it keeps the drag handle (below), no toggle.
        const isPositionLocked = isBlockPositionLocked(block, templateEditMode);
        const canToggleTemplate =
          !!instanceId && !!onToggleTemplateEditMode && canEditToolbarTemplate;
        if (canToggleTemplate && (isPositionLocked || isEditingToolbarTemplate)) {
          const editing = isEditingToolbarTemplate;
          // The ONE shared template lock/unlock control (same component the sidebar
          // renders) — a whole-template action.
          const toggle = (
            <TemplateLockToggle
              instanceId={instanceId}
              editing={editing}
              canEdit={canEditToolbarTemplate}
              onToggle={onToggleTemplateEditMode}
              variant="toolbar"
            />
          );
          // While editing the block is movable — the drag handle keeps its canonical
          // (leftmost) position so DnD alignment is unaffected; the toggle sits to its
          // right, next to it.
          return editing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              {dragHandle}
              {toggle}
            </div>
          ) : (
            toggle
          );
        }

        // Fixed template block the user CANNOT toggle (no Modify permission) → static lock.
        if (isPositionLocked) {
          return (
            <div
              className="lock-icon"
              title={
                instanceId && !canEditToolbarTemplate
                  ? 'You don’t have permission to edit this template'
                  : 'This block is part of a template and cannot be moved'
              }
              style={{
                padding: '4px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                color: '#999',
                fontSize: '14px',
                background: '#f5f5f5',
                borderRadius: '2px',
              }}
            >
              <Icon name={lockSVG} size="16px" color="#999" />
            </div>
          );
        }
        return dragHandle;
      })()}

      {/* Reveal empty optional fields (#296). Rendered only when the selected block
          actually has some — a fully populated block shows no control. pointerEvents
          must be re-enabled: the toolbar itself sets 'none' so drag events reach the
          iframe's invisible drag button underneath. */}
      {selectedBlock && selectedBlock !== PAGE_BLOCK_UID &&
        !isBlockReadonly(getBlock(selectedBlock), templateEditMode) && (
          <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center' }}>
            <OptionalFieldsToggle
              blockUid={selectedBlock}
              revealableFields={blockUI?.revealableFields}
              revealed={blockUI?.revealed}
              onToggle={toggleOptionalFields}
            />
          </div>
        )}

      {/* Real Slate buttons - only show if we have a valid slate field value */}
      {/* IMPORTANT: Wrap in div with pointerEvents: 'auto' to make buttons clickable
          while parent toolbar has pointerEvents: 'none' for drag-and-drop passthrough */}
      {/* Wrapped with Redux Provider for buttons that dispatch Redux actions (like Link button) */}
      {showFormatButtons && hasValidSlateValue && (
        <div
          style={{ pointerEvents: 'auto', display: 'flex', gap: '1px', alignItems: 'center' }}
          onMouseDownCapture={handleButtonMouseDownCapture}
          onClickCapture={handleButtonClickCapture}
        >
            <SlateErrorBoundary>
              <Slate
                editor={editor}
                initialValue={currentValue}
                onChange={handleChange}
              >
                <DebugSlateChild />
                <>
                  {/* Format dropdown for block-level buttons - only show if room */}
                  {showFormatDropdown && (
                    <FormatDropdown
                      blockButtons={blockButtons}
                      onMouseDownCapture={handleButtonMouseDownCapture}
                      onClickCapture={handleButtonClickCapture}
                    />
                  )}
                  {/* Visible inline format buttons */}
                  {visibleButtons.map(({ name, element }, i) => (
                    <span key={`${name}-${i}`} data-toolbar-button={name}>
                      {element}
                    </span>
                  ))}
                </>

              {/* Render persistent helpers (like LinkEditor) - they use editor.hydra for positioning */}
              {persistentHelpers.map((Helper, idx) => (
                <Helper key={idx} editor={editor} />
              ))}
              </Slate>
            </SlateErrorBoundary>
          </div>
      )}

      {/* Field-specific buttons for linkable/media fields */}
      {/* Skip for readonly blocks */}
      {(blockUI?.focusedLinkableField || blockUI?.focusedMediaField) && !isBlockReadonly(getBlock(selectedBlock), templateEditMode) && (
        <div style={{ pointerEvents: 'auto', display: 'flex', gap: '1px', alignItems: 'center', position: 'relative' }}>
          {blockUI?.focusedLinkableField && (
            <button
              title={`Edit link (${blockUI.focusedLinkableField})`}
              onClick={() => {
                setFieldLinkEditorField(blockUI.focusedLinkableField);
                setFieldLinkEditorOpen(true);
              }}
              style={{
                background: fieldLinkEditorOpen ? '#e8e8e8' : 'none',
                border: 'none',
                padding: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '2px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#e8e8e8')}
              onMouseLeave={(e) => (e.currentTarget.style.background = fieldLinkEditorOpen ? '#e8e8e8' : 'none')}
            >
              <Icon name={linkSVG} size="18px" />
            </button>
          )}
          {blockUI?.focusedMediaField && (
            <button
              title={`Select image (${blockUI.focusedMediaField})`}
              onClick={() => {
                setFieldImageEditorField(blockUI.focusedMediaField);
                setFieldImageEditorOpen(true);
              }}
              style={{
                background: fieldImageEditorOpen ? '#e8e8e8' : 'none',
                border: 'none',
                padding: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '2px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#e8e8e8')}
              onMouseLeave={(e) => (e.currentTarget.style.background = fieldImageEditorOpen ? '#e8e8e8' : 'none')}
            >
              <Icon name={imageSVG} size="18px" />
            </button>
          )}

        </div>
      )}

      {/* Block action buttons (e.g., add row/column for tables) - only visible ones */}
      {visibleBlockActions.length > 0 && onBlockAction && (() => {
        const actionsRegistry = config.settings.hydraActions || {};
        return (
          <div style={{ pointerEvents: 'auto', display: 'flex', gap: '1px', alignItems: 'center' }}>
            {visibleBlockActions.map((actionId) => {
              const actionDef = actionsRegistry[actionId] || { label: actionId };
              return (
                <button
                  key={actionId}
                  title={actionDef.label}
                  onClick={() => onBlockAction(actionId)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '2px',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#e8e8e8')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  {actionDef.icon ? (
                    <Icon name={actionDef.icon} size="18px" />
                  ) : (
                    actionDef.label
                  )}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Step-up button — mobile equivalent of the Escape key.
       * The state machine (text → block → parent → deselect) lives in
       * hydra.js's stepUpSelection() method. The button simply posts a
       * STEP_UP message to the iframe; the SAME code path runs whether
       * the editor pressed Escape (desktop) or tapped this button
       * (mobile). Zero duplicated logic.
       *
       * Visible whenever ANY block is selected (including top-level)
       * so a touch editor always has a way back. */}
      {selectedBlock && (
        <button
          type="button"
          className="step-up-btn"
          aria-label="Step up (exit text / select parent / deselect)"
          title="Step up"
          onClick={() => {
            const iframe = document.getElementById('previewIframe');
            if (iframe?.contentWindow) {
              iframe.contentWindow.postMessage({ type: 'STEP_UP' }, '*');
            }
          }}
          style={{
            background: '#fff',
            border: 'none',
            padding: '4px 6px',
            cursor: 'pointer',
            color: '#222',
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon name={upSVG} size="20px" color="#222" />
        </button>
      )}

      {/* Three-dots menu button */}
      <button
        className="volto-hydra-menu-trigger"
        style={{
          background: menuOpen ? '#e8e8e8' : '#fff',
          border: 'none',
          padding: '4px 6px',
          cursor: 'pointer',
          fontSize: '14px',
          color: '#999',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0, // Don't shrink - always visible
        }}
        title="More options"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setMenuButtonRect(rect);
          setMenuOpen(!menuOpen);
        }}
      >
        ⋯
      </button>
    </div>

    {/* Dropdown menu with overflow buttons and actions */}
    {menuOpen && (
      <DropdownMenu
        selectedBlock={selectedBlock}
        onDeleteBlock={onDeleteBlock}
        menuButtonRect={menuButtonRect}
        onClose={() => setMenuOpen(false)}
        onOpenSettings={() => {
          // Expand sidebar if collapsed
          const sidebarContainer = document.querySelector('.sidebar-container');
          if (sidebarContainer?.classList.contains('collapsed')) {
            const triggerButton = sidebarContainer.querySelector('.trigger');
            triggerButton?.click();
          }
        }}
        overflowButtons={overflowButtons}
        showFormatDropdown={!showFormatDropdown}
        blockButtons={blockButtons}
        editor={editor}
        onChange={handleChange}
        onMouseDownCapture={handleButtonMouseDownCapture}
        onClickCapture={handleButtonClickCapture}
        tableActions={blockActions}
        overflowBlockActions={overflowBlockActions}
        onTableAction={onBlockAction}
        addMode={blockPathMap?.[selectedBlock]?.addMode}
        parentAddMode={blockPathMap?.[selectedBlock]?.parentAddMode}
        addDirection={blockUI?.addDirection}
        convertibleTypes={convertibleTypes}
        onConvertBlock={onConvertBlock}
        onOpenConvertChooser={onOpenConvertChooser}
        canWrap={canWrap}
        onOpenWrapChooser={onOpenWrapChooser}
        canUnwrap={canUnwrap}
        onUnwrap={onUnwrap}
        // `fixed` means "not yours to remove from THIS page" — the point of a
        // template's chrome. It is not meant to survive unlocking: once the
        // author has taken the template into edit mode, they are editing the
        // template itself, and a member they can retype but never delete is a
        // dead end (the site announcement's alert could be reworded forever and
        // never taken out).
        isFixed={
          !!blockPathMap?.[selectedBlock]?.isFixed && !isEditingToolbarTemplate
        }
        isInTemplate={!!block?.templateId}
        onMakeTemplate={onMakeTemplate}
        // Template edit/lock straight from the toolbar ⋯ menu (no sidebar needed):
        // "Edit template" when locked, "Save template" (→ lock/save decision)
        // while editing. Gated on Modify permission.
        isTemplateInstance={!!toolbarTemplateInstanceId && canEditToolbarTemplate && !!onToggleTemplateEditMode}
        isEditingTemplate={isEditingToolbarTemplate}
        onToggleTemplateEdit={
          toolbarTemplateInstanceId && onToggleTemplateEditMode
            ? () => onToggleTemplateEditMode(toolbarTemplateInstanceId)
            : null
        }
        multiSelectedUids={isMultiSelected ? blockUI.multiSelectedUids : null}
        hasClipboard={!!(blocksClipboard?.cut || blocksClipboard?.copy)}
        pasteAllowed={pasteAllowed}
      />
    )}

    {/* Field Link Editor Popup - fixed position at toolbar */}
    {fieldLinkEditorOpen && fieldLinkEditorField && (() => {
      // The block's schema lives in pathMap._schemas (deduped by ref), not on the
      // entry as `.schema` — resolve it, or fieldDef is always undefined and
      // isObjectBrowserLink is always false (so the object-browser pick's metadata
      // is dropped and the linked title never fills).
      const blockSchema = getResolvedSchema(blockPathMap?.[selectedBlock], blockPathMap);
      const fieldDef = getFieldDef(blockSchema, fieldLinkEditorField);
      const isObjectBrowserLink = fieldDef?.widget === 'object_browser' && fieldDef?.mode === 'link';
      return (
        <div
          className="add-link field-link-editor"
          style={{
            position: 'fixed',
            top: `${toolbarTop}px`,
            left: `${toolbarLeft}px`,
            zIndex: 100,
            width: '300px',
          }}
        >
          <AddLinkForm
            data={{ url: getFieldValue(getBlock(selectedBlock), fieldLinkEditorField) || '' }}
            theme={{}}
            onChangeValue={(url) => {
              if (onFieldLinkChange) {
                onFieldLinkChange(fieldLinkEditorField, url);
              }
              setFieldLinkEditorOpen(false);
              setFieldLinkEditorField(null);
            }}
            onSelectItem={isObjectBrowserLink ? (url, item) => {
              if (onFieldLinkChange) {
                // Store the FULL picked-item metadata (the object browser fetches
                // metadata_fields:'_all', so `item` carries image_scales/image_field,
                // description, Subject, dates, …). Copy-from-target pulls every mapped
                // field from this snapshot — dropping keys here is exactly what forced
                // a redundant live @search before.
                const linkValue = [{ ...item, '@id': item?.['@id'] || url }];
                onFieldLinkChange(fieldLinkEditorField, linkValue);
              }
              setFieldLinkEditorOpen(false);
              setFieldLinkEditorField(null);
            } : undefined}
            onClear={() => {
              if (onFieldLinkChange) {
                onFieldLinkChange(fieldLinkEditorField, '');
              }
              setFieldLinkEditorOpen(false);
              setFieldLinkEditorField(null);
            }}
            onOverrideContent={() => {
              setFieldLinkEditorOpen(false);
              setFieldLinkEditorField(null);
            }}
          />
        </div>
      );
    })()}

    {/* Media Field Overlays - show when block is selected, for each media field */}
    {/* Skip for readonly blocks - they shouldn't show media editing UI */}
    {blockUI?.mediaFields && !isBlockReadonly(getBlock(selectedBlock), templateEditMode) && Object.entries(blockUI.mediaFields).map(([fieldName, fieldData]) => {
      const mediaValue = getFieldValue(getBlock(selectedBlock), fieldName);
      const hasMediaValue = mediaValue && (
        (Array.isArray(mediaValue) && mediaValue.length > 0) ||
        (typeof mediaValue === 'string' && mediaValue !== '')
      );

      // Get the media field element's rect from the message data
      const mediaRect = fieldData?.rect;
      if (!mediaRect) return null;

      log(' Media field overlay:', fieldName, 'hasMediaValue:', hasMediaValue, 'mediaRect:', mediaRect, 'toolbarIframeRect:', toolbarIframeRect);

      const fieldCenterX = toolbarIframeRect.left + mediaRect.left + mediaRect.width / 2;
      const fieldCenterY = toolbarIframeRect.top + mediaRect.top + mediaRect.height / 2;
      const fieldBottomY = toolbarIframeRect.top + mediaRect.top + mediaRect.height;
      const fieldRightX = toolbarIframeRect.left + mediaRect.left + mediaRect.width - 36;
      const fieldTopY = toolbarIframeRect.top + mediaRect.top + 8;
      const fieldLeftX = toolbarIframeRect.left + mediaRect.left;

      // Show ImageInput overlay if: no image, OR image editor is open for this field
      const showImagePicker = !hasMediaValue || (fieldImageEditorOpen && fieldImageEditorField === fieldName);
      // Show icon only when image is empty (not when editing existing image)
      const showIcon = !hasMediaValue;

      if (showImagePicker) {
        // Empty image OR editing existing - use ImageInput with showPreview={false}
        return (
          <div
            key={`empty-${fieldName}`}
            className="empty-image-overlay"
            style={{
              position: 'fixed',
              top: `${toolbarIframeRect.top + mediaRect.top}px`,
              left: `${toolbarIframeRect.left + mediaRect.left}px`,
              width: `${mediaRect.width}px`,
              height: `${mediaRect.height}px`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: showIcon ? 'center' : 'flex-end',
              paddingBottom: showIcon ? '0' : '20px',
              zIndex: 10,
              pointerEvents: 'none', // Let clicks pass through to elements behind
            }}
          >
            {/* Large circular icon - only show when empty */}
            {showIcon && (
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  background: 'rgba(0, 123, 255, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '12px',
                  pointerEvents: 'auto', // Icon itself captures events
                }}
              >
                <Icon name={imageSVG} size="40px" color="#007bff" />
              </div>
            )}
            <ImageInput
              id={`inline-image-${fieldName}`}
              value={null}
              showPreview={false}
              onChange={(id, url, metadata) => {
                if (onFieldLinkChange) {
                  // Pass url and metadata (image_scales, image_field) for NamedBlobImage fields
                  onFieldLinkChange(fieldName, url, metadata);
                }
                // Close editor if it was open
                if (fieldImageEditorOpen) {
                  setFieldImageEditorOpen(false);
                  setFieldImageEditorField(null);
                }
              }}
              onClose={() => {
                setFieldImageEditorOpen(false);
                setFieldImageEditorField(null);
              }}
            />
          </div>
        );
      } else {
        // Filled image - show X button in top-right corner (no shadow)
        return (
          <button
            key={`clear-${fieldName}`}
            id={`clear-media-${fieldName}`}
            title="Clear image"
            onClick={() => {
              if (onFieldLinkChange) {
                onFieldLinkChange(fieldName, '');
              }
            }}
            style={{
              position: 'fixed',
              top: `${fieldTopY}px`,
              left: `${fieldRightX}px`,
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.9)',
              border: 'none',
              borderRadius: '50%',
              cursor: 'pointer',
              zIndex: 10,
              padding: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.9)';
            }}
          >
            <Icon name={clearSVG} size="16px" color="#e40166" />
          </button>
        );
      }
    })}

    {/* Starter UI Overlay - for blocks with empty required fields */}
    {blockPathMap?.[selectedBlock]?.emptyRequiredFields?.map(({ fieldName, fieldDef }) => {
      // For now, only render for object_browser link fields
      if (fieldDef?.widget !== 'object_browser' || fieldDef?.mode !== 'link') {
        return null;
      }

      // Center horizontally on the block
      const centerX = toolbarIframeRect.left + blockUI.rect.left + blockUI.rect.width / 2;
      const centerY = toolbarIframeRect.top + blockUI.rect.top + blockUI.rect.height / 2;

      return (
        <div
          key={`starter-${fieldName}`}
          className="starter-ui-overlay"
          style={{
            position: 'fixed',
            top: `${centerY - 20}px`,
            left: `${centerX}px`,
            transform: 'translateX(-50%)',
            zIndex: 100,
          }}
        >
          <AddLinkForm
            data={{ url: '' }}
            theme={{}}
            objectBrowserPickerType="link"
            onChangeValue={(url) => {
              if (onFieldLinkChange && url) {
                // For object_browser link fields, convert URL to array format
                const linkValue = [{ '@id': url }];
                onFieldLinkChange(fieldName, linkValue);
              }
            }}
            onSelectItem={(url, item) => {
              if (onFieldLinkChange && url) {
                // Use full item metadata from object browser for richer teaser display
                const linkValue = [{
                  '@id': item?.['@id'] || url,
                  title: item?.title || item?.Title || '',
                  description: item?.description || item?.Description || '',
                  hasPreviewImage: item?.hasPreviewImage ?? false,
                }];
                onFieldLinkChange(fieldName, linkValue);
              }
            }}
            onClear={() => {}}
            onOverrideContent={() => {}}
          />
        </div>
      );
    })}
    </>
  );
};

export default SyncedSlateToolbar;
