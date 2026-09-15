/**
 * Form component.
 * @module components/manage/Form/Form
 */

import { Icon, Toast } from '@plone/volto/components';
import { Field } from '@plone/volto/components/manage/Form';
import BlocksToolbar from '@plone/volto/components/manage/Form/BlocksToolbar';
import UndoToolbar from '@plone/volto/components/manage/Form/UndoToolbar';
import {
  difference,
  FormValidation,
  getBlocksFieldname,
  getBlocksLayoutFieldname,
  messages,
} from '@plone/volto/helpers';
import aheadSVG from '@plone/volto/icons/ahead.svg';
import clearSVG from '@plone/volto/icons/clear.svg';
import upSVG from '@plone/volto/icons/up-key.svg';
import downSVG from '@plone/volto/icons/down-key.svg';
import {
  findIndex,
  isEmpty,
  isEqual,
  keys,
  map,
  mapValues,
  pickBy,
  cloneDeep,
  xor,
} from 'lodash';
import isBoolean from 'lodash/isBoolean';
import PropTypes from 'prop-types';
import React, { Component } from 'react';
import { injectIntl } from 'react-intl';
import { createPortal } from 'react-dom';
import { connect } from 'react-redux';
import {
  Accordion,
  Button,
  Container as SemanticContainer,
  Form as UiForm,
  Message,
  Segment,
  Tab,
} from 'semantic-ui-react';
import { v4 as uuid } from 'uuid';
import { toast } from 'react-toastify';
import { stripEmptyBlocks, ensureAllContainersHaveBlocks } from '../../../../../utils/blockPath';
import { stripFixedInsideSlots } from '@volto-hydra/helpers';
import { createLog } from '../../../../../utils/log';
const log = createLog('FORM');
import {
  setMetadataFieldsets,
  resetMetadataFocus,
  setSidebarTab,
  setFormData,
  setUIState,
  updateContent,
} from '@plone/volto/actions';
import { getQuerystring } from '@plone/volto/actions/querystring/querystring';
import { compose } from 'redux';
import config from '@plone/volto/registry';
import withSaveAsDraft from '@plone/volto/helpers/Utils/withSaveAsDraft';
import SlotRenderer from '@plone/volto/components/theme/SlotRenderer/SlotRenderer';
import Iframe from '../../../../../components/Iframe/View';
import { validateTemplatePlaceholders } from '../../../../../utils/formDataValidation';
import { validateBlocksAgainstSchemas } from '../../../../../utils/validateBlocks';
import './styles.css';

/**
 * Form container class.
 * @class Form
 * @extends Component
 */
class Form extends Component {
  /**
   * Property types.
   * @property {Object} propTypes Property types.
   * @static
   */
  static propTypes = {
    schema: PropTypes.shape({
      fieldsets: PropTypes.arrayOf(
        PropTypes.shape({
          fields: PropTypes.arrayOf(PropTypes.string),
          id: PropTypes.string,
          title: PropTypes.string,
        }),
      ),
      properties: PropTypes.objectOf(PropTypes.any),
      definitions: PropTypes.objectOf(PropTypes.any),
      required: PropTypes.arrayOf(PropTypes.string),
    }),
    formData: PropTypes.objectOf(PropTypes.any),
    globalData: PropTypes.objectOf(PropTypes.any),
    metadataFieldsets: PropTypes.arrayOf(PropTypes.string),
    metadataFieldFocus: PropTypes.string,
    pathname: PropTypes.string,
    onSubmit: PropTypes.func,
    checkSavedDraft: PropTypes.func,
    onSaveDraft: PropTypes.func,
    onCancelDraft: PropTypes.func,
    onCancel: PropTypes.func,
    submitLabel: PropTypes.string,
    resetAfterSubmit: PropTypes.bool,
    resetOnCancel: PropTypes.bool,
    isEditForm: PropTypes.bool,
    isAdminForm: PropTypes.bool,
    title: PropTypes.string,
    error: PropTypes.shape({
      message: PropTypes.string,
    }),
    loading: PropTypes.bool,
    hideActions: PropTypes.bool,
    description: PropTypes.string,
    visual: PropTypes.bool,
    blocks: PropTypes.arrayOf(PropTypes.object),
    isFormSelected: PropTypes.bool,
    onSelectForm: PropTypes.func,
    editable: PropTypes.bool,
    onChangeFormData: PropTypes.func,
    requestError: PropTypes.string,
    allowedBlocks: PropTypes.arrayOf(PropTypes.string),
    showRestricted: PropTypes.bool,
    global: PropTypes.bool,
  };

