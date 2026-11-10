/**
 * The sanity suites: tests generated from what block discovery found.
 *
 * Discovery (`discoverForFrontends` in ./global-setup) writes every block case
 * it finds into a directory; each suite here reads it back and generates one
 * test per case. A suite registers its tests when called, so a consumer's spec
 * file is one call:
 *
 *   // tests/block-sanity.spec.ts
 *   import { defineBlockSanityTests } from '@inka/testing/playwright/sanity';
 *   defineBlockSanityTests({ discoveryDir, frontends, projects: ['nuxt'] });
 *
 * Playwright collects spec files from a project's testDir, so the suites are
 * functions a consumer's own spec calls rather than spec files of their own.
 *
 * Env vars, read at run time:
 *   DISCOVER_BLOCKS_API  - Plone API URL the pages are loaded from
 *   MOCK_PARENT_URL      - URL of mock-parent.html (defaults to the test frontend's)
 *   FRONTEND_URL         - the frontend under test, over the project's own
 *   SANITY_AXE           - run the axe accessibility pass in block-sanity
 *   CONTAINMENT_EXEMPT_SLOTS
 *                        - comma-separated template slot ids where a block may
 *                          sit outside its container's allowedBlocks on purpose
 *                          (e.g. a docs site's component showcase slot). See
 *                          readContainmentRules in discover-blocks.cjs.
 *
 * Works against any Plone API — mock or remote.
 */
import { test as playwrightTest, type FrameLocator } from '@playwright/test';
import { test as base, expect } from './fixtures';
import { AdminUIHelper } from './AdminUIHelper';
import { verifyBlockRendering, revealBlock, checkEveryBlockOnPage } from './BlockVerificationHelper';
import { verifyPageIntegrity } from './PageIntegrityHelper';
import { drainFieldCoverage } from '../field-coverage';
import { measureTextStyles, recordTextStyles, slateStyles, drainStyleCoverage } from '../text-style-coverage';
import { drainImageSizeCoverage } from '../imageSizes.mjs';
import { axeCheckPage, formatViolations } from './axe-sanity';
import { requireEnvironment } from './preconditions';
import { harnessUrls } from '../ports';
import { inContract, readDiscovery, type ContractScope } from '../discovery';
import { validateTemplatePlaceholders } from '@volto-hydra/helpers/formDataValidation.js';

export interface SanityOptions extends ContractScope {
  /** Where global setup wrote discovery (the `discoveryDir` it was given). */
  discoveryDir: string;
  /** The frontend each Playwright project drives, by project name. */
  frontends: Record<string, string>;
  /**
   * The projects the contract is enforced on. Others skip, even on CI: a
   * frontend that ships partial block coverage on purpose is a decision, not a
   * broken environment.
   */
  projects: Iterable<string>;
  /**
   * Discovery sources whose cases run on every project, not only the one they
   * were found through. Default: '(env)', the frontend FRONTEND_URL names.
   */
  sharedSources?: Iterable<string>;
  /** The API pages are loaded from. Default: DISCOVER_BLOCKS_API, then the harness mock API. */
  apiUrl?: string;
  /** mock-parent.html. Default: MOCK_PARENT_URL, then the harness test frontend's. */
  mockParentUrl?: string;
  /** Pages (by path prefix) block-sanity's axe pass skips. */
  axeSkipPages?: string[];
}

/** Where a sanity test loads things from. Read inside a test, so ports resolve at run time. */
function addresses(options: Pick<SanityOptions, 'frontends' | 'apiUrl' | 'mockParentUrl'>) {
  return {
    frontend: (project: string): string | undefined =>
      process.env.FRONTEND_URL || options.frontends[project],
    api: (): string =>
      options.apiUrl || process.env.DISCOVER_BLOCKS_API || harnessUrls().mockApi,
    mockParent: (): string =>
      options.mockParentUrl || process.env.MOCK_PARENT_URL || `${harnessUrls().testFrontend}/mock-parent.html`,
  };
}

const describeProjects = (projects: Set<string>) => [...projects].join('/');

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
  frontend?: string;
  integrityIssue?: boolean;
  unexercisedOption?: boolean;
  undeclaredField?: boolean;
  /** Here only to show this text style, which no block case carries. */
  forStyle?: string;
}

