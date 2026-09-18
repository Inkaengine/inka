/**
 * Where each CMS seeds the content the journey specs walk through.
 *
 * Shared so every spec under this directory describes the same world: the
 * journey and the back-navigation spec must agree on which tree they are in,
 * or a failure in one cannot be compared with a pass in the other.
 */
const FIXTURES: Record<
  string,
  {
    root: string;
    target: string;
    lastEditedLabel: string;
    withImage?: string;
    /**
     * Where a MOVE puts things. Distinct from `target`, which is what a link
     * points at: a link can point at any document, but a move needs somewhere
     * that can hold children. Using one value for both worked only while the
     * admin left @ids unflattened and the destination link happened to open a
     * listing; once links resolved properly, pasting into a leaf document had
     * nowhere to go.
     */
    moveTarget?: string;
    /**
     * A PUBLISHED page and a DRAFT, for the view-mode preview. In view mode the
     * frontend fetches the page itself, straight from its CMS, rather than
     * being handed it over the bridge — so this is where a frontend that only
     * knows how to read Plone shows nothing for a WordPress or Drupal site, and
     * where a draft needs the frontend's own credential.
     */
    published: { path: string; title: string; text: string };
    draft: { path: string; title: string };
  }
> = {
  // Plone's mock serves the site's own test tree; the others seed the shared
  // canonical fixture (/news, /about). Playwright cannot set process.env per
  // project, so the run names its own fixture.
  'journey-plone': {
    root: '/_test_data',
    target: '/_test_data/context-navigation-forced-folder',
    // Plone names its own indexes, so the query builder shows ITS label. The
    // steps are identical across CMSes; only this environment data differs,
    // the same way target.queryIndexes handles it in the contract suite.
    lastEditedLabel: 'Modification date',
    // Real docs content rather than a purpose-built fixture: this project
    // exists to exercise messy content, and this page carries an image block.
    withImage: '/docs/what-editors-will-experience/links-and-media',
    // Already a folder, so the move destination is the same place.
    moveTarget: '/_test_data/context-navigation-forced-folder',
    published: { path: '/_test_data/test-page', title: 'Test Page', text: 'This is a test paragraph' },
    draft: { path: '/_test_data/draft-page', title: 'Draft Page' },
  },
  // The target must be a CHILD of the root — the journey picks it out of the
  // root's own listing, so a sibling like /about can never appear there.
  // Drupal and WordPress both build hierarchy from menu links and parent ids
  // rather than a distinct folder type, so any node can receive children and
  // an existing child of /news is the natural target.
  // The SAME canonical seed the other two use, served by a second Plone mock.
  // journey-plone keeps running against the repo's real docs content, which is
  // the one place the suite exercises messy real content rather than a
  // four-document fixture; this project exists so focused specs can rely on
  // the same fixtures everywhere without giving that up.
  'journey-plone-seeded': {
    root: '/news',
    target: '/news/first-post',
    lastEditedLabel: 'Modification date',
    withImage: '/with-image',
      moveTarget: '/archive',
    published: { path: '/news/first-post', title: 'First Post', text: 'Hello' },
    draft: { path: '/news/draft-post', title: 'Draft Post' },
  },
  'journey-drupal': {
    root: '/news',
    target: '/news/first-post',
    lastEditedLabel: 'Last edited',
    // A seeded page that ALREADY has a populated image block. Tests about
    // editing one open this directly instead of building it by clicking —
    // creating a page and uploading a file through the UI costs minutes
    // against a real CMS, and neither is the thing under test.
    withImage: '/with-image',
      moveTarget: '/archive',
    published: { path: '/news/first-post', title: 'First Post', text: 'Hello' },
    draft: { path: '/news/draft-post', title: 'Draft Post' },
  },
  'journey-wordpress': {
    root: '/news',
    target: '/news/first-post',
    lastEditedLabel: 'Last edited',
    withImage: '/with-image',
      moveTarget: '/archive',
    published: { path: '/news/first-post', title: 'First Post', text: 'Hello' },
    draft: { path: '/news/draft-post', title: 'Draft Post' },
  },
};

export function fixtureFor(projectName: string) {
  // The auth setup project is the same target as the project it feeds, so it
  // shares that target's fixture: journey-wordpress-setup -> journey-wordpress.
  const fixture = FIXTURES[projectName.replace(/-setup$/, '')];
  // A new CMS must declare where it seeds content; defaulting would silently
  // run the journey against a tree that does not exist and report empty.
  if (!fixture) throw new Error(`No journey fixture declared for ${projectName}`);
  return {
    ...fixture,
    moveTarget: fixture.moveTarget ?? fixture.target,
    root: process.env.JOURNEY_ROOT ?? fixture.root,
    target: process.env.JOURNEY_TARGET_FOLDER ?? fixture.target,
  };
}

