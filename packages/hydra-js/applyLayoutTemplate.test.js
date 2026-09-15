import { expandTemplates, expandTemplatesSync } from '@volto-hydra/helpers';
import { mergeTemplatesIntoPage } from './mergeTemplates.js';

// Wrapper to match old applyLayoutTemplate signature for existing tests
async function applyLayoutTemplate(pageData, templateData, uuidGenerator) {
  const templateUrl = templateData['@id'];
  const { merged } = await mergeTemplatesIntoPage(pageData, {
    loadTemplate: async () => templateData,
    pageBlocksFields: { items: { allowedLayouts: [templateUrl] } },
    uuidGenerator,
  });
  return merged;
}

// Wrapper to match old mergeTemplateContent signature for existing tests
async function mergeTemplateContent(target, source, filterTemplateId = null) {
  // For merge tests, source contains template structure, target has page content
  // This simulates the old merge behavior
  const { merged } = await mergeTemplatesIntoPage(target, {
    loadTemplate: async () => source,
    pageBlocksFields: { items: {} },
  });
  return { merged };
}

describe('applyLayoutTemplate', () => {
  let counter = 0;
  const uuidGenerator = () => `uuid-${++counter}`;

  beforeEach(() => {
    counter = 0;
  });

  describe('first time layout application', () => {
    test('applies layout with header, default, footer to page with user content', async () => {
      const pageData = {
        blocks: {
          'user-block-1': { '@type': 'slate', value: [{ text: 'User content 1' }] },
          'user-block-2': { '@type': 'slate', value: [{ text: 'User content 2' }] },
        },
        blocks_layout: { items: ['user-block-1', 'user-block-2'] },
      };

      const templateData = {
        '@id': '/templates/header-footer',
        blocks: {
          'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header' }] },
          'default-slot': { '@type': 'slate', slotId: 'default', value: [] },
          'footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'Footer' }] },
        },
        blocks_layout: { items: ['header', 'default-slot', 'footer'] },
      };

      const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);

      // Debug: check what we got
      const blockIds = Object.keys(result.blocks);
      const layoutItems = result.blocks_layout?.items || [];

      // User content should be preserved
      expect(result.blocks['user-block-1']).toBeDefined();
      expect(result.blocks['user-block-2']).toBeDefined();

      // Should have header slot block
      const headerBlocks = Object.entries(result.blocks).filter(([_, b]) => b.slotId === 'header');
      expect(headerBlocks.length).toBeGreaterThanOrEqual(1);

      // Should have footer slot block
      const footerBlocks = Object.entries(result.blocks).filter(([_, b]) => b.slotId === 'footer');
      expect(footerBlocks.length).toBeGreaterThanOrEqual(1);

      // Should have: header (fixed) + footer (fixed) + 2 user blocks = 4
      // The template's non-fixed default-slot is replaced by user content
      expect(blockIds.length).toBe(4);

      // All blocks should have the new templateId
      for (const block of Object.values(result.blocks)) {
        expect(block.templateId).toBe('/templates/header-footer');
      }
    });

    test('user content goes into default slot', async () => {
      const pageData = {
        blocks: {
          'user-block': { '@type': 'slate', value: [{ text: 'User content' }] },
        },
        blocks_layout: { items: ['user-block'] },
      };

      const templateData = {
        '@id': '/templates/test',
        blocks: {
          'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header' }] },
          'default-slot': { '@type': 'slate', slotId: 'default', value: [] },
        },
        blocks_layout: { items: ['header', 'default-slot'] },
      };

      const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);

      // User block should have slotId: 'default'
      expect(result.blocks['user-block'].slotId).toBe('default');
    });

    test('blocks are ordered: header, user content, footer', async () => {
      const pageData = {
        blocks: {
          'user-block-1': { '@type': 'slate', value: [{ text: 'User 1' }] },
          'user-block-2': { '@type': 'slate', value: [{ text: 'User 2' }] },
        },
        blocks_layout: { items: ['user-block-1', 'user-block-2'] },
      };

      const templateData = {
        '@id': '/templates/header-footer',
        blocks: {
          'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header' }] },
          'default-slot': { '@type': 'slate', slotId: 'default', value: [] },
          'footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'Footer' }] },
        },
        blocks_layout: { items: ['header', 'default-slot', 'footer'] },
      };

      const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);
      const layout = result.blocks_layout.items;

      // Find positions
      const headerIndex = layout.findIndex(id => result.blocks[id]?.slotId === 'header');
      const footerIndex = layout.findIndex(id => result.blocks[id]?.slotId === 'footer');
      const user1Index = layout.indexOf('user-block-1');
      const user2Index = layout.indexOf('user-block-2');

      // Header at start
      expect(headerIndex).toBe(0);
      // Footer at end
      expect(footerIndex).toBe(layout.length - 1);
      // User content between header and footer
      expect(user1Index).toBeGreaterThan(headerIndex);
      expect(user1Index).toBeLessThan(footerIndex);
      expect(user2Index).toBeGreaterThan(headerIndex);
      expect(user2Index).toBeLessThan(footerIndex);
    });
  });

  describe('layout switching', () => {
    test('multiple user blocks in default slot preserved when switching layouts', async () => {
      // Page with existing layout applied (blocks have templateId)
      const pageData = {
        blocks: {
          'old-header': { '@type': 'slate', fixed: true, templateId: '/templates/old', slotId: 'header', value: [{ text: 'Old Header' }] },
          'user-block-1': { '@type': 'slate', templateId: '/templates/old', slotId: 'default', value: [{ text: 'User 1' }] },
          'user-block-2': { '@type': 'slate', templateId: '/templates/old', slotId: 'default', value: [{ text: 'User 2' }] },
          'old-footer': { '@type': 'slate', fixed: true, templateId: '/templates/old', slotId: 'footer', value: [{ text: 'Old Footer' }] },
        },
        blocks_layout: { items: ['old-header', 'user-block-1', 'user-block-2', 'old-footer'] },
      };

      const newTemplateData = {
        '@id': '/templates/new',
        blocks: {
          'new-header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'New Header' }] },
          'new-default': { '@type': 'slate', slotId: 'default', value: [] },
          'new-footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'New Footer' }] },
        },
        blocks_layout: { items: ['new-header', 'new-default', 'new-footer'] },
      };

      const result = await applyLayoutTemplate(pageData, newTemplateData, uuidGenerator);

      // Both user blocks should be preserved
      expect(result.blocks['user-block-1']).toBeDefined();
      expect(result.blocks['user-block-2']).toBeDefined();

      // Fixed blocks reuse IDs but have new templateId and preserved content (editable)
      expect(result.blocks['old-header']).toBeDefined();
      expect(result.blocks['old-header'].templateId).toBe('/templates/new');
      expect(result.blocks['old-header'].value[0].text).toBe('Old Header'); // Content preserved
      expect(result.blocks['old-footer']).toBeDefined();
      expect(result.blocks['old-footer'].templateId).toBe('/templates/new');

      // All blocks should have new templateId
      for (const block of Object.values(result.blocks)) {
        expect(block.templateId).toBe('/templates/new');
      }
    });

    test('old fixed blocks replaced by new template fixed blocks', async () => {
      const pageData = {
        blocks: {
          'old-header': { '@type': 'slate', fixed: true, templateId: '/templates/old', slotId: 'header', value: [{ text: 'Old Header' }] },
          'user-block': { '@type': 'slate', templateId: '/templates/old', slotId: 'default', value: [{ text: 'User' }] },
        },
        blocks_layout: { items: ['old-header', 'user-block'] },
      };

      const newTemplateData = {
        '@id': '/templates/new',
        blocks: {
          'new-header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'New Header' }] },
          'new-default': { '@type': 'slate', slotId: 'default', value: [] },
        },
        blocks_layout: { items: ['new-header', 'new-default'] },
      };

      const result = await applyLayoutTemplate(pageData, newTemplateData, uuidGenerator);

      // Old header ID is reused with new templateId and preserved content (editable)
      expect(result.blocks['old-header']).toBeDefined();
      expect(result.blocks['old-header'].templateId).toBe('/templates/new');
      expect(result.blocks['old-header'].value[0].text).toBe('Old Header'); // Content preserved

      // Should have exactly one header block
      const headerBlocks = Object.entries(result.blocks).filter(
        ([_, b]) => b.slotId === 'header' && b.fixed
      );
      expect(headerBlocks.length).toBe(1);
    });

    test('non-matching slot (footer removed) - user content preserved', async () => {
      const pageData = {
        blocks: {
          'old-header': { '@type': 'slate', fixed: true, templateId: '/templates/old', slotId: 'header', value: [{ text: 'Old Header' }] },
          'user-block': { '@type': 'slate', templateId: '/templates/old', slotId: 'default', value: [{ text: 'User' }] },
          'old-footer': { '@type': 'slate', fixed: true, templateId: '/templates/old', slotId: 'footer', value: [{ text: 'Old Footer' }] },
        },
        blocks_layout: { items: ['old-header', 'user-block', 'old-footer'] },
      };

      // New template has no footer
      const newTemplateData = {
        '@id': '/templates/header-only',
        blocks: {
          'new-header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'New Header' }] },
          'new-default': { '@type': 'slate', slotId: 'default', value: [] },
        },
        blocks_layout: { items: ['new-header', 'new-default'] },
      };

      const result = await applyLayoutTemplate(pageData, newTemplateData, uuidGenerator);

      // User content preserved
      expect(result.blocks['user-block']).toBeDefined();

      // Old footer should be gone (no matching slot)
      expect(result.blocks['old-footer']).toBeUndefined();

      // No footer slot in result
      const footerBlocks = Object.entries(result.blocks).filter(
        ([_, b]) => b.slotId === 'footer'
      );
      expect(footerBlocks.length).toBe(0);
    });
  });
});

