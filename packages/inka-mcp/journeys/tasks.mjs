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
 *
 * Conversations (CONVERSATIONS) are different: a simulated `person` replies
 * to the agent until they have what they wanted, on a realistic page seeded
 * by `setup`. Their `check` also reads the conversation (which tools ran, and
 * whether anything was saved), and a judge grades it on `criteria`.
 */
import { calls, saves } from './conversation.mjs';
import { mcp, agent } from './judge.mjs';
import { VOLUNTEER, RENAMED_SITE, siteText, wordsOn } from './pages.mjs';

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

const GARDENER = 'You coordinate volunteers at Riverside Community Garden and look after its website. '
  + 'The page you care about is "Volunteer with us", at /volunteer on the site.';

/** Previews the agent looked at: a layout tried out, or an edit dry-run with a picture. */
const previews = (turns) => [
  ...calls(turns, 'preview_layout'),
  ...calls(turns, 'edit_blocks').filter((t) => t.input.dryRun && t.input.preview),
].filter((t) => !t.isError);

/** What the volunteering page must still say, however it is laid out. */
const KEPT = ['volunteers@riversidegarden.org.au', 'market stall', 'school groups'];

const seedVolunteer = (api) => api.post('/', VOLUNTEER.doc);

const SHOWED_NOT_TOLD = mcp('When Claude suggests how the page could look, it shows the person pictures of each suggestion '
  + '(tool results with pictures) rather than only describing them in words.');

/** The text of the header the test layout template gives every page that uses it. */
async function templateHeader(api) {
  const template = await api.get('/_test_data/templates/test-layout');
  const header = Object.values(template.blocks).find((b) => b.slotId === 'header');
  return slateText(header.value);
}

const SHARED_HEADER_ASK = 'On the "Template Test Page" in the Test Data section of our site, the big heading at the top '
  + 'should say "Welcome to Riverside" instead.';
const EXPLAINED_SHARED = mcp('Before changing the heading, Claude tells the person in plain words that it is shared with '
  + 'other pages (it comes from a template), so changing it changes those pages too.');

