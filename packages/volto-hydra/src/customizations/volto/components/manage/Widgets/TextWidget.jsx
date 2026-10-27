/**
 * Text Widget - Volto Hydra Shadow
 *
 * VOLTO-HYDRA SHADOW:
 * This file shadows @plone/volto's TextWidget to add a `wrap` option:
 *
 *   { type: 'string', wrap: true }
 *
 * The value is still a single line of text, but the widget shows all of it,
 * wrapped over as many lines as it needs, instead of clipping it in a one-line
 * <input>. For text that is one line by definition yet too long to read in a
 * sidebar input — a hero's lead sentence, a summary.
 *
 * It must stay ONE line: Enter and Shift+Enter do nothing, and a newline that
 * arrives any other way (paste, drop) becomes a space. A textarea that let a
 * newline through would store a second line the frontend never asked for.
 *
 * Without `wrap` this is Volto's TextWidget, unchanged. The field stays
 * `type: 'string'`, so the bridge keeps treating it as a plain single-line
 * field when it is edited on the page as well.
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Input } from 'semantic-ui-react';

import Icon from '@plone/volto/components/theme/Icon/Icon';
import FormFieldWrapper from '@plone/volto/components/manage/Widgets/FormFieldWrapper';

/** Collapse any line break, and the whitespace around it, into one space. */
const toOneLine = (text) => text.replace(/[^\S\r\n]*[\r\n]+[^\S\r\n]*/g, ' ');

const TextWidget = (props) => {
  const {
    id,
    value,
    onChange,
    onBlur,
    onClick,
    icon,
    iconAction,
    minLength,
    maxLength,
    placeholder,
    isDisabled,
    focus,
    required,
    error,
    wrap,
  } = props;

  const ref = useRef();

  useEffect(() => {
    if (focus) {
      ref.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grow the wrapped textarea to fit its text, so it never needs a scrollbar.
  // scrollHeight excludes borders, but Volto's form inputs are border-box, so
  // add them back or the last pixel row of text is clipped.
  useEffect(() => {
    const el = ref.current;
    if (!wrap || !el) return;
    el.style.height = 'auto';
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + borders}px`;
  }, [wrap, value]);

  const ariaProps = {
    'aria-required': required ? 'true' : undefined,
    'aria-invalid': error?.length > 0 ? 'true' : undefined,
  };

  return (
    <FormFieldWrapper {...props} className="text">
      {wrap ? (
        <textarea
          id={`field-${id}`}
          name={id}
          rows={1}
          style={{ resize: 'none', overflow: 'hidden' }}
          value={value || ''}
          disabled={isDisabled}
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
          onChange={({ target }) => {
            const text = toOneLine(target.value);
            onChange(id, text === '' ? undefined : text);
          }}
          ref={ref}
          onBlur={({ target }) => {
            const text = toOneLine(target.value);
            onBlur(id, text === '' ? undefined : text);
          }}
          onClick={() => onClick()}
          minLength={minLength || null}
          maxLength={maxLength || null}
          {...ariaProps}
        />
      ) : (
        <Input
          id={`field-${id}`}
          name={id}
          value={value || ''}
          disabled={isDisabled}
          icon={icon || null}
          placeholder={placeholder}
          onChange={({ target }) =>
            onChange(id, target.value === '' ? undefined : target.value)
          }
          ref={ref}
          onBlur={({ target }) =>
            onBlur(id, target.value === '' ? undefined : target.value)
          }
          onClick={() => onClick()}
          minLength={minLength || null}
          maxLength={maxLength || null}
          {...ariaProps}
        />
      )}
      {icon && iconAction && (
        <button className={`field-${id}-action-button`} onClick={iconAction}>
          <Icon name={icon} size="18px" />
        </button>
      )}
    </FormFieldWrapper>
  );
};

export default TextWidget;

TextWidget.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  required: PropTypes.bool,
  error: PropTypes.arrayOf(PropTypes.string),
  value: PropTypes.string,
  focus: PropTypes.bool,
  onChange: PropTypes.func,
  onBlur: PropTypes.func,
  onClick: PropTypes.func,
  onEdit: PropTypes.func,
  onDelete: PropTypes.func,
  icon: PropTypes.shape({
    xmlns: PropTypes.string,
    viewBox: PropTypes.string,
    content: PropTypes.string,
  }),
  iconAction: PropTypes.func,
  minLength: PropTypes.number,
  maxLength: PropTypes.number,
  wrapped: PropTypes.bool,
  wrap: PropTypes.bool,
  placeholder: PropTypes.string,
};

TextWidget.defaultProps = {
  description: null,
  required: false,
  error: [],
  value: null,
  onChange: () => {},
  onBlur: () => {},
  onClick: () => {},
  onEdit: null,
  onDelete: null,
  focus: false,
  icon: null,
  iconAction: null,
  minLength: null,
  maxLength: null,
  wrap: false,
};
