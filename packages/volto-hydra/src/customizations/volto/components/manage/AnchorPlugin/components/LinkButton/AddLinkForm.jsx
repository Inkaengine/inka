/**
 * Add link form.
 * @module components/manage/AnchorPlugin/components/LinkButton/AddLinkForm
 *
 * VOLTO-HYDRA SHADOW:
 * This file shadows @plone/volto's AddLinkForm to:
 * - make the UI consistent. Both clear and submit modify the link and close immediately now
 * - fix null ref errors
 * - show object browser button for 'image' mode (Volto bug: only shows for 'link' mode)
 *
 * In volto-hydra's synced toolbar, the Slate component can remount when:
 * 1. The Clear button's onClear() modifies Slate nodes via unwrapElement()
 * 2. The 50ms delay in componentDidMount completes after a remount
 *
 * Both cases can cause this.input to be null when focus() is called.
 * This shadow adds null guards to prevent the errors.
 */

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { compose } from 'redux';

// import unionClassNames from 'union-class-names';
// cx removed - using native input with inline styles
import {
  addAppURL,
  isInternalURL,
  flattenToAppURL,
  URLUtils,
} from '@plone/volto/helpers';

import { doesNodeContainClick } from 'semantic-ui-react/dist/commonjs/lib';
import { Button } from 'semantic-ui-react';
import { defineMessages, injectIntl } from 'react-intl';

import clearSVG from '@plone/volto/icons/clear.svg';
import navTreeSVG from '@plone/volto/icons/nav.svg';
import aheadSVG from '@plone/volto/icons/ahead.svg';
import uploadSVG from '@plone/volto/icons/upload.svg';
import externalLinkSVG from '@plone/volto/icons/external-link.svg';

import withObjectBrowser from '@plone/volto/components/manage/Sidebar/ObjectBrowser';
import { withRouter } from 'react-router';

import { Icon } from '@plone/volto/components';

const messages = defineMessages({
  placeholder: {
    id: 'Enter URL or select an item',
    defaultMessage: 'Enter URL or select an item',
  },
  clear: {
    id: 'Clear',
    defaultMessage: 'Clear',
  },
  openObjectBrowser: {
    id: 'Open object browser',
    defaultMessage: 'Open object browser',
  },
  openInNewTab: {
    id: 'Open link in new tab',
    defaultMessage: 'Open link in new tab',
  },
  submit: {
    id: 'Submit',
    defaultMessage: 'Submit',
  },
});

/**
 * Add link form class.
 * @class AddLinkForm
 * @extends Component
 */
class AddLinkForm extends Component {
  static propTypes = {
    onChangeValue: PropTypes.func.isRequired,
    onClear: PropTypes.func.isRequired,
    onOverrideContent: PropTypes.func.isRequired,
    theme: PropTypes.objectOf(PropTypes.any).isRequired,
    openObjectBrowser: PropTypes.func.isRequired,
  };

  static defaultProps = {
    objectBrowserPickerType: 'link',
    placeholder: 'Enter URL or select an item',
  };

  /**
   * Constructor
   * @method constructor
   * @param {Object} props Component properties
   * @constructs AddLinkForm
   */
  constructor(props) {
    super(props);

    // Extract URL string from object_browser format: [{ "@id": "/path", ... }]
    let url = props.data.url;
    if (Array.isArray(url) && url.length > 0) {
      url = url[0]?.['@id'] || '';
    } else if (url && typeof url === 'object' && url['@id']) {
      url = url['@id'];
    }
    if (typeof url !== 'string') {
      url = '';
    }

    this.state = {
      value: isInternalURL(url) ? flattenToAppURL(url) : url,
      isInvalid: false,
    };
    this.onRef = this.onRef.bind(this);
    this.onChange = this.onChange.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
  }

