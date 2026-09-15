import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { defineMessages, FormattedMessage, injectIntl } from 'react-intl';
import { Input, Segment, Breadcrumb } from 'semantic-ui-react';

import join from 'lodash/join';

// These absolute imports (without using the corresponding centralized index.js) are required
// to cut circular import problems, this file should never use them. This is because of
// the very nature of the functionality of the component and its relationship with others
import loadable from '@loadable/component';
import { readAsDataURL } from 'promise-file-reader';
import { searchContent } from '@plone/volto/actions/search/search';
import { getContent, createContent } from '@plone/volto/actions/content/content';
import { validateFileUploadSize } from '@plone/volto/helpers/FormValidation/FormValidation';
import { buildAnchorTree } from '@volto-hydra/hydra-js';
import { collectAnchorsFromContent } from '../../../../../utils/linkableAnchors';
import { buildUploadPayload } from '../../../../../utils/uploadPayload';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import { flattenToAppURL, isInternalURL } from '@plone/volto/helpers/Url/Url';
import config from '@plone/volto/registry';

const Dropzone = loadable(() => import('react-dropzone'));

import backSVG from '@plone/volto/icons/back.svg';
import folderSVG from '@plone/volto/icons/folder.svg';
import clearSVG from '@plone/volto/icons/clear.svg';
import searchSVG from '@plone/volto/icons/zoom.svg';
import linkSVG from '@plone/volto/icons/link.svg';
import homeSVG from '@plone/volto/icons/home.svg';
import iconsSVG from '@plone/volto/icons/apps.svg';
import listSVG from '@plone/volto/icons/list-bullet.svg';
import headingSVG from '@plone/volto/icons/heading.svg';

import ObjectBrowserNav from '@plone/volto/components/manage/Sidebar/ObjectBrowserNav';

const messages = defineMessages({
  SearchInputPlaceholder: {
    id: 'Search content',
    defaultMessage: 'Search content',
  },
  SelectedItems: {
    id: 'Selected items',
    defaultMessage: 'Selected items',
  },
  back: {
    id: 'Back',
    defaultMessage: 'Back',
  },
  search: {
    id: 'Search SVG',
    defaultMessage: 'Search SVG',
  },
  iconView: {
    id: 'Icon View',
    defaultMessage: 'Icon View',
  },
  listView: {
    id: 'List View',
    defaultMessage: 'List View',
  },
  home: {
    id: 'Home',
    defaultMessage: 'Home',
  },
  of: { id: 'Selected items - x of y', defaultMessage: 'of' },
  upload: { id: 'Upload', defaultMessage: 'Upload' },
  uploadingFile: { id: 'Uploading…', defaultMessage: 'Uploading…' },
  subItems: { id: 'Sub items', defaultMessage: 'Sub items' },
  fragments: { id: 'Fragments', defaultMessage: 'Fragments' },
  noFragments: {
    id: 'No fragments on this page',
    defaultMessage: 'No fragments on this page',
  },
});

function getParentURL(url) {
  return flattenToAppURL(`${join(url.split('/').slice(0, -1), '/')}`) || '/';
}

/**
 * ObjectBrowserBody container class.
 * @class ObjectBrowserBody
 * @extends Component
 */
class ObjectBrowserBody extends Component {
  /**
   * Property types.
   * @property {Object} propTypes Property types.
   * @static
   */
  static propTypes = {
    block: PropTypes.string.isRequired,
    mode: PropTypes.string.isRequired,
    data: PropTypes.any.isRequired,
    searchSubrequests: PropTypes.objectOf(PropTypes.any).isRequired,
    searchContent: PropTypes.func.isRequired,
    closeObjectBrowser: PropTypes.func.isRequired,
    onChangeBlock: PropTypes.func.isRequired,
    onSelectItem: PropTypes.func,
    dataName: PropTypes.string,
    maximumSelectionSize: PropTypes.number,
    initialPath: PropTypes.string,
    contextURL: PropTypes.string,
    searchableTypes: PropTypes.arrayOf(PropTypes.string),
    onlyFolderishSelectable: PropTypes.bool,
  };

