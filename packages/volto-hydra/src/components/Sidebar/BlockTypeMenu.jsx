/**
 * BlockTypeMenu - the list of types a block can be changed to, opened from its
 * title in the sidebar header (or from "Convert to…" in the sidebar's block
 * menu). Picking a type converts the block through the editor's one conversion
 * (View.jsx requestConvert), which asks first when content would be lost.
 *
 * Rendered in a portal with fixed positioning under the title, as the block
 * menu (DropdownMenu) is, so the sidebar's scrolling can't clip it.
 */
import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { createPortal } from 'react-dom';

const BlockTypeMenu = ({ anchorRect, anchorRef, currentTitle, targets, onPick, onClose }) => {
  const menuRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      // The control that opened the menu toggles it itself.
      if (anchorRef?.current?.contains(e.target)) return;
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  // Flip above the title when there is no room below it.
  useEffect(() => {
    if (!menuRef.current || !anchorRect) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${anchorRect.top - rect.height - 4}px`;
    }
  }, [anchorRect]);

  if (!anchorRect) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="volto-hydra-block-type-menu"
      role="menu"
      aria-label={`Change ${currentTitle} to`}
      style={{
        position: 'fixed',
        left: `${anchorRect.left}px`,
        top: `${anchorRect.bottom + 4}px`,
        minWidth: `${Math.max(anchorRect.width, 180)}px`,
        maxHeight: '60vh',
        overflowY: 'auto',
        background: 'white',
        border: '1px solid #ccc',
        borderRadius: '4px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
        zIndex: 10000,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{ padding: '8px 10px 4px', fontSize: '12px', color: '#666' }}
      >
        Change to
      </div>
      {targets.map((t) => (
        <button
          key={t.type}
          type="button"
          role="menuitem"
          data-testid="block-type-option"
          data-type={t.type}
          className="volto-hydra-dropdown-item"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onPick(t.type);
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '8px 10px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '15px',
          }}
        >
          {t.title}
        </button>
      ))}
    </div>,
    document.body,
  );
};

BlockTypeMenu.propTypes = {
  anchorRect: PropTypes.object,
  anchorRef: PropTypes.object,
  currentTitle: PropTypes.string,
  targets: PropTypes.arrayOf(
    PropTypes.shape({ type: PropTypes.string, title: PropTypes.string }),
  ).isRequired,
  onPick: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default BlockTypeMenu;
