/**
 * Reusable block verification helpers for testing rendered blocks.
 *
 * Verifies edit annotations (data-edit-link, data-edit-media, data-edit-text),
 * sub-block rendering, and data-node-id compliance.
 *
 * Accepts blocksConfig in the same format frontends pass to initBridge():
 *   { hero: { blockSchema: { properties: { ... } } }, slider: { ... } }
 */
import { expect } from '@playwright/test';
import type { Page, FrameLocator, Locator, ElementHandle } from '@playwright/test';
import { AdminUIHelper } from './AdminUIHelper';
import { recordSlateFieldContainer, recordFieldEditable } from './field-coverage';

export interface SubBlock {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Click EVERY visible [data-edit-text] field the block owns and verify that an
 * author can actually edit each one:
 *
 *  - no "Missing data-node-id attributes" warning (a block that puts
 *    data-edit-text on Slate-rendered content without data-node-id on the
 *    individual nodes — the bridge can't sync the cursor and warns), and
 *  - the click really starts editing: the field becomes contenteditable and
 *    takes the caret.
 *
 * The second half is the one with teeth. Annotation checks only prove the
 * attribute is present; a component whose own JS reveals or rebuilds its DOM
 * (accordion titles, tab labels) can be annotated perfectly and still be
 * impossible to type into — which is exactly how such a bug survived while
 * every other check was green.
 *
 * Every field, because a block can declare its first and leave the rest
 * annotated-but-undeclared; the bridge won't promote an undeclared field
 * (getFieldType → undefined), so those annotations promise an editor that
 * never opens. Fields belonging to NESTED blocks are skipped — they are that
 * block's contract, checked when it is the subject.
 */
/**
 * Let the browser reach its next frame in the iframe.
 *
 * The bridge answers a click synchronously in the click handler, and a
 * MutationObserver callback is delivered as a microtask — so both have run by
 * the time a frame is painted. Waiting for that boundary is CAUSAL: it waits
 * for the work to be possible, not for a guessed number of milliseconds. Use it
 * before asserting that something did NOT happen, where there is no positive
 * signal to await.
 */
async function nextFrame(iframe: FrameLocator): Promise<void> {
  await iframe.locator('body').evaluate(
    (node) =>
      new Promise<void>((resolve) => {
        const win = node.ownerDocument.defaultView as Window;
        win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()));
      }),
  );
}