  /**
   * Default properties.
   * @property {Object} defaultProps Default properties.
   * @static
   */
  static defaultProps = {
    image: '',
    href: '',
    onSelectItem: null,
    dataName: null,
    selectableTypes: [],
    searchableTypes: null,
    maximumSelectionSize: null,
    onlyFolderishSelectable: false,
  };

  /**
   * Constructor
   * @method constructor
   * @param {Object} props Component properties
   * @constructs WysiwygEditor
   */
  constructor(props) {
    super(props);
    const defaultMultiplePath = props.initialPath || '/';
    this.state = {
      currentFolder:
        this.props.mode === 'multiple'
          ? defaultMultiplePath
          : this.props.contextURL || '/',
      currentImageFolder:
        this.props.mode === 'multiple'
          ? defaultMultiplePath
          : this.props.mode === 'image' && this.props.data?.url
            ? getParentURL(this.props.data.url)
            : '/',
      currentLinkFolder:
        this.props.mode === 'multiple'
          ? defaultMultiplePath
          : this.props.mode === 'link' && this.props.data?.href
            ? getParentURL(this.props.data.href)
            : '/',
      parentFolder: '',
      selectedImage:
        this.props.mode === 'multiple'
          ? ''
          : this.props.mode === 'image' && this.props.data?.url
            ? flattenToAppURL(this.props.data.url)
            : '',
      selectedHref:
        this.props.mode === 'multiple'
          ? ''
          : this.props.mode === 'link' && this.props.data?.href
            ? flattenToAppURL(this.props.data.href)
            : '',
      showSearchInput: false,
      // In image mode, the searchable types default to the image types which
      // can be overridden with the property if specified.
      // If selectableTypes are passed, the searchableTypes are the selectableTypes
      searchableTypes:
        this.props.mode === 'image'
          ? this.props.searchableTypes || config.settings.imageObjects
          : [
              ...(this.props.searchableTypes ?? []),
              ...(this.props.selectableTypes ?? []),
            ],
      view: this.props.mode === 'image' ? 'icons' : 'list',
      // What the CURRENT level lists: its child items, or its deep-link
      // fragments. Toggled from the bar and reset to 'items' on navigation, so
      // the fragments of one page never linger over another level's listing.
      levelMode: 'items',
      levelAnchors: [],
      levelAnchorsLoading: false,
      // Whether we've already auto-picked a mode for this level. A level with no
      // sub-items opens on its fragments instead of a dead empty list — but only
      // once, so switching back to Sub items by hand sticks.
      levelAutoDecided: false,
      // Upload-into-folder state.
      uploading: false,
    };
    this.searchInputRef = React.createRef();
    this.uploadInputRef = React.createRef();
  }

  /**
   * Component did mount
   * @method componentDidMount
   * @returns {undefined}
   */
  componentDidMount() {
    this.initialSearch(this.props.mode);
  }

  /**
   * A level with no sub-items (a leaf page) would otherwise show an empty list,
   * so open it on its fragments instead. Runs once per level — `levelAutoDecided`
   * means an explicit switch back to Sub items isn't undone on the next render.
   */
  componentDidUpdate() {
    if (
      this.props.mode !== 'link' ||
      this.state.showSearchInput ||
      this.state.currentFolder === '/' ||
      this.state.levelMode !== 'items' ||
      this.state.levelAutoDecided
    ) {
      return;
    }
    const results =
      this.props.searchSubrequests[
        `${this.props.block}-${this.props.mode}`
      ];
    if (!results || results.loading || !Array.isArray(results.items)) return;
    if (results.items.length > 0) {
      // Has sub-items — nothing to decide, and don't re-check this level.
      this.setState({ levelAutoDecided: true });
      return;
    }
    this.setState({ levelAutoDecided: true });
    this.setLevelMode('fragments');
  }