describe('mergeTemplateContent', () => {
  test('collects multiple blocks per slot', async () => {
    const target = {
      blocks: {
        'target-default': { '@type': 'slate', templateId: '/templates/test', templateInstanceId: 'inst-1', slotId: 'default', value: [] },
      },
      blocks_layout: { items: ['target-default'] },
    };

    const source = {
      '@id': '/templates/test',
      blocks: {
        'source-1': { '@type': 'slate', slotId: 'default', value: [{ text: 'Source 1' }] },
        'source-2': { '@type': 'slate', slotId: 'default', value: [{ text: 'Source 2' }] },
      },
      blocks_layout: { items: ['source-1', 'source-2'] },
    };

    const { merged } = await mergeTemplateContent(target, source);

    // User content block should be preserved in the result
    expect(merged.blocks['target-default']).toBeDefined();
    expect(merged.blocks['target-default'].slotId).toBe('default');
  });
});

describe('fallback placement when no default slot', () => {
  let counter = 0;
  const uuidGenerator = () => `fallback-uuid-${++counter}`;

  beforeEach(() => {
    counter = 0;
  });

  test('content goes to bottom slot (after last fixed block) when no default', async () => {
    const pageData = {
      blocks: {
        'user-block': { '@type': 'slate', value: [{ text: 'User content' }] },
      },
      blocks_layout: { items: ['user-block'] },
    };

    // Template with fixed blocks and a non-fixed slot AFTER the last fixed block
    const templateData = {
      '@id': '/templates/bottom-slot',
      blocks: {
        'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header' }] },
        'footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'Footer' }] },
        'post-footer': { '@type': 'slate', slotId: 'post_footer', value: [] },
      },
      blocks_layout: { items: ['header', 'footer', 'post-footer'] },
    };

    const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);
    const layout = result.blocks_layout.items;

    // User content should exist
    expect(result.blocks['user-block']).toBeDefined();

    // User content should have slotId 'default' assigned
    expect(result.blocks['user-block'].slotId).toBe('default');

    // Find positions
    const footerIndex = layout.findIndex(id => result.blocks[id]?.slotId === 'footer');
    const userIndex = layout.indexOf('user-block');

    // User content should be after footer (in post_footer position since no default)
    expect(userIndex).toBeGreaterThan(footerIndex);
  });

  test('content goes to top slot (before first fixed block) when no default or bottom', async () => {
    const pageData = {
      blocks: {
        'user-block': { '@type': 'slate', value: [{ text: 'User content' }] },
      },
      blocks_layout: { items: ['user-block'] },
    };

    // Template with non-fixed slot BEFORE the first fixed block, no default, no bottom slot
    const templateData = {
      '@id': '/templates/top-slot',
      blocks: {
        'pre-header': { '@type': 'slate', slotId: 'pre_header', value: [] },
        'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header' }] },
        'footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'Footer' }] },
      },
      blocks_layout: { items: ['pre-header', 'header', 'footer'] },
    };

    const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);
    const layout = result.blocks_layout.items;

    // User content should exist
    expect(result.blocks['user-block']).toBeDefined();

    // Find positions
    const headerIndex = layout.findIndex(id => result.blocks[id]?.slotId === 'header');
    const userIndex = layout.indexOf('user-block');

    // User content should be before header (in pre_header position)
    expect(userIndex).toBeLessThan(headerIndex);
  });

  test('content is dropped when no default, no bottom, no top slot', async () => {
    const pageData = {
      blocks: {
        'user-block': { '@type': 'slate', value: [{ text: 'User content' }] },
      },
      blocks_layout: { items: ['user-block'] },
    };

    // Template with ONLY fixed blocks - no slots for user content
    const templateData = {
      '@id': '/templates/fixed-only',
      blocks: {
        'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header' }] },
        'footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'Footer' }] },
      },
      blocks_layout: { items: ['header', 'footer'] },
    };

    const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);

    // User content should be dropped (not in result)
    expect(result.blocks['user-block']).toBeUndefined();

    // Only fixed blocks should remain
    const layout = result.blocks_layout.items;
    expect(layout.length).toBe(2);
  });

  test('default slot takes priority over bottom/top slots', async () => {
    const pageData = {
      blocks: {
        'user-block': { '@type': 'slate', value: [{ text: 'User content' }] },
      },
      blocks_layout: { items: ['user-block'] },
    };

    // Template with default AND bottom slot - default should win
    const templateData = {
      '@id': '/templates/default-and-bottom',
      blocks: {
        'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header' }] },
        'default-slot': { '@type': 'slate', slotId: 'default', value: [] },
        'footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'Footer' }] },
        'post-footer': { '@type': 'slate', slotId: 'post_footer', value: [] },
      },
      blocks_layout: { items: ['header', 'default-slot', 'footer', 'post-footer'] },
    };

    const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);
    const layout = result.blocks_layout.items;

    // Find positions
    const headerIndex = layout.findIndex(id => result.blocks[id]?.slotId === 'header');
    const footerIndex = layout.findIndex(id => result.blocks[id]?.slotId === 'footer');
    const userIndex = layout.indexOf('user-block');

    // User content should be between header and footer (in default position, not post_footer)
    expect(userIndex).toBeGreaterThan(headerIndex);
    expect(userIndex).toBeLessThan(footerIndex);
  });
});

