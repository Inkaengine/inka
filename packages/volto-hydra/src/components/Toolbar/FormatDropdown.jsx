import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSlate } from 'slate-react';
import { isBlockActive, toggleBlock } from '@plone/volto-slate/utils';
import { Icon } from '@plone/volto/components';
import paragraphIcon from '@plone/volto/icons/paragraph.svg';
import { isBlockStyleActive } from '@plone/volto-slate/editor/plugins/StyleMenu/utils';
import { applyParagraphStyle, clearParagraphStyles } from '../../utils/blockFormats';

/**
 * FormatDropdown - Block-level format selector
 *
 * Renders BlockButton elements (paragraph formats like h2, h3, ul, ol, blockquote)
 * in a dropdown menu. Shows the currently active format's icon as the trigger.
 *
 * @param {Array} blockButtons - { name, element } where element is a BlockButton (a
 *   format), or { name, styleItem } (a paragraph style, from paragraphStyleItems)
 */
/**
 * Helper to get inner props from a button element.
 * element is <Btn /> where Btn is (props) => <BlockButton title="Title" ... />
 * element.props is {} (empty), so we call the factory to get inner props.
 */
const getInnerProps = (element) => {
  if (!element) return {};
  try {
    const innerElement = element.type({});
    return innerElement?.props || {};
  } catch (e) {
    return element.props || {};
  }
};

const FormatDropdown = ({ blockButtons, onMouseDownCapture, onClickCapture }) => {
  const editor = useSlate();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  // Paragraph styles (`styleItem` entries) sit after the formats: a kind of
  // paragraph, chosen like a heading. Choosing a format or Paragraph clears
  // them; choosing one replaces another (utils/blockFormats.js).
  const formatButtons = blockButtons.filter((b) => !b.styleItem);
  const styleItems = blockButtons.filter((b) => b.styleItem).map((b) => b.styleItem);
  const styleClasses = styleItems.map((s) => s.cssClass);
  const activeStyle = styleItems.find((s) => {
    try {
      return isBlockStyleActive(editor, s.cssClass);
    } catch (e) {
      // No selection yet (the editor has not been focused).
      return false;
    }
  });

  // Find current active format by checking each button's format prop
  const activeButton = activeStyle
    ? undefined
    : formatButtons.find(({ element }) => {
        const innerProps = getInnerProps(element);
        return innerProps.format && isBlockActive(editor, innerProps.format);
      });

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Calculate dropdown position based on trigger button
  const triggerRect = triggerRef.current?.getBoundingClientRect();

  // Get the icon and title from the active button, or use paragraph defaults
  const currentProps = activeStyle || (activeButton ? getInnerProps(activeButton.element) : null);
  const currentIcon = currentProps?.icon || paragraphIcon;
  const currentTitle = currentProps?.title || 'Paragraph';
  const plainParagraph = !activeButton && !activeStyle;

  return (
    <>
      <button
        ref={triggerRef}
        className="format-dropdown-trigger"
        title={typeof currentTitle === 'string' ? currentTitle : 'Format'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          padding: '4px 6px',
          background: isOpen ? '#e8e8e8' : '#fff',
          border: 'none',
          borderRadius: '2px',
          cursor: 'pointer',
          color: '#333',
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
      >
        {currentIcon && (
          <Icon name={currentIcon} size="20px" />
        )}
        <span style={{ fontSize: '10px', color: '#666' }}>▾</span>
      </button>

      {isOpen && triggerRect && createPortal(
        <div
          ref={dropdownRef}
          className="format-dropdown-menu"
          style={{
            position: 'fixed',
            left: `${triggerRect.left}px`,
            top: `${triggerRect.bottom + 4}px`,
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: '4px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
            zIndex: 10001,
            minWidth: '160px',
            padding: '4px 0',
          }}
          // Attach the same capture handlers used by the main toolbar
          // This ensures format buttons go through the same flush mechanism
          onMouseDownCapture={onMouseDownCapture}
          onClickCapture={onClickCapture}
        >
          {/* Paragraph option to revert any block format back to plain text */}
          <button
            className="format-dropdown-item"
            data-toolbar-button="paragraph"
            data-format={activeButton ? getInnerProps(activeButton.element).format : ''}
            title="Paragraph"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              background: plainParagraph ? '#e3f2fd' : 'transparent',
              cursor: 'pointer',
              border: 'none',
              width: '100%',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              if (!plainParagraph) e.currentTarget.style.background = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = plainParagraph ? '#e3f2fd' : 'transparent';
            }}
            onMouseDown={(e) => {
              if (e.currentTarget.dataset.bypassCapture === 'true') {
                e.preventDefault();
                if (activeButton) {
                  const activeProps = getInnerProps(activeButton.element);
                  if (activeProps.format) {
                    toggleBlock(editor, activeProps.format, activeProps.allowedChildren);
                  }
                }
                clearParagraphStyles(editor, styleClasses);
                setIsOpen(false);
              }
            }}
          >
            <Icon name={paragraphIcon} size="20px" />
            <span style={{ fontSize: '14px', color: '#333' }}>Paragraph</span>
          </button>
          {formatButtons.map(({ name, element }) => {
            const innerProps = getInnerProps(element);
            const format = innerProps.format;
            const isActive = format && isBlockActive(editor, format);
            const title = innerProps.title;
            const icon = innerProps.icon;
            const allowedChildren = innerProps.allowedChildren;

            return (
              // Use actual button element so capture handler finds it
              <button
                key={name}
                className="format-dropdown-item"
                data-toolbar-button={name}
                data-format={format}
                data-allowed-children={allowedChildren ? JSON.stringify(allowedChildren) : undefined}
                title={typeof title === 'string' ? title : name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  background: isActive ? '#e3f2fd' : 'transparent',
                  cursor: 'pointer',
                  border: 'none',
                  width: '100%',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = '#f5f5f5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive ? '#e3f2fd' : 'transparent';
                }}
                onMouseDown={(e) => {
                  // Don't prevent default - let capture handler intercept first
                  // After flush completes, this will be re-triggered with bypassCapture
                  if (e.currentTarget.dataset.bypassCapture === 'true') {
                    e.preventDefault();
                    if (format) {
                      toggleBlock(editor, format, allowedChildren);
                      clearParagraphStyles(editor, styleClasses);
                    }
                    setIsOpen(false);
                  }
                }}
              >
                {icon && <Icon name={icon} size="20px" />}
                <span style={{ fontSize: '14px', color: '#333' }}>
                  {typeof title === 'string' ? title : name}
                </span>
              </button>
            );
          })}
          {styleItems.map((item) => {
            const isActive = item === activeStyle;
            return (
              <button
                key={item.name}
                className="format-dropdown-item"
                data-toolbar-button={item.name}
                data-style={item.cssClass}
                title={item.title}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  background: isActive ? '#e3f2fd' : 'transparent',
                  cursor: 'pointer',
                  border: 'none',
                  width: '100%',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = '#f5f5f5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive ? '#e3f2fd' : 'transparent';
                }}
                onMouseDown={(e) => {
                  // Same flush-then-reapply path as the formats above.
                  if (e.currentTarget.dataset.bypassCapture === 'true') {
                    e.preventDefault();
                    applyParagraphStyle(editor, item, styleClasses);
                    setIsOpen(false);
                  }
                }}
              >
                {item.icon && <Icon name={item.icon} size="20px" />}
                <span style={{ fontSize: '14px', color: '#333' }}>{item.title}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
};

export default FormatDropdown;