  initialSearch = (mode) => {
    const currentSelected =
      mode === 'multiple'
        ? ''
        : mode === 'image'
          ? this.state.selectedImage
          : this.state.selectedHref;
    if (currentSelected && isInternalURL(currentSelected)) {
      this.props.searchContent(
        getParentURL(currentSelected),
        {
          'path.depth': 1,
          sort_on: 'getObjPositionInParent',
          metadata_fields: '_all',
          b_size: 1000,
        },
        `${this.props.block}-${mode}`,
      );
    } else {
      this.props.searchContent(
        this.state.currentFolder,
        {
          'path.depth': 1,
          sort_on: 'getObjPositionInParent',
          metadata_fields: '_all',
          b_size: 1000,
        },
        `${this.props.block}-${mode}`,
      );
    }
    // Back reads `parentFolder`, which was otherwise only ever written BY a
    // navigation — so until the author navigated somewhere it was '', and
    // navigateTo('') is navigateTo('/'). The browser opens on the level of the
    // page being edited, usually a leaf with no children, which makes Back the
    // first control an author reaches for: it left the folder the page lives in
    // and landed on the site root. Not one level too far — a different tree, so
    // every folder opened from there is a same-named folder somewhere else.
    //
    // Seed both from the level actually opened, which is the one just searched.
    const level =
      currentSelected && isInternalURL(currentSelected)
        ? getParentURL(currentSelected)
        : this.state.currentFolder;
    this.setState({
      currentFolder: level || '/',
      parentFolder: getParentURL(level || '/'),
    });
  };

  navigateTo = (id) => {
    this.props.searchContent(
      id,
      {
        'path.depth': 1,
        sort_on: 'getObjPositionInParent',
        metadata_fields: '_all',
        b_size: 1000,
      },
      `${this.props.block}-${this.props.mode}`,
    );
    this.setState(() => ({
      parentFolder: getParentURL(id),
      currentFolder: id || '/',
      // A new level starts on its items; if it turns out to have none,
      // componentDidUpdate flips it to fragments once they've loaded.
      levelMode: 'items',
      levelAnchors: [],
      levelAutoDecided: false,
    }));
  };

  toggleSearchInput = () =>
    this.setState(
      (prevState) => ({
        showSearchInput: !prevState.showSearchInput,
      }),
      () => {
        if (this.searchInputRef?.current) {
          this.searchInputRef.current.focus();
        } else {
          this.props.searchContent(
            this.state.currentFolder,
            {
              'path.depth': 1,
              sort_on: 'getObjPositionInParent',
              metadata_fields: '_all',
              b_size: 1000,
            },
            `${this.props.block}-${this.props.mode}`,
          );
        }
      },
    );

  toggleView = () =>
    this.setState((prevState) => ({
      view: prevState.view === 'icons' ? 'list' : 'icons',
    }));

  onSearch = (e) => {
    const text = flattenToAppURL(e.target.value);
    if (text.startsWith('/')) {
      this.setState({ currentFolder: text });
      this.props.searchContent(
        text,
        {
          'path.depth': 1,
          sort_on: 'getObjPositionInParent',
          metadata_fields: '_all',
          portal_type: this.state.searchableTypes,
        },
        `${this.props.block}-${this.props.mode}`,
      );
    } else {
      text.length > 2
        ? this.props.searchContent(
            '/',
            {
              SearchableText: `${text}*`,
              metadata_fields: '_all',
              portal_type: this.state.searchableTypes,
            },
            `${this.props.block}-${this.props.mode}`,
          )
        : this.props.searchContent(
            '/',
            {
              'path.depth': 1,
              sort_on: 'getObjPositionInParent',
              metadata_fields: '_all',
              portal_type: this.state.searchableTypes,
            },
            `${this.props.block}-${this.props.mode}`,
          );
    }
  };

  onSelectItem = (item) => {
    const url = item['@id'];
    const { block, data, mode, dataName, onChangeBlock } = this.props;

    const updateState = (mode) => {
      switch (mode) {
        case 'image':
          this.setState({
            selectedImage: url,
            currentImageFolder: getParentURL(url),
          });
          break;
        case 'link':
          this.setState({
            selectedHref: url,
            currentLinkFolder: getParentURL(url),
          });
          break;
        default:
          break;
      }
    };

    if (dataName) {
      onChangeBlock(block, {
        ...data,
        [dataName]: url,
      });
    } else if (this.props.onSelectItem) {
      this.props.onSelectItem(url, item);
    } else if (mode === 'image') {
      onChangeBlock(block, {
        ...data,
        url: flattenToAppURL(item.getURL),
        alt: '',
      });
    } else if (mode === 'link') {
      onChangeBlock(block, {
        ...data,
        href: flattenToAppURL(url),
      });
    }
    updateState(mode);
  };

