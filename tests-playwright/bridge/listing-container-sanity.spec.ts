/**
 * A listing and the container holding it have to agree — three ways.
 *
 * Reads `.discovered-listing-container-issues.json` (written by globalSetup).
 * A listing has no presentation of its own: the container decides what its query
 * results become, through the item type chosen on the listing and that type's
 * `fieldMappings['@default']` recipe. So three things must line up, and none is
 * checked by an example of the container, or of the listing, alone:
 *
 *   no-example                       the container allows a listing and nothing
 *                                    puts one there, so it is never rendered
 *   pinned-type-not-allowed          the listing pins an item type the container
 *                                    forbids
 *   item-type-without-default-mapping  the container offers a type no listing
 *                                    can populate
 *
 * A listing has no presentation of its own — the container decides what its
 * query results become, through the container's item type and the listing's
 * field mapping. So "grid holding a listing" and "footer holding a listing" are
 * genuinely different renderings, and an example of a grid, or of a listing,
 * exercises neither. Only the COMBINATION renders.
 *
 * This is not a tidiness rule. A listing took its item type from its own schema
 * default instead of the container holding it, so a grid rendered cards against
 * a mapping built for links (`Title → Text`, and a card has no `text`). Every
 * result came out blank: the right number of items, of the right type, in the
 * right place, carrying nothing. It shipped on a live front page and stayed
 * green everywhere, because no example put a listing inside a grid for anything
 * to render.
 *
 * A "listing" is recognised by CONFIG rather than by name — a block whose
 * `inheritSchemaFrom` recipe declares a `mappingField` turns query results into
 * items of another type. That is what makes the pairing worth rendering, and it
 * is true of any frontend, not just the one this was found on.
 *
 * The fix for a failure is an example, not a suppression: add content putting
 * that listing in that container, and the existing block-sanity render checks
 * will then exercise it.
 */
import { test as base, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireEnvironment } from '../helpers/preconditions';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ListingContainerIssue {
  kind:
    | 'no-example'
    | 'pinned-type-not-allowed'
    | 'item-type-without-default-mapping';
  parentType: string;
  field: string;
  listingType: string;
  itemType?: string;
}

/** What each kind means, and what to do about it. */
function explain(c: ListingContainerIssue): string {
  const where = `\`${c.parentType}.${c.field}\``;
  if (c.kind === 'no-example') {
    return (
      `${where} allows \`${c.listingType}\`, but no content example puts one there — ` +
      `so that pairing is never rendered by any test.\n\n` +
      `Add an example with a \`${c.listingType}\` inside ${where}; the block-sanity ` +
      `render checks pick it up from there.`
    );
  }
  if (c.kind === 'pinned-type-not-allowed') {
    return (
      `\`${c.listingType}\` pins the item type \`${c.itemType}\`, which ${where} does ` +
      `not allow.\n\n` +
      `The container imposes its OWN type at render, while the listing's stored field ` +
      `mapping was computed for the pinned one — so results are built against the wrong ` +
      `schema and render blank, with the right count and type. Derive the type from the ` +
      `container instead of pinning it (BlockTypeSelectWidget: "Set to '..' to use ` +
      `enclosing parent's allowedSiblingTypes").`
    );
  }
  return (
    `${where} offers \`${c.itemType}\` as a listing item type, but \`${c.itemType}\` ` +
    `declares no \`fieldMappings['@default']\`.\n\n` +
    `A listing can never populate it: there is no recipe from a query result's ` +
    `\`@id\`/\`title\`/\`description\`/\`image\` onto its fields. Give it a @default ` +
    `mapping, or take it out of allowedBlocks.`
  );
}

const casesPath = path.resolve(
  __dirname,
  '../../.discovered-listing-container-issues.json',
);
let cases: ListingContainerIssue[] = [];
if (fs.existsSync(casesPath)) {
  cases = JSON.parse(fs.readFileSync(casesPath, 'utf-8'));
}

// Synthetic conversion-test containers (dnd-convert.spec.ts) are rendered only
// by the mock frontend, so they are not part of the cross-frontend contract —
// the same exclusion empty-region sanity makes, for the same reason.
cases = cases.filter((c) => !c.parentType.startsWith('conv'));

// The frontends with full block coverage, as elsewhere in sanity.
const SANITY_PROJECTS = new Set(['mock', 'nuxt', 'nextjs']);

const test = base;

test.describe('Listing container sanity', () => {
  test('discovery ran', ({}, testInfo) => {
    testInfo.skip(
      !SANITY_PROJECTS.has(testInfo.project.name),
      `listing-container sanity only runs on mock/nuxt/nextjs (skipping ${testInfo.project.name})`,
    );
    requireEnvironment(
      testInfo,
      fs.existsSync(casesPath),
      'no .discovered-listing-container-issues.json — discovery needs DISCOVER_BLOCKS_API=<mock api url> in this job',
    );
    // No cases is the PASSING state: every container that allows a listing has
    // an example with one in it.
    expect(Array.isArray(cases)).toBe(true);
  });

  for (const c of cases) {
    const what =
      c.kind === 'no-example'
        ? `has an example containing ${c.listingType}`
        : c.kind === 'pinned-type-not-allowed'
          ? `does not pin ${c.itemType}, which this container forbids`
          : `offers ${c.itemType}, which has a @default mapping`;
    test(`${c.parentType}.${c.field} ${what}`, ({}, testInfo) => {
      testInfo.skip(
        !SANITY_PROJECTS.has(testInfo.project.name),
        `listing-container sanity only runs on mock/nuxt/nextjs (skipping ${testInfo.project.name})`,
      );
      throw new Error(explain(c));
    });
  }
});