export async function checkDataEditTextClicks(
  page: Page,
  iframe: FrameLocator,
  block: Locator,
): Promise<void> {
  const blockUid = await block.getAttribute('data-block-uid');
  const editTextEls = block.locator('[data-edit-text]');
  const count = await editTextEls.count();
  if (count === 0) return;

  // Which block each field belongs to, resolved ONCE. A field can belong to a
  // child of the block under test — a codeExample's code fields belong to its
  // tabs — and reaching one means revealing that child, which for a tab means
  // switching to it.
  const owners = await editTextEls.evaluateAll((nodes) =>
    nodes.map((node) => {
      const handle = node.closest('[data-block-selector]');
      const advertised = (handle?.getAttribute('data-block-selector') || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const standIn =
        advertised.length === 1 &&
        advertised[0] !== '+1' &&
        advertised[0] !== '-1' &&
        !advertised[0].includes(':')
          ? advertised[0]
          : null;
      return standIn || node.closest('[data-block-uid]')?.getAttribute('data-block-uid') || null;
    }),
  );

  // Walk grouped by owner so each block is revealed ONCE and all of its fields
  // are checked while it is on screen. Field order interleaves owners (every
  // tab label, then every tab's code), so revealing per field switched tabs
  // between a reveal and the click depending on it — and did it twice as often.
  const order = [...Array(count).keys()].sort(
    (a, b) => String(owners[a] ?? '').localeCompare(String(owners[b] ?? '')) || a - b,
  );
  let revealedOwner: string | null = null;
  // Whether a click in THIS pass has already selected the block. The first
  // click is what selects it; every later one lands on a block the admin is
  // still catching up with — see the wait before the click below.
  let selected = false;

  const admin = new AdminUIHelper(page);

  for (const i of order) {
    const el = editTextEls.nth(i);
    const owner = owners[i];
    if (owner && owner !== revealedOwner) {
      await revealBlock(iframe, owner);
      // Let the reveal settle before using the block. Revealing a tab or a
      // carousel slide moves the DOM, so wait for the count to stop changing
      // AND for the block itself to stop moving — clicking a slide still in
      // transit lands where it used to be, which reads as "element is outside
      // of the viewport" once Playwright has scrolled (a transform cannot be
      // scrolled to).
      await admin.getStableBlockCount();
      const ownerEl = iframe.locator(`[data-block-uid="${owner}"]`).first();
      if (await ownerEl.count()) {
        await admin.waitForPositionStable(ownerEl).catch(() => {});
      }
      revealedOwner = owner;
    }
    if (!await el.isVisible()) continue;
    // Only the fields this block OWNS. A container renders its children's
    // fields too, and those are the child block's contract, checked when the
    // child is the subject.
    const owned = await el.evaluate(
      (node, uid) => node.closest('[data-block-uid]')?.getAttribute('data-block-uid') === uid,
      blockUid,
    );
    if (!owned) continue;

    // `data-block-readonly` is the FRONTEND declaring "this content is not
    // authored here" — a teaser mirroring the page it links to, a listing
    // rendering query results. The bridge honours it by promoting nothing, so
    // asserting editability would test a promise no one made.
    //
    // It has to be the attribute, not the uid: a listing's expanded results
    // deliberately carry the LISTING's uid, so ownership cannot tell borrowed
    // content from authored content — only this attribute can.
    const readonly = await el.evaluate((node) => !!node.closest('[data-block-readonly]'));
    if (readonly) continue;

    // A field inside a collapsed tab / accordion panel has no box, so clicking
    // it would just time out. That is not "uneditable" — it is content the
    // author reveals first, and the frontend already says how: the container
    // advertises the uids it can reveal on `data-block-selector` (the tab's nav
    // link, the accordion header), which is the same handle the bridge clicks
    // when the admin selects a hidden block. Use it here rather than teaching
    // this helper about any particular component's markup.
    await revealBlock(iframe, blockUid);


    // Scroll the field to the MIDDLE of the viewport before clicking. Playwright
    // scrolls to the nearest edge, which on any site with a sticky header puts
    // the field underneath it — the click then lands on the header and the
    // failure reads as "something intercepts pointer events", which looks like a
    // markup bug and is not one.
    await el.evaluate((node) =>
      node.scrollIntoView({ block: 'center', inline: 'nearest' }),
    );
    // Then let it come to rest. Scrolling is not instant, and selecting the
    // previous field can move the page as well, so the element can still be
    // travelling when the click is dispatched — the click then lands on
    // whatever has slid into that spot. That is exactly how clicking a
    // codeExample tab label ended up hitting the code panel underneath
    // (activeElement=DIV), and it only showed up in the full suite, where a
    // previous selection had something to scroll.
    await new AdminUIHelper(page).waitForPositionStable(el).catch(() => {});

    // Playwright resolves a <label> to the control it labels, so a label whose
    // control is DISABLED counts as disabled and `.click()` refuses to act on
    // it. That is a false negative here: the browser still delivers the click
    // to the label, and the bridge still promotes the field — a disabled
    // control means the ANSWER cannot be given, not that the question's text
    // cannot be edited. (A form field disabled by a rule is exactly this: the
    // author must still be able to rename it.)
    //
    // So the actionability veto is bypassed only for that case; everywhere else
    // the ordinary checks — visible, stable, receives the event — keep their
    // value.
    // The bridge promotes a field to contenteditable ONCE, on the click that
    // reaches it — there is no retry. A click that lands while the admin is
    // still settling the previous selection is answered by a re-render
    // (restoreContentEditableOnFields, whose own comment notes that it "would
    // change the DOM and shift event.target"), and the promotion is simply
    // lost: the assertion below then waits out its full timeout for an
    // attribute that was never coming, and reads as a mystery flake.
    //
    // So wait for the admin to agree the block is selected before clicking
    // again — the same observable state the integration specs wait on (toolbar
    // visible AND positioned over the block, handles aligned, nothing covering
    // it). Not on the first click: that click is what selects the block.
    if (selected) {
      // isBlockSelectedInIframe, not waitForBlockSelectedInAdmin: the state we
      // need is "the admin has caught up with the last click" — the toolbar and
      // outline are up and positioned over this block — and the mock parent the
      // BRIDGE suite drives renders exactly those. waitForBlockSelectedInAdmin
      // additionally checks sidebar coverage and drag-handle alignment, which
      // only the real Volto admin has, so it could never settle there.
      //
      // This is a readiness HINT, not an assertion. Some blocks never report
      // selected here even though their fields promote perfectly well (a
      // codeExample's <pre> is one: the outline lands, but the positioning
      // check this helper makes does not agree) — and failing those is a
      // regression this wait has no business causing. If the state never
      // arrives we click anyway: the promotion assertion below is the one that
      // decides the test, and it reports the real problem when it is real.
      await expect
        .poll(
          async () => {
            const res = await admin.isBlockSelectedInIframe([blockUid]);
            return typeof res === 'boolean' ? res : !!res?.ok;
          },
          { timeout: 5000 },
        )
        .toBeTruthy()
        .catch(() => {});
    }
    const actionable = await el.isEnabled().catch(() => true);
    await el.click(actionable ? {} : { force: true });
    selected = true;
    // The warning below is asserted ABSENT, so give the bridge its frame to
    // raise one — see nextFrame. (Was a 300ms sleep.)
    await nextFrame(iframe);

    const warning = iframe.locator('#hydra-dev-warning');
    await expect(
      warning,
      `Clicking [data-edit-text] #${i} should not trigger "Missing data-node-id attributes" warning`,
    ).not.toBeVisible();

    // Dismiss overlay if it somehow appeared (don't pollute subsequent checks)
    if (await warning.isVisible()) {
      await iframe.locator('#hydra-warning-close').click();
    }

    const fieldName = await el.getAttribute('data-edit-text');
    // contenteditable is written explicitly as "true"/"false" by the bridge. A
    // missing attribute and contenteditable="" both read as "" through
    // Playwright, so only "true" proves the field was promoted.
    await expect(
      el,
      `Clicking [data-edit-text="${fieldName}"] should make it editable`,
    ).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // Editable is not enough — the caret has to land in it, or the author's
    // first keystroke goes to the body and is buffered instead of typed.
    await expect
      .poll(
        async () =>
          el.evaluate((node) => {
            const doc = node.ownerDocument;
            // The editable host itself must hold focus. A <button> inside it
            // taking focus (a design system rewriting a heading into a button)
            // reads as "focus is in the field" to a contains() check but leaves
            // the author with nothing to type into.
            if (doc.activeElement !== node) return `activeElement=${doc.activeElement?.tagName}`;
            const sel = doc.getSelection();
            if (!sel || sel.rangeCount === 0) return 'no selection';
            return node.contains(sel.getRangeAt(0).startContainer) ? 'caret in field' : 'caret elsewhere';
          }),
        {
          timeout: 5000,
          message: `Clicking [data-edit-text="${fieldName}"] should put the caret in it`,
        },
      )
      .toBe('caret in field');

    await page.keyboard.press('Escape');
    // EVERY field, not just the first. Stopping at one meant a block's second
    // and later fields were never exercised — a block could declare its first
    // field and leave the rest annotated-but-undeclared, which is exactly the
    // shape of the fixture gaps this check just found (form's label/placeholder
    // sit behind title/description).
  }
}

/**
 * Reveal a block that is rendered but not visible — inside a collapsed tab
 * panel, accordion or carousel slide.
 *
 * `data-block-selector` is a word-list of the uids an element reveals when
 * clicked, published by the frontend (see tabs / accordion). It is the contract
 * the bridge itself uses for reveal-on-select, so honouring it here keeps this
 * helper free of component-specific knowledge — a new container opts in by
 * publishing the attribute, with no change to the harness.
 *
 * A block that is already visible, or whose container publishes nothing, is
 * left exactly as it was.
 */
/**
 * Do everything the EDITOR would do to make a block's fields editable, in the
 * order an author would, and say whether anything changed.
 *
 * The harness had these steps scattered: `revealBlock` for a block hidden
 * behind an accordion or a tab, a `data-block-selector="uid#field"` press for a
 * field the design system draws elsewhere, and `unlockTemplate` in the template
 * specs — so a check that needed a step nobody had wired in reported the block
 * as uneditable rather than un-revealed. The footer template's cookie banner
 * failed exactly that way, while the same block on an ordinary page passed:
 * nothing had unlocked the template, and a locked member carries no annotation
 * because it genuinely is not editable yet.
 *
 * Each step is skipped when it does not apply, so this is safe to call whenever
 * a field looks absent, and returns false when it did nothing (there is then no
 * point looking again).
 */
export async function makeEditable(
  block: Locator,
  blockData?: Record<string, unknown>,
  iframe?: FrameLocator,
): Promise<boolean> {
  const uid = await block.getAttribute('data-block-uid');
  if (!uid) return false;
  let acted = false;

  // 1. Hidden behind a container's own control (accordion header, tab, slide).
  //    revealBlock owns this: it asks the bridge whether the block is really
  //    visible (an off-screen slide still has client rects), copes with a
  //    query-gated block that has no element at all, and steps +1/-1 to reach
  //    one. Re-clicking the selector here would be a worse copy of it.
  if (iframe && !(await block.isVisible().catch(() => false))) {
    await revealBlock(iframe, uid);
    acted = true;
  }

  // 2. Drawn ELSEWHERE by design system JavaScript (a cookie banner, a dialog).
  //    The control that opens it names the field it holds.
  const handles = block.page().locator(`[data-block-selector^="${uid}#"]`);
  if ((await handles.count()) > 0) {
    await handles.first().click().catch(() => {});
    acted = true;
  }

  // 3. A LOCKED TEMPLATE MEMBER: not editable in place until the template is
  //    unlocked, which is a gesture the editor offers rather than a missing
  //    feature.
  if (blockData?.templateInstanceId && (blockData.fixed || blockData.readOnly)) {
    try {
      await new AdminUIHelper(block.page()).unlockTemplate(uid);
      acted = true;
    } catch {
      // No toggle, or already unlocked — report what is actually there.
    }
  }
  return acted;
}

export async function revealBlock(iframe: FrameLocator, blockUid: string): Promise<void> {
  const block = iframe.locator(`[data-block-uid="${blockUid}"]`).first();
  // A query-gated block (data-block-selector-input) has NO element until its
  // question is asked — and locator.evaluate AUTO-WAITS on an absent element,
  // so probing it directly hung the whole test until the timeout and the
  // reveal never ran. Count first: count() never waits.
  const exists = (await block.count()) > 0;
  // Ask the bridge whether it considers the block visible — do not re-derive it.
  // A carousel slide translated out of view still HAS client rects: it is laid
  // out, just at x=-777 while its container starts at x=16. Checking rects
  // concluded "already rendered", skipped the reveal, and left the click landing
  // off-viewport. isElementHidden knows about off-screen translates.
  const rendered = exists
    ? await block
        .evaluate((node) => {
          const bridge = (window as any).__hydraBridge;
          if (bridge?.isElementHidden) return !bridge.isElementHidden(node);
          return node.getClientRects().length > 0;
        })
        .catch(() => false)
    : false;
  if (rendered) return;

  // hydra already knows how to do this: tryMakeBlockVisible clicks a direct
  // data-block-selector, and failing that steps +1/-1 until it reaches the
  // target. That is what the editor does on select, so the harness asks the
  // bridge instead of re-deriving carousel navigation here — a second
  // implementation would drift from the one users actually get.
  const dbg = await iframe.locator('body').evaluate((_el, uid) => {
    const b = (window as any).__hydraBridge;
    return { hasBridge: !!b, fn: typeof b?.tryMakeBlockVisible, inMap: !!b?.blockPathMap?.[uid], parent: b?.blockPathMap?.[uid]?.parentId ?? null };
  }, blockUid).catch((e) => ({ err: String(e) }));
  console.log('[revealBlock DEBUG]', blockUid, JSON.stringify(dbg));
  const clicked = await iframe
    .locator('body')
    .evaluate(
      (_el, uid) => (window as any).__hydraBridge?.tryMakeBlockVisible?.(uid) ?? false,
      blockUid,
    )
    .catch(() => false);
  if (!clicked) return;

  // A click reveal repaints in a frame; a QUERY reveal navigates (the form
  // submits, the page reloads, edit mode waits for INITIAL_DATA, then
  // renders) — give it the reload's worth of time.
  await expect(block).toBeVisible({ timeout: 15000 });

}

/**
 * Check edit annotations on a rendered block:
 * - All <a href> links must have data-edit-link (except in-page anchors)
 * - All <img> must have data-edit-media
 * - Simple string fields in block data (title, heading, etc.) that appear in the DOM
 *   must have a data-edit-text ancestor
 */
export async function checkEditAnnotations(
  block: Locator,
  blockData: Record<string, unknown> | undefined,
): Promise<void> {
  // One round-trip, not ~8. checkEditAnnotations runs per sub-block, and each
  // Playwright locator/evaluate call is a CDP message across the Node↔browser
  // boundary (~50ms of latency, whatever the DOM work costs). Reading everything
  // in a single in-page pass turns ~8 round-trips per block into 1 — a container
  // with 30 descendants goes from ~240 round-trips to ~30. The ASSERTIONS stay in
  // Node (below) with their original messages; only the DOM READS moved in-page,
  // so the checks mean exactly what they did before.
  const blockUid = await block.getAttribute('data-block-uid');
  const r = await block.evaluate(
    async (el: Element, { blockData, uid }: { blockData: Record<string, unknown> | undefined; uid: string | null }) => {
      const bridge = (window as any).__hydraBridge;
      const pageOrigin = window.location.origin;

      // Content links must have data-edit-link or data-linkable-allow. Exclude
      // links inside [data-edit-text] — those are slate-managed, not a link field.
      const linksWithout = [...el.querySelectorAll('a[href]')]
        .filter((a) => !a.getAttribute('href')!.startsWith('#'))
        .filter((a) => !a.closest('[data-edit-text]'))
        .filter((a) => !a.hasAttribute('data-edit-link') && !a.hasAttribute('data-linkable-allow'))
        .map((a) => a.getAttribute('href'));

      // Editable annotations cannot live inside <a href data-linkable-allow>:
      // that click is a full navigation that tears down the editor first.
      const trappedAnnotations = [
        ...el.querySelectorAll(
          'a[href][data-linkable-allow] [data-edit-text], a[href][data-linkable-allow] [data-edit-link], a[href][data-linkable-allow] [data-edit-media]',
        ),
      ].map((x) => {
        const which =
          (x.hasAttribute('data-edit-text') && 'data-edit-text') ||
          (x.hasAttribute('data-edit-link') && 'data-edit-link') ||
          'data-edit-media';
        return `${which}="${x.getAttribute(which as string) || ''}" on <${x.tagName.toLowerCase()}>`;
      });

      // Links must be same-origin or relative — catches a link to the API host.
      const offSiteLinks = [...el.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => {
          if (!h || h.startsWith('#') || h.startsWith('/')) return false;
          try {
            const o = new URL(h, pageOrigin).origin;
            return o !== pageOrigin && o.includes('localhost');
          } catch {
            return false;
          }
        });

      // Non-decorative images (not aria-hidden) must carry data-edit-media.
      const imagesWithout = [...el.querySelectorAll('img')]
        .filter((i) => !i.hasAttribute('data-edit-media') && i.getAttribute('aria-hidden') !== 'true')
        .map((i) => i.getAttribute('src'));

      // Images must have a non-empty src and load (naturalWidth>0). NOT a size
      // judgement — a 1×1 is valid; a placeholder blob is a content problem the
      // validator catches. Only empty-src or loaded-but-broken fails here.
      const brokenImages = [...el.querySelectorAll('img')]
        .filter((i) => {
          const src = i.getAttribute('src') || '';
          if (!src) return true;
          if ((i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0) return true;
          return false;
        })
        .map((i) => i.getAttribute('src') || '(empty)');

      // Video/audio srcs must actually exist — an <img> reports its own failure
      // via naturalWidth, but a 404 <video> just renders an empty player. Fetch
      // is the only check that sees it (same-origin, HEAD is enough).
      const srcs = [
        ...el.querySelectorAll('video[src], audio[src], video source[src], audio source[src]'),
      ]
        .map((n) => n.getAttribute('src') || '')
        .filter((s) => s && !s.startsWith('data:') && !s.startsWith('blob:'));
      const brokenMedia: string[] = [];
      for (const src of [...new Set(srcs)]) {
        try {
          const resp = await fetch(src, { method: 'HEAD' });
          if (!resp.ok) brokenMedia.push(`${src} (HTTP ${resp.status})`);
        } catch (e) {
          brokenMedia.push(`${src} (${(e as Error).message})`);
        }
      }

      // Inline-text schema fields the renderer displays must sit inside
      // [data-edit-text]. Schema-driven: only plain text widgets qualify, so a
      // Choice `colour:"white"` or an icon ligature can't false-positive.
      const textViolations: Array<{ field: string; value: string }> = [];
      if (blockData && uid) {
        const schema = bridge?.getBlockSchema?.(uid) || null;
        const props = schema?.properties as Record<string, any> | undefined;
        const isInlineTextField = (field: string): boolean => {
          const p = props?.[field];
          if (!p) return false;
          if (p.factory === 'Choice' || p.choices) return false;
          const w = p.widget;
          if (w && w !== 'text' && w !== 'textarea') return false;
          return p.type === undefined || p.type === 'string';
        };
        for (const [field, value] of Object.entries(blockData)) {
          if (field.startsWith('@')) continue;
          if (typeof value !== 'string' || !value) continue;
          if (!isInlineTextField(field)) continue;
          // Verdict is the FIRST text node containing the value (matching the
          // original's early return). sr-only (1×1) and data-block-readonly
          // subtrees are exempt; display:none content (no rects) stays required.
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          let ok = true;
          while ((node = walker.nextNode())) {
            if (node.textContent?.includes(value)) {
              const host = node.parentElement;
              if (!host) { ok = true; break; }
              if (host.closest('[data-block-readonly]')) { ok = true; break; }
              const rendered = host.getClientRects().length > 0;
              const box = host.getBoundingClientRect();
              if (rendered && box.width < 2 && box.height < 2) { ok = true; break; }
              ok = !!host.closest('[data-edit-text]');
              break;
            }
          }
          if (!ok) textViolations.push({ field, value });
        }
      }

      return { linksWithout, trappedAnnotations, offSiteLinks, imagesWithout, brokenImages, brokenMedia, textViolations };
    },
    { blockData, uid: blockUid },
  );

  expect(r.linksWithout, 'All content links should have data-edit-link or data-linkable-allow').toEqual([]);
  expect(
    r.trappedAnnotations,
    'Editable annotations (data-edit-text/link/media) cannot live inside <a href data-linkable-allow> — full-page navigation tears down the editor before editing can happen',
  ).toEqual([]);
  expect(r.offSiteLinks, 'Links should not point to a different localhost service (e.g. the API)').toEqual([]);
  expect(r.imagesWithout, 'All non-decorative images should have data-edit-media').toEqual([]);
  expect(r.brokenImages, 'All images should have valid src and load successfully').toEqual([]);
  expect(r.brokenMedia, 'All video/audio sources should exist').toEqual([]);
  for (const { field, value } of r.textViolations) {
    expect(
      false,
      `"${value}" (${field}) is visible on screen, so it should be inside [data-edit-text] — a visible schema text field has to be inline-editable`,
    ).toBe(true);
  }
}

/**
 * Detect slate-shaped field values in block data: non-empty arrays of
 * objects where the first item has a `children` array (slate node shape).
 */
function findSlateFields(
  blockData: Record<string, unknown>,
): string[] {
  const fields: string[] = [];
  for (const [key, value] of Object.entries(blockData)) {
    if (key.startsWith('@') || key === 'blocks' || key === 'blocks_layout') continue;
    if (!Array.isArray(value) || value.length === 0) continue;
    const first = value[0] as Record<string, unknown> | undefined;
    if (first && typeof first === 'object' && Array.isArray(first.children)) {
      fields.push(key);
    }
  }
  return fields;
}

/**
 * An empty text node (`{ text: '' }`, ignoring node-id metadata). Slate inserts
 * these at inline boundaries — before a leading `<strong>`, between adjacent
 * links, after a trailing inline — as normalization.
 */
function isEmptyTextNode(n: unknown): boolean {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return false;
  const o = n as Record<string, unknown>;
  if (o.text !== '') return false;
  return Object.keys(o).every((k) => k === 'text' || k === 'nodeId' || k === 'data-node-id');
}

/**
 * Compare two slate trees for structural equality (types + text), ignoring
 * nodeId metadata and inline mark ordering. Used to verify that the DOM
 * round-trips back to the same Slate value via readSlateValueFromDOM.
 *
 * Empty text nodes are ignored on both sides: they are slate's inline-boundary
 * normalization, which `readSlateValueFromDOM` produces (and hydra re-adds on
 * load) but the renderer emits none of. So a stored value that hasn't been
 * normalized — e.g. a `<p>` whose first child is a `<strong>`, stored as
 * `[{strong}, …]` — round-trips to the same tree once these artifacts drop out.
 * Any real (non-empty) text or structural difference is still caught, since only
 * `{ text: '' }` nodes are removed.
 */
function slateEqualIgnoringIds(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    const fa = a.filter((n) => !isEmptyTextNode(n));
    const fb = b.filter((n) => !isEmptyTextNode(n));
    if (fa.length !== fb.length) return false;
    return fa.every((item, i) => slateEqualIgnoringIds(item, fb[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const SKIP = new Set(['nodeId', 'data-node-id']);
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)].filter(k => !SKIP.has(k)));
    for (const k of keys) {
      if (!slateEqualIgnoringIds(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}



/**
 * Every edit annotation on a block, read in ONE round trip.
 *
 * Asking the page per field costs a message each way per field, and a block with
 * a dozen fields (a grid of contentBlocks) spent its whole 20s budget on that
 * before it could assert anything. One evaluate returns the lot; the questions
 * are then set lookups in Node.
 *
 * Values are normalised for the leading slash some renderers emit
 * (`data-edit-media="/image"`).
 */
/**
 * The annotation a schema field is edited through, if any. `image` /
 * `object_browser` say what kind of picker the field wants; text and textarea
 * are deliberately absent (an image's `alt` is a sidebar attribute, and a
 * textarea is not uniformly canvas content).
 */
function annotationFor(
  prop: Record<string, unknown>,
): { kind: 'text' | 'media' | 'link'; attr: string } | null {
  const w = prop?.widget;
  const mode = (prop as { mode?: string })?.mode;
  if (w === 'image' || (w === 'object_browser' && mode === 'image'))
    return { kind: 'media', attr: 'data-edit-media' };
  if (w === 'object_browser' && mode === 'link')
    return { kind: 'link', attr: 'data-edit-link' };
  return null;
}

/** One annotated element: which attribute declares it, which field, and where. */
interface EditableField {
  attr: string;
  field: string;
  element: ElementHandle<Element>;
}

/**
 * Every field of this block that is editable on the canvas, WITH the element it
 * is edited in — one search, for every kind at once.
 *
 * Two things it does that a descendant query cannot:
 *
 *   - it asks the BRIDGE for fields drawn where the block ISN'T. A tab's label
 *     sits on the button that reveals its panel; the wording of a cookie banner
 *     sits wherever the design system built it. Those elements say which block
 *     they belong to (`data-block-selector="uid#field"`), and that is as true of
 *     a link or a picture as it is of text.
 *   - it returns the ELEMENT, so a caller with a further question about a field
 *     — the slate round-trip is the only one — asks it of what was found here
 *     rather than searching again and risking a different answer.
 */
async function editableFieldsIn(block: Locator): Promise<EditableField[]> {
  const collected = await block.evaluateHandle((el) => {
    const attrs = ['data-edit-text', 'data-edit-media', 'data-edit-link'];
    const bridge = (window as unknown as { __hydraBridge?: any }).__hydraBridge;
    const strip = (v: string | null) => (v || '').replace(/^\//, '');
    const out: Array<{ attr: string; field: string; el: Element }> = [];
    const add = (node: Element, attr: string, name: string) => {
      const field = strip(name);
      if (field && !out.some((o) => o.el === node && o.attr === attr)) {
        out.push({ attr, field, el: node });
      }
    };
    for (const attr of attrs) {
      if (bridge?.collectBlockFields) {
        // The BRIDGE's own walk, not a second one: every element carrying the
        // uid (a block can be several), what stands in for the block, minus
        // what belongs to a nested block or is marked readonly. Asking it is
        // the point — a check that re-derives "the block's fields" can pass
        // while the editor disagrees, which is the failure it exists to catch.
        bridge.collectBlockFields(el, attr, (node: Element, name: string) => add(node, attr, name));
      } else {
        // No bridge (a plain-DOM harness): the block's own subtree is all there
        // is to go on.
        if (el.hasAttribute(attr)) add(el, attr, el.getAttribute(attr) ?? '');
        for (const d of Array.from(el.querySelectorAll(`[${attr}]`))) {
          add(d, attr, d.getAttribute(attr) ?? '');
        }
      }
    }
    return out;
  });

  const found: EditableField[] = [];
  for (const item of (await collected.getProperties()).values()) {
    const { attr, field } = await item.evaluate(
      (o: { attr: string; field: string }) => ({ attr: o.attr, field: o.field }),
    );
    const element = (await item.getProperty('el')).asElement();
    if (element) found.push({ attr, field, element });
  }
  return found;
}

/** The found fields as `{ attribute: Set<fieldName> }`, for presence questions. */
function namesByAttr(found: EditableField[]): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {
    'data-edit-text': new Set(),
    'data-edit-media': new Set(),
    'data-edit-link': new Set(),
  };
  for (const f of found) out[f.attr]?.add(f.field);
  return out;
}

/**
 * Ask for what is expected but not there, ONCE for the whole block, the way the
 * editor asks: `revealFieldPlace` — the same call the sidebar makes when an
 * author's cursor lands in a field, which opens the half that field is edited
 * in. Any kind of field: a picture or a link can sit in a collapsed panel as
 * easily as a paragraph.
 *
 * It is opt-in at the bridge (nothing happens unless something advertises
 * `uid#field`), so a block that draws all its fields itself pays one call and
 * moves on. Then wait for the ask to land — a component that builds its own
 * markup rebuilds it a beat later — and read again.
 */
async function settleAnnotations(
  block: Locator,
  found: EditableField[],
  expected: Array<[string, string]>,
  settleMs = 3000,
): Promise<EditableField[]> {
  const present = namesByAttr(found);
  const missing = expected.filter(([attr, field]) => !present[attr]?.has(field));
  if (!missing.length) return found;

  const asked = await block.evaluate(
    async (el, args) => {
      const { wanted, settle } = args as { wanted: Array<[string, string]>; settle: number };
      const bridge = (window as unknown as { __hydraBridge?: any }).__hydraBridge;
      const uid = el.getAttribute('data-block-uid');
      // Nothing advertises these fields → nothing to reveal, and nothing that
      // could arrive later either. Say so rather than spending the block's test
      // budget waiting (a container multiplies that by every child).
      const revealed = wanted
        .map(([, field]) => bridge?.revealFieldPlace?.(uid, field) ?? false)
        .some(Boolean);
      if (!revealed) return false;

      const arrived = () =>
        wanted.every(([attr, field]) => {
          if (el.querySelector(`[${attr}="${field}"]`)) return true;
          const onHandles = bridge?.fieldsOnHandlesFor?.(uid, { attr, fieldName: field }) ?? [];
          return onHandles.length > 0;
        });
      for (let waited = 0; !arrived() && waited < settle; waited += 100) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return true;
    },
    { wanted: missing, settle: settleMs },
  ).catch(() => false);

  return asked ? editableFieldsIn(block) : found;
}


/**
 * The fields this block would REVEAL — i.e. the ones that are empty and have an
 * inline affordance, so their annotation is legitimately absent until the editor
 * presses the reveal toggle (#296).
 *
 * Asked of the bridge, which computes it from the schema and the block's data —
 * no press, no re-render, one round trip per block. Pressing the toggle for real
 * was the first version and it does not scale: a grid re-renders the whole page
 * on every press, and doing that per child (press + undo, twice per field) spent
 * the test's entire budget before it could assert anything.
 *
 * That reveal ACTUALLY renders the field is proven once, properly, by hydra's
 * own optional-fields spec — it doesn't need re-proving for every block in every
 * example. What this check needs is only the reason an annotation is missing.
 */
/**
 * Fields this block says are edited SOMEWHERE ELSE.
 *
 * A block does not always own the element its field is rendered into. Design
 * system JavaScript builds the cookie banner and its dialog into <body>, so the
 * paragraph carrying `data-edit-text="message"` is a sibling of the whole app,
 * not a descendant of the block — `editableFieldsIn` looks inside the block and
 * cannot see it, and the field reads as "uneditable everywhere it appears" when
 * it is editable exactly where the reader finds it.
 *
 * The block says so itself: `data-block-selector="<uid>#<field>"` is the
 * frontend declaring "this control reaches that field of mine", and it is the
 * same handle the bridge clicks when the author picks the field in the sidebar.
 * Trusting the declaration is what keeps the coverage rule about whether the
 * author can reach a field, rather than about where the markup happens to sit.
 */
async function advertisedFieldsOf(block: Locator): Promise<Set<string>> {
  const uid = await block.getAttribute('data-block-uid');
  if (!uid) return new Set();
  // Searched through the block's OWN document, not `block.page()`. The block is
  // inside the editor's iframe, and `page.locator()` only ever sees the
  // top-level document — so a page-wide search found nothing at all, however
  // plainly the handle was there. `ownerDocument` is the frame the block is
  // actually in.
  //
  // Document-wide within that frame, not block-scoped: the handle usually IS
  // inside the block (the "Show cookie consent" button), but the whole point of
  // the mechanism is that either end may sit outside it, so neither is assumed.
  const tokens: string[] = await block.evaluate((el, blockUid) => {
    const nodes = el.ownerDocument.querySelectorAll(
      `[data-block-selector*="${blockUid}#"]`,
    );
    return Array.from(nodes).flatMap((n) =>
      (n.getAttribute('data-block-selector') || '').split(/\s+/),
    );
  }, uid);
  const fields = tokens
    .filter((t) => t.startsWith(`${uid}#`))
    .map((t) => t.slice(uid.length + 1))
    .filter(Boolean);
  return new Set(fields);
}

async function revealableFieldsOf(block: Locator): Promise<Set<string>> {
  const uid = await block.getAttribute('data-block-uid');
  if (!uid) return new Set();
  const fields = await block.evaluate((el, blockUid) => {
    const bridge = (el.ownerDocument.defaultView as any)?.__hydraBridge;
    try {
      return (bridge?.revealableFields?.(blockUid) as string[]) ?? [];
    } catch {
      return [];
    }
  }, uid);
  return new Set(fields);
}

/**
 * Schema-driven (with shape-based fallback) slate annotation check.
 *
 * For every slate field — either declared as `widget: 'slate'` in the block
 * schema or detected by value shape (array of `{children: [...]}`) — round-trip
 * the rendered DOM back to a Slate value using Bridge.readSlateValueFromDOM
 * and compare against blockData[field]. A mismatch means the renderer
 * isn't emitting the data-node-id attributes the bridge needs to anchor
 * text nodes, so cursor sync will fail during editing.
 *
 * This is strictly stronger than counting [data-node-id] descendants —
 * it fails when any slate node is missing an id, not just when all are.
 */
export async function checkSlateAnnotations(
  block: Locator,
  blockData: Record<string, unknown> | undefined,
  blockSchema?: { properties?: Record<string, any> },
  iframe?: FrameLocator,
): Promise<void> {
  if (!blockData) return;

  // Prefer the live schema from the bridge (built from the blockPathMap's
  // _schemas, already resolved via schemaEnhancers) when a caller didn't
  // pass one explicitly. This avoids persisting blocksConfig to disk just
  // to drive annotation checks in the spec.
  if (!blockSchema?.properties) {
    const blockUid = await block.getAttribute('data-block-uid');
    if (blockUid) {
      const bridgeSchema = await block.evaluate(
        (_el, uid) => (window as any).__hydraBridge?.getBlockSchema?.(uid) || null,
        blockUid,
      );
      if (bridgeSchema?.properties) blockSchema = bridgeSchema;
    }
  }

  // Every schema-declared slate field needs a [data-edit-text="<field>"]
  // container in the rendered DOM — with content directly, and when empty after
  // the editor's reveal gesture (#296: empty means absent, so an empty field is
  // reached by revealing it, not by the renderer drawing an element anyway).
  // Without a schema, fall back to detecting slate shapes in populated data.
  let slateFields: string[];
  let slateHasValue: (field: string) => boolean;
  if (blockSchema?.properties) {
    slateFields = Object.entries(blockSchema.properties)
      .filter(([, prop]) => (prop as Record<string, unknown>)?.widget === 'slate')
      .map(([field]) => field);
    slateHasValue = (field) => {
      const v = blockData[field];
      return Array.isArray(v) && v.length > 0;
    };
  } else {
    slateFields = findSlateFields(blockData);
    slateHasValue = () => true;
  }

  const blockType = (blockData?.['@type'] as string | undefined) ?? '(unknown)';
  const coverageUid = (await block.getAttribute('data-block-uid')) ?? '(no uid)';

  // ONE search for the block's editable fields (see editableFieldsIn), then the
  // per-field questions are set lookups. Anything absent may simply be an empty
  // optional field, which renders no element until the editor reveals it
  // (#296), so the misses go to a single reveal press below.
  // What this block SHOULD be able to edit on the canvas — slate fields plus the
  // media/link fields their widgets ask for. Gathered before either loop so the
  // one settle below covers every kind.
  const annotatedFields: Array<[string, { kind: 'text' | 'media' | 'link'; attr: string }, unknown]> = [];
  for (const [field, prop] of Object.entries(blockSchema?.properties ?? {})) {
    const a = annotationFor(prop as Record<string, unknown>);
    if (a) annotatedFields.push([field, a, prop]);
  }
  const expected: Array<[string, string]> = [
    ...slateFields.map((f) => ['data-edit-text', f] as [string, string]),
    ...annotatedFields.map(([f, a]) => [a.attr, f] as [string, string]),
  ];

  const look = async () => {
    const f = await settleAnnotations(block, await editableFieldsIn(block), expected);
    return {
      found: f,
      present: namesByAttr(f),
      revealable: await revealableFieldsOf(block),
      advertised: await advertisedFieldsOf(block),
    };
  };
  let { found, present, revealable, advertised } = await look();

  // Everything the editor would do to make this block's fields editable — see
  // makeEditable. Anything still missing afterwards is genuinely missing.
  const missing = () =>
    slateFields.some(
      (f) => !present['data-edit-text'].has(f) && !revealable.has(f),
    );
  if (missing() && (await makeEditable(block, blockData, iframe))) {
    ({ found, present, revealable, advertised } = await look());
  }

  for (const field of slateFields) {
    // Accept either a descendant [data-edit-text="<field>"] OR the block
    // element itself carrying the attribute (renderers are free to collapse
    // the block wrapper and the edit-text container onto one element).
    const blockHasAttr = (await block.getAttribute('data-edit-text')) === field;
    // From the one search — no second look, and so no chance of a different
    // answer than the coverage question just got.
    const foundField = found.find((f) => f.attr === 'data-edit-text' && f.field === field);
    const hasContainer =
      !!foundField || present['data-edit-text'].has(field) || revealable.has(field);
    const container = foundField
      ? foundField.element
      : blockHasAttr
        ? block
        : block.locator(`[data-edit-text="${field}"]`).first();

    // Record editability rather than failing per-instance: a slate field only
    // needs its edit container in ONE example of a block type. Some fields are
    // gated by an optional synced element (e.g. a card's `description` behind
    // the grid's `copy` element) and legitimately don't render in every
    // example. A final aggregate test (slateFieldsNeverEditable) fails only if
    // a field is never editable in ANY example. On a miss, capture which
    // data-edit-text values ARE present for the aggregate's diagnostic.
    // The block may say the field lives somewhere else. `data-block-selector`
    // "<uid>#<field>" is the frontend declaring which control reaches it, and
    // for cookieConsent that is the whole story: design system JavaScript draws
    // the banner into <body>, and in the editor the block itself renders a
    // stand-in with no field in it at all. The annotation is real and the author
    // can reach it; it is simply not a descendant of this element.
    //
    // The sibling recording path already accepted that (a field is editable if
    // present OR revealable OR advertised). This one did not, so a slate field
    // drawn elsewhere still read as uneditable everywhere — which is exactly
    // what `cookieConsent.message` kept reporting after the first fix.
    if (!hasContainer && advertised.has(field)) {
      recordSlateFieldContainer(blockType, field, true, `[${coverageUid}] advertised`);
      continue;
    }
    if (!hasContainer) {
      const context = await block.evaluate((el) => {
        const outer = (el.outerHTML || '').slice(0, 200);
        const self = el.getAttribute('data-edit-text');
        const descendants = Array.from(el.querySelectorAll('[data-edit-text]'))
          .map((d) => `${d.tagName.toLowerCase()}[data-edit-text="${d.getAttribute('data-edit-text')}"]`);
        return { outer, self, descendants };
      });
      recordSlateFieldContainer(
        blockType,
        field,
        false,
        `[${coverageUid}] absent even after pressing reveal; own data-edit-text: ${context.self ?? '(none)'}; ` +
          `descendants: ${context.descendants.length ? context.descendants.join(', ') : '(none)'}; ` +
          `html: ${context.outer}`,
      );
      continue;
    }
    recordSlateFieldContainer(blockType, field, true, `[${coverageUid}]`);

    // Empty/null slate fields have the edit-text container (checked above) but
    // nothing to round-trip — the renderer has no source value to mirror into
    // the DOM.
    if (!slateHasValue(field)) continue;

    // Round-trip via the bridge's own DOM→Slate reader. The bridge already
    // walked its formData with addNodeIds — use bridge.getBlockData(uid)[field]
    // as the existingValue so domNodeToSlate's metadata lookup finds the ids
    // that match the DOM (otherwise `type` drops out of the round-tripped
    // result). Wait for bridge + data-node-id on the DOM before reading.
    const blockUid = await block.getAttribute('data-block-uid');
    const domValue = await container.evaluate(async (el, args) => {
      const { uid, fieldName } = args as { uid: string | null; fieldName: string };
      const hasId = (root: Element) =>
        root.hasAttribute('data-node-id') || !!root.querySelector('[data-node-id]');
      for (let i = 0; i < 50; i++) {
        const b = (window as any).__hydraBridge;
        if (b?.readSlateValueFromDOM && b?.getBlockData && hasId(el)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const bridge = (window as any).__hydraBridge;
      if (!bridge?.readSlateValueFromDOM) return { error: 'bridge not available on window.__hydraBridge after 5s' };
      if (!hasId(el)) return { error: 'no data-node-id rendered after 5s — renderer is not forwarding node ids' };
      const existingValue = uid ? bridge.getBlockData(uid)?.[fieldName] : undefined;
      if (!existingValue) return { error: `bridge.getBlockData(${uid})?.${fieldName} is missing — bridge hasn't delivered data or block is nested outside the bridge's map` };
      try {
        return { value: bridge.readSlateValueFromDOM(el, existingValue) };
      } catch (e: any) {
        return { error: `readSlateValueFromDOM threw: ${e?.message || String(e)}` };
      }
    }, { uid: blockUid, fieldName: field });
    const existing = blockData[field];

    if ((domValue as any).error) {
      const dom = await container.evaluate((el) => (el.outerHTML || '').slice(0, 200));
      throw new Error(
        `Slate field "${field}" round-trip failed: ${(domValue as any).error}\n` +
          `  container outerHTML (truncated): ${dom}`,
      );
    }
    if (!slateEqualIgnoringIds((domValue as any).value, existing)) {
      const dom = await container.evaluate((el) => (el.outerHTML || '').slice(0, 300));
      throw new Error(
        `Slate field "${field}" DOM does not round-trip to the same Slate value.\n` +
          `  Diff (first 400 chars each):\n` +
          `    Got:      ${JSON.stringify((domValue as any).value).slice(0, 400)}\n` +
          `    Expected: ${JSON.stringify(existing).slice(0, 400)}\n` +
          `  container outerHTML (truncated): ${dom}\n` +
          `  Likely causes: renderer missing data-node-id on some nodes; stray whitespace in template between sibling slate nodes; renderer emitting wrong element tag.`,
      );
    }
  }

  // Media (data-edit-media) and link (data-edit-link) fields get the SAME
  // aggregate coverage as slate: each must expose its edit annotation in AT LEAST
  // ONE example of its block type (an empty or gated example may legitimately omit
  // it, so this records rather than throws — the aggregate fails only if a field
  // is editable in NO example). Excluded on purpose: bare text/string fields
  // (sidebar-only attribute fields like an image block's `alt` → the <img alt>
  // attribute) AND `textarea` — sanity discovery proved textareas are not
  // uniformly canvas content (a code block's `code` and a form's `send_message`
  // are edited in the sidebar), so widget alone can't promise inline editability
  // for them. Displayed plain text is covered by the DOM-gated check above; slate
  // (always canvas rich-text) is recorded by the loop above.
  if (blockSchema?.properties) {
    for (const [field, a, prop] of annotatedFields) {
      recordFieldEditable(
        a.kind,
        blockType,
        field,
        // Three ways a field is genuinely reachable: its annotation is in the
        // block; it is an empty optional field with nothing yet to annotate; or
        // the block advertises a control that reaches it, because the element
        // itself is drawn outside the block by design system JavaScript.
        present[a.attr].has(field) ||
          revealable.has(field) ||
          advertised.has(field),
        `[${coverageUid}] widget=${(prop as { widget?: string })?.widget}`,
      );
    }
  }
}

export interface VerifyBlockRenderingOptions {
  expectedText?: string | null;
  isListing?: boolean;
  checkSubBlocks?: boolean;
  checkEditTextClicks?: boolean;
}

/**
 * Schema-INDEPENDENT coverage check: every block/field the frontend actually
 * renders as editable must be known to the bridge's blockPathMap.
 *
 * `checkSubBlocks` walks the OTHER direction (pathMap → DOM: "is every block
 * the pathMap knows about rendered?"). That direction is blind to an
 * incomplete schema: if a frontend registers e.g. `slateTable` with an empty
 * schema, buildBlockPathMap can't see `table → rows → cells`, so the cells are
 * simply ABSENT from the pathMap — yet the frontend still renders them from
 * data. pathMap → DOM then iterates nothing and passes, while the cells are
 * un-selectable / un-editable / un-navigable (no pathInfo → parentAddMode
 * undefined, field type unresolved). That is precisely how an incomplete
 * schema slipped through to a silent table-navigation failure.
 *
 * This check closes the gap by walking DOM → pathMap: for the rendered block
 * subtree, assert every nested `[data-block-uid]` has a pathMap entry. It needs
 * no blocksConfig — it reads the live bridge — so it runs in CI unconditionally
 * (unlike the schema-driven discovery checks, which are gated on MOCK_PARENT_URL
 * and traverse schema-first, so they can't see missing nested structure).
 *
 * Scope, to stay false-positive-free:
 *  - Only rendered `[data-block-uid]`s are checked (a concrete "this is an
 *    editable block" signal). We deliberately do NOT flag unresolved
 *    `data-edit-*` fields: page-level fields (`/title`) and listing-projected
 *    block fields (a teaser inside a grid) legitimately render edit
 *    annotations that aren't in THIS block's editable pathMap.
 *  - Read-only subtrees (`data-block-readonly` — listing results, teasers) are
 *    skipped: their inner markup is projected content, not editable blocks.
 *  - Items that reuse the parent's uid (listing expansion) are skipped.
 */
export async function verifyPathMapCoverage(
  iframe: FrameLocator,
  blockId: string,
): Promise<void> {
  const block = iframe.locator(`[data-block-uid="${blockId}"]`).first();
  const orphans = await block.evaluate((el, parentUid) => {
    const b = (window as any).__hydraBridge;
    // No bridge (e.g. a pure render harness) → nothing to assert against.
    if (!b?.blockPathMap) return null;
    const pathMap = b.blockPathMap;

    // No dynamic-container exemptions. search/listing/contextNavigation used
    // to be skipped wholesale ("async-fetched results are a different
    // editability model"), which is how "search wasn't getting sanity
    // checked" happened — the reveal work (#330) closed the reachability
    // hole, and the tolerances below already cover what dynamic expansion
    // legitimately renders: expanded items REUSE their container's uid, and
    // projected subtrees carry data-block-readonly. Anything else with a uid
    // must resolve in the pathMap, dynamic container or not.

    const found: string[] = [];
    el.querySelectorAll('[data-block-uid]').forEach((child: Element) => {
      const uid = child.getAttribute('data-block-uid');
      // Skip self, listing-expanded items reusing the parent uid, and read-only
      // (projected) subtrees.
      if (!uid || uid === parentUid) return;
      if (child.closest('[data-block-readonly]')) return;
      if (!pathMap[uid]) found.push(uid);
    });
    return Array.from(new Set(found));
  }, blockId);

  if (orphans === null) return; // no bridge

  expect(
    orphans,
    `Blocks rendered inside "${blockId}" but ABSENT from the pathMap — they can't be ` +
      `selected, edited, moved or navigated. This means their container field isn't ` +
      `declared (or is incompletely declared) in the frontend's block schema, so ` +
      `buildBlockPathMap never descended into it: ${orphans.join(', ')}`,
  ).toEqual([]);
}

/**
 * Full block rendering verification: locate block, check text, check edit
 * annotations, verify sub-blocks, and click data-edit-text elements.
 *
 * Schema + sub-block discovery come from the bridge's blockPathMap inside
 * the iframe — no blocksConfig plumbing needed. Callers must render the
 * block through an iframe with `initBridge()` already run.
 */
export async function verifyBlockRendering(
  page: Page,
  iframe: FrameLocator,
  blockId: string,
  blockData: Record<string, unknown> | undefined,
  options: VerifyBlockRenderingOptions = {},
): Promise<void> {
  const {
    expectedText,
    isListing = false,
    checkSubBlocks = true,
    checkEditTextClicks: doEditTextClicks = true,
  } = options;

  // Listing blocks: expandListingBlocks sets @uid=parentId on all items,
  // so multiple elements share the same data-block-uid. The frontend
  // resolves items async (fetch + render), so we have to wait for the
  // count to STABILISE rather than reading it once — otherwise we race
  // the next item's render and assert on a stale snapshot. Two
  // consecutive same-value reads = stable.
  if (isListing) {
    const items = iframe.locator(`[data-block-uid="${blockId}"]`);
    await expect(items.first()).toBeVisible({ timeout: 15000 });
    // Three consecutive equal reads, not "at least 2 items": the old n >= 2
    // floor assumed every listing shows several results, so a listing whose
    // QUERY yields one item (b_size=1 — a doc example showing one look) could
    // never pass. The streak is the streaming guard now — one read mid-stream
    // can catch a stale count, three equal reads across the ramping intervals
    // cannot.
    let prev = -1;
    let streak = 0;
    await expect.poll(async () => {
      const n = await items.count();
      streak = n === prev && n >= 1 ? streak + 1 : 0;
      prev = n;
      return streak >= 2;
    }, { timeout: 15000, intervals: [200, 400, 800] }).toBe(true);
    await checkEditAnnotations(items.first(), blockData);
    return;
  }

  // Wait for block to render in iframe.
  //
  // Some blocks have no fields of their own — they only project page-level
  // metadata (title, description, leadimage, etc.). When that metadata is
  // empty the frontend may legitimately omit the wrapper rather than
  // render a zero-height invisible div. Detect this from blockData shape:
  // a block whose only keys are @type plus template-system fields has no
  // own content, so its render depends entirely on page-level data and
  // "absent on empty data" is a correct outcome, not a renderer bug.
  const TEMPLATE_SYSTEM_KEYS = new Set([
    '@type',
    'fixed',
    'readOnly',
    'templateId',
    'templateInstanceId',
    'slotId',
  ]);
  const isFieldlessBlock = blockData
    && Object.keys(blockData).every((k) => TEMPLATE_SYSTEM_KEYS.has(k));

  const block = iframe.locator(`[data-block-uid="${blockId}"]`);
  if (isFieldlessBlock && (await block.count()) === 0) {
    return; // metadata-projection block legitimately rendered nothing
  }
  // A block can be rendered but off-stage — an inactive carousel slide, a
  // closed tab. That is not a render failure: the editor reaches it by
  // selecting it, and hydra's tryMakeBlockVisible steps the container until it
  // shows. Ask for the same thing here before demanding visibility, or the
  // check fails on content an author can reach perfectly well.
  await revealBlock(iframe, blockId);
  await expect(block.first()).toBeVisible({ timeout: 15000 });

  // A data-block-uid may legitimately match several elements, in two shapes that
  // hydra both supports:
  //  - NESTED: a listing/container block whose expanded items carry the parent
  //    uid (expandListingBlocks — see listing-links.tsx), the items inside it; and
  //  - SIBLING: a multi-element block whose uid rides more than one peer element
  //    (e.g. accordion/tabs: the panel uid is on both the header and its content
  //    panel), which hydra's selection unions into one outline — see
  //    tests-playwright/integration/multi-element-blocks.spec.ts.
  // We don't assert DOM shape (nested vs sibling): both are intended, and the DOM
  // alone can't tell an intentional multi-element block from an accidental
  // duplicate anyway. Verify the block renders + carries its edit annotations via
  // the first match, then return — the assertions below use the multi-match
  // `block` locator and would trip Playwright strict mode on >1 element.
  if ((await block.count()) > 1) {
    await checkEditAnnotations(block.first(), blockData);
    return;
  }

  // Verify expected text content renders
  if (expectedText) {
    await expect(block).toContainText(expectedText);
  }

  // Verify edit annotations
  await checkEditAnnotations(block, blockData);

  // Schema-driven slate check — checkSlateAnnotations pulls the schema
  // from the bridge itself (authoritative, schemaEnhancer-resolved).
  await checkSlateAnnotations(block, blockData, undefined, iframe);

  // Schema-INDEPENDENT coverage: every rendered nested block + editable field
  // must be known to the pathMap. Catches incomplete frontend schemas that the
  // schema-driven checks (disabled in CI, and blind to gaps they have no
  // schema path into) can't — e.g. a slateTable whose cells render but are
  // absent from the pathMap. Runs off the live bridge, so it needs no config.
  await verifyPathMapCoverage(iframe, blockId);

  // Verify sub-blocks (before clicking, which may toggle interactive
  // containers like accordions closed). Sub-blocks come from the bridge's
  // blockPathMap — canonical nested-block tree with schema-driven
  // container traversal (blocks_layout and object_list handled uniformly).
  if (checkSubBlocks && blockData) {
    const subBlocks = await block.evaluate((_el, parentUid) => {
      const b = (window as any).__hydraBridge;
      if (!b?.blockPathMap) {
        throw new Error(
          'verifyBlockRendering: __hydraBridge.blockPathMap not available — ' +
            'the block must be rendered inside an iframe with initBridge() run.',
        );
      }
      const pathMap = b.blockPathMap;
      const isDescendant = (uid: string): boolean => {
        let cur = pathMap[uid]?.parentId;
        while (cur) {
          if (cur === parentUid) return true;
          cur = pathMap[cur]?.parentId;
        }
        return false;
      };
      return Object.keys(pathMap)
        .filter((k) => !k.startsWith('_') && isDescendant(k))
        .map((uid) => ({ id: uid, data: b.getBlockData?.(uid) || null }))
        .filter((s: { id: string; data: unknown }) => !!s.data && typeof s.data === 'object');
    }, blockId) as SubBlock[];

    let anyVisible = false;
    for (const { id, data } of subBlocks) {
      const loc = iframe.locator(`[data-block-uid="${id}"]`).first();
      // A query-gated child has no element until its question is asked —
      // reveal FIRST (revealBlock knows how to ask), then require attachment.
      if ((await loc.count()) === 0) {
        await revealBlock(iframe, id);
      }
      await expect(loc).toBeAttached({ timeout: 5000 });
      // Content gated behind a reveal control — an accordion header, a tab, a
      // carousel nav — is display:none until revealed. That's by design: the
      // editor reveals it when the admin selects the nested block, and hydra.js
      // does so by clicking the element whose [data-block-selector] references
      // that block's uid. Mirror that here so a legitimately-collapsed block is
      // verified in its revealed state instead of being falsely failed for being
      // hidden by design. (data-block-selector holds a space-separated uid list,
      // hence the ~= match.)
      if (!(await loc.isVisible())) {
        const revealer = iframe
          .locator(`[data-block-selector~="${id}"]`)
          .first();
        if ((await revealer.count()) > 0) {
          await revealer.click();
          await loc
            .waitFor({ state: 'visible', timeout: 2000 })
            .catch(() => {});
        }
      }
      if (await loc.isVisible()) {
        anyVisible = true;
        await checkEditAnnotations(loc, data);
        await checkSlateAnnotations(loc, data, undefined, iframe);
      }
    }
    if (subBlocks.length > 0) {
      expect(anyVisible).toBe(true);
    }
  }

  // Click each data-edit-text and verify no "Missing data-node-id" warning appears
  if (doEditTextClicks) {
    await checkDataEditTextClicks(page, iframe, block);
  }
}
