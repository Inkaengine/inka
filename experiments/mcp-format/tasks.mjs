/**
 * Editing tasks on real docs pages. Each task's `expect` builds the expected
 * canonical page from the original one; `partial(…)` marks a new block or item
 * whose listed fields must match while extra fields are tolerated.
 */
export const partial = (fields) => ({ $partial: fields });

const md = (s) => ({ md: s });
const clone = (x) => structuredClone(x);
const findIdx = (S, pred, what) => {
  const i = S.findIndex(pred);
  if (i < 0) throw new Error(`task setup: no ${what}`);
  return i;
};

export const TASKS = [
  {
    id: 'prose-replace',
    page: 'index.md',
    instruction: 'Replace the paragraph that starts "The docs are a set of guides" with exactly: These guides are grouped by who you are: frontend developers, site owners and editors.',
    expect(S) {
      const out = clone(S);
      const i = findIdx(out, (b) => b.value?.md?.startsWith('The docs are a set of guides'), 'paragraph');
      out[i] = { '@type': 'slate', value: md('These guides are grouped by who you are: frontend developers, site owners and editors.') };
      return out;
    },
  },
  {
    id: 'inline-italic',
    page: 'index.md',
    instruction: 'Make the sentence "The demo resets overnight." italic. Change nothing else.',
    expect(S) {
      const out = clone(S);
      const i = findIdx(out, (b) => b.value?.md?.includes('The demo resets overnight.'), 'sentence');
      out[i].value = md(out[i].value.md.replace('The demo resets overnight.', '*The demo resets overnight.*'));
      return out;
    },
  },
  {
    id: 'setting-sort',
    page: 'index.md',
    instruction: 'Change the guides listing so it sorts on the index "sortable_title" (keep the sort order ascending).',
    expect(S) {
      const out = clone(S);
      const i = findIdx(out, (b) => b['@type'] === 'listing', 'listing');
      out[i].querystring.sort_on = 'sortable_title';
      return out;
    },
  },
  {
    id: 'hero-fields',
    page: 'examples/hero.md',
    instruction: 'In the hero, change the button text to "Read the guide" and the description to: Tools that make editing **delightful**.',
    expect(S) {
      const out = clone(S);
      const i = findIdx(out, (b) => b['@type'] === 'hero', 'hero');
      out[i].buttonText = 'Read the guide';
      out[i].description = md('Tools that make editing **delightful**.');
      return out;
    },
  },
  {
    id: 'add-teaser',
    page: 'examples/teaser.md',
    instruction: 'Insert a new teaser directly after the screenshot image. It links to /docs/editor-guide, has the title "Editor guide" and the description "How to use the editor."',
    expect(S) {
      const out = clone(S);
      const i = findIdx(out, (b) => b['@type'] === 'image', 'image');
      out.splice(i + 1, 0, partial({ '@type': 'teaser', title: 'Editor guide', description: 'How to use the editor.', href: [{ '@id': '/docs/editor-guide' }] }));
      return out;
    },
  },
  {
    id: 'add-panel',
    page: 'examples/accordion.md',
    instruction: 'Add a new last panel to the first accordion, titled "Can panels hold blocks?", containing one paragraph: Yes, any block the accordion allows.',
    expect(S) {
      const out = clone(S);
      const i = findIdx(out, (b) => b['@type'] === 'accordion', 'accordion');
      out[i].panels.push(partial({ title: 'Can panels hold blocks?', blocks: [{ '@type': 'slate', value: md('Yes, any block the accordion allows.') }] }));
      return out;
    },
  },
  {
    id: 'move-video',
    page: 'index.md',
    instruction: 'Move the video so it comes directly after the page title.',
    expect(S) {
      const out = clone(S);
      const v = findIdx(out, (b) => b['@type'] === 'video', 'video');
      const [video] = out.splice(v, 1);
      out.splice(findIdx(out, (b) => b['@type'] === 'title', 'title') + 1, 0, video);
      return out;
    },
  },
  {
    id: 'delete-teaser',
    page: 'examples/teaser.md',
    instruction: 'Delete the last teaser on the page.',
    expect(S) {
      const out = clone(S);
      const last = out.map((b) => b['@type']).lastIndexOf('teaser');
      out.splice(last, 1);
      return out;
    },
  },
  // ---- harder: long page, several edits, nested structures, creating ----
  {
    id: 'long-sentence',
    page: 'editor-guide/index.md',
    instruction: 'Replace the sentence "Sidebar editing is always available." with "You can always edit from the sidebar." Change nothing else.',
    expect(S) {
      const out = clone(S);
      const i = findIdx(out, (b) => b.value?.md?.startsWith('Sidebar editing is always available.'), 'sentence');
      out[i].value = md(out[i].value.md.replace('Sidebar editing is always available.', 'You can always edit from the sidebar.'));
      return out;
    },
  },
  {
    id: 'long-multi',
    page: 'editor-guide/index.md',
    instruction: [
      'Make three changes:',
      '1. Rename the heading "What\'s a block?" to "What is a block?" (keep its level).',
      '2. Delete the screenshot image in the "Sidebar as a full-screen sheet" section.',
      '3. Directly after the heading "Differences from desktop in one place", add a paragraph: The table below compares the two.',
    ].join('\n'),
    expect(S) {
      const out = clone(S);
      const h = findIdx(out, (b) => b.value?.md === "## What's a block?", 'heading');
      out[h].value = md('## What is a block?');
      const sec = findIdx(out, (b) => b.value?.md === '### Sidebar as a full-screen sheet', 'section');
      const img = out.findIndex((b, j) => j > sec && b['@type'] === 'image');
      out.splice(img, 1);
      const d = findIdx(out, (b) => b.value?.md === '### Differences from desktop in one place', 'heading');
      out.splice(d + 1, 0, { '@type': 'slate', value: md('The table below compares the two.') });
      return out;
    },
  },
  {
    id: 'table-cell',
    page: 'editor-guide/index.md',
    instruction: 'In the table comparing desktop and mobile, change the header cell "Mobile (≤767 px)" to "Phone (≤767 px)".',
    expect(S) {
      const out = clone(S);
      const t = findIdx(out, (b) => b['@type'] === 'slateTable', 'table');
      out[t].table.rows[0].cells[1].value = md('Phone (≤767 px)');
      return out;
    },
  },
  {
    id: 'grid-child',
    page: 'examples/grid/text.md',
    instruction: 'In the first grid on the page, change the grid headline to "Our work" and change its first heading "Text Title H2" to "Case studies" (keep it a level-2 heading).',
    expect(S) {
      const out = clone(S);
      const g = findIdx(out, (b) => b['@type'] === 'gridBlock', 'grid');
      out[g].headline = 'Our work';
      out[g].blocks[0].value = md('## Case studies');
      return out;
    },
  },
  {
    id: 'columns-add',
    page: 'examples/columns.md',
    instruction: 'Add a third column at the end of the columns block, titled "Support", containing the paragraph: We keep it running.',
    expect(S) {
      const out = clone(S);
      const c = findIdx(out, (b) => b['@type'] === 'columns', 'columns');
      out[c].columns.push(partial({ '@type': 'column', title: 'Support', blocks: [{ '@type': 'slate', value: md('We keep it running.') }] }));
      return out;
    },
  },
  {
    id: 'create-page',
    page: 'examples/grid/text.md',
    instruction: [
      'Replace everything on the page after the title with exactly this:',
      '1. A paragraph: Inka is a page builder for any CMS.',
      '2. A grid with the headline "Explore" holding three teasers, in order:',
      '   - title "Frontends", linking to /docs/frontend-guide',
      '   - title "Editing", linking to /docs/editor-guide',
      '   - title "Rules", linking to /docs/compliance',
    ].join('\n'),
    expect(S) {
      const title = S.find((b) => b['@type'] === 'title');
      const t = (title_, path) => partial({ '@type': 'teaser', title: title_, href: [{ '@id': path }] });
      return [
        title,
        { '@type': 'slate', value: md('Inka is a page builder for any CMS.') },
        partial({ '@type': 'gridBlock', headline: 'Explore', blocks: [t('Frontends', '/docs/frontend-guide'), t('Editing', '/docs/editor-guide'), t('Rules', '/docs/compliance')] }),
      ];
    },
  },
];
