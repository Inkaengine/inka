/**
 * An empty region inside a LOCKED template block is seeded with an `empty` placeholder.
 *
 * A page that uses a forced footer template holds the footer as readOnly
 * template content, and block validation skips readOnly blocks so that a page
 * which merely uses a template stays saveable. But when the page loads, every
 * empty region is seeded with a placeholder of its default type — including a
 * region of the locked footer. The footer's empty "upper" region was seeded with
 * a footer column, whose own region was seeded with a link: neither readOnly, so
 * both were validated, and the link's required `url` refused the save of EVERY
 * page on the site, naming a block the author could not reach.
 *
 * Locking that real placeholder is not enough: only `empty` blocks are stripped on
 * save, so a footer column the author never added would be saved into the template
 * wherever the footer is saved. A region of a locked block is seeded with an
 * `empty` placeholder instead, whatever its default type: it has no fields to
 * validate, it is never stored, and unlocking the template gives it a "+". A
 * region of a block being edited directly is seeded as before.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
  HydraSchemaProvider: ({ children }) => children,
}));
import { getBlockAddability } from '@volto-hydra/helpers';
import { mergeTemplatesIntoPage } from '@volto-hydra/helpers/mergeTemplates.js';
import {
  buildBlockPathMap,
  ensureAllContainersHaveBlocks,
  stripEmptyBlocks,
} from './blockPath.js';
import { validateBlocksAgainstSchemas } from './validateBlocks';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const formatMessage = (msg) => msg?.id || msg?.defaultMessage || 'error';

const FOOTER_TEMPLATE_PATH = '/templates/site-footer';

const blocksConfig = {
  _page: {
    id: '_page',
    schema: () => ({
      properties: {
        items: {
          widget: 'blocks_layout',
          allowedBlocks: ['slate', 'footer'],
          defaultBlockType: 'slate',
        },
        footer: {
          widget: 'blocks_layout',
          allowedLayouts: [FOOTER_TEMPLATE_PATH],
          allowedBlocks: ['footer'],
        },
      },
    }),
  },
  slate: { id: 'slate', blockSchema: { properties: {} } },
  footer: {
    id: 'footer',
    blockSchema: {
      properties: {
        upper: {
          title: 'Mega footer columns',
          widget: 'blocks_layout',
          allowedBlocks: ['footerColumn'],
          defaultBlockType: 'footerColumn',
        },
        footerLinks: {
          title: 'Footer links',
          widget: 'blocks_layout',
          allowedBlocks: ['link'],
          defaultBlockType: 'link',
        },
      },
    },
  },
  footerColumn: {
    id: 'footerColumn',
    blockSchema: {
      properties: {
        links: {
          title: 'Links (first is the heading)',
          widget: 'blocks_layout',
          allowedBlocks: ['link'],
          defaultBlockType: 'link',
        },
      },
    },
  },
  link: {
    id: 'link',
    blockSchema: {
      fieldsets: [{ id: 'default', title: 'Default', fields: ['url', 'text'] }],
      properties: {
        url: { title: 'URL', widget: 'object_browser', mode: 'link' },
        text: { title: 'Text', type: 'string' },
      },
      required: ['url'],
    },
  },
};

/** The same config, with the footer's columns region declaring a `default`. */
const withUpperDefault = {
  ...blocksConfig,
  footer: {
    ...blocksConfig.footer,
    blockSchema: {
      properties: {
        ...blocksConfig.footer.blockSchema.properties,
        upper: {
          ...blocksConfig.footer.blockSchema.properties.upper,
          default: [{ '@type': 'footerColumn' }],
        },
      },
    },
  },
};

/** A footer template with its mega-footer columns region empty, as LECC's is. */
const footerTemplate = ({ readOnly }) => ({
  '@id': FOOTER_TEMPLATE_PATH,
  '@type': 'Template',
  blocks: {
    footer0: {
      '@type': 'footer',
      slotId: 'footer0',
      templateId: FOOTER_TEMPLATE_PATH,
      fixed: true,
      readOnly,
      blocks: {
        'subfooter-0': {
          '@type': 'link',
          slotId: 'subfooter-0',
          templateId: FOOTER_TEMPLATE_PATH,
          fixed: true,
          readOnly,
          text: 'Accessibility',
          url: [{ '@id': '/accessibility' }],
        },
      },
      blocks_layout: { upper: [], footerLinks: ['subfooter-0'] },
    },
  },
  blocks_layout: { items: ['footer0'] },
});

function counter() {
  let n = 0;
  return () => `seed-${(n += 1)}`;
}

/** A page as the editor opens it: the forced footer merged in, then every empty region seeded. */
async function openPage({ readOnly, config = blocksConfig }) {
  const page = {
    '@id': '/a-page',
    '@type': 'Document',
    blocks: { a: { '@type': 'slate' } },
    blocks_layout: { items: ['a'], footer: [] },
  };
  const uuid = counter();
  const { merged } = await mergeTemplatesIntoPage(page, {
    loadTemplate: async () => footerTemplate({ readOnly }),
    pageBlocksFields: {
      items: {},
      footer: { allowedLayouts: [FOOTER_TEMPLATE_PATH] },
    },
    uuidGenerator: uuid,
    blocksConfig: config,
    intl,
  });
  return opened(ensureAllContainersHaveBlocks(merged, config, intl, uuid), 'footer');
}

