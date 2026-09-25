/**
 * Add container.
 * @module components/manage/Add/Add
 */

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { compose } from 'redux';
import keys from 'lodash/keys';
import isEmpty from 'lodash/isEmpty';
import { defineMessages, injectIntl } from 'react-intl';
import { Button } from 'semantic-ui-react';
import { createPortal } from 'react-dom';
import { v4 as uuid } from 'uuid';
import qs from 'query-string';
import { toast } from 'react-toastify';

import { createContent } from '@plone/volto/actions/content/content';
import { getSchema } from '@plone/volto/actions/schema/schema';
import { changeLanguage } from '@plone/volto/actions/language/language';
import { setFormData } from '@plone/volto/actions/form/form';

import Icon from '@plone/volto/components/theme/Icon/Icon';
import Toolbar from '@plone/volto/components/manage/Toolbar/Toolbar';
import Sidebar from '@plone/volto/components/manage/Sidebar/Sidebar';
import Toast from '@plone/volto/components/manage/Toast/Toast';
import { Form } from '@plone/volto/components/manage/Form';

import { getBaseUrl, flattenToAppURL } from '@plone/volto/helpers/Url/Url';
import {
  cloneBlocksForTranslation,
  withFieldsReadOnly,
  sourceFingerprint,
} from '@volto-hydra/helpers';
import { buildIdFieldMap, getBlockTypeSchema } from '../../../../../utils/blockPath';
import {
  getBlocksFieldname,
  getBlocksLayoutFieldname,
} from '@plone/volto/helpers/Blocks/Blocks';
import { getLanguageIndependentFields } from '@plone/volto/helpers/Content/Content';
import langmap from '@plone/volto/helpers/LanguageMap/LanguageMap';
import { toGettextLang } from '@plone/volto/helpers/Utils/Utils';
import {
  getSimpleDefaultBlocks,
  getDefaultBlocks,
} from '@plone/volto/helpers/Blocks/defaultBlocks';
import {
  tryParseJSON,
  extractInvariantErrors,
} from '@plone/volto/helpers/FormValidation/FormValidation';
import Helmet from '@plone/volto/helpers/Helmet/Helmet';

import { preloadLazyLibs } from '@plone/volto/helpers/Loadable';

import config from '@plone/volto/registry';

import saveSVG from '@plone/volto/icons/save.svg';
import clearSVG from '@plone/volto/icons/clear.svg';

const messages = defineMessages({
  add: {
    id: 'Add {type}',
    defaultMessage: 'Add {type}',
  },
  save: {
    id: 'Save',
    defaultMessage: 'Save',
  },
  cancel: {
    id: 'Cancel',
    defaultMessage: 'Cancel',
  },
  error: {
    id: 'Error',
    defaultMessage: 'Error',
  },
  translateTo: {
    id: 'Translate to {lang}',
    defaultMessage: 'Translate to {lang}',
  },
  someErrors: {
    id: 'There are some errors.',
    defaultMessage: 'There are some errors.',
  },
});

/**
 * Add class.
 * @class Add
 * @extends Component
 */
class Add extends Component {
  /**
   * Property types.
   * @property {Object} propTypes Property types.
   * @static
   */
  static propTypes = {
    createContent: PropTypes.func.isRequired,
    getSchema: PropTypes.func.isRequired,
    pathname: PropTypes.string.isRequired,
    schema: PropTypes.objectOf(PropTypes.any),
    content: PropTypes.shape({
      // eslint-disable-line react/no-unused-prop-types
      '@id': PropTypes.string,
      '@type': PropTypes.string,
    }),
    returnUrl: PropTypes.string,
    createRequest: PropTypes.shape({
      loading: PropTypes.bool,
      loaded: PropTypes.bool,
    }).isRequired,
    schemaRequest: PropTypes.shape({
      loading: PropTypes.bool,
      loaded: PropTypes.bool,
    }).isRequired,
    type: PropTypes.string,
    location: PropTypes.objectOf(PropTypes.any),
  };

  /**
   * Default properties
   * @property {Object} defaultProps Default properties.
   * @static
   */
  static defaultProps = {
    schema: null,
    content: null,
    returnUrl: null,
    type: 'Default',
  };

  /**
   * Constructor
   * @method constructor
   * @param {Object} props Component properties
   * @constructs WysiwygEditor
   */
  constructor(props) {
    super(props);
    this.onCancel = this.onCancel.bind(this);
    this.onSubmit = this.onSubmit.bind(this);

    this.state = {
      isClient: false,
      error: null,
      formSelected: 'addForm',
    };
  }