  onChangeBlockData = (key, value) => {
    this.props.onChangeBlock(this.props.block, {
      ...this.props.data,
      [key]: value,
    });
  };

  // Re-run the search that populates the current folder listing.
  refreshListing = () => {
    this.props.searchContent(
      this.state.currentFolder,
      {
        'path.depth': 1,
        sort_on: 'getObjPositionInParent',
        metadata_fields: '_all',
        b_size: 1000,
      },
      `${this.props.block}-${this.props.mode}`,
    );
  };

  // Upload a file into the folder being browsed, then auto-select it. image/*
  // becomes an Image, anything else a File (see buildUploadPayload). Reuses the
  // image-widget upload mechanism (readAsDataURL + createContent).
  handleUpload = (file) => {
    if (!file) return;
    if (!validateFileUploadSize(file, this.props.intl.formatMessage)) return;
    this.setState({ uploading: true });
    readAsDataURL(file).then((dataUrl) => {
      const payload = buildUploadPayload(file, dataUrl);
      this.props
        .createContent(
          this.state.currentFolder,
          payload,
          `${this.props.block}-ob-upload`,
        )
        .then((created) => {
          this.setState({ uploading: false });
          if (!created) return;
          this.refreshListing();
          // Auto-select via the normal path: select+close (link/image) or add
          // to the selection (multiple).
          this.handleSelectItem(created);
        })
        .catch(() => this.setState({ uploading: false }));
    });
  };

  // Toggle the deep-link anchor list for an item. On first expand, fetch the
  // FULL object (search metadata carries no blocks) and collect its anchors in
  // document order.
  // Switch what the current level lists. 'fragments' loads the deep-link
  // anchors of the level itself (the page you have navigated into), so they get
  // the full list area instead of being squeezed in beside a row.
  setLevelMode = async (levelMode) => {
    if (levelMode === this.state.levelMode) return;
    if (levelMode === 'items') {
      this.setState({ levelMode: 'items' });
      return;
    }
    this.setState({ levelMode: 'fragments', levelAnchorsLoading: true });
    const id = flattenToAppURL(this.state.currentFolder);
    // The page currently being edited → anchors from the live formData (hydra
    // harvests them into the blocks as they're edited), ordered against its block
    // layout. Any other page → the persisted content via getContent (whose
    // dispatched promise resolves with the full body, blocks included — see
    // Teaser/Data.jsx).
    const editingPath = this.props.pathname
      ? this.props.pathname.replace(/\/(edit|add)$/, '')
      : null;
    const isCurrentPage =
      editingPath &&
      flattenToAppURL(editingPath) === id &&
      this.props.formData &&
      this.props.formData.blocks;
    let anchors;
    if (isCurrentPage) {
      // Anchors ride in the live formData (hydra harvests them into the blocks as
      // they're edited), so a just-added heading is linkable without saving.
      anchors = collectAnchorsFromContent(
        this.props.formData,
        config.blocks.blocksConfig,
        this.props.intl,
      );
    } else {
      const resp = await this.props.getContent(id, null, `anchors-${id}`);
      anchors = resp
        ? collectAnchorsFromContent(
            resp,
            config.blocks.blocksConfig,
            this.props.intl,
          )
        : [];
    }
    this.setState({ levelAnchors: anchors, levelAnchorsLoading: false });
  };

  // Pick a fragment of the level being browsed: select the level itself with
  // `#id` appended, so every link surface stores the deep link.
  onSelectLevelAnchor = (anchor) => {
    this.onSelectItem({
      '@id': `${this.state.currentFolder}#${anchor.id}`,
    });
  };

