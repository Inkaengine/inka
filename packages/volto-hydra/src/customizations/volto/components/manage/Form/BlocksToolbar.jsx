/**
 * Container-aware BlocksToolbar shadow.
 *
 * Volto's original BlocksToolbar assumes all blocks live at
 * formData.blocks / formData.blocks_layout (page-level only).
 *
 * This shadow fires document events that View.jsx handles using
 * container-aware utilities (getBlockById, insertBlockInContainer,
 * deleteBlockFromContainer). This avoids duplicating blockPathMap
 * or rebuilding it — View.jsx already owns it.
 *
 * Events fired:
 *   hydra-copy-blocks   — View.jsx puts selectedBlocks on the clipboard
 *   hydra-cut-blocks    — View.jsx moves the movable selectedBlocks to the clipboard
 *   hydra-paste-blocks  — View.jsx inserts clipboard blocks after selectedBlock
 *   hydra-delete-blocks — View.jsx deletes selectedBlocks from their containers
 */
import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { injectIntl } from 'react-intl';
import { messages } from '@plone/volto/helpers/MessageLabels/MessageLabels';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import { Plug } from '@plone/volto/components/manage/Pluggable';
import { load } from 'redux-localstorage-simple';
import isEqual from 'lodash/isEqual';

import {
  setBlocksClipboard,
  resetBlocksClipboard,
} from '@plone/volto/actions/blocksClipboard/blocksClipboard';

import copySVG from '@plone/volto/icons/copy.svg';
import cutSVG from '@plone/volto/icons/cut.svg';
import pasteSVG from '@plone/volto/icons/paste.svg';
import trashSVG from '@plone/volto/icons/delete.svg';
import clearSVG from '@plone/volto/icons/clear.svg';