describe('page reload merge - standalone blocks preserved', () => {
  test('standalone blocks (no templateId) are preserved at original positions during merge', async () => {
    // Simulates a page that has a layout applied plus standalone blocks outside the template
    // On page reload, merge is called to sync template content
    // Standalone blocks should NOT be affected

    const target = {
      blocks: {
        'standalone-before': {
          '@type': 'slate',
          // No templateId, no slotId - this is outside the template
          value: [{ text: 'Standalone before' }],
        },
        'template-header': {
          '@type': 'slate',
          fixed: true,
          readOnly: true,
          templateId: '/templates/test',
          templateInstanceId: 'inst-1',
          slotId: 'header',
          value: [{ text: 'Old Header' }],
        },
        'user-content': {
          '@type': 'slate',
          templateId: '/templates/test',
          templateInstanceId: 'inst-1',
          slotId: 'default',
          value: [{ text: 'User content' }],
        },
        'template-footer': {
          '@type': 'slate',
          fixed: true,
          readOnly: true,
          templateId: '/templates/test',
          templateInstanceId: 'inst-1',
          slotId: 'footer',
          value: [{ text: 'Old Footer' }],
        },
        'standalone-after': {
          '@type': 'slate',
          // No templateId, no slotId - this is outside the template
          value: [{ text: 'Standalone after' }],
        },
      },
      blocks_layout: {
        items: ['standalone-before', 'template-header', 'user-content', 'template-footer', 'standalone-after'],
      },
    };

    const source = {
      '@id': '/templates/test',
      blocks: {
        'src-header': {
          '@type': 'slate',
          fixed: true,
          readOnly: true,
          slotId: 'header',
          value: [{ text: 'New Header From Template' }],
        },
        'src-default': {
          '@type': 'slate',
          slotId: 'default',
          value: [],
        },
        'src-footer': {
          '@type': 'slate',
          fixed: true,
          readOnly: true,
          slotId: 'footer',
          value: [{ text: 'New Footer From Template' }],
        },
      },
      blocks_layout: { items: ['src-header', 'src-default', 'src-footer'] },
    };

    const { merged } = await mergeTemplateContent(target, source);

    // Standalone blocks should be preserved
    expect(merged.blocks['standalone-before']).toBeDefined();
    expect(merged.blocks['standalone-after']).toBeDefined();

    // They should be at their original positions (before and after template content)
    const layout = merged.blocks_layout.items;
    const standaloneBefore = layout.indexOf('standalone-before');
    const standaloneAfter = layout.indexOf('standalone-after');

    // Find template block positions
    const headerIndex = layout.findIndex(id => merged.blocks[id]?.slotId === 'header');
    const footerIndex = layout.findIndex(id => merged.blocks[id]?.slotId === 'footer');

    expect(standaloneBefore).toBeLessThan(headerIndex);
    expect(standaloneAfter).toBeGreaterThan(footerIndex);

    // User content should be preserved
    expect(merged.blocks['user-content']).toBeDefined();
  });
});

