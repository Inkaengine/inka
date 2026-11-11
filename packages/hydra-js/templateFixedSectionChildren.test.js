import { expandTemplatesSync, assertAllExpanded } from '@volto-hydra/helpers';
import { mergeInstanceIntoTemplate } from '@volto-hydra/helpers/mergeTemplates.js';
import { inheritTemplateMembershipDeep } from '@volto-hydra/helpers/blockPath.js';

/**
 * inka#231: a template made from a section, then made "Fixed, read-only" and
 * saved with "Change on all pages", showed its section empty on published pages,
 * while the editor showed the section's button.
 *
 * "Make template" labelled only the section. The merge takes a template's blocks
 * by their templateId, so the unlabelled button was dropped from the template on
 * "Change on all pages", and so from every page using it.
 *
 * This follows the editor's steps: Make template (labelling as the editor does),
 * set the section fixed and read-only, commit, then render another page that uses
 * the template as a published frontend does, every container re-entered with one
 * templateState ("Expand every container" in the templates guide).
 */
describe('a template made from a section keeps its button on published pages (#231)', () => {
  const T = '/templates/untitled-template-1';

  async function makeFixCommit() {
    // The page's section, made into a template (onMakeTemplate).
    const section = inheritTemplateMembershipDeep({
      '@type': 'section',
      blocks: { b1: { '@type': 'button', title: 'Contact us', href: '/contact' } },
      blocks_layout: { items: ['b1'] },
      templateId: T,
      templateInstanceId: T,
      slotId: 'primary',
    }, {});
    const template = { '@id': T, blocks: { 'sec-1': section }, blocks_layout: { items: ['sec-1'] } };
    // Set "Fixed, read-only", then "Change on all pages".
    const page = { blocks: { 'sec-1': { ...section, fixed: true, readOnly: true } }, blocks_layout: { items: ['sec-1'] } };
    let n = 0;
    const { merged } = await mergeInstanceIntoTemplate(template, page, T, { idFieldMap: {}, uuidGenerator: () => `u${++n}` });
    return merged;
  }

  /** Another page using the template, rendered as a published frontend does. */
  function renderPublished(template) {
    const [secId] = template.blocks_layout.items;
    const page = {
      blocks: { s: { ...template.blocks[secId], templateInstanceId: 'other-page' } },
      blocks_layout: { items: ['s'] },
    };
    const templateState = {};
    const opts = { templates: { [T]: template }, templateState, editMode: false };
    const [sec] = expandTemplatesSync(page.blocks_layout.items, { ...opts, blocks: page.blocks });
    const children = expandTemplatesSync(sec.blocks_layout.items, { ...opts, blocks: sec.blocks });
    return { sec, children, templateState };
  }

  test('the saved template keeps the button', async () => {
    const template = await makeFixCommit();
    const sec = Object.values(template.blocks)[0];
    expect(sec).toMatchObject({ fixed: true, readOnly: true });
    expect(Object.values(sec.blocks).map((b) => b.title)).toEqual(['Contact us']);
  });

  test('a published page using it shows the section with its button', async () => {
    const { children, templateState } = renderPublished(await makeFixCommit());
    expect(children.map((c) => [c['@type'], c.title, c.href])).toEqual([['button', 'Contact us', '/contact']]);
    expect(() => assertAllExpanded(templateState)).not.toThrow();
  });
});
