/**
 * Shared block schema definitions used by both the test frontend (mock)
 * and the Nuxt example frontend for E2E tests.
 *
 * Single source of truth — prevents schema drift between frontends.
 */

const calloutIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 5a1.25 1.25 0 110 2.5A1.25 1.25 0 0112 7zm1.5 10h-3v-1.5h.75V12h-.75v-1.5h2.25V15.5h.75V17z"/></svg>';
const heroIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
const columnsIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="3" width="8" height="18" rx="1"/><rect x="14" y="3" width="8" height="18" rx="1"/></svg>';
const columnIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="1"/></svg>';
const sectionIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
const contextNavigationIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 6h14M3 12h10M3 18h14"/></svg>';
const navItemIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 12h14m-6-6 6 6-6 6"/></svg>';
const sliderIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="18" r="1.5"/><circle cx="12" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg>';
const slideIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
const tabIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><rect x="3" y="3" width="7" height="4" rx="1"/></svg>';
const accordionIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/></svg>';
const codeExampleIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const teaserIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>';
const formIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v2H4zm0 4h10v2H4zm0 4h16v2H4zm0 4h10v2H4z"/></svg>';
const highlightIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l3 6 6 .75-4.5 4.25L18 20l-6-3-6 3 1.5-7L3 8.75 9 8z"/></svg>';

