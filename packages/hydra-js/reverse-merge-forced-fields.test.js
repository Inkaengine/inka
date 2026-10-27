import { mergeTemplatesIntoPage } from './mergeTemplates.js';

/**
 * Committing a forced template on a page whose OTHER blocks fields force
 * templates too.
 *
 * A site forces a layout into the page's `items`, a footer template into a
 * `footer` field and an announcement into an `announcement` field. Unlocking
 * the footer and committing it ("Change on all pages") reverse-merges the
 * footer's instance back into the footer template and saves that.
 *
 * The saved footer template must hold the footer's own blocks and nothing
 * else — not the page's layout, not the page's content, not the announcement.
 */
const LAYOUT = '/templates/layout';
const FOOTER = '/templates/footer';
const ANNOUNCEMENT = '/templates/announcement';

const slate = (text, extra = {}) => ({
  '@type': 'slate',
  value: [{ type: 'p', children: [{ text }] }],
  plaintext: text,
  ...extra,
});

const templates = {
  [LAYOUT]: {
    '@id': LAYOUT,
    blocks: {
      'lay-header': slate('Layout header', {
        templateId: LAYOUT,
        slotId: 'header',
        fixed: true,
        readOnly: true,
      }),
      'lay-main': slate('', { templateId: LAYOUT, slotId: 'default' }),
    },
    blocks_layout: { items: ['lay-header', 'lay-main'] },
  },
  [FOOTER]: {
    '@id': FOOTER,
    blocks: {
      'ft-footer': slate('Footer copy', {
        templateId: FOOTER,
        slotId: 'footer0',
        fixed: true,
        readOnly: true,
      }),
      'ft-consent': slate('Consent copy', {
        templateId: FOOTER,
        slotId: 'consent0',
        fixed: true,
        readOnly: true,
      }),
    },
    blocks_layout: { items: ['ft-footer', 'ft-consent'] },
  },
  [ANNOUNCEMENT]: {
    '@id': ANNOUNCEMENT,
    blocks: {
      'an-alert': slate('Announcement copy', {
        templateId: ANNOUNCEMENT,
        slotId: 'alert0',
        fixed: true,
        readOnly: true,
      }),
    },
    blocks_layout: { items: ['an-alert'] },
  },
};

const page = {
  '@id': '/a-page',
  blocks: {
    'page-content': slate('Page content'),
  },
  blocks_layout: { items: ['page-content'] },
};

const pageBlocksFields = {
  items: { allowedLayouts: [LAYOUT] },
  footer: { allowedLayouts: [FOOTER] },
  announcement: { allowedLayouts: [ANNOUNCEMENT] },
};

const texts = (doc) =>
  Object.values(doc.blocks || {}).map((b) => b.plaintext ?? '');

test('committing a forced footer saves only the footer, not the other fields\' templates or the page', async () => {
  let c = 0;
  const uuidGenerator = () => `uuid-${++c}`;
  const loadTemplate = async (id) => {
    const tpl = templates[new URL(id, 'http://x').pathname];
    if (!tpl) throw new Error(`no template ${id}`);
    return tpl;
  };

  // 1. Open the page for editing: every field gets its forced template.
  const { merged: formData } = await mergeTemplatesIntoPage(page, {
    loadTemplate,
    pageBlocksFields,
    uuidGenerator,
    skipOwnTemplate: true,
  });

  const footerIds = formData.blocks_layout.footer || [];
  expect(footerIds.length).toBeGreaterThan(0);
  const footerInstanceId = formData.blocks[footerIds[0]].templateInstanceId;
  expect(footerInstanceId).toBeTruthy();

  // 2. Commit the footer unchanged — the reverse merge commitTemplateEdit runs
  //    (View.jsx): the footer template, merged against the edited page,
  //    filtered to the footer's instance.
  const { merged: savedFooter } = await mergeTemplatesIntoPage(templates[FOOTER], {
    loadTemplate: async () => formData,
    filterInstanceId: footerInstanceId,
    uuidGenerator,
  });

  // 3. The saved footer holds the footer's own blocks and nothing else.
  const saved = texts(savedFooter);
  expect(saved).toEqual(expect.arrayContaining(['Footer copy', 'Consent copy']));
  expect(saved).not.toContain('Page content');
  expect(saved).not.toContain('Layout header');
  expect(saved).not.toContain('Announcement copy');
  const savedTemplateIds = new Set(
    Object.values(savedFooter.blocks).map((b) => b.templateId),
  );
  expect([...savedTemplateIds]).toEqual([FOOTER]);
});