describe('reverse merge - page to template (for saving)', () => {
  let counter = 0;
  const uuidGenerator = () => `uuid-${++counter}`;

  beforeEach(() => {
    counter = 0;
  });

  test('user edits in page merge back to template', async () => {
    // Original template - has templateId pointing to itself and instanceId
    const template = {
      '@id': '/templates/header-footer',
      blocks: {
        'header': { '@type': 'slate', fixed: true, readOnly: true, templateId: '/templates/header-footer', templateInstanceId: 'inst-1', slotId: 'header', value: [{ text: 'Original Header' }] },
        'default-slot': { '@type': 'slate', templateId: '/templates/header-footer', templateInstanceId: 'inst-1', slotId: 'default', value: [] },
        'footer': { '@type': 'slate', fixed: true, readOnly: true, templateId: '/templates/header-footer', templateInstanceId: 'inst-1', slotId: 'footer', value: [{ text: 'Original Footer' }] },
      },
      blocks_layout: { items: ['header', 'default-slot', 'footer'] },
    };

    // Page with layout applied - user has added content and edited fixed blocks
    const pageWithEdits = {
      blocks: {
        'page-header': {
          '@type': 'slate',
          fixed: true,
          readOnly: true,
          templateId: '/templates/header-footer',
          templateInstanceId: 'inst-1',
          slotId: 'header',
          value: [{ text: 'User Edited Header' }], // User edited the header (in template edit mode)
        },
        'user-block-1': {
          '@type': 'slate',
          templateId: '/templates/header-footer',
          templateInstanceId: 'inst-1',
          slotId: 'default',
          value: [{ text: 'User content 1' }],
        },
        'user-block-2': {
          '@type': 'slate',
          templateId: '/templates/header-footer',
          templateInstanceId: 'inst-1',
          slotId: 'default',
          value: [{ text: 'User content 2' }],
        },
        'page-footer': {
          '@type': 'slate',
          fixed: true,
          readOnly: true,
          templateId: '/templates/header-footer',
          templateInstanceId: 'inst-1',
          slotId: 'footer',
          value: [{ text: 'User Edited Footer' }], // User edited the footer (in template edit mode)
        },
      },
      blocks_layout: { items: ['page-header', 'user-block-1', 'user-block-2', 'page-footer'] },
    };

    // Merge page content back INTO template (reverse direction)
    // This simulates what happens on save
    const { merged } = await mergeTemplatesIntoPage(template, {
      loadTemplate: async () => pageWithEdits, // The "template" to load is actually the page
      pageBlocksFields: { items: { allowedLayouts: ['/templates/header-footer'] } },
      uuidGenerator,
    });

    // Template should now have user's edits in the fixed blocks
    const headerBlock = Object.values(merged.blocks).find(b => b.slotId === 'header' && b.fixed);
    expect(headerBlock).toBeDefined();
    expect(headerBlock.value[0].text).toBe('User Edited Header');

    const footerBlock = Object.values(merged.blocks).find(b => b.slotId === 'footer' && b.fixed);
    expect(footerBlock).toBeDefined();
    expect(footerBlock.value[0].text).toBe('User Edited Footer');
  });

  // The admin SAVE path (View.jsx "REVERSE MERGE") uses filterInstanceId — NOT
  // allowedLayouts — to merge the edited instance back into the template, so a
  // fixed+readOnly edit made in template edit mode propagates to OTHER pages using the
  // template. This is integration :866 ("saved template changes … appear on other
  // pages") at the unit level; the allowedLayouts reverse test above does not cover it.
  test('a fixed+readOnly template edit propagates to another page (reverse capture + forward apply)', async () => {
    let counter2 = 0;
    const uuidGen = () => `rev-${++counter2}`;
    const template = {
      '@id': '/templates/hf',
      blocks: {
        header: { '@type': 'slate', fixed: true, readOnly: true, templateId: '/templates/hf', templateInstanceId: 'inst-1', slotId: 'header', value: [{ text: 'Original Header' }] },
        'default-slot': { '@type': 'slate', templateId: '/templates/hf', templateInstanceId: 'inst-1', slotId: 'default', value: [] },
      },
      blocks_layout: { items: ['header', 'default-slot'] },
    };
    // The page as edited in template edit mode: the fixed+readOnly header was changed.
    const pageWithEdits = {
      blocks: {
        'page-header': { '@type': 'slate', fixed: true, readOnly: true, templateId: '/templates/hf', templateInstanceId: 'inst-1', slotId: 'header', value: [{ text: 'Edited Header' }] },
        'user-block-1': { '@type': 'slate', templateId: '/templates/hf', templateInstanceId: 'inst-1', slotId: 'default', value: [{ text: 'User content' }] },
      },
      blocks_layout: { items: ['page-header', 'user-block-1'] },
    };
    // 1. SAVE: reverse-merge (filterInstanceId) captures the edit into the template.
    const { merged: updatedTemplate } = await mergeTemplatesIntoPage(template, {
      loadTemplate: async () => pageWithEdits,
      filterInstanceId: 'inst-1',
      uuidGenerator: uuidGen,
    });
    const header = Object.values(updatedTemplate.blocks).find((b) => b.slotId === 'header' && b.fixed);
    expect(header?.value?.[0]?.text).toBe('Edited Header'); // captured into the template

    // 2. VIEW another page: a DIFFERENT page (its own instanceId) forward-merges the
    // UPDATED template and must show the edit — this is integration :866's assertion.
    const page2 = {
      blocks: {
        'p2-header': { '@type': 'slate', fixed: true, readOnly: true, templateId: '/templates/hf', templateInstanceId: 'inst-2', slotId: 'header', value: [{ text: 'Original Header' }] },
        'p2-user': { '@type': 'slate', templateId: '/templates/hf', templateInstanceId: 'inst-2', slotId: 'default', value: [{ text: 'Page 2 content' }] },
      },
      blocks_layout: { items: ['p2-header', 'p2-user'] },
    };
    const { merged: page2Merged } = await mergeTemplatesIntoPage(page2, {
      loadTemplate: async () => updatedTemplate,
      uuidGenerator: uuidGen,
    });
    const p2Header = Object.values(page2Merged.blocks).find((b) => b.slotId === 'header' && b.fixed);
    expect(p2Header?.value?.[0]?.text).toBe('Edited Header'); // propagated to page 2
  });

  test('fixed+readOnly transfers to template, fixed+editable stays on page', async () => {
    // When saving to template:
    // - Fixed + readOnly block edits → transfer to template (template-owned content)
    // - Fixed + editable block edits → stay on page (page-level overrides)
    // - User content in slots → stays on page
    const template = {
      '@id': '/templates/mixed',
      blocks: {
        'readonly-header': { '@type': 'slate', fixed: true, readOnly: true, templateId: '/templates/mixed', templateInstanceId: 'inst-1', slotId: 'header', value: [{ text: 'Original ReadOnly Header' }] },
        'editable-banner': { '@type': 'slate', fixed: true, templateId: '/templates/mixed', templateInstanceId: 'inst-1', slotId: 'banner', value: [{ text: 'Original Editable Banner' }] },
        'default-slot': { '@type': 'slate', templateId: '/templates/mixed', templateInstanceId: 'inst-1', slotId: 'default', value: [] },
      },
      blocks_layout: { items: ['readonly-header', 'editable-banner', 'default-slot'] },
    };

    const pageWithEdits = {
      blocks: {
        'page-header': {
          '@type': 'slate',
          fixed: true,
          readOnly: true,
          templateId: '/templates/mixed',
          templateInstanceId: 'inst-1',
          slotId: 'header',
          value: [{ text: 'Edited ReadOnly Header' }], // Template edit mode changed this
        },
        'page-banner': {
          '@type': 'slate',
          fixed: true,
          // No readOnly - this is editable per-page
          templateId: '/templates/mixed',
          templateInstanceId: 'inst-1',
          slotId: 'banner',
          value: [{ text: 'Page-specific Banner' }], // Page override - should NOT go to template
        },
        'user-content': {
          '@type': 'slate',
          templateId: '/templates/mixed',
          templateInstanceId: 'inst-1',
          slotId: 'default',
          value: [{ text: 'User content' }],
        },
      },
      blocks_layout: { items: ['page-header', 'page-banner', 'user-content'] },
    };

    const { merged } = await mergeTemplatesIntoPage(template, {
      loadTemplate: async () => pageWithEdits,
      pageBlocksFields: { items: { allowedLayouts: ['/templates/mixed'] } },
      uuidGenerator,
    });

    // Fixed+readOnly header should have the edited content (transfers to template)
    const headerBlock = Object.values(merged.blocks).find(b => b.slotId === 'header' && b.fixed && b.readOnly);
    expect(headerBlock).toBeDefined();
    expect(headerBlock.value[0].text).toBe('Edited ReadOnly Header');

    // Fixed+editable banner should keep ORIGINAL template content (page edits don't transfer)
    const bannerBlock = Object.values(merged.blocks).find(b => b.slotId === 'banner' && b.fixed && !b.readOnly);
    expect(bannerBlock).toBeDefined();
    expect(bannerBlock.value[0].text).toBe('Original Editable Banner');
  });
});