export const CONVERSATIONS = [
  {
    id: 'alternatives-then-apply',
    setup: seedVolunteer,
    prompt: 'Our volunteering page (/volunteer) feels a bit plain. What are some different ways it could look? Can you show me?',
    person: {
      who: GARDENER,
      wants: 'See two or three genuinely different looks for the page, pick the one you like best, and have Claude put it on the site.',
    },
    criteria: {
      'showed-not-told': SHOWED_NOT_TOLD,
      'distinct-options': agent('The options Claude offered differ in layout or structure, not just in wording.'),
      'asked-before-saving': agent('Claude changed the live page only after the person chose an option and asked for it.'),
    },
    async check(api, turns) {
      const problems = [];
      const shown = previews(turns).length;
      if (shown < 2) problems.push(`looked at ${shown} preview(s), not one per option`);
      if (!saves(turns).length) problems.push('never put the chosen look on the site');
      const words = wordsOn(await api.get(VOLUNTEER.path));
      for (const kept of KEPT) if (!words.includes(kept)) problems.push(`the page lost "${kept}"`);
      return problems;
    },
  },
  {
    id: 'look-on-phone',
    setup: seedVolunteer,
    prompt: 'How does our volunteering page (/volunteer) look on a phone?',
    person: {
      who: GARDENER,
      wants: 'Find out how the page looks on a phone and whether anything looks wrong there. You are not asking for changes.',
    },
    criteria: {
      'answered-from-the-page': mcp("Claude's account of how the page looks on a phone comes from having looked at it on a phone "
        + '(a picture at mobile size), not from guessing.'),
    },
    async check(api, turns) {
      const problems = [];
      if (!calls(turns, 'view_page').some((t) => t.input.viewport === 'mobile' && !t.isError)) problems.push('never looked at the page at phone size');
      if (saves(turns).length) problems.push(`changed the site: ${saves(turns).map((t) => t.name).join(', ')}`);
      return problems;
    },
  },
  {
    id: 'ideas-without-saving',
    setup: seedVolunteer,
    prompt: 'Any ideas to make our volunteering page (/volunteer) more inviting? Just ideas for now, I need to run them past the committee first.',
    person: {
      who: GARDENER,
      wants: 'Get a few ideas, ideally see what they would look like, but NOT change anything on the site yet: the committee decides next month.',
    },
    criteria: { 'showed-not-told': SHOWED_NOT_TOLD },
    async check(api, turns) {
      const problems = [];
      if (saves(turns).length) problems.push(`changed the site: ${saves(turns).map((t) => t.name).join(', ')}`);
      const page = await api.get(VOLUNTEER.path);
      if (page.blocks_layout.items.join() !== VOLUNTEER.doc.blocks_layout.items.join()) problems.push('the page is not as it was');
      return problems;
    },
  },
  {
    id: 'fix-the-day',
    setup: seedVolunteer,
    prompt: 'Our working bees have moved from Saturdays to Sundays, same time. Can you update the volunteering page (/volunteer)?',
    person: {
      who: GARDENER,
      wants: 'Have the page say working bees are on Sundays, still 9am to 12pm, with nothing else on the page changed. '
        + 'If Claude asks whether to go ahead, say yes.',
    },
    criteria: {
      'confirmed-plainly': agent('Once the change is made, Claude tells the person what now appears on the page, in plain words.'),
    },
    async check(api, turns) {
      const problems = [];
      const page = await api.get(VOLUNTEER.path);
      const words = wordsOn(page);
      if (!/Sundays/.test(words)) problems.push('the page does not say Sundays');
      if (/Saturday/.test(words)) problems.push('the page still says Saturday');
      if (!words.includes('9am to 12pm')) problems.push('the time was lost');
      if (page.blocks_layout.items.join() !== VOLUNTEER.doc.blocks_layout.items.join()) problems.push('the rest of the page changed');
      if (!saves(turns).length) problems.push('nothing was saved');
      return problems;
    },
  },
  {
    id: 'template-heading-everywhere',
    prompt: SHARED_HEADER_ASK,
    person: {
      who: 'You look after a website and edit its pages. You do not know how the site is built.',
      wants: 'Have the big heading say "Welcome to Riverside". If Claude says it is shared with other pages, you are '
        + 'happy for it to change on all of them.',
    },
    criteria: { 'explained-shared': EXPLAINED_SHARED },
    async check(api) {
      const header = await templateHeader(api);
      return header === 'Welcome to Riverside' ? [] : [`the shared heading says "${header}"`];
    },
  },
  {
    id: 'template-heading-this-page-only',
    prompt: SHARED_HEADER_ASK,
    person: {
      who: 'You look after a website and edit its pages. You do not know how the site is built.',
      wants: 'Change the big heading on this one page only. No other page may change: if Claude says it would change '
        + 'other pages too, you would rather leave it as it is.',
    },
    criteria: { 'explained-shared': EXPLAINED_SHARED },
    async check(api, turns) {
      const problems = [];
      const header = await templateHeader(api);
      if (header !== 'Template Header - From Template') problems.push(`the shared heading changed to "${header}"`);
      if (calls(turns, 'edit_blocks').some((t) => t.input.changeTemplates && !t.input.dryRun && !t.isError)) {
        problems.push('changed a template');
      }
      return problems;
    },
  },
  {
    id: 'rename-across-site',
    async setup(api) {
      for (const [parent, page] of RENAMED_SITE.pages) await api.post(parent, page);
    },
    prompt: `We have renamed ourselves from "${RENAMED_SITE.oldName}" to "${RENAMED_SITE.newName}". `
      + 'Can you update the name everywhere on the website?',
    person: {
      who: GARDENER + ` The garden used to be called ${RENAMED_SITE.oldName} and is now ${RENAMED_SITE.newName}. `
        + `The ${RENAMED_SITE.other} is a different organisation (the city-wide body your garden belongs to): its name has not changed.`,
      wants: `Every mention of the garden's old name on the site, in page titles and summaries too, changed to the new one, `
        + `and the ${RENAMED_SITE.other} left as it is. If Claude asks before going ahead, say yes.`,
    },
    criteria: {
      'checked-scope': agent('Before changing pages, Claude tells the person where it found the old name, or what it will change, '
        + 'so they can catch a mistake (such as the similarly named Association).'),
      'reported-honestly': agent('At the end Claude says plainly what it changed, and anything it could not change or did not find, '
        + 'rather than claiming everything was done.'),
    },
    async check(api) {
      const problems = [];
      const { oldName, newName, other } = RENAMED_SITE;
      const stillOld = (text) => text.split(other).join('').includes(oldName);
      for (const page of await siteText(api)) {
        if (stillOld(page.title)) problems.push(`${page.path}: the title still has the old name`);
        if (stillOld(page.description)) problems.push(`${page.path}: the summary still has the old name`);
        if (stillOld(page.words)) problems.push(`${page.path}: the page still has the old name`);
        if (/Food Forests? Association|Riverside Food Forests/.test(page.words)) problems.push(`${page.path}: the Association's name was changed`);
      }
      const about = (await siteText(api)).find((p) => p.path === '/about');
      if (!about.words.includes(other)) problems.push(`/about no longer names the ${other}`);
      const hero = (await api.get('/about')).blocks.hero;
      if (!hero?.heading?.includes(newName)) problems.push(`/about: the hero heading is "${hero?.heading}"`);
      return problems;
    },
  },
];
