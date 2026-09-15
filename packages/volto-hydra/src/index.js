// Publishes window.__hydraBridgeRpc at module load — before any route can
// dispatch, which is earlier than any component effect could manage.
import './bridge/client';
import { defineMessages } from 'react-intl';
import filterSVG from '@plone/volto/icons/filter.svg';

const messages = defineMessages({
  typeText: {
    id: 'Type text…',
    defaultMessage: 'Type text…',
  },
  typeTitle: {
    id: 'Type the title…',
    defaultMessage: 'Type the title…',
  },
  addDescription: {
    id: 'Add a description…',
    defaultMessage: 'Add a description…',
  },
  videoPlaceholder: {
    id: 'Type a Video (YouTube, Vimeo or mp4) URL',
    defaultMessage: 'Type a Video (YouTube, Vimeo or mp4) URL',
  },
  mapsPlaceholder: {
    id: 'Paste a Google Maps Embed URL',
    defaultMessage: 'Paste a Google Maps Embed URL',
  },
  imagePlaceholder: {
    id: 'Browse the site or type a URL',
    defaultMessage: 'Browse the site or type a URL',
  },
  htmlPlaceholder: {
    id: 'Add some HTML here',
    defaultMessage: 'Add some HTML here',
  },
});
import Cookies from 'js-cookie';
import frontendPreviewUrl, { viewportPreset } from './reducers';
import FrontendSwitcherPlug from './components/Toolbar/FrontendSwitcherPlug';
import SidebarToggleToolbarPlug from './components/Toolbar/SidebarToggleToolbarPlug';
import FrontendSwitcherPanel from './components/Toolbar/FrontendSwitcherPanel';
import NativeActionsPlug from './components/Toolbar/NativeActionsPlug';
import NativeActionsPanel from './components/Toolbar/NativeActionsPanel';
import MobileSubmenuClose from './components/Toolbar/MobileSubmenuClose';
import { getIframeUrlCookieName } from './utils/cookieNames';
import getSavedURLs, { getURlsFromEnv } from './utils/getSavedURLs';
import getCurrentFrontendPublicUrl from './utils/getCurrentFrontendPublicUrl';
import publicUrlSync from './middleware/publicUrlSync';
import {
  getAllowedBlocksList,
  subscribeToAllowedBlocksListChanges,
} from './utils/allowedBlockList';
import ArrayAwareUrlWidget from './components/Widgets/ArrayAwareUrlWidget';
import HiddenBlocksWidget from './components/Widgets/HiddenBlocksWidget';
import HiddenObjectListWidget from './components/Widgets/HiddenObjectListWidget';
import FieldMappingWidget from './components/Widgets/FieldMappingWidget';
import BlockTypeSelectWidget from './components/Widgets/BlockTypeSelectWidget';
import CopyFromTargetField from './components/Widgets/CopyFromTargetField';
import SchemaFieldSelectWidget from './components/Widgets/SchemaFieldSelectWidget';
import VocabularySelectWidget from './components/Widgets/VocabularySelectWidget';
import BlockPickerWidget from './components/Widgets/BlockPickerWidget';
import QuerystringSelectWidget from './components/Widgets/QuerystringSelectWidget';
import TableSchema, { TableBlockSchema } from '@plone/volto-slate/blocks/Table/schema';
// Volto-slate ships TWO schemas for the slate block:
//   ./schema.js          → "Block tab" form (override_toc / level / entry_text)
//   ./TextBlockSchema.js → "Settings tab" form (placeholder / instructions /
//                          fixed / disableNewBlocks / readOnly)
// We merge both into one schema below so Volto Hydra's single sidebar
// surface shows everything.
import _slateBlockTabSchema from '@plone/volto-slate/blocks/Text/schema';
import { ImageSchema } from '@plone/volto/components/manage/Blocks/Image/schema';
import {
  QUERY_RESULT_FIELDS,
  createSchemaEnhancerFromRecipe,
} from './utils/blockSync';
import rowBeforeSVG from '@plone/volto/icons/row-before.svg';
import rowAfterSVG from '@plone/volto/icons/row-after.svg';
import rowDeleteSVG from '@plone/volto/icons/row-delete.svg';
import columnBeforeSVG from '@plone/volto/icons/column-before.svg';
import './components/mobile-tablet.css';
import columnAfterSVG from '@plone/volto/icons/column-after.svg';
import columnDeleteSVG from '@plone/volto/icons/column-delete.svg';
import { applyBlockDefaults } from '@plone/volto/helpers';
import { setInjectedVoltoConfig } from './utils/injectedVoltoConfig';
import StyleDropdown from './components/Toolbar/StyleDropdown';

// The field types a `hydraRuleError` can land on. Volto looks a validator up by
// the field's declared type (`field.type || 'string'`), so the rule's error has
// to be offered for each type a rule might mark — there is no "any type" key.
const RULE_ERROR_FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

/**
 * Surface a field rule's `error` as a form error.
 *
 * `evaluateFieldRule` puts the message on the field DEFINITION when the rule
 * matches; this is what turns that into the things an author sees — the widget
 * red, the form's error summary, and a blocked save — all of which are Volto's
 * own, keyed on the field. Nothing here decides anything: the rule already did.
 */
const hydraRuleErrorValidator = ({ field }) => field?.hydraRuleError || null;