describe('expandTemplates preserves untouched blocks', () => {
  test('blocks without template pass through unchanged', async () => {
    const blocks = {
      'block-abc-123': { '@type': 'slate', value: [{ type: 'p', nodeId: '0', children: [{ text: 'Content' }] }] },
    };
    const layout = ['block-abc-123'];

    const items = await expandTemplates(layout, { blocks, templateState: {} });

    expect(items.length).toBe(1);
    expect(items[0]['@uid']).toBe('block-abc-123');
    expect(items[0].value[0].nodeId).toBe('0');
  });

  test('blocks with template already applied preserve IDs when allowedLayouts matches', async () => {
    // Simulates Nuxt scenario: page already has template, allowedLayouts is configured
    const blocks = {
      'existing-header-id': {
        '@type': 'slate',
        fixed: true,
        templateId: '/templates/test',
        templateInstanceId: 'inst-123',
        slotId: 'header',
        value: [{ type: 'h1', nodeId: '0', children: [{ text: 'Header' }] }],
      },
      'existing-user-id': {
        '@type': 'slate',
        templateId: '/templates/test',
        templateInstanceId: 'inst-123',
        slotId: 'default',
        value: [{ type: 'p', nodeId: '0', children: [{ text: 'User content' }] }],
      },
    };
    const layout = ['existing-header-id', 'existing-user-id'];

    const templateData = {
      '@id': '/templates/test',
      blocks: {
        'tpl-header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ type: 'h1', children: [{ text: 'Template Header' }] }] },
        'tpl-default': { '@type': 'slate', slotId: 'default', value: [] },
      },
      blocks_layout: { items: ['tpl-header', 'tpl-default'] },
    };

    const items = await expandTemplates(layout, {
      blocks,
      templateState: {},
      loadTemplate: async () => templateData,
      allowedLayouts: ['/templates/test'], // Same template as already applied
    });

    // Should preserve existing block IDs, not create synthetic ones
    const uids = items.map(item => item['@uid']);
    expect(uids).toContain('existing-header-id');
    expect(uids).toContain('existing-user-id');
    // Should NOT have synthetic IDs
    expect(uids.every(uid => !uid.includes('::'))).toBe(true);
    // nodeIds should be preserved
    const headerItem = items.find(i => i['@uid'] === 'existing-header-id');
    expect(headerItem.value[0].nodeId).toBe('0');
  });
});

describe('sequential layout switching', () => {
  let counter = 0;
  const uuidGenerator = () => `uuid-${++counter}`;

  test('fixed readOnly block uses new template content (not preserved)', async () => {
    // Source has readOnly header - content should NOT be preserved
    const pageData = {
      blocks: {
        'old-header': { '@type': 'slate', fixed: true, readOnly: true, templateId: '/templates/old', slotId: 'header', value: [{ text: 'Old ReadOnly Header' }] },
        'user-block': { '@type': 'slate', templateId: '/templates/old', slotId: 'default', value: [{ text: 'User' }] },
      },
      blocks_layout: { items: ['old-header', 'user-block'] },
    };

    const newTemplateData = {
      '@id': '/templates/new',
      blocks: {
        'new-header': { '@type': 'slate', fixed: true, readOnly: true, slotId: 'header', value: [{ text: 'New ReadOnly Header' }] },
        'new-default': { '@type': 'slate', slotId: 'default', value: [] },
      },
      blocks_layout: { items: ['new-header', 'new-default'] },
    };

    const result = await applyLayoutTemplate(pageData, newTemplateData, uuidGenerator);

    // Header should have NEW template's content (readOnly = don't preserve)
    const headerBlocks = Object.entries(result.blocks).filter(([_, b]) => b.slotId === 'header' && b.fixed);
    expect(headerBlocks.length).toBe(1);
    expect(headerBlocks[0][1].value[0].text).toBe('New ReadOnly Header');
  });

  test('can switch from one layout to another', async () => {
    // Step 1: Start with plain page
    const pageData = {
      blocks: {
        'user-block': { '@type': 'slate', value: [{ text: 'User content' }] },
      },
      blocks_layout: { items: ['user-block'] },
    };

    // Step 2: Apply first layout (header-footer)
    const layout1 = {
      '@id': '/templates/header-footer',
      blocks: {
        'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Layout Header' }] },
        'default-slot': { '@type': 'slate', slotId: 'default', value: [] },
        'footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'Layout Footer' }] },
      },
      blocks_layout: { items: ['header', 'default-slot', 'footer'] },
    };

    const afterFirst = await applyLayoutTemplate(pageData, layout1, uuidGenerator);

    // Verify first layout applied
    expect(afterFirst.blocks['user-block']).toBeDefined();
    const headerBlocksAfterFirst = Object.entries(afterFirst.blocks).filter(([_, b]) => b.slotId === 'header' && b.fixed);
    expect(headerBlocksAfterFirst.length).toBe(1);
    expect(headerBlocksAfterFirst[0][1].value[0].text).toBe('Layout Header');

    // Step 3: Apply second layout (header-only)
    const layout2 = {
      '@id': '/templates/header-only',
      blocks: {
        'header2': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header Only' }] },
        'default2': { '@type': 'slate', slotId: 'default', value: [] },
      },
      blocks_layout: { items: ['header2', 'default2'] },
    };

    const afterSecond = await applyLayoutTemplate(afterFirst, layout2, uuidGenerator);

    // User content should still be preserved
    expect(afterSecond.blocks['user-block']).toBeDefined();

    // Header should preserve content from source (fixed + editable = preserve user's potential edits)
    const headerBlocksAfterSecond = Object.entries(afterSecond.blocks).filter(([_, b]) => b.slotId === 'header' && b.fixed);
    expect(headerBlocksAfterSecond.length).toBe(1);
    expect(headerBlocksAfterSecond[0][1].value[0].text).toBe('Layout Header');

    // Old footer should be gone (no footer in new layout)
    const footerBlocks = Object.entries(afterSecond.blocks).filter(([_, b]) => b.slotId === 'footer');
    expect(footerBlocks.length).toBe(0);

    // All blocks should have new templateId
    for (const block of Object.values(afterSecond.blocks)) {
      expect(block.templateId).toBe('/templates/header-only');
    }
  });
});