  /**
   * Default properties.
   * @property {Object} defaultProps Default properties.
   * @static
   */
  static defaultProps = {
    formData: null,
    onSubmit: null,
    checkSavedDraft: () => {},
    onSaveDraft: () => {},
    onCancelDraft: () => {},
    onCancel: null,
    submitLabel: null,
    resetAfterSubmit: false,
    resetOnCancel: false,
    isEditForm: false,
    isAdminForm: false,
    title: null,
    description: null,
    error: null,
    loading: null,
    hideActions: false,
    visual: false,
    blocks: [],
    pathname: '',
    schema: {},
    isFormSelected: true,
    onSelectForm: null,
    editable: true,
    requestError: null,
    allowedBlocks: null,
    global: false,
  };

  /**
   * Constructor
   * @method constructor
   * @param {Object} props Component properties
   * @constructs Form
   */
  constructor(props) {
    super(props);
    const ids = {
      title: uuid(),
      text: uuid(),
    };
    let { formData, schema: originalSchema } = props;
    const blocksFieldname = getBlocksFieldname(formData);
    const blocksLayoutFieldname = getBlocksLayoutFieldname(formData);

    const schema = this.removeBlocksLayoutFields(originalSchema);

    this.props.setMetadataFieldsets(
      schema?.fieldsets ? schema.fieldsets.map((fieldset) => fieldset.id) : [],
    );

    if (!props.isEditForm) {
      // It's a normal (add form), get defaults from schema
      formData = {
        ...mapValues(props.schema.properties, 'default'),
        ...formData,
      };
    }

    // We initialize the formData snapshot in here, before the initial data checks
    const initialFormData = cloneDeep(formData);

    // Adding fallback in case the fields are empty, so we are sure that the edit form
    // shows at least one block.  Consistent with getEmptyBlockType() in blockPath.js
    // which also uses config.settings.defaultBlockType for page-level blocks.
    if (
      formData.hasOwnProperty(blocksFieldname) &&
      formData.hasOwnProperty(blocksLayoutFieldname)
    ) {
      if (
        (!formData[blocksLayoutFieldname] ||
          isEmpty(formData[blocksLayoutFieldname].items)) &&
        (!formData[blocksFieldname] || isEmpty(formData[blocksFieldname]))
      ) {
        const emptyId = ids.text;
        formData[blocksLayoutFieldname] = {
          items: [emptyId],
        };
        formData[blocksFieldname] = {
          [emptyId]: {
            '@type': config.settings.defaultBlockType,
          },
        };
      }
    }

    // Ensure all container blocks have at least one child block.
    // Containers may be empty after loading from API (empty blocks are stripped on save).
    formData = ensureAllContainersHaveBlocks(
      formData, config.blocks.blocksConfig, props.intl, uuid,
    );

    let selectedBlock = null;
    if (
      formData.hasOwnProperty(blocksLayoutFieldname) &&
      formData[blocksLayoutFieldname].items.length > 0
    ) {
      if (config.blocks?.initialBlocksFocus === null) {
        selectedBlock = null;
      } else if (this.props.type in config.blocks?.initialBlocksFocus) {
        // Default selected is not the first block, but the one from config.
        // TODO Select first block and not an arbitrary one.
        Object.keys(formData[blocksFieldname]).forEach((b_key) => {
          if (
            formData[blocksFieldname][b_key]['@type'] ===
            config.blocks?.initialBlocksFocus?.[this.props.type]
          ) {
            selectedBlock = b_key;
          }
        });
      } else {
        selectedBlock = formData[blocksLayoutFieldname].items[0];
      }
    }

    // Sync state to global state
    if (this.props.global) {
      this.props.setFormData(formData);
    }

    this.props.setUIState({
      selected: selectedBlock,
      multiSelected: [],
      hovered: null,
    });

    // Set initial state
    this.state = {
      formData,
      initialFormData,
      errors: {},
      isClient: false,
      // Ensure focus remain in field after change
      inFocus: {},
      sidebarMetadataIsAvailable: false,
    };
    this.onChangeField = this.onChangeField.bind(this);
    this.onSelectBlock = this.onSelectBlock.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
    this.onCancel = this.onCancel.bind(this);
    this.onTabChange = this.onTabChange.bind(this);
    this.onBlurField = this.onBlurField.bind(this);
    this.onClickInput = this.onClickInput.bind(this);
    this.onToggleMetadataFieldset = this.onToggleMetadataFieldset.bind(this);

    // Ref for Iframe to provide template save function
    this.saveTemplatesRef = { current: null };
  }

