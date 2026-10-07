/**
 * Journey tasks: jobs an agent is given in plain words, with nothing but the
 * Inka MCP to do them with — no paths, no ids, no page format. Each `check`
 * reads the result through the CMS API (never the agent's account of it) and
 * returns a list of what is wrong, empty when the job was done.
 *
 * They run against the mock API's test content (`/_test_data`), each run on
 * its own session, so every run starts from the same pages. The site also
 * holds the docs, where some titles repeat, so each job names the "Test Data"
 * section; and a headless run can't answer a question, so each says to go
 * ahead (GO_AHEAD).
 */

const GO_AHEAD = ' Do it without asking for confirmation.';

/** The text of a Slate value, its blocks joined by newlines. */
const slateText = (value) => (value ?? [])
  .map((node) => (node.text ?? '') + slateText(node.children ?? []).replace(/\n/g, ''))
  .join('\n');

/** The blocks of a page, in order: [{ id, type, text, block }]. */
const blocksOf = (page) => page.blocks_layout.items.map((id) => {
  const block = page.blocks[id];
  return { id, type: block['@type'], text: slateText(block.value).trim(), block };
});

const isHeading = (b) => b.type === 'heading'
  || (b.type === 'slate' && /^h[1-6]$/.test(b.block.value?.[0]?.type ?? ''));

export const TASKS = [
  {
    id: 'paragraph-after-accordion',
    prompt: 'In the "Test Data" section of the website there is a page used for testing accordions. Add a '
      + 'paragraph that says exactly "Reviewed by the content team." directly below the accordion on that page, '
      + `and save it.${GO_AHEAD}`,
    async check(api) {
      const page = await api.get('/_test_data/accordion-test-page');
      const blocks = blocksOf(page);
      const problems = [];
      const at = blocks.findIndex((b) => b.id === 'accordion-1');
      const next = blocks[at + 1];
      if (!next || next.text !== 'Reviewed by the content team.') {
        problems.push(`the block after the accordion is ${next ? `${next.type} "${next.text}"` : 'missing'}`);
      }
      const before = ['title-block', 'accordion-1', 'text-after'];
      const kept = blocks.map((b) => b.id).filter((id) => before.includes(id));
      if (kept.join() !== before.join()) problems.push(`the page's own blocks changed: ${kept.join(', ')}`);
      if (blocks.length !== before.length + 1) problems.push(`expected ${before.length + 1} blocks, found ${blocks.length}`);
      return problems;
    },
  },
  {
    id: 'create-team-update',
    prompt: 'Create a new page called "Team update" inside the "Test Data" section of the website. It should '
      + `have a heading "What we shipped" followed by a paragraph saying "Search and page moves."${GO_AHEAD}`,
    async check(api) {
      const children = await api.search('/_test_data/@search?path.depth=1&path.query=/_test_data');
      const made = children.items.find((i) => i.title === 'Team update');
      if (!made) return ['no page titled "Team update" in Test Data'];
      const blocks = blocksOf(await api.get(new URL(made['@id']).pathname));
      const heading = blocks.findIndex((b) => isHeading(b) && b.text === 'What we shipped');
      const paragraph = blocks.findIndex((b) => b.type === 'slate' && !isHeading(b) && b.text === 'Search and page moves.');
      const problems = [];
      if (heading < 0) problems.push('no heading "What we shipped"');
      if (paragraph < 0) problems.push('no paragraph "Search and page moves."');
      if (heading >= 0 && paragraph >= 0 && paragraph < heading) problems.push('the paragraph comes before the heading');
      return problems;
    },
  },
  {
    id: 'move-another-page',
    prompt: 'In the "Test Data" section, move the page called "Another Page" so that it sits inside the page '
      + `called "Container Test Page".${GO_AHEAD}`,
    async check(api) {
      const problems = [];
      if (await api.status('/_test_data/container-test-page/another-page') !== 200) problems.push('not found inside Container Test Page');
      if (await api.status('/_test_data/another-page') !== 404) problems.push('still at its old address');
      return problems;
    },
  },
  {
    id: 'rename-another-page-2',
    prompt: 'In the "Test Data" section, the page "Another Page 2" needs a new name: its title should become '
      + `"Second page" and its web address should end in /second-page.${GO_AHEAD}`,
    async check(api) {
      if (await api.status('/_test_data/second-page') !== 200) return ['no page at /_test_data/second-page'];
      const problems = [];
      const page = await api.get('/_test_data/second-page');
      if (page.title !== 'Second page') problems.push(`its title is "${page.title}"`);
      if (await api.status('/_test_data/another-page-2') !== 404) problems.push('still at its old address');
      return problems;
    },
  },
  {
    id: 'find-move-retitle',
    prompt: 'In the "Test Data" section, find the page that is used for testing the carousel (slider). Move it '
      + `into the "Container Test Page" section, then change its title to "Slider demo".${GO_AHEAD}`,
    async check(api) {
      const moved = '/_test_data/container-test-page/carousel-test-page';
      if (await api.status(moved) !== 200) return ['not found inside Container Test Page'];
      const problems = [];
      const page = await api.get(moved);
      if (page.title !== 'Slider demo') problems.push(`its title is "${page.title}"`);
      if (await api.status('/_test_data/carousel-test-page') !== 404) problems.push('still at its old address');
      return problems;
    },
  },
];
