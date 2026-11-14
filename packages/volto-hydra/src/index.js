import { defineMessages } from 'react-intl';

const messages = defineMessages({
  typeText: {
    id: 'Type text…',
    defaultMessage: 'Type text…',
  },
});
import frontendPreviewUrl, { viewportPreset } from './reducers';
import FrontendSwitcherPlug from './components/Toolbar/FrontendSwitcherPlug';
import ClearFormattingButton from './components/Toolbar/ClearFormattingButton';
import formatClearIcon from '@plone/volto/icons/format-clear.svg';
import SidebarToggleToolbarPlug from './components/Toolbar/SidebarToggleToolbarPlug';
import FrontendSwitcherPanel from './components/Toolbar/FrontendSwitcherPanel';
import MobileSubmenuClose from './components/Toolbar/MobileSubmenuClose';
import AgentSite from './components/AgentSite/AgentSite';
import ConnectAgent from './components/ConnectAgent/ConnectAgent';
import rememberedFrontendUrl from './utils/getRememberedFrontendUrl';
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
import TableSchema from '@plone/volto-slate/blocks/Table/schema';
// Volto-slate ships TWO schemas for the slate block:
//   ./schema.js          → "Block tab" form (override_toc / level / entry_text)
//   ./TextBlockSchema.js → "Settings tab" form (placeholder / instructions /
//                          fixed / disableNewBlocks / readOnly)
// We merge both into one schema below so Volto Hydra's single sidebar
// surface shows everything.
import _slateBlockTabSchema from '@plone/volto-slate/blocks/Text/schema';
import {
  QUERY_RESULT_FIELDS,
  createSchemaEnhancerFromRecipe,
} from './utils/blockSync';
import rowBeforeSVG from '@plone/volto/icons/row-before.svg';
import rowAfterSVG from '@plone/volto/icons/row-after.svg';
import rowDeleteSVG from '@plone/volto/icons/row-delete.svg';
import columnBeforeSVG from '@plone/volto/icons/column-before.svg';
import './components/mobile-tablet.css';
import './components/admin-chrome.css';
import columnAfterSVG from '@plone/volto/icons/column-after.svg';
import columnDeleteSVG from '@plone/volto/icons/column-delete.svg';
import { applyBlockDefaults } from '@plone/volto/helpers';
import { setInjectedVoltoConfig } from './utils/injectedVoltoConfig';
import StyleDropdown from './components/Toolbar/StyleDropdown';
import { regionGatedLinkButton } from './components/Toolbar/regionRules';
import { installLinkEditor } from './components/Toolbar/LinkEditor';
import { noStore } from './express-middleware/noStore';
import { apiAcceptEncoding } from './express-middleware/apiAcceptEncoding';
import { registerRuleErrorValidators } from '@volto-hydra/helpers/blockFieldErrors.js';

// The only blocks Inka's admin registers itself. Every other block a site uses
// is the frontend's to declare (its blocks config, sent at initBridge).
export const ADMIN_BLOCK_TYPES = ['slate', 'listing'];

const applyConfig = (config) => {
  // No shared cache keeps an editor's page (express-middleware/noStore.js).
  if (__SERVER__) {
    config.settings.expressMiddleware = [
      // First: it sets what the API proxy (Volto's devproxy) asks the API
      // for, so it must run before it (express-middleware/apiAcceptEncoding.js).
      apiAcceptEncoding,
      ...(config.settings.expressMiddleware || []),
      noStore,
    ];
  }

  // A fieldRules `error` refuses the save, as any Volto validator's does. The
  // offline content check registers the same (@volto-hydra/helpers/blockFieldErrors.js).
  registerRuleErrorValidators(config);

  // A text link picked from the object browser keeps the picked item beside
  // its url (data.item), so a frontend can draw it from the item (a file's type
  // and size) without fetching it again.
  installLinkEditor(config);

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
      rememberedFrontendUrl() || getURlsFromEnv()[0]?.url;
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
  };

  // Register the toolbar plug as appExtras so Plug mounts in the App tree
  config.settings.appExtras = [
    ...(config.settings.appExtras || []),
    { match: '/', component: FrontendSwitcherPlug },
    { match: '/', component: SidebarToggleToolbarPlug },
    { match: '/', component: MobileSubmenuClose },
    // window.__inkaSite, the site-wide agent API (an MCP server drives it).
    { match: '/', component: AgentSite },
  ];
  // Where a person allows an agent on their computer (the MCP server) to act
  // as them: it signs in through the browser, as command-line tools do.
  config.addonRoutes = [
    ...(config.addonRoutes || []),
    { path: '/connect-agent', component: ConnectAgent, exact: true },
  ];

  // Array-aware url widget. A `widget: 'url'` field's value is the object-browser
  // link array ([{ '@id': url }], internal or external) — the shape the link/media
  // editor writes. Volto's stock UrlWidget is string-only and throws on it; this
  // one normalizes the array to its url string first.
  config.widgets.widget.url = ArrayAwareUrlWidget;

  // Hide container block fields - ChildBlocksWidget handles their UI
  config.widgets.widget.blocks_layout = HiddenBlocksWidget;

  // Hide object_list regions - items are edited via iframe selection. A plain
  // list (`subBlocks: false`) gets Volto's object-list widget instead.
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
          value: { title: 'Body', widget: 'slate', placeholder },
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

  // Override Slate hotkeys: use Ctrl+Shift+S for strikethrough (del) instead of Ctrl+S
  // This frees Ctrl+S for the standard "save" action that users expect
  if (config.settings.slate?.hotkeys) {
    const { 'mod+s': removed, ...otherHotkeys } = config.settings.slate.hotkeys;
    config.settings.slate.hotkeys = {
      ...otherHotkeys,
      'mod+shift+s': { format: 'del', type: 'inline' },
    };
  }



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
            // …and every metadata column the site's catalog holds, so its own
            // fields can be mapped too.
            vocabulary: { '@id': 'plone.app.vocabularies.MetadataFields' },
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

  // A frontend declares its own blocks: Inka's admin keeps only slate (the
  // rich text every region's text is written in) and listing (configured
  // above), and drops the rest Volto registers. A block the admin also had
  // kept the admin's keys under the frontend's own config: mappings written
  // for the admin's schema, onto fields the frontend's didn't have, and blocks
  // the frontend never sent (a teaser converting from an image by its link).
  for (const blockType of Object.keys(config.blocks.blocksConfig)) {
    if (!ADMIN_BLOCK_TYPES.includes(blockType)) delete config.blocks.blocksConfig[blockType];
  }

  const updateAllowedBlocks = () => {
    const allowedBlocksList = getAllowedBlocksList();
    const defaultAllowedBlocks = ['slate'];

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

  // No initial blocks of Inka's own, for any content type: a new page's
  // blocks fields start as any empty region does — its `default`, one block
  // of its `defaultBlockType`, or empty — which the frontend's page schema
  // decides (docs/frontend-guide/container-blocks.md).
  config.blocks.initialBlocks = {};

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
      // The sidebar's toolbar is Volto's, which knows no region rules; this
      // one hides the link button where the region refuses links, as the
      // canvas toolbar does. See regionRules.
      link: regionGatedLinkButton(config.settings.slate.buttons?.link),
      // Volto's Clear formatting is always enabled; Inka's is disabled when the
      // selection has nothing to clear. See ClearFormattingButton.
      clearformatting: (props) => (
        <ClearFormattingButton
          title="Clear formatting"
          icon={formatClearIcon}
          {...props}
        />
      ),
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