  /**
   * On updates caused by props change
   * if errors from Backend come, these will be shown to their corresponding Fields
   * also the first Tab to have any errors will be selected
   * @param {Object} prevProps
   */
  async componentDidUpdate(prevProps, prevState) {
    let { requestError } = this.props;
    let errors = {};
    let activeIndex = 0;

    // The schema usually arrives AFTER mount, and the offer to restore a draft
    // needs it (it decides which fields the draft covers). Without this, coming
    // back to a page you left mid-edit silently keeps the server's copy.
    if (!prevProps.schema && this.props.schema) {
      this.props.checkSavedDraft(
        this.state.formData,
        this.updateFormDataWithSaved,
      );
    }

    if (!this.props.isFormSelected && prevProps.isFormSelected) {
      this.props.setUIState({
        selected: null,
      });
    }

    if (requestError && prevProps.requestError !== requestError) {
      errors =
        FormValidation.giveServerErrorsToCorrespondingFields(requestError);
      activeIndex = FormValidation.showFirstTabWithErrors({
        errors,
        schema: this.props.schema,
      });

      this.setState({
        errors,
        activeIndex,
      });
    }

    if (this.props.onChangeFormData) {
      if (!isEqual(prevState?.formData, this.state.formData)) {
        this.props.onChangeFormData(this.state.formData);
      }
    }
    if (
      this.props.global &&
      !isEqual(this.props.globalData, prevProps.globalData)
    ) {
      this.setState({
        formData: this.props.globalData,
      });
    }

    // Hydra: Reset formData when navigating to a different page
    if (this.props?.location?.pathname !== prevProps?.location?.pathname) {
      this.setState({ formData: this.props.formData }, () => {
        // Arriving at a different page is the other moment a draft can exist
        // for it. The mount check only fires when the Form is created; hydra
        // navigates between pages inside the editor without remounting it, so
        // without this you are only ever offered a draft on a cold load.
        this.props.checkSavedDraft(
          this.state.formData,
          this.updateFormDataWithSaved,
        );
      });
    }

    if (!isEqual(prevProps.schema, this.props.schema)) {
      this.props.setMetadataFieldsets(
        this.removeBlocksLayoutFields(this.props.schema).fieldsets.map(
          (fieldset) => fieldset.id,
        ),
      );
    }

    if (
      this.props.metadataFieldFocus !== '' &&
      !isEqual(prevProps.metadataFieldFocus, this.props.metadataFieldFocus)
    ) {
      // Scroll into view
      document
        .querySelector(`.field-wrapper-${this.props.metadataFieldFocus}`)
        .scrollIntoView();

      // Set focus to first input if available
      document
        .querySelector(`.field-wrapper-${this.props.metadataFieldFocus} input`)
        ?.focus();

      // Reset focus field
      this.props.resetMetadataFocus();
    }

    if (
      !this.state.sidebarMetadataIsAvailable &&
      document.getElementById('sidebar-metadata')
    ) {
      this.setState(() => ({ sidebarMetadataIsAvailable: true }));
    }
  }

  /**
   * Tab selection is done only by setting activeIndex in state
   */
  onTabChange(e, { activeIndex }) {
    const defaultFocus = this.props.schema.fieldsets[activeIndex].fields[0];
    this.setState({
      activeIndex,
      ...(defaultFocus ? { inFocus: { [defaultFocus]: true } } : {}),
    });
  }

  /**
   * If user clicks on input, the form will be not considered pristine
   * this will avoid onBlur effects without interraction with the form
   * @param {Object} e event
   */
  onClickInput(e) {
    this.setState({ isFormPristine: false });
  }

  /**
   * Validate fields on blur
   * @method onBlurField
   * @param {string} id Id of the field
   * @param {*} value Value of the field
   * @returns {undefined}
   */
  onBlurField(id, value) {
    if (!this.state.isFormPristine) {
      const errors = FormValidation.validateFieldsPerFieldset({
        schema: this.props.schema,
        formData: this.state.formData,
        formatMessage: this.props.intl.formatMessage,
        touchedField: { [id]: value },
      });

      this.setState({
        errors,
      });
    }
  }

  /**
   * Component did mount
   * @method componentDidMount
   * @returns {undefined}
   */
  /**
   * Take a draft the author accepted back into the form. Called by
   * checkSavedDraft when they say yes to the offer.
   */
  updateFormDataWithSaved = (savedFormData) => {
    if (savedFormData) {
      this.setState({ formData: savedFormData });
    }
  };