const applyConfig = (config) => {
  // Route every CMS call over the bridge to the frontend's adapter instead of
  // fetching directly from the admin. Off unless explicitly enabled: with it
  // off the customized Api helper falls through to stock superagent, so the
  // whole inversion is inert.
  config.settings.useBridgeBackend =
    process.env.RAZZLE_USE_BRIDGE_BACKEND === 'true';

  if (config.settings.useBridgeBackend) {
    // Expanders are decided from the adapter's CAPABILITIES, not statically
    // here: at config time no adapter has announced itself yet, and baking in
    // a default that never gets revisited is exactly how every request once
    // ended up on the passthrough regardless of which CMS was connected.
    //
    // Off until the frontend says it can expand natively — see
    // bridge/expanders.js for why that gate exists and what it measured.
    config.settings.apiExpanders = [];

    // Guarantee the server can resolve a UI language without asking a CMS.
    //
    // server.jsx picks the render language from
    //   cookie || state.site.data['plone.default_language'] || accept-language
    // and in a bridge session the middle term is always absent — site info is
    // a CMS read the server cannot make. A request that also carries no
    // Accept-Language (health checks, curl, monitors) therefore left the
    // language undefined, and toReactIntlLang() called .includes() on it. That
    // throw lands in server.jsx's .catch(errorHandler), so the response was an
    // ERROR PAGE with an error status rather than the admin.
    //
    // Naming the language the admin is built with is not a fallback for CMS
    // data: it is a UI preference the CMS never owned in the first place.
    const language =
      config.settings.supportedLanguages?.[0] ?? 'en';
    const ensureLanguage = (req, res, next) => {
      if (!req.headers['accept-language']) {
        req.headers['accept-language'] = language;
      }
      next();
    };
    config.settings.expressMiddleware = [
      ...(config.settings.expressMiddleware ?? []),
      ensureLanguage,
    ];
  }

  for (const fieldType of RULE_ERROR_FIELD_TYPES) {
    config.registerUtility({
      name: `hydraRuleError-${fieldType}`,
      type: 'validator',
      dependencies: { fieldType },
      method: hydraRuleErrorValidator,
    });
  }

  // Autosave the form to localStorage while editing, and offer it back if the
  // author returns to a page they left mid-edit. Volto ships the feature but
  // OFF (config.experimental.saveAsDraft.enabled = false), so nobody has ever
  // had it here. Editing on a canvas makes losing the tab cost more than it
  // does in a form: the work is spread across blocks, not one field.
  config.experimental = {
    ...config.experimental,
    saveAsDraft: { ...config.experimental?.saveAsDraft, enabled: true },
  };

  // Inject the Volto-config-derived values the pure block-path / schema utils
  // need, so those modules carry NO static `@plone/volto/registry` import and can
  // be loaded (bare Node) by block-sanity's offline discovery. Lazy getters so a
  // later addon that changes a setting is still honoured. See injectedVoltoConfig.
  setInjectedVoltoConfig({
    applyBlockDefaults,
    getDefaultBlockType: () => config.settings.defaultBlockType,
    getBlocksConfig: () => config.blocks.blocksConfig,
    // #295: what a disallowed slate style is renamed to, and what it falls back
    // to. `settings.slate.defaultBlockType` is the slate ELEMENT default ('p'),
    // not `settings.defaultBlockType` (the BLOCK default, 'slate').
    getSlateStyleAliases: () => config.settings.slate?.styleAliases,
    getSlateDefaultBlockType: () => config.settings.slate?.defaultBlockType,
    // The vocabulary, derived rather than listed: the element registry is open
    // (a plugin writes into it), so anything that judges "is this type defined"
    // has to read it live. The style menu's cssClasses come too — a DS style is
    // stored as the node's `styleName` and is a style in the same sense.
    getSlateVocabulary: () => {
      const slate = config.settings.slate || {};
      const menu = slate.styleMenu || {};
      // `elements` answers "can the editor DRAW this", which is not the same as
      // "may this be STORED". volto-slate registers renderers for `table`/`td`/…
      // and `img`, but the block emitters (extractTables, extractImages) lift
      // those out of the slate value into blocks of their own — hydra turns a
      // pasted table into a `slateTable` BLOCK. They exist mid-paste and never
      // in saved content, so a stored one means extraction failed: reportable,
      // not permitted. Table types come from slate.tableTypes rather than a list
      // written here.
      const extracted = new Set([...(slate.tableTypes || []), 'img']);
      return [
        ...Object.keys(slate.elements || {}).filter((t) => !extracted.has(t)),
        ...[...(menu.blockStyles || []), ...(menu.inlineStyles || [])]
          .map((d) => d?.cssClass)
          .filter(Boolean)
          .map((c) => `.${c}`),
      ];
    },
  });

  // Patch setTimeout to catch focus errors from AddLinkForm
  // AddLinkForm does: setTimeout(() => this.input.focus(), 50)
  // But if component unmounts before 50ms, this.input is null and focus() throws
  // We wrap callbacks to catch these errors since we can't easily patch the HOC-wrapped class
  if (typeof window !== 'undefined' && !window._hydraSetTimeoutPatched) {
    window._hydraSetTimeoutPatched = true;
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = function (callback, delay, ...args) {
      if (typeof callback === 'function') {
        const wrappedCallback = function () {
          try {
            return callback.apply(this, arguments);
          } catch (e) {
            // Suppress focus errors from AddLinkForm unmount race condition
            if (
              e &&
              e.message &&
              e.message.includes("Cannot read properties of null (reading 'focus')")
            ) {
              // Silently ignore - component unmounted before setTimeout fired
              return;
            }
            throw e; // Re-throw other errors
          }
        };
        return originalSetTimeout.call(this, wrappedCallback, delay, ...args);
      }
      return originalSetTimeout.call(this, callback, delay, ...args);
    };
  }
  // Add reducers
  config.addonReducers.frontendPreviewUrl = frontendPreviewUrl;
  config.addonReducers.viewportPreset = viewportPreset;

  // HYDRA: keep settings.publicURL pinned to the currently selected
  // iframe frontend. publicURL in Hydra means "where this content is
  // served to end users" — which changes every time the editor picks a
  // different frontend in the toolbar switcher. RAZZLE_PUBLIC_URL is
  // therefore inapplicable; the middleware listens for the same Redux
  // action FrontendSwitcherPanel already dispatches.
  config.settings.storeExtenders = [
    ...(config.settings.storeExtenders || []),
    (stack) => [...stack, publicUrlSync],
  ];
  if (typeof window !== 'undefined') {
    // Boot value: pick the frontend the editor was last viewing (cookie
    // set by View.jsx), or the first env-default frontend on a fresh
    // session. Without this, settings.publicURL stays at Volto's stock
    // default until the first switch.
    const currentEditUrl =
      Cookies.get(getIframeUrlCookieName()) || getURlsFromEnv()[0]?.url;
    const initial = getCurrentFrontendPublicUrl(getSavedURLs(), currentEditUrl);
    if (initial) config.settings.publicURL = initial;
  }

  // Un-reserve frontend-only view routes so content pages can use those
  // names. Volto's getBaseUrl() strips any nonContentRoutes suffix from a
  // path — so a content page literally at /docs/examples/search resolves
  // to its parent /docs/examples ("the search view of /docs/examples"),
  // and the admin edits the wrong object. In a Hydra deployment the
  // frontend renders /search, /sitemap and /contact-form — the Volto
  // admin never does — so dropping them here lets authors name pages
  // freely. Admin-rendered views (/edit, /add, /contents, /controlpanel,
  // /login, /logout, /sharing, …) stay reserved.
  const hydraFrontendOnlyRoutes = ['/search', '/sitemap', '/contact-form'];
  config.settings.nonContentRoutes = (config.settings.nonContentRoutes || []).filter(
    (route) =>
      !(typeof route === 'string' && hydraFrontendOnlyRoutes.includes(route)),
  );

  // Frontend Switcher toolbar menu (viewport + frontend URL switching)
config.settings.additionalToolbarComponents = {
    ...config.settings.additionalToolbarComponents,
    frontendSwitcher: {
      component: FrontendSwitcherPanel,
      wrapper: null,
    },
    // Screens the CMS answers for itself. The button hides when no adapter
    // declared any, so a CMS happy with Volto's own screens adds nothing.
    nativeActions: {
      component: NativeActionsPanel,
      wrapper: null,
    },
  };

  // Register the toolbar plug as appExtras so Plug mounts in the App tree
  config.settings.appExtras = [
    ...(config.settings.appExtras || []),
    { match: '/', component: FrontendSwitcherPlug },
    { match: '/', component: NativeActionsPlug },
    { match: '/', component: SidebarToggleToolbarPlug },
    { match: '/', component: MobileSubmenuClose },
  ];

  // Array-aware url widget. A `widget: 'url'` field's value is the object-browser
  // link array ([{ '@id': url }], internal or external) — the shape the link/media
  // editor writes. Volto's stock UrlWidget is string-only and throws on it; this
  // one normalizes the array to its url string first.
  config.widgets.widget.url = ArrayAwareUrlWidget;

  // Hide container block fields - ChildBlocksWidget handles their UI
  config.widgets.widget.blocks_layout = HiddenBlocksWidget;

  // Hide object_list fields - items are edited via iframe selection
  config.widgets.widget.object_list = HiddenObjectListWidget;

  // Field mapping widget - for mapping source fields to target block fields
  config.widgets.widget.field_mapping = FieldMappingWidget;

  // Block-type select widget - choices computed from allowedBlocks at render time.
  // See README "Synchronised block types in a container".
  config.widgets.widget.blockTypeSelect = BlockTypeSelectWidget;
  config.widgets.widget.schemaFieldSelect = SchemaFieldSelectWidget;
  // Pick WHICH vocabulary, not a term from one — see the widget's own note for
  // why Volto's vocabulary widgets cannot do this.
  config.widgets.widget.vocabularySelect = VocabularySelectWidget;
  // Pick another BLOCK and store a field of it — a form's skip logic naming the
  // question it depends on, by label rather than by uid.
  config.widgets.widget.blockPicker = BlockPickerWidget;
  // Pick catalog indexes from what @querystring reports. Volto's search block
  // fills the same field imperatively from its Edit component, which a
  // JSON-schema frontend has no way to do.
  config.widgets.widget.querystringSelect = QuerystringSelectWidget;

  // Copy-from-target: mapped fields (via fieldMappings['@target']) are swapped
  // to this wrapper by installCopyFromTargetEnhancers, which renders the field's
  // real widget plus a per-field "reset to linked content" sync affordance.
  config.widgets.widget.copyFromTargetField = CopyFromTargetField;

  // Add the slate block in the sidebar with proper initialization.
  // blockSchema is used by applyBlockDefaults to set initial values for new blocks.
  //
  // We override `schema` to add the slate `value` field. Volto-slate registers
  // this from ./TextBlockSchema.js — a Settings-tab schema with placeholder /
  // instructions / fixed / disableNewBlocks / readOnly, and no `value` field.
  // Without `value` in blocksConfig.slate.schema, buildBlockPathMap's
  // pathMap._schemas for slate blocks doesn't reflect the slate body field,
  // and hydra.js's addNodeIdsToAllSlateFields can't recognize it (so
  // data-node-id never gets added in the iframe and slate selection sync
  // breaks).
  //
  // The Block-tab sidebar form is rendered by our shadowed
  // customizations/@plone/volto-slate/blocks/Text/DefaultTextBlockEditor.jsx,
  // which reads `blocksConfig.slate.schema` (this factory) directly so
  // there's a SINGLE source of truth for slate's schema. The schemaEnhancer
  // pattern (which used to add `value` at sidebar render via the variation
  // HOC) is gone — eliminating ~150 redundant per-slate enhancer re-runs in
  // buildBlockPathMap pass 2 on slate-heavy pages.
  config.blocks.blocksConfig.slate = {
    ...config.blocks.blocksConfig.slate,
    // initialValue is called by Volto's _applyBlockInitialValue when adding new blocks
    // This ensures slate blocks get proper initial structure (hydra.js adds nodeIds)
    initialValue: ({ id, value }) => ({
      ...value,
      value: value.value || config.settings.slate.defaultValue(),
    }),
    schema: (props) => {
      // We expose only the Block-tab schema (./schema.js — TOC settings:
      // override_toc / level / entry_text) plus the slate body field.
      //
      // We deliberately don't include Volto-slate's Settings-tab schema
      // (./TextBlockSchema.js — placeholder / instructions / required /
      // fixed / disableNewBlocks / readOnly):
      //   - `fixed` and `readOnly` are surfaced separately by
      //     ParentBlocksWidget's template-block-settings schema and would
      //     duplicate in template-edit mode.
      //   - `placeholder` / `instructions` are template-author-only fields
      //     that the previous Volto Hydra slate sidebar didn't expose.
      //   - These fields are still honored at runtime (block.fixed,
      //     block.readOnly, etc. read straight from data).
      const blockTab = typeof _slateBlockTabSchema === 'function'
        ? _slateBlockTabSchema(props?.formData || props?.data || {})
        : _slateBlockTabSchema;
      const blockTabFields = blockTab?.fieldsets?.[0]?.fields || [];
      // Placeholder text for the slate body. props.intl may not be passed
      // (e.g. when called by buildBlockPathMap via getBlockTypeSchema with
      // intl=undefined), so fall back to the i18n message default.
      const placeholder = props?.intl?.formatMessage
        ? props.intl.formatMessage(messages.typeText)
        : messages.typeText.defaultMessage;
      return {
        title: blockTab?.title || 'Slate',
        fieldsets: [
          {
            id: 'default',
            title: 'Default',
            fields: ['value', ...blockTabFields, 'anchor'],
          },
          ...(blockTab?.fieldsets?.slice(1) || []),
        ],
        properties: {
          // Default lives HERE, on the field, not only in the initialValue
          // hook above. initialValue is called by _applyBlockInitialValue,
          // which only the add-block flow runs; every other way a slate block
          // comes into being — ensureEmptyBlockIfEmpty seeding an empty
          // container, initialBlocks for a new page, a template slot — goes
          // through applyBlockDefaults, which reads schema defaults. Without
          // this a slate block could exist with no value, and the frontend
          // would render its empty-state placeholder with no addressable slate
          // node, which disables selection sync for the block.
          value: {
            title: 'Body',
            widget: 'slate',
            placeholder,
            default: config.settings.slate.defaultValue(),
          },
          ...(blockTab?.properties || {}),
          // Permanent fragment id for a heading block. Frontends render it as
          // the heading's id, so links and tables of contents survive the
          // heading being retitled (text-derived slugs don't). Empty = the
          // frontend falls back to a stable automatic id (the block uid).
          anchor: {
            title: 'Anchor',
            description:
              'Permanent link id for this heading. Leave empty for an automatic id.',
            type: 'string',
          },
        },
        required: blockTab?.required || [],
      };
    },
    sidebarTab: 1,
    mostUsed: true,
  };

  // Title block: renders page title with placeholder hint
  config.blocks.blocksConfig.title = {
    ...config.blocks.blocksConfig.title,
    blockSchema: ({ intl: blockIntl }) => ({
      title: 'Title',
      fieldsets: [{ id: 'default', title: 'Default', fields: ['title'] }],
      properties: {
        title: {
          title: 'Title',
          type: 'string',
          placeholder: blockIntl.formatMessage(messages.typeTitle),
        },
      },
      required: [],
    }),
  };

  // Description block: renders page description with placeholder hint
  config.blocks.blocksConfig.description = {
    ...config.blocks.blocksConfig.description,
    blockSchema: ({ intl: blockIntl }) => ({
      title: 'Description',
      fieldsets: [{ id: 'default', title: 'Default', fields: ['description'] }],
      properties: {
        description: {
          title: 'Description',
          type: 'string',
          widget: 'textarea',
          placeholder: blockIntl.formatMessage(messages.addDescription),
        },
      },
      required: [],
    }),
  };

  // Video block: placeholder for URL input
  config.blocks.blocksConfig.video = {
    ...config.blocks.blocksConfig.video,
    schemaEnhancer: ({ schema, intl: blockIntl }) => {
      if (schema.properties.url) {
        schema.properties.url = { ...schema.properties.url, placeholder: blockIntl.formatMessage(messages.videoPlaceholder) };
      }
      return schema;
    },
  };

  // Maps block: placeholder for embed URL input
  config.blocks.blocksConfig.maps = {
    ...config.blocks.blocksConfig.maps,
    schemaEnhancer: ({ schema, intl: blockIntl }) => {
      if (schema.properties.url) {
        schema.properties.url = { ...schema.properties.url, placeholder: blockIntl.formatMessage(messages.mapsPlaceholder) };
      }
      return schema;
    },
  };

  // HTML block: placeholder for code input
  config.blocks.blocksConfig.html = {
    ...config.blocks.blocksConfig.html,
    schemaEnhancer: ({ schema, intl: blockIntl }) => {
      if (schema.properties.html) {
        schema.properties.html = { ...schema.properties.html, placeholder: blockIntl.formatMessage(messages.htmlPlaceholder) };
      }
      return schema;
    },
  };

  // Override Slate hotkeys: use Ctrl+Shift+S for strikethrough (del) instead of Ctrl+S
  // This frees Ctrl+S for the standard "save" action that users expect
  if (config.settings.slate?.hotkeys) {
    const { 'mod+s': removed, ...otherHotkeys } = config.settings.slate.hotkeys;
    config.settings.slate.hotkeys = {
      ...otherHotkeys,
      'mod+shift+s': { format: 'del', type: 'inline' },
    };
  }

  // Image block: url field is added to blockSchema (not schemaEnhancer) so that
  // a frontend-supplied schemaEnhancer recipe doesn't overwrite it when it
  // replaces the block's schemaEnhancer.

  // Configure slateTable block schema for buildBlockPathMap traversal
  // Structure: block.table.rows[].cells[] with 'key' as idField
  // Sidebar titles are derived from field names: "rows" -> "Row", "cells" -> "Cell"
  // Note: We use dataPath to tell traversal where data lives WITHOUT nesting
  // inside widget: 'object', which would cause applySchemaDefaults to corrupt array data.
  // disableCustomSidebarEditForm: TableBlockEdit expects specific data structures that don't
  // work well when rendered in sidebar - use schema form instead.
  config.blocks.blocksConfig.slateTable = {
    ...config.blocks.blocksConfig.slateTable,
    disableCustomSidebarEditForm: true,
    addMode: 'table', // Double-nested structure: rows contain cells, enables column add and row cell-count copying
    blockSchema: (props) => {
      const baseSchema = TableBlockSchema(props);
      return {
        ...baseSchema,
        properties: {
          ...baseSchema.properties,
          // #245: rows nest inside the `table` object (block.table.rows) as a
          // first-class widget:'object' — no dataPath. The pathMap recurses into
          // the object and resolves the object_list relative to it.
          table: {
            widget: 'object',
            schema: {
              fieldsets: [{ id: 'default', title: 'Table', fields: ['rows'] }],
              properties: {
                rows: {
                  widget: 'object_list',
                  idField: 'key',
                  addMode: 'table',
                  schema: {
                    fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
                    properties: {
                      cells: {
                        widget: 'object_list',
                        idField: 'key',
                        schema: {
                          fieldsets: [{ id: 'default', title: 'Default', fields: ['value'] }],
                          properties: {
                            value: {
                              title: 'Content',
                              widget: 'slate',
                              default: [{ type: 'p', children: [{ text: '' }] }],
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
    },
  };



  // Configure listing block to use variation as item type selector
  // The existing variation field is repurposed to select the block type for rendering items
  // expandListingBlocks reads from 'variation' field via itemTypeField option
  //
  // Fully declarative schemaEnhancer composed from recipe parts:
  // - existingListingSchemaEnhancer: Volto's core listing enhancer (handles variations)
  // - inheritSchemaFrom: type selector + block sync
  // - fieldRules: admin-only field modifications (hide b_size, add fieldMapping)
  const existingListingSchemaEnhancer =
    config.blocks.blocksConfig.listing?.schemaEnhancer;
  const listingSchemaEnhancer = createSchemaEnhancerFromRecipe([
    existingListingSchemaEnhancer,
    {
      inheritSchemaFrom: {
        mappingField: 'fieldMapping',
        defaultsField: 'itemDefaults',
        blocksField: '..',
        filterConvertibleFrom: '@default',
        title: 'Item Type',
        default: 'summary',
      },
    },
    {
      fieldRules: {
        'querystring.b_size': false,
        fieldMapping: {
          set: {
            title: 'Field Mapping',
            widget: 'field_mapping',
            sourceFields: QUERY_RESULT_FIELDS,
            description: 'Map query result fields to item block fields',
            fieldset: { id: 'mapping', title: 'Field Mapping' },
          },
        },
      },
    },
  ]);
  config.blocks.blocksConfig.listing = {
    ...config.blocks.blocksConfig.listing,
    itemTypeField: 'variation',
    schemaEnhancer: listingSchemaEnhancer,
    // Volto core ships listing with 3 template variations (default/imageGallery/summary)
    // for its built-in render path. Hydra renders listing items via expandListingBlocks
    // in the user's frontend, but Volto's admin-side ListingBody.jsx still mounts a
    // template component, so we keep one passthrough entry. Critically, reducing the
    // array to length === 1 stops Volto's withVariationSchemaEnhancer from
    // wholesale-replacing the `variation` field definition (it only fires for
    // variations.length > 1) — that's what would wipe our `widget: 'blockTypeSelect'`.
    variations: [
      {
        id: 'default',
        isDefault: true,
        title: 'Default',
        template: () => null,
      },
    ],
  };

  // Configure image block with blockSchema for block sync
  // The default image block only has 'schema' (settings), not 'blockSchema' (data schema)
  // We add 'url' field here (not in schemaEnhancer) so a frontend-supplied
  // schemaEnhancer recipe doesn't lose it when it replaces the schemaEnhancer.
  config.blocks.blocksConfig.image = {
    ...config.blocks.blocksConfig.image,
    mostUsed: true,
    blockSchema: (props) => {
      // applyBlockDefaults passes 'data', but ImageSchema expects 'formData'
      const formData = props.formData || props.data || {};
      const baseSchema = ImageSchema({ ...props, formData });
      return {
        ...baseSchema,
        fieldsets: [
          {
            ...baseSchema.fieldsets[0],
            fields: ['url', ...(baseSchema.fieldsets[0]?.fields || [])],
          },
          ...(baseSchema.fieldsets.slice(1) || []),
        ],
        properties: {
          ...baseSchema.properties,
          url: {
            title: 'Image URL',
            widget: 'image',
            placeholder: props.intl?.formatMessage(messages.imagePlaceholder) || 'Browse the site or type a URL',
          },
        },
      };
    },
    fieldMappings: {
      '@default': { '@id': 'href', 'title': 'alt', 'image': 'url' },
      // Converting from teaser block
      teaser: { 'href': 'href', 'title': 'alt', 'preview_image': 'url' },
    },
  };

  // Default result item for listings (simple title + description)
  // Matches Volto's DefaultResultItem variation
  config.blocks.blocksConfig.default = {
    ...config.blocks.blocksConfig.default,
    id: 'default',
    title: 'Default',
    restricted: true,
    blockSchema: () => ({
      title: 'Default Item',
      fieldsets: [{ id: 'default', title: 'Default', fields: ['href', 'title', 'description'] }],
      properties: {
        href: { title: 'Link', widget: 'url' },
        title: { title: 'Title' },
        description: { title: 'Description', widget: 'textarea' },
      },
      required: [],
    }),
    fieldMappings: {
      '@default': { '@id': 'href', 'title': 'title', 'description': 'description' },
    },
  };

  // Summary result item for listings (title + description + image)
  // Matches Volto's SummaryResultItem variation - the default for listings
  config.blocks.blocksConfig.summary = {
    ...config.blocks.blocksConfig.summary,
    id: 'summary',
    title: 'Summary',
    restricted: true,
    blockSchema: () => ({
      title: 'Summary Item',
      fieldsets: [{ id: 'default', title: 'Default', fields: ['href', 'title', 'description', 'image'] }],
      properties: {
        href: { title: 'Link', widget: 'url' },
        title: { title: 'Title' },
        description: { title: 'Description', widget: 'textarea' },
        image: { title: 'Image', widget: 'url' },
      },
      required: [],
    }),
    fieldMappings: {
      '@default': { '@id': 'href', 'title': 'title', 'description': 'description', 'image': 'image' },
    },
  };

  // Teaser block - add fieldMappings so it appears in listing item type dropdown
  config.blocks.blocksConfig.teaser = {
    ...config.blocks.blocksConfig.teaser,
    fieldMappings: {
      '@default': { '@id': 'href', 'title': 'title', 'description': 'description', 'image': 'preview_image' },
      // Converting from image block
      image: { 'href': 'href', 'alt': 'title', 'url': 'preview_image' },
    },
  };

  // Facet block types for typed object_list in search block
  // Each facet type has its own schema, resolved via blocksConfig
  // Shared field definitions for facet schemas
  const facetFieldDef = {
    title: 'Field',
    widget: 'select_querystring_field',
    vocabulary: { '@id': 'plone.app.vocabularies.MetadataFields' },
  };
  // Facet field mappings — explicit type-to-type using checkboxFacet as hub.
  // All facet types share the same core fields (title, field, hidden).
  // @default is NOT used here because these fields are facet-specific,
  // not from the canonical @default type (@id, title, description, image).
  const facetBaseFields = { title: 'title', field: 'field', hidden: 'hidden' };
  const facetHubMappings = {
    selectFacet: facetBaseFields,
    daterangeFacet: facetBaseFields,
    toggleFacet: facetBaseFields,
  };
  const facetSpokeMappings = { checkboxFacet: facetBaseFields };

  config.blocks.blocksConfig.checkboxFacet = {
    ...config.blocks.blocksConfig.checkboxFacet,
    id: 'checkboxFacet',
    title: 'Checkbox',
    icon: filterSVG,
    group: 'common',
    restricted: true,
    fieldMappings: facetHubMappings,
    blockSchema: () => ({
      title: 'Checkbox Facet',
      fieldsets: [
        {
          id: 'default',
          title: 'Default',
          fields: ['title', 'field', 'multiple', 'hidden'],
        },
      ],
      properties: {
        title: { title: 'Label', type: 'string' },
        field: facetFieldDef,
        multiple: {
          title: 'Multiple choices?',
          type: 'boolean',
          default: false,
        },
        hidden: { title: 'Hide facet?', type: 'boolean', default: false },
      },
      required: [],
    }),
  };

  config.blocks.blocksConfig.selectFacet = {
    ...config.blocks.blocksConfig.selectFacet,
    id: 'selectFacet',
    title: 'Select',
    icon: filterSVG,
    group: 'common',
    restricted: true,
    fieldMappings: facetSpokeMappings,
    blockSchema: () => ({
      title: 'Select Facet',
      fieldsets: [
        {
          id: 'default',
          title: 'Default',
          fields: ['title', 'field', 'hidden'],
        },
      ],
      properties: {
        title: { title: 'Label', type: 'string' },
        field: facetFieldDef,
        hidden: { title: 'Hide facet?', type: 'boolean', default: false },
      },
      required: [],
    }),
  };

  config.blocks.blocksConfig.daterangeFacet = {
    ...config.blocks.blocksConfig.daterangeFacet,
    id: 'daterangeFacet',
    title: 'Date Range',
    icon: filterSVG,
    group: 'common',
    restricted: true,
    fieldMappings: facetSpokeMappings,
    blockSchema: () => ({
      title: 'Date Range Facet',
      fieldsets: [
        {
          id: 'default',
          title: 'Default',
          fields: ['title', 'field', 'hidden'],
        },
      ],
      properties: {
        title: { title: 'Label', type: 'string' },
        field: facetFieldDef,
        hidden: { title: 'Hide facet?', type: 'boolean', default: false },
      },
      required: [],
    }),
  };

  config.blocks.blocksConfig.toggleFacet = {
    ...config.blocks.blocksConfig.toggleFacet,
    id: 'toggleFacet',
    title: 'Toggle',
    icon: filterSVG,
    group: 'common',
    restricted: true,
    fieldMappings: facetSpokeMappings,
    blockSchema: () => ({
      title: 'Toggle Facet',
      fieldsets: [
        {
          id: 'default',
          title: 'Default',
          fields: ['title', 'field', 'hidden'],
        },
      ],
      properties: {
        title: { title: 'Label', type: 'string' },
        field: facetFieldDef,
        hidden: { title: 'Hide facet?', type: 'boolean', default: false },
      },
      required: [],
    }),
  };

  // Configure search block to add listing container field and typed facets
  // Facets converted to typed object_list: allowedBlocks controls facet types
  const existingSearchSchemaEnhancer =
    config.blocks.blocksConfig.search?.schemaEnhancer;
  config.blocks.blocksConfig.search = {
    ...config.blocks.blocksConfig.search,
    // Skip Volto's SearchBlockEdit — it renders BlockDataForm without block prop,
    // causing onChangeBlock(undefined, data) when schema defaults are applied.
    // Our ParentBlocksWidget renders BlockDataForm with block={blockId} correctly.
    disableCustomSidebarEditForm: true,
    schemaEnhancer: (args) => {
      let { schema } = args;

      // Defensive check - schema must exist
      if (!schema || !schema.properties) {
        return schema;
      }

      // Run existing schemaEnhancer first
      if (existingSearchSchemaEnhancer) {
        schema = existingSearchSchemaEnhancer(args);
      }

      // Add listing container field for child listing block
      // allowedBlocks includes 'listing' (container) + item types for the variation dropdown
      if (schema.properties && !schema.properties.listing) {
        schema.properties.listing = {
          title: 'Results Listing',
          widget: 'blocks_layout',
          description: 'Listing block to render search results',
          allowedBlocks: ['listing', 'default', 'summary', 'teaser', 'image'],
          maxLength: 1,
          defaultBlockType: 'listing',
        };
      }

      // Convert facets to typed object_list: each facet type has its own schema
      // from blocksConfig (checkboxFacet, selectFacet, etc.)
      // Keep Volto's original schema (needed by Volto's form rendering to avoid crashes)
      // but add allowedBlocks + typeField so processObjectListContainer uses typed mode
      if (schema.properties.facets) {
        schema.properties.facets = {
          ...schema.properties.facets,
          allowedBlocks: [
            'checkboxFacet',
            'selectFacet',
            'daterangeFacet',
            'toggleFacet',
            'slate',
            'image',
          ],
          typeField: 'type',
        };
        // Remove schemaExtender (would override our typed behavior)
        delete schema.properties.facets.schemaExtender;
      }

      // Remove fields not needed for Hydra (query handled by child listing, no views selector)
      // Facets are edited via iframe selection, not the accordion widget
      // Keep showSortOn/sortOnOptions (sort dropdown controls), facetsTitle, and controls fieldset
      const fieldsToRemove = [
        'query',
        'availableViews', // Results template - not needed, handled by listing child
      ];
      // Keep 'facets' fieldset - facetsTitle shows, facets object_list hidden by HiddenObjectListWidget
      const fieldsetsToRemove = ['searchquery', 'views'];

      // Remove from fieldsets
      schema.fieldsets = (schema.fieldsets || [])
        .filter((fs) => !fieldsetsToRemove.includes(fs.id))
        .map((fs) => ({
          ...fs,
          fields: fs.fields.filter((f) => !fieldsToRemove.includes(f)),
        }));

      // Remove from properties
      fieldsToRemove.forEach((field) => {
        delete schema.properties[field];
      });

      return schema;
    },
  };

  const updateAllowedBlocks = () => {
    const allowedBlocksList = getAllowedBlocksList();
    const defaultAllowedBlocks = ['slate', 'image'];

    for (const key in config.blocks.blocksConfig) {
      config.blocks.blocksConfig[key].restricted =
        allowedBlocksList && allowedBlocksList.length > 0
          ? !allowedBlocksList.includes(key)
          : !defaultAllowedBlocks.includes(key);
    }
  };
  // Subscribe to changes in the allowed blocks list
  subscribeToAllowedBlocksListChanges(updateAllowedBlocks);

  // Initial call to set the blocks based on the initial state
  updateAllowedBlocks();

  // What a new document starts with.
  //
  // Keyed by CONTENT TYPE, and every key here used to be a Plone type name, so
  // a new document on any other CMS started with no blocks at all — both
  // WordPress and Drupal report their page type as 'page'. The admin is meant
  // to be CMS-agnostic, so the same starting blocks are registered for the
  // page types the other adapters report.
  //
  // Still a gap: this is a list of known type names rather than a default for
  // any type, so a CMS whose page type is called something else is back to
  // starting empty. Fixing that properly means a fallback in Volto's
  // initialBlocks lookup, which is core behaviour rather than config.
  const INITIAL_BLOCKS = [
    { '@type': 'title' },
    {
      '@type': 'slate',
      value: [{ type: 'p', children: [{ text: '' }] }],
    },
  ];
  config.blocks.initialBlocks = {
    Document: INITIAL_BLOCKS,
    page: INITIAL_BLOCKS,
    post: INITIAL_BLOCKS,
  };

  // Generic block actions registry
  // Actions can be referenced by ID in pathMap and rendered in toolbar/dropdown
  // Each action defines: label, icon (SVG import), and the action is dispatched by ID
  config.settings.hydraActions = {
    addRowBefore: { label: 'Add Row Before', icon: rowBeforeSVG },
    addRowAfter: { label: 'Add Row After', icon: rowAfterSVG },
    addColumnBefore: { label: 'Add Column Before', icon: columnBeforeSVG },
    addColumnAfter: { label: 'Add Column After', icon: columnAfterSVG },
    deleteRow: { label: 'Remove Row', icon: rowDeleteSVG },
    deleteColumn: { label: 'Remove Column', icon: columnDeleteSVG },
  };

  // Add "templates" group to block chooser
  config.blocks.groupBlocksOrder = [
    ...(config.blocks.groupBlocksOrder || []),
    { id: 'templates', title: 'Templates' },
  ];

  // Fix volto-slate extractTables bugs:
  // 1. Creates @type:'table' but blocksConfig registers it as 'slateTable'.
  // 2. Cell values are bare text nodes [{ text:'Name' }] because the HTML
  //    deserializer doesn't wrap TD/TH text children in paragraphs. Normalize
  //    them to [{ type:'p', children:[{ text:'Name' }] }] to match the format
  //    Volto produces when creating tables normally.
  // Wrap the entire emitter array with a getter so fixes apply regardless of
  // addon load order (extractTables may be added after our config runs).
  // Register backspaceListItem extension — Backspace at start of a non-first
  // list item demotes it to a paragraph and splits the block.
  // Also remove the old backspaceInList keyboard handler which merges list
  // items instead of demoting them.
  if (config.settings.slate) {
    // Replace volto-slate's StyleMenu with one that portals out of the toolbar.
    // Its semantic Dropdown renders the menu inline, and the quanta toolbar is a
    // fixed-height bar with `overflow: hidden` — the menu opened above the bar,
    // outside its box, and was clipped away entirely. See StyleDropdown.
    config.settings.slate.buttons = {
      ...config.settings.slate.buttons,
      styleMenu: (props) => <StyleDropdown {...props} />,
    };

    const { backspaceListItem } = require('./extensions/backspaceListItem');
    // Register as a base editor extension so it applies to ALL Slate editors
    // (sidebar widgets, synced toolbar, etc.) — not just textblock editors.
    config.settings.slate.extensions = [
      ...(config.settings.slate.extensions || []),
      backspaceListItem,
    ];
    // Remove old keyboard handler that merges list items instead of demoting.
    // Our deleteBackward extension replaces this behavior.
    const handlers = config.settings.slate.textblockKeyboardHandlers;
    if (handlers?.Backspace) {
      handlers.Backspace = handlers.Backspace.filter(
        (h) => h.name !== 'backspaceInList',
      );
    }
  }

  if (config.settings.slate) {
    const fixTableBlock = (blockData) => {
      if (blockData['@type'] === 'table') {
        blockData['@type'] = 'slateTable';
      }
      for (const row of blockData.table?.rows || []) {
        for (const cell of row.cells || []) {
          if (
            cell.value?.length > 0 &&
            cell.value.every((n) => typeof n.text === 'string' && !n.type)
          ) {
            cell.value = [{ type: 'p', children: cell.value }];
          }
        }
      }
    };

    // Use a getter on the slate config so we intercept the emitter array
    // at call time, not at config time. This way even emitters added by
    // addons that install after us get wrapped.
    let _emiters = config.settings.slate.voltoBlockEmiters || [];
    let _wrappedEmiters = null;
    let _wrappedSource = null;
    Object.defineProperty(config.settings.slate, 'voltoBlockEmiters', {
      get() {
        // Re-wrap only when the source array changes
        if (_wrappedSource !== _emiters) {
          _wrappedSource = _emiters;
          _wrappedEmiters = _emiters.map((emitter) => {
            return (editor, pathRef) => {
              const blocks = emitter(editor, pathRef);
              for (const [, blockData] of blocks) {
                fixTableBlock(blockData);
              }
              return blocks;
            };
          });
        }
        return _wrappedEmiters;
      },
      set(val) {
        _emiters = val;
        _wrappedSource = null; // Invalidate cache
      },
      configurable: true,
      enumerable: true,
    });
  }

  return config;
};

export default applyConfig;
