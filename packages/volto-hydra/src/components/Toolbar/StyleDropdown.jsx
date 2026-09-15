import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSlate } from 'slate-react';
import { Icon } from '@plone/volto/components';
import config from '@plone/volto/registry';
import paintSVG from '@plone/volto/icons/paint.svg';
import {
  isBlockStyleActive,
  isInlineStyleActive,
  toggleStyle,
} from '@plone/volto-slate/editor/plugins/StyleMenu/utils';
import { isStyleAllowed } from '../../../../hydra-js/slateStyles.js';

/**
 * The design system's own text styles, as a dropdown that escapes the toolbar.
 *
 * volto-slate ships a StyleMenu built on semantic's `Dropdown`, which renders
 * its menu INLINE. That works in Volto's own toolbar and cannot work in this
 * one: the quanta toolbar is a fixed-height bar with `overflow: hidden` (which
 * is what stops buttons spilling past its maxWidth), and the menu opens above
 * the bar — entirely outside its box, so it was clipped away. The menu appeared
 * to open, every item was unclickable, and the iframe underneath took the
 * pointer. Playwright called the items "visible" throughout, because ancestor
 * clipping is not part of that check.
 *
 * So it follows FormatDropdown instead: a portal to the body at z-index 10001,
 * positioned from the trigger. Same reason, same shape — a toolbar built for
 * buttons cannot contain a dropdown.
 */
const StyleDropdown = ({ onMouseDownCapture, onClickCapture, slateRules }) => {
  const editor = useSlate();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const menu = config.settings.slate?.styleMenu || {};
  // A region can say which styles it offers, and a DESIGN SYSTEM's styles are
  // keyed by class with a leading dot (`.nsw-small`) — the shape
  // getSlateVocabulary reports them under, and the one the stored `styleName`
  // is normalized against. Gating here is what makes the declaration mean
  // something to an author: this dropdown is the only surface that applies
  // these styles, so without it the rule held everywhere except where it is
  // used.
  const offered = (defs) =>
    (defs || []).filter((d) => isStyleAllowed(`.${d?.cssClass}`, slateRules));
  const blockStyles = offered(menu.blockStyles);
  const inlineStyles = offered(menu.inlineStyles);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onOutside = (e) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [isOpen]);

  // A frontend that declares no styles gets no button at all, rather than a
  // control that opens an empty list.
  if (blockStyles.length === 0 && inlineStyles.length === 0) return null;

  const triggerRect = triggerRef.current?.getBoundingClientRect();

  // Active state is decoration, and it must never be able to break editing.
  // These read the editor's CURRENT selection, and the toolbar re-renders
  // mid-transform — while a list item is being demoted, the selection can point
  // at a path that is no longer a leaf, and `Editor.marks` throws
  // "Cannot get the leaf node at path [0,0] because it refers to a non-leaf
  // node". Nothing rendered a style menu before this, so the throw had nowhere
  // to come from; with one always present it took out Backspace-demotes-list-item.
  const activeSafely = (fn, cssClass) => {
    try {
      return fn(editor, cssClass);
    } catch {
      return false;
    }
  };
  const isActiveFor = (d, isBlock) =>
    activeSafely(isBlock ? isBlockStyleActive : isInlineStyleActive, d.cssClass);
  const anyActive =
    blockStyles.some((d) => isActiveFor(d, true)) ||
    inlineStyles.some((d) => isActiveFor(d, false));

  const renderGroup = (label, defs, isBlock) =>
    defs.length > 0 && (
      <React.Fragment key={label}>
        <div
          style={{
            padding: '6px 12px 2px',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: '#888',
          }}
        >
          {label}
        </div>
        {defs.map((def) => {
          const active = isActiveFor(def, isBlock);
          return (
            <button
              key={def.cssClass}
              type="button"
              className={`style-dropdown-item ${isBlock ? 'block' : 'inline'}-style-${def.cssClass}`}
              title={def.label || def.cssClass}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                background: active ? '#e3f2fd' : 'transparent',
                cursor: 'pointer',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                fontSize: '14px',
                color: '#333',
              }}
              onMouseDown={(e) => {
                // Apply on mousedown, before the editor loses its selection to
                // the click — the same reason every slate toolbar button does.
                e.preventDefault();
                toggleStyle(editor, { cssClass: def.cssClass, isBlock });
                setIsOpen(false);
              }}
            >
              {def.label || def.cssClass}
            </button>
          );
        })}
      </React.Fragment>
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id="style-menu"
        className="style-dropdown-trigger"
        title="Styles"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          padding: '4px 6px',
          background: anyActive ? '#e3f2fd' : 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsOpen((open) => !open);
        }}
      >
        <Icon name={paintSVG} size="20px" />
        <span style={{ fontSize: '10px', color: '#666' }}>▾</span>
      </button>

      {isOpen &&
        triggerRect &&
        createPortal(
          <div
            ref={menuRef}
            className="style-dropdown-menu"
            style={{
              position: 'fixed',
              left: `${triggerRect.left}px`,
              top: `${triggerRect.bottom + 4}px`,
              background: 'white',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
              zIndex: 10001,
              minWidth: '180px',
              maxHeight: '320px',
              overflowY: 'auto',
              padding: '4px 0',
            }}
            onMouseDownCapture={onMouseDownCapture}
            onClickCapture={onClickCapture}
          >
            {renderGroup('Text style', inlineStyles, false)}
            {renderGroup('Paragraph style', blockStyles, true)}
          </div>,
          document.body,
        )}
    </>
  );
};

export default StyleDropdown;