// Block icons hoisted to named consts so a docs literalinclude of a block
// definition reads `icon: <name>Icon`, not a wall of inline SVG.
export const sharedBlocksConfig = {
    // A labelled admonition box (note / tip / warning / important). The level is
    // the block's `variation`; the body is a slate value. Mirrors the myst
    // ```{note} / ```{warning} directives so docs authored as blocks keep their
    // callouts (and a <block>->myst emitter maps variation back to the directive).
    callout: {
        id: 'callout',
        title: 'Callout',
        icon: calloutIcon,
        group: 'text',
        // The body is a region of child blocks (a blocks_layout field named
        // `items`), so it holds real markdown — multiple paragraphs, lists, code —
        // authored as blocks, not a single slate value or a data-json blob.
        allowedBlocks: ['slate'],
        variations: [
            { id: 'note', title: 'Note', isDefault: true },
            { id: 'tip', title: 'Tip' },
            { id: 'warning', title: 'Warning' },
            { id: 'important', title: 'Important' },
        ],
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['variation', 'items'] }],
            properties: {
                variation: {
                    title: 'Level',
                    choices: [['note', 'Note'], ['tip', 'Tip'], ['warning', 'Warning'], ['important', 'Important']],
                    default: 'note',
                },
                items: { widget: 'blocks_layout', allowedBlocks: ['slate'] },
            },
            required: [],
        },
    },
    slate: {
        id: 'slate',
        title: 'Text',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['value'] }],
            properties: {
                value: {
                    title: 'Text',
                    type: 'array',
                    widget: 'slate',
                    placeholder: 'Type text…',
                },
            },
            required: [],
        },
    },
    // Button block: a call-to-action with an inline-editable label and a
    // link. Registered here so the admin shows Label / Link / Alignment
    // sidebar fields.
    button: {
        id: 'button',
        title: 'Button',
        group: 'common',
        // Copy-from-target consumer: the button's Label (`title`) can be synced
        // from the linked content item's Title. `href` is the link field that
        // carries the target snapshot; declaring @target is the only opt-in.
        fieldMappings: {
            '@target': { title: 'title' },
        },
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'href', 'inneralign'] }],
            properties: {
                title: { title: 'Label' },
                href: { title: 'Link', widget: 'object_browser', mode: 'link' },
                inneralign: {
                    title: 'Alignment',
                    widget: 'select',
                    choices: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
                    default: 'left',
                },
            },
            required: [],
        },
    },
    hero: {
        id: 'hero',
        title: 'Hero',
        icon: heroIcon,
        group: 'common',
        mostUsed: true,
        blockSchema: {
            fieldsets: [
                {
                    id: 'default',
                    title: 'Default',
                    fields: ['heading', 'subheading', 'buttonText', 'buttonLink', 'image', 'description'],
                },
            ],
            properties: {
                heading: {
                    title: 'Heading',
                    type: 'string',
                    placeholder: 'Enter hero heading…',
                },
                subheading: {
                    title: 'Subheading',
                    type: 'string',
                    widget: 'textarea',
                    placeholder: 'Enter subheading…',
                },
                buttonText: {
                    title: 'Button Text',
                    type: 'string',
                },
                buttonLink: {
                    title: 'Button Link',
                    widget: 'object_browser',
                    mode: 'link',
                    allowExternals: true,
                },
                image: {
                    title: 'Image',
                    widget: 'image',
                },
                description: {
                    title: 'Description',
                    type: 'array',
                    widget: 'slate',
                },
            },
            required: [],
        },
        fieldMappings: {
            '@default': {
                'title': 'heading',
                'description': 'subheading',
                '@id': 'buttonLink',
                'image': 'image',
            },
            teaser: {
                'title': 'heading',
                'description': 'subheading',
                'href': 'buttonLink',
                'preview_image': 'image',
            },
        },
    },
    // Container block: columns contains column children. The columns
    // slot has allowedBlocks: ['column'] with no defaultBlockType — this
    // is the single-allowedBlock-fallback path that the
    // "Enter in container with single allowedBlock" test exercises.
    columns: {
        id: 'columns',
        title: 'Columns',
        icon: columnsIcon,
        group: 'common',
        // Ancestor restriction: no `columns` anywhere in a columns block's subtree,
        // even though a nested `column` cell otherwise allows it. Exercises
        // disallowDescendantBlocks end-to-end (add / DnD / type picker).
        disallowDescendantBlocks: ['columns'],
        blockSchema: {
            fieldsets: [
                {
                    id: 'default',
                    title: 'Default',
                    fields: ['title', 'columns'],
                },
            ],
            properties: {
                title: {
                    title: 'Title',
                    type: 'string',
                },
                columns: {
                    title: 'Columns',
                    widget: 'blocks_layout',
                    allowedBlocks: ['column'],
                    // No defaultBlockType - tests single allowedBlock path
                    maxLength: 4,
                },
            },
            required: [],
        },
    },
    // Nested container: column contains content blocks
    column: {
        id: 'column',
        title: 'Column',
        icon: columnIcon,
        group: 'common',
        blockSchema: {
            fieldsets: [
                {
                    id: 'default',
                    title: 'Default',
                    fields: ['title', 'items'],
                },
            ],
            properties: {
                title: {
                    title: 'Title',
                    type: 'string',
                },
                items: {
                    title: 'Content',
                    widget: 'blocks_layout',
                    // `columns` is allowed here so the columns ancestor's
                    // disallowDescendantBlocks has something to strip (proves the
                    // restriction, not a plain absence, blocks columns-in-columns).
                    allowedBlocks: ['slate', 'image', 'form', 'columns'],
                    defaultBlockType: 'slate',
                },
            },
            required: [],
        },
    },
    // Generic section container — accepts any block type. Used by the
    // container UX feature tests (wrap, unwrap, edge-drag, convert) and
    // as a reference shape for consumers who want a "section" block.
    // No allowedBlocks/defaultBlockType: getAllContainerFields cascades
    // both from the page (allowedBlocks → page's allowed list,
    // defaultBlockType → config.settings.defaultBlockType), so a fresh
    // empty section auto-fills with a typeable child of the page's
    // default type and "Enter on a section" lands the cursor inside.
    section: {
        id: 'section',
        title: 'Section',
        icon: sectionIcon,
        group: 'common',
        blockSchema: {
            fieldsets: [
                { id: 'default', title: 'Default', fields: [] },
            ],
            properties: {
                items: { widget: 'blocks_layout' },
            },
            required: [],
        },
    },
    // Context navigation container: renders a list of links as a sidebar
    // (desktop) / disclosure (mobile). Children are navItem blocks (hand-
    // added) and/or listing blocks (auto-populated via path/depth query).
    // The active link is detected at render time from URL match. Named
    // after Plone's @contextnavigation endpoint, which serves the same
    // purpose (sibling/child links scoped to the current context).
    contextNavigation: {
        id: 'contextNavigation',
        title: 'Context Navigation',
        icon: contextNavigationIcon,
        group: 'common',
        blockSchema: {
            fieldsets: [
                {
                    id: 'default',
                    title: 'Default',
                    fields: ['ariaLabel', 'expandCurrentOnly', 'includeTop', 'items'],
                },
            ],
            properties: {
                ariaLabel: {
                    title: 'Aria label',
                    type: 'string',
                    default: 'Section navigation',
                },
                expandCurrentOnly: {
                    // Smart-expansion: when true, only show items whose
                    // URL is on the path to (or within) the current page.
                    // Descendants of unrelated siblings are hidden. Matches
                    // the typical docs sidebar UX (Sphinx, Docusaurus, etc.).
                    title: 'Expand current section only',
                    type: 'boolean',
                    default: true,
                },
                includeTop: {
                    // Include the section root as the first item in the
                    // nav (e.g. show /concepts itself above /concepts/x).
                    // Matches Volto's `includeTop` contextnavigation param.
                    title: 'Include section root',
                    type: 'boolean',
                    default: false,
                },
                items: {
                    title: 'Items',
                    widget: 'blocks_layout',
                    allowedBlocks: ['navItem', 'listing'],
                    // No defaultBlockType — author picks which kind to add
                },
            },
            required: [],
        },
    },
    // Restricted nav-item child: a single link. Only valid inside
    // contextNavigation.items. Also used as a listing item type — when
    // the listing's variation is "navItem", query results are mapped
    // via fieldMappings.@default so href / label come out in the same
    // shape as manual authoring (object_browser array for href, string
    // for label). Indent level is derived at render time from URL depth.
    navItem: {
        id: 'navItem',
        title: 'Nav link',
        icon: navItemIcon,
        group: 'common',
        restricted: true,
        blockSchema: {
            fieldsets: [
                {
                    id: 'default',
                    title: 'Default',
                    fields: ['label', 'href'],
                },
            ],
            properties: {
                label: { title: 'Label', type: 'string' },
                href: {
                    title: 'Link',
                    widget: 'object_browser',
                    mode: 'link',
                    allowExternals: true,
                },
            },
            required: ['label'],
        },
        fieldMappings: {
            // Query result → navItem fields. `link` type wraps the @id
            // string as `[{ '@id': string }]` to match the object_browser
            // shape produced by manual authoring.
            '@default': {
                '@id': { field: 'href', type: 'link' },
                'title': 'label',
            },
        },
    },
    // Slider container: uses object_list widget (volto-slider-block format)
    // Slides are stored as array with @id instead of blocks/blocks_layout
    slider: {
        id: 'slider',
        title: 'Slider',
        icon: sliderIcon,
        group: 'common',
        schemaEnhancer: {
            inheritSchemaFrom: {
                defaultsField: 'itemDefaults',
            },
        },
        blockSchema: {
            fieldsets: [
                {
                    id: 'default',
                    title: 'Default',
                    fields: ['slides', 'variation', 'autoplayEnabled', 'autoplayDelay', 'autoplayJump', 'headline', 'headlineTag'],
                },
            ],
            properties: {
                headline: { title: 'Headline', type: 'string' },
                headlineTag: { title: 'Headline tag', widget: 'select', choices: [['h1','h1'],['h2','h2'],['h3','h3'],['h4','h4'],['h5','h5'],['h6','h6']] },
                slides: {
                    title: 'Slides',
                    widget: 'object_list',
                    itemTypeField: 'variation',  // sync trigger — names the sibling field
                    allowedBlocks: ['slide', 'image', 'listing', 'teaser'],
                    typeField: '@type',
                    defaultBlockType: 'slide',
                },
                variation: {
                    title: 'Item Type',
                    widget: 'blockTypeSelect',
                },
                autoplayEnabled: {
                    title: 'Autoplay Enabled',
                    type: 'boolean',
                    default: false,
                },
                autoplayDelay: {
                    title: 'Autoplay Delay',
                    type: 'integer',
                    default: 4000,
                },
                autoplayJump: {
                    title: 'Autoplay Jump',
                    type: 'boolean',
                    default: false,
                },
            },
            required: [],
        },
    },
    // Slide block: default child type for slider's typed object_list.
    // Same schema as the slider's original inline item schema.
    slide: {
        id: 'slide',
        title: 'Slide',
        icon: slideIcon,
        group: 'common',
        mostUsed: true,
        restricted: true, // Only used inside slider's typed object_list
        fieldMappings: {
            '@default': { '@id': 'href', 'title': 'title', 'description': 'description', 'image': 'preview_image' },
            image: { 'href': 'href', 'alt': 'title', 'url': 'preview_image' },
        },
        // No childBlockConfig needed — installChildBlockEnhancers auto-applies
        // hideParentOwnedFields. Parent (slider) has no mappingField and no
        // parentControlled config, so nothing is hidden by default.
        blockSchema: {
            title: 'Slide',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['head_title', 'title', 'description', 'preview_image', 'buttonText', 'href', 'hideButton', 'flagAlign'] }],
            properties: {
                // A plain string constraint, so a standard Volto validator is
                // reachable from a fixture. Every slide in the fixtures has a
                // title of 16 characters or fewer, so the rule is inert until a
                // test writes a long one on purpose.
                head_title: { title: 'Kicker', type: 'string', maxLength: 60 },
                // The slide's own link target, and which side its caption sits
                // on. Both are stored by the fixtures and read by the example
                // frontends (nuxt keys its card position off flagAlign), so an
                // author could see them on screen but not reach them.
                href: { title: 'Link', widget: 'object_browser', mode: 'link' },
                flagAlign: {
                    title: 'Caption Alignment',
                    widget: 'select',
                    choices: [['left', 'Left'], ['right', 'Right']],
                    default: 'left',
                },
                title: { title: 'Title', type: 'string' },
                description: { title: 'Description', type: 'string', widget: 'textarea' },
                preview_image: { title: 'Image Override', widget: 'object_browser', mode: 'image', allowExternals: true },
                buttonText: { title: 'Button Text', type: 'string' },
                hideButton: { title: 'Hide Button', type: 'boolean' },
            },
            required: [],
        },
    },
    // codeExample tab — used inside codeExample's typed `tabs` object_list, the
    // same way `slide` sits inside `slider`. Registered so content carrying
    // @type "tab" isn't flagged "used but not registered" (renders as its parent
    // codeExample's tab strip, not standalone).
    tab: {
        id: 'tab',
        title: 'Tab',
        icon: tabIcon,
        group: 'common',
        restricted: true, // Only used inside codeExample's typed object_list
        blockSchema: {
            title: 'Tab',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'language', 'code'] }],
            properties: {
                label: { title: 'Label', type: 'string' },
                language: { title: 'Language', type: 'string' },
                code: { title: 'Code', type: 'string', widget: 'textarea' },
            },
            required: [],
        },
    },
    // An accordion panel — the typed item of accordion's `panels` object_list
    // (restricted, like tab inside codeExample / socialLink inside socialLinks).
    // A panel is a title plus a content area (`items` blocks_layout).
    panel: {
        id: 'panel',
        title: 'Panel',
        group: 'common',
        restricted: true, // Only used inside accordion's typed object_list
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'items'] }],
            properties: {
                title: { title: 'Title', type: 'string' },
                items: { title: 'Content', widget: 'blocks_layout', defaultBlockType: 'slate' },
            },
            required: [],
        },
    },
    // Accordion block — panels as object_list items, each with title + content blocks
    accordion: {
        id: 'accordion',
        title: 'Accordion',
        icon: accordionIcon,
        group: 'common',
        blockSchema: {
            properties: {
                collapsed: { title: 'Collapsed', type: 'boolean' },
                filtering: { title: 'Filtering', type: 'boolean' },
                non_exclusive: { title: 'Allow multiple open', type: 'boolean' },
                right_arrows: { title: 'Arrows on the right', type: 'boolean' },
                panels: {
                    title: 'Panels',
                    widget: 'object_list',
                    schema: {
                        fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'items'] }],
                        properties: {
                            title: { title: 'Title', type: 'string' },
                            items: {
                                title: 'Content',
                                widget: 'blocks_layout',
                                // Accordion panels accept the general page-level content blocks
                                // (the demo panels hold separator/teaser/listing/slateTable, not
                                // just slate/image) — EXCEPT accordion itself, to prevent nesting
                                // accordions inside accordions.
                                allowedBlocks: [
                                    'slate', 'image', 'separator', 'teaser', 'listing', 'slateTable',
                                    'hero', 'columns', 'slider', 'gridBlock', 'section',
                                    'contextNavigation', 'codeExample', 'toc', 'highlight', 'introduction',
                                , 'accordion'],
                                defaultBlockType: 'slate',
                            },
                        },
                    },
                },
            },
        },
    },
    // Object-nested blocks_layout (#245): a `content` widget:'object' wrapper
    // whose `body` region is a blocks_layout. The object holds its OWN shared
    // `blocks` dict + `blocks_layout` — one level deeper than the block root
    // (data: block.content.blocks / block.content.blocks_layout.body). Exercises
    // the regionPath funnel path end-to-end.
    objectBlocks: {
        id: 'objectBlocks',
        title: 'Object Blocks',
        group: 'common',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['content'] }],
            properties: {
                content: {
                    widget: 'object',
                    schema: {
                        fieldsets: [{ id: 'default', title: 'Content', fields: ['headline', 'body'] }],
                        properties: {
                            // An inline-editable text field living directly on the
                            // object — written to block.content.headline.
                            headline: {
                                title: 'Headline',
                                widget: 'slate',
                                default: [{ type: 'p', children: [{ text: '' }] }],
                            },
                            // An inline-editable LINK field on the object — proves
                            // link editing routes through the central /-path API
                            // (writes block.content.href, not a flat key).
                            href: { title: 'Link', widget: 'object_browser', mode: 'link' },
                            body: {
                                title: 'Body',
                                widget: 'blocks_layout',
                                allowedBlocks: ['slate', 'image'],
                                defaultBlockType: 'slate',
                            },
                        },
                    },
                },
            },
        },
    },
    // Separator (horizontal rule) — a simple leaf block with no editable fields.
    // Registered so it's a valid page-level block (it's used across the docs
    // content and inside accordions); without this it isn't in the page's
    // allowedBlocks and the move/containment logic treats it as disallowed.
    separator: {
        id: 'separator',
        title: 'Separator',
        group: 'common',
        blockSchema: { properties: {} },
    },
    // Simple/core blocks used across the docs content but previously unregistered,
    // so they were excluded from the page-level allowed set (getPageAllowedBlocks
    // only includes registered blocks with an id). Minimal registration makes them
    // valid page blocks; the frontend still owns their rendering.
    // Both DO declare their inline-editable fields: the bridge refuses to promote
    // a field its schema doesn't declare as text (getFieldType returns undefined,
    // so restoreContentEditableOnFields skips it). An undeclared field renders a
    // data-edit-text annotation that can never be edited — which is what the
    // renderer has been emitting for these two since they were registered.
    search: {
        id: 'search',
        title: 'Search',
        group: 'common',
        blockSchema: {
            properties: {
                variation: { title: 'Variation' },
                query: { title: 'Query', widget: 'querystring' },
                listingBodyTemplate: { title: 'Results template' },
                showSearchInput: { title: 'Show search input', type: 'boolean' },
                showSortOn: { title: 'Show sort on', type: 'boolean' },
                showTotalResults: { title: 'Show total results', type: 'boolean' },
                sortOnOptions: { title: 'Sort on options', type: 'array' },
                facets: {
                  // Typed sub-items: each facet's `type` names its own block type,
                  // so the item is edited with THAT type's schema (the same shape
                  // slider.slides uses). A site can register another facet type and
                  // list it here without touching this schema.
                  title: 'Facets',
                  widget: 'object_list',
                  typeField: 'type',
                  allowedBlocks: ['checkboxFacet', 'selectFacet', 'daterangeFacet', 'toggleFacet'],
                  defaultBlockType: 'checkboxFacet',
                },
                headline: { title: 'Headline', type: 'string' },
                title: { title: 'Title', type: 'string' },
                facetsTitle: { title: 'Facets title', type: 'string' },
                // The quick-answer region only renders once a query has been
                // asked; the sample question is what data-block-selector-input
                // types to reveal it (query-reveal-page + query-reveal.spec).
                quickAnswerSample: { title: 'Sample question', type: 'string' },
                quickAnswer: {
                  title: 'Quick answer',
                  widget: 'blocks_layout',
                  allowedBlocks: ['quickAnswer'],
                },
                // The results region (docs/examples/search.md): a child listing
                // block under blocks_layout.listing. Undeclared, its children
                // render but never enter the pathMap — the exact orphan the
                // guardrail now refuses without exemptions. Mirrors the admin's
                // search schemaEnhancer (volto-hydra/src/index.js) EXACTLY —
                // that enhancer only adds the field when absent, so a diverging
                // fixture copy would win and change the sidebar.
                listing: {
                  title: 'Results Listing',
                  widget: 'blocks_layout',
                  description: 'Listing block to render search results',
                  allowedBlocks: ['listing', 'default', 'summary', 'teaser', 'image'],
                  maxLength: 1,
                  defaultBlockType: 'listing',
                },
            },
        },
    },
    quickAnswer: {
        id: 'quickAnswer',
        title: 'Quick answer',
        group: 'common',
        restricted: true,
        blockSchema: {
            properties: {
                answer: { title: 'Answer', type: 'string' },
            },
        },
    },
    heading: {
        id: 'heading',
        title: 'Heading',
        group: 'common',
        blockSchema: {
            properties: {
                alignment: { title: 'Alignment', widget: 'align' },
                tag: { title: 'Tag', widget: 'select', choices: [['h1','h1'],['h2','h2'],['h3','h3'],['h4','h4'],['h5','h5'],['h6','h6']] }, heading: { title: 'Heading', type: 'string' } },
        },
    },
    // slateTable has inline-editable cells, so it MUST declare its nested
    // structure — table (object) → rows (object_list) → cells (object_list) →
    // value (slate). A frontend's registered schema OVERRIDES the admin's
    // baseline (mock-parent + View.jsx), so an empty schema here erases the
    // table's rows/cells from the pathMap: they lose their pathInfo, cells
    // resolve as plain-string fields, and table-mode 2D cursor navigation never
    // engages (parentAddMode is undefined). Mirror the admin baseline exactly.
    slateTable: {
        id: 'slateTable',
        title: 'Table',
        group: 'common',
        addMode: 'table',
        blockSchema: {
            properties: {
                table: {
                    widget: 'object',
                    schema: {
                        properties: {
                            rows: {
                                widget: 'object_list',
                                idField: 'key',
                                addMode: 'table',
                                schema: {
                                    properties: {
                                        cells: {
                                            widget: 'object_list',
                                            idField: 'key',
                                            schema: {
                                                properties: {
                                                    value: { widget: 'slate' },
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
    },
    // Declared, not empty: the bridge promotes a field only if the block's
    // schema has it, so an empty schema makes every annotation on these blocks
    // dead — `data-edit-text="title"` on a map never becomes editable, however
    // correctly the frontend marked it up. Fields are the ones the fixtures
    // actually store.
    maps: {
        id: 'maps',
        title: 'Map',
        group: 'common',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'url', 'align'] }],
            properties: {
                title: { title: 'Title', type: 'string' },
                url: { title: 'Map URL', widget: 'url' },
                align: { title: 'Alignment', type: 'string', factory: 'Choice' },
            },
            required: [],
        },
    },
    video: { id: 'video', title: 'Video', group: 'common', blockSchema: { properties: {
        url: { title: 'Video URL', widget: 'url' },
        preview_image: { title: 'Preview image URL', widget: 'url' },
        align: { title: 'Alignment', widget: 'align' },
        autoplay: { title: 'Autoplay', type: 'boolean' },
        controls: { title: 'Show controls', type: 'boolean' },
        loop: { title: 'Loop', type: 'boolean' },
        muted: { title: 'Muted', type: 'boolean' },} } },
    // Cookie consent — the worked example for revealing the place a FIELD is
    // edited (docs/examples/cookie-consent.md). Its two authored fields are read
    // in two different places, each outside the block's own element and hidden
    // until its trigger is pressed, so each trigger names the field its half
    // holds: `data-block-selector="uid#message"` / `uid#analyticsPurpose`.
    cookieConsent: {
        id: 'cookieConsent',
        title: 'Cookie consent',
        blockSchema: {
            fieldsets: [
                { id: 'default', title: 'Default', fields: ['message', 'analyticsPurpose'] },
            ],
            properties: {
                message: {
                    title: 'Banner message',
                    type: 'array',
                    widget: 'slate',
                    description:
                        'Shown in the consent banner, at the foot of every page, until a visitor chooses.',
                },
                analyticsPurpose: {
                    title: 'Analytics cookies — what they are for',
                    type: 'string',
                    widget: 'textarea',
                    description:
                        'Shown beside the analytics tick box, inside the preferences dialog.',
                },
            },
            required: [],
        },
    },
    // Code example block: tabbed code display with syntax highlighting
    codeExample: {
        id: 'codeExample',
        title: 'Code Example',
        icon: codeExampleIcon,
        group: 'common',
        blockSchema: {
            fieldsets: [
                {
                    id: 'default',
                    title: 'Default',
                    fields: ['tabs'],
                },
            ],
            properties: {
                tabs: {
                    title: 'Code Tabs',
                    widget: 'object_list',
                    schema: {
                        fieldsets: [
                            {
                                id: 'default',
                                title: 'Default',
                                fields: ['label', 'language', 'code'],
                            },
                        ],
                        properties: {
                            label: {
                                title: 'Tab Label',
                                type: 'string',
                            },
                            language: {
                                title: 'Language',
                                widget: 'select',
                                choices: [
                                    ['javascript', 'JavaScript'],
                                    ['js', 'JavaScript'],
                                    ['jsx', 'JSX'],
                                    ['typescript', 'TypeScript'],
                                    ['ts', 'TypeScript'],
                                    ['vue', 'Vue'],
                                    ['svelte', 'Svelte'],
                                    ['astro', 'Astro'],
                                    ['python', 'Python'],
                                    ['php', 'PHP'],
                                    ['json', 'JSON'],
                                    ['html', 'HTML'],
                                    ['css', 'CSS'],
                                    // Shell and Markdown are staples of technical docs — shell
                                    // command snippets and, for a docs site about a Markdown
                                    // format, the Markdown source itself. Both `sh`/`bash` and
                                    // `md` aliases are accepted because that is how authors (and
                                    // markdown code fences) actually spell them.
                                    ['bash', 'Bash'],
                                    ['sh', 'Shell'],
                                    ['shell', 'Shell'],
                                    ['markdown', 'Markdown'],
                                    ['md', 'Markdown'],
                                    ['xml', 'XML'],
                                    ['text', 'Text'],
                                ],
                            },
                            code: {
                                title: 'Code',
                                type: 'string',
                                widget: 'textarea',
                            },
                        },
                        required: [],
                    },
                    default: [
                        { '@id': 'tab-1', label: 'JavaScript', language: 'javascript', code: '' },
                    ],
                },
            },
            required: [],
        },
    },
    // Grid block: block sync recipe
    // variation field is created by inheritSchemaFrom with computed choices
    // allowedBlocks on config controls what children can be added
    // blocksField: 'blocks_layout' tells inheritSchemaFrom to derive choices from it
    // When variation is set, BlockChooser only shows that type
    // Listing block: block sync for item types (summary, default, teaser)
    // filterConvertibleFrom: '@default' means only show types whose fieldMappings
    // include @default as a source (i.e., can convert from catalog brain fields)
    listing: {
        id: 'listing',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['variation', 'fieldMapping', 'headline', 'headlineTag', 'querystring'] }],
            properties: {
                fieldMapping: { title: 'Field mapping' },
                headline: { title: 'Headline', type: 'string' },
                headlineTag: { title: 'Headline tag', widget: 'select', choices: [['h1','h1'],['h2','h2'],['h3','h3'],['h4','h4'],['h5','h5'],['h6','h6']] },
                querystring: { title: 'Search criteria', widget: 'querystring' },
                query: { title: 'Query', widget: 'querystring' },
                variation: {
                    title: 'Item Type',
                    widget: 'blockTypeSelect',
                    filterConvertibleFrom: '@default',
                    default: 'summary',
                },
                // fieldMapping field is rendered by inheritSchemaFrom via mappingField
            },
        },
        schemaEnhancer: {
            inheritSchemaFrom: {
                typeField: 'variation',  // listing has no blocks field — declare on recipe
                mappingField: 'fieldMapping',
                defaultsField: 'itemDefaults',
                // Override the default "hide everything not in @default":
                // teaser has an `overwrite` meta-toggle that should remain
                // editable per-child so the user can override auto-populated
                // values for a specific teaser. Listing claims styling/link
                // fields uniformly across items; not the override toggle.
                parentControlled: {
                    teaser: ['head_title', 'openLinkInNewTab', 'styles'],
                },
            },
        },
    },
    // --- Example listing-variant blocks (reuse expandListingBlocks + a custom
    // fetchItems fetcher; render via the standard item types — no bespoke
    // renderer). See packages/helpers/index.js for the fetchers. ---
    relatedItemsListing: {
        id: 'relatedItemsListing',
        title: 'Related Items',
        group: 'common',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['relationField', 'variation', 'fieldMapping'] }],
            properties: {
                relationField: {
                    title: 'Relation field',
                    description: 'Which relation field to render (default: relatedItems)',
                    widget: 'schemaFieldSelect',
                    fieldType: 'relation',
                },
                variation: { title: 'Item Type', widget: 'blockTypeSelect', filterConvertibleFrom: '@default', default: 'summary' },
            },
        },
        schemaEnhancer: {
            inheritSchemaFrom: { typeField: 'variation', mappingField: 'fieldMapping', defaultsField: 'itemDefaults' },
        },
    },
    // The vocabularySelect worked example (#321): a question whose answer is
    // completed from a vocabulary the author picked. Registered here so EVERY
    // example frontend carries it — the docs frontends already register it via
    // block-definitions.json, and a type only some frontends know is a type
    // block-sanity rightly flags on the others.
    suggest: {
        id: 'suggest',
        title: 'Suggest',
        blockSchema: {
            fieldsets: [
                { id: 'default', title: 'Default', fields: ['label', 'suggestFrom', 'value'] },
            ],
            properties: {
                label: { title: 'Question' },
                suggestFrom: {
                    title: 'Suggest from',
                    widget: 'vocabularySelect',
                    vocabularyFilter: 'Keywords|Subject',
                },
                value: { title: 'Answer' },
            },
            required: [],
        },
    },
    searchShortcuts: {
        id: 'searchShortcuts',
        title: 'Search Shortcuts',
        group: 'common',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['index', 'pageField', 'searchUrl', 'variation', 'fieldMapping'] }],
            properties: {
                index: {
                    title: 'Index',
                    widget: 'select_querystring_field',
                    vocabulary: { '@id': 'plone.app.contenttypes.metadatafields' },
                    default: 'Subject',
                },
                pageField: {
                    title: 'This page field (optional)',
                    description: 'Linked → this page’s values; empty → all values site-wide',
                    widget: 'schemaFieldSelect',
                    fieldType: 'keyword',
                },
                searchUrl: { title: 'Search page URL', widget: 'url' },
                variation: { title: 'Item Type', widget: 'blockTypeSelect', filterConvertibleFrom: '@default', default: 'default' },
            },
        },
        schemaEnhancer: {
            inheritSchemaFrom: { typeField: 'variation', mappingField: 'fieldMapping', defaultsField: 'itemDefaults' },
        },
    },
    rssFeed: {
        id: 'rssFeed',
        title: 'RSS Feed',
        group: 'common',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['feedUrl', 'count', 'variation', 'fieldMapping'] }],
            properties: {
                feedUrl: { title: 'Feed URL', widget: 'url' },
                count: { title: 'Max items', type: 'number', default: 6 },
                variation: { title: 'Item Type', widget: 'blockTypeSelect', filterConvertibleFrom: '@default', default: 'summary' },
            },
        },
        schemaEnhancer: {
            inheritSchemaFrom: { typeField: 'variation', mappingField: 'fieldMapping', defaultsField: 'itemDefaults' },
            // A rule that REFUSES a value, rather than showing or hiding one.
            // Asking for fewer than no items is the clearest thing this block
            // can be told that it cannot do, and no fixture asks for it — the
            // page uses the default 6 — so the rule is inert until a test sets
            // a negative count on purpose.
            fieldRules: {
                count: {
                    when: { count: { lt: 0 } },
                    error: 'Max items cannot be negative.',
                },
                // …and one that SAYS something instead of refusing it. Asking a
                // feed for a hundred items is a bad idea, not an impossible
                // one, so the author hears about it and the save goes through.
                // No fixture asks for that many, so it is inert until a test
                // does on purpose.
                feedUrl: {
                    when: { count: { gt: 50 } },
                    warning: 'That many items will make the page slow.',
                },
            },
        },
    },
    // Listing item types — restricted child blocks, only usable inside listing containers
    summary: {
        restricted: true,
        fieldMappings: {
            '@default': { '@id': 'href', 'title': 'title', 'description': 'description', 'image': 'image' },
        },
        blockSchema: {
            properties: {
                href:        { title: 'Link', widget: 'url' },
                title:       { title: 'Title' },
                description: { title: 'Description', widget: 'textarea' },
                image:       { title: 'Image', widget: 'url' },
                date:        { title: 'Date', widget: 'date' },
            },
        },
    },
    default: {
        restricted: true,
        fieldMappings: {
            '@default': { '@id': 'href', 'title': 'title', 'description': 'description' },
        },
        blockSchema: {
            properties: {
                href:        { title: 'Link', widget: 'url' },
                title:       { title: 'Title' },
                description: { title: 'Description', widget: 'textarea' },
            },
        },
    },
    toc: {
        id: 'toc',
        title: 'Table of Contents',
        blockSchema: {
            title: 'Table of Contents',
            fieldsets: [
                { id: 'default', title: 'Default', fields: ['title', 'hide_title', 'ordered', 'levels', 'variation'] },
            ],
            properties: {
                variation: { title: 'Variation' },
                title: { title: 'Title', type: 'string' },
                hide_title: { title: 'Hide title', type: 'boolean' },
                ordered: { title: 'Ordered', type: 'boolean' },
                levels: {
                    title: 'Entries',
                    isMulti: true,
                    choices: [['h1','h1'],['h2','h2'],['h3','h3'],['h4','h4'],['h5','h5'],['h6','h6']],
                },
            },
            required: [],
        },
    },
    gridBlock: {
        id: 'gridBlock',
        // Match Volto core's grid (allowedBlocks: ['image','listing','slate','teaser']).
        // gridBlock is used with slate cards and listings throughout the content
        // (e.g. docs/examples/grid/text, docs/examples/grid/listing, the homepage
        // "Why Hydra" cards); the old ['teaser','image'] wrongly rejected those, which
        // made the chevron move (and drop) walk children OUT of the grid to a parent
        // that accepts the type. Keep gridBlock (no nesting) and hero out of it.
        allowedBlocks: ['slate', 'image', 'listing', 'teaser'],
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['items', 'variation', 'headline', 'headlineTag'] }],
            properties: {
                headline: { title: 'Headline', type: 'string' },
                headlineTag: { title: 'Headline tag', widget: 'select', choices: [['h1','h1'],['h2','h2'],['h3','h3'],['h4','h4'],['h5','h5'],['h6','h6']] },
                items: {
                    widget: 'blocks_layout',
                    itemTypeField: 'variation',  // sync trigger
                    allowedBlocks: ['slate', 'image', 'listing', 'teaser'],
                },
                variation: {
                    title: 'Item Type',
                    widget: 'blockTypeSelect',
                },
            },
        },
        schemaEnhancer: {
            inheritSchemaFrom: {
                defaultsField: 'itemDefaults',
                // Same override as listing — keep teaser's `overwrite` toggle
                // editable per-child even when grid has a type selected.
                parentControlled: {
                    teaser: ['head_title', 'openLinkInNewTab', 'styles'],
                },
            },
        },
    },
    // Teaser block: use Volto's TeaserSchema (has href with object_browser)
    // fieldMappings come from volto-hydra index.js (merged via deepMerge)
    // No childBlockConfig — installChildBlockEnhancers auto-applies
    // hideParentOwnedFields. Parents declare what they additionally claim
    // for teasers via inheritSchemaFrom.parentControlled.teaser.
    teaser: {
        id: 'teaser',
        // A listing renders each result as this type, so it must declare how a
        // result's fields land on it — that mapping is also what makes it
        // selectable in the Item Type widget (filterConvertibleFrom: '@default').
        fieldMappings: {
            '@default': { '@id': 'href', 'title': 'title', 'description': 'description', 'image': 'preview_image' },
        },
        title: 'Teaser',
        icon: teaserIcon,
        group: 'common',
        // Mirrors Volto's own teaser schema (core Teaser/schema.js), because a
        // fixture blockSchema WINS over the admin's. A PARTIAL copy is what
        // broke the starter UI: declaring title/description without `overwrite`
        // — the "customize" checkbox those fields hang off — left the bridge
        // with a teaser whose link and toggle did not exist.
        blockSchema: {
            fieldsets: [
                { id: 'default', title: 'Default', fields: ['href', 'overwrite', 'title', 'head_title', 'description', 'preview_image'] },
            ],
            properties: {
                href: { title: 'Target', widget: 'object_browser', mode: 'link', allowExternals: true },
                overwrite: { title: 'Customize teaser content', type: 'boolean', default: false },
                title: { title: 'Title' },
                head_title: { title: 'Kicker' },
                description: { title: 'Description', widget: 'textarea' },
                preview_image: { title: 'Image override', widget: 'object_browser', mode: 'image', allowExternals: true },
            },
            required: ['href'],
        },
        // The teaser's RULE, not a snapshot of one side of it. A teaser MIRRORS
        // its target by default — title/description/image belong to the page it
        // points at and are not this block's to edit — until "Customize teaser
        // content" is ticked, when they become its own.
        //
        // Volto expresses that as a schema FUNCTION of the data, which cannot
        // reach a frontend: the block config crosses postMessage, so functions
        // don't survive. fieldRules is the declarative form of the same rule and
        // travels intact, so the admin and the mock parent resolve the teaser
        // identically — instead of one of them believing the title is always
        // editable and the other that it has no fields at all.
        schemaEnhancer: {
            fieldRules: {
                title: { when: { overwrite: true }, else: false },
                head_title: { when: { overwrite: true }, else: false },
                description: { when: { overwrite: true }, else: false },
                preview_image: { when: { overwrite: true }, else: false },
            },
        },
    },
    // Image block: parents declare claims via inheritSchemaFrom.parentControlled.image.
    image: {
        id: 'image',
        title: 'Image',
        // Mirrors Volto's ImageSchema (core Image/schema.jsx), with two
        // deliberate differences.
        //
        // 1. `url` is declared. Volto leaves it out of `properties` because the
        //    upload widget writes it, not a sidebar field — but hydra reads the
        //    schema to learn that `url` is a MEDIA field, which is what makes
        //    data-edit-media="url" an editable target rather than an unknown
        //    attribute. Undeclared, the image is uneditable on the canvas.
        //
        // 2. `url` is REQUIRED. An image block exists to hold an image, so it
        //    renders one either way — a grey placeholder until the author picks
        //    a real one, giving them something to click. Marking it required is
        //    what tells reveal to leave it alone: reveal is for OPTIONAL fields
        //    that are absent until asked for (a hero's image), and offering to
        //    "reveal" a field whose element is already on screen is nonsense.
        //
        // Volto states the rest as a schema FUNCTION of formData (alt/align/size
        // and the link fieldset appear only once a url exists). A function can't
        // cross postMessage to a frontend, so the same rule is expressed as
        // fieldRules, which travels as data.
        blockSchema: {
            fieldsets: [
                { id: 'default', title: 'Default', fields: ['url', 'alt', 'align', 'size', 'title', 'description', 'credit', 'copyright_and_sources', 'allow_image_download'] },
                { id: 'link_settings', title: 'Link settings', fields: ['href', 'openLinkInNewTab'] },
            ],
            properties: {
                title: { title: 'Title' },
                description: { title: 'Description', widget: 'textarea' },
                credit: { title: 'Credit' },
                copyright_and_sources: { title: 'Copyright and sources' },
                allow_image_download: { title: 'Allow image download', type: 'boolean' },
                url: { title: 'Image', widget: 'image' },
                alt: { title: 'Alt text' },
                align: { title: 'Alignment', widget: 'align', default: 'center' },
                size: { title: 'Size', widget: 'image_size', default: 'l' },
                href: {
                    title: 'Link to',
                    widget: 'object_browser',
                    mode: 'link',
                    selectedItemAttrs: ['Title', 'Description', 'hasPreviewImage'],
                    allowExternals: true,
                },
                openLinkInNewTab: { title: 'Open in a new tab', type: 'boolean' },
            },
            required: ['url'],
        },
        schemaEnhancer: {
            fieldRules: {
                alt: { when: { url: { isSet: true } }, else: false },
                align: { when: { url: { isSet: true } }, else: false },
                // Volto's own Image schema drops the size choice for a
                // full-width image: the width IS the page, so there is nothing
                // to choose. Written as a LIST of rules — the first whose
                // condition holds wins, and the bare `false` at the end is the
                // catch-all that hides the field when none does.
                size: [
                  { when: { url: { isSet: true }, align: { isNot: 'full' } } },
                  false,
                ],
                href: { when: { url: { isSet: true } }, else: false },
                openLinkInNewTab: { when: { url: { isSet: true } }, else: false },
            },
        },
        fieldMappings: {
            '@default': { '@id': 'href', 'title': 'alt', 'image': 'url' },
        },
    },
    // Form block: uses typed object_list for field types (like search block facets)
    // field_type values in data map directly to block IDs below
    form: {
        id: 'form',
        title: 'Form',
        icon: formIcon,
        group: 'common',
        blockSchema: {
            fieldsets: [
                {
                    id: 'default',
                    title: 'Default',
                    fields: [
                        'title', 'description', 'subblocks',
                        'default_to', 'default_from', 'default_subject',
                        'submit_label', 'show_cancel', 'cancel_label',
                        'mail_header', 'mail_footer',
                        'captcha', 'email_otp_verification', 'sortOn', 'sortOnOptions', 'optionsFrom'],
                },
                {
                    id: 'manage_data',
                    title: 'Manage data',
                    fields: ['store', 'remove_data_after_days', 'send', 'send_message'],
                },
            ],
            properties: {
                // Three custom widgets, on a block whose schema this
                // fixture owns — the built-in search block's schema is Volto's,
                // so a widget declared there never reaches the sidebar.
                sortOn: {
                    title: 'Sort results by',
                    type: 'string',
                    widget: 'querystringSelect',
                    indexes: 'sortable',
                    emptyLabel: '— no sorting —',
                },
                sortOnOptions: {
                    title: 'Sort-by options',
                    type: 'array',
                    widget: 'querystringSelect',
                    indexes: 'sortable',
                    multiple: true,
                },
                optionsFrom: {
                    title: 'Options from',
                    type: 'string',
                    widget: 'vocabularySelect',
                },
                send_email: { title: 'Send email', type: 'boolean' },
                title: {
                    title: 'Title',
                    type: 'string',
                },
                description: { title: 'Description', type: 'string', widget: 'textarea' },
                subblocks: {
                    title: 'Fields',
                    widget: 'object_list',
                    idField: 'field_id',
                    typeField: 'field_type',
                    allowedBlocks: [
                        'text', 'textarea', 'number', 'select',
                        'single_choice', 'multiple_choice', 'checkbox',
                        'date', 'from', 'static_text', 'hidden', 'attachment',
                    ],
                },
                default_to: {
                    title: 'Recipients',
                    type: 'string',
                },
                default_from: {
                    title: 'Default sender',
                    type: 'string',
                },
                default_subject: {
                    title: 'Mail subject',
                    description: 'Use the ${field_id} syntax to add a form value to the email subject',
                    type: 'string',
                },
                submit_label: {
                    title: 'Submit button label',
                    type: 'string',
                },
                show_cancel: {
                    title: 'Show cancel button',
                    type: 'boolean',
                    default: false,
                },
                cancel_label: {
                    title: 'Cancel button label',
                    type: 'string',
                },
                mail_header: {
                    title: 'Text at the beginning of the email',
                    widget: 'richtext',
                    type: 'string',
                    description: "If field isn't filled in, a default text will be used",
                },
                mail_footer: {
                    title: 'Text at the end of the email',
                    widget: 'richtext',
                    type: 'string',
                    description: "If field isn't filled in, a default text will be used",
                },
                captcha: {
                    title: 'Captcha provider',
                    type: 'string',
                },
                email_otp_verification: {
                    title: 'Validate BCC emails with OTP verification',
                    description: "Prevent spam from your website. By enabling this option, you do not allow malicious users to send emails to other email addresses through your website. The OTP will be requested for all email-type fields for which the 'Send a copy of the email to this address' option is checked.",
                    type: 'boolean',
                    default: false,
                },
                store: {
                    title: 'Store compiled data',
                    type: 'boolean',
                },
                remove_data_after_days: {
                    title: 'Data wipe',
                    description: 'Number of days after which, the data should be deleted',
                    type: 'integer',
                    default: -1,
                },
                send: {
                    title: 'Send email to recipient',
                    description: 'Attached file will be sent via email, but not stored',
                    type: 'boolean',
                },
                send_message: {
                    title: 'Message of sending confirmed',
                    widget: 'textarea',
                    description: 'You can add the value of a filled field in the form by inserting its ID between curly brackets preceded by $, example: ${field_id}; you can add also html elements such as links <a>, new line <br />, bold <b> and italic <i> formatting.',
                },
            },
            required: ['default_to', 'default_from', 'default_subject', 'captcha'],
        },
        schemaEnhancer: {
            fieldRules: {
                // cancel_label only visible when show_cancel is checked
                cancel_label: { when: { show_cancel: true }, else: false },
            },
        },
    },
    // Form field types — restricted blocks keyed by field_type value from data
    // Matches collective/volto-form-block field schemas:
    // - All fields get: label, description, required (except static_text)
    // - select/single_choice/multiple_choice add: input_values (SelectionSchemaExtender)
    // - from adds: use_as_reply_to, use_as_bcc (FromSchemaExtender)
    // - hidden adds: value (HiddenSchemaExtender)
    //
    // fieldMappings use explicit type-to-type via `select` as hub (most fields).
    // @default is NOT used because form field properties (label, description, required)
    // are not canonical @default fields (@id, title, description, image).
    text: {
        id: 'text',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Text',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description', required: 'required' } },
        blockSchema: {
            title: 'Text Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'required'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    textarea: {
        id: 'textarea',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Textarea',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description', required: 'required' } },
        blockSchema: {
            title: 'Textarea Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'required'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    number: {
        id: 'number',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Number',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description', required: 'required' } },
        blockSchema: {
            title: 'Number Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'required'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    select: {
        id: 'select',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'List',
        restricted: true,
        fieldMappings: {
            text: { label: 'label', description: 'description', required: 'required' },
            textarea: { label: 'label', description: 'description', required: 'required' },
            number: { label: 'label', description: 'description', required: 'required' },
            single_choice: { label: 'label', description: 'description', required: 'required', input_values: 'input_values' },
            multiple_choice: { label: 'label', description: 'description', required: 'required', input_values: 'input_values' },
            checkbox: { label: 'label', description: 'description', required: 'required' },
            date: { label: 'label', description: 'description', required: 'required' },
            from: { label: 'label', description: 'description', required: 'required' },
            static_text: { label: 'label', description: 'description' },
            hidden: { label: 'label' },
            attachment: { label: 'label', description: 'description', required: 'required' },
        },
        blockSchema: {
            title: 'Select Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'input_values', 'required', 'options_from'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                options_from: {
                    title: 'Options from',
                    description: 'A vocabulary this site keeps.',
                    type: 'string',
                    widget: 'vocabularySelect',
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                input_values: { title: 'Possible values', type: 'array', creatable: true },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    single_choice: {
        id: 'single_choice',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Single Choice',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description', required: 'required', input_values: 'input_values' } },
        blockSchema: {
            title: 'Single Choice Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'input_values', 'required'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                input_values: { title: 'Possible values', type: 'array', creatable: true },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    multiple_choice: {
        id: 'multiple_choice',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Multiple Choice',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description', required: 'required', input_values: 'input_values' } },
        blockSchema: {
            title: 'Multiple Choice Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'input_values', 'required'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                input_values: { title: 'Possible values', type: 'array', creatable: true },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    checkbox: {
        id: 'checkbox',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Checkbox',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description', required: 'required' } },
        blockSchema: {
            title: 'Checkbox Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'required'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    date: {
        id: 'date',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Date',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description', required: 'required' } },
        blockSchema: {
            title: 'Date Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'required'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    from: {
        id: 'from',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'E-mail',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description', required: 'required' } },
        blockSchema: {
            title: 'Email Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'use_as_reply_to', 'use_as_bcc', 'required'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                use_as_reply_to: { title: "Use as 'reply to'", type: 'boolean', default: false },
                use_as_bcc: { title: 'Send an email copy to this address', type: 'boolean', default: false },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    static_text: {
        id: 'static_text',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Static Text',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description' } },
        blockSchema: {
            title: 'Static Text',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
            },
        },
    },
    hidden: {
        id: 'hidden',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Hidden',
        restricted: true,
        fieldMappings: { select: { label: 'label' } },
        blockSchema: {
            title: 'Hidden Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'value'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                value: { title: 'Value for field', type: 'string' },
                // What the field submits when nothing sets it — the whole point
                // of a hidden field, and it was the one thing not declared.
                default_value: { title: 'Default value', type: 'string' },
            },
        },
    },
    attachment: {
        id: 'attachment',
        schemaEnhancer: {
            fieldRules: {
                // The comparison only means anything once a question is named.
                show_when_is: {
                    when: { show_when_field: { isSet: true } },
                    else: false,
                },
            },
        },
        title: 'Attachment',
        restricted: true,
        fieldMappings: { select: { label: 'label', description: 'description', required: 'required' } },
        blockSchema: {
            title: 'Attachment Field',
            fieldsets: [{ id: 'default', title: 'Default', fields: ['label', 'description', 'required'] }, { id: 'conditions', title: 'Conditions', fields: ['show_when_field', 'show_when_is'] }],
            properties: {
                show_when_field: {
                    title: 'Only show when',
                    description: 'An earlier question in this form.',
                    type: 'string',
                    widget: 'blockPicker',
                    scope: 'subblocks',
                    direction: 'before',
                    valueField: 'field_id',
                    labelField: 'label',
                    emptyLabel: '— always show —',
                },
                show_when_is: {
                    title: 'Condition',
                    type: 'string',
                    factory: 'Choice',
                    choices: [
                        ['value_is', 'is'],
                        ['filled', 'has an answer'],
                    ],
                },
                label: { title: 'Label', type: 'string' },
                description: { title: 'Description', type: 'string' },
                required: { title: 'Required', type: 'boolean', default: false },
            },
        },
    },
    title: {
      id: 'title',
      title: 'Title',
      group: 'text',
      restricted: true,
      blockSchema: { fieldsets: [], properties: {}, required: [] },
    },
    description: {
      id: 'description',
      title: 'Description',
      group: 'text',
      restricted: true,
      blockSchema: { fieldsets: [], properties: {}, required: [] },
    },
    leadimage: {
      id: 'leadimage',
      title: 'Lead image',
      group: 'media',
      restricted: true,
      blockSchema: { fieldsets: [], properties: {
          align: { title: 'Alignment', widget: 'align' },}, required: [] },
    },
    // Which page date field to show — the block's own setting.
    dateField: {
      id: 'dateField',
      title: 'Date',
      group: 'text',
      restricted: true,
      blockSchema: {
        fieldsets: [{ id: 'default', title: 'Default', fields: ['dateField', 'showTime'] }],
        properties: {
            showTime: { title: 'Show time', type: 'boolean' },
          dateField: {
            title: 'Field',
            type: 'string',
            factory: 'Choice',
            choices: [['effective', 'Published'], ['created', 'Created'], ['modified', 'Modified']],
          },
        },
        required: [],
      },
    },
    eventMetadata: {
      id: 'eventMetadata',
      title: 'Event metadata',
      group: 'text',
      restricted: true,
      // No fields of its own: this block PROJECTS the content item's fields
      // (an Event's location, contact_name), which is why the sidebar shows the
      // page form when it is selected. Declaring a property here fills the
      // sidebar with that instead, and the Event's own fields disappear.
      //
      // `required` appears on the docs copy of an event beside fixed/slotId/
      // templateId — template machinery, not something an author edits.
      blockSchema: { fieldsets: [], properties: {}, required: [] },
    },
    socialLinks: {
      id: 'socialLinks',
      title: 'Social links',
      group: 'common',
      // Matches the declaration the Next.js example ships (PageClient.js): the
      // links are an object_list keyed by `@id`, and each item's `url` is a
      // plain string, not a link object. Without idField the items cannot be
      // addressed by their stored id, so they never become selectable
      // sub-items — the block renders but nothing inside it can be edited.
      blockSchema: {
        fieldsets: [{ id: 'default', title: 'Default', fields: ['links'] }],
        properties: {
          links: {
            title: 'Links',
            widget: 'object_list',
            idField: '@id',
            schema: {
              fieldsets: [{ id: 'default', title: 'Default', fields: ['url'] }],
              properties: { url: { title: 'URL', widget: 'url' } },
              required: [],
            },
          },
        },
        required: [],
      },
    },
    // A single social link — the typed item of socialLinks' `links` object_list
    // (restricted, like tab inside codeExample). Its `url` is a plain string.
    socialLink: {
      id: 'socialLink',
      title: 'Social link',
      group: 'common',
      restricted: true, // Only used inside socialLinks' typed object_list
      blockSchema: {
        fieldsets: [{ id: 'default', title: 'Default', fields: ['url'] }],
        properties: { url: { title: 'URL', widget: 'url' } },
        required: [],
      },
    },
    // The placeholder a container seeds into an empty region. Registered so it
    // is not reported as unimplemented; it has nothing to edit.
    empty: {
      id: 'empty',
      title: 'Empty',
      group: 'common',
      restricted: true,
      // An empty field is a spacer in a form, but it still carries a label —
      // the fixtures store one, so a bare properties map made it uneditable.
      blockSchema: {
        fieldsets: [{ id: 'default', title: 'Default', fields: ['label'] }],
        properties: { label: { title: 'Label', type: 'string' } },
        required: [],
      },
    },

    // Highlight block: banner with title, slate description, image, CTA
    highlight: {
        id: 'highlight',
        title: 'Highlight',
        icon: highlightIcon,
        group: 'common',
        blockSchema: {
            properties: {
                title: { title: 'Title', type: 'string' },
                description: { title: 'Description', widget: 'slate' },
                image: { title: 'Background Image', widget: 'image' },
                cta_title: { title: 'CTA Text', type: 'string' },
                cta_link: { title: 'CTA Link', widget: 'object_browser', mode: 'link' },
            },
            required: [],
        },
    },
    // Introduction block: standalone slate paragraph used as page intro.
    // The data shape is { @type: 'introduction', value: [slate...] } — not page fields.
    introduction: {
        id: 'introduction',
        title: 'Introduction',
        group: 'common',
        blockSchema: {
            properties: {
                value: { title: 'Text', widget: 'slate' },
            },
            required: [],
        },
    },
    // --- Conversion drag/paste test graph (dnd-convert.spec.ts) ---
    // A deterministic toy graph with EXPLICIT edges only (no '@default'), so
    // convSource reaches exactly convTargetA + convTargetB and nothing else.
    // Edge direction: `X.fieldMappings[Y]` = "X can be built FROM Y" (Y → X).
    convSource: {
        id: 'convSource',
        title: 'Conv Source',
        restricted: true,
        group: 'common',
        fieldMappings: {}, // present (truthy) so it's a valid conversion source
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title'] }],
            properties: { title: { title: 'Title', type: 'string' } },
            required: [],
        },
    },
    convTargetA: {
        id: 'convTargetA',
        restricted: true,
        title: 'Conv Target A',
        group: 'common',
        fieldMappings: { convSource: { title: 'title' } }, // convSource → convTargetA
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title'] }],
            properties: { title: { title: 'Title', type: 'string' } },
            required: [],
        },
    },
    convTargetB: {
        id: 'convTargetB',
        restricted: true,
        title: 'Conv Target B',
        group: 'common',
        fieldMappings: { convSource: { title: 'title' } }, // convSource → convTargetB
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title'] }],
            properties: { title: { title: 'Title', type: 'string' } },
            required: [],
        },
    },
    // A block with NO fieldMappings → not convertible to anything, so a
    // restricted container that doesn't list it rejects it outright.
    convAlien: {
        id: 'convAlien',
        title: 'Conv Alien',
        restricted: true,
        group: 'common',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title'] }],
            properties: { title: { title: 'Title', type: 'string' } },
            required: [],
        },
    },
    // Container-to-container conversion: convGroupSrc (holds children) converts to
    // convGroupDst, carrying its children. Exercises convertContainerBlock on drop.
    convGroupSrc: {
        id: 'convGroupSrc',
        title: 'Conv Group Src',
        restricted: true,
        group: 'common',
        fieldMappings: {}, // valid conversion source
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
            properties: {
                items: { widget: 'blocks_layout', allowedBlocks: ['convTargetA'] },
            },
            required: [],
        },
    },
    convGroupDst: {
        id: 'convGroupDst',
        restricted: true,
        title: 'Conv Group Dst',
        group: 'common',
        fieldMappings: { convGroupSrc: {} }, // convGroupSrc → convGroupDst
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
            properties: {
                items: { widget: 'blocks_layout', allowedBlocks: ['convTargetA'] },
            },
            required: [],
        },
    },
    // Restricted to convGroupDst → a dropped convGroupSrc auto-converts to it.
    convGroupBox: {
        id: 'convGroupBox',
        title: 'Conv Group Box',
        restricted: true,
        group: 'common',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
            properties: {
                items: { widget: 'blocks_layout', allowedBlocks: ['convGroupDst'] },
            },
            required: [],
        },
    },
    // Container restricted to a SINGLE convert-target → convSource drops auto-convert.
    convBox: {
        id: 'convBox',
        title: 'Convert Box',
        restricted: true,
        group: 'common',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
            properties: {
                items: { widget: 'blocks_layout', allowedBlocks: ['convTargetA'] },
            },
            required: [],
        },
    },
    // Container restricted to TWO convert-targets → convSource drop opens the chooser.
    convBoxMulti: {
        id: 'convBoxMulti',
        title: 'Convert Box (multi)',
        restricted: true,
        group: 'common',
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
            properties: {
                items: {
                    widget: 'blocks_layout',
                    allowedBlocks: ['convTargetA', 'convTargetB'],
                },
            },
            required: [],
        },
    },

    // Search facet types. Copied from docs/examples/block-definitions.json, which
    // is what the docs example frontends load — these four lived only there, so
    // any frontend using THIS registry reported them as unregistered.
    checkboxFacet: {
        id: 'checkboxFacet',
        title: 'Checkboxes',
        restricted: true,
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'field', 'multiple', 'hidden'] }],
            properties: {
            title: { title: 'Label' },
            field: { title: 'Field', widget: 'select_querystring_field' },
            hidden: { title: 'Hide facet?', type: 'boolean', default: false },
                multiple: { title: 'Multiple choices?', type: 'boolean', default: false },
            },
            required: [],
        },
    },
    selectFacet: {
        id: 'selectFacet',
        title: 'Select',
        restricted: true,
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'field', 'hidden'] }],
            properties: {
            title: { title: 'Label' },
            field: { title: 'Field', widget: 'select_querystring_field' },
            hidden: { title: 'Hide facet?', type: 'boolean', default: false },
            },
            required: [],
        },
    },
    daterangeFacet: {
        id: 'daterangeFacet',
        title: 'Date range',
        restricted: true,
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'field', 'hidden'] }],
            properties: {
            title: { title: 'Label' },
            field: { title: 'Field', widget: 'select_querystring_field' },
            hidden: { title: 'Hide facet?', type: 'boolean', default: false },
            },
            required: [],
        },
    },
    toggleFacet: {
        id: 'toggleFacet',
        title: 'Toggle',
        restricted: true,
        blockSchema: {
            fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'field', 'hidden'] }],
            properties: {
            title: { title: 'Label' },
            field: { title: 'Field', widget: 'select_querystring_field' },
            hidden: { title: 'Hide facet?', type: 'boolean', default: false },
            },
            required: [],
        },
    },
};