  /**
   * Component did mount
   * @method componentDidMount
   * @returns {undefined}
   */
  componentDidMount() {
    // HYDRA FIX: Guard against null ref. In volto-hydra's synced toolbar,
    // the Slate component may remount during the 50ms delay, making this.input null.
    //
    // autoFocus=false for form renders the AUTHOR DID NOT ASK FOR. As a toolbar
    // popup this form is the thing just opened, so taking focus is right. As a
    // widget in the sidebar it mounts merely because a block got selected — and
    // an empty image field renders the picker on every selection. Focusing then
    // yanks the caret out of the iframe ~50ms after the author clicked a field
    // in the preview: the field stays contenteditable, the caret is gone, and
    // typing goes to this input instead. A second click appears to "fix" it
    // only because the form is already mounted and doesn't re-fire.
    if (this.props.autoFocus !== false) {
      setTimeout(() => {
        if (this.input) {
          this.input.focus();
        }
      }, 50);
    }
    document.addEventListener('mousedown', this.handleClickOutside, false);
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.handleClickOutside, false);
  }

  handleClickOutside = (e) => {
    if (
      this.linkFormContainer.current &&
      doesNodeContainClick(this.linkFormContainer.current, e)
    )
      return;
    if (this.linkFormContainer.current && this.props.isObjectBrowserOpen)
      return;
    this.onClose();
  };

  /**
   * Ref handler
   * @method onRef
   * @param {Object} node Node
   * @returns {undefined}
   */
  onRef(node) {
    this.input = node;
  }

  linkFormContainer = React.createRef();

  /**
   * Change handler
   * @method onChange
   * @param {Object} value Value
   * @returns {undefined}
   */
  onChange(value, clear) {
    let nextState = { value };
    if (!clear) {
      if (
        this.state.isInvalid &&
        URLUtils.isUrl(URLUtils.normalizeUrl(value))
      ) {
        nextState.isInvalid = false;
      }

      if (isInternalURL(value)) {
        nextState = { value: flattenToAppURL(value) };
      }
    }
    this.setState(nextState);

    if (clear) this.props.onClear();
  }

  /**
   * Select item handler
   * @method onSelectItem
   * @param {string} e event
   * @param {string} url Url
   * @returns {undefined}
   */
  onSelectItem = (e, url) => {
    e.preventDefault();
    this.setState({
      value: url,
      isInvalid: false,
    });
    this.props.onChangeValue(addAppURL(url));
  };

  /**
   * Clear handler
   * @method clear
   * @param {Object} value Value
   * @returns {undefined}
   */
  clear() {
    const nextState = { value: '' };
    this.setState(nextState);

    this.props.onClear();
  }

  /**
   * Close handler
   * @method onClose
   * @returns {undefined}
   */
  onClose = () => {
    // Tell SyncedSlateToolbar the LinkEditor closed, synchronously, so it can unblock the
    // iframe and restore the editor selection the instant we cancel — instead of its 100ms
    // poll noticing the DOM change up to a tick later, which raced the async selection
    // restore (the flaky "cancelling LinkEditor does not block editor" test). The toolbar's
    // handler is idempotent, so the poll fallback firing too is harmless. Guarded for SSR.
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('hydra:linkeditor-close'));
    }
    this.props.onOverrideContent(undefined);
  };

  /**
   * Keydown handler
   * @method onKeyDown
   * @param {Object} e Event object
   * @returns {undefined}
   */
  onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.onSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.onClose();
    }
  }

  /**
   * Submit handler
   * @method onSubmit
   * @returns {undefined}
   */
  onSubmit() {
    let { value: url } = this.state;

    const checkedURL = URLUtils.checkAndNormalizeUrl(url);
    url = checkedURL.url;
    if (!checkedURL.isValid) {
      this.setState({ isInvalid: true });
      return;
    }

    const editorStateUrl = isInternalURL(url) ? addAppURL(url) : url;

    this.props.onChangeValue(editorStateUrl);
    this.onClose();
  }

  /**
   * Render method.
   * @method render
   * @returns {string} Markup for the component.
   */
  render() {
    const { value, isInvalid } = this.state;

    const showObjectBrowser =
      this.props.objectBrowserPickerType === 'link' ||
      this.props.objectBrowserPickerType === 'image';

    return (
      <div
        className="link-form-container"
        ref={this.linkFormContainer}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 4px',
          background: '#fff',
          borderRadius: '4px',
          border: '1px solid #ddd',
          height: '32px',
          boxSizing: 'border-box',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        {/* Left side: Object browser button */}
        {showObjectBrowser && (
          <Button
            type="button"
            basic
            icon
            style={{ margin: 0, padding: '4px' }}
            aria-label={this.props.intl.formatMessage(
              messages.openObjectBrowser,
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              this.props.openObjectBrowser({
                mode: this.props.objectBrowserPickerType,
                overlay: true,
                onSelectItem: (url, item) => {
                  this.onChange(url);
                  // Pass full item to callback if provided (for object_browser fields needing metadata)
                  if (this.props.onSelectItem) {
                    this.props.onSelectItem(url, item);
                  } else {
                    this.onSubmit();
                  }
                },
              });
            }}
          >
            <Icon name={navTreeSVG} size="20px" />
          </Button>
        )}

        {/* Upload button - for image mode */}
        {this.props.objectBrowserPickerType === 'image' &&
          this.props.onFileUpload && (
            <>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                ref={(el) => (this.fileInput = el)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    // Start upload - ImageWidget's useEffect will call onClose after completion
                    this.props.onFileUpload(file);
                    // Don't call onClose here - wait for upload to complete
                  }
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                basic
                icon
                style={{ margin: 0, padding: '4px' }}
                aria-label="Upload image"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this.fileInput?.click();
                }}
              >
                <Icon name={uploadSVG} size="20px" />
              </Button>
            </>
          )}

        {/* Center: Input field */}
        <input
          type="text"
          className={isInvalid ? 'link-input invalid' : 'link-input'}
          name="link"
          value={value || ''}
          onChange={(e) => this.onChange(e.target.value)}
          placeholder={
            this.props.placeholder ||
            this.props.intl.formatMessage(messages.placeholder)
          }
          onKeyDown={this.onKeyDown}
          ref={this.onRef}
          style={{
            flex: 1,
            height: '24px',
            padding: '0 8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '13px',
            outline: 'none',
          }}
        />

        {/* Clear button - when value exists */}
        {value.length > 0 && (
          <Button
            type="button"
            icon
            style={{ margin: 0, padding: '4px', border: 'none', background: 'transparent' }}
            aria-label={this.props.intl.formatMessage(messages.clear)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              this.clear();
              if (this.input) {
                this.input.focus();
              }
            }}
          >
            <Icon name={clearSVG} size="20px" />
          </Button>
        )}

        {/* Open in new tab button - when value exists */}
        {value.length > 0 && (
          <Button
            type="button"
            icon
            style={{ margin: 0, padding: '4px', border: 'none', background: 'transparent' }}
            aria-label={this.props.intl.formatMessage(messages.openInNewTab)}
            title={this.props.intl.formatMessage(messages.openInNewTab)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // For internal URLs, prepend origin; for external, use as-is
              const url = isInternalURL(value) ? addAppURL(value) : value;
              window.open(url, '_blank', 'noopener,noreferrer');
            }}
          >
            <Icon name={externalLinkSVG} size="20px" />
          </Button>
        )}

        {/* Right side: Submit button */}
        <Button
          primary
          icon
          style={{ margin: 0, padding: '8px', border: 'none' }}
          disabled={!value.length > 0}
          aria-label={this.props.intl.formatMessage(messages.submit)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            this.onSubmit();
          }}
        >
          <Icon name={aheadSVG} size="20px" color="#fff" />
        </Button>
      </div>
    );
  }
}

export default compose(injectIntl, withRouter, withObjectBrowser)(AddLinkForm);