  /**
   * Component did mount
   * @method componentDidMount
   * @returns {undefined}
   */
  componentDidMount() {
    this.props.getSchema(this.props.type, getBaseUrl(this.props.pathname));
    this.setState({ isClient: true });
  }

  /**
   * Component will receive props
   * @method componentWillReceiveProps
   * @param {Object} nextProps Next properties
   * @returns {undefined}
   */
  UNSAFE_componentWillReceiveProps(nextProps) {
    if (
      this.props.createRequest.loading &&
      nextProps.createRequest.loaded &&
      nextProps.content['@type'] === this.props.type
    ) {
      this.props.setFormData({});
      // HYDRA: drop the user straight into edit mode on the new item — but
      // ONLY for types that have block editing. For block-bearing types
      // (Document, NewsItem, Event, …) the bridge's whole point is to edit
      // in place. For non-block types (Image, File, Link, Folder) the
      // /edit route is just Volto's flat metadata form, which the bridge
      // can't drive — sending the user to the canonical view is saner.
      // Detect via `blocks_layout` on the created content: Plone populates
      // it on save iff the type has the volto.blocks behavior. This is the
      // same signal Volto uses elsewhere (e.g. View.jsx routes block-bearing
      // types to the visual edit view).
      const newContent = nextProps.content;
      const hasBlockEditor = !!newContent?.blocks_layout;
      const newUrl = flattenToAppURL(newContent['@id']);
      this.props.history.push(
        this.props.returnUrl ||
          (hasBlockEditor ? `${newUrl}/edit` : newUrl),
      );
    }

    if (this.props.createRequest.loading && nextProps.createRequest.error) {
      const message =
        nextProps.createRequest.error.response?.body?.message ||
        nextProps.createRequest.error.response?.text;

      const error =
        new DOMParser().parseFromString(message, 'text/html')?.all[0]
          ?.textContent || message;

      const errorsList = tryParseJSON(error);
      let erroMessage;
      if (Array.isArray(errorsList)) {
        const invariantErrors = extractInvariantErrors(errorsList);
        if (invariantErrors.length > 0) {
          // Plone invariant validation message.
          erroMessage = invariantErrors.join(' - ');
        } else {
          // Error in specific field.
          erroMessage = this.props.intl.formatMessage(messages.someErrors);
        }
      } else {
        erroMessage = errorsList?.error?.message || error;
      }

      this.setState({ error: error });

      toast.error(
        <Toast
          error
          title={this.props.intl.formatMessage(messages.error)}
          content={erroMessage}
        />,
      );
    }
  }

  /**
   * Submit handler
   * @method onSubmit
   * @param {object} data Form data.
   * @returns {undefined}
   */
  onSubmit(data) {
    this.props.createContent(getBaseUrl(this.props.pathname), {
      ...data,
      '@static_behaviors': this.props.schema.definitions
        ? keys(this.props.schema.definitions)
        : null,
      '@type': this.props.type,
      ...(this.props.location?.state?.translationOf && {
        translation_of: this.props.location.state.translationOf,
        language: this.props.location.state.language,
      }),
    });
  }

  /**
   * Cancel handler
   * @method onCancel
   * @returns {undefined}
   */
  onCancel() {
    this.props.setFormData({});
    if (this.props.location?.state?.translationOf) {
      const language = this.props.location.state.languageFrom;
      const langFileName = toGettextLang(language);
      import(/* @vite-ignore */ '@root/../locales/' + langFileName + '.json')
        .then((locale) => {
          this.props.changeLanguage(language, locale.default);
        })
        .catch(() => {
          this.props.changeLanguage(language, {});
        });
      this.props.history.push(this.props.location?.state?.translationOf);
    } else {
      this.props.history.push(getBaseUrl(this.props.pathname));
    }
  }

  form = React.createRef();