  componentDidMount() {
    this.setState({ isClient: true });

    // Offer back anything autosaved from a previous visit to this page.
    if (this.props.schema) {
      this.props.checkSavedDraft(
        this.state.formData,
        this.updateFormDataWithSaved,
      );
    }

    // Pre-fetch querystring indexes so widgets like QueryWidget don't crash
    // when mounted before their own getQuerystring() call completes
    this.props.getQuerystring();

    // Add Ctrl+S / Cmd+S save shortcut
    this.handleSaveShortcut = (event) => {
      const keyName = event.key?.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && keyName === 's') {
        event.preventDefault();
        event.stopPropagation();
        this.onSubmit(event);
      }
    };
    document.addEventListener('keydown', this.handleSaveShortcut);
  }

  /**
   * Component will unmount
   * @method componentWillUnmount
   * @returns {undefined}
   */
  componentWillUnmount() {
    if (this.handleSaveShortcut) {
      document.removeEventListener('keydown', this.handleSaveShortcut);
    }
  }

  /**
   * Change field handler
   * Remove errors for changed field
   * @method onChangeField
   * @param {string} id Id of the field
   * @param {*} value Value of the field
   * @returns {undefined}
   */
  onChangeField(id, value) {
    // Autosave (debounced inside the HOC). Blocks are drafted too — see the
    // withSaveAsDraft shadow — so canvas work survives leaving the page.
    this.props.onSaveDraft(this.state.formData);
    this.setState((prevState) => {
      const { errors, formData } = prevState;
      const newFormData = {
        ...formData,
        // We need to catch also when the value equals false this fixes #888
        [id]: value || (value !== undefined && isBoolean(value)) ? value : null,
      };
      delete errors[id];
      if (this.props.global) {
        this.props.setFormData(newFormData);
      }
      return {
        errors,
        formData: newFormData,
        // Changing the form data re-renders the select widget which causes the
        // focus to get lost. To circumvent this, we set the focus back to
        // the input.
        // This could fix other widgets too but currently targeted
        // against the select widget only.
        // Ensure field to be in focus after the change
        inFocus: { [id]: true },
      };
    });
  }

  /**
   * Select block handler
   * @method onSelectBlock
   * @param {string} id Id of the field
   * @param {string} isMultipleSelection true if multiple blocks are selected
   * @returns {undefined}
   */
  onSelectBlock(id) {
    // In selection mode (multiSelected has blocks), preserve the selection
    // so users can navigate the sidebar without losing what they've selected
    const inSelectionMode = (this.props.uiState?.multiSelected?.length || 0) > 0;
    this.props.setUIState({
      selected: id,
      ...(inSelectionMode ? {} : { multiSelected: [], gridSelected: null }),
    });

    if (this.props.onSelectForm) {
      this.props.onSelectForm();
    }
  }

  /**
   * Cancel handler
   * It prevents event from triggering submit, reset form if props.resetAfterSubmit
   * and calls this.props.onCancel
   * @method onCancel
   * @param {Object} event Event object.
   * @returns {undefined}
   */
  onCancel(event) {
    if (event) {
      event.preventDefault();
    }
    // Cancelling means the author does not want this work; the draft must not
    // outlive that decision and be offered back next time.
    this.props.onCancelDraft();
    if (this.props.resetOnCancel || this.props.resetAfterSubmit) {
      this.setState({
        formData: this.props.formData,
      });
      if (this.props.global) {
        this.props.setFormData(this.props.formData);
      }
    }
    this.props.onCancel(event);
  }

  /**
   * Submit handler also validate form and collect errors
   * @method onSubmit
   * @param {Object} event Event object.
   * @returns {undefined}
   */
  async onSubmit(event) {
    // formData for validation + the template-save pre-pass. Read here (pre-flush)
    // exactly as upstream does — saveTemplatesRef flushes the iframe's pending
    // inline edits itself and, when it returns nothing, Form re-reads its own
    // POST-flush state for the PATCH (see below). Anchors are merged at the PATCH
    // site, not here, so a just-typed edit saved before the debounce isn't lost.
    const formData = this.state.formData;

    if (event) {
      event.preventDefault();
    }

    const errors = this.props.schema
      ? FormValidation.validateFieldsPerFieldset({
          schema: this.props.schema,
          formData,
          formatMessage: this.props.intl.formatMessage,
        })
      : {};

    // Validate template slot contiguity
    const templateValidation = validateTemplatePlaceholders(formData);
    // …and every block against its own schema. Core's Form does this and this
    // shadow had lost it, so a block's `required`, `maxLength`, `pattern` — and
    // a fieldRules `error` — were never enforced on save. Nested, because
    // hydra's blocks nest and core's top-level walk would miss everything
    // inside a container.
    // Validate what will actually be PERSISTED. Empty slot blocks exist for the
    // canvas and are stripped on the way out (getOnlyFormModifiedValues), so a
    // block that will not be saved must not be able to refuse the save.
    const persistedFormData = stripEmptyBlocks(
      formData,
      config.blocks.blocksConfig,
      this.props.intl,
    );
    const schemaValidation = validateBlocksAgainstSchemas(persistedFormData, {
      blocksConfig: config.blocks.blocksConfig,
      intl: this.props.intl,
      formatMessage: this.props.intl.formatMessage,
    });
    const blocksErrors = {
      ...schemaValidation.blocksErrors,
      ...templateValidation.blocksErrors,
    };

    if (keys(errors).length > 0) {
      const activeIndex = FormValidation.showFirstTabWithErrors({
        errors,
        schema: this.props.schema,
      });
      this.setState(
        {
          errors: {
            ...errors,
            ...(!isEmpty(blocksErrors) && { blocks: blocksErrors }),
          },
          activeIndex,
        },
        () => {
          Object.keys(errors).forEach((err) =>
            toast.error(
              <Toast
                error
                title={this.props.schema.properties[err].title || err}
                content={errors[err].join(', ')}
              />,
            ),
          );
        },
      );
      // Changes the focus to the metadata tab in the sidebar if error
      this.props.setSidebarTab(0);
    } else if (keys(blocksErrors).length > 0) {
      // Template validation errors - show toast and highlight blocks
      const firstBlockId = Object.keys(blocksErrors)[0];
      const firstError = Object.values(blocksErrors[firstBlockId])[0];

      this.setState({
        errors: { blocks: blocksErrors },
      });

      toast.error(
        <Toast
          error
          title={firstError.title || 'Template Error'}
          content={firstError.message}
        />,
      );

      // Select the first block with error
      this.props.setUIState({
        selected: firstBlockId,
        multiSelected: [],
        hovered: null,
      });
      this.props.setSidebarTab(1);
    } else {
      // Save templates first if the Iframe has set up the save function. It returns the
      // page data with finalized template ids ONLY when a new template's placeholder id
      // was rewritten across the page's block references — save the page with THAT so it
      // doesn't reference a template id that was never created. When it returns nothing,
      // save from our own (post-flush) state so just-flushed inline edits aren't lost.
      let finalizedFormData = null;
      if (this.props.isEditForm && this.saveTemplatesRef.current) {
        const currentPath = this.props.pathname;
        const result = await this.saveTemplatesRef.current(formData, currentPath);
        // v2: the page save is gated while a template is unlocked — the Iframe
        // raised the "lock your templates first" modal and returns this sentinel.
        // Abort the page save.
        if (result?.blocked) return;
        finalizedFormData = result;
      }

      // Then save the page. Source the PATCH from this.state.formData READ HERE,
      // after saveTemplatesRef has flushed the iframe's pending inline edits, so
      // an edit typed and saved before the 300ms debounce still lands (a pre-flush
      // snapshot taken at the top of onSubmit would drop it). finalizedFormData is
      // only returned when a brand-new template's id was rewritten across the page
      // — that narrow path keeps its own (id-rewritten) data, as upstream does.
      // Deep-link anchors already ride in formData (merged in as they're
      // harvested), so there's nothing extra to fold in at save.
      const pageFormData = finalizedFormData || this.state.formData;
      if (this.props.isEditForm) {
        this.props.onSubmit(this.getOnlyFormModifiedValues(pageFormData));
      } else {
        this.props.onSubmit(pageFormData);
      }
      if (this.props.resetAfterSubmit) {
        this.setState({
          formData: this.props.formData,
        });
        if (this.props.global) {
          this.props.setFormData(this.props.formData);
        }
      }
    }
  }

  /**
   * getOnlyFormModifiedValues handler
   * It returns only the values of the fields that are have really changed since the
   * form was loaded. Useful for edit forms and PATCH operations, when we only want to
   * send the changed data.
   * @method getOnlyFormModifiedValues
   * @param {Object} event Event object.
   * @returns {undefined}
   */
  getOnlyFormModifiedValues = (sourceFormData = this.state.formData) => {
    // Strip empty slot blocks before diffing — they exist only for UX
    // in edit mode and must never be persisted. Needs the full page formData
    // so buildBlockPathMap can traverse all page-level blocks fields.
    // Also enforce fixed-XOR-inside-slot: scrub fixed/readOnly from any block inside a slot
    // (a paste/programmatic path may have created that malformed state) before persisting.
    // `sourceFormData` defaults to state, but the save flow passes the template-id-
    // finalized page data so those rewritten references reach the PATCH.
    const formData = stripFixedInsideSlots(
      stripEmptyBlocks(sourceFormData, config.blocks.blocksConfig, this.props.intl),
    );

    const fieldsModified = Object.keys(
      difference(formData, this.state.initialFormData),
    );
    return {
      ...pickBy(formData, (value, key) => fieldsModified.includes(key)),
      ...(formData['@static_behaviors'] && {
        '@static_behaviors': formData['@static_behaviors'],
      }),
    };
  };

  /**
   * Removed blocks and blocks_layout fields from the form.
   * @method removeBlocksLayoutFields
   * @param {object} schema The schema definition of the form.
   * @returns A modified copy of the given schema.
   */
  /**
   * Stable callback for Iframe's onChangeFormData prop.
   * Defined as a class property so the reference never changes between renders,
   * preventing unnecessary re-renders of the Iframe (View.jsx) component.
   */
  onIframeChangeFormData = (newData) => {
    const formData = this.state.formData;
    const newFormData = {
      ...formData,
      ...newData,
    };
    this.setState({
      formData: newFormData,
    });
    // Autosave the canvas too. This is THE path that matters in hydra: almost
    // everything an author does happens in the iframe and arrives here, not
    // through onChangeField, so a draft wired only to the sidebar would save a
    // title and lose every block.
    this.props.onSaveDraft(newFormData);
    if (this.props.global) {
      this.props.setFormData(newFormData);
    }
  };

  removeBlocksLayoutFields = (schema) => {
    const newSchema = { ...schema };
    const layoutFieldsetIndex = findIndex(
      newSchema.fieldsets,
      (fieldset) => fieldset.id === 'layout',
    );
    if (layoutFieldsetIndex > -1) {
      const layoutFields = newSchema.fieldsets[layoutFieldsetIndex].fields;
      newSchema.fieldsets[layoutFieldsetIndex].fields = layoutFields.filter(
        (field) => field !== 'blocks' && field !== 'blocks_layout',
      );
      if (newSchema.fieldsets[layoutFieldsetIndex].fields.length === 0) {
        newSchema.fieldsets = [
          ...newSchema.fieldsets.slice(0, layoutFieldsetIndex),
          ...newSchema.fieldsets.slice(layoutFieldsetIndex + 1),
        ];
      }
    }
    return newSchema;
  };

  /**
   * Toggle metadata fieldset handler
   * @method onToggleMetadataFieldset
   * @param {Object} event Event object.
   * @param {Object} blockProps Block properties.
   * @returns {undefined}
   */
  onToggleMetadataFieldset(event, blockProps) {
    const { index } = blockProps;
    this.props.setMetadataFieldsets(xor(this.props.metadataFieldsets, [index]));
  }

  /**
   * Render method.
   * @method render
   * @returns {string} Markup for the component.
   */
  render() {
    const { settings } = config;
    const {
      schema: originalSchema,
      onCancel,
      onSubmit,
      navRoot: navRootProp,
      type,
      metadataFieldsets,
    } = this.props;

    // Stabilize navRoot reference — it gets a new object from parent on every
    // render even when content is identical, causing unnecessary View.jsx re-renders.
    if (!isEqual(navRootProp, this._stableNavRoot)) {
      this._stableNavRoot = navRootProp;
    }
    const navRoot = this._stableNavRoot;
    const formData = this.state.formData;
    const schema = this.removeBlocksLayoutFields(originalSchema);
    const Container =
      config.getComponent({ name: 'Container' }).component || SemanticContainer;

    return this.props.visual ? (
      // Removing this from SSR is important, since react-beautiful-dnd supports SSR,
      // but draftJS don't like it much and the hydration gets messed up
      this.state.isClient && (
        <>
          <SlotRenderer
            name="aboveContent"
            content={this.props.content}
            navRoot={navRoot}
          />

          <Container>
            <BlocksToolbar
              formData={formData}
              selectedBlock={this.props.uiState.selected}
              selectedBlocks={this.props.uiState.multiSelected}
              onSetSelectedBlocks={(blockIds) =>
                this.props.setUIState({ multiSelected: blockIds })
              }
              onSelectBlock={this.onSelectBlock}
            />
            <UndoToolbar
              // Track CONTENT (formData) only. useUndoManager/Undoo saves a new
              // snapshot whenever the tracked state changes, and dedupes only
              // against the immediately-current one. Including selection made
              // every selection change a snapshot — and, worse, after an undo the
              // iframe re-settles the selection, so the re-render saved a
              // DUPLICATE-formData entry (same content, different selection). That
              // wasted an undo step on an invisible selection change: undo the
              // remove, then the next press reverts selection-only and the move
              // before it becomes unreachable. selected/multiSelected were never
              // actually restored on undo anyway (selection is uiState/props, not
              // Form state — setState(state) wrote phantom fields), so dropping
              // them loses nothing and makes each undo map to one edit.
              state={{ formData }}
              enableHotKeys
              onUndoRedo={({ state }) => {
                if (this.props.global) {
                  this.props.setFormData(state.formData);
                }
                return this.setState({ formData: state.formData });
              }}
            />
          </Container>
          <Iframe
            formData={formData}
            // Per-block validation errors from the last refused save, so the
            // sidebar can mark the field. The toast names the block; this is
            // what shows the author WHICH field and why, where they fix it.
            blocksErrors={this.state.errors?.blocks}
            schema={this.props.schema}
            onChangeFormData={this.onIframeChangeFormData}
            onChangeField={this.onChangeField}
            onSelectBlock={this.onSelectBlock}
            properties={formData}
            navRoot={navRoot}
            type={type}
            pathname={this.props.pathname}
            selectedBlock={this.props.uiState.selected}
            multiSelected={this.props.uiState.multiSelected}
            onSetMultiSelected={(blockIds) => this.props.setUIState({
              multiSelected: blockIds,
            })}
            manage={this.props.isAdminForm}
            allowedBlocks={this.props.allowedBlocks}
            showRestricted={this.props.showRestricted}
            editable={this.props.editable}
            isMainForm={this.props.editable}
            history={this.props.history}
            location={this.props.location}
            token={this.props.token}
            saveTemplatesRef={this.saveTemplatesRef}
          />
          {/* BlocksForm removed - Hydra uses Iframe for block editing */}
          {this.state.isClient &&
            this.state.sidebarMetadataIsAvailable &&
            this.props.editable &&
            createPortal(
                  <UiForm
                    method="post"
                    onSubmit={this.onSubmit}
                    error={keys(this.state.errors).length > 0}
                  >
                    {schema &&
                      map(schema.fieldsets, (fieldset) => (
                        <Accordion
                          fluid
                          styled
                          className="form"
                          key={fieldset.title}
                        >
                          <div
                            key={fieldset.id}
                            id={`metadataform-fieldset-${fieldset.id}`}
                          >
                            <Accordion.Title
                              active={metadataFieldsets.includes(fieldset.id)}
                              index={fieldset.id}
                              onClick={this.onToggleMetadataFieldset}
                            >
                              {fieldset.title}
                              {metadataFieldsets.includes(fieldset.id) ? (
                                <Icon name={upSVG} size="20px" />
                              ) : (
                                <Icon name={downSVG} size="20px" />
                              )}
                            </Accordion.Title>
                            <Accordion.Content
                              active={metadataFieldsets.includes(fieldset.id)}
                            >
                              <Segment className="attached">
                                {map(fieldset.fields, (field, index) => (
                                  <Field
                                    {...schema.properties[field]}
                                    id={field}
                                    fieldSet={fieldset.title.toLowerCase()}
                                    formData={formData}
                                    focus={
                                      this.state.isClient &&
                                      document
                                        .getElementById('sidebar-metadata')
                                        ?.contains(document.activeElement)
                                        ? this.state.inFocus[field]
                                        : false
                                    }
                                    value={formData?.[field]}
                                    required={
                                      schema.required.indexOf(field) !== -1
                                    }
                                    onChange={this.onChangeField}
                                    onBlur={this.onBlurField}
                                    onClick={this.onClickInput}
                                    key={field}
                                    error={this.state.errors[field]}
                                  />
                                ))}
                              </Segment>
                            </Accordion.Content>
                          </div>
                        </Accordion>
                      ))}
                  </UiForm>,
                  document.getElementById('sidebar-metadata'),
                )}

          <SlotRenderer
            name="belowContent"
            content={this.props.content}
            navRoot={navRoot}
          />
        </>
      )
    ) : (
      <Container>
        <UiForm
          method="post"
          onSubmit={this.onSubmit}
          error={keys(this.state.errors).length > 0}
          className={settings.verticalFormTabs ? 'vertical-form' : ''}
        >
          <fieldset className="invisible">
            <Segment.Group raised>
              {schema && schema.fieldsets.length > 1 && (
                <>
                  {settings.verticalFormTabs && this.props.title && (
                    <Segment secondary attached key={this.props.title}>
                      {this.props.title}
                    </Segment>
                  )}
                  <Tab
                    menu={{
                      secondary: true,
                      pointing: true,
                      attached: true,
                      tabular: true,
                      className: 'formtabs',
                      vertical: settings.verticalFormTabs,
                    }}
                    grid={{ paneWidth: 9, tabWidth: 3, stackable: true }}
                    onTabChange={this.onTabChange}
                    activeIndex={this.state.activeIndex}
                    panes={map(schema.fieldsets, (item) => ({
                      menuItem: item.title,
                      render: () => [
                        !settings.verticalFormTabs && this.props.title && (
                          <Segment secondary attached key={this.props.title}>
                            {this.props.title}
                          </Segment>
                        ),
                        item.description && (
                          <Message attached="bottom">
                            {item.description}
                          </Message>
                        ),
                        ...map(item.fields, (field, index) => (
                          <Field
                            {...schema.properties[field]}
                            id={field}
                            formData={formData}
                            fieldSet={item.id}
                            focus={this.state.inFocus[field]}
                            value={formData?.[field]}
                            required={schema.required.indexOf(field) !== -1}
                            onChange={
                              this.props.editable
                                ? this.onChangeField
                                : () => {}
                            }
                            onBlur={this.onBlurField}
                            onClick={this.onClickInput}
                            key={field}
                            error={this.state.errors[field]}
                          />
                        )),
                      ],
                    }))}
                  />
                </>
              )}
              {schema && schema.fieldsets.length === 1 && (
                <Segment>
                  {this.props.title && (
                    <Segment className="primary">
                      <h1 style={{ fontSize: '16px' }}> {this.props.title}</h1>
                    </Segment>
                  )}
                  {this.props.description && (
                    <Segment secondary>{this.props.description}</Segment>
                  )}
                  {keys(this.state.errors).length > 0 && (
                    <Message
                      icon="warning"
                      negative
                      attached
                      header={this.props.intl.formatMessage(messages.error)}
                      content={this.props.intl.formatMessage(
                        messages.thereWereSomeErrors,
                      )}
                    />
                  )}
                  {this.props.error && (
                    <Message
                      icon="warning"
                      negative
                      attached
                      header={this.props.intl.formatMessage(messages.error)}
                      content={this.props.error.message}
                    />
                  )}
                  {map(schema.fieldsets[0].fields, (field) => (
                    <Field
                      {...schema.properties[field]}
                      id={field}
                      value={formData?.[field]}
                      required={schema.required.indexOf(field) !== -1}
                      onChange={this.onChangeField}
                      onBlur={this.onBlurField}
                      onClick={this.onClickInput}
                      key={field}
                      error={this.state.errors[field]}
                    />
                  ))}
                </Segment>
              )}
              {!this.props.hideActions && (
                <Segment className="actions" clearing>
                  {onSubmit && (
                    <Button
                      basic
                      primary
                      floated="right"
                      type="submit"
                      aria-label={
                        this.props.submitLabel
                          ? this.props.submitLabel
                          : this.props.intl.formatMessage(messages.save)
                      }
                      title={
                        this.props.submitLabel
                          ? this.props.submitLabel
                          : this.props.intl.formatMessage(messages.save)
                      }
                      loading={this.props.loading}
                    >
                      <Icon className="circled" name={aheadSVG} size="30px" />
                    </Button>
                  )}
                  {onCancel && (
                    <Button
                      basic
                      secondary
                      aria-label={this.props.intl.formatMessage(
                        messages.cancel,
                      )}
                      title={this.props.intl.formatMessage(messages.cancel)}
                      floated="right"
                      onClick={this.onCancel}
                    >
                      <Icon className="circled" name={clearSVG} size="30px" />
                    </Button>
                  )}
                </Segment>
              )}
            </Segment.Group>
          </fieldset>
        </UiForm>
      </Container>
    );
  }
}

const FormIntl = injectIntl(Form, { forwardRef: true });

export default compose(
  connect(
    (state, props) => ({
      content: state.content.data,
      globalData: state.form?.global,
      uiState: state.form?.ui,
      metadataFieldsets: state.sidebar?.metadataFieldsets,
      metadataFieldFocus: state.sidebar?.metadataFieldFocus,
    }),
    {
      setMetadataFieldsets,
      setSidebarTab,
      setFormData,
      setUIState,
      resetMetadataFocus,
      updateContent,
      getQuerystring,
    },
    null,
    { forwardRef: true },
  ),
  withSaveAsDraft({ forwardRef: true }),
)(FormIntl);