describe('multiple template instances with shared templateState', () => {
  // Tests for when a page has multiple blocks fields (e.g., blocks and footer_blocks)
  // Each should be able to have its own template/layout applied independently
  // using the same shared templateState object

  const mainTemplate = {
    '@id': '/templates/main-layout',
    blocks: {
      'main-header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Main Header' }] },
      'main-default': { '@type': 'slate', slotId: 'default', value: [] },
    },
    blocks_layout: { items: ['main-header', 'main-default'] },
  };

  const footerTemplate = {
    '@id': '/templates/footer-layout',
    blocks: {
      'footer-branding': { '@type': 'slate', fixed: true, slotId: 'branding', value: [{ text: 'Footer Branding' }] },
      'footer-default': { '@type': 'slate', slotId: 'default', value: [] },
    },
    blocks_layout: { items: ['footer-branding', 'footer-default'] },
  };

  const templates = {
    '/templates/main-layout': mainTemplate,
    '/templates/footer-layout': footerTemplate,
  };

  test('expandTemplatesSync: separate blocks fields get separate templates with shared state', () => {
    // Main blocks field - user content, force main-layout
    const mainBlocks = {
      'main-user-1': { '@type': 'slate', value: [{ text: 'Main user content' }] },
    };
    const mainLayout = ['main-user-1'];

    // Footer blocks field - user content, force footer-layout
    const footerBlocks = {
      'footer-user-1': { '@type': 'slate', value: [{ text: 'Footer user content' }] },
    };
    const footerLayout = ['footer-user-1'];

    // Shared templateState across both calls (like Vue provide/inject)
    const templateState = {};

    // First call: expand main blocks with main template
    const mainItems = expandTemplatesSync(mainLayout, {
      blocks: mainBlocks,
      templateState,
      templates,
      allowedLayouts: ['/templates/main-layout'],
    });

    // Second call: expand footer blocks with footer template (same templateState)
    const footerItems = expandTemplatesSync(footerLayout, {
      blocks: footerBlocks,
      templateState,
      templates,
      allowedLayouts: ['/templates/footer-layout'],
    });

    // Main blocks should have main template applied
    expect(mainItems.length).toBeGreaterThan(1); // header + user content
    const mainHeader = mainItems.find(item => item.value?.[0]?.text === 'Main Header');
    expect(mainHeader).toBeDefined();
    const mainUserContent = mainItems.find(item => item.value?.[0]?.text === 'Main user content');
    expect(mainUserContent).toBeDefined();

    // Footer blocks should have footer template applied (NOT main template!)
    expect(footerItems.length).toBeGreaterThan(1); // branding + user content
    const footerBranding = footerItems.find(item => item.value?.[0]?.text === 'Footer Branding');
    expect(footerBranding).toBeDefined();
    const footerUserContent = footerItems.find(item => item.value?.[0]?.text === 'Footer user content');
    expect(footerUserContent).toBeDefined();

    // Footer should NOT have main header (wrong template)
    const wrongHeader = footerItems.find(item => item.value?.[0]?.text === 'Main Header');
    expect(wrongHeader).toBeUndefined();
  });

  test('two containers of the SAME template on one page keep separate instanceIds + content', async () => {
    // The data-derived recognition (by minted templateInstanceId) must keep two
    // instances of the same template independent — no cross-contamination of slot
    // content, distinct instance ids, each container re-enters as ITS own instance.
    const cardTemplate = {
      '@id': '/templates/card',
      blocks: {
        'card': {
          '@type': 'columns', fixed: true, readOnly: true,
          templateId: '/templates/card', slotId: 'card',
          blocks: {
            'card-body': { '@type': 'slate', templateId: '/templates/card', slotId: 'body' },
          },
          blocks_layout: { items: ['card-body'] },
        },
      },
      blocks_layout: { items: ['card'] },
    };
    // A loaded page with TWO card instances (e.g. the user inserted the card twice),
    // each carrying its own instanceId and its own body content.
    const page = {
      blocks: {
        'cardA': {
          '@type': 'columns', fixed: true, readOnly: true,
          templateId: '/templates/card', templateInstanceId: 'inst-A', slotId: 'card',
          blocks: { 'bodyA': { '@type': 'slate', templateId: '/templates/card', templateInstanceId: 'inst-A', slotId: 'body', value: [{ text: 'Body A' }] } },
          blocks_layout: { items: ['bodyA'] },
        },
        'cardB': {
          '@type': 'columns', fixed: true, readOnly: true,
          templateId: '/templates/card', templateInstanceId: 'inst-B', slotId: 'card',
          blocks: { 'bodyB': { '@type': 'slate', templateId: '/templates/card', templateInstanceId: 'inst-B', slotId: 'body', value: [{ text: 'Body B' }] } },
          blocks_layout: { items: ['bodyB'] },
        },
      },
      blocks_layout: { items: ['cardA', 'cardB'] },
    };
    const { merged } = await mergeTemplatesIntoPage(page, {
      loadTemplate: async () => cardTemplate,
      pageBlocksFields: { items: {} },
      uuidGenerator: (() => { let c = 0; return () => `u-${++c}`; })(),
    });

    const cards = Object.values(merged.blocks).filter((b) => b.slotId === 'card');
    expect(cards.length).toBe(2); // both instances survive
    expect(new Set(cards.map((c) => c.templateInstanceId)).size).toBe(2); // distinct

    const bodyText = (card) =>
      Object.values(card.blocks || {}).find((b) => b.slotId === 'body')?.value?.[0]?.text;
    const cardWith = (text) => cards.find((c) => bodyText(c) === text);
    const cA = cardWith('Body A');
    const cB = cardWith('Body B');
    expect(cA).toBeDefined(); // Body A stayed in its own card
    expect(cB).toBeDefined(); // Body B stayed in its own card
    expect(cA.templateInstanceId).not.toBe(cB.templateInstanceId);
  });

  test('expandTemplatesSync: blocks field without template passes through unchanged', () => {
    // Main blocks - has forced layout
    const mainBlocks = {
      'main-user-1': { '@type': 'slate', value: [{ text: 'Main content' }] },
    };
    const mainLayout = ['main-user-1'];

    // Footer blocks - no allowedLayouts, should pass through
    const footerBlocks = {
      'footer-user-1': { '@type': 'slate', value: [{ text: 'Footer content' }] },
    };
    const footerLayout = ['footer-user-1'];

    const templateState = {};

    // First call: main blocks with template
    const mainItems = expandTemplatesSync(mainLayout, {
      blocks: mainBlocks,
      templateState,
      templates,
      allowedLayouts: ['/templates/main-layout'],
    });

    // Second call: footer blocks WITHOUT template
    const footerItems = expandTemplatesSync(footerLayout, {
      blocks: footerBlocks,
      templateState,
      templates,
      allowedLayouts: null, // No forced layout
    });

    // Main should have template applied
    expect(mainItems.length).toBeGreaterThan(1);

    // Footer should pass through unchanged (just 1 item)
    expect(footerItems.length).toBe(1);
    expect(footerItems[0]['@uid']).toBe('footer-user-1');
    expect(footerItems[0].value[0].text).toBe('Footer content');
  });

  test('expandTemplatesSync: re-calling same blocks field is idempotent', () => {
    const mainBlocks = {
      'main-user-1': { '@type': 'slate', value: [{ text: 'Main content' }] },
    };
    const mainLayout = ['main-user-1'];

    const templateState = {};

    // First call
    const items1 = expandTemplatesSync(mainLayout, {
      blocks: mainBlocks,
      templateState,
      templates,
      allowedLayouts: ['/templates/main-layout'],
    });

    // Second call with same data (simulates re-render)
    const items2 = expandTemplatesSync(mainLayout, {
      blocks: mainBlocks,
      templateState,
      templates,
      allowedLayouts: ['/templates/main-layout'],
    });

    // Results should be equivalent
    expect(items1.length).toBe(items2.length);
    expect(items1.map(i => i['@uid'])).toEqual(items2.map(i => i['@uid']));
  });

  test('expandTemplates async: separate blocks fields get separate templates', async () => {
    // Same test but for async version
    const mainBlocks = {
      'main-user-1': { '@type': 'slate', value: [{ text: 'Main user content' }] },
    };
    const mainLayout = ['main-user-1'];

    const footerBlocks = {
      'footer-user-1': { '@type': 'slate', value: [{ text: 'Footer user content' }] },
    };
    const footerLayout = ['footer-user-1'];

    const templateState = {};
    const loadTemplate = async (id) => templates[id];

    // First call: main blocks
    const mainItems = await expandTemplates(mainLayout, {
      blocks: mainBlocks,
      templateState,
      loadTemplate,
      allowedLayouts: ['/templates/main-layout'],
    });

    // Second call: footer blocks
    const footerItems = await expandTemplates(footerLayout, {
      blocks: footerBlocks,
      templateState,
      loadTemplate,
      allowedLayouts: ['/templates/footer-layout'],
    });

    // Main should have main template
    const mainHeader = mainItems.find(item => item.value?.[0]?.text === 'Main Header');
    expect(mainHeader).toBeDefined();

    // Footer should have footer template
    const footerBranding = footerItems.find(item => item.value?.[0]?.text === 'Footer Branding');
    expect(footerBranding).toBeDefined();

    // Footer should NOT have main header
    const wrongHeader = footerItems.find(item => item.value?.[0]?.text === 'Main Header');
    expect(wrongHeader).toBeUndefined();
  });
});