export class BlocksToolbarComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = { pasteAllowed: true };
    this.copyBlocksToClipboard = this.copyBlocksToClipboard.bind(this);
    this.cutBlocksToClipboard = this.cutBlocksToClipboard.bind(this);
    this.deleteBlocks = this.deleteBlocks.bind(this);
    this.loadFromStorage = this.loadFromStorage.bind(this);
    this.pasteBlocks = this.pasteBlocks.bind(this);
    this.setBlocksClipboard = this.setBlocksClipboard.bind(this);
    this.handlePasteState = this.handlePasteState.bind(this);
  }

  handlePasteState(e) {
    const { allowed } = e.detail;
    if (allowed !== this.state.pasteAllowed) {
      this.setState({ pasteAllowed: allowed });
    }
  }

  loadFromStorage() {
    const clipboard = load({ states: ['blocksClipboard'] })?.blocksClipboard;
    if (!isEqual(clipboard, this.props.blocksClipboard))
      this.props.setBlocksClipboard(clipboard || {});
  }

  componentDidMount() {
    window.addEventListener('storage', this.loadFromStorage, true);
    document.addEventListener('hydra-paste-state', this.handlePasteState);
  }

  componentWillUnmount() {
    window.removeEventListener('storage', this.loadFromStorage);
    document.removeEventListener('hydra-paste-state', this.handlePasteState);
  }

  /**
   * Delete selected blocks — fires event for View.jsx to handle
   * with container-aware deletion.
   */
  deleteBlocks() {
    const { selectedBlocks } = this.props;
    document.dispatchEvent(new CustomEvent('hydra-delete-blocks', {
      detail: { blockIds: selectedBlocks },
    }));
    this.props.onSelectBlock(null);
    this.props.onSetSelectedBlocks([]);
  }

  copyBlocksToClipboard() {
    this.setBlocksClipboard('copy');
  }

  cutBlocksToClipboard() {
    document.dispatchEvent(new CustomEvent('hydra-cut-blocks', {
      detail: { blockIds: this.props.selectedBlocks },
    }));
    this.props.onSelectBlock(null);
    this.props.onSetSelectedBlocks([]);
  }

  /**
   * Copy/cut: fires event for View.jsx to read block data via
   * getBlockById (container-aware) and set clipboard.
   */
  setBlocksClipboard(actionType) {
    document.dispatchEvent(new CustomEvent('hydra-copy-blocks', {
      detail: { blockIds: this.props.selectedBlocks, action: actionType },
    }));
    this.props.onSetSelectedBlocks([]);
  }

  /**
   * Paste: fires event for View.jsx to insert clipboard blocks
   * after selectedBlock using insertBlockInContainer.
   */
  pasteBlocks(e) {
    const keepClipboard = e.ctrlKey || e.metaKey;
    document.dispatchEvent(new CustomEvent('hydra-paste-blocks', {
      detail: {
        afterBlockId: this.props.selectedBlock,
        keepClipboard,
      },
    }));
  }

  render() {
    const {
      blocksClipboard = {},
      selectedBlock,
      selectedBlocks,
      intl,
    } = this.props;
    const { pasteAllowed } = this.state;
    return (
      <>
        {selectedBlocks.length > 0 ? (
          <>
            <Plug pluggable="main.toolbar.bottom" id="blocks-delete-btn">
              <button
                aria-label={intl.formatMessage(messages.deleteBlocks)}
                onClick={this.deleteBlocks}
                tabIndex={0}
                className="deleteBlocks"
                id="toolbar-delete-blocks"
              >
                <Icon name={trashSVG} size="30px" />
              </button>
            </Plug>
            <Plug pluggable="main.toolbar.bottom" id="blocks-cut-btn">
              <button
                aria-label={intl.formatMessage(messages.cutBlocks)}
                onClick={this.cutBlocksToClipboard}
                tabIndex={0}
                className="cutBlocks"
                id="toolbar-cut-blocks"
              >
                <Icon name={cutSVG} size="30px" />
              </button>
            </Plug>
            <Plug pluggable="main.toolbar.bottom" id="blocks-copy-btn">
              <button
                aria-label={intl.formatMessage(messages.copyBlocks)}
                onClick={this.copyBlocksToClipboard}
                tabIndex={0}
                className="copyBlocks"
                id="toolbar-copy-blocks"
              >
                <Icon name={copySVG} size="30px" />
              </button>
            </Plug>
            <Plug pluggable="main.toolbar.bottom" id="blocks-exit-selection-btn" dependencies={[selectedBlocks]}>
              <button
                aria-label="Exit selection mode"
                data-testid="exit-selection-mode"
                onClick={() => {
                  document.dispatchEvent(new CustomEvent('hydra-exit-selection-mode'));
                }}
                tabIndex={0}
                className="exitSelectionMode"
                id="toolbar-exit-selection-mode"
              >
                <span className="blockCount">{selectedBlocks.length}</span>
                <Icon name={clearSVG} size="30px" />
              </button>
            </Plug>
          </>
        ) : (
          ''
        )}
        {selectedBlock && (blocksClipboard?.cut || blocksClipboard?.copy) && (
          <Plug
            pluggable="main.toolbar.bottom"
            id="block-paste-btn"
            dependencies={[selectedBlock, pasteAllowed]}
          >
            <button
              aria-label={intl.formatMessage(messages.pasteBlocks)}
              onClick={pasteAllowed ? this.pasteBlocks : undefined}
              tabIndex={0}
              className="pasteBlocks"
              id="toolbar-paste-blocks"
              disabled={!pasteAllowed}
            >
              <span className="blockCount">
                {(blocksClipboard.cut || blocksClipboard.copy).length}
              </span>
              <Icon name={pasteSVG} size="30px" />
            </button>
          </Plug>
        )}
      </>
    );
  }
}

export default compose(
  injectIntl,
  connect(
    (state) => ({
      blocksClipboard: state?.blocksClipboard || {},
    }),
    { setBlocksClipboard, resetBlocksClipboard },
  ),
)(BlocksToolbarComponent);
