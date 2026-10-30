/**
 * Realistic pages for the conversations, seeded into a run's own mock session
 * (a POST, as Plone's REST API creates content), so the agent works on a page
 * a real site would have, not a test fixture.
 */

const text = (t) => ({ text: t });
const p = (t) => ({ '@type': 'slate', value: [{ type: 'p', children: [text(t)] }] });
const h2 = (t) => ({ '@type': 'slate', value: [{ type: 'h2', children: [text(t)] }] });
const ul = (items) => ({ '@type': 'slate', value: [{ type: 'ul', children: items.map((i) => ({ type: 'li', children: [text(i)] })) }] });
/** A placeholder photo: a coloured panel captioned with what it shows. */
const photo = (caption, colour) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="100%" height="100%" fill="${colour}"/>`
  + `<text x="50%" y="50%" fill="white" font-family="sans-serif" font-size="44" text-anchor="middle">${caption}</text></svg>`,
)}`;

/** A community garden's volunteering page: all there, but a plain stack of text. */
export const VOLUNTEER = {
  path: '/volunteer',
  doc: {
    '@type': 'Document',
    id: 'volunteer',
    title: 'Volunteer with us',
    description: 'Help grow food and community at Riverside Community Garden.',
    blocks: {
      title: { '@type': 'title' },
      intro: p('Riverside Community Garden runs on volunteers. Whether you have an hour a month or a morning every week, there is a job for you.'),
      photo: { '@type': 'image', url: photo('Volunteers planting seedlings', '#4f7a3a'), alt: 'Volunteers planting seedlings in a raised bed', size: 'l', align: 'center' },
      'when-heading': h2('When we meet'),
      when: p('Working bees are on Saturdays from 9am to 12pm, rain or shine. Tools, gloves and morning tea are provided.'),
      'help-heading': h2('What you can help with'),
      help: ul(['Planting, weeding and harvesting', 'The weekly watering roster', 'Running our monthly market stall', 'Showing school groups around']),
      'join-heading': h2('Get involved'),
      join: p('Email volunteers@riversidegarden.org.au or just turn up at a working bee. No experience needed.'),
    },
    blocks_layout: { items: ['title', 'intro', 'photo', 'when-heading', 'when', 'help-heading', 'help', 'join-heading', 'join'] },
  },
};

/**
 * All the words on a stored page, wherever a block keeps them (a restyled
 * page may move a paragraph into a hero or a column).
 */
export function wordsOn(page) {
  const words = [];
  const walk = (value) => {
    if (typeof value === 'string') {
      if (!value.startsWith('data:')) words.push(value);
    } else if (Array.isArray(value)) value.forEach(walk);
    // A link's target ({"@id": …}) is a reference to another page, not words on this one.
    else if (value && typeof value === 'object' && !('@id' in value)) Object.values(value).forEach(walk);
  };
  walk(page.blocks);
  return words.join('\n');
}

const OLD_NAME = 'Riverside Community Garden';
const doc = (id, title, description, layout) => ({
  '@type': 'Document', id, title, description,
  blocks: Object.fromEntries(layout), blocks_layout: { items: layout.map(([key]) => key) },
});
/** Columns of one paragraph each; every block id unique on the page, as a real page's are. */
const columns = (id, ...cells) => ({
  '@type': 'columns',
  blocks: Object.fromEntries(cells.map((text, i) => [`${id}-col-${i}`, {
    '@type': 'column', blocks: { [`${id}-col-${i}-text`]: p(text) }, blocks_layout: { items: [`${id}-col-${i}-text`] },
  }])),
  blocks_layout: { columns: cells.map((_, i) => `${id}-col-${i}`) },
});

/**
 * A small community garden site that has just renamed itself. Its old name is
 * in titles, summaries, body text, a hero heading (which search doesn't index),
 * a teaser, and text nested in columns. Another organisation's similar name
 * (the Association) must be left alone.
 */
export const RENAMED_SITE = {
  oldName: OLD_NAME,
  newName: 'Riverside Food Forest',
  other: 'Riverside Community Gardens Association',
  /** Pages in the order they are created (a section before what it holds). */
  pages: [
    ['/', VOLUNTEER.doc],
    ['/', doc('about', `About ${OLD_NAME}`, `Who we are and how ${OLD_NAME} started.`, [
      ['title', { '@type': 'title' }],
      // No button link: the hero's heading copies from the page a button links to.
      ['hero', { '@type': 'hero', heading: `Welcome to ${OLD_NAME}`, subheading: 'Growing food together since 2014' }],
      ['story', p(`${OLD_NAME} began when twelve neighbours turned a vacant lot on Mill Street into vegetable beds.`)],
      ['facts', columns('facts', `${OLD_NAME} has 40 raised beds.`, 'We compost everything we can.')],
      ['member', p('We are proud members of the Riverside Community Gardens Association, which supports twenty gardens across the city.')],
    ])],
    ['/', doc('visit', 'Visiting', 'Opening hours and how to find us.', [
      ['title', { '@type': 'title' }],
      ['hours', p('The garden is open to visitors every day from dawn until dusk.')],
      ['where', p('Find us at 14 Mill Street, behind the library.')],
    ])],
    ['/', doc('news', 'News', '', [['title', { '@type': 'title' }]])],
    ['/news', doc('open-day', 'Open day this spring', `Come and see ${OLD_NAME} on 12 October.`, [
      ['title', { '@type': 'title' }],
      ['intro', p(`Everyone is welcome at the ${OLD_NAME} open day: tours, seedlings for sale and a sausage sizzle.`)],
      ['teaser', { '@type': 'teaser', href: [{ '@id': '/about', title: `About ${OLD_NAME}` }], title: `About ${OLD_NAME}`, description: 'Read our story.' }],
    ])],
  ],
};

/** Each seeded page's path, title, summary and the words on it. */
export async function siteText(api) {
  const out = [];
  for (const [parent, page] of RENAMED_SITE.pages) {
    const path = `${parent === '/' ? '' : parent}/${page.id}`;
    const stored = await api.get(path);
    out.push({ path, title: stored.title, description: stored.description ?? '', words: wordsOn(stored) });
  }
  return out;
}
