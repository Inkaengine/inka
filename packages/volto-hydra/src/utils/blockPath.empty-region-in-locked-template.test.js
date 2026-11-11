/**
 * An empty region inside a LOCKED template block must not refuse a page's save.
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
 * The placeholder in a locked block is locked too: it joins the block's template,
 * as a forced region's empty does, so validation passes it by and unlocking the
 * template is what makes it fillable. A placeholder in a block being edited
 * directly stays editable, as before.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
  HydraSchemaProvider: ({ children }) => children,
}));
import { isBlockReadonly } from '@volto-hydra/helpers';
import { mergeTemplatesIntoPage } from '@volto-hydra/helpers/mergeTemplates.js';
import { ensureAllContainersHaveBlocks } from './blockPath.js';
import { validateBlocksAgainstSchemas } from './validateBlocks';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const formatMessage = (msg) => msg?.id || msg?.defaultMessage || 'error';

const FOOTER_TEMPLATE_PATH = '/templates/site-footer';

const blocksConfig = {
  _page: {
    id: '_page',
    schema: () => ({
      properties: {
        items: { widget: 'blocks_layout', allowedBlocks: ['slate'], defaultBlockType: 'slate' },
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

/** A page as the editor opens it: the forced footer merged in, then every empty region seeded. */
async function openPage({ readOnly, config = blocksConfig }) {
  const page = {
    '@type': 'Document',
    blocks: { a: { '@type': 'slate' } },
    blocks_layout: { items: ['a'], footer: [] },
  };
  let n = 0;
  const uuid = () => `seed-${(n += 1)}`;
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
  const opened = ensureAllContainersHaveBlocks(merged, config, intl, uuid);
  const footerId = opened.blocks_layout.footer[0];
  const footer = opened.blocks[footerId];
  const column = footer.blocks[footer.blocks_layout.upper[0]];
  const headingId = column?.blocks_layout?.links?.[0];
  return { opened, footer, column, heading: column?.blocks?.[headingId] };
}

describe('an empty region inside a locked template block', () => {
  test('the page still saves', async () => {
    const { opened, footer } = await openPage({ readOnly: true });
    expect(footer.readOnly, 'precondition: the footer is locked template content').toBe(true);
    const { blocksErrors } = validateBlocksAgainstSchemas(opened, {
      blocksConfig,
      intl,
      formatMessage,
    });
    expect(blocksErrors, 'a block the author cannot reach refused the save').toEqual({});
  });

  test('its placeholder, and everything seeded inside it, is locked template content', async () => {
    const { footer, column, heading } = await openPage({ readOnly: true });
    expect(column?.['@type']).toBe('footerColumn');
    expect(heading?.['@type']).toBe('link');
    for (const [name, block] of [['column', column], ['heading link', heading]]) {
      expect(block.readOnly, `the seeded ${name} is not locked`).toBe(true);
      expect(block.fixed, `the seeded ${name} is not fixed`).toBe(true);
      expect(
        block.templateInstanceId,
        `the seeded ${name} is not in the footer's template`,
      ).toBe(footer.templateInstanceId);
    }
  });

  test('a region with a `default` is refilled locked too', async () => {
    const config = {
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
    const { opened, column, heading } = await openPage({ readOnly: true, config });
    expect(column?.['@type']).toBe('footerColumn');
    expect(column.readOnly, 'the default column is not locked').toBe(true);
    expect(heading?.readOnly, 'the default column\'s heading link is not locked').toBe(true);
    const { blocksErrors } = validateBlocksAgainstSchemas(opened, {
      blocksConfig: config,
      intl,
      formatMessage,
    });
    expect(blocksErrors).toEqual({});
  });

  test('unlocking the template makes the placeholder editable', async () => {
    const { footer, column, heading } = await openPage({ readOnly: true });
    const unlocked = [footer.templateInstanceId];
    expect(isBlockReadonly(column, null)).toBe(true);
    expect(isBlockReadonly(column, unlocked)).toBe(false);
    expect(isBlockReadonly(heading, unlocked)).toBe(false);
  });
});

describe('an empty region inside a block being edited directly', () => {
  test('its placeholder stays editable', async () => {
    const { footer, column, heading } = await openPage({ readOnly: false });
    expect(footer.readOnly, 'precondition: the footer is editable').toBe(false);
    expect(column?.['@type']).toBe('footerColumn');
    expect(column.readOnly, 'the placeholder was locked where it can be edited').toBeFalsy();
    expect(heading.readOnly, 'the seeded heading was locked where it can be edited').toBeFalsy();
  });
});
