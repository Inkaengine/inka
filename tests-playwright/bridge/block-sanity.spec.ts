/**
 * Auto-discovered block sanity tests.
 *
 * Reads .discovered-blocks.json (written by globalSetup) and generates
 * one test per block @type. Each test loads the page containing the block
 * via mock-parent's ?api_path= and runs verifyBlockRendering.
 *
 * Run with:
 *   DISCOVER_BLOCKS_API=<mock-api-url> pnpm exec playwright test block-sanity
 *
 * Env vars:
 *   DISCOVER_BLOCKS_API  - Plone API URL for discovery and content fetching
 *   MOCK_PARENT_URL      - URL of mock-parent.html (defaults to test-frontend port)
 *   CONTAINMENT_EXEMPT_SLOTS
 *                        - comma-separated template slot ids where a block may
 *                          sit outside its container's allowedBlocks on purpose
 *                          (e.g. a docs site's component showcase slot). See
 *                          readContainmentRules in helpers/discover-blocks.cjs.
 *
 * Works against any Plone API — mock or remote.
 */
import { test as base, expect } from '../fixtures';
import { AdminUIHelper, previewFrame } from '../helpers/AdminUIHelper';
import { verifyBlockRendering } from '../helpers/BlockVerificationHelper';
import { drainFieldCoverage } from '../helpers/field-coverage';
import { measureTextStyles, recordTextStyles, slateStyles, drainStyleCoverage } from '../helpers/text-style-coverage';
import { axeCheckPage, formatViolations } from '../helpers/axe-sanity';
import { getFrontendUrl, SANITY_PROJECTS } from './fixtures';
import { URLS } from '../ports';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { requireEnvironment } from '../helpers/preconditions';
import { validateTemplatePlaceholders } from '../../packages/volto-hydra/src/utils/formDataValidation';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
interface DiscoveredBlock {
  blockType: string;
  variation?: string;
  kind?: 'rich' | 'simple';
  blockId: string;
  pagePath: string;
  blockData: Record<string, unknown>;
  isListing: boolean;
  // Set by discovery for content/schema problems that become a failing test
  // rather than blocking the whole suite in globalSetup.
  unregistered?: boolean;
  occurrenceCount?: number;
  shapeIssue?: boolean;
  slateIssue?: boolean;
  field?: string;
  issues?: string[];
  noExample?: boolean;
  // Set by discovery for a locked block found on its own template document.
  // The instance to unlock is read from the bridge at runtime — see below.
  needsUnlock?: boolean;
  allowedBlocksViolation?: boolean;
  parentType?: string;
  allowed?: string[];
}

// Read discovered blocks (written by globalSetup)
const discoveredPath = path.resolve(__dirname, '../../.discovered-blocks.json');
let discoveredBlocks: DiscoveredBlock[] = [];
if (fs.existsSync(discoveredPath)) {
  discoveredBlocks = JSON.parse(fs.readFileSync(discoveredPath, 'utf-8'));
}

// Synthetic conversion-test blocks (dnd-convert.spec.ts) are drag/paste fixtures
// with no editable fields and are only rendered by the mock test frontend — they
// aren't part of the cross-frontend render contract, so exclude them from sanity.
//
// The example listing-variant blocks (example-listings.spec.ts) expand via a
// per-frontend fetcher registration and have no inline-editable fields; the RSS
// one fetches an external feed that only resolves against the mock. They're
// covered by their own integration spec (admin-mock), not this render contract.
const NON_CONTRACT_BLOCKS = new Set(['relatedItemsListing', 'searchShortcuts', 'rssFeed']);
const seenShapeTitles = new Map();
discoveredBlocks = discoveredBlocks.filter(
  // a shape-issue discovery entry has no blockType — keep it (its test FAILS
  // with the issue text; dropping it here would hide a real content problem)
  (b) => !(b.blockType ?? '').startsWith('conv') && !NON_CONTRACT_BLOCKS.has(b.blockType),
);