describe('nextSlotId and childSlotIds on fixed blocks', () => {
  let counter = 0;
  const uuidGenerator = () => `uuid-${++counter}`;

  beforeEach(() => {
    counter = 0;
  });

  test('nextSlotId is set on fixed block preceding a slot', async () => {
    const pageData = {
      blocks: {
        'user-1': { '@type': 'slate', value: [{ text: 'User content' }], templateId: '/templates/t1', templateInstanceId: 'inst-1', slotId: 'default' },
      },
      blocks_layout: { items: ['user-1'] },
    };

    const templateData = {
      '@id': '/templates/t1',
      blocks: {
        'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header' }] },
        'slot': { '@type': 'slate', slotId: 'default', value: [] },
        'footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'Footer' }] },
      },
      blocks_layout: { items: ['header', 'slot', 'footer'] },
    };

    const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);
    const blocks = result.blocks;
    const layout = result.blocks_layout.items;

    // Header should have nextSlotId: 'default' (the slot after it)
    const headerBlock = blocks[layout[0]];
    expect(headerBlock.fixed).toBe(true);
    expect(headerBlock.slotId).toBe('header');
    expect(headerBlock.nextSlotId).toBe('default');

    // Footer should NOT have nextSlotId (nothing follows it)
    const footerBlock = blocks[layout[layout.length - 1]];
    expect(footerBlock.fixed).toBe(true);
    expect(footerBlock.slotId).toBe('footer');
    expect(footerBlock.nextSlotId).toBeUndefined();
  });

  test('nextSlotId not set when next block is another fixed block', async () => {
    const pageData = {
      blocks: {
        'user-1': { '@type': 'slate', value: [{ text: 'User' }], templateId: '/templates/t1', templateInstanceId: 'inst-1', slotId: 'default' },
      },
      blocks_layout: { items: ['user-1'] },
    };

    // Template: header → grid (fixed) → slot → footer
    // header's next is grid (fixed), so header should NOT get nextSlotId
    // grid's next is slot, so grid SHOULD get nextSlotId
    const templateData = {
      '@id': '/templates/t1',
      blocks: {
        'header': { '@type': 'slate', fixed: true, slotId: 'header', value: [{ text: 'Header' }] },
        'grid': { '@type': 'slate', fixed: true, slotId: 'grid', value: [{ text: 'Grid' }] },
        'slot': { '@type': 'slate', slotId: 'default', value: [] },
        'footer': { '@type': 'slate', fixed: true, slotId: 'footer', value: [{ text: 'Footer' }] },
      },
      blocks_layout: { items: ['header', 'grid', 'slot', 'footer'] },
    };

    const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);
    const blocks = result.blocks;
    const layout = result.blocks_layout.items;

    // header → next is grid (fixed) → stop, no nextSlotId
    const headerBlock = blocks[layout[0]];
    expect(headerBlock.nextSlotId).toBeUndefined();

    // grid → next is slot (slotId: 'default') → nextSlotId: 'default'
    const gridBlock = blocks[layout[1]];
    expect(gridBlock.nextSlotId).toBe('default');
  });

  test('childSlotIds set on container fixed block with nested slot', async () => {
    const pageData = {
      blocks: {},
      blocks_layout: { items: [] },
    };

    const templateData = {
      '@id': '/templates/t1',
      blocks: {
        'container': {
          '@type': 'gridBlock',
          fixed: true,
          templateId: '/templates/t1',
          slotId: 'container',
          blocks: {
            'cell-1': { '@type': 'slate', fixed: true, templateId: '/templates/t1', slotId: 'cell-1', value: [{ text: 'Cell 1' }] },
            'cell-2': { '@type': 'slate', templateId: '/templates/t1', slotId: 'sidebar', value: [{ text: 'Sidebar content' }] },
          },
          blocks_layout: { items: ['cell-1', 'cell-2'] },
        },
        'slot': { '@type': 'slate', templateId: '/templates/t1', slotId: 'default', value: [] },
      },
      blocks_layout: { items: ['container', 'slot'] },
    };

    const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);
    const blocks = result.blocks;
    const layout = result.blocks_layout.items;

    // Container block should have childSlotIds with the first non-fixed slot
    const containerBlock = blocks[layout[0]];
    expect(containerBlock.fixed).toBe(true);
    expect(containerBlock.childSlotIds).toEqual({ blocks: 'sidebar' });
    // Container should also have nextSlotId for the top-level slot
    expect(containerBlock.nextSlotId).toBe('default');
  });

  // Same as above, but the container's slot lives in an OBJECT_LIST region (a slider's `slides`),
  // not blocks_layout. The childSlotIds add-path anchor was computed via blocksLayoutRegions only,
  // so an object_list slot container got no anchor. It must be keyed by the field name (`slides`),
  // matching blockSync's parentBlock.childSlotIds[field] lookup.
  test('childSlotIds set on a fixed container whose slot lives in an object_list region (slider slides)', async () => {
    const pageData = { blocks: {}, blocks_layout: { items: [] } };

    const templateData = {
      '@id': '/templates/t2',
      blocks: {
        'slider-c': {
          '@type': 'slider',
          fixed: true,
          templateId: '/templates/t2',
          slotId: 'slider-c',
          slides: [
            { '@id': 'slide-1', '@type': 'slate', fixed: true, templateId: '/templates/t2', slotId: 'slide-1', value: [{ text: 'Fixed slide' }] },
            { '@id': 'slide-2', '@type': 'slate', templateId: '/templates/t2', slotId: 'caption', value: [{ text: 'Caption slot' }] },
          ],
        },
        'slot': { '@type': 'slate', templateId: '/templates/t2', slotId: 'default', value: [] },
      },
      blocks_layout: { items: ['slider-c', 'slot'] },
    };

    const result = await applyLayoutTemplate(pageData, templateData, uuidGenerator);
    const containerBlock = result.blocks[result.blocks_layout.items[0]];
    expect(containerBlock.fixed).toBe(true);
    // The first non-fixed slot inside the object_list `slides` is captured, keyed by field name.
    expect(containerBlock.childSlotIds).toEqual({ slides: 'caption' });
  });
});