  /**
   * Render method.
   * @method render
   * @returns {string} Markup for the component.
   */
  render() {
    // HYDRA: render the form shell — and therefore the iframe inside it —
    // WITHOUT waiting for the schema.
    //
    // With the backend inversion on, getSchema travels over the bridge to the
    // frontend's adapter, and that adapter lives in the iframe that Form
    // renders. Gating this render on schemaRequest.loaded therefore deadlocks:
    // the schema request waits for an adapter that only exists inside the
    // component the schema request is blocking. Volto's stock Add returns
    // <div /> here, which is exactly the empty <main> that symptom presents as.
    //
    // An empty schema renders an empty field set for one paint; the fields
    // appear as soon as the request it just unblocked comes back.
    // Render nothing until the schema is real.
    //
    // This briefly rendered a placeholder empty schema so the iframe would
    // mount and host the adapter that answers getSchema. That had a cost only
    // an end-to-end test could show: the form accepted a title, then
    // re-initialised when the real schema arrived and threw the typed value
    // away — the page saved untitled.
    //
    // It is no longer needed. AdapterHost covers this route, so the schema
    // request is answered without the form existing yet.
    if (!this.props.schemaRequest.loaded) return <div />;
    const schema = this.props.schema;


    // HYDRA: use the visual branch, which in THIS fork means Hydra's iframe.
    //
    // This was `false`, guarding against Volto's in-page block editor competing
    // with the bridge for selection and rendering. That guard is stale:
    // Hydra's customized Form replaced BlocksForm in the visual branch with
    // <Iframe> (see Form.jsx, "BlocksForm removed - Hydra uses Iframe for
    // block editing"), so `visual` now selects Hydra's own editor, not Volto's.
    //
    // Keeping it false meant the Add route rendered NO iframe at all — and so
    // hosted no adapter. Harmless while the admin fetched directly; a hard
    // deadlock once getSchema travels over the bridge to an adapter that only
    // exists inside an iframe this route never rendered.
    const visual = true;
    const blocksFieldname = getBlocksFieldname(schema.properties);
    const blocksLayoutFieldname = getBlocksLayoutFieldname(
      schema.properties,
    );
    const translationObject = this.props.location?.state?.translationObject;
    const translateTo = translationObject
      ? langmap?.[this.props.location?.state?.language]?.nativeName ||
        this.props.location?.state?.language
      : null;

    // Get initial blocks from local config, if any
    let initialBlocks, initialBlocksLayout;
    const initialContentTypeBlocks =
      config.blocks?.initialBlocks[this.props.type];
    if (initialContentTypeBlocks) {
      if (typeof initialContentTypeBlocks?.[0] === 'string') {
        // Simple (legacy) default blocks definition
        [initialBlocks, initialBlocksLayout] = getSimpleDefaultBlocks(
          initialContentTypeBlocks,
        );
      } else {
        [initialBlocks, initialBlocksLayout] = getDefaultBlocks(
          initialContentTypeBlocks,
        );
      }
    }

    // Lookup initialBlocks and initialBlocksLayout within schema, if any
    const schemaBlocks =
      schema.properties[blocksFieldname]?.default;
    const schemaBlocksLayout =
      schema.properties[blocksLayoutFieldname]?.default?.items;

    if (!isEmpty(schemaBlocksLayout) && !isEmpty(schemaBlocks)) {
      initialBlocks = {};
      initialBlocksLayout = [];
      schemaBlocksLayout.forEach((value) => {
        if (!isEmpty(schemaBlocks[value])) {
          let newUid = uuid();
          initialBlocksLayout.push(newUid);
          initialBlocks[newUid] = schemaBlocks[value];
          initialBlocks[newUid].block = newUid;

          // Layout ID - keep a reference to the original block id within layout
          initialBlocks[newUid]['@layout'] = value;
        }
      });
    }

    // Copy the original's blocks for the translator to work on.
    //
    // HYDRA: through the container API, so a container's CHILDREN are copied
    // under new ids too. Volto's own loop renames only what blocks_layout
    // lists, which leaves every nested block sharing its id with the block it
    // was copied from — and a uid that names a block on two pages breaks
    // selection, inline editing and the bridge, all of which address blocks
    // by uid. Each copy keeps `@canonical`, the id it came from.
    if (translationObject && blocksFieldname && blocksLayoutFieldname) {
      const copied = cloneBlocksForTranslation(
        translationObject[blocksFieldname],
        translationObject[blocksLayoutFieldname]?.items || [],
        uuid,
        buildIdFieldMap(config.blocks.blocksConfig, this.props.intl),
        // What each copy was made FROM, so the editor can later be told which
        // blocks the original has moved on from. A type with no schema here
        // records nothing rather than a fingerprint over fields we cannot
        // tell apart.
        (sourceBlock, id, type) => {
          // The BLOCK's schema, not the page's — `schema` above is the content
          // type's, and shadowing it here would read as the same thing.
          const blockSchema = getBlockTypeSchema(
            type,
            this.props.intl,
            config.blocks.blocksConfig,
          );
          return blockSchema
            ? sourceFingerprint(sourceBlock, blockSchema)
            : null;
        },
      );
      initialBlocks = copied.blocks;
      initialBlocksLayout = copied.layout;
      // Volto's copy also stamps each block's own `block` key with its uid.
      for (const [uid, block] of Object.entries(initialBlocks)) {
        block.block = uid;
      }
    }

    const languageIndependentFields = translationObject
      ? getLanguageIndependentFields(this.props.schema)
      : [];

    const lifData = () => {
      const data = {};
      languageIndependentFields.forEach(
        (lif) => (data[lif] = translationObject[lif]),
      );
      return data;
    };

    // HYDRA: a language-independent field is the SAME value in every
    // language, so the translation inherits it — shown, so the translator
    // knows what the tags are, but not editable, because there is one place
    // that value lives. Volto only fades these with CSS and still posts
    // whatever the input holds; `readOnly` — the same flag a locked block
    // carries — means the form renders the value instead of a control.
    const formSchema = withFieldsReadOnly(
      this.props.schema,
      languageIndependentFields,
    );

    const pageAdd = (
      <div id="page-add">
        <Helmet
          title={this.props.intl.formatMessage(messages.add, {
            type: this.props?.schema?.title || this.props.type,
          })}
        />
        <Form
          ref={this.form}
          key="translated-or-new-content-form"
          navRoot={
            this.props.content?.['@components']?.navroot?.navroot || {}
          }
          schema={formSchema}
          type={this.props.type}
          formData={
            this.props.location?.state?.initialFormData || {
              ...(blocksFieldname && {
                [blocksFieldname]:
                  initialBlocks ||
                  schema.properties[blocksFieldname]?.default,
              }),
              ...(blocksLayoutFieldname && {
                [blocksLayoutFieldname]: {
                  items:
                    initialBlocksLayout ||
                    schema.properties[blocksLayoutFieldname]
                      ?.default?.items,
                },
              }),
              // Copy the Language Independent Fields values from the to-be translated content
              // into the default values of the translated content Add form.
              ...lifData(),
              parent: {
                '@id': this.props.content?.['@id'] || '',
              },
            }
          }
          requestError={this.state.error}
          onSubmit={this.onSubmit}
          hideActions
          pathname={this.props.pathname}
          visual={visual}
          title={
            this.props?.schema?.title
              ? this.props.intl.formatMessage(messages.add, {
                  type: this.props.schema.title,
                })
              : null
          }
          loading={this.props.createRequest.loading}
          isFormSelected={this.state.formSelected === 'addForm'}
          onSelectForm={() => {
            this.setState({ formSelected: 'addForm' });
          }}
          global
          // Properties to pass to the BlocksForm to match the View ones
          history={this.props.history}
          location={this.props.location}
          token={this.props.token}
        />
        {this.state.isClient &&
          createPortal(
            <Toolbar
              pathname={this.props.pathname}
              hideDefaultViewButtons
              inner={
                <>
                  <Button
                    id="toolbar-save"
                    className="save"
                    aria-label={this.props.intl.formatMessage(messages.save)}
                    onClick={() => this.form.current.onSubmit()}
                    loading={this.props.createRequest.loading}
                    disabled={this.props.createRequest.loading}
                  >
                    <Icon
                      name={saveSVG}
                      className="circled"
                      size="30px"
                      title={this.props.intl.formatMessage(messages.save)}
                    />
                  </Button>
                  <Button
                    className="cancel"
                    onClick={() => this.onCancel()}
                    type="button"
                  >
                    <Icon
                      name={clearSVG}
                      className="circled"
                      aria-label={this.props.intl.formatMessage(
                        messages.cancel,
                      )}
                      size="30px"
                      title={this.props.intl.formatMessage(messages.cancel)}
                    />
                  </Button>
                </>
              }
            />,
            document.getElementById('toolbar'),
          )}
        {visual &&
          this.state.isClient &&
          createPortal(<Sidebar />, document.getElementById('sidebar'))}
      </div>
    );

    // Volto pairs two FORMS here: the source's fields beside the new page's,
    // each with its own blocks editor. Inka has neither half of that — a
    // page's fields are in the sidebar and its blocks are drawn by the
    // frontend — so the source form would only repeat the sidebar, in a
    // second place, for a page nobody is editing. The original appears where
    // it is useful instead: the read-only pane beside the draft.
    return pageAdd;
  }
}

export default compose(
  injectIntl,
  connect(
    (state, props) => ({
      createRequest: state.content.create,
      schemaRequest: state.schema,
      content: state.content.data,
      schema: state.schema.schema,
      pathname: props.location.pathname,
      returnUrl: qs.parse(props.location.search).return_url,
      type: qs.parse(props.location.search).type,
      // Which frontend the editor is previewing with, so a translation's
      // read-only original is rendered by the same one as its draft.
      frontendPreviewUrl: state.frontendPreviewUrl?.url,
      token: state.userSession?.token,
    }),
    { createContent, getSchema, changeLanguage, setFormData },
  ),
  preloadLazyLibs('cms'),
)(Add);