// Block sanity is the cross-cutting render contract. We only enforce it on
// the three frontends that ship full block coverage and are the canonical
// references for downstream consumers — the mock test frontend (the spec's
// own ground truth), Nuxt, and Next.js. Other example frontends (react,
// svelte, vue, f7) intentionally skip block-sanity so missing block types or
// in-flight renderer changes don't gate the suite.


base.beforeEach(async ({}, testInfo) => {
  // Scope BEFORE environment: a project this spec doesn't cover is a decision,
  // and no CI change would make it run — so it skips even on CI. Discovery
  // missing is the opposite, hence requireEnvironment below.
  if (!SANITY_PROJECTS.has(testInfo.project.name)) {
    testInfo.skip(true, `block-sanity only runs on mock/nuxt/nextjs (skipping ${testInfo.project.name})`);
  }
  requireEnvironment(
    testInfo,
    discoveredBlocks.length > 0,
    'no .discovered-blocks.json — discovery needs DISCOVER_BLOCKS_API=<mock api url> in this job',
  );
});

const test = base.extend<{ helper: AdminUIHelper }>({
  helper: async ({ page }, use, testInfo) => {
    const helper = new AdminUIHelper(page);
    await use(helper);
  },
});

test.describe('Block sanity (auto-discovered)', () => {
  for (const block of discoveredBlocks) {
    // Run each discovered case only on the frontend it came from. Discovery is
    // per-frontend because they do not register the same blocks — one found via
    // nextjs must not be asserted against f7, which never claimed it.
    // Playwright collects this file once for all projects, so the cases are all
    // generated and the foreign ones skip at run time (the idiom dnd-convert
    // already uses for its mock-only conversion blocks).
    const belongsHere = (name: string) =>
      !block.frontend || block.frontend === name
      || block.frontend === '(env)' || block.frontend === 'mock';
    // Discovery runs once per frontend, so the SAME block surfaces once per
    // frontend that registered it. Playwright rejects a file with two identical
    // titles — it aborts the whole run before a single test executes — so every
    // generated title carries its source frontend. It is also the honest label:
    // these are separate measurements, not one shared result.
    const src = block.frontend ? ` @${block.frontend}` : '';

    // A block @type used in content but not registered in the frontend's
    // blocksConfig fails as its own test (it renders as "Not implemented
    // Block") rather than blocking the whole suite.
    if (block.unregistered) {
      test(`${block.blockType} block @type is registered in the frontend${src}`, ({}, testInfo) => {
        test.skip(!belongsHere(testInfo.project.name), `discovered via ${block.frontend}`);
        throw new Error(
          `Block @type "${block.blockType}" is used in content (${block.occurrenceCount} ` +
            `occurrence(s), e.g. ${block.pagePath}) but is not registered in the frontend's ` +
            `blocksConfig, so it renders as "Not implemented Block". Register its schema ` +
            `(customBlocks) or migrate the content to an existing type.`,
        );
      });
      continue;
    }
    // A frontend-registered type with no content example — fails as its own
    // test (nothing to render) rather than blocking the suite.
    if (block.noExample) {
      test(`${block.blockType} block has an editable content example to render${src}`, ({}, testInfo) => {
        test.skip(!belongsHere(testInfo.project.name), `discovered via ${block.frontend}`);
        throw new Error(
          `Block @type "${block.blockType}" is registered in the frontend but no EDITABLE content ` +
            `example exists to run its render test. Add a fixture (a page with a populated ` +
            `instance), or mark the type restricted if it only belongs inside a parent container.\n\n` +
            `Locked instances don't count: a /templates/* definition, or a block flagged ` +
            `readOnly/fixed, cannot be edited by an author, so the editing checks would be ` +
            `asserting the opposite of what that block is for.`,
        );
      });
      continue;
    }
    // A block placed in a container that doesn't allow its @type — it can't be
    // reordered within its container (the chevron / drag walks it OUT to the
    // nearest ancestor that accepts the type). Fails as its own test rather
    // than blocking the suite.
    if (block.allowedBlocksViolation) {
      // pagePath for the same reason the shape test carries it: one blockId can
      // repeat across pages, and two such entries would collide into a duplicate
      // title, which aborts the whole file before any test runs.
      test(`${block.blockType} block [${block.blockId}] on ${block.pagePath} is allowed in its container${src}`, ({}, testInfo) => {
        test.skip(!belongsHere(testInfo.project.name), `discovered via ${block.frontend}`);
        throw new Error(
          `Block "${block.blockType}" [${block.blockId}] on ${block.pagePath} is placed in a ` +
            `${block.parentType} container that doesn't allow its @type ` +
            `(allowed: [${(block.allowed || []).join(', ')}]). Such a block can't be reordered ` +
            `within its container — the mobile chevron / drag walks it OUT to the nearest ` +
            `ancestor that accepts the type, so it "escapes". Widen the container's allowedBlocks ` +
            `(if the placement is intended) or move/convert the block.`,
        );
      });
      continue;
    }
    // Graph integrity on what the API served (the plone-content-validator run
    // over fetched pages): broken resolveuid/link refs, blocks_layout entries
    // pointing at missing blocks, duplicate UIDs. One failing test per page.
    if (block.integrityIssue) {
      test(`content integrity on ${block.pagePath}${src}`, ({}, testInfo) => {
        test.skip(!belongsHere(testInfo.project.name), `discovered via ${block.frontend}`);
        throw new Error(
          `Content-graph integrity failures on ${block.pagePath}:\n` +
            (block.issues || []).map((issue: string) => `  - ${issue}`).join('\n'),
        );
      });
      continue;
    }
    // Content/schema shape mismatch (e.g. a field declared slate but holding a
    // string) — fails as its own test rather than blocking the suite.
    if (block.shapeIssue || block.slateIssue) {
      const kind = block.shapeIssue ? 'data shape' : 'slate structure';
      // Include pagePath + field: a blockId can repeat across pages, and a block
      // can have per-field shape/slate issues — without them, two entries would
      // collide into a "duplicate test title" error and abort the whole run.
      const where = `${block.pagePath || '?'}${block.field ? `.${block.field}` : ''}`;
      // A block can carry SEVERAL distinct issues of the same kind on the same
      // page+field — suffix repeats so titles stay unique instead of aborting.
      const baseTitle = `${block.blockType} block [${block.blockId}] on ${where} has valid ${kind}`;
      const seen = (seenShapeTitles.get(baseTitle) || 0) + 1;
      seenShapeTitles.set(baseTitle, seen);
      const title = seen > 1 ? `${baseTitle} (#${seen})` : baseTitle;
      test(`${title}${src}`, () => {
        throw new Error(
          `Block "${block.blockType}" [${block.blockId}] on ${block.pagePath}` +
            (block.field ? ` field "${block.field}"` : '') +
            ` has ${kind} that does not match its schema:\n` +
            (block.issues || []).map((m) => `  - ${m}`).join('\n'),
        );
      });
      continue;
    }
    // A schema OPTION no example sets. Not a renderable block, so it never
    // reaches the render checks — skip it here. The coverage reporter reads these
    // straight from .discovered-blocks.json (they are identical in every worker)
    // and reports them alongside the never-editable fields.
    if (block.unexercisedOption) {
      continue;
    }
    // A field present in stored data but not declared in the block schema — one
    // test per (blockType, field) so each missing field is reported once. It
    // can't be edited in the sidebar until the schema declares it.
    if (block.undeclaredField) {
      test(`${block.blockType} block declares field "${block.field}" in its schema${src}`, () => {
        throw new Error(
          `Block "${block.blockType}" stores field "${block.field}" (e.g. on ` +
            `${block.pagePath}) but its schema does not declare it — the field can't be ` +
            `edited in the sidebar. Add it to the block schema, or remove the stray data.`,
        );
      });
      continue;
    }
    const labelVariation = block.variation && block.variation !== 'default'
      ? ` (${block.variation})`
      : '';
    const labelKind = block.kind ? ` [${block.kind}]` : '';
    const label = `${block.blockType}${labelVariation}${labelKind}`;
    test(`${label} block renders and has edit annotations${src}`, async ({ page, helper }, testInfo) => {
      test.skip(!belongsHere(testInfo.project.name), `discovered via ${block.frontend}`);
      const frontendUrl = process.env.FRONTEND_URL || getFrontendUrl(testInfo.project.name);
      const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';

      // Use api_path to load the full page content from the API
      // The mock-parent fetches the page JSON and sends it via the bridge protocol
      const apiOrigin = process.env.DISCOVER_BLOCKS_API || URLS.mockApi;
      const mockParentUrl = process.env.MOCK_PARENT_URL || `${URLS.testFrontend}/mock-parent.html`;
      const apiPath = `${apiOrigin}${block.pagePath}`;
      await page.goto(
        `${mockParentUrl}?api_path=${encodeURIComponent(apiPath)}${frontend}`,
      );
      await helper.waitForIframeReady();
      // waitForIframeReady only confirms the DOM mounted; verifyBlockRendering
      // reads __hydraBridge.blockPathMap, which is only populated once the
      // bridge has received INITIAL_DATA. Without this wait the render check
      // races bridge init and flakily throws "blockPathMap not available".
      await helper.waitForBridgeConnected();

      // Site chrome (a footer, a global announcement) is authored on its
      // template's own document, where its blocks are locked until the template
      // is unlocked — the gesture that says "this changes everywhere", and the
      // one an author makes before editing it anywhere. Unlocking is a single
      // message; the admin's toggle sends the same one.
      //
      // The instance id comes from the BRIDGE, not from discovery. It identifies
      // one application of a template and the merge mints it
      // (`const instanceId = uuidGenerator()`), so stored content cannot say what
      // it will be; deriving it offline worked only for the deterministic cases
      // and failed as "stayed locked" for the rest. Reading it here also makes
      // "locked with nothing able to unlock it" a legible failure instead of a
      // silent mismatch.
      if (block.needsUnlock) {
        const frame = await previewFrame(page);

        // A block whose CONTENTS are generated is not authored inline, and
        // unlocking its template instance must not make them editable: the
        // expanded items of a listing reuse the block's own uid, so anything
        // that unlocks the block unlocks the generated items with it. hydra
        // therefore force-locks such blocks (expandListingBlocks registers
        // every type that has a fetcher), and that lock outranks template edit
        // mode by design.
        //
        // The frontend PUBLISHES that fact by registering the block readonly on
        // the bridge — the same opt-in shape as data-block-selector for reveal.
        // Reading it keeps this check free of "listing means X" knowledge: any
        // block a frontend declares generated is authored through the sidebar,
        // so "still locked" is the correct outcome, not a failure.
        const generatedContents = await frame.evaluate((uid) => {
          const registry = (window as any).__hydraBridge?._readonlyBlocks;
          return registry ? [...registry].includes(uid) : false;
        }, block.blockId);
        if (generatedContents) {
          test.info().annotations.push({
            type: 'generated-contents',
            description:
              `${block.blockType} [${block.blockId}] is registered readonly by the frontend — ` +
              `its items share the block uid, so it is authored in the sidebar, not inline.`,
          });
        }
        // Ask the bridge, don't walk the data. getBlockData resolves a uid
        // through blockPathMap, which already covers nested blocks AND
        // object_list items (a slide, an accordion panel) — the cases a
        // hand-rolled walk over `blocks` dicts silently misses, reporting a
        // template-bound item as having no templateInstanceId when it has one.
        const instanceId = await frame.evaluate(
          (uid) => (window as any).__hydraBridge?.getBlockData(uid)?.templateInstanceId ?? null,
          block.blockId,
        );

        expect(
          instanceId,
          `${block.blockType} block "${block.blockId}" is readOnly with no templateInstanceId — ` +
            `nothing can unlock it, so it is uneditable everywhere`,
        ).toBeTruthy();

        await page.evaluate((id) => {
          (document.getElementById('previewIframe') as HTMLIFrameElement)
            .contentWindow!.postMessage(
              { type: 'TEMPLATE_EDIT_MODE', instanceIds: [id] },
              '*',
            );
        }, instanceId);

        await expect
          .poll(
            () =>
              generatedContents ||
              frame.evaluate(
                (uid) => !(window as any).__hydraBridge?.isBlockReadonly(uid),
                block.blockId,
              ),
            { message: `${block.blockType} stayed locked after unlocking instance ${instanceId}` },
          )
          .toBe(true);
      }

      const iframe = helper.getIframe();

      await verifyBlockRendering(page, iframe, block.blockId, block.blockData, {
        isListing: block.isListing,
        // Sub-block iteration uses the bridge's blockPathMap (canonical,
        // schema-resolved) rather than a shape heuristic on blockData.
        checkSubBlocks: true,
        // Click the block's first editable field and require that it actually
        // becomes editable. Annotation presence alone is not the contract an
        // author experiences: a component whose own JS reveals or rebuilds its
        // DOM can carry every annotation and still be impossible to type into.
        checkEditTextClicks: true,
      });

      // TEXT-STYLE COVERAGE (#295). A style the author can apply has to render,
      // and has to render DIFFERENTLY from body text — otherwise picking it does
      // nothing visible and nothing says why. Measured by APPEARANCE, never by
      // markup: the frontend picks its own tags (this one renders `strong` as a
      // styled span deliberately), so we locate the style's text, take a
      // signature of how it actually looks, and compare against body text on the
      // same page. The aggregates at the end of the file do the judging.
      for (const [field, value] of Object.entries(block.blockData || {})) {
        if (!Array.isArray(value)) continue;
        const wanted = [...slateStyles(value)].map(([style, text]) => ({ style, text }));
        if (wanted.length === 0) continue;
        // The FIELD name, not just the block's: a field the design system draws
        // elsewhere is revealed by the handle that names it
        // (`data-block-selector="uid#field"`).
        const measured = await measureTextStyles(
          iframe.locator(`[data-block-uid="${block.blockId}"]`).first(),
          wanted,
          block.blockId,
          field,
        );

        recordTextStyles(
          block.blockType,
          block.pagePath,
          value,
          measured.out,
          measured.baseline,
        );
      }

      // Accessibility pass (axe-core) over the WHOLE rendered fixture page —
      // not scoped to this one block — so document-outline rules (heading-order)
      // are judged in context. serious/critical WCAG A/AA violations (incl.
      // heading-order) BLOCK; advisory (moderate/minor, best-practice-only, or
      // page-SHELL rules a minimal fixture can't be judged on) is logged only.
      // OPT-IN: off by default (the mock fixtures aren't a11y-clean and their
      // cosmetics aren't what block-sanity guards — real-site a11y is enforced
      // elsewhere). Run the a11y pass with SANITY_AXE=1.
      //
      // Some doc pages deliberately render MULTIPLE instances of a layout-chrome
      // component (header/masthead/main-nav) as structural-parity examples. That
      // duplication trips axe's duplicate-id / one-landmark rules — but the
      // chrome's a11y is already proven by the SINGLE live instance on every
      // other page (the layout renders it everywhere), so axe is skipped on the
      // example page rather than exempting a pile of rules there.
      const AXE_SKIP_PAGES = ['/components/header'];
      const axeSkipped = AXE_SKIP_PAGES.some((p) =>
        (block.pagePath || '').startsWith(p),
      );
      if (process.env.SANITY_AXE && !axeSkipped) {
        const { blocking, advisory } = await axeCheckPage(iframe);
        if (advisory.length > 0) {
          console.log(
            `[axe] ${label}: ${advisory.length} advisory finding(s)\n${formatViolations(advisory)}`,
          );
        }
        expect(
          blocking,
          `${label} has ${blocking.length} serious/critical a11y violation(s):\n${formatViolations(blocking)}`,
        ).toEqual([]);
      }
    });
  }

  // COVERAGE IS AGGREGATED IN THE REPORTER, NOT HERE. Field-editability and
  // text-style coverage are both "at least one example anywhere proves it" —
  // findings that only exist over the WHOLE corpus. block-sanity runs fully
  // parallel, so no single worker sees the whole corpus: a former end-of-file
  // aggregate test read only its own worker's records and flaked (a teaser with
  // an empty href recorded `href` "missing" in one worker while a real teaser
  // recorded it "seen" in another). So each test DRAINS what it measured and
  // attaches it; the coverage reporter (main process, sees every worker's
  // attachments) folds them together and runs the aggregates once in onEnd,
  // failing the run there. The unexercisedOptions half is recomputed by the
  // reporter from .discovered-blocks.json — it is identical in every worker, so
  // there is nothing to attach.
  test.afterEach(async ({}, testInfo) => {
    const fields = drainFieldCoverage();
    const styles = drainStyleCoverage();
    await testInfo.attach('coverage', {
      body: JSON.stringify({ fields, styles }),
      contentType: 'application/json',
    });
  });
});

