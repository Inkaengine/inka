import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import SlateButtonsWrapper from './SlateButtonsWrapper';
import FormatDropdown from './FormatDropdown';
import config from '@plone/volto/registry';
import { Icon } from '@plone/volto/components';
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import showSVG from '@plone/volto/icons/show.svg';
import hideSVG from '@plone/volto/icons/hide.svg';
import { revealFieldsLabel } from './OptionalFieldsToggle';

/**
 * Dropdown Menu for Block Actions
 *
 * Renders a dropdown menu with:
 * - Overflow buttons (formatting buttons that don't fit in toolbar)
 * - Table actions (add row/column before, delete row/column) when in table mode
 * - Settings and Remove options
 * Uses React portal to avoid container clipping issues.
 *
 * Overflow buttons are wrapped in a Slate context using the passed editor
 * so that useSlate() works for the button components.
 */
const DropdownMenu = ({
  selectedBlock,
  onDeleteBlock,
  menuButtonRect,
  onClose,
  onOpenSettings,
  overflowButtons = [], // Array of { name, element } for buttons that overflow
  showFormatDropdown = false, // Whether to show FormatDropdown in overflow
  blockButtons = [], // Block buttons for FormatDropdown
  editor, // Slate editor for overflow buttons context
  onChange, // Change handler for overflow buttons to propagate changes
  onMouseDownCapture, // Capture handler for flushing buffer before format
  onClickCapture, // Capture handler to block click when mousedown was intercepted
  tableActions = null, // { toolbar: [...], dropdown: [...] } for table operations
  overflowBlockActions = [], // Block actions that overflow from toolbar
  onTableAction, // Handler for table actions: (action) => void
  addMode, // 'table' if this is a row in a table
  parentAddMode, // 'table' if this is a cell in a table row
  addDirection, // 'right' or 'bottom' - determines Column vs Row terminology
  convertibleTypes = [], // Array of { type, title } for block type conversion
  onConvertBlock, // Handler for block conversion: (newType) => void
  onOpenConvertChooser, // Handler to open BlockChooser for convert: () => void
  canWrap = false, // True when there's a multi-selection that can be wrapped
  onOpenWrapChooser, // Handler to open BlockChooser for wrap: () => void
  canUnwrap = false, // True when selected block is a container whose children can live in the parent
  onUnwrap, // Handler for unwrap: () => void
  isFixed = false, // Template blocks that can't be moved/deleted
  isInTemplate = false, // Whether block is already part of a template
  onMakeTemplate, // Handler for "Make Template" action
  isTemplateInstance = false, // This block is a top-level template instance (host)
  isEditingTemplate = false, // Currently editing this template
  onToggleTemplateEdit = null, // Toggle template edit mode for this instance: () => void
  multiSelectedUids, // Array of multi-selected block UIDs (for copy/cut/delete)
  hasClipboard = false, // Whether blocksClipboard has content to paste
  pasteAllowed = true, // Whether clipboard types are allowed in target container
  revealableFields = [], // Empty fields marked optionalOnCanvas, which "Show empty fields" reveals
  revealed = false, // Whether they are showing
  onToggleReveal, // Show/hide them: () => void
}) => {
  const menuRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [onClose]);

  // After rendering, check if dropdown overflows viewport and flip upward if needed
  useEffect(() => {
    if (!menuRef.current || !menuButtonRect) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      // Flip: position above the trigger button instead of below
      menuRef.current.style.top = `${menuButtonRect.top - rect.height - 4}px`;
    }
  }, [menuButtonRect]);

  if (!menuButtonRect) {
    return null;
  }

  const handleSettings = () => {
    onClose();
    // Open/expand the sidebar if collapsed
    if (onOpenSettings) {
      onOpenSettings();
    }
  };


  const handleRemove = () => {
    onClose();
    if (selectedBlock) {
      onDeleteBlock(selectedBlock, true);
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="volto-hydra-dropdown-menu"
      style={{
        position: 'fixed',
        left: `${menuButtonRect.right - 180}px`, // Align right edge with button
        top: `${menuButtonRect.bottom + 4}px`,
        background: 'white',
        border: '1px solid #ccc',
        borderRadius: '4px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
        zIndex: 10000,
        width: '180px',
        pointerEvents: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Overflow buttons row - Slate formatting buttons followed by block actions */}
      {((overflowButtons.length > 0 || showFormatDropdown) && editor) || overflowBlockActions.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '2px',
            padding: '8px',
            borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          {/* Slate formatting buttons */}
          {(overflowButtons.length > 0 || showFormatDropdown) && editor && (
            <SlateButtonsWrapper
              editor={editor}
              initialValue={editor.children}
              onChange={onChange}
              onMouseDownCapture={onMouseDownCapture}
              onClickCapture={onClickCapture}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '2px',
              }}
            >
              {/* FormatDropdown when it doesn't fit in toolbar */}
              {showFormatDropdown && blockButtons.length > 0 && (
                <FormatDropdown
                  blockButtons={blockButtons}
                  onMouseDownCapture={onMouseDownCapture}
                  onClickCapture={onClickCapture}
                />
              )}
              {overflowButtons.map(({ name, element }) => (
                <div
                  key={name}
                  data-toolbar-button={name}
                  style={{ display: 'inline-flex' }}
                >
                  {element}
                </div>
              ))}
            </SlateButtonsWrapper>
          )}
          {/* Overflow block actions (e.g., add row/column buttons that didn't fit) */}
          {overflowBlockActions.length > 0 && onTableAction && (() => {
            const actionsRegistry = config.settings.hydraActions || {};
            return overflowBlockActions.map((actionId) => {
              const actionDef = actionsRegistry[actionId] || { label: actionId };
              return (
                <button
                  key={actionId}
                  title={actionDef.label}
                  onClick={() => {
                    onClose();
                    onTableAction(actionId);
                  }}
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
            });
          })()}
        </div>
      ) : null}
      {/* Block actions from pathMap (e.g., table row/column operations) */}
      {tableActions?.dropdown?.length > 0 && onTableAction && (() => {
        const actionsRegistry = config.settings.hydraActions || {};
        return (
          <>
            {tableActions.dropdown.map((actionId) => {
              const actionDef = actionsRegistry[actionId] || { label: actionId };
              return (
                <div
                  key={actionId}
                  className="volto-hydra-dropdown-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px',
                    cursor: 'pointer',
                    fontSize: '15px',
                    fontWeight: '500',
                  }}
                  onMouseEnter={(e) => (e.target.style.background = '#f0f0f0')}
                  onMouseLeave={(e) => (e.target.style.background = 'transparent')}
                  onClick={() => {
                    onClose();
                    onTableAction(actionId);
                  }}
                >
                  {actionDef.icon && <Icon name={actionDef.icon} size="20px" />}
                  {actionDef.label}
                </div>
              );
            })}
            <div
              style={{
                height: '1px',
                background: 'rgba(0, 0, 0, 0.1)',
                margin: '0 10px',
              }}
            />
          </>
        );
      })()}
      {/* Settings option - only shown when onOpenSettings is provided (toolbar usage) */}
      {onOpenSettings && (
        <>
          <div
            className="volto-hydra-dropdown-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: '500',
            }}
            onMouseEnter={(e) => (e.target.style.background = '#f0f0f0')}
            onMouseLeave={(e) => (e.target.style.background = 'transparent')}
            onClick={handleSettings}
          >
            ⚙️ Settings
          </div>
          <div
            style={{
              height: '1px',
              background: 'rgba(0, 0, 0, 0.1)',
              margin: '0 10px',
            }}
          />
        </>
      )}
      {/* Edit template / Save template — labelled entry into (and out of) template
          edit mode for a top-level template instance. Complements the lock/unlock
          icon on the header bar and the in-canvas Quanta toolbar lock. */}
      {onToggleTemplateEdit && isTemplateInstance && (
        <>
          <div
            className="volto-hydra-dropdown-item edit-template-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: '500',
            }}
            onMouseEnter={(e) => (e.target.style.background = '#f0f0f0')}
            onMouseLeave={(e) => (e.target.style.background = 'transparent')}
            onClick={() => {
              onClose();
              onToggleTemplateEdit();
            }}
          >
            {isEditingTemplate ? 'Save template' : 'Edit template'}
          </div>
          <div
            style={{
              height: '1px',
              background: 'rgba(0, 0, 0, 0.1)',
              margin: '0 10px',
            }}
          />
        </>
      )}
      {/* Make Template — only for blocks not already in a template (and not fixed).
          A template can't be re-templated: making a template out of content that
          already carries a templateId would nest a FOREIGN template inside the new
          one, which the merge flattens on re-instancing (a known limitation). So
          the option is intentionally hidden for template content rather than
          producing a template with dangling foreign references. To fork a template,
          edit it in place instead. */}
      {onMakeTemplate && !isInTemplate && !isFixed && (
        <>
          <div
            className="volto-hydra-dropdown-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: '500',
            }}
            onMouseEnter={(e) => (e.target.style.background = '#f0f0f0')}
            onMouseLeave={(e) => (e.target.style.background = 'transparent')}
            onClick={() => {
              onClose();
              onMakeTemplate();
            }}
          >
            📋 Make Template
          </div>
          <div
            style={{
              height: '1px',
              background: 'rgba(0, 0, 0, 0.1)',
              margin: '0 10px',
            }}
          />
        </>
      )}
      {/* Wrap selected blocks in a container — opens BlockChooser overlay
          filtered to compatible container types. Visible during multi-select. */}
      {onOpenWrapChooser && canWrap && (
        <>
          <button
            data-testid="wrap-selected"
            className="volto-hydra-dropdown-item wrap-container"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onOpenWrapChooser();
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: '500',
            }}
          >
            🎁 Wrap in container…
          </button>
          <div style={{ height: '1px', background: 'rgba(0, 0, 0, 0.1)', margin: '0 10px' }} />
        </>
      )}
      {/* Unwrap — promotes children to the parent. Renders for containers when
          the parent accepts the children; disabled state shown when it doesn't
          accept (still rendered so users can see the action exists). */}
      {onUnwrap && (
        <>
          <button
            data-testid="unwrap-container"
            disabled={!canUnwrap}
            className="volto-hydra-dropdown-item unwrap-container"
            onClick={(e) => {
              e.stopPropagation();
              if (!canUnwrap) return;
              onClose();
              onUnwrap();
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px',
              background: 'transparent',
              border: 'none',
              cursor: canUnwrap ? 'pointer' : 'not-allowed',
              fontSize: '15px',
              fontWeight: '500',
              color: canUnwrap ? 'inherit' : '#888',
            }}
          >
            ⤴ Unwrap container
          </button>
          <div style={{ height: '1px', background: 'rgba(0, 0, 0, 0.1)', margin: '0 10px' }} />
        </>
      )}
      {/* Convert to — opens BlockChooser overlay filtered to compatible
          target types. Same pattern as Wrap so users get one chooser UI. */}
      {convertibleTypes?.length > 0 && onOpenConvertChooser && (
        <>
          <button
            data-testid="convert-block"
            className="volto-hydra-dropdown-item convert-to-menu"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onOpenConvertChooser();
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: '500',
            }}
          >
            🔄 Convert to…
          </button>
          <div style={{ height: '1px', background: 'rgba(0, 0, 0, 0.1)', margin: '0 10px' }} />
        </>
      )}
      {/* Show / Hide empty fields — the same as the toolbar's eye button, here too
          because the toolbar drops that button first when it runs out of room. */}
      {onToggleReveal && (revealableFields.length > 0 || revealed) && (
        <div
          className="volto-hydra-dropdown-item reveal-fields-item"
          role="button"
          aria-pressed={revealed}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: '500' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          onClick={() => {
            onClose();
            onToggleReveal();
          }}
        >
          <Icon name={revealed ? hideSVG : showSVG} size="18px" />
          {revealFieldsLabel(revealableFields, revealed)}
        </div>
      )}

      {/* Copy / Cut / Paste actions */}
      {selectedBlock && selectedBlock !== PAGE_BLOCK_UID && (
        <>
          <div
            className="volto-hydra-dropdown-item"
            data-action="copy-block"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: '500' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              onClose();
              const uids = multiSelectedUids?.length > 1 ? multiSelectedUids : [selectedBlock];
              document.dispatchEvent(new CustomEvent('hydra-copy-blocks', {
                detail: { blockIds: uids, action: 'copy' },
              }));
            }}
          >
            📋 Copy
          </div>
          <div
            className="volto-hydra-dropdown-item"
            data-action="cut-block"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: '500' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              onClose();
              const uids = multiSelectedUids?.length > 1 ? multiSelectedUids : [selectedBlock];
              document.dispatchEvent(new CustomEvent('hydra-copy-blocks', {
                detail: { blockIds: uids, action: 'cut' },
              }));
              document.dispatchEvent(new CustomEvent('hydra-delete-blocks', {
                detail: { blockIds: uids },
              }));
            }}
          >
            ✂️ Cut
          </div>
          {hasClipboard && pasteAllowed && (
            <div
              className="volto-hydra-dropdown-item"
              data-action="paste-block"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: '500' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => {
                onClose();
                document.dispatchEvent(new CustomEvent('hydra-paste-blocks', {
                  detail: { afterBlockId: selectedBlock, keepClipboard: false },
                }));
              }}
            >
              📌 Paste
            </div>
          )}
          <div style={{ height: '1px', background: 'rgba(0, 0, 0, 0.1)', margin: '0 10px' }} />
        </>
      )}
      {/* Remove action - label changes based on table mode and add direction */}
      {/* Hide remove for page-level fields and fixed template blocks */}
      {selectedBlock && selectedBlock !== PAGE_BLOCK_UID && !isFixed && (() => {
        // Determine remove label and action based on table mode
        // Uses addDirection to determine Column vs Row (same as add button icon)
        const actionsRegistry = config.settings.hydraActions || {};
        // Only use table-specific remove actions at cell level (parentAddMode === 'table')
        // At row level (addMode === 'table'), the normal handleRemove → onDeleteBlock
        // path correctly computes previous sibling selection via getSelectAfterDelete.
        const isTableMode = parentAddMode === 'table';
        const isRightDirection = addDirection === 'right';

        let removeLabel = 'Remove';
        let removeAction = null;
        let removeIcon = null;
        if (isTableMode) {
          removeAction = isRightDirection ? 'deleteColumn' : 'deleteRow';
          const actionDef = actionsRegistry[removeAction] || {};
          removeLabel = actionDef.label || (isRightDirection ? 'Remove Column' : 'Remove Row');
          removeIcon = actionDef.icon;
        }

        return (
          <div
            className="volto-hydra-dropdown-item"
            data-action="delete-block"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: '500',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              onClose();
              if (removeAction && onTableAction) {
                onTableAction(removeAction);
              } else {
                handleRemove();
              }
            }}
          >
            {removeIcon ? <Icon name={removeIcon} size="20px" /> : '🗑️'} {removeLabel}
          </div>
        );
      })()}
      {/* Mobile-only back-arrow at bottom-left corner. Hidden on
       * desktop/tablet via .mobile-sheet-close { display: none } in
       * mobile-tablet.css. */}
      <button
        type="button"
        className="mobile-sheet-close"
        aria-label="Close menu"
        onClick={onClose}
      >
        ←
      </button>
    </div>,
    document.body,
  );
};

export default DropdownMenu;