/**
 * The footer template opened on its own page, in the editor's order: the frontend's
 * INIT seeds the document as stored, before the merge gives the template's own blocks
 * their instance id; the merge (never against the document's own template) follows,
 * and seeds again.
 */
async function openTemplatePage({ config = blocksConfig } = {}) {
  const definition = footerTemplate({ readOnly: true });
  const uuid = counter();
  const atInit = ensureAllContainersHaveBlocks(definition, config, intl, uuid);
  const { merged } = await mergeTemplatesIntoPage(atInit, {
    loadTemplate: async () => definition,
    pageBlocksFields: { items: {} },
    uuidGenerator: uuid,
    blocksConfig: config,
    intl,
    skipOwnTemplate: true,
  });
  return opened(ensureAllContainersHaveBlocks(merged, config, intl, uuid), 'items');
}

function opened(formData, footerRegion) {
  const footerId = formData.blocks_layout[footerRegion][0];
  const footer = formData.blocks[footerId];
  const placeholderId = footer.blocks_layout.upper[0];
  return {
    formData,
    footerId,
    footer,
    placeholderId,
    placeholder: footer.blocks[placeholderId],
  };
}

function errorsOf(formData, config = blocksConfig) {
  return validateBlocksAgainstSchemas(formData, { blocksConfig: config, intl, formatMessage })
    .blocksErrors;
}

function savedUpper(formData, footerId, config = blocksConfig) {
  const saved = stripEmptyBlocks(formData, config, intl);
  return saved.blocks[footerId].blocks_layout.upper;
}

describe('an empty region inside a locked template block, on a page using the template', () => {
  test('is seeded with an empty placeholder in the footer’s template', async () => {
    const { footer, placeholder } = await openPage({ readOnly: true });
    expect(footer.readOnly, 'precondition: the footer is locked template content').toBe(true);
    expect(placeholder?.['@type']).toBe('empty');
    expect(placeholder.templateId).toBe(FOOTER_TEMPLATE_PATH);
    expect(placeholder.templateInstanceId).toBe(footer.templateInstanceId);
    expect(placeholder.readOnly, 'the placeholder is not locked with the footer').toBe(true);
  });

  test('the page still saves', async () => {
    const { formData } = await openPage({ readOnly: true });
    expect(errorsOf(formData), 'a block the author cannot reach refused the save').toEqual({});
  });

  test('nothing the author did not add is saved', async () => {
    const { formData, footerId } = await openPage({ readOnly: true });
    expect(savedUpper(formData, footerId)).toEqual([]);
  });

  test('a region with a `default` is seeded with an empty placeholder too', async () => {
    const { formData, footerId, placeholder } = await openPage({
      readOnly: true,
      config: withUpperDefault,
    });
    expect(placeholder?.['@type']).toBe('empty');
    expect(errorsOf(formData, withUpperDefault)).toEqual({});
    expect(savedUpper(formData, footerId, withUpperDefault)).toEqual([]);
  });

  test('the placeholder offers nothing until the template is unlocked', async () => {
    const { formData, footer, placeholderId, placeholder } = await openPage({ readOnly: true });
    const map = buildBlockPathMap(formData, blocksConfig, intl);
    expect(getBlockAddability(placeholderId, map, placeholder, null).canReplace).toBe(false);
    expect(
      getBlockAddability(placeholderId, map, placeholder, [footer.templateInstanceId]).canReplace,
    ).toBe(true);
  });
});

describe('an empty region inside a locked template block, on the template’s own page', () => {
  test('is seeded with an empty placeholder in the template', async () => {
    const { footer, placeholder } = await openTemplatePage();
    expect(placeholder?.['@type']).toBe('empty');
    // In the template, so a footer column added in its place is the template's and is
    // not dropped from the pages that use it.
    expect(placeholder.templateId).toBe(FOOTER_TEMPLATE_PATH);
    expect(placeholder.templateInstanceId).toBe(footer.templateInstanceId);
    expect(placeholder.readOnly).toBe(true);
  });

  test('the template saves, and gains no footer column', async () => {
    const { formData, footerId } = await openTemplatePage();
    expect(errorsOf(formData)).toEqual({});
    expect(savedUpper(formData, footerId)).toEqual([]);
  });
});

describe('an empty region inside a block being edited directly', () => {
  test('is seeded with its default type, editable, as before', async () => {
    const { footer, placeholder } = await openPage({ readOnly: false });
    expect(footer.readOnly, 'precondition: the footer is editable').toBe(false);
    expect(placeholder?.['@type']).toBe('footerColumn');
    expect(placeholder.readOnly).toBeFalsy();
  });
});