/**
 * Template slot structure, checked on the RENDERED page.
 *
 * The rule — two different slot groups may not meet without a fixed block
 * between them — applies to the EXPANDED tree, not to what is stored. A page
 * stores its slot content flat and expansion places each block into the
 * template region its slotId names, so `related` and `example` look adjacent on
 * disk while landing in different tabs, and a template's own fixed chrome is not
 * in the stored page at all. Reading the stored layout and applying the rule to
 * it gives a wrong answer — twice over, in both directions: it invents
 * violations that expansion resolves, and it misses the one real collision
 * behind them.
 *
 * So this asks the page after the merge has happened. The bridge holds the
 * expanded formData, and hydra's own validateTemplatePlaceholders is a pure
 * function over it — the same one Form.jsx calls at save time. Neither the
 * merge nor the rule is reimplemented here, which is the point: a second copy
 * of either is a second thing to be wrong.
 *
 * Why this belongs here rather than in the CLI content validator: the CLI never
 * renders, so it cannot see an expanded tree without growing its own expander.
 *
 * The cost is bounded. A region needs two DISTINCT slot ids to violate the rule,
 * so a template with no open slots (site-footer, site-announcement — all fixed
 * chrome) or a single one (every content-layout-*) can never trip it. Only pages
 * carrying a multi-slot template have anything to check.
 */