/**
 * Measure how each text style in a block's slate fields renders, and record it
 * for the coverage reporter (TEXT-STYLE COVERAGE, #295). A style the author can
 * apply has to render, and has to render DIFFERENTLY from body text — otherwise
 * picking it does nothing visible and nothing says why. Measured by APPEARANCE,
 * never by markup: the frontend picks its own tags (it may render `strong` as a
 * styled span), so we locate the style's text, take a signature of how it
 * actually looks, and compare against body text on the same page. The coverage
 * reporter does the judging, over every worker.
 */
async function measureBlockStyles(iframe: FrameLocator, block: DiscoveredBlock): Promise<void> {
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
    recordTextStyles(block.blockType, block.pagePath, value, measured.out, measured.baseline);
  }
}

/**
 * Auto-discovered block sanity tests: one test per block @type (and variation)
 * discovery found, each loading the page that holds it through mock-parent's
 * ?api_path= and running verifyBlockRendering. Content and schema problems
 * discovery found fail as tests of their own rather than blocking the suite.
 * Also checks each page's template slot structure, on the rendered page.
 */
export function defineBlockSanityTests(options: SanityOptions): void {
  const projects = new Set(options.projects);
  const sharedSources = new Set(options.sharedSources ?? ['(env)']);
  const where = addresses(options);
  const onlyOn = describeProjects(projects);

  // A shape-issue discovery entry has no blockType — inContract keeps it (its
  // test FAILS with the issue text; dropping it here would hide a real content
  // problem).
  const discoveredBlocks: DiscoveredBlock[] = (readDiscovery<DiscoveredBlock>(options.discoveryDir, 'blocks') ?? [])
    .filter((b) => inContract(b.blockType, options));
  const seenShapeTitles = new Map();

  // The render test that also checks every OTHER block on its page: the first
  // render sample on each page, per frontend. One per page, so a page's blocks
  // are checked once however many samples it holds, and always by the same test.
  const isRenderSample = (b: DiscoveredBlock) =>
    !b.unregistered && !b.noExample && !b.allowedBlocksViolation && !b.integrityIssue &&
    !b.shapeIssue && !b.slateIssue && !b.unexercisedOption && !b.undeclaredField;
  const checksItsPage = new Set<DiscoveredBlock>();
  {
    const pages = new Set<string>();
    for (const b of discoveredBlocks) {
      const key = `${b.frontend ?? ''} ${b.pagePath}`;
      if (!isRenderSample(b) || pages.has(key)) continue;
      pages.add(key);
      checksItsPage.add(b);
    }
  }

  base.beforeEach(async ({}, testInfo) => {
    // Scope BEFORE environment: a project this spec doesn't cover is a decision,
    // and no CI change would make it run — so it skips even on CI. Discovery
    // missing is the opposite, hence requireEnvironment below.
    if (!projects.has(testInfo.project.name)) {
      testInfo.skip(true, `block-sanity only runs on ${onlyOn} (skipping ${testInfo.project.name})`);
    }
    requireEnvironment(
      testInfo,
      discoveredBlocks.length > 0,
      'no .discovered-blocks.json — discovery needs DISCOVER_BLOCKS_API=<mock api url> in this job',
    );
  });

  const test = base.extend<{ helper: AdminUIHelper }>({
    helper: async ({ page }, use) => {
      await use(new AdminUIHelper(page));
    },
  });

  test.describe('Block sanity (auto-discovered)', () => {
    for (const block of discoveredBlocks) {
      // Run each discovered case only on the frontend it came from. Discovery is
      // per-frontend because they do not register the same blocks — one found via
      // one frontend must not be asserted against another that never claimed it.
      // Playwright collects a spec once for all projects, so the cases are all
      // generated and the foreign ones skip at run time.
      const belongsHere = (name: string) =>
        !block.frontend || block.frontend === name
        || sharedSources.has(block.frontend);
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
      // A block here only to show a text style no block case carries. Its type is
      // checked by its own case, so this one only measures the style.
      if (block.forStyle) {
        test(`text style "${block.forStyle}" renders (${block.blockType} on ${block.pagePath})${src}`, async ({ page, helper }, testInfo) => {
          test.skip(!belongsHere(testInfo.project.name), `discovered via ${block.frontend}`);
          const frontendUrl = where.frontend(testInfo.project.name);
          const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';
          await page.goto(
            `${where.mockParent()}?api_path=${encodeURIComponent(`${where.api()}${block.pagePath}`)}${frontend}`,
          );
          await helper.waitForIframeReady();
          await helper.waitForBridgeConnected();
          const iframe = helper.getIframe();
          // The example can sit where the page doesn't show it at first: a later
          // page of a paged grid, a slide out of view.
          await revealBlock(iframe, block.blockId);
          await expect(
            iframe.locator(`[data-block-uid="${block.blockId}"]`).first(),
            `${block.blockType} [${block.blockId}], the example of "${block.forStyle}", did not render on ${block.pagePath}`,
          ).toBeAttached({ timeout: 15000 });
          await measureBlockStyles(iframe, block);
        });
        continue;
      }
      const labelVariation = block.variation && block.variation !== 'default'
        ? ` (${block.variation})`
        : '';
      const labelKind = block.kind ? ` [${block.kind}]` : '';
      const label = `${block.blockType}${labelVariation}${labelKind}`;
      // A listing whose query matches nothing has no results to draw, but while
      // editing it must still draw SOMETHING with its uid: otherwise the author has
      // nothing to click to select it and fix the query. (Published, it may draw
      // nothing — that is the frontend's edit-only placeholder.) Every listing
      // example, with its query swapped for one that matches no content.
      if (block.isListing) {
        test(`${label} with no results still shows something to click while editing${src}`, async ({ page, helper }, testInfo) => {
          test.skip(!belongsHere(testInfo.project.name), `discovered via ${block.frontend}`);
          const frontendUrl = where.frontend(testInfo.project.name);
          const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';
          const apiOrigin = where.api();
          const mockParentUrl = where.mockParent();
          await page.goto(`${mockParentUrl}?api_path=${encodeURIComponent(`${apiOrigin}${block.pagePath}`)}${frontend}`);
          await helper.waitForIframeReady();
          await helper.waitForBridgeConnected();
          // Only a listing driven by a query (its schema declares `querystring`);
          // one fed another way (a page's related items) can't be emptied by a query.
          const queryDriven = await page.evaluate((id) => {
            const mp = (window as any).mockParent;
            const map = mp.buildBlockPathMap();
            const type = map[id]?.blockType;
            return !!mp.getBlocksConfig()?.[type]?.blockSchema?.properties?.querystring;
          }, block.blockId);
          test.skip(!queryDriven, `${block.blockId}'s results don't come from a query`);
          const iframe = helper.getIframe();
          const drawn = iframe.locator(`[data-block-uid="${block.blockId}"]`);
          const textNow = () => drawn.evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText).join('|'));
          await expect(drawn.first(), `${label} [${block.blockId}] did not render with its results`).toBeAttached({ timeout: 15000 });
          const before = await textNow();

          const stored = (block.blockData?.querystring ?? {}) as Record<string, unknown>;
          await page.evaluate(([id, querystring]) => (window as any).mockParent.updateBlock(id, { querystring }), [
            block.blockId,
            {
              ...stored,
              query: [{
                i: 'SearchableText',
                o: 'plone.app.querystring.operation.string.contains',
                v: 'zzqx-no-content-matches-this',
              }],
            },
          ] as const);

          // The old results are still drawn until the frontend re-renders; wait for
          // what the listing shows to change before judging it.
          if (before) {
            await expect.poll(textNow, { message: `${label} [${block.blockId}] never re-rendered after its query changed`, timeout: 15000 })
              .not.toBe(before);
          }
          await expect(
            drawn.first(),
            `${label} [${block.blockId}] with no results drew nothing while editing — the author has nothing to click to select it`,
          ).toBeAttached({ timeout: 10000 });
          await revealBlock(iframe, block.blockId);
          const box = await drawn.first().boundingBox();
          expect(
            !!box && box.width > 0 && box.height > 0,
            `${label} [${block.blockId}] with no results has no size to click while editing, got ${JSON.stringify(box)}`,
          ).toBe(true);
        });
      }

      test(`${label} block renders and has edit annotations${src}`, async ({ page, helper }, testInfo) => {
        test.skip(!belongsHere(testInfo.project.name), `discovered via ${block.frontend}`);
        const frontendUrl = where.frontend(testInfo.project.name);
        const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';

        // Use api_path to load the full page content from the API
        // The mock-parent fetches the page JSON and sends it via the bridge protocol
        const apiOrigin = where.api();
        const mockParentUrl = where.mockParent();
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
          const frame = page.frames().find((f) => f !== page.mainFrame())!;

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

        // The page is drawn: check every other block on it too (see
        // checkEveryBlockOnPage). Before the text-style and a11y passes, which
        // judge the sample alone.
        if (checksItsPage.has(block)) {
          const others = await checkEveryBlockOnPage(iframe, block.blockId, (type) => !inContract(type, options));
          expect(others, `other blocks on ${block.pagePath} fail the per-block checks`).toEqual([]);
        }

        await measureBlockStyles(iframe, block);

        // Accessibility pass (axe-core) over the WHOLE rendered fixture page —
        // not scoped to this one block — so document-outline rules (heading-order)
        // are judged in context. serious/critical WCAG A/AA violations (incl.
        // heading-order) BLOCK; advisory (moderate/minor, best-practice-only, or
        // page-SHELL rules a minimal fixture can't be judged on) is logged only.
        // OPT-IN: off by default (test fixtures are rarely a11y-clean, and their
        // cosmetics aren't what block-sanity guards). Run the a11y pass with
        // SANITY_AXE=1.
        //
        // `axeSkipPages` is for pages that deliberately render MULTIPLE instances
        // of a layout-chrome component (header/masthead/main-nav), such as
        // structural-parity examples on a documentation site. That
        // duplication trips axe's duplicate-id / one-landmark rules — but the
        // chrome's a11y is already proven by the SINGLE live instance on every
        // other page (the layout renders it everywhere), so axe is skipped on the
        // example page rather than exempting a pile of rules there.
        const AXE_SKIP_PAGES = options.axeSkipPages ?? [];
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
      const imageSizes = drainImageSizeCoverage();
      await testInfo.attach('coverage', {
        body: JSON.stringify({ fields, styles, imageSizes }),
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
        const frontendUrl = where.frontend(testInfo.project.name);
        const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';
        const apiOrigin = where.api();
        const mockParentUrl = where.mockParent();
        await page.goto(
          `${mockParentUrl}?api_path=${encodeURIComponent(`${apiOrigin}${pagePath}`)}${frontend}`,
        );
        await helper.waitForIframeReady();
        await helper.waitForBridgeConnected();

        // The expanded tree, exactly as the editor would validate it.
        // page.frames(), not getIframe(): the latter is a FrameLocator, which
        // finds elements but cannot evaluate — the bridge is a window global, not
        // a DOM node.
        const frame = page.frames().find((f) => f !== page.mainFrame())!;
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
}

interface EmptyRegionCase {
  parentType: string;
  field: string;
  pagePath: string;
  blockId: string;
}

/**
 * Auto-discovered "empty container region" sanity tests.
 *
 * Every region of every container block type (blocks_layout, and object_list
 * items that hold blocks), paired with a real container example, plus the
 * page's own regions.
 *
 * For each, load that container's page in the mock parent and empty the region
 * the way an editor's delete does — the admin's own deleteBlockFromContainer +
 * ensureEmptyBlockIfEmpty (mockParent.emptyRegion). When the region names no
 * default and allows more than one type, the admin seeds the special
 * `@type:"empty"` placeholder: the editor's only way to add the first block.
 * Otherwise it seeds the region's default (or its single allowed type).
 *
 * Whatever is seeded must be drawn, with a size to click. This catches a
 * container renderer that rejects the child (e.g. a contextNavigation that only
 * expects navItem/listing) or draws it with no size. A seeded block is on no
 * stored page, so block-sanity never sees it; this is the only test that does.
 *
 * An empty placeholder must also be drawn AS empty — "Render them as empty
 * space" (docs/frontend-guide/container-blocks.md, Empty Blocks). Nothing in it
 * an author could take for content: no form control, no editable field, no
 * text. The one exception is an element the frontend marks `data-block-add`,
 * its own look for the '+'. A renderer that falls through to some ordinary
 * block's drawing (a form drawing the placeholder as a text question) fails
 * here.
 *
 * The admin's seeding decides which regions seed what, so no copy of that rule
 * lives here.
 */
/**
 * What an author could take for content inside an empty placeholder: form
 * controls, editable fields and visible text, skipping anything inside a
 * `data-block-add` element (the frontend's own '+'). Runs in the page.
 */
function contentOfEmptyPlaceholder(root: Element): string[] {
  const found: string[] = [];
  const own = (n: Node | null) => !(n instanceof Element ? n : n?.parentElement)?.closest('[data-block-add]');
  for (const c of root.querySelectorAll('input:not([type="hidden"]), textarea, select, button')) {
    if (own(c)) found.push(`a <${c.tagName.toLowerCase()}> control`);
  }
  for (const f of root.querySelectorAll('[data-edit-text], [data-edit-media], [data-edit-link]')) {
    if (!own(f)) continue;
    const attr = ['data-edit-text', 'data-edit-media', 'data-edit-link'].find((a) => f.hasAttribute(a))!;
    found.push(`an editable field (${attr}="${f.getAttribute(attr)}")`);
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = (t.textContent ?? '').replace(/[\u200B\uFEFF]/g, '').trim();
    if (text && own(t)) found.push(`the text "${text.slice(0, 40)}"`);
  }
  return found;
}

export function defineEmptyRegionTests(options: SanityOptions): void {
  const projects = new Set(options.projects);
  const where = addresses(options);
  const onlyOn = describeProjects(projects);
  const cases = (readDiscovery<EmptyRegionCase>(options.discoveryDir, 'emptyRegions') ?? [])
    .filter((c) => inContract(c.parentType, options));

  base.beforeEach(async ({}, testInfo) => {
    // Scope first, environment second — see block-sanity for why the order matters.
    if (!projects.has(testInfo.project.name)) {
      testInfo.skip(true, `empty-region sanity only runs on ${onlyOn} (skipping ${testInfo.project.name})`);
    }
    requireEnvironment(
      testInfo,
      cases.length > 0,
      'no .discovered-empty-regions.json — discovery needs DISCOVER_BLOCKS_API=<mock api url> in this job',
    );
  });

  const test = base.extend<{ helper: AdminUIHelper }>({
    helper: async ({ page }, use) => {
      await use(new AdminUIHelper(page));
    },
  });

  test.describe('Empty container region renders (auto-discovered)', () => {
    for (const c of cases) {
      const what = c.field === '*' ? `every ${c.parentType} region` : `${c.parentType}.${c.field}`;
      test(`${what} renders a placeholder when its region is empty`, async ({ page, helper }, testInfo) => {
        const frontendUrl = where.frontend(testInfo.project.name);
        const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';
        const apiOrigin = where.api();
        const mockParentUrl = where.mockParent();
        await page.goto(`${mockParentUrl}?api_path=${encodeURIComponent(`${apiOrigin}${c.pagePath}`)}${frontend}`);
        await helper.waitForIframeReady();
        await helper.waitForBridgeConnected();
        const iframe = helper.getIframe();
        // The page itself is no block element; a container is.
        if (c.blockId !== '_page') {
          await expect(iframe.locator(`[data-block-uid="${c.blockId}"]`).first(), `container ${c.blockId} did not render on ${c.pagePath}`)
            .toBeAttached({ timeout: 10000 });
        }

        const regions: string[] = c.field === '*'
          ? (await page.evaluate((id) => (window as any).mockParent.listRegions(id), c.blockId)).map((r: { region: string }) => r.region)
          : [c.field];
        expect(regions.length, `${c.parentType} [${c.blockId}] lists no regions`).toBeGreaterThan(0);

        let checked = 0;
        for (const region of regions) {
          const where = `${c.parentType} [${c.blockId}] region "${region}" on ${c.pagePath}`;
          // Empty it with the admin's own code — delete each child, then seed.
          const result: { skipped?: string; seeded?: { uid: string; type: string | null }[] } = await page.evaluate(
            ([id, r]) => (window as any).mockParent.emptyRegion(id, r), [c.blockId, region] as const,
          );
          if (result.skipped) {
            testInfo.annotations.push({ type: 'region-skipped', description: `${where}: ${result.skipped}` });
            continue;
          }
          const seeded = result.seeded ?? [];
          expect.soft(seeded.length, `${where}: emptying it left nothing to click`).toBeGreaterThan(0);
          checked++;
          for (const { uid, type } of seeded) {
            const what = type === 'empty' ? 'empty placeholder' : `${type} block`;
            const el = iframe.locator(`[data-block-uid="${uid}"]`).first();
            // Show it first: it may sit in a collapsed panel or an inactive slide,
            // or in a region a frontend draws only once asked (a search's answer).
            await revealBlock(iframe, uid);
            await expect.soft(el, `${where}: the frontend did not draw the seeded ${what} (${uid})`)
              .toBeAttached({ timeout: 10000 });
            if ((await iframe.locator(`[data-block-uid="${uid}"]`).count()) === 0) continue;
            const box = await el.boundingBox();
            expect.soft(
              !!box && box.width > 0 && box.height > 0,
              `${where}: the seeded ${what} (${uid}) has no size to click, got ${JSON.stringify(box)}`,
            ).toBe(true);
            if (type !== 'empty') continue;
            const content = await el.evaluate(contentOfEmptyPlaceholder);
            expect.soft(
              content,
              `${where}: the empty placeholder (${uid}) is drawn as if it were content. ` +
                `Render @type "empty" as empty space — Inka draws the '+' that picks its type ` +
                `(docs/frontend-guide/container-blocks.md, Empty Blocks). To restyle the '+', ` +
                `put it in an element marked data-block-add. Found: ${content.join('; ')}`,
            ).toEqual([]);
          }
        }
        test.skip(checked === 0, `no region of ${c.parentType} [${c.blockId}] seeds anything when emptied`);
      });
    }
  });
}

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
export function defineListingContainerTests(
  options: Pick<SanityOptions, 'discoveryDir' | 'projects' | 'excludeBlockTypes' | 'excludeTypePrefixes'>,
): void {
  const projects = new Set(options.projects);
  const onlyOn = describeProjects(projects);
  const found = readDiscovery<ListingContainerIssue>(options.discoveryDir, 'listingContainerIssues');
  const cases = (found ?? []).filter((c) => inContract(c.parentType, options));
  const test = playwrightTest;

  test.describe('Listing container sanity', () => {
    test('discovery ran', ({}, testInfo) => {
      testInfo.skip(
        !projects.has(testInfo.project.name),
        `listing-container sanity only runs on ${onlyOn} (skipping ${testInfo.project.name})`,
      );
      requireEnvironment(
        testInfo,
        found !== null,
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
          !projects.has(testInfo.project.name),
          `listing-container sanity only runs on ${onlyOn} (skipping ${testInfo.project.name})`,
        );
        throw new Error(explain(c));
      });
    }
  });
}

/**
 * Auto-discovered page integrity tests.
 *
 * Walks the unique set of pages discovery found and runs verifyPageIntegrity
 * against each — catches broken images and off-site backend-origin links in any
 * block on the page (not just the best-of-type instance block-sanity
 * exercises).
 *
 * Uses the direct frontend URL (the project's frontend) rather than the
 * mock-parent iframe, because verifyPageIntegrity uses `page.evaluate` /
 * `document.querySelectorAll`.
 */
export function definePageIntegrityTests(
  options: Pick<SanityOptions, 'discoveryDir' | 'frontends'>,
): void {
  const where = addresses(options);
  const test = playwrightTest;
  // Some findings are about a TYPE, not a page — a registered block with no
  // content example has nothing to point at, so it carries no pagePath. Without
  // this filter they became a test literally named "undefined" that navigated to
  // `<frontend>undefined`, failing for a reason unrelated to any page.
  const uniquePages = Array.from(new Set(
    (readDiscovery<{ pagePath?: string }>(options.discoveryDir, 'blocks') ?? [])
      .map((b) => b.pagePath)
      .filter((p): p is string => !!p),
  ));

  test.describe('Page integrity (auto-discovered)', () => {
    test.beforeEach(async ({}, testInfo) => {
      requireEnvironment(
        testInfo,
        uniquePages.length > 0,
        'no .discovered-blocks.json — discovery needs DISCOVER_BLOCKS_API=<mock api url> in this job',
      );
    });

    for (const pagePath of uniquePages) {
      test(`${pagePath}`, async ({ page }, testInfo) => {
        const frontendUrl = where.frontend(testInfo.project.name);
        // SCOPE, not environment: this check crawls a standalone frontend site,
        // and projects absent from the URL map have none to crawl — `mock` is
        // driven through mock-parent, and the `-firefox` variants re-run another
        // project's site in a second browser. Nothing is broken, so it skips even
        // on CI (unlike the discovery guard above).
        testInfo.skip(!frontendUrl, `no standalone frontend site for project ${testInfo.project.name}`);

        await page.goto(`${frontendUrl}${pagePath}`, { timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await verifyPageIntegrity(page);
      });
    }
  });
}