describe('mergeTemplatesIntoPage: object_list write-back on frozen input', () => {
  // INITIAL_DATA arrives deep-frozen, and mergeTemplatesIntoPage only
  // shallow-copies each block — so its nested objects are still the frozen
  // originals. Writing an expanded object_list back through a multi-level
  // `dataPath` (slateTable's rows live at `table.rows`) descended into that
  // frozen child and threw "Cannot assign to read only property 'rows'".
  // slateTable is the only shipped block with a depth-2 dataPath, and the
  // only fixture pairing it with a template is docs/examples/table — which
  // no functional test loaded, so the crash shipped unnoticed.

  /** Recursively Object.freeze an object graph, mirroring INITIAL_DATA. */
  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) {
        deepFreeze(value[key]);
      }
    }
    return value;
  }

  // slateTable schema as registered in packages/volto-hydra/src/index.js:
  // `rows` is an object_list whose data lives at block.table.rows — a
  // depth-2 dataPath, the shape that triggers the frozen-write crash.
  const blocksConfig = {
    slateTable: {
      blockSchema: {
        properties: {
          rows: {
            widget: 'object_list',
            idField: 'key',
            dataPath: ['table', 'rows'],
            schema: {
              fieldsets: [{ id: 'default', title: 'Default', fields: ['cells'] }],
              properties: {
                cells: { widget: 'object_list', idField: 'key', schema: { properties: {} } },
              },
            },
          },
        },
      },
    },
  };

  const makeTablePage = () => ({
    blocks: {
      'tbl-1': {
        '@type': 'slateTable',
        table: {
          rows: [
            {
              key: 'row-1',
              cells: [
                { key: 'c1', value: [{ type: 'p', children: [{ text: 'A' }] }] },
              ],
            },
          ],
        },
      },
    },
    blocks_layout: { items: ['tbl-1'] },
  });

  const mergeOptions = () => ({
    loadTemplate: async () => {
      throw new Error('loadTemplate must not run — page has no template refs');
    },
    uuidGenerator: (() => {
      let n = 0;
      return () => `uid-${++n}`;
    })(),
    blocksConfig,
    intl: { formatMessage: ({ defaultMessage }) => defaultMessage || '' },
  });

  test('writes a slateTable rows object_list back through a depth-2 dataPath without throwing', async () => {
    const page = deepFreeze(makeTablePage());

    const { merged } = await mergeTemplatesIntoPage(page, mergeOptions());

    expect(merged.blocks['tbl-1'].table.rows).toHaveLength(1);
    expect(merged.blocks['tbl-1'].table.rows[0].key).toBe('row-1');
    expect(merged.blocks['tbl-1'].table.rows[0].cells).toHaveLength(1);
  });

  test('does not mutate the frozen input page', async () => {
    const page = deepFreeze(makeTablePage());
    await mergeTemplatesIntoPage(page, mergeOptions());
    expect(Object.isFrozen(page.blocks['tbl-1'].table)).toBe(true);
  });
});

describe('a layout menu must not re-home a page', () => {
  const uuidGenerator = (() => { let n = 0; return () => `uuid-${++n}`; })();

  // A page-level blocks field ALWAYS carries its allowedLayouts — that is the
  // layout MENU (`[null, layoutA, layoutB]`), not an instruction. A page laid
  // out with a template the current menu doesn't happen to list (a content-type
  // layout, say, offered only on that content type) was being re-homed to
  // allowedLayouts[0] — `null` by the menu's own convention — which means its
  // layout was REMOVED on load, taking every fixed block with it. Silent, and a
  // save would persist it.
  //
  // The code already draws this distinction for the multi-instance split: "a
  // genuine forced single-layout SWITCH ... passes exactly one allowedLayout; a
  // menu list (length ≠ 1) is a re-render".
  test('a page whose layout is absent from the menu keeps its blocks', async () => {
    const page = {
      '@id': '/docs/examples/an-event',
      blocks: {
        'ev-title': { '@type': 'title', templateId: '/templates/event-view', templateInstanceId: 'tpl-ev', slotId: 'title', readOnly: true, fixed: true },
        'ev-meta': { '@type': 'eventMetadata', templateId: '/templates/event-view', templateInstanceId: 'tpl-ev', slotId: 'event-metadata', fixed: true },
        'ev-body': { '@type': 'slate', templateId: '/templates/event-view', templateInstanceId: 'tpl-ev', slotId: 'content', value: [{ type: 'p', children: [{ text: 'Body' }] }] },
      },
      blocks_layout: { items: ['ev-title', 'ev-meta', 'ev-body'] },
    };

    // The layout the page already uses. A render pass re-applies it (the admin
    // serves these from its template cache); what must NOT happen is the menu
    // swapping it for allowedLayouts[0].
    const eventView = {
      '@id': '/templates/event-view',
      blocks: {
        't-title': { '@type': 'title', templateId: '/templates/event-view', slotId: 'title', readOnly: true, fixed: true },
        't-meta': { '@type': 'eventMetadata', templateId: '/templates/event-view', slotId: 'event-metadata', fixed: true },
        't-content': { '@type': 'slate', templateId: '/templates/event-view', slotId: 'content', value: [] },
      },
      blocks_layout: { items: ['t-title', 't-meta', 't-content'] },
    };

    const { merged } = await mergeTemplatesIntoPage(page, {
      loadTemplate: async (id) => {
        if (id !== '/templates/event-view') {
          throw new Error(`the menu must not apply a different layout (asked for ${id})`);
        }
        return eventView;
      },
      // The frontend's layout menu. It does not list event-view — that layout is
      // offered for Events only — and `null` ("None") leads, as menus do.
      pageBlocksFields: { items: { allowedLayouts: [null, '/templates/test-layout'] } },
      uuidGenerator,
    });

    // If the menu re-homes the page, `null` (its first entry) removes the layout
    // and these three go with it.
    const types = Object.values(merged.blocks).map((b) => b['@type']).sort();
    expect(types).toEqual(['eventMetadata', 'slate', 'title']);
  });
});