test.describe('Template slots', () => {
  const pagesWithTemplates = [
    ...new Set(discoveredBlocks.map((b) => b.pagePath).filter(Boolean)),
  ].sort();

  for (const pagePath of pagesWithTemplates) {
    test(`${pagePath} obeys the template slot rules`, async ({ page, helper }, testInfo) => {
      const frontendUrl = process.env.FRONTEND_URL || getFrontendUrl(testInfo.project.name);
      const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';
      const apiOrigin = process.env.DISCOVER_BLOCKS_API || URLS.mockApi;
      const mockParentUrl = process.env.MOCK_PARENT_URL || `${URLS.testFrontend}/mock-parent.html`;
      await page.goto(
        `${mockParentUrl}?api_path=${encodeURIComponent(`${apiOrigin}${pagePath}`)}${frontend}`,
      );
      await helper.waitForIframeReady();
      await helper.waitForBridgeConnected();

      // The expanded tree, exactly as the editor would validate it.
      // previewFrame(), not getIframe(): the latter is a FrameLocator, which
      // finds elements but cannot evaluate — the bridge is a window global, not
      // a DOM node.
      const frame = await previewFrame(page);
      const formData = await frame.evaluate(
        () => (window as any).__hydraBridge?.formData ?? null,
      );
      expect(formData, `${pagePath}: the bridge published no formData`).toBeTruthy();

      // A page with no template instance has nothing to check — pass quietly
      // rather than skip, so the count of pages checked stays honest.
      const { valid, blocksErrors } = validateTemplatePlaceholders(formData);
      const detail = Object.entries(blocksErrors)
        .map(([blockId, err]: [string, any]) => {
          const layout = err?._layout ?? {};
          return `  ${blockId}: ${layout.title ?? 'error'} — ${layout.message ?? ''}`;
        })
        .join('\n');
      expect(
        valid,
        `${pagePath} cannot be saved in the editor: its template slots collide.\n${detail}\n\n` +
          'Two different slot groups meeting with no fixed block between them is an\n' +
          'insertion gap nothing can resolve — both neighbours offer a slot and\n' +
          'position cannot say which one a new block joins. Separate them with a\n' +
          "fixed block, or put one inside a fixed container of its own.",
      ).toBe(true);
    });
  }
});