  // Render the fragments as a genuinely nested list, so the heading hierarchy is
  // structural (a screen reader conveys it from the list nesting) rather than a
  // visual indent. buildAnchorTree (hydra-js) turns the flat, document-ordered
  // leveled list into the tree: a deeper heading nests under the nearest
  // preceding shallower one, level-less leaves attach without opening a depth,
  // and no levels → a flat list. Anchors carry `level` from hydra's harvest
  // (data-linkable-h{n} / inferred from the heading tag).
  renderFragmentTree = (nodes) => (
    <ul className="ob-fragment-list">
      {nodes.map((node, index) => (
        <li
          key={`${node.id}-${index}`}
          className="ob-fragment-item"
          data-anchor-level={node.level ?? ''}
        >
          <span
            className="ob-fragment-label"
            role="button"
            tabIndex={0}
            onClick={() => this.onSelectLevelAnchor(node)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.onSelectLevelAnchor(node);
              }
            }}
          >
            {node.name}
          </span>
          {node.children.length ? this.renderFragmentTree(node.children) : null}
        </li>
      ))}
    </ul>
  );

  isSelectable = (item) => {
    const {
      maximumSelectionSize,
      data,
      mode,
      selectableTypes,
      onlyFolderishSelectable,
    } = this.props;

    if (onlyFolderishSelectable && !item.is_folderish) {
      return false;
    }
    if (
      maximumSelectionSize &&
      data &&
      mode === 'multiple' &&
      maximumSelectionSize <= data.length
    )
      // The item should actually be selectable, but only for removing it from already selected items list.
      // handleClickOnItem will handle the deselection logic.
      // The item is not selectable if we reached/exceeded maximumSelectionSize and is not already selected.
      return data.some(
        (d) => flattenToAppURL(d['@id']) === flattenToAppURL(item['@id']),
      );
    return selectableTypes.length > 0
      ? selectableTypes.indexOf(item['@type']) >= 0
      : true;
  };

  // HYDRA: explicit selection handler — ALWAYS selects, never navigates.
  // Wired into the radio/checkbox controls in ObjectBrowserNav so the user
  // can click a folder name to navigate into it AND independently select
  // the folder via its control (upstream couples these into one click).
  handleSelectItem = (item) => {
    const { mode, maximumSelectionSize, data } = this.props;

    if (mode === 'multiple') {
      const isDeselecting =
        Array.isArray(data) &&
        data.some(
          (d) => flattenToAppURL(d['@id']) === flattenToAppURL(item['@id']),
        );
      this.onSelectItem(item);
      const length = data ? data.length : 0;
      const newLength = isDeselecting ? length - 1 : length + 1;
      if (maximumSelectionSize > 0 && newLength >= maximumSelectionSize) {
        this.props.closeObjectBrowser();
      }
    } else {
      // Single-select (link, image): select and close.
      this.onSelectItem(item);
      this.props.closeObjectBrowser();
    }
  };

  // HYDRA: simplified row click.
  //   - Folderish items ALWAYS navigate (every mode), so the file tree
  //     stays navigable independent of selection state — upstream
  //     conditionally selects-or-navigates, which gets confusing when
  //     the folder itself is also selectable.
  //   - Non-folderish items fall through to handleSelectItem.
  // (Upstream handleDoubleClickOnItem is dropped — single-click is now
  // unambiguous and the double-click affordance isn't needed.)
  handleClickOnItem = (item) => {
    if (item.is_folderish) {
      this.navigateTo(item['@id']);
    } else if (this.props.mode === 'image') {
      if (config.settings.imageObjects.includes(item['@type'])) {
        this.handleSelectItem(item);
      }
    } else if (this.isSelectable(item)) {
      this.handleSelectItem(item);
    }
  };

  /**
   * Render method.
   * @method render
   * @returns {string} Markup for the component.
   */
  render() {
    return (
      <Segment.Group raised className="object-browser">
        <header className="header pulled">
          <div className="vertical divider" />
          {this.state.showSearchInput ? (
            <Input
              className="search"
              ref={this.searchInputRef}
              onChange={this.onSearch}
              placeholder={this.props.intl.formatMessage(
                messages.SearchInputPlaceholder,
              )}
            />
          ) : (
            <>
              {this.state.currentFolder === '/' ? (
                <>
                  {this.props.mode === 'image' ? (
                    <Icon name={folderSVG} size="24px" />
                  ) : (
                    <Icon name={linkSVG} size="24px" />
                  )}
                </>
              ) : (
                <button
                  aria-label={this.props.intl.formatMessage(messages.back)}
                  onClick={() => this.navigateTo(this.state.parentFolder)}
                >
                  <Icon name={backSVG} size="24px" />
                </button>
              )}
              {this.props.mode === 'image' ? (
                <h2>
                  <FormattedMessage
                    id="Choose Image"
                    defaultMessage="Choose Image"
                  />
                </h2>
              ) : (
                <h2>
                  <FormattedMessage
                    id="Choose Target"
                    defaultMessage="Choose Target"
                  />
                </h2>
              )}
            </>
          )}

          <button
            aria-label={this.props.intl.formatMessage(messages.search)}
            onClick={this.toggleSearchInput}
          >
            <Icon name={searchSVG} size="24px" />
          </button>
          <button className="clearSVG" onClick={this.props.closeObjectBrowser}>
            <Icon name={clearSVG} size="24px" />
          </button>
        </header>
        <Segment secondary className="breadcrumbs" vertical>
          {this.props.mode === 'image' && (
            <button
              onClick={this.toggleView}
              className="mode-switch"
              aria-label={this.props.intl.formatMessage(
                this.state.view === 'list'
                  ? messages.iconView
                  : messages.listView,
              )}
            >
              <Icon
                name={this.state.view === 'list' ? iconsSVG : listSVG}
                size="24px"
                className="mode-switch"
                title={this.props.intl.formatMessage(
                  this.state.view === 'list'
                    ? messages.iconView
                    : messages.listView,
                )}
              />
            </button>
          )}
          {!this.state.showSearchInput ? (
            <Breadcrumb>
              {this.state.currentFolder !== '/' ? (
                this.state.currentFolder
                  .split('/')
                  .map((item, index, items) => {
                    return (
                      <React.Fragment key={`divider-${item}-${index}`}>
                        {index === 0 ? (
                          <Breadcrumb.Section
                            onClick={() => this.navigateTo('/')}
                            role="button"
                            aria-label={this.props.intl.formatMessage(
                              messages.home,
                            )}
                          >
                            <Icon
                              className="home-icon"
                              name={homeSVG}
                              size="18px"
                              title={this.props.intl.formatMessage(
                                messages.home,
                              )}
                            />
                          </Breadcrumb.Section>
                        ) : (
                          <>
                            <Breadcrumb.Divider key={`divider-${item.url}`} />
                            <Breadcrumb.Section
                              role="button"
                              onClick={() =>
                                this.navigateTo(
                                  items.slice(0, index + 1).join('/'),
                                )
                              }
                            >
                              {item}
                            </Breadcrumb.Section>
                          </>
                        )}
                      </React.Fragment>
                    );
                  })
              ) : (
                <Breadcrumb.Section
                  onClick={() => this.navigateTo('/')}
                  aria-label={this.props.intl.formatMessage(messages.home)}
                >
                  <Icon
                    className="home-icon"
                    name={homeSVG}
                    role="button"
                    size="18px"
                    title={this.props.intl.formatMessage(messages.home)}
                  />
                </Breadcrumb.Section>
              )}
            </Breadcrumb>
          ) : (
            <div className="searchResults">
              <FormattedMessage
                id="Search results"
                defaultMessage="Search results"
              />
            </div>
          )}
          {/* Switch what THIS level lists: its child items, or its deep-link
              fragments. Scoped to the level (not a row) so fragments get the
              whole list area. Link mode only — fragments are link targets. */}
          {this.props.mode === 'link' &&
            !this.state.showSearchInput &&
            this.state.currentFolder !== '/' && (
              <div className="ob-level-mode">
                <button
                  type="button"
                  className={`ob-level-mode-items${
                    this.state.levelMode === 'items' ? ' active' : ''
                  }`}
                  aria-pressed={this.state.levelMode === 'items'}
                  aria-label={this.props.intl.formatMessage(messages.subItems)}
                  onClick={() => this.setLevelMode('items')}
                >
                  <Icon
                    name={listSVG}
                    size="24px"
                    title={this.props.intl.formatMessage(messages.subItems)}
                  />
                </button>
                <button
                  type="button"
                  className={`ob-level-mode-fragments${
                    this.state.levelMode === 'fragments' ? ' active' : ''
                  }`}
                  aria-pressed={this.state.levelMode === 'fragments'}
                  aria-label={this.props.intl.formatMessage(messages.fragments)}
                  onClick={() => this.setLevelMode('fragments')}
                >
                  <Icon
                    name={headingSVG}
                    size="24px"
                    title={this.props.intl.formatMessage(messages.fragments)}
                  />
                </button>
              </div>
            )}
        </Segment>
        {this.props.mode === 'multiple' && (
          <Segment className="infos">
            {this.props.intl.formatMessage(messages.SelectedItems)}:{' '}
            {this.props.data?.length}
            {this.props.maximumSelectionSize > 0 && (
              <>
                {' '}
                {this.props.intl.formatMessage(messages.of)}{' '}
                {this.props.maximumSelectionSize}
              </>
            )}
          </Segment>
        )}
        <Dropzone
          noClick
          multiple={false}
          onDrop={(files) => files?.[0] && this.handleUpload(files[0])}
        >
          {({ getRootProps, getInputProps, open }) => (
            <div {...getRootProps()} className="ob-upload-dropzone">
              <Segment className="ob-upload-bar">
                <input {...getInputProps({ className: 'ob-upload-input' })} />
                <button
                  type="button"
                  className="ob-upload-button"
                  onClick={open}
                >
                  {this.state.uploading
                    ? this.props.intl.formatMessage(messages.uploadingFile)
                    : this.props.intl.formatMessage(messages.upload)}
                </button>
              </Segment>
              {this.state.levelMode === 'fragments' ? (
                <Segment className="ob-fragments">
                  {this.state.levelAnchorsLoading ? (
                    <div className="ob-fragments-loading">
                      <FormattedMessage id="Loading" defaultMessage="Loading" />
                    </div>
                  ) : this.state.levelAnchors.length ? (
                    this.renderFragmentTree(
                      buildAnchorTree(this.state.levelAnchors),
                    )
                  ) : (
                    <div className="ob-fragments-empty">
                      {this.props.intl.formatMessage(messages.noFragments)}
                    </div>
                  )}
                </Segment>
              ) : this.props.searchSubrequests[
                  `${this.props.block}-${this.props.mode}`
                ]?.loading ? (
                // Say that a level is being fetched. Without this an empty
                // listing and a listing still on its way look identical: the
                // browser opens on a leaf page, shows nothing, and the author
                // cannot tell whether the folder is empty or the request is
                // still out — so they wait, or click Back on a level that was
                // about to fill. The flag is already in props; it was just
                // never rendered.
                <Segment className="ob-listing-loading">
                  <FormattedMessage id="Loading" defaultMessage="Loading" />
                </Segment>
              ) : (
              <ObjectBrowserNav
                currentSearchResults={
                  this.props.searchSubrequests[
                    `${this.props.block}-${this.props.mode}`
                  ]
                }
          selected={
            this.props.mode === 'multiple'
              ? this.props.data
              : [
                  {
                    '@id':
                      this.props.mode === 'image'
                        ? this.state.selectedImage
                        : this.state.selectedHref,
                  },
                ]
          }
          handleClickOnItem={this.handleClickOnItem}
          handleSelectItem={this.handleSelectItem}
          mode={this.props.mode}
          view={this.state.view}
          navigateTo={this.navigateTo}
          isSelectable={this.isSelectable}
              />
              )}
            </div>
          )}
        </Dropzone>
      </Segment.Group>
    );
  }
}

export default compose(
  injectIntl,
  connect(
    (state) => ({
      searchSubrequests: state.search.subrequests,
      lang: state.intl.locale,
      // Live edit-form data (block order + each block's harvested
      // _linkableAnchors) + current path, so anchors for the page being edited
      // come straight from the form rather than persisted content.
      formData: state.form.global,
      pathname: state.router?.location?.pathname,
    }),
    { searchContent, getContent, createContent },
  ),
)(ObjectBrowserBody);
