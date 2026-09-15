/**
 * Helper class for interacting with Volto Hydra admin UI in tests.
 */
import { Page, Locator, FrameLocator, expect, ElementHandle } from '@playwright/test';
import { TEST_DATA_PREFIX } from './test-paths';
import { showCaption, clearCaption } from './caption';
import { URLS } from '../ports';
import { randomUUID } from 'node:crypto';

// Base test JWT — the mock API only checks for the "Bearer " prefix, never
// validates. sub=admin, exp=4102444800 (2100-01-01). Each AdminUIHelper
// appends a unique suffix (see `authToken`) so every test gets its own
// mock-api session — the mock keys session content by the Bearer token.
export const TEST_AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImV4cCI6NDEwMjQ0NDgwMH0.fake-signature';

export class AdminUIHelper {
  // Per-test auth token. The mock API keys its session content store by
  // the Bearer token (getSessionId), so a shared token collapses every
  // test into one session — saves in one test then leak into others
  // running in parallel. A unique token per AdminUIHelper instance (one
  // per test) gives each test its own isolated mock-api session.
  readonly authToken = `${TEST_AUTH_TOKEN}-${randomUUID()}`;

  // Opt-in demo pacing: recorded demos set this (e.g. 1200) so viewport-branching
  // steps that flash by — the mobile settings sheet opening/closing — linger long
  // enough to read. Default 0: functional tests are completely unaffected.
  demoPacingMs = 0;

  constructor(
    public readonly page: Page,
    public readonly adminUrl: string = URLS.voltoSsr,
    public readonly contentPrefix: string = TEST_DATA_PREFIX
  ) {
    // Capture browser console - all logs locally, only errors/warnings in CI
    this.page.on('console', (msg) => {
      const type = msg.type();
      if (process.env.CI) {
        // CI: only errors and warnings
        if (type === 'error' || type === 'warning') {
          console.log(`[BROWSER ${type.toUpperCase()}] ${msg.text()}`);
        }
      } else {
        // Local: all console output for debugging
        console.log(`[${type}] ${msg.text()}`);
      }
    });

    // Enable View.jsx debug logging (checked at module load time)
    this.page.addInitScript(() => {
      (window as any).HYDRA_DEBUG = true;
    });

    // Capture page errors
    this.page.on('pageerror', (error) => {
      console.log(`[BROWSER PAGE ERROR] ${error.message}`);
      console.log(error.stack);
    });

    // Log only failed requests (status >= 400)
    this.page.on('response', async (response) => {
      const status = response.status();
      if (status >= 400) {
        const url = response.url();
        console.log(`[NETWORK ERROR] ${response.request().method()} ${status} ${url}`);
        try {
          const body = await response.text();
          if (body) {
            console.log(`[ERROR BODY]:`, body.substring(0, 500));
          }
        } catch (e) {
          console.log(`[ERROR] Could not read response body:`, e.message);
        }
      }
    });

    // Global opt-in demo pacing: `DEMO_PACING=1200` enables paced, cursor-visible
    // gestures across every recorded-demo spec without per-spec wiring. A spec
    // may still override by assigning `helper.demoPacingMs` directly. Default 0
    // → functional tests (and hydra's own suite) are completely unaffected.
    if (process.env.DEMO_PACING) {
      this.demoPacingMs = Number(process.env.DEMO_PACING) || 0;
    }
  }

  /**
   * Demo pacing step: when demoPacingMs>0 (recorded demos), move the (visible)
   * cursor to `target` and pause so the action reads on video. No-op in
   * functional runs (demoPacingMs===0), so nothing else is affected.
   */
  private async demoStep(target?: Locator): Promise<void> {
    if (!this.demoPacingMs) return;
    if (target) {
      // Best-effort cursor move — hover auto-scrolls the target into view and is
      // BOUNDED (timeout + catch). A bare scrollIntoViewIfNeeded is NOT bounded
      // and hangs forever on a just-opened/animating container (e.g. the card
      // grid's "Card Defaults" accordion), so it must not be used here.
      await target.hover({ timeout: 1500 }).catch(() => {});
    }
    await this.page.waitForTimeout(this.demoPacingMs);
  }

  /**
   * Set a react-select Choice field by CLICK — open the control, then click the
   * option by its visible label — rather than keyboard filter+Enter. Click-based
   * so it reads clearly on video AND avoids the `fill`+Enter races (e.g. a
   * mid-word "Methodpproach"). `field` is the schema field id; defaults to the
   * sidebar properties form.
   */
  async setChoiceField(
    field: string,
    optionLabel: string,
    options: { container?: string; multi?: boolean } = {}
  ): Promise<void> {
    const base = options.container ?? '#sidebar-properties';
    // Close any stray-open react-select menu first — some Choice fields auto-open
    // their menu on focus (the card grid's colour field does), and its floating
    // options would intercept the click on THIS field. Blur closes it (NOT
    // Escape — hydra treats that as step-up/deselect).
    await this.page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur?.()
    );
    // Some blocks (the card grid) render their fieldset TWICE, so a plain
    // .first() can grab a HIDDEN copy whose control never becomes clickable
    // (a 240s hang). Scope everything to the VISIBLE field-wrapper.
    const fieldWrap = this.page
      .locator(`${base} .field-wrapper-${field}:visible`)
      .first();
    const control = fieldWrap.locator('.react-select__control');
    // demoStep hovers (bounded); control.click() auto-scrolls into view.
    await this.demoStep(control);
    await control.click();
    // The open menu is a singleton (only one react-select is open at a time) and
    // is NOT always a DOM descendant of its field-wrapper, so find it at page
    // level.
    const menu = this.page.locator('.react-select__menu');
    // control.click() TOGGLES the menu. If the field started already-open (a
    // prior focus can leave a react-select open), our click just closed it — so
    // wait briefly, and if it didn't open, click again to (re)open.
    try {
      await menu.waitFor({ state: 'visible', timeout: 1500 });
    } catch {
      await control.click();
      await menu.waitFor({ state: 'visible', timeout: 5000 });
    }
    // react-select renders each option as a `.react-select__option` div (no
    // role="option"). Match the exact label with an anchored regex so e.g.
    // "Off white" doesn't also match "Off white highlight". Scope to this menu.
    // Match the option tolerantly: exact first (case-insensitive — some Choice
    // options render their raw value like "none" not the label "None"), then a
    // prefix fallback so a short caller label matches a verbose option (e.g.
    // "Box" → "Box (rounded, bordered)").
    const escaped = optionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const opts = menu.locator('.react-select__option');
    let option = opts
      .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') })
      .first();
    if ((await option.count()) === 0) {
      option = opts
        .filter({ hasText: new RegExp(`^\\s*${escaped}\\b`, 'i') })
        .first();
    }
    // Fail loudly with what the open menu actually offers, instead of a mystery
    // timeout, if the label still isn't present.
    if ((await option.count()) === 0) {
      const offered = await opts.allInnerTexts();
      throw new Error(
        `setChoiceField('${field}', '${optionLabel}'): not offered by the open menu. Offered: [${offered.join(' | ')}]`
      );
    }
    // Wait for it in the DOM, then let click() auto-scroll it into the menu's
    // viewport (a long option list can keep an option attached-but-not-visible).
    await option.waitFor({ state: 'attached', timeout: 5000 });
    await option.scrollIntoViewIfNeeded().catch(() => {});
    await this.demoStep(option);
    await option.click();
    // A multi-select keeps its menu OPEN after a pick (so you can add more), so
    // blur to close it (NOT Escape — hydra reads that as step-up/deselect). A
    // single-select closes on pick.
    if (options.multi) {
      await this.page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur?.()
      );
    }
    await expect(menu).toHaveCount(0, { timeout: 5000 });
  }

  /**
   * Set a ButtonsWidget field (size/align/layout, …) by CLICK, matching the
   * hidden radio's `value`. Paced for demos.
   */
  async setButtonsField(
    field: string,
    value: string,
    options: { container?: string } = {}
  ): Promise<void> {
    const base = options.container ?? '#sidebar-properties';
    const btn = this.page
      .locator(
        `${base} .field-wrapper-${field} .buttons-widget-option:has(input[value="${value}"])`
      )
      .first();
    await btn.scrollIntoViewIfNeeded();
    await this.demoStep(btn);
    await btn.click();
  }

  /**
   * Type into an inline-editable canvas field (a [data-edit-text] element or a
   * contenteditable). Click to place the caret; when `replace`, triple-click to
   * select the existing text VISIBLY (not Ctrl-A) so the overwrite reads on
   * video. Typing is slowed in demo mode.
   */
  async typeInlineText(
    target: Locator,
    text: string,
    options: { replace?: boolean } = {}
  ): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    await this.demoStep(target);
    await target.click();
    if (options.replace) {
      await target.click({ clickCount: 3 });
      await this.page.waitForTimeout(this.demoPacingMs ? 200 : 30);
    }
    await this.page.keyboard.type(text, { delay: this.demoPacingMs ? 55 : 20 });
  }

  /**
   * Get combined bounding box for a locator that may match multiple elements.
   * For multi-element blocks (e.g., listing blocks), computes the union of all rects.
   *
   * @param mode - 'combined' for union of all, 'first' for first element only, 'last' for last element only
   */
  private async getCombinedBoundingBox(
    locator: Locator,
    mode: 'combined' | 'first' | 'last' = 'combined'
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    return await locator.evaluateAll(
      (elements, m) => {
        if (elements.length === 0) {
          throw new Error('No elements found');
        }
        if (elements.length === 1 || m === 'first') {
          const r = elements[0].getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        if (m === 'last') {
          const r = elements[elements.length - 1].getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        // Combined mode - compute union of all bounding boxes
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const el of elements) {
          const r = el.getBoundingClientRect();
          minX = Math.min(minX, r.left);
          minY = Math.min(minY, r.top);
          maxX = Math.max(maxX, r.right);
          maxY = Math.max(maxY, r.bottom);
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      },
      mode
    );
  }

  /**
   * Log in to the Volto admin UI.
   */
  async login(): Promise<void> {
    // Set the auth_token cookie. Volto SSR reads this cookie and forwards it
    // as Authorization: Bearer to the API, so page.goto() to any URL works.
    await this.page.context().addCookies([{
      name: 'auth_token',
      value: this.authToken,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }]);
  }

  /**
   * Build a full admin URL for a content path, e.g. contentUrl('/test-page', '/edit')
   * → '<adminUrl>/_test_data/test-page/edit'
   */
  contentUrl(contentPath: string, suffix: string = ''): string {
    return `${this.adminUrl}${this.contentPrefix}${contentPath}${suffix}`;
  }

  /**
   * Navigate to the edit page for a piece of content.
   * Goes directly via page.goto() — Volto SSR reads the auth_token cookie
   * and forwards it as Authorization: Bearer to the API.
   * If already on a Volto page, uses client-side navigation (faster).
   */
  async navigateToEdit(contentPath: string): Promise<void> {
    // Ensure path starts with /
    if (!contentPath.startsWith('/')) {
      contentPath = '/' + contentPath;
    }
    // Prepend content prefix (e.g., /_test_data) for test content paths
    contentPath = `${this.contentPrefix}${contentPath}`;

    const editPath = `${contentPath}/edit`;
    const currentUrl = this.page.url();
    const isOnVoltoPage = currentUrl.startsWith(this.adminUrl);

    if (isOnVoltoPage) {
      // Already on a Volto page — use client-side navigation (no SSR round-trip).
      // connected-react-router's history library listens for popstate events.
      await this.page.evaluate((path) => {
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, editPath);
    } else {
      // First navigation — go directly to the edit URL.
      await this.page.goto(`${this.adminUrl}${editPath}`, { timeout: 60000 });
    }

    // Wait for the URL to change
    await this.page.waitForURL(`${this.adminUrl}${editPath}`, { timeout: 10000 });

    // Wait for iframe to navigate to the correct content path.
    // Without this, waitForIframeReady can pass on stale content from the
    // previous page (e.g., docs root blocks satisfy [data-block-uid] check).
    await this.waitForIframeUrl(contentPath);

    // Wait for iframe to load
    await this.waitForIframeReady();

    // Edit mode is only usable once the bridge connects. Fail fast (with the
    // real diagnostic) if it doesn't, instead of proceeding into a dead editor.
    await this.waitForBridgeConnected();

    // Wait for all blocks to render (Nuxt async components may still be loading)
    await this.getStableBlockCount();
  }

  /**
   * Enter edit mode by clicking the toolbar Edit link (Volto's React-Router
   * `<Link to="{path}/edit" className="edit">`) — an in-place SPA transition FROM
   * the current view page. The admin does NOT reload; only the preview iframe
   * re-navigates to `?_edit=true` (~0.6s blank, measured). Prefer this over
   * navigateToEdit when you're already viewing the page and want the real
   * view→edit transition to stay fast + on-camera: navigateToEdit's on-Volto path
   * pushStates a malformed `//edit` for the ROOT (SecurityError), so callers drop
   * to about:blank + a full page.goto that re-boots the whole admin (seconds). The
   * actual Edit link routes correctly for the root too, so none of that is needed.
   */
  async enterEditInPlace(contentPath: string): Promise<void> {
    if (!contentPath.startsWith('/')) contentPath = '/' + contentPath;
    contentPath = `${this.contentPrefix}${contentPath}`;

    const editLink = this.page.locator('a.edit').first();
    await editLink.waitFor({ state: 'visible', timeout: 10000 });
    await editLink.click();

    // Volto's Edit link routes to `${path}/edit`; for the ROOT that's `/edit`
    // (path=''), so don't build `${contentPath}/edit` (='//edit' for root) and
    // string-match it. Match the normalised pathname ending in /edit instead.
    await this.page.waitForURL(
      (u) => /\/edit\/?$/.test(new URL(u).pathname.replace(/\/{2,}/g, '/')),
      { timeout: 10000 },
    );
    await this.waitForIframeUrl(contentPath);
    await this.waitForIframeReady();
    await this.waitForBridgeConnected();
    await this.getStableBlockCount();
  }

  /**
   * After entering edit mode, assert the Hydra bridge actually connected.
   *
   * hydra.js paints a "Hydra Bridge: Not Connected" overlay
   * (#hydra-bridge-diagnostic) when it's loaded in an edit iframe but
   * initBridge() was never called (or INITIAL_DATA never arrived) — see
   * hydra.src.js _showBridgeDiagnostic. But that overlay only appears after a
   * 5s idle timeout, long after a typical test has torn down, so nothing
   * actually catches it. This is the immediate, positive form of that same
   * check: it waits for the bridge to report `initialized` (INITIAL_DATA
   * received), and on timeout throws the same facts the overlay would show, so
   * a broken edit boot fails fast with a clear message instead of surfacing
   * later as a confusing "block was clicked but nothing got selected" timeout.
   */
  async waitForBridgeConnected(timeout: number = 15000): Promise<void> {
    const iframe = this.getIframe();
    const body = iframe.locator('body');
    try {
      await expect(async () => {
        const initialized = await body.evaluate(
          () => (window as any).__hydraBridge?.initialized === true,
        );
        expect(initialized).toBe(true);
      }).toPass({ timeout });
    } catch {
      // Bridge never connected — gather the same facts hydra's overlay reports.
      const info = await body.evaluate(() => {
        const b = (window as any).__hydraBridge;
        return {
          windowName: window.name || '(empty)',
          bridgeCreated: !!b,
          initialized: b?.initialized === true,
          adminOrigin: b?.adminOrigin || null,
        };
      });
      const overlayPresent =
        (await iframe.locator('#hydra-bridge-diagnostic').count()) > 0;
      const hint = !info.bridgeCreated
        ? 'hydra.js was imported but initBridge() was never called — the frontend must call initBridge() in edit mode.'
        : 'INIT was sent but the admin never responded with INITIAL_DATA — check adminOrigin matches the parent origin.';
      throw new Error(
        'Hydra bridge did not connect after entering edit mode ' +
          '(the "Hydra Bridge: Not Connected" condition). ' +
          `window.name="${info.windowName}", initBridge called=${info.bridgeCreated}, ` +
          `INITIAL_DATA received=${info.initialized}, adminOrigin=${info.adminOrigin}, ` +
          `diagnostic overlay present=${overlayPresent}. ${hint}`,
      );
    }
  }

  /**
   * Navigate to a content page in view mode (not editing).
   * Goes directly via page.goto() or client-side navigation if already on Volto.
   */
  async navigateToView(contentPath: string): Promise<void> {
    // Ensure path starts with /
    if (!contentPath.startsWith('/')) {
      contentPath = '/' + contentPath;
    }
    // Prepend content prefix (e.g., /_test_data) for test content paths
    contentPath = `${this.contentPrefix}${contentPath}`;

    const currentUrl = this.page.url();
    const isOnVoltoPage = currentUrl.startsWith(this.adminUrl);

    // Navigate to edit mode first (reliable), then switch to view.
    // Direct pushState to view mode triggers Volto SSR which may crash
    // with "window is not defined" on pages with iframe components.
    if (isOnVoltoPage) {
      await this.page.evaluate((path) => {
        window.history.pushState({}, '', path + '/edit');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, contentPath);
      await this.page.waitForURL(`${this.adminUrl}${contentPath}/edit`, { timeout: 10000 });
      // Switch to view mode
      await this.page.evaluate((path) => {
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, contentPath);
    } else {
      await this.page.goto(`${this.adminUrl}${contentPath}`, { timeout: 60000 });
    }

    // Wait for the URL to change
    await this.page.waitForURL(`${this.adminUrl}${contentPath}`, { timeout: 10000 });

    // Wait for iframe to navigate to the correct content path.
    await this.waitForIframeUrl(contentPath);

    // Wait for iframe to load
    await this.waitForIframeReady();

    // Wait for all blocks to render (Nuxt async components may still be loading)
    await this.getStableBlockCount();
  }

  /**
   * Wait for the preview iframe's src to contain the expected content path.
   * Prevents waitForIframeReady from passing on stale content from a previous
   * page (e.g., docs root blocks satisfy [data-block-uid] before the iframe
   * has navigated to the new page).
   */
  async waitForIframeUrl(contentPath: string, timeout: number = 10000): Promise<void> {
    await expect(async () => {
      const src = await this.page.locator('#previewIframe').getAttribute('src');
      expect(src).toContain(contentPath);
    }).toPass({ timeout });
  }

  /**
   * Wait for the preview iframe to load.
   */
  async waitForIframeReady(timeout: number = 30000): Promise<void> {
    await this.page.waitForSelector('#previewIframe', {
      state: 'visible',
      timeout,
    });

    // Wait for iframe to have at least one block visible.
    // This ensures the frontend has actually rendered page content, not just
    // put elements in the DOM (e.g. Nuxt SSR before hydration).
    // Match ANY visible block-uid — picking `.first()` and waiting on its
    // visibility is fragile when the first block in DOM order is a templated
    // header/metadata block (e.g. tpl-ni-date) that ends up zero-height or
    // hidden, even though later blocks on the page are fully rendered.
    const iframe = this.getIframe();
    await iframe.locator('[data-block-uid]:visible').first().waitFor({ state: 'attached', timeout });

    // Propagate run ID from admin page to iframe for log filtering
    const runId = await this.page.evaluate(() => (window as any).__testRunId);
    if (runId != null) {
      await iframe.locator('body').evaluate((_, id) => {
        (window as any).__testRunId = id;
      }, runId);
    }

    // Wait for blocks to stabilize (avoid flaky tests due to partial renders)
    await this.getStableBlockCount();
  }

  /**
   * Get the preview iframe frame locator.
   */
  getIframe(): FrameLocator {
    return this.page.frameLocator('#previewIframe');
  }

  /**
   * Check if a block is hidden in the iframe.
   * Matches hydra.js's isElementHidden logic:
   * - display: none or visibility: hidden
   * - zero dimensions
   * - translated outside container bounds (e.g., Flowbite carousel)
   */
  async isBlockHiddenInIframe(blockId: string): Promise<boolean> {
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);

    return await block.evaluate((el) => {
      if (!el) return true;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return true;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return true;
      }
      // Check if element is translated/positioned outside its container
      const container = el.parentElement?.closest('[data-block-uid]');
      if (container) {
        const containerRect = container.getBoundingClientRect();
        if (rect.right <= containerRect.left || rect.left >= containerRect.right) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Inject the preserveWhitespaceDOM helper into the iframe.
   * This helper creates DOM while preserving whitespace text nodes that innerHTML would collapse.
   * Vue/Nuxt templates create these from newlines/indentation.
   *
   * After calling this, tests can use: (window as any).preserveWhitespaceDOM('<div>\\n  <p>text</p>\\n</div>')
   */
  async injectPreserveWhitespaceHelper(): Promise<void> {
    const iframe = this.getIframe();
    await iframe.locator('body').evaluate(() => {
      (window as any).preserveWhitespaceDOM = function(html: string): DocumentFragment {
        const fragment = document.createDocumentFragment();

        function parseHTML(htmlStr: string, parent: Node): string {
          let remaining = htmlStr;

          while (remaining.length > 0) {
            const tagStart = remaining.indexOf('<');

            if (tagStart === -1) {
              if (remaining.length > 0) {
                parent.appendChild(document.createTextNode(remaining));
              }
              break;
            }

            if (tagStart > 0) {
              const text = remaining.slice(0, tagStart);
              parent.appendChild(document.createTextNode(text));
              remaining = remaining.slice(tagStart);
            }

            if (remaining.startsWith('</')) {
              return remaining;
            }

            const tagEnd = remaining.indexOf('>');
            if (tagEnd === -1) break;

            const tagContent = remaining.slice(1, tagEnd);
            const selfClosing = tagContent.endsWith('/');
            const tagParts = (selfClosing ? tagContent.slice(0, -1) : tagContent).trim().split(/\s+/);
            const tagName = tagParts[0];

            const element = document.createElement(tagName);

            const attrStr = tagParts.slice(1).join(' ');
            const attrRegex = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
            let match;
            while ((match = attrRegex.exec(attrStr)) !== null) {
              element.setAttribute(match[1], match[2] || '');
            }

            parent.appendChild(element);
            remaining = remaining.slice(tagEnd + 1);

            if (!selfClosing) {
              remaining = parseHTML(remaining, element);
              const closeTag = `</${tagName}>`;
              if (remaining.startsWith(closeTag)) {
                remaining = remaining.slice(closeTag.length);
              }
            }
          }

          return remaining;
        }

        parseHTML(html, fragment);
        return fragment;
      };

      // Vue-style DOM helper: splits text nodes at whitespace boundaries and converts
      // whitespace-only segments to empty text nodes, matching Vue's template interpolation behavior
      // Vue creates: [empty ""][content][empty ""] from "<p>\n{{ text }}\n</p>"
      (window as any).vueStyleDOM = function(html: string): DocumentFragment {
        const fragment = (window as any).preserveWhitespaceDOM(html);

        // Walk all text nodes and split at whitespace/content boundaries
        const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
        const nodesToProcess: Text[] = [];
        let node;
        while ((node = walker.nextNode())) {
          nodesToProcess.push(node as Text);
        }

        nodesToProcess.forEach(textNode => {
          const text = textNode.textContent || '';
          // Match pattern: (leading whitespace)(content)(trailing whitespace)
          const match = text.match(/^(\s*)(.*?)(\s*)$/s);
          if (match) {
            const [, leading, content, trailing] = match;
            // Only split if there's actual content with surrounding whitespace
            if (content && (leading || trailing)) {
              const parent = textNode.parentNode;
              if (parent) {
                // Create replacement nodes: empty for whitespace, content as-is
                if (leading) {
                  parent.insertBefore(document.createTextNode(''), textNode);
                }
                parent.insertBefore(document.createTextNode(content), textNode);
                if (trailing) {
                  parent.insertBefore(document.createTextNode(''), textNode);
                }
                parent.removeChild(textNode);
              }
            } else if (!content && text) {
              // Whitespace-only node -> convert to empty
              textNode.textContent = '';
            }
          }
        });

        return fragment;
      };
    });
  }

  /**
   * Click on a block within the preview iframe.
   * Waits for the block to be selected (have the outline) after clicking.
   *
   * @param blockId - The data-block-uid of the block to click
   * @param options.waitForToolbar - If true (default), waits for Volto's quanta-toolbar.
   *                                  Set to false for mock parent tests where Volto isn't running.
   * @param options.selector - Optional selector within the block to click on a specific element.
   */
  async clickBlockInIframe(
    blockId: string,
    options: { waitForToolbar?: boolean; selector?: string } = {},
  ) {
    const { waitForToolbar = true, selector } = options;
    const iframe = this.getIframe();
    const blockLocator = iframe.locator(`[data-block-uid="${blockId}"]`);

    // Use first() for multi-element blocks (multiple elements with same UID)
    const block = blockLocator.first();

    // Wait for the block to appear in the DOM. This auto-retries, which is
    // essential for comment-syntax blocks (e.g. hero) where data-block-uid
    // is added asynchronously by materializeHydraComments after render.
    await block.waitFor({ state: 'attached', timeout: 10000 });

    // Determine click target - either specific selector within block, or block itself
    const clickTarget = selector ? block.locator(selector) : block;

    // Scroll click target into view inside the iframe first
    await clickTarget.scrollIntoViewIfNeeded();

    // Wait for click target to be visible
    await clickTarget.waitFor({ state: 'visible', timeout: 5000 });

    await this.demoStep(clickTarget);
    await clickTarget.click();

    if (waitForToolbar) {
      // Try to wait for the target block to be selected
      // If it times out, check if we need to navigate to parent (container case)
      try {
        await this.waitForIframeBlockHandle(blockId, 3000);
      } catch (error) {
        // Selection timed out - check if a CHILD block got selected instead
        // (happens when clicking a container block like grid)
        const iframe = this.getIframe();
        const selectedChild = iframe.locator(
          `[data-block-uid="${blockId}"] [data-block-uid].volto-hydra-selected`
        );
        const childWasSelected = await selectedChild.count() > 0;

        if (childWasSelected) {
          // A child of the target block is selected - navigate up to the target
          await this.navigateToParentBlock(blockId);
          await this.waitForIframeBlockHandle(blockId);
        } else {
          // Target is not parent of selected block - rethrow original error
          throw error;
        }
      }

      await this.waitForBlockSelectedInAdmin(blockId);
    } else {
      // For mock parent tests: wait for block to become editable instead of toolbar
      // Handle both: contenteditable on child (mock) OR on block itself (Nuxt)
      const childEditable = block.locator('[contenteditable="true"]');
      const selfEditable = iframe.locator(
        `[data-block-uid="${blockId}"][contenteditable="true"]`,
      );
      try {
        await childEditable.or(selfEditable).first().waitFor({ state: 'visible', timeout: 5000 });
      } catch (e) {
        throw new Error(`Block "${blockId}" was clicked but no contenteditable field appeared. Check that hydra.js is handling the block selection.`);
      }
    }

    // Return the block locator for chaining
    return block;
  }

  /**
   * Wait for a block with specific content to be visible in the iframe.
   * Returns both the locator and the block's UID.
   *
   * @param content - Text content to search for within blocks
   * @param timeout - Timeout in milliseconds (default 15000)
   * @returns Object with locator and blockId
   */
  async waitForBlockByContent(
    content: string,
    timeout: number = 15000,
  ): Promise<{ locator: Locator; blockId: string }> {
    const iframe = this.getIframe();

    // Find the text element, then get the closest block ancestor
    const blockLocator = iframe.getByText(content).first().locator('xpath=ancestor-or-self::*[@data-block-uid][1]');

    // Wait for the block to be visible
    await expect(blockLocator).toBeVisible({ timeout });

    // Get the block ID
    const blockId = await blockLocator.getAttribute('data-block-uid');
    if (!blockId) {
      throw new Error(`Block with content "${content}" found but has no data-block-uid attribute`);
    }

    return { locator: blockLocator, blockId };
  }

  /**
   * Click on a block within the preview iframe by finding it by text content.
   * Returns the block's UID for use in subsequent operations.
   *
   * @param content - Text content to search for within blocks
   * @param options.waitForToolbar - If true (default), waits for Volto's quanta-toolbar
   * @returns The block's data-block-uid attribute value
   */
  async clickBlockByContent(
    content: string,
    options: { waitForToolbar?: boolean } = {},
  ): Promise<string> {
    const { waitForToolbar = true } = options;

    const { locator: blockLocator, blockId } = await this.waitForBlockByContent(content);

    // Scroll into view and click
    await blockLocator.scrollIntoViewIfNeeded();
    await blockLocator.click();

    if (waitForToolbar) {
      await this.waitForBlockSelectedInAdmin(blockId);
    }

    return blockId;
  }

  /**
   * Navigate up through parent blocks in the sidebar until reaching the target block.
   * Used when clicking on a container block selects a child instead.
   *
   * @param targetBlockId - The block ID we want to be selected
   * @param expectedCurrentType - Optional: the type name of the block we expect to be currently selected
   *                              (e.g., "Grid" if grid-1 was selected instead of the target)
   * @param maxAttempts - Maximum navigation attempts
   */
  async navigateToParentBlock(
    targetBlockId: string,
    expectedCurrentType?: string,
    maxAttempts: number = 10
  ): Promise<void> {
    // Wait for sidebar to be open
    await this.waitForSidebarOpen();

    // Wait for parent navigation buttons to appear in sidebar
    // The sidebar needs time to render the block's parent hierarchy
    const parentButtonLocator = this.page.locator('.nav-back');
    try {
      await parentButtonLocator.first().waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      throw new Error(
        `Cannot navigate to block "${targetBlockId}": no parent navigation buttons appeared in sidebar after 5s`
      );
    }

    // Debug: Get all parent button texts for error messages
    const getParentButtonTexts = async () => {
      const buttons = await parentButtonLocator.all();
      const texts: string[] = [];
      for (const btn of buttons) {
        texts.push(await btn.textContent() || '(empty)');
      }
      return texts;
    };

    // If expectedCurrentType is provided, verify the sidebar shows it as the current block
    if (expectedCurrentType) {
      const buttonTexts = await getParentButtonTexts();
      const lastButtonText = buttonTexts[buttonTexts.length - 1] || '';
      if (!lastButtonText.includes(expectedCurrentType)) {
        throw new Error(
          `Sidebar state mismatch: expected current block type "${expectedCurrentType}" but found buttons: [${buttonTexts.join(', ')}]`
        );
      }
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Check if target block is now selected
      const result = await this.isBlockSelectedInIframe(targetBlockId);
      if (result.ok) {
        await this.waitForBlockSelectedInAdmin(targetBlockId);
        return;
      }

      // Find and click the LAST "‹ BlockType" parent navigation button in sidebar
      // Clicking it closes that section and navigates up one level
      const parentButton = parentButtonLocator.last();
      const buttonExists = (await parentButton.count()) > 0;

      if (!buttonExists) {
        const buttonTexts = await getParentButtonTexts();
        throw new Error(
          `Cannot navigate to block "${targetBlockId}": parent navigation buttons disappeared from sidebar. ` +
          `Last known buttons: [${buttonTexts.join(', ')}]`
        );
      }

      await parentButton.click();
      await this.page.waitForTimeout(300); // Wait for selection to update
    }

    const buttonTexts = await getParentButtonTexts();
    throw new Error(
      `Failed to navigate to block "${targetBlockId}" after ${maxAttempts} attempts. ` +
      `Current sidebar buttons: [${buttonTexts.join(', ')}]`
    );
  }

  /**
   * Click on a container block by clicking on its title area.
   * This is necessary for container blocks (like columns) that have nested blocks,
   * where clicking in the center would select a nested block instead.
   *
   * @param blockId - The data-block-uid of the container block
   * @param options.waitForToolbar - If true (default), waits for Quanta toolbar. Set to false for
   *                                  container blocks where toolbar positioning is unreliable.
   */
  async clickContainerBlockInIframe(
    blockId: string,
    options: { waitForToolbar?: boolean } = {},
  ) {
    const { waitForToolbar = true } = options;
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);

    // Verify block exists
    const blockCount = await block.count();
    if (blockCount === 0) {
      throw new Error(
        `Block with id "${blockId}" not found in iframe. Check if the block exists in the content.`,
      );
    }

    // Try to click on the block's title element (data-edit-text="title")
    const titleElement = block.locator(
      '> [data-edit-text="title"], > .column-title, > h3, > h4',
    );
    const hasTitleElement = (await titleElement.count()) > 0;

    if (hasTitleElement) {
      // Click on title to select the container
      await titleElement.first().scrollIntoViewIfNeeded();
      await titleElement.first().click();
    } else {
      // Fall back to clicking on the block's border area
      // Avoid data-block-selector elements (like carousel nav buttons on the sides)
      const blockBox = await block.boundingBox();
      if (blockBox) {
        // Click at top center - avoids nav buttons (on sides) and child blocks (in middle)
        // The top border area is typically safe for containers like carousels
        await block.click({
          position: { x: blockBox.width / 2, y: 3 },
        });
      } else {
        throw new Error(
          `Cannot get bounding box for block "${blockId}" to click on border`,
        );
      }
    }

    if (waitForToolbar) {
      // Wait for toolbar to be positioned correctly
      await this.waitForBlockSelectedInAdmin(blockId);
    } else {
      // Wait for sidebar to show the block is selected
      await this.waitForSidebarOpen();
    }

    return block;
  }

  /**
   * Wait for both drag handles (iframe and Volto toolbar) to be visible and aligned.
   * The iframe drag handle (.volto-hydra-drag-button) handles clicks.
   * The Volto toolbar drag handle (.drag-handle) is positioned over it.
   */
  /**
   * Wait for the iframe drag button and toolbar drag button to be aligned.
   * The iframe drag button MUST be directly underneath the toolbar drag icon
   * for DND to work - clicks on the visible toolbar fall through to the iframe button.
   */
  async waitForDragHandlesAligned(timeout: number = 5000): Promise<void> {
    const iframe = this.getIframe();
    const iframeDragHandle = iframe.locator('.volto-hydra-drag-button');
    const toolbarDragHandle = this.page.locator('.quanta-toolbar .drag-handle');

    await expect(async () => {
      await expect(iframeDragHandle).toBeVisible({ timeout: 100 });
      await expect(toolbarDragHandle).toBeVisible({ timeout: 100 });

      const iframeBox = await iframeDragHandle.boundingBox();
      const toolbarBox = await toolbarDragHandle.boundingBox();
      if (!iframeBox || !toolbarBox) {
        throw new Error('Could not get drag handle bounding boxes');
      }

      const xDiff = Math.abs(toolbarBox.x - iframeBox.x);
      const yDiff = Math.abs(toolbarBox.y - iframeBox.y);
      const tolerance = 10;

      if (xDiff > tolerance || yDiff > tolerance) {
        throw new Error(
          `Drag handles not aligned. Iframe: (${iframeBox.x.toFixed(0)}, ${iframeBox.y.toFixed(0)}), ` +
          `Toolbar: (${toolbarBox.x.toFixed(0)}, ${toolbarBox.y.toFixed(0)}), ` +
          `diff: (${xDiff.toFixed(0)}, ${yDiff.toFixed(0)})`
        );
      }
    }).toPass({ timeout });
  }

  /**
   * Wait for a block to be selected in the iframe.
   * Handles multi-element blocks (multiple elements with same UID).
   */
  async waitForIframeBlockHandle(blockId: string, timeout: number = 5000) {
    const iframe = this.getIframe();
    const blockLocator = iframe.locator(`[data-block-uid="${blockId}"]`);

    // Use first() for multi-element blocks
    await blockLocator.first().waitFor({ state: 'visible', timeout });

    // Wait for iframe drag handle to appear and become visible
    // The drag handle is created with display:none and becomes visible when sendBlockSelected runs
    // Use polling since sendBlockSelected happens asynchronously on selectionchange
    const dragHandle = iframe.locator('.volto-hydra-drag-button');
    await expect(async () => {
      const isVisible = await dragHandle.isVisible();
      if (!isVisible) {
        const exists = await dragHandle.count() > 0;
        console.log(`[waitForIframeBlockHandle] Drag handle exists=${exists} visible=${isVisible}`);
      }
      expect(isVisible).toBe(true);
    }).toPass({ timeout });

    // Return the first element locator for chaining
    return blockLocator.first();
  }

  /**
   * Press Escape once to exit text editing and enter block mode.
   * Block stays selected but fields are no longer contenteditable.
   */
  async escapeFromEditing(): Promise<void> {
    await this.page.keyboard.press('Escape');
    // Wait for outline to switch to block mode (full border)
    await expect(this.page.locator('.volto-hydra-block-outline[data-outline-style="border"]'))
      .toBeVisible({ timeout: 3000 });
  }

  /**
   * Simulate a long press (touch) on a block in the iframe.
   * Dispatches touchstart/touchend events inside the iframe with a 700ms hold.
   * Triggers ENTER_SELECTION_MODE in hydra.js for mobile selection mode.
   */
  async longPressBlock(blockUid: string): Promise<void> {
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockUid}"]`);

    // Get block center in iframe-relative coordinates
    const center = await block.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    // Blur the active element first. The bridge gates long-press multi-
    // select when a contenteditable is focused (so iOS native long-press =
    // word-select can fire cleanly in text mode without us also entering
    // multi-block-select). Tests that combine clickBlockInIframe → long-
    // press leave the field focused, which would gate the multi-select
    // even though the test author wants it to fire. Matches real mobile
    // UX where a user presses Escape or taps elsewhere to exit text mode
    // before initiating multi-select.
    await iframe.locator('body').evaluate(() => {
      const ae = document.activeElement;
      if (ae && (ae as HTMLElement).blur) (ae as HTMLElement).blur();
    });

    // Dispatch touchstart
    await iframe.locator('body').evaluate((body, pos) => {
      const el = document.elementFromPoint(pos.x, pos.y) || body;
      el.dispatchEvent(new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        touches: [new Touch({ identifier: 1, target: el, clientX: pos.x, clientY: pos.y })],
      }));
    }, center);

    // Hold for long press threshold
    await this.page.waitForTimeout(700);

    // Dispatch touchend
    await iframe.locator('body').evaluate((body, pos) => {
      const el = document.elementFromPoint(pos.x, pos.y) || body;
      el.dispatchEvent(new TouchEvent('touchend', {
        bubbles: true,
        cancelable: true,
        changedTouches: [new Touch({ identifier: 1, target: el, clientX: pos.x, clientY: pos.y })],
      }));
    }, center);

    // Wait for selection checkboxes to appear
    await expect(this.page.locator('.volto-hydra-selection-checkbox').first())
      .toBeVisible({ timeout: 5000 });
  }

  /**
   * Wait for multi-block selection outlines to appear.
   * Each selected block gets its own outline element.
   * @param minCount - minimum number of outlines expected (default 2)
   */
  async waitForMultiSelectOutlines(minCount = 2): Promise<void> {
    await expect(async () => {
      const count = await this.page.locator('.volto-hydra-block-outline').count();
      expect(count).toBeGreaterThanOrEqual(minCount);
    }).toPass({ timeout: 5000 });
  }

  /**
   * Press Cmd+A once and wait for THAT escalation to land, identified by a label
   * the new level carries in the sidebar's block path.
   *
   * Pressing and then polling the path rows for a few seconds measures the last
   * link of a chain — admin dispatches, the bridge re-measures rects in the
   * iframe, BLOCK_SELECTED comes back, React re-renders the rows — and gives the
   * whole chain a fixed budget. On a loaded machine (a 2-core CI runner) the
   * chain simply takes longer, so the budget expires while nothing is wrong.
   * Worse, the press was fire-and-forget: with no wait between presses, the next
   * Cmd+A can be handled against a stale selection, so the escalation lands on a
   * different level than the test assumes — which is why these failed
   * DETERMINISTICALLY under load rather than intermittently.
   *
   * Waiting on the label (not a duration, and not a bare count — two levels can
   * share a count) means each press is synchronised with its own result.
   *
   * @param label - text the new level's path rows must contain
   * @returns the number of path rows at the new level
   */
  async escalateSelection(label: string): Promise<number> {
    const rows = this.page.locator('.selected-block-path');
    await this.page.keyboard.press('ControlOrMeta+a');
    await expect
      .poll(async () => (await rows.allTextContents()).some((t) => t.includes(label)), {
        message: `Cmd+A never escalated to a level containing "${label}"`,
      })
      .toBe(true);
    return rows.count();
  }

  /**
   * Press Escape twice to navigate from text editing to parent block (or deselect).
   * First Escape: text mode → block mode. Second Escape: block mode → parent.
   * If already in block mode (not editing), only one Escape is needed.
   */
  async escapeToParent(): Promise<void> {
    // Get current sidebar header count to detect navigation
    const headersBefore = await this.page
      .locator('.sidebar-section-header.sticky-header')
      .count();

    await this.page.keyboard.press('Escape');

    // Check if we actually navigated (header count changed) or just entered block mode
    // If still on same level after 300ms, press Escape again
    await this.page.waitForTimeout(300);
    const headersAfter = await this.page
      .locator('.sidebar-section-header.sticky-header')
      .count();

    if (headersAfter >= headersBefore) {
      // Didn't navigate — we entered block mode. Press again.
      await this.page.keyboard.press('Escape');
    }
  }

  /**
   * Check if the sidebar is open.
   */
  async isSidebarOpen(): Promise<boolean> {
    const sidebar = this.page.locator('#sidebar-properties');
    return await sidebar.isVisible();
  }

  /**
   * Wait for the sidebar to open.
   */
  async waitForSidebarOpen(timeout: number = 5000): Promise<void> {
    // Wait for sidebar to be open - check for the content wrapper which is always visible
    await this.page.waitForSelector(
      '.sidebar-content-wrapper',
      {
        state: 'visible',
        timeout,
      }
    );
  }

  /**
   * True when the admin is rendering its mobile layout (viewport ≤ hydra's
   * largestMobileScreen = 767). At that width the settings sidebar is a
   * collapsed off-screen sheet and the main toolbar is pinned to the bottom;
   * openSidebar/closeSidebar branch on this so callers don't have to.
   */
  isMobileViewport(): boolean {
    const vp = this.page.viewportSize();
    return !!vp && vp.width <= 767;
  }

  /**
   * Ensure the settings sidebar is OPEN, on desktop and mobile alike.
   * - Desktop edit mode: the sidebar is normally already open — no-op; if it was
   *   collapsed to its right-edge sliver, click the `.trigger` to expand it.
   * - Mobile: the sidebar starts as a collapsed off-screen sheet; the Settings
   *   icon in the bottom toolbar (`.sidebar-toggle-toolbar-btn`) opens it
   *   full-screen (mobile-tablet-admin-layout.spec: 'Settings icon … opens the sidebar').
   * Idempotent: returns immediately if the sidebar is already expanded.
   */
  async openSidebar(timeout: number = 5000): Promise<void> {
    // Branch on the `.collapsed` CLASS being present, NOT on the visibility of
    // `:not(.collapsed)` — the latter races to false for a beat right after a
    // selection changes the sidebar, and would then click the desktop `.trigger`
    // sliver, which COLLAPSES an already-open sidebar (the exact opposite). If no
    // collapsed container exists, the sidebar is already open — nothing to do.
    const collapsed = this.page.locator('.sidebar-container.collapsed');
    if ((await collapsed.count()) === 0) {
      await this.waitForSidebarOpen(timeout).catch(() => {});
      return;
    }
    if (this.isMobileViewport()) {
      await this.page.locator('#toolbar-body .sidebar-toggle-toolbar-btn').click();
    } else {
      await this.page.locator('.sidebar-container .trigger').click();
    }
    await expect(this.page.locator('.sidebar-container.collapsed')).toHaveCount(0, { timeout });
    await this.waitForSidebarOpen(timeout);
    // Demo pacing: let the freshly-opened sheet be seen before the next action.
    if (this.demoPacingMs) await this.page.waitForTimeout(this.demoPacingMs);
  }

  /**
   * Ensure the sidebar is out of the way so canvas blocks are clickable again.
   * - Mobile: the open sidebar is a full-screen sheet covering the iframe, so it
   *   MUST be dismissed (its page-header X, `.sidebar-close-button`) before the
   *   next block tap. Idempotent — no-op if already collapsed.
   * - Desktop: an open sidebar sits beside the canvas and doesn't block clicks;
   *   leaving it open is the normal edit state, so this is a no-op.
   */
  async closeSidebar(timeout: number = 5000): Promise<void> {
    if (!this.isMobileViewport()) return;
    const close = this.page.locator('.sidebar-container .sidebar-close-button');
    if (await close.isVisible().catch(() => false)) {
      // Demo pacing: hold on the sheet's final state before dismissing it.
      if (this.demoPacingMs) await this.page.waitForTimeout(this.demoPacingMs);
      await close.click();
      await expect(this.page.locator('.sidebar-container.collapsed')).toBeAttached({ timeout });
    }
  }

  /**
   * Demo recordings (Playwright ≥1.61): turn on the screencast CURSOR — an animated
   * pointer that tracks between action points, over the admin iframe too (Playwright
   * composites it into the recording, so unlike an injected DOM cursor it isn't trapped
   * in one document). The per-action title overlays are suppressed (duration:0):
   * "Click"/"Type" reads as noise — narrate deliberately with caption() instead. No-op
   * when screencast is unavailable (older Playwright / video off), so it's safe to leave
   * in any test.
   */
  async enableDemoCursor(cursor: 'pointer' | 'none' = 'pointer'): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sc = (this.page as any).screencast;
    if (sc?.showActions) await sc.showActions({ cursor, duration: 0 });
  }

  /**
   * High-level caption for a demo recording — a subtitle pill saying what's happening
   * NEXT ("Unlock the shared footer template"). Non-blocking: the pill stays up for
   * `ms` while the following actions run, so place it right before a beat.
   *
   * Delegates to the shared caption module, which prefers Playwright >= 1.61's
   * screencast overlay (composited into the video, so nothing is injected into the
   * app being demoed) and falls back to a DOM overlay otherwise. `showCaption` from
   * `demo-video/caption` is the same implementation — there is only one, so a demo
   * can mix the two call styles without ending up with two pills on screen.
   */
  async caption(text: string, ms: number = 15_000): Promise<void> {
    await showCaption(this.page, text, ms);
  }

  /** Remove the caption pill entirely (see `caption()`). */
  async clearCaption(): Promise<void> {
    await clearCaption(this.page);
  }

  /**
   * Wait for a block to be shown as readonly (has hydra-locked class).
   * Used to verify template edit mode is active (blocks outside template get locked).
   * @param blockId - The block ID to check
   * @param timeout - Maximum time to wait
   */
  async waitForBlockReadonly(blockId: string, timeout: number = 5000): Promise<void> {
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);
    // v2: readonly/locked blocks are no longer dimmed — they're marked by a
    // dynamic CSS rule setting the `--hydra-block-locked` custom property (live,
    // re-render-resilient, and invisible). See applyReadonlyVisuals in hydra.
    await expect(block).toHaveCSS('--hydra-block-locked', '1', { timeout });
  }

  /**
   * Wait for a block to NOT be shown as readonly.
   * Used to verify template edit mode is inactive.
   * @param blockId - The block ID to check
   * @param timeout - Maximum time to wait
   */
  async waitForBlockEditable(blockId: string, timeout: number = 5000): Promise<void> {
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);
    // Editable = NOT marked locked (the `--hydra-block-locked` marker is absent).
    await expect(block).not.toHaveCSS('--hydra-block-locked', '1', { timeout });
  }

  /**
   * v2 template edit: UNLOCK a template for editing via the ON-CANVAS Quanta toolbar
   * lock toggle (🔒). No sidebar on any width — `toolbarTemplateInstanceId` is derived
   * from the selected block's ancestry, so tapping the toggle targets the template
   * even from a deeply-nested member, and the "changes show on every page" warning
   * modal renders on the canvas (visible, not buried in a settings sheet). Select a
   * FIXED (locked) member so the toggle shows. demoPacingMs (opt-in) holds on the
   * modal so recordings can read it.
   * @param memberBlockId - a fixed/locked block belonging to the template instance
   */
  async unlockTemplate(memberBlockId: string): Promise<void> {
    await this.clickBlockInIframe(memberBlockId);
    const toggle = this.page.locator('.quanta-toolbar .template-lock-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    const confirm = this.page.locator('.template-unlock-modal .template-confirm');
    await expect(confirm).toBeVisible({ timeout: 5000 });
    // Demo pacing: hold on the warning modal before confirming.
    if (this.demoPacingMs) await this.page.waitForTimeout(this.demoPacingMs);
    await confirm.click();
    await expect(this.page.locator('.template-unlock-modal')).toHaveCount(0, { timeout: 5000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }

  /**
   * v2 template edit: LOCK a template via the Quanta toolbar toggle (🔓), choosing
   * what to do with the edits. Re-selects the member (edits may have moved the
   * selection), taps the toggle to raise the decision modal, and picks an option.
   * @param memberBlockId - a surviving block belonging to the template instance
   * @param choice - 'commit' (Change on all pages), 'reset' (Reset changes), or 'cancel'
   */
  async lockTemplate(memberBlockId: string, choice: 'commit' | 'reset' | 'cancel'): Promise<void> {
    await this.clickBlockInIframe(memberBlockId);
    const toggle = this.page.locator('.quanta-toolbar .template-lock-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    const modal = this.page.locator('.template-lock-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    // Demo pacing: hold on the decision modal before choosing.
    if (this.demoPacingMs) await this.page.waitForTimeout(this.demoPacingMs);
    const btn = { commit: '.template-commit', reset: '.template-reset', cancel: '.template-cancel' }[choice];
    await modal.locator(btn).click();
    await expect(modal).toHaveCount(0, { timeout: 5000 });
    // commit/reset actually LOCK the template (remove it from the unlocked set).
    // That is async for commit (flush → reverse-merge → save → unlock), so wait for
    // the toggle to flip to locked before returning — otherwise a following page
    // save races the save-gate. (cancel keeps it unlocked.)
    if (choice !== 'cancel') {
      await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 10000 });
    }
  }

  /**
   * Resolve a full (instance-scoped) block id from its template-child suffix. Forced-layout
   * nested template blocks are emitted as `${instanceId}::${templateChildId}` so two
   * instances of the same template don't collide in the blockPathMap; a test knows the
   * template child id (e.g. 'tpl-slide-1') and resolves the actual rendered id here.
   */
  async resolveBlockId(suffix: string, timeout: number = 10000): Promise<string> {
    const iframe = this.getIframe();
    const loc = iframe.locator(`[data-block-uid$="${suffix}"]`).first();
    await loc.waitFor({ state: 'attached', timeout });
    return (await loc.getAttribute('data-block-uid')) as string;
  }

  /**
   * Assert that the sidebar shows exactly `expected` template settings sections.
   * Each block in the hierarchy can portal a "Template Settings" form into
   * #sidebar-template-settings. Object_list items should NOT render one.
   */
  async expectTemplateSettingsCount(expected: number, timeout: number = 5000): Promise<void> {
    const container = this.page.locator('#sidebar-template-settings');
    const sections = container.locator('.field-wrapper-slotId');
    await expect(sections).toHaveCount(expected, { timeout });
  }

  /**
   * Wait for the sidebar to show a specific block type as the current block.
   * The current block in the sidebar has data-is-current="true" on its header.
   *
   * @param blockTypeTitle - The display title of the block type (e.g., "Slider", "Slide", "Text")
   * @param timeout - Maximum time to wait in milliseconds
   */
  async waitForSidebarCurrentBlock(blockTypeTitle: string, timeout: number = 10000): Promise<void> {
    const sidebar = this.page.locator('.sidebar-container');
    // The current block header has data-is-current="true" with a nav button showing the type title
    // Use the nav-title button inside parent-nav for exact text match
    const currentBlockHeader = sidebar.locator('[data-is-current="true"] .parent-nav .nav-title').filter({ hasText: blockTypeTitle });
    await expect(currentBlockHeader).toBeVisible({ timeout });
  }

  /**
   * Open a specific sidebar tab (Page, Block, Order, etc.)
   *
   * Note: The Hydra sidebar uses a unified hierarchical view without tabs.
   * This method is kept for backwards compatibility and scrolls to the
   * appropriate section:
   * - "Block": Scrolls to block settings (#sidebar-properties)
   * - "Page"/"Document": Scrolls to top for page metadata (#sidebar-metadata)
   * - "Order": Scrolls to child blocks widget at bottom (#sidebar-children)
   */
  async openSidebarTab(tabName: string): Promise<void> {
    // Map tab names to their portal target IDs
    const tabToSelector: Record<string, string> = {
      Block: '#sidebar-properties',
      Page: '#sidebar-metadata',
      Document: '#sidebar-metadata',
      Order: '#sidebar-order',
    };

    const selector = tabToSelector[tabName];
    if (selector) {
      const section = this.page.locator(selector);
      // Wait for the section to exist
      await section.waitFor({ state: 'attached', timeout: 5000 });
      // Scroll to the section
      await section.scrollIntoViewIfNeeded();
      // Brief wait for scroll to complete
      await this.page.waitForTimeout(100);
    }
  }

  /**
   * Get the type of block currently being edited in the sidebar.
   *
   * Reads the block-editor's own type class FIRST (`block-editor-<type>`, which
   * Volto renders for every block), so this answers for any type. The
   * hand-listed slate/image checks below only ever covered those two, and
   * returned null for everything else — indistinguishable from "the sidebar is
   * showing nothing", which is the state a caller usually wants to rule out.
   */
  async getSidebarBlockType(): Promise<string | null> {
    const sidebar = this.page.locator('#sidebar-properties');

    const typed = sidebar.locator('[class*="block-editor-"]').first();
    if (await typed.isVisible().catch(() => false)) {
      const cls = (await typed.getAttribute('class')) || '';
      const match = cls.match(/block-editor-([\w-]+)/);
      if (match) return match[1];
    }

    // Check for common block type indicators
    const selectors = [
      '.block-editor-slate',
      '.block-editor-image',
      '.block-editor h2',
    ];

    for (const selector of selectors) {
      const element = sidebar.locator(selector).first();
      if (await element.isVisible()) {
        // Try from class names
        const classAttr = await element.getAttribute('class');
        if (classAttr) {
          if (classAttr.includes('slate')) return 'slate';
          if (classAttr.includes('image')) return 'image';
        }

        // Try from text content
        const text = await element.textContent();
        if (text) {
          return text.toLowerCase();
        }
      }
    }

    return null;
  }

  /**
   * Get a locator for the slate editable field in a block.
   * The field may be on the block element itself (Nuxt) or a child element (mock).
   * Use with expect().toBeVisible() to verify a block is a slate block.
   * @param blockLocator - Locator for the block element with data-block-uid
   */
  getSlateField(blockLocator: Locator): Locator {
    // Try child first (mock renderer), then self (Nuxt where attr is on root)
    const childField = blockLocator.locator('[data-edit-text="value"]');
    const selfField = blockLocator.and(this.page.locator('[data-edit-text="value"]'));
    return childField.or(selfField);
  }

  /**
   * Check if the Quanta Toolbar is visible for a specific block.
   * The toolbar is rendered in the parent window (admin UI), positioned above the block in iframe.
   * Uses isBlockSelectedInIframe which verifies both visibility AND correct positioning.
   */
  async isQuantaToolbarVisibleInIframe(blockId: string): Promise<boolean> {
    const result = await this.isBlockSelectedInIframe(blockId);
    return result.ok;
  }

  /**
   * Get all buttons in the Quanta toolbar (rendered in parent window).
   * Returns a list of buttons with their title/aria-label.
   */
  async getQuantaToolbarButtons(): Promise<{ title: string; visible: boolean }[]> {
    const toolbar = this.page.locator('.quanta-toolbar');
    const buttons = toolbar.locator('button, [role="button"], a');
    const count = await buttons.count();

    const result: { title: string; visible: boolean }[] = [];
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const title = await btn.getAttribute('title') || await btn.getAttribute('aria-label') || '';
      const visible = await btn.isVisible();
      if (title) {
        result.push({ title, visible });
      }
    }
    return result;
  }

  /**
   * Get a format button from the Quanta toolbar by name (e.g., "Bold", "Italic").
   * Uses accessible name matching which works with title attribute.
   */
  getQuantaToolbarFormatButton(formatName: string): Locator {
    return this.page.locator('.quanta-toolbar').getByRole('button', { name: new RegExp(formatName, 'i') });
  }

  /**
   * Set a media field's source via the inline canvas editor — the flow every
   * media object (image, video) shares: click the block's `data-edit-media`
   * element, open the media editor from the quanta toolbar, type a URL and
   * submit. Consolidates what was duplicated inline across the media tests.
   *
   * @param blockUid The block whose media field to edit.
   * @param field    The media field name (the `data-edit-media` value, e.g. "image" or "url").
   * @param url      The media source URL to enter.
   */
  async setMediaFieldUrlInline(blockUid: string, field: string, url: string): Promise<void> {
    const iframe = this.getIframe();
    const media = iframe.locator(`[data-block-uid="${blockUid}"] [data-edit-media="${field}"]`);
    await media.click();

    // Focusing the media field reveals the "image" button in the quanta toolbar.
    const imageButton = this.getQuantaToolbarFormatButton('image');
    await expect(imageButton).toBeVisible({ timeout: 5000 });
    await imageButton.click();

    // The inline image editor overlay appears over the media element.
    const overlay = this.page.locator('.empty-image-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Enter the URL and submit (the arrow button); the overlay closes on success.
    const urlInput = overlay.locator('input[name="link"]');
    await expect(urlInput).toBeVisible({ timeout: 5000 });
    await urlInput.fill(url);
    const submit = overlay.locator('button[aria-label="Submit"]');
    await expect(submit).toBeEnabled({ timeout: 5000 });
    await submit.click();
    await expect(overlay).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Check if a format button is visible in the Quanta toolbar.
   */
  async isFormatButtonVisible(formatName: string): Promise<boolean> {
    const button = this.getQuantaToolbarFormatButton(formatName);
    return await button.isVisible();
  }

  /**
   * Scroll a block into view with room for the toolbar above it.
   * The toolbar is in the parent page, positioned based on block position.
   * Using 'center' ensures there's room above for the toolbar.
   * For multi-element blocks, scrolls the first element into view.
   */
  async scrollBlockIntoViewWithToolbarRoom(blockId: string): Promise<void> {
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockId}"]`).first();
    await block.evaluate((el) => {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  }

  /**
   * Check if the toolbar is covered by the sidebar.
   * Returns true if NOT covered (toolbar is fully visible and clickable).
   */
  async isToolbarNotCoveredBySidebar(): Promise<boolean> {
    const toolbar = this.page.locator('.quanta-toolbar');
    const sidebar = this.page.locator('.sidebar-container:not(.collapsed)');

    // If sidebar doesn't exist or is collapsed, toolbar can't be covered
    if (!(await sidebar.isVisible())) {
      return true;
    }

    const toolbarBox = await toolbar.boundingBox();
    const sidebarBox = await sidebar.boundingBox();

    if (!toolbarBox || !sidebarBox) {
      return true; // Can't determine, assume ok
    }

    // Check if toolbar's right edge extends into sidebar's left edge
    const toolbarRight = toolbarBox.x + toolbarBox.width;
    const sidebarLeft = sidebarBox.x;

    // Toolbar is not covered if its right edge is left of sidebar's left edge
    return toolbarRight <= sidebarLeft;
  }

  /**
   * Wait for the Quanta toolbar to appear on a block and scroll it into view.
   * Also verifies the toolbar is not covered by the sidebar.
   * For template instances, pass an array of child block IDs to verify combined bounds.
   */
  async waitForBlockSelectedInAdmin(blockIds: string | string[], timeout: number = 10000): Promise<void> {
    // Normalize to array
    const ids = Array.isArray(blockIds) ? blockIds : [blockIds];
    const firstBlockId = ids[0];
    const displayId = Array.isArray(blockIds) ? `[${ids.length} blocks]` : blockIds;

    // Scroll first block into view - toolbar is hidden when block is out of viewport
    await this.scrollBlockIntoViewWithToolbarRoom(firstBlockId);

    // Wait until toolbar is positioned correctly relative to the block(s)
    // (isBlockSelectedInIframe checks visibility AND positioning)
    let lastReason = '';
    await expect.poll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await this.isBlockSelectedInIframe(ids);
      if (typeof res === 'boolean') return res;
      if (res?.reason && res.reason !== lastReason) {
        console.log(`[waitForBlockSelectedInAdmin] ${displayId}: ${res.reason}`);
        lastReason = res.reason;
      }
      return !!res && !!res.ok;
    }, { timeout }).toBeTruthy();

    // After scrolling, the viewport position changed, so poll again to ensure
    // the toolbar has re-adjusted its position correctly
    await expect.poll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await this.isBlockSelectedInIframe(ids);
      if (typeof res === 'boolean') return res;
      return !!res && !!res.ok;
    }, { timeout: 5000 }).toBeTruthy();

    // Verify toolbar is not covered by sidebar
    await expect.poll(async () => {
      return await this.isToolbarNotCoveredBySidebar();
    }, { timeout: 5000 }).toBeTruthy();

    // Wait for both drag handles (iframe and Volto toolbar) to be aligned
    // Only check if the Volto toolbar drag handle is actually visible.
    // On mobile (@media max-width:600px) the drag handle is hidden via
    // display:none — the chevron buttons replace it — so alignment is
    // moot. Skip silently in that case.
    const voltoToolbarDragHandle = this.page.locator('.quanta-toolbar .drag-handle');
    const dragHandleVisible =
      (await voltoToolbarDragHandle.count()) > 0 &&
      (await voltoToolbarDragHandle.isVisible().catch(() => false));
    if (dragHandleVisible) {
      await this.waitForDragHandlesAligned(5000);
    }
  }

  async getMenuButtonInQuantaToolbar(blockId: string, formatKeyword:string): Promise<void> {
    const menuButton = this.page.locator(
      `.quanta-toolbar [title*="${formatKeyword}" i]`
    );

    // Check if menu button exists
    const buttonCount = await menuButton.count();
    if (buttonCount === 0) {
      throw new Error(
        `Menu button not found in Quanta toolbar for block "${blockId}". ` +
        `The menu button should be created by hydra.js createQuantaToolbar().`
      );
    }

    // Verify button is visible
    try {
      await menuButton.waitFor({ state: 'visible', timeout: 2000 });
    } catch (e) {
      throw new Error(
        `Menu button exists but is not visible for block "${blockId}". ` +
        `Check toolbar CSS or positioning.`
      );
    }

    return menuButton;
  }

  /**
   * Click the dropdown menu button to reveal Settings/Remove options.
   */
  async openQuantaToolbarMenu(blockId: string): Promise<void> {

    // First wait for the Quanta toolbar to appear
    await this.waitForBlockSelectedInAdmin(blockId);

    const menuButton = await this.getMenuButtonInQuantaToolbar(blockId, 'options');
    await menuButton.click();

    // Wait for dropdown to appear
    const dropdown = this.page.locator(
      `.volto-hydra-dropdown-menu`
    );

    try {
      await dropdown.waitFor({ state: 'visible', timeout: 3000 });
    } catch (e) {
      throw new Error(
        `Dropdown menu did not appear after clicking menu button for block "${blockId}". ` +
        `Check that the click handler is working and the dropdown is being shown.`
      );
    }
  }

  /**
   * Get the Quanta Toolbar dropdown menu (rendered in parent window via portal).
   */
  async getQuantaToolbarMenu(blockId: string): Promise<Locator> {
    // The dropdown is rendered via portal to document.body in parent window
    // It doesn't have a .visible class - it's conditionally rendered
    const dropdown = this.page.locator('.volto-hydra-dropdown-menu');
    return dropdown;
  }

  /**
   * Get the dropdown menu options (Settings, Remove).
   * The dropdown is rendered via portal to document.body in parent window.
   */
  async getQuantaToolbarMenuOptions(_blockId: string): Promise<string[]> {
    // The dropdown is in the parent window, not in the iframe
    const dropdown = this.page.locator('.volto-hydra-dropdown-menu');
    const items = dropdown.locator('.volto-hydra-dropdown-item');

    const options: string[] = [];
    const count = await items.count();

    for (let i = 0; i < count; i++) {
      // Text is directly in the item, not in a nested element
      const text = await items.nth(i).textContent();
      if (text) {
        // Remove emoji prefix (e.g., "⚙️ Settings" -> "Settings")
        const cleanText = text.replace(/^[^\w]*/, '').trim();
        if (cleanText) {
          options.push(cleanText);
        }
      }
    }

    return options;
  }

  /**
   * Click a specific menu option (Settings or Remove).
   */
  async clickQuantaToolbarMenuOption(
    blockId: string,
    optionText: 'Settings' | 'Remove'
  ): Promise<void> {
    const dropdown = this.page.locator(`.volto-hydra-dropdown-menu`);
    const option = dropdown.locator(
      `.volto-hydra-dropdown-item:has-text("${optionText}")`
    );
    // Wait for option to be visible and clickable
    await option.waitFor({ state: 'visible', timeout: 3000 });
    await option.click();
    // Wait for dropdown to close (confirms action was triggered)
    await dropdown.waitFor({ state: 'hidden', timeout: 3000 });
  }

  /**
   * Click a format button (bold, italic, strikethrough, link) in the currently visible Quanta Toolbar.
   * Searches for the button by title attribute containing the format keyword.
   * Since only one toolbar can be open at a time, no blockId is needed.
   */
  async clickFormatButton(
    format: 'bold' | 'italic' | 'strikethrough' | 'link'
  ): Promise<void> {
    // Toolbar is now rendered in parent window (admin UI), not iframe
    // Find button by title attribute (case-insensitive search)
    // Note: Semantic UI buttons render as <a> tags, not <button> tags
    const formatKeyword = format.charAt(0).toUpperCase() + format.slice(1); // Capitalize first letter
    const button = this.page.locator(
      `.quanta-toolbar [title*="${formatKeyword}" i]`
    );

    // Wait for button to be visible FIRST (handles toolbar still rendering)
    await button.first().waitFor({ state: 'visible', timeout: 5000 });

    const count = await button.count();
    if (count > 1) {
      throw new Error(
        `Found ${count} buttons matching "${format}" - test is not deterministic. ` +
        `Expected exactly one button with title containing "${formatKeyword}".`
      );
    }

    await button.click();
  }

  /**
   * Apply a format to the currently selected text in an editor.
   * This is a higher-level helper that:
   * 1. Clicks the format button
   * 2. Waits for the formatted text to appear
   * 3. Re-selects all text (to restore selection after DOM re-render)
   *
   * Use this instead of clickFormatButton when you need to apply multiple
   * formats in sequence, as the DOM re-render can lose the selection.
   */
  async applyFormat(
    editor: Locator,
    format: 'bold' | 'italic',
    expectedText: RegExp | string,
  ): Promise<void> {
    await this.clickFormatButton(format);
    await this.waitForFormattedText(editor, expectedText, format);
    // Re-select all text to restore selection after DOM re-render
    // There is a bug if this is not automatically done by hydra.js
    // await this.selectAllTextInEditor(editor);
  }

  /**
   * Check if a format button is in active state.
   * Returns the current state without polling - use with toPass() for waiting.
   * Semantic UI Button with active={true} gets the "active" CSS class.
   */
  async isActiveFormatButton(
    format: 'bold' | 'italic' | 'strikethrough' | 'link',
  ): Promise<boolean> {
    const formatKeyword = format.charAt(0).toUpperCase() + format.slice(1);
    const button = this.page.locator(
      `.quanta-toolbar [title*="${formatKeyword}" i]`
    );

    const count = await button.count();
    if (count === 0) return false;
    return await button.first().evaluate((el) =>
      el.classList.contains('active')
    );
  }

  /**
   * Verify that the current selection matches the expected text.
   * Uses Playwright polling to handle async selection restoration after formatting.
   */
  async verifySelectionMatches(editor: Locator, expectedText: string): Promise<void> {
    await expect
      .poll(
        async () => {
          return await editor.evaluate(() => {
            const selection = window.getSelection();
            return selection ? selection.toString().replace(/[\uFEFF\u200B]/g, '') : '';
          });
        },
        {
          message: `Expected selection to be "${expectedText}"`,
          timeout: 2000,
        }
      )
      .toBe(expectedText);
  }

  /**
   * Select all text in a contenteditable element using JavaScript Selection API.
   * This is more reliable than using keyboard shortcuts.
   * Handles both plain text and formatted text (where text is inside SPAN, STRONG, etc.)
   */
  async selectAllTextInEditor(editor: Locator): Promise<void> {
    // Get the expected text content (visible text, trimmed, strip ZWS/BOM)
    const expectedText = await editor.evaluate((el) => (el.textContent || '').replace(/[\uFEFF\u200B]/g, '').trim());

    // Use platform-appropriate keyboard shortcut (Cmd+A on Mac, Ctrl+A elsewhere)
    await editor.press('ControlOrMeta+a');

    // Wait for selection to match the editor's text content
    await expect
      .poll(
        async () => {
          return editor.evaluate(() => {
            const sel = window.getSelection();
            return (sel?.toString() || '').replace(/[\uFEFF\u200B]/g, '').trim();
          });
        },
        { timeout: 5000 }
      )
      .toBe(expectedText);
  }

  /**
   * Copy selected text and return clipboard content.
   * Uses native keyboard copy (ControlOrMeta+c) and reads from clipboard API.
   * Automatically grants clipboard permissions if needed.
   */
  async copyAndGetClipboardText(editor: Locator): Promise<string> {
    // Grant clipboard permissions
    await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Trigger native copy with keyboard shortcut
    await editor.press('ControlOrMeta+c');

    // Small delay for clipboard to be populated
    await this.page.waitForTimeout(50);

    // Read clipboard from parent page (clipboard is shared)
    const clipboardText = await this.page.evaluate(() =>
      navigator.clipboard.readText()
    );

    return clipboardText;
  }

  /**
   * Cut selected text and return the cut content.
   * Uses native keyboard cut (ControlOrMeta+x) and reads from clipboard API.
   * Automatically grants clipboard permissions if needed.
   */
  async cutSelectedText(editor: Locator): Promise<string> {
    // Grant clipboard permissions
    await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Trigger native cut with keyboard shortcut
    await editor.press('ControlOrMeta+x');

    // Small delay for clipboard to be populated
    await this.page.waitForTimeout(50);

    // Read clipboard from parent page (clipboard is shared)
    const clipboardText = await this.page.evaluate(() =>
      navigator.clipboard.readText()
    );

    return clipboardText;
  }

  /**
   * Paste text from clipboard into the editor.
   * Uses native keyboard paste (ControlOrMeta+v).
   * Automatically grants clipboard permissions if needed.
   */
  async pasteFromClipboard(editor: Locator): Promise<void> {
    // Grant clipboard permissions
    await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Trigger native paste with keyboard shortcut
    await editor.press('ControlOrMeta+v');

    // Small delay for paste to complete
    await this.page.waitForTimeout(50);
  }

  /**
   * Get selection state info from an editor element.
   * Useful for debugging selection/focus issues.
   */
  async getCleanSelectionText(locator: Locator): Promise<string> {
    return await locator.evaluate(() => {
      return (window.getSelection()?.toString() || '').replace(/[\uFEFF\u200B]/g, '');
    });
  }

  async getSelectionInfo(editor: Locator): Promise<{
    rangeCount: number;
    isCollapsed: boolean;
    anchorNodeName: string | null;
    anchorOffset: number;
    focusNodeName: string | null;
    focusOffset: number;
    activeElementTag: string | null;
    editorHasFocus: boolean;
  }> {
    return await editor.evaluate((el) => {
      const sel = window.getSelection();
      const activeEl = document.activeElement;
      return {
        rangeCount: sel?.rangeCount ?? 0,
        isCollapsed: sel?.isCollapsed ?? true,
        anchorNodeName: sel?.anchorNode?.nodeName ?? null,
        anchorOffset: sel?.anchorOffset ?? 0,
        focusNodeName: sel?.focusNode?.nodeName ?? null,
        focusOffset: sel?.focusOffset ?? 0,
        activeElementTag: activeEl?.tagName ?? null,
        editorHasFocus: el.contains(activeEl),
      };
    });
  }

  /**
   * Wait for the editor to have focus.
   * Use after format operations since the iframe's FORM_DATA processing uses rAF
   * and focus may not be restored immediately when the admin's toolbar updates.
   */
  async waitForEditorFocus(
    editor: Locator,
    options: { timeout?: number } = {}
  ): Promise<void> {
    const timeout = options.timeout ?? 5000;
    await expect(async () => {
      const sel = await this.getSelectionInfo(editor);
      if (!sel.editorHasFocus) {
        // Debug: log where focus actually is
        const topActiveEl = await this.page.evaluate(() => document.activeElement?.tagName);
        console.log(`[waitForEditorFocus] Focus NOT in editor. activeElementTag=${sel.activeElementTag} topActiveEl=${topActiveEl}`);
      }
      expect(sel.editorHasFocus).toBe(true);
    }).toPass({ timeout });
  }

  /**
   * Wait for the selection in the editor to be stable (not changing between polls).
   * Catches races where a re-render disrupts the selection between a check and typing.
   * @param editor - The editor locator
   * @param expected - Expected selection properties to match
   * @param options - Options including timeout and stability gap
   */
  async waitForStableSelection(
    editor: Locator,
    expected: { editorHasFocus?: boolean; isCollapsed?: boolean },
    options: { timeout?: number; stabilityMs?: number } = {}
  ): Promise<void> {
    const timeout = options.timeout ?? 10000;
    const stabilityMs = options.stabilityMs ?? 200;
    await expect(async () => {
      const sel1 = await this.getSelectionInfo(editor);
      // Check expected properties
      if (expected.editorHasFocus !== undefined) {
        expect(sel1.editorHasFocus).toBe(expected.editorHasFocus);
      }
      if (expected.isCollapsed !== undefined) {
        expect(sel1.isCollapsed).toBe(expected.isCollapsed);
      }
      // Wait and check again — selection must be stable
      await this.page.waitForTimeout(stabilityMs);
      const sel2 = await this.getSelectionInfo(editor);
      expect(sel2.editorHasFocus).toBe(sel1.editorHasFocus);
      expect(sel2.isCollapsed).toBe(sel1.isCollapsed);
      expect(sel2.anchorOffset).toBe(sel1.anchorOffset);
      expect(sel2.focusOffset).toBe(sel1.focusOffset);
    }).toPass({ timeout });
  }

  /**
   * Wait for the cursor to be at a specific position in the editor.
   * Use after format operations to ensure selection is fully restored before typing.
   * @param editor - The editor locator
   * @param expectedTextBefore - The expected text before the cursor (stripped of ZWS)
   * @param options - Options including timeout
   */
  async waitForCursorPosition(
    editor: Locator,
    expectedTextBefore: string,
    options: { timeout?: number } = {}
  ): Promise<void> {
    const timeout = options.timeout ?? 5000;
    await expect(async () => {
      const pos = await this.getTextAroundCursor(editor);
      if (pos.textBefore !== expectedTextBefore) {
        console.log(`[waitForCursorPosition] Expected textBefore="${expectedTextBefore}" but got "${pos.textBefore}"`);
      }
      expect(pos.textBefore).toBe(expectedTextBefore);
    }).toPass({ timeout });
  }

  /**
   * Get the visible text before and after the cursor position.
   * Uses Range APIs to get accurate text regardless of DOM structure.
   * Strips ZWS characters to return only visible text.
   */
  async getTextAroundCursor(editor: Locator): Promise<{
    textBefore: string;
    textAfter: string;
  }> {
    return await editor.evaluate((el) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        return { textBefore: '', textAfter: '' };
      }

      const range = sel.getRangeAt(0);
      const ZWS = '\u200B\uFEFF';

      // Get text before cursor
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(el);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const textBefore = beforeRange.toString().replace(new RegExp(`[${ZWS}]`, 'g'), '').replace(/\u00A0/g, ' ');

      // Get text after cursor
      const afterRange = document.createRange();
      afterRange.selectNodeContents(el);
      afterRange.setStart(range.endContainer, range.endOffset);
      const textAfter = afterRange.toString().replace(new RegExp(`[${ZWS}]`, 'g'), '').replace(/\u00A0/g, ' ');

      return { textBefore, textAfter };
    });
  }

  /**
   * Get the number of blocks rendered in the iframe.
   */
  async getBlockCountInIframe(): Promise<number> {
    const iframe = this.getIframe();
    const blocks = iframe.locator('[data-block-uid]');
    return await blocks.count();
  }

  /**
   * Get the text content of a block in the iframe.
   * Handles both mock frontend (descendant) and Nuxt frontend (same element) patterns.
   */
  async getBlockTextInIframe(blockId: string): Promise<string> {
    const iframe = this.getIframe();
    // Try descendant first (mock frontend: data-block-uid > [data-edit-text])
    let editor = iframe.locator(`[data-block-uid="${blockId}"] [data-edit-text]`).first();

    if ((await editor.count()) === 0) {
      // Nuxt pattern: data-block-uid and data-edit-text on same element
      editor = iframe.locator(`[data-block-uid="${blockId}"][data-edit-text]`).first();
    }

    // Wait a moment for any pending mutations to complete
    await this.page.waitForTimeout(100);

    return (await editor.textContent()) || '';
  }

  /**
   * Get the editor locator for a block.
   * Handles both mock frontend (descendant) and Nuxt frontend (same element) patterns.
   *
   * @param blockId - The block UID
   * @param fieldName - Optional field name to target a specific editable field (e.g., 'title', 'description')
   * @returns The editor locator
   */
  async getEditorLocator(blockId: string, fieldName?: string): Promise<Locator> {
    const iframe = this.getIframe();

    if (fieldName) {
      // Descendant or same-element (Nuxt puts both attrs on same element)
      return iframe.locator(
        `[data-block-uid="${blockId}"] [data-edit-text="${fieldName}"]`,
      ).or(iframe.locator(
        `[data-block-uid="${blockId}"][data-edit-text="${fieldName}"]`,
      ));
    }

    // No field name — match any contenteditable in the block (descendant or same-element)
    return iframe.locator(
      `[data-block-uid="${blockId}"] [contenteditable="true"]`,
    ).first().or(iframe.locator(
      `[data-block-uid="${blockId}"][contenteditable="true"]`,
    ));
  }

  /**
   * Get the text content of an editor, stripping ZWS characters.
   * ZWS characters (\u200B, \uFEFF) are inserted for cursor positioning
   * but are invisible to users, so tests should verify what users see.
   */
  async getCleanTextContent(editor: Locator): Promise<string> {
    const text = (await editor.textContent()) || '';
    // Strip ZWS and normalize NBSP to regular space, then trim whitespace
    // NBSP (U+00A0) is inserted by browsers in certain contexts near ZWS nodes
    return text.replace(/[\u200B\uFEFF]/g, '').replace(/\u00A0/g, ' ').trim();
  }

  /**
   * Wait for editor text to match a regex pattern.
   * Useful for waiting until text changes stabilize after typing or formatting.
   * Uses textContent() directly to preserve whitespace (toHaveText normalizes it).
   */
  async waitForEditorText(
    editor: Locator,
    pattern: RegExp | string,
    options: { timeout?: number } = {}
  ): Promise<string> {
    const timeout = options.timeout ?? 5000;
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    let text = '';
    await expect(async () => {
      text = (await editor.textContent()) || '';
      // Strip only truly invisible characters (ZWS, word joiner) - don't convert to space
      // Keep NBSP as regular space since it's a visible space character
      // Don't collapse multiple spaces - that could hide missing space bugs
      text = text
        .replace(/[\uFEFF\u200B\u2060]/g, '') // Remove invisible chars
        .replace(/\u00A0/g, ' ') // Convert NBSP to regular space
        .trim();
      expect(text).toMatch(regex);
    }).toPass({ timeout });
    return text;
  }

  /**
   * Get the CSS selector for a format type that works with both frontends.
   * Mock frontend uses inline styles, Nuxt uses semantic tags.
   */
  getFormatSelector(format: 'bold' | 'italic'): string {
    return format === 'bold'
      ? 'span[style*="font-weight: bold"], strong, b'
      : 'span[style*="font-style: italic"], em, i';
  }

  /**
   * Wait for formatted text (bold/italic) to appear in the editor.
   * Useful for waiting until formatting has been applied after Ctrl+B or toolbar clicks.
   */
  async waitForFormattedText(
    editor: Locator,
    pattern: RegExp | string,
    format: 'bold' | 'italic',
    options: { timeout?: number } = {},
  ): Promise<void> {
    const timeout = options.timeout ?? 5000;
    const selector = this.getFormatSelector(format);
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    // Use filter to find elements matching the pattern, first() handles multiple matches
    await expect(editor.locator(selector).filter({ hasText: regex }).first()).toBeVisible({ timeout });
  }

  /**
   * Wait for formatted text (bold/italic) to be removed from the editor.
   * Useful for waiting until formatting has been removed after toggling off.
   */
  async waitForFormattingRemoved(
    editor: Locator,
    format: 'bold' | 'italic',
    options: { timeout?: number } = {},
  ): Promise<void> {
    const timeout = options.timeout ?? 5000;
    const selector = this.getFormatSelector(format);

    await expect(editor.locator(selector)).not.toBeVisible({ timeout });
  }

  /**
   * Check if a specific block is selected in the iframe.
   * Verifies that:
   * 1. Block UI overlays are visible (toolbar, outline, add button)
   * 2. They are positioned correctly relative to the block (toolbar above, add button below)
   * 3. Elements are horizontally aligned with the block
   */
  async isBlockSelectedInIframe(blockIds: string | string[]): Promise<{ ok: boolean; reason?: string }> {
    try {
      // Normalize to array
      const ids = Array.isArray(blockIds) ? blockIds : [blockIds];

      // Verify essential UI overlays are visible (toolbar and outline)
      // Note: add button visibility/positioning is checked separately by verifyBlockUIPositioning
      const toolbar = this.page.locator('.quanta-toolbar');
      const outline = this.page.locator('.volto-hydra-block-outline');

      const toolbarVisible = await toolbar.isVisible();
      // For tall blocks (e.g. search), the outline may extend beyond the viewport
      // after async content rendering causes a scroll. Check if the outline exists
      // and at least partially intersects the viewport rather than requiring full visibility.
      const outlineVisible = await outline.isVisible();
      let outlinePartiallyVisible = outlineVisible;
      if (!outlineVisible && await outline.count() > 0) {
        const bbox = await outline.boundingBox();
        if (bbox) {
          const viewportSize = this.page.viewportSize();
          if (viewportSize) {
            outlinePartiallyVisible =
              bbox.x + bbox.width > 0 &&
              bbox.x < viewportSize.width &&
              bbox.y + bbox.height > 0 &&
              bbox.y < viewportSize.height;
          }
        }
      }

      if (!toolbarVisible || !outlinePartiallyVisible) {
        return {
          ok: false,
          reason: `Overlays not visible: toolbar=${toolbarVisible}, outline=${outlinePartiallyVisible}`,
        };
      }

      // Verify the outline covers the block(s)
      // For multiple blocks, compute combined bounding box
      const blockBox = await this.getCombinedBlockBoundingBox(ids);
      const outlineBox = await this.getBlockOutlineBoundingBox();

      if (!blockBox || !outlineBox) {
        return {
          ok: false,
          reason: `Missing bounding boxes: block=${!!blockBox}, outline=${!!outlineBox}`,
        };
      }

      // Check if outline covers this specific block
      // Outline is either a full box around the block, or a bottom line
      const tolerance = 20;

      // Check horizontal alignment (X and width should match)
      const xDiff = Math.abs(blockBox.x - outlineBox.x);
      const widthDiff = Math.abs(blockBox.width - outlineBox.width);

      if (xDiff > tolerance || widthDiff > tolerance) {
        return {
          ok: false,
          reason: `Outline not horizontally aligned. Block: x=${blockBox.x.toFixed(0)} w=${blockBox.width.toFixed(0)}, Outline: x=${outlineBox.x.toFixed(0)} w=${outlineBox.width.toFixed(0)}`,
        };
      }

      // Check vertical alignment
      // If outline is a full box: top should match block top, height should match
      // If outline is a bottom line: top should be at block bottom
      const isFullBox = outlineBox.height > 10;
      if (isFullBox) {
        // Full box - should surround the block
        const topDiff = Math.abs(blockBox.y - outlineBox.y);
        const heightDiff = Math.abs(blockBox.height - outlineBox.height);
        if (topDiff > tolerance || heightDiff > tolerance) {
          return {
            ok: false,
            reason: `Outline box not around block. Block: y=${blockBox.y.toFixed(0)} h=${blockBox.height.toFixed(0)}, Outline: y=${outlineBox.y.toFixed(0)} h=${outlineBox.height.toFixed(0)}`,
          };
        }
      } else {
        // Bottom line - should be at block's bottom edge
        const blockBottom = blockBox.y + blockBox.height;
        const bottomDiff = Math.abs(blockBottom - outlineBox.y);
        if (bottomDiff > tolerance) {
          return {
            ok: false,
            reason: `Outline line not at block bottom. Block bottom: ${blockBottom.toFixed(0)}, Outline Y: ${outlineBox.y.toFixed(0)}, diff: ${bottomDiff.toFixed(0)}`,
          };
        }
      }

      return { ok: true };
    } catch (error) {
      // If positioning verification fails, the block is not properly selected
      return { ok: false, reason: `Positioning verification error: ${error}` };
    }
  }

  /**
   * Get the bounding box of the Quanta toolbar overlay in the parent window.
   */
  async getToolbarBoundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const toolbar = this.page.locator('.quanta-toolbar');
    return await toolbar.boundingBox();
  }

  /**
   * Get the bounding box of the block outline overlay in the parent window.
   */
  async getBlockOutlineBoundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const outline = this.page.locator('.volto-hydra-block-outline');
    return await outline.boundingBox();
  }

  /**
   * Monitor the outline position during an action and check if it ever appears at an invalid position.
   * Returns true if the outline was ever at a bad position (x < minX or visible when should be hidden).
   *
   * @param action - The async action to perform while monitoring
   * @param minX - Minimum acceptable X position (outline going left of this is bad)
   * @param checkInterval - How often to check position in ms
   * @returns Object with badPositionDetected and details about what was found
   */
  async monitorOutlinePositionDuringAction(
    action: () => Promise<void>,
    minX: number = 0,
    checkInterval: number = 16,
  ): Promise<{ badPositionDetected: boolean; minXSeen: number | null; positions: Array<{ x: number; y: number; visible: boolean }> }> {
    const outline = this.page.locator('.volto-hydra-block-outline');
    const positions: Array<{ x: number; y: number; visible: boolean }> = [];
    let badPositionDetected = false;
    let minXSeen: number | null = null;
    let monitoring = true;

    // Start monitoring in background
    const monitorPromise = (async () => {
      while (monitoring) {
        const visible = await outline.isVisible().catch(() => false);
        if (visible) {
          const box = await outline.boundingBox().catch(() => null);
          if (box) {
            positions.push({ x: box.x, y: box.y, visible: true });
            if (minXSeen === null || box.x < minXSeen) {
              minXSeen = box.x;
            }
            if (box.x < minX) {
              badPositionDetected = true;
            }
          }
        } else {
          positions.push({ x: 0, y: 0, visible: false });
        }
        await new Promise((r) => setTimeout(r, checkInterval));
      }
    })();

    // Perform the action
    await action();

    // Wait a bit more after action completes to catch any delayed updates
    await new Promise((r) => setTimeout(r, 100));

    // Stop monitoring
    monitoring = false;
    await monitorPromise.catch(() => {}); // Ignore any errors from the monitoring loop

    return { badPositionDetected, minXSeen, positions };
  }

  /**
   * Get the bounding box of the add button overlay in the parent window.
   */
  async getAddButtonBoundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const addButton = this.page.locator('.volto-hydra-add-button');
    return await addButton.boundingBox();
  }

  /**
   * Helper to clarify coordinate systems.
   * Playwright's iframe.locator().boundingBox() returns coordinates in the PAGE viewport,
   * which for elements inside an iframe means coordinates relative to the PARENT PAGE,
   * NOT relative to the iframe's internal document. So no conversion is needed.
   */
  async getBoundsInParentCoordinates(
    elementBox: { x: number; y: number; width: number; height: number }
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    // Playwright already returns page-relative coordinates, even for iframe elements
    return elementBox;
  }

  /**
   * Get the bounding box of a block in the iframe, in parent window coordinates.
   * Handles multi-element blocks (multiple elements with same UID) by computing combined bounding box.
   */
  async getBlockBoundingBoxInIframe(blockId: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const iframe = this.getIframe();
    const blockLocator = iframe.locator(`[data-block-uid="${blockId}"]`);
    const allElements = await blockLocator.all();

    if (allElements.length === 0) return null;

    // For multi-element blocks, compute combined bounding box
    if (allElements.length > 1) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const el of allElements) {
        const rect = await el.boundingBox();
        if (rect) {
          minX = Math.min(minX, rect.x);
          minY = Math.min(minY, rect.y);
          maxX = Math.max(maxX, rect.x + rect.width);
          maxY = Math.max(maxY, rect.y + rect.height);
        }
      }
      if (minX === Infinity) return null;
      return await this.getBoundsInParentCoordinates({
        x: minX, y: minY, width: maxX - minX, height: maxY - minY
      });
    }

    // Single element
    const blockBox = await blockLocator.first().boundingBox();
    if (!blockBox) return null;

    // Convert from iframe page coordinates to parent window coordinates
    return await this.getBoundsInParentCoordinates(blockBox);
  }

  /**
   * Get the combined bounding box for one or more blocks.
   * For template instances, pass all child block IDs to get the combined bounds.
   */
  async getCombinedBlockBoundingBox(blockIds: string[]): Promise<{ x: number; y: number; width: number; height: number } | null> {
    if (blockIds.length === 0) return null;

    if (blockIds.length === 1) {
      return await this.getBlockBoundingBoxInIframe(blockIds[0]);
    }

    // Multiple blocks - compute combined bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const blockId of blockIds) {
      const box = await this.getBlockBoundingBoxInIframe(blockId);
      if (box) {
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
      }
    }

    if (minX === Infinity) return null;

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Check if the outline is a full border or just a bottom line.
   * Returns the style information about the outline.
   */
  async getOutlineStyle(): Promise<{ isFull: boolean; height: number }> {
    const outline = this.page.locator('.volto-hydra-block-outline');
    const height = await outline.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return parseFloat(style.height);
    });

    return {
      isFull: height > 10, // Full outline is block height + 4px, line is 3px
      height
    };
  }

  /**
   * Verify the positioning relationships between block UI elements and the block.
   * Returns measurements for toolbar, add button, and alignment.
   */
  async verifyBlockUIPositioning(
    blockId: string,
    options: { timeout?: number } = {},
  ): Promise<{
    toolbarAboveBlock: number;
    addButtonBelowBlock: number;
    addButtonRightOfBlock: number;
    addButtonDirection: 'bottom' | 'right' | 'unknown';
    horizontalAlignment: boolean;
  }> {
    const timeout = options.timeout ?? 5000;
    const startTime = Date.now();

    // Poll until the add button is positioned for this block (top or bottom aligned)
    // This handles the race condition where React has rendered but browser hasn't painted
    while (Date.now() - startTime < timeout) {
      const blockBox = await this.getBlockBoundingBoxInIframe(blockId);
      const toolbarBox = await this.getToolbarBoundingBox();
      const addButtonBox = await this.getAddButtonBoundingBox();

      if (blockBox && toolbarBox && addButtonBox) {
        // Check if add button is positioned for THIS block (either top-aligned or bottom-aligned)
        const addButtonTopAligned = Math.abs(addButtonBox.y - blockBox.y) < 30;
        const addButtonBottomAligned =
          Math.abs(addButtonBox.y - (blockBox.y + blockBox.height)) < 30;

        if (addButtonTopAligned || addButtonBottomAligned) {
          // Add button is positioned for this block, return the measurements
          return this.measureBlockUIPositioningInternal(
            blockBox,
            toolbarBox,
            addButtonBox,
          );
        }
      }

      // Wait a bit before polling again
      await this.page.waitForTimeout(50);
    }

    // Timeout - return measurements anyway (test will likely fail with useful info)
    const blockBox = await this.getBlockBoundingBoxInIframe(blockId);
    const toolbarBox = await this.getToolbarBoundingBox();
    const addButtonBox = await this.getAddButtonBoundingBox();

    if (!blockBox || !toolbarBox || !addButtonBox) {
      throw new Error(
        `Missing bounding boxes: block=${!!blockBox}, toolbar=${!!toolbarBox}, addButton=${!!addButtonBox}`,
      );
    }

    return this.measureBlockUIPositioningInternal(
      blockBox,
      toolbarBox,
      addButtonBox,
    );
  }

  /**
   * Internal helper to calculate positioning measurements from bounding boxes.
   */
  private measureBlockUIPositioningInternal(
    blockBox: { x: number; y: number; width: number; height: number },
    toolbarBox: { x: number; y: number; width: number; height: number },
    addButtonBox: { x: number; y: number; width: number; height: number },
  ): {
    toolbarAboveBlock: number;
    addButtonBelowBlock: number;
    addButtonRightOfBlock: number;
    addButtonDirection: 'bottom' | 'right' | 'unknown';
    horizontalAlignment: boolean;
  } {
    // Distance from bottom of block to top of add button (positive = button is below)
    const addButtonBelowBlock = addButtonBox.y - (blockBox.y + blockBox.height);
    // Distance from right edge of block to left edge of add button (positive = button is to right)
    const addButtonRightOfBlock = addButtonBox.x - (blockBox.x + blockBox.width);

    // Determine direction based on position
    // "bottom" = button's top is near/below block's bottom (within 20px)
    // "right" = button's top is near block's top (top-aligned, within 20px)
    //           OR button is constrained inside block at bottom-right corner
    let addButtonDirection: 'bottom' | 'right' | 'unknown' = 'unknown';
    const addButtonTopAligned = Math.abs(addButtonBox.y - blockBox.y) < 20;
    const addButtonBottomAligned =
      addButtonBelowBlock >= -5 && addButtonBelowBlock < 20;

    // Detect constrained positioning: button is inside block (negative values)
    // but positioned near the right edge (typical for horizontal containers when space is tight)
    const isConstrainedRight =
      addButtonBelowBlock < -20 && // Well above block bottom (inside block)
      addButtonRightOfBlock < 0 && // Inside block horizontally
      addButtonRightOfBlock > -50; // But near right edge

    if (addButtonBottomAligned && !addButtonTopAligned) {
      addButtonDirection = 'bottom';
    } else if (addButtonTopAligned || isConstrainedRight) {
      // Top-aligned OR constrained at bottom-right means 'right' direction
      addButtonDirection = 'right';
    }

    return {
      // Distance from bottom of toolbar to top of block
      toolbarAboveBlock: blockBox.y - (toolbarBox.y + toolbarBox.height),
      // Distance from bottom of block to top of add button
      addButtonBelowBlock,
      // Distance from right edge of block to left edge of add button
      addButtonRightOfBlock,
      // Detected direction of add button relative to block
      addButtonDirection,
      // Check if toolbar and block are horizontally aligned (within 2px tolerance)
      horizontalAlignment: Math.abs(toolbarBox.x - blockBox.x) < 2,
    };
  }

  /**
   * Save the current content being edited.
   * Clicks Save, waits for navigation out of /edit, and waits for iframe to render.
   */
  /**
   * Press the quanta toolbar's "reveal optional fields" toggle for the selected
   * block (issue #296).
   *
   * Needed after emptying a field inline: "no data ⇒ no element" means clearing a
   * media or link field removes its element, so getting an inline target back is
   * an explicit ask. (Replacing an image doesn't need this — the toolbar's image
   * button swaps it in one click without clearing first.)
   */
  async revealOptionalFields(): Promise<void> {
    const toggle = this.page.locator('.optional-fields-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();
  }

  async saveContent(): Promise<void> {
    const saveButton = this.page.locator('#toolbar-save, button:has-text("Save")');
    await saveButton.click();
    // Wait for URL to navigate away from /edit (save triggers redirect to view mode)
    await this.page.waitForURL((url) => !url.pathname.endsWith('/edit'), { timeout: 15000 });
    // Wait for iframe to load view-mode content
    await this.waitForIframeReady();
  }

  /**
   * Switch the iframe to a saved frontend by its display name.
   * Opens the toolbar Frontend & Viewport panel, clicks the entry,
   * and waits for the iframe's `src` to actually update to that origin.
   *
   * The panel closes itself on click (FrontendSwitcherPanel.jsx calls
   * closeMenu()), so we don't need to dismiss it afterward.
   */
  async switchFrontend(name: string, expectedOrigin: string): Promise<void> {
    await this.page.locator('#toolbar-frontend-switcher').click();
    const panel = this.page.locator('.frontend-switcher-panel');
    await panel.waitFor({ state: 'visible', timeout: 5000 });
    // Exact-text match on the label so a name like "B" doesn't substring-match
    // unrelated entries (e.g. "Nuxt Blog").
    await panel
      .locator('.frontend-switcher-url-item')
      .filter({ has: this.page.locator(`.pastanaga-menu-label:text-is("${name}")`) })
      .click();
    // Iframe `src` updates on the next React tick after the dispatch.
    // Wait for the origin to reflect the choice — confirms the switch
    // actually went through, not just the UI click.
    await expect(async () => {
      const src = await this.page.locator('#previewIframe').getAttribute('src');
      expect(src).toBeTruthy();
      expect(new URL(src!).origin).toBe(expectedOrigin);
    }).toPass({ timeout: 5000 });
  }

  /**
   * Get cursor position information for a contenteditable element.
   * Returns details about the cursor position, selection, and text content.
   */
  async getCursorInfo(editor: any): Promise<{
    text: string;
    textLength: number;
    selectionCollapsed: boolean;
    cursorOffset: number | undefined;
    cursorContainerText: string;
    isFocused: boolean;
    insideNodeId: boolean;
  }> {
    return await editor.evaluate((el: HTMLElement) => {
      const doc = el.ownerDocument;
      const selection = doc.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const text = el.innerText || el.textContent || '';

      // Check if cursor is inside a data-node-id element
      let insideNodeId = false;
      if (range?.startContainer) {
        const node = range.startContainer;
        // Check if this node or any ancestor (up to and including el) has data-node-id
        let current: Node | null = node;
        while (current) {
          if (current.nodeType === Node.ELEMENT_NODE) {
            const elem = current as Element;
            if (elem.hasAttribute('data-node-id')) {
              insideNodeId = true;
              break;
            }
          }
          if (current === el) break; // Include el in the check
          current = current.parentNode;
        }
      }

      return {
        text: text,
        textLength: text.length,
        selectionCollapsed: selection?.isCollapsed ?? true,
        cursorOffset: range?.startOffset,
        cursorContainerText: range?.startContainer?.textContent || '',
        isFocused: doc.activeElement === el,
        insideNodeId,
      };
    });
  }

  /**
   * Assert that the cursor is at the end of the text in a contenteditable element.
   * Throws an error if the cursor position is not as expected.
   */
  async assertCursorAtEnd(editor: any, blockId: string, expectedText?: string): Promise<void> {
    const cursorInfo = await this.getCursorInfo(editor);

    if (!cursorInfo.isFocused) {
      throw new Error(
        `Block ${blockId} lost focus. ` +
        `Expected text: "${expectedText || 'N/A'}", actual: "${cursorInfo.text}"`
      );
    }

    if (!cursorInfo.selectionCollapsed) {
      throw new Error(
        `Block ${blockId} cursor is not collapsed (text is selected). ` +
        `This indicates the cursor was reset.`
      );
    }

    // Cursor should be at or near the end of the text
    const expectedEnd = cursorInfo.textLength;
    if (cursorInfo.cursorOffset !== undefined &&
        Math.abs(cursorInfo.cursorOffset - expectedEnd) > 2) {
      throw new Error(
        `Block ${blockId} cursor position unexpected. ` +
        `Expected near end (${expectedEnd}), but at offset ${cursorInfo.cursorOffset}. ` +
        `Text: "${cursorInfo.text}". This indicates cursor was reset.`
      );
    }
  }

  /**
   * Assert that the text content matches what was expected.
   * Allows for some variation in whitespace and formatting.
   */
  async assertTextMatches(editor: any, blockId: string, expectedText: string): Promise<void> {
    const cursorInfo = await this.getCursorInfo(editor);

    // Check if the text contains at least the beginning of expected text
    if (!cursorInfo.text.includes(expectedText.substring(0, Math.min(5, expectedText.length)))) {
      throw new Error(
        `Block ${blockId} text doesn't match after typing. ` +
        `Expected: "${expectedText}", actual: "${cursorInfo.text}"`
      );
    }
  }

  /**
   * Move cursor to the end of the text in a contenteditable element.
   * Finds the last non-whitespace text node and places cursor at the end of it.
   * This works correctly on both mock (flat structure) and Nuxt (nested p/span structure).
   */
  /**
   * Wait for hydra.js pointer-events blocking to clear.
   * During re-render and format operations, hydra.js injects a <style> with
   * `body { pointer-events: none }` into <head>. This must be cleared before
   * any cursor or click interaction in the iframe.
   */
  async waitForPointerUnblocked(timeout = 5000): Promise<void> {
    const iframe = this.getIframe();
    await expect(async () => {
      const blocked = await iframe.locator('body').evaluate((body: any) => {
        return body.ownerDocument.defaultView.getComputedStyle(body).pointerEvents === 'none';
      });
      expect(blocked, 'pointer-events still blocked').toBe(false);
    }).toPass({ timeout });
  }

  async moveCursorToEnd(editor: any): Promise<void> {
    await this.waitForPointerUnblocked();

    await editor.evaluate((el: any) => {
      const range = el.ownerDocument.createRange();
      const selection = el.ownerDocument.defaultView.getSelection();

      // Find all text nodes, keeping only ones with actual content
      const walker = el.ownerDocument.createTreeWalker(
        el,
        NodeFilter.SHOW_TEXT,
        null,
      );
      let lastContentTextNode = null;
      let node;
      while ((node = walker.nextNode())) {
        // Skip whitespace-only text nodes (newlines, spaces between elements)
        if (node.textContent && node.textContent.trim().length > 0) {
          lastContentTextNode = node;
        }
      }

      if (lastContentTextNode) {
        // Place cursor at end of last content text node
        range.setStart(
          lastContentTextNode,
          lastContentTextNode.textContent?.length || 0,
        );
        range.collapse(true);
      } else {
        // Fallback: no text nodes, collapse to end of container
        range.selectNodeContents(el);
        range.collapse(false);
      }

      selection.removeAllRanges();
      selection.addRange(range);
    });

    // Wait for the selection to settle at a collapsed position at the end
    await expect(async () => {
      const selInfo = await editor.evaluate((el: any) => {
        const sel = el.ownerDocument.defaultView.getSelection();
        return { collapsed: sel?.isCollapsed, offset: sel?.anchorOffset, text: sel?.anchorNode?.textContent?.substring(0, 20) };
      });
      expect(selInfo.collapsed, `Selection not collapsed: ${JSON.stringify(selInfo)}`).toBe(true);
    }).toPass({ timeout: 2000 });
  }

  /**
   * Move cursor to the start of the text in a contenteditable element.
   * Finds the first text node and places cursor at the start of it.
   * This works correctly on both mock (flat structure) and Nuxt (nested p/span structure).
   */
  async moveCursorToStart(editor: any): Promise<void> {
    await editor.evaluate((el: any) => {
      const range = el.ownerDocument.createRange();
      const selection = el.ownerDocument.defaultView.getSelection();

      // Find the first text node in the element
      const walker = el.ownerDocument.createTreeWalker(
        el,
        NodeFilter.SHOW_TEXT,
        null,
      );
      const firstTextNode = walker.nextNode();

      if (firstTextNode) {
        // Place cursor at start of first text node
        range.setStart(firstTextNode, 0);
        range.collapse(true);
      } else {
        // Fallback: no text nodes, collapse to start of container
        range.selectNodeContents(el);
        range.collapse(true);
      }

      selection.removeAllRanges();
      selection.addRange(range);
    });
  }

  /**
   * Get click coordinates for a specific character position in a text element.
   * Uses the Range API to find the exact pixel position of a character.
   *
   * @param editor - The element containing the text
   * @param charPosition - The character offset to get coordinates for (0-based)
   * @returns Click position relative to the element, or null if not found
   */
  async getClickPositionForCharacter(
    editor: Locator,
    charPosition: number,
  ): Promise<{ x: number; y: number } | null> {
    return await editor.evaluate(
      (el: HTMLElement, pos: number) => {
        // Find the first text node with actual content (skip whitespace-only nodes)
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        while (textNode && (!textNode.textContent || !textNode.textContent.trim())) {
          textNode = walker.nextNode();
        }
        if (!textNode || !textNode.textContent) return null;

        // Clamp position to valid range
        const clampedPos = Math.min(pos, textNode.textContent.length);

        // Create a range at the specified position
        const range = document.createRange();
        range.setStart(textNode, clampedPos);
        range.collapse(true);

        // Get the bounding rect of that position
        const rect = range.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();

        // Return position relative to element
        return {
          x: rect.left - elRect.left,
          y: rect.top - elRect.top + rect.height / 2,
        };
      },
      charPosition,
    );
  }

  /**
   * Move cursor to a specific position in a contenteditable element.
   * Uses Selection.modify() to move by visible characters, handling Vue/Nuxt empty text nodes.
   *
   * @param editor - The contenteditable element
   * @param position - The character offset position to move to (0-based)
   */
  async moveCursorToPosition(editor: any, position: number): Promise<void> {
    // selection.modify() steps the caret one grapheme at a time from the
    // element start. On the slow CI static build a single pass can land short
    // (e.g. the editable isn't focused yet, or a text-node boundary eats a
    // step), leaving the caret at pos-1 — so typing "Beautiful " lands after
    // "Hello" instead of "Hello ", yielding "HelloBeautiful  World". Measure the
    // caret's absolute offset after stepping and re-step until it genuinely
    // reaches `position`; don't trust the loop to arrive on the first pass.
    await expect(async () => {
      const offset = await editor.evaluate(
        (el: any, pos: number) => {
          const doc = el.ownerDocument;
          const selection = doc.defaultView.getSelection();

          // Collapse the caret to the start of the element.
          const range = doc.createRange();
          range.selectNodeContents(el);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);

          // Step forward by visible characters.
          for (let i = 0; i < pos; i++) {
            selection.modify('move', 'forward', 'character');
          }

          // Report the caret's absolute character offset from the element start
          // so the caller can confirm it actually reached `pos`.
          const caret = selection.getRangeAt(0);
          const measure = doc.createRange();
          measure.selectNodeContents(el);
          measure.setEnd(caret.startContainer, caret.startOffset);
          return measure.toString().length;
        },
        position,
      );
      expect(offset).toBe(position);
    }).toPass({ timeout: 5000 });
  }

  /**
   * Check if an editor element is currently focused.
   *
   * @param editor - The editor element to check
   * @returns Object with isFocused boolean and activeElement info
   */
  async isEditorFocused(editor: any): Promise<{
    isFocused: boolean;
    activeElement: string;
  }> {
    return await editor.evaluate((el: HTMLElement) => {
      const doc = el.ownerDocument;
      const activeEl = doc.activeElement;
      const activeTag = activeEl?.tagName;
      const activeEditable = activeEl?.getAttribute?.('data-edit-text');
      return {
        isFocused: activeEl === el,
        activeElement: `${activeTag}[data-edit-text="${activeEditable}"]`,
      };
    });
  }

  /**
   * Check if the cursor is at a specific position in the editor.
   *
   * @param editor - The editor element to check
   * @param expectedPosition - The expected cursor position (0-based)
   * @param blockId - Optional block ID for error messages
   * @throws Error if cursor is not at the expected position, not focused, or not collapsed
   */
  async assertCursorAtPosition(
    editor: any,
    expectedPosition: number,
    blockId?: string,
  ): Promise<void> {
    const cursorInfo = await this.getCursorInfo(editor);
    const blockDesc = blockId ? `Block ${blockId}` : 'Editor';

    if (!cursorInfo.isFocused) {
      throw new Error(
        `${blockDesc}: Lost focus. Expected cursor at position ${expectedPosition}. ` +
          `Text: "${cursorInfo.text}"`,
      );
    }

    if (!cursorInfo.selectionCollapsed) {
      throw new Error(
        `${blockDesc}: Cursor not collapsed (text is selected). ` +
          `Expected cursor at position ${expectedPosition}. This indicates cursor was reset.`,
      );
    }

    if (
      cursorInfo.cursorOffset !== undefined &&
      cursorInfo.cursorOffset !== expectedPosition
    ) {
      throw new Error(
        `${blockDesc}: Cursor position wrong. ` +
          `Expected at position ${expectedPosition}, but at ${cursorInfo.cursorOffset}. ` +
          `Text: "${cursorInfo.text}". This indicates cursor was reset.`,
      );
    }
  }

  /**
   * Enter edit mode on a specific block and return the editor element.
   * This helper checks if already editable/focused, and only clicks if necessary.
   *
   * Uses [data-edit-text] selector instead of [contenteditable="true"] because
   * contenteditable may be temporarily set to "false" when the editor is blocked
   * during format operations (e.g., waiting for iframe flush to complete).
   *
   * @param blockId - The block UID to enter edit mode on
   * @param fieldName - Optional field name to target (e.g., 'value', 'title'). If not provided, uses first editable field.
   * @returns The editor element, ready for text input
   */
  /**
   * The uid of a block you located by CONTENT or POSITION.
   *
   * Every block-level helper here takes a `blockId`, so a spec that wants "the
   * card I just added" or "the empty block in this grid" has to produce one —
   * and 105 places currently do it by hand, reading the attribute inline. That
   * couples specs to a value which is generated, changes, and means nothing to
   * the person reading the test. Locate the block the way a reader would and
   * resolve the uid here, in the one place that has to know the attribute
   * exists.
   *
   *   const empty = iframe.locator('.nsw-card:has([data-edit-text][data-empty])').first();
   *   await helper.enterEditMode(await helper.getBlockUid(empty), 'title');
   *
   * Resolves from the element itself or the nearest ancestor carrying the
   * attribute, because a component may put `data-block-uid` on a wrapper rather
   * than on the element that matched the content selector.
   */
  async getBlockUid(target: Locator): Promise<string> {
    await target.waitFor({ state: 'attached', timeout: 10000 });
    const uid = await target.evaluate((el) => {
      const owner = (el as Element).closest('[data-block-uid]');
      return owner?.getAttribute('data-block-uid') || '';
    });
    if (!uid) {
      throw new Error(
        'getBlockUid: the located element carries no data-block-uid and neither ' +
          'does any ancestor. A block that was just added may not be registered ' +
          'with the bridge yet — wait for it to render before resolving.',
      );
    }
    return uid;
  }

  async enterEditMode(blockId: string, fieldName?: string): Promise<any> {
    const iframe = this.getIframe();

    // Click the block to select it
    const blockContainer = iframe.locator(`[data-block-uid="${blockId}"]`);
    await blockContainer.click();

    // Wait for block selection to be confirmed by Admin UI
    await this.waitForIframeBlockHandle(blockId);

    // Wait for the Quanta toolbar to appear (indicating block is selected)
    await this.waitForBlockSelectedInAdmin(blockId, 5000);

    // Now get the editor element (after block is selected and rendered)
    const editor = await this.getEditorLocator(blockId, fieldName);

    // Click the editor field to focus it
    await editor.click();

    // Wait for contenteditable to become true (may be blocked briefly)
    await expect(editor).toHaveAttribute('contenteditable', 'true', {
      timeout: 5000,
    });

    // Wait for focus to be established (may take a moment after re-renders)
    // Use polling instead of single check to handle race conditions with FORM_DATA re-renders
    await expect(async () => {
      const focusInfo = await this.isEditorFocused(editor);
      if (!focusInfo.isFocused) {
        throw new Error(
          `Block ${blockId} field${fieldName ? ` (${fieldName})` : ''} is not focused. Active element: ${focusInfo.activeElement}`,
        );
      }
    }).toPass({ timeout: 5000 });

    return editor;
  }

  /**
   * Select a range of text in an editor element.
   * The editor element should be a contenteditable element (like a <p> with data-edit-text).
   *
   * @param editor - Locator for the editor element
   * @param startOffset - Character offset to start selection
   * @param endOffset - Character offset to end selection
   */
  async selectTextRange(
    editor: Locator,
    startOffset: number,
    endOffset: number,
  ): Promise<void> {
    await editor.evaluate(
      (el, { start, end }) => {
        const doc = el.ownerDocument;
        const win = doc.defaultView;

        // Helper to find node and offset at a given character position
        // Walks all text nodes, skipping ZWS characters
        const findPositionInTextNodes = (
          targetOffset: number,
        ): { node: Node; offset: number } | null => {
          const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
          let currentOffset = 0;
          let node: Node | null;

          while ((node = walker.nextNode())) {
            // Get text content, filtering out ZWS
            const text = node.textContent || '';
            const cleanText = text.replace(/[\uFEFF\u200B]/g, '');
            const nodeLength = cleanText.length;

            if (currentOffset + nodeLength >= targetOffset) {
              // Target is within this node
              // Calculate offset within this node, accounting for ZWS
              let charsSeen = 0;
              let rawOffset = 0;
              for (let i = 0; i < text.length && charsSeen < targetOffset - currentOffset; i++) {
                if (text[i] !== '\uFEFF' && text[i] !== '\u200B') {
                  charsSeen++;
                }
                rawOffset++;
              }
              return { node, offset: rawOffset };
            }
            currentOffset += nodeLength;
          }
          return null;
        };

        const startPos = findPositionInTextNodes(start);
        const endPos = findPositionInTextNodes(end);

        if (startPos && endPos) {
          const range = doc.createRange();
          range.setStart(startPos.node, startPos.offset);
          range.setEnd(endPos.node, endPos.offset);
          const sel = win?.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      },
      { start: startOffset, end: endOffset },
    );

    // Wait for selection change to propagate
    await this.page.waitForTimeout(100);
  }

  /**
   * Set a text selection that spans from startOffset in startBlockId to
   * endOffset in endBlockId. Same ZWS-aware position logic as selectTextRange
   * but across two blocks in the iframe. Used to simulate a user's cross-block
   * text drag.
   */
  async selectTextAcrossBlocks(
    startBlockId: string,
    startOffset: number,
    endBlockId: string,
    endOffset: number,
  ): Promise<void> {
    const iframe = this.getIframe();
    await iframe.locator('body').evaluate(
      (_body, args) => {
        const findPositionInTextNodes = (root: Element, targetOffset: number) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
          let currentOffset = 0;
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const text = node.textContent || '';
            const cleanText = text.replace(/[﻿​]/g, '');
            const nodeLength = cleanText.length;
            if (currentOffset + nodeLength >= targetOffset) {
              let charsSeen = 0;
              let rawOffset = 0;
              for (let i = 0; i < text.length && charsSeen < targetOffset - currentOffset; i++) {
                if (text[i] !== '﻿' && text[i] !== '​') charsSeen++;
                rawOffset++;
              }
              return { node, offset: rawOffset };
            }
            currentOffset += nodeLength;
          }
          return null;
        };
        const startEl = document.querySelector(`[data-block-uid="${args.startId}"]`);
        const endEl = document.querySelector(`[data-block-uid="${args.endId}"]`);
        if (!startEl || !endEl) throw new Error('blocks not found');
        const startPos = findPositionInTextNodes(startEl, args.startOffset);
        const endPos = findPositionInTextNodes(endEl, args.endOffset);
        if (!startPos || !endPos) throw new Error('text positions not found');
        const range = document.createRange();
        range.setStart(startPos.node, startPos.offset);
        range.setEnd(endPos.node, endPos.offset);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
      },
      { startId: startBlockId, endId: endBlockId, startOffset, endOffset },
    );
    await this.page.waitForTimeout(100);
  }

  /**
   * Edit text in a contenteditable block within the iframe.
   * Handles both cases: block already editable, or needs to be clicked to become editable.
   */
  async editBlockTextInIframe(blockId: string, newText: string): Promise<void> {
    // Enter edit mode and get the editor
    const editor = await this.enterEditMode(blockId);

    // Clear existing text by selecting all within the contenteditable field
    await this.selectAllTextInEditor(editor);

    // Type new text (will replace the selection)
    await editor.pressSequentially(newText, { delay: 10 });

    // ASSERT: Verify cursor and text after typing
    await this.assertTextMatches(editor, blockId, newText);
    await this.assertCursorAtEnd(editor, blockId, newText);
  }

  /**
   * Get the list of visible form field IDs in the sidebar.
   * Returns the field IDs that are currently visible in the sidebar form.
   */
  async getSidebarFormFields(): Promise<string[]> {
    const sidebar = this.page.locator('#sidebar-properties');
    const fieldWrappers = sidebar.locator('[class*="field-wrapper-"]');
    const count = await fieldWrappers.count();

    const fieldNames: string[] = [];
    for (let i = 0; i < count; i++) {
      const classList = await fieldWrappers.nth(i).getAttribute('class');
      if (classList) {
        // Extract field name from "field-wrapper-{name}" in class list
        const match = classList.match(/field-wrapper-(\w+)/);
        if (match) {
          fieldNames.push(match[1]);
        }
      }
    }

    return fieldNames;
  }

  /**
   * Get the value of a specific form field in the sidebar.
   * Works with text inputs, textareas, contenteditable fields, and image widgets.
   * Matches Cypress pattern: #sidebar-properties .field-wrapper-{fieldname}
   */
  async getSidebarFieldValue(fieldName: string): Promise<string | null> {
    const fieldWrapper = this.page.locator(`#sidebar-properties .field-wrapper-${fieldName}`);

    // For image widget (url field), get the src from the displayed image
    if (fieldName === 'url') {
      const img = fieldWrapper.locator('img');
      if (await img.isVisible()) {
        return await img.getAttribute('src');
      }
    }

    // Try standard text inputs and textareas
    const input = fieldWrapper.locator('input[type="text"], input[type="url"], textarea');
    if (await input.isVisible()) {
      return await input.inputValue();
    }

    // Try contenteditable (for slate widget)
    const contentEditable = fieldWrapper.locator('[contenteditable="true"]');
    if (await contentEditable.isVisible()) {
      return await contentEditable.textContent();
    }

    return null;
  }

  /**
   * Check if a specific field exists in the sidebar form.
   * @param fieldName - The field name to check for
   * @param blockTitle - Optional block title to scope to a parent section (e.g., 'Grid', 'Listing').
   *                     If not provided, checks the current block's form (#sidebar-properties).
   */
  async hasSidebarField(fieldName: string, blockTitle?: string): Promise<boolean> {
    let container;
    if (blockTitle) {
      // Scope to a specific parent block section by title
      container = this.page.locator('.parent-block-section').filter({
        has: this.page.locator('.parent-nav', { hasText: new RegExp(blockTitle) }),
      });
    } else {
      // Default: current block's form
      container = this.page.locator('#sidebar-properties');
    }
    const fieldWrapper = container.locator(`.field-wrapper-${fieldName}`);
    return await fieldWrapper.isVisible();
  }

  /**
   * Get the sidebar slate editor locator for a specific field.
   * Returns the contenteditable element for the field's slate widget.
   */
  getSidebarSlateEditor(fieldName: string): Locator {
    return this.page.locator(
      `#sidebar-properties .field-wrapper-${fieldName} [contenteditable="true"]`,
    );
  }

  /**
   * Get all fieldset titles in the sidebar (including accordions).
   * Searches for clickable elements that look like accordion headers.
   */
  async getSidebarFieldsets(): Promise<string[]> {
    const sidebar = this.page.locator('#sidebar-properties');
    // Look for accordion titles in Semantic UI or custom accordion structures
    // Try multiple patterns: .accordion .title, .title, or any clickable div with text
    const accordionSelectors = [
      '.accordion .title',
      '.ui.accordion .title',
      'div[class*="accordion"] > div:first-child',
      '#sidebar-properties > div > div > div:first-child:has(img)'  // Pattern: clickable div with image (expand/collapse icon)
    ];

    const fieldsets: string[] = [];

    for (const selector of accordionSelectors) {
      const accordionTitles = sidebar.locator(selector);
      const count = await accordionTitles.count();

      for (let i = 0; i < count; i++) {
        const text = await accordionTitles.nth(i).textContent();
        if (text && text.trim() && !fieldsets.includes(text.trim())) {
          fieldsets.push(text.trim());
        }
      }

      if (fieldsets.length > 0) {
        break;  // Found accordions with first selector, no need to try others
      }
    }

    return fieldsets;
  }

  /**
   * Check if a fieldset accordion is open.
   * An accordion is considered open if its content area is visible.
   */
  async isFieldsetAccordionOpen(fieldsetTitle: string): Promise<boolean> {
    const sidebar = this.page.locator('#sidebar-properties');

    // Find the accordion title by text content
    const accordionContainer = sidebar.locator(`div:has-text("${fieldsetTitle}")`).first();

    // Check if next sibling (content area) is visible
    // If the accordion uses 'active' class or similar
    const parent = accordionContainer.locator('xpath=..');
    const classAttr = await parent.getAttribute('class');

    if (classAttr && classAttr.includes('active')) {
      return true;
    }

    // Alternative: check if content after title is visible
    // This is a fallback for accordions without explicit active class
    return true; // Assume open by default if we can't determine
  }

  /**
   * Open a fieldset accordion in the sidebar by clicking its title.
   * Ensures the accordion is open (idempotent - won't close if already open).
   */
  async openFieldsetAccordion(fieldsetTitle: string): Promise<void> {
    const sidebar = this.page.locator('#sidebar-properties');

    // Find clickable element containing the fieldset title text
    // Look for the title element that might have an image/icon next to it
    const accordionTitle = sidebar.locator(`div:has-text("${fieldsetTitle}")`).first();

    // Check if accordion content is already visible by looking for active class
    const isActive = await accordionTitle.evaluate((el) => {
      // Check if this accordion title's parent or the title itself has 'active' class
      return el.classList.contains('active') || el.parentElement?.classList.contains('active');
    });

    // Only click if not already active/open
    if (!isActive) {
      await accordionTitle.click();
      // Wait for animation/expansion
      await this.page.waitForTimeout(300);
    }
  }

  /**
   * Close a fieldset accordion in the sidebar by clicking its title.
   * Ensures the accordion is closed (idempotent - won't open if already closed).
   */
  async closeFieldsetAccordion(fieldsetTitle: string): Promise<void> {
    const sidebar = this.page.locator('#sidebar-properties');

    // Find clickable element containing the fieldset title text
    const accordionTitle = sidebar.locator(`div:has-text("${fieldsetTitle}")`).first();

    // Check if accordion content is currently visible
    const isActive = await accordionTitle.evaluate((el) => {
      // Check if this accordion title's parent or the title itself has 'active' class
      return el.classList.contains('active') || el.parentElement?.classList.contains('active');
    });

    // Only click if currently active/open
    if (isActive) {
      await accordionTitle.click();
      // Wait for animation/collapse
      await this.page.waitForTimeout(300);
    }
  }

  /**
   * Set the value of a text field in the sidebar.
   * Matches Cypress pattern: #sidebar-properties #field-{fieldname}
   */
  async setSidebarFieldValue(
    fieldName: string,
    value: string | boolean,
    options: { container?: string } = {},
  ): Promise<void> {
    const container = options.container || '#sidebar-properties';
    const fieldWrapper = this.page.locator(`${container} .field-wrapper-${fieldName}`);

    // A field can be revealed by another field's value (schemaEnhancer
    // fieldRules: a form question's "Condition" appears only once the question
    // it depends on has been named). That reveal is a round trip through the
    // iframe, so wait for a control to exist before judging the field missing —
    // the alternative is a race that fails whenever the sidebar is a beat
    // behind.
    await fieldWrapper
      .locator('input, textarea, [contenteditable="true"], .react-select__control')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => {
        // Genuinely absent fields fall through to the explicit throw below,
        // which says which field and where to look.
      });

    // A react-select is checked FIRST, and its own branch is below. Its search
    // box is an `input[type="text"]`, so the text branch below matches it — and
    // typing into a search box then blurring selects NOTHING. The field keeps
    // its placeholder, the helper returns as if it had worked, and the value is
    // silently never set. That is what made a picker look like it stored
    // nothing.
    const asSelect = fieldWrapper.locator('.react-select__control');
    const isSelect = await asSelect.isVisible().catch(() => false);

    // A BOOLEAN field is a checkbox, which fill() cannot drive — it needs
    // check/uncheck. Callers already pass booleans (the columns clip sets
    // `gap`), and before this they fell through every branch below and returned
    // silently, so the field simply never changed.
    if (typeof value === 'boolean') {
      const checkbox = fieldWrapper.locator('input[type="checkbox"]').first();
      await checkbox.waitFor({ state: 'attached', timeout: 5000 });
      // Click the LABEL, which is what a user clicks: Volto styles the checkbox
      // by covering the real input, so check()/uncheck() report the input as
      // visible and then time out because the label intercepts the pointer.
      // Only click when the state actually needs to change — clicking a checkbox
      // already in the wanted state would toggle it away.
      if ((await checkbox.isChecked()) !== value) {
        const label = fieldWrapper.locator('label').first();
        if (await label.count()) {
          await label.click();
        } else {
          await checkbox.click({ force: true });
        }
      }
      await expect(checkbox).toBeChecked({ checked: value, timeout: 5000 });
      return;
    }

    // A native <select> is not a react-select and not a text input, so it
    // used to fall through every branch to the throw below.
    const nativeSelect = fieldWrapper.locator('select').first();
    if (await nativeSelect.count()) {
      await nativeSelect.selectOption(value);
      return;
    }

    // Try text input
    const input = fieldWrapper.locator('input[type="text"], input[type="url"], textarea');
    if (!isSelect && (await input.isVisible())) {
      await input.fill(value);
      await input.blur(); // Trigger blur to commit the value
      return;
    }

    // Try contenteditable (Slate editors)  — also not a select

    // Note: fill() doesn't reliably clear Slate editors, use select-all + type
    const contentEditable = fieldWrapper.locator('[contenteditable="true"]');
    if (!isSelect && (await contentEditable.isVisible())) {
      // Get current text to verify selection
      const currentText = await contentEditable.textContent() || '';

      await contentEditable.click();
      await contentEditable.press('ControlOrMeta+a'); // Select all existing content

      // Verify selection covers all text before typing
      if (currentText.trim()) {
        await expect(async () => {
          const selectedText = await contentEditable.evaluate(() =>
            window.getSelection()?.toString() || ''
          );
          expect(selectedText.trim()).toBe(currentText.trim());
        }).toPass({ timeout: 2000 });
      }

      // Small wait to ensure selection is stable before typing
      await this.page.waitForTimeout(50);

      await contentEditable.pressSequentially(value, { delay: 10 }); // Type replaces selection
      await contentEditable.blur(); // Trigger blur to commit the value
      return;
    }

    // A Choice / vocabulary / block picker renders react-select, which has no
    // fillable input until it is opened. Click the control, type to filter,
    // then take the option once it is actually listed — waiting on the option
    // rather than on a timer, so a slow menu fails as a missing option instead
    // of quietly picking whatever was highlighted.
    const control = asSelect;
    if (isSelect) {
      // No Escape to dismiss another field's open menu: in the admin, Escape
      // leaves block mode and DESELECTS the block, so the sidebar reverts to
      // the page form and the field being set disappears. Clicking this
      // control is enough — react-select closes any other menu on the
      // outside mousedown that precedes the click.
      await control.scrollIntoViewIfNeeded();
      // Clicking a control TOGGLES its menu, so clicking one that is already
      // open closes it and the wait below never resolves. Open it only if it
      // is shut.
      const own = fieldWrapper.locator('.react-select__menu');
      if (!(await own.isVisible().catch(() => false))) {
        await control.click();
      }
      // Wait for the MENU before reaching for an option: react-select renders it
      // in a portal, so an option located before the menu exists resolves to
      // nothing and the click lands on the page. Same sequence as
      // block-sync.spec.ts, which is the one gesture in this repo known to
      // commit.
      // Scoped to THIS field's wrapper, and only after anything already open
      // has gone. A page-wide `.react-select__menu` can be another field's menu
      // — still up, or on its way out — and taking an option from it writes the
      // value to the wrong field while this one keeps its placeholder.
      const menu = fieldWrapper.locator('.react-select__menu');
      await menu.waitFor({ state: 'visible', timeout: 10000 });
      // Match the option case-insensitively, and say what IS on the menu when
      // nothing matches. `hasText` waits, so an unmatched value used to sit in
      // `click()` until the test's own timeout — four minutes of a demo
      // recording spent on a menu that was never going to contain the word.
      // The caller passes what the AUTHOR sees, since a Choice renders its
      // title ("Content block"), not its token ("listItem").
      const wanted = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const option = menu.locator('.react-select__option').filter({ hasText: wanted });
      if ((await option.count()) === 0) {
        const offered = await menu
          .locator('.react-select__option')
          .allTextContents();
        throw new Error(
          `setSidebarFieldValue("${fieldName}"): the menu has no option matching ` +
            `"${value}". Offered: [${offered.join(', ')}]`,
        );
      }
      await option.first().click();
      // Deliberately NO blur afterwards. Blurring the control once the value is
      // chosen loses it — the field reads back empty a second later, which is
      // what made a dropdown look impossible to set from a test.
      // It took, or this throws. A dropdown that silently keeps its old value
      // is the thing that makes a spec assert against a sidebar it never
      // changed.
      // The value CONTAINER, not the value nodes: a multi-select has one node
      // per chosen entry, and a locator that matches several trips strict mode
      // — reporting "the menu closed without taking it" for a field that took
      // it twice over.
      // Case-INSENSITIVELY: callers pass the stored token (`collapsed`) and the
      // control shows the choice's title (`Collapsed`). Comparing them as-is
      // failed on nothing more than the capital, and only quietly worked where
      // a title happened to contain its own token verbatim ("Always open").
      await expect(
        fieldWrapper.locator('.react-select__value-container'),
        `setSidebarFieldValue("${fieldName}"): the menu closed without taking "${value}"`,
      ).toContainText(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), {
        timeout: 5000,
      });
      return;
    }

    // Nothing matched. Saying so is the whole point: this used to return
    // silently, so a spec that set a dropdown asserted against a sidebar that
    // had never been touched, and a demo clip recorded a video of nothing
    // happening.
    const available = await this.page
      .locator(`${container} [class*="field-wrapper-"]`)
      .evaluateAll((els) =>
        els
          .map((e) => (e.className.match(/field-wrapper-([\w-]+)/) || [])[1])
          .filter(Boolean),
      );
    throw new Error(
      `setSidebarFieldValue("${fieldName}"): no text input, slate editor, ` +
        `checkbox, select or react-select inside ${container} ` +
        `.field-wrapper-${fieldName}. Fields present: ` +
        `[${available.join(', ') || 'none'}]. An empty list means the sidebar ` +
        `is not showing a block form at all — open it, or select the block first.`,
    );
  }

  /**
   * Add a block on the canvas next to `anchorUid` and return the new block's uid.
   *
   * Selecting an anchor, pressing add, choosing a type, then diffing the block
   * order to learn the new uid is the canvas add sequence — it was written out
   * by hand in each spec that needed it. The uid is the part callers actually
   * want and the part that is easy to get subtly wrong (a container add can
   * introduce more than one block), so it is asserted here once.
   *
   * For adding INTO a container field from the sidebar, use addBlockViaSidebar.
   *
   * @param anchorUid - uid of the block to select before adding
   * @param blockType - the @type to choose in the block chooser
   * @returns the uid of the newly added block
   */
  async addBlockOnCanvas(anchorUid: string, blockType: string): Promise<string> {
    const before = await this.getBlockOrder();
    await this.clickBlockInIframe(anchorUid);
    await this.clickAddBlockButton();
    await this.selectBlockType(blockType);
    await this.waitForBlockCountToBe(before.length + 1);
    const added = (await this.getBlockOrder()).filter((id) => !before.includes(id));
    expect(added, `exactly one new block after adding a ${blockType}`).toHaveLength(1);
    return added[0];
  }

  /**
   * Click the Add Block button that appears below a selected block.
   * This should open the block chooser.
   */
  async clickAddBlockButton(): Promise<void> {
    // Wait for DOM to stabilize (block count settles after re-renders)
    await this.getStableBlockCount();

    // The add button has class volto-hydra-add-button and is appended to the selected block element
    const addButton = this.page.locator('.volto-hydra-add-button');

    // Scroll add button into view - it may be outside viewport if block is at edge
    await addButton.scrollIntoViewIfNeeded();
    await this.demoStep(addButton);
    await addButton.click({ timeout: 10000 });
  }

  /**
   * Wait for an empty block to appear in the iframe.
   * Empty blocks have the data-hydra-empty attribute set by hydra.js.
   * @param parentSelector - Optional parent selector to scope the search
   * @returns Locator for the empty block
   */
  async waitForEmptyBlock(parentSelector?: string): Promise<Locator> {
    const iframe = this.getIframe();
    const selector = parentSelector
      ? `${parentSelector} [data-hydra-empty]`
      : '[data-hydra-empty]';
    const emptyBlock = iframe.locator(selector);
    await expect(emptyBlock).toBeVisible({ timeout: 5000 });
    return emptyBlock;
  }

  /**
   * Check if the block chooser modal is visible in the Admin UI.
   */
  async isBlockChooserVisible(): Promise<boolean> {
    // Block chooser appears in the Admin UI (not iframe)
    const chooser = this.page.locator('[role="dialog"]').or(
      this.page.locator('.blocks-chooser')
    ).or(
      this.page.locator('text=Add block')
    );

    try {
      await chooser.waitFor({ state: 'visible', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a block type is visible in the block chooser.
   * Block types: 'slate', 'image', 'video', 'listing', etc.
   * Note: Only searches within the block chooser popup, not the entire page.
   */
  async isBlockTypeVisible(blockType: string): Promise<boolean> {
    // Different block types have different display names
    const blockNames: Record<string, string[]> = {
      slate: ['Text', 'Slate', 'text'],
      image: ['Image', 'image'],
      video: ['Video', 'video'],
      listing: ['Listing', 'listing'],
      columns: ['Columns', 'columns'],
      hero: ['Hero', 'hero'],
    };

    const possibleNames = blockNames[blockType.toLowerCase()] || [blockType];

    // Scope search to block chooser only (not sidebar or other parts of page)
    const blockChooser = this.page.locator('.blocks-chooser');

    // Try to find the block type button within the block chooser
    for (const name of possibleNames) {
      const blockButton = blockChooser.locator(`button:has-text("${name}")`).first();

      if (await blockButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Select a block type from the BlockChooser by its @type id.
   *
   * BlockChooser renders each block as `<button class={block.id}>`. The button exists in the DOM
   * regardless of accordion state, but is hidden inside collapsed groups. We first confirm the
   * type is on offer at all (else the WRONG chooser is open — fail loudly saying what IS offered),
   * then expand the section holding it and click it like a user would.
   */
  async selectBlockType(blockType: string): Promise<void> {
    // Scope to the visible chooser. A previous chooser instance may still be
    // in the DOM mid-unmount; `.first()` without `:visible` can pick that
    // stale one, so the click is a no-op and the new chooser appears to
    // "stay open". Observed on admin-mock CI as
    // `15 x locator resolved to visible <div class="blocks-chooser ...">`.
    const chooser = this.page.locator('.blocks-chooser:visible').first();
    await chooser.waitFor({ state: 'visible', timeout: 5000 });

    // Confirm THIS chooser actually offers the type (the button exists in some section, even a
    // collapsed one). If not, an UNEXPECTED chooser is open (e.g. the wrong add-context) — fail
    // loudly with what IS offered, instead of a mystery "button never attached" timeout.
    if ((await chooser.locator(`button.${blockType}`).count()) === 0) {
      const offered = await chooser
        .locator('button')
        .evaluateAll((bs) =>
          bs
            .map((b) => b.className.replace(/\b(ui|basic|icon|button)\b/g, '').trim())
            .filter(Boolean),
        );
      throw new Error(
        `selectBlockType('${blockType}'): not offered by the open chooser. Offered: [${offered.join(
          ', ',
        )}]`,
      );
    }

    // Open the accordion SECTION the button lives in, the way a user would, then click the button
    // once it is genuinely visible. (We can't drive the search box instead: it filters on the
    // block's TITLE, and callers pass the @type id — `from` would never match "E-mail".)
    const button = chooser.locator(`button.${blockType}`).first();
    if (!(await button.isVisible())) {
      // Direct children only: a block button carries `class={block.id}`, so `.accordion .title`
      // also matches the Title block's own <button class="... title">, not just Accordion.Title.
      const sectionIndex = await chooser.locator('.accordion > .content').evaluateAll(
        (contents, type) => contents.findIndex((c) => !!c.querySelector(`button.${type}`)),
        blockType,
      );
      if (sectionIndex < 0) {
        throw new Error(`selectBlockType('${blockType}'): button is in no accordion section.`);
      }
      await chooser.locator('.accordion > .title').nth(sectionIndex).click();
    }
    await expect(button).toBeVisible({ timeout: 5000 });
    await this.demoStep(button);
    await button.click();

    // After click, wait until no visible chooser remains. Using a fresh
    // locator (not `chooser`) so we observe the live DOM state, not the
    // captured stale-now reference.
    await expect(this.page.locator('.blocks-chooser:visible')).toHaveCount(0, {
      timeout: 5000,
    });
  }

  /**
   * Open the toolbar ⋯ menu and click "Convert to…", which opens the
   * BlockChooser overlay (chooser is rendered in a portal above the page).
   */
  async openConvertChooser(): Promise<void> {
    const toolbar = this.page.locator('.quanta-toolbar');
    await toolbar.waitFor({ state: 'visible', timeout: 5000 });
    await toolbar.locator('button:has-text("⋯")').click();
    const dropdownMenu = this.page.locator('.volto-hydra-dropdown-menu');
    await dropdownMenu.waitFor({ state: 'visible', timeout: 3000 });
    await dropdownMenu.locator('.convert-to-menu').click();
    const chooser = this.page.locator('.blocks-chooser');
    await chooser.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Returns block-type ids currently offered by the open BlockChooser.
   * Each block button has `class={block.id}`; we collect those ids after
   * expanding every accordion. Helper for tests that verify which targets
   * are present/absent in a Convert-to or Wrap-in chooser.
   */
  async getBlockChooserTypes(): Promise<string[]> {
    const chooser = this.page.locator('.blocks-chooser');
    await chooser.waitFor({ state: 'visible', timeout: 5000 });

    const collectVisibleIds = async (): Promise<string[]> => {
      const buttons = chooser.locator('.accordion .content.active .button.basic, .accordion-noaccordion .button.basic');
      const count = await buttons.count();
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        if (!(await buttons.nth(i).isVisible().catch(() => false))) continue;
        const cls = (await buttons.nth(i).getAttribute('class')) || '';
        const tokens = cls.split(/\s+/).filter((t) =>
          t && t !== 'ui' && t !== 'button' && t !== 'basic' && t !== 'icon');
        if (tokens.length > 0) out.push(tokens[0]);
      }
      return out;
    };

    const ids = new Set<string>();

    // BlockChooser only renders accordions when filterValue is empty. If the
    // chooser is in flat mode, collect once.
    const titles = chooser.locator('.accordion .title');
    const titleCount = await titles.count();
    if (titleCount === 0) {
      const flatButtons = chooser.locator('.button.basic');
      const fbCount = await flatButtons.count();
      for (let i = 0; i < fbCount; i++) {
        const cls = (await flatButtons.nth(i).getAttribute('class')) || '';
        const tokens = cls.split(/\s+/).filter((t) =>
          t && t !== 'ui' && t !== 'button' && t !== 'basic' && t !== 'icon');
        if (tokens.length > 0) ids.add(tokens[0]);
      }
      return [...ids];
    }

    // Open each accordion in turn, collecting visible block buttons.
    for (let i = 0; i < titleCount; i++) {
      const t = titles.nth(i);
      const cls = (await t.getAttribute('class')) || '';
      if (!cls.split(/\s+/).includes('active')) {
        await t.click().catch(() => {});
        await this.page.waitForTimeout(100);
      }
      // Wait for the now-active content area to render.
      const content = chooser.locator('.accordion .content.active');
      await content.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
      for (const id of await collectVisibleIds()) ids.add(id);
    }

    return [...ids];
  }

  /**
   * Cancels the open BlockChooser overlay (used after assertion-only checks
   * that don't actually pick a target).
   */
  async cancelBlockChooser(): Promise<void> {
    const chooserOverlay = this.page.locator('.container-block-chooser');
    if (await chooserOverlay.isVisible().catch(() => false)) {
      await chooserOverlay.locator('button:has-text("Cancel")').click();
      await chooserOverlay.waitFor({ state: 'hidden', timeout: 5000 });
    }
  }

  /**
   * Get the current number of blocks in the iframe.
   * Deduplicates multi-element blocks (e.g., listings with multiple items sharing same UID).
   */
  async getBlockCount(): Promise<number> {
    const blockOrder = await this.getBlockOrder();
    return blockOrder.length;
  }

  /**
   * Get all block IDs in order.
   * Returns an array of block UIDs, deduplicated (multi-element blocks count as one).
   * Uses evaluateAll for single browser round-trip instead of N sequential getAttribute calls.
   * @param container - Container selector to scope the search (default: 'main' for main content)
   */
  async getBlockOrder(container: string = 'main'): Promise<string[]> {
    const iframe = this.getIframe();
    const selector = `${container} [data-block-uid]`;
    return await iframe.locator(selector).evaluateAll((elements) => {
      const seen = new Set<string>();
      const blockIds: string[] = [];
      for (const el of elements) {
        const uid = el.getAttribute('data-block-uid');
        if (uid && !seen.has(uid)) {
          seen.add(uid);
          blockIds.push(uid);
        }
      }
      return blockIds;
    });
  }

  /**
   * Wait for a block with the given ID to appear in the iframe.
   */
  async waitForBlockToAppear(blockId: string, timeout: number = 10000): Promise<void> {
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);
    await block.waitFor({ state: 'visible', timeout });
  }

  /**
   * Wait for a block with the given ID to disappear from the iframe.
   */
  async waitForBlockToDisappear(blockId: string, timeout: number = 10000): Promise<void> {
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);
    // Use expect().not.toBeVisible() which auto-retries until element is gone
    await expect(block).not.toBeVisible({ timeout });
  }

  /**
   * Check if a block exists in the iframe.
   */
  async blockExists(blockId: string): Promise<boolean> {
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);
    return await block.count() > 0;
  }

  /**
   * Get the drag handle from the toolbar.
   * The drag handle is in the parent window toolbar (not the iframe).
   * Also verifies that the invisible iframe drag button is properly positioned underneath.
   */
  /**
   * Get the bounding box of the iframe drag button in parent window coordinates.
   */
  async getIframeDragButtonBoundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const iframe = this.getIframe();
    const dragButton = iframe.locator('.volto-hydra-drag-button');
    const buttonBox = await dragButton.boundingBox();

    if (!buttonBox) return null;

    // Convert from iframe page coordinates to parent window coordinates
    return await this.getBoundsInParentCoordinates(buttonBox);
  }

  async getDragHandle(): Promise<Locator> {
    const toolbar = this.page.locator('.quanta-toolbar');
    const dragHandle = toolbar.locator('.drag-handle');

    // Wait for drag handles to be visible and aligned
    await this.waitForDragHandlesAligned(5000);

    // we will mouse down on toolbar but it falls through to the iframe button
    return dragHandle;
  }

  /**
   * Start a drag operation using realistic mouse events at coordinates.
   * Clicks at the visual toolbar icon position.
   * Returns the starting coordinates.
   */
  async startDrag(dragHandle: Locator): Promise<{ startX: number; startY: number }> {
    const toolbar = this.page.locator('.quanta-toolbar');
    const toolbarDragIcon = toolbar.locator('.drag-handle');
    const toolbarIconRect = await toolbarDragIcon.boundingBox();

    if (!toolbarIconRect) {
      throw new Error('Could not get toolbar drag icon bounding box');
    }

    const startX = toolbarIconRect.x + toolbarIconRect.width / 2;
    const startY = toolbarIconRect.y + toolbarIconRect.height / 2;

    // Use realistic mouse events at coordinates (not element-specific dispatch)
    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    await this.page.waitForTimeout(50);

    return { startX, startY };
  }

  /**
   * Move mouse during drag operation to a target block using realistic coordinates.
   * @param targetBlock - The block to move over
   * @param insertAfter - If true, position for insert after (75% down). If false, insert before (25% down).
   */
  async moveDragToBlock(targetBlock: Locator, insertAfter: boolean = true): Promise<void> {
    const targetRect = await targetBlock.boundingBox();
    if (!targetRect) {
      throw new Error('Could not get target block bounding box');
    }

    const clientY = insertAfter
      ? targetRect.y + targetRect.height * 0.75
      : targetRect.y + targetRect.height * 0.25;
    const clientX = targetRect.x + targetRect.width / 2;

    // Use realistic mouse movement
    await this.page.mouse.move(clientX, clientY);
    await this.page.waitForTimeout(100);
  }

  /**
   * Complete a drag operation by releasing the mouse using realistic events.
   */
  async completeDrag(dragHandle: Locator): Promise<void> {
    await this.page.mouse.up();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if the drop indicator is visible in the iframe.
   */
  async isDropIndicatorVisible(): Promise<boolean> {
    const iframe = this.getIframe();
    const dropIndicator = iframe.locator('.volto-hydra-drop-indicator');
    return await dropIndicator.isVisible();
  }

  /**
   * Check if the drag shadow (visual clone of dragged block) is visible in the iframe.
   * The drag shadow has class .dragging and is created when drag starts.
   */
  async isDragShadowVisible(): Promise<boolean> {
    const iframe = this.getIframe();
    const dragShadow = iframe.locator('.dragging');
    return await dragShadow.isVisible();
  }

  /**
   * Wait for and assert that the drag shadow is visible during drag.
   */
  async verifyDragShadowVisible(): Promise<void> {
    const iframe = this.getIframe();
    const dragShadow = iframe.locator('.dragging');
    try {
      await dragShadow.waitFor({ state: 'visible', timeout: 5000 });
    } catch (e) {
      // Diagnostic: is the element in the DOM but not visible, or missing entirely?
      const count = await dragShadow.count();
      const bodyClass = await iframe.locator('body').getAttribute('class');
      const iframeDragBtn = iframe.locator('.volto-hydra-drag-button');
      const dragBtnVisible = await iframeDragBtn.isVisible().catch(() => false);
      const dragBtnBox = await iframeDragBtn.boundingBox().catch(() => null);
      console.log(`[DIAG] .dragging count=${count}, body class="${bodyClass}", dragBtn visible=${dragBtnVisible}, dragBtn box=${JSON.stringify(dragBtnBox)}`);
      if (count > 0) {
        const box = await dragShadow.first().boundingBox().catch(() => null);
        const style = await dragShadow.first().getAttribute('style').catch(() => null);
        console.log(`[DIAG] .dragging exists but not visible: box=${JSON.stringify(box)}, style="${style}"`);
      }
      throw e;
    }
  }

  /**
   * Assert that the drop indicator is visible during drag.
   */
  async verifyDropIndicatorVisible(): Promise<void> {
    const isVisible = await this.isDropIndicatorVisible();
    if (!isVisible) {
      throw new Error('Drop indicator not visible during drag - drag may have failed');
    }
  }

  /**
   * Verify drop indicator is positioned near the target block.
   * This is a resilient check - it verifies the indicator is in the general
   * area of the target rather than checking exact pixel positions.
   *
   * @param targetBlock - The block we're dragging to
   * @param insertAfter - Whether we're inserting after (true) or before (false) the target
   */
  async verifyDropIndicatorNearTarget(
    targetBlock: Locator,
    insertAfter: boolean,
    cursorPageCoords?: { x: number; y: number },
  ): Promise<void> {
    const iframe = this.getIframe();
    const dropIndicator = iframe.locator('.volto-hydra-drop-indicator');

    // Get iframe offset for coordinate translation
    const iframeEl = this.page.locator('#previewIframe');
    const iframeBox = await iframeEl.boundingBox();

    // Replace mode (drop into a container whose only child is an 'empty'
    // placeholder) renders a shade overlay instead of a line indicator.
    // If the shade is visible the drop is valid — short-circuit the
    // line-indicator edge checks.
    // Use evaluateAll (don't wait): the shade often doesn't exist for
    // ordinary drops, and locator.evaluate would auto-wait ~30s every
    // retry, blowing the 45s test timeout.
    const shadeVisible = await iframe.locator('.volto-hydra-drop-shade').evaluateAll(
      (els) => els.some((el) => getComputedStyle(el).display !== 'none'),
    );
    if (shadeVisible) return;

    // Use iframe's internal getBoundingClientRect for consistent coordinates
    // (Playwright's boundingBox doesn't account for iframe scroll correctly)
    const dropRectInIframeCoords = await dropIndicator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, display: getComputedStyle(el).display };
    });
    // Use getCombinedBoundingBox to handle multi-element blocks (listing blocks)
    const targetRectInIframeCoords = await this.getCombinedBoundingBox(targetBlock);

    const targetTop = targetRectInIframeCoords.y;
    const targetBottom = targetRectInIframeCoords.y + targetRectInIframeCoords.height;
    const dropY = dropRectInIframeCoords.y;

    // Calculate cursor position in iframe coords (if provided)
    let cursorIframeCoords: { x: number; y: number } | null = null;
    if (cursorPageCoords && iframeBox) {
      cursorIframeCoords = {
        x: cursorPageCoords.x - iframeBox.x,
        y: cursorPageCoords.y - iframeBox.y,
      };
    }

    // Drop indicator should be at the correct edge of the target block
    // For insertAfter: indicator at BOTTOM edge (within tolerance below block)
    // For insertBefore: indicator at TOP edge (within tolerance above block)
    const tolerance = 30; // Should be close to the edge
    const expectedEdge = insertAfter ? targetBottom : targetTop;
    // The INNER bound (toward the block's centre) must never reach past the
    // midpoint: for a block shorter than 2*tolerance the opposite edge would
    // otherwise fall inside the window, so an indicator at the TOP edge
    // (insertBefore) would satisfy an insertAfter check — and the drop then
    // lands on the wrong side (the placeholder-region flake: tightly packed
    // ~18px paragraphs). Keep the full tolerance on the OUTER side (the gap to
    // the neighbouring block). Tall blocks are unaffected (min → tolerance).
    const innerTol = Math.min(tolerance, (targetBottom - targetTop) / 2);
    let isNearTarget: boolean;

    if (insertAfter) {
      // Indicator should be near bottom edge of target, on the after-side of
      // the midpoint.
      isNearTarget = dropY >= targetBottom - innerTol && dropY <= targetBottom + tolerance;
    } else {
      // Indicator should be near top edge of target, on the before-side of
      // the midpoint.
      isNearTarget = dropY >= targetTop - tolerance && dropY <= targetTop + innerTol;
    }

    if (!isNearTarget) {
      throw new Error(
        `Drop indicator not near target block.\n` +
          `  Cursor (iframe): ${cursorIframeCoords ? `(${cursorIframeCoords.x.toFixed(0)}, ${cursorIframeCoords.y.toFixed(0)})` : 'unknown'}\n` +
          `  Drop indicator y: ${dropY.toFixed(0)}\n` +
          `  Target: top=${targetTop.toFixed(0)}, bottom=${targetBottom.toFixed(0)}\n` +
          `  Expected: ${insertAfter ? 'bottom' : 'top'} edge @ ${expectedEdge.toFixed(0)} ±${tolerance}\n` +
          `  Allowed range: ${expectedEdge - tolerance} to ${expectedEdge + tolerance}`,
      );
    }
  }

  /**
   * Get the center position of the toolbar drag icon in PAGE coordinates.
   * Fails if toolbar is not visible.
   */
  private async getToolbarDragIconCenterInPageCoords(): Promise<{ x: number; y: number }> {
    console.log('[DEBUG] getToolbarDragIconCenterInPageCoords called');
    const toolbar = this.page.locator('.quanta-toolbar');
    const toolbarDragIcon = toolbar.locator('.drag-handle');

    // Debug: check if toolbar and drag handle exist
    const toolbarCount = await toolbar.count();
    const dragHandleCount = await toolbarDragIcon.count();
    console.log(`[DEBUG] toolbar count: ${toolbarCount}, drag-handle count: ${dragHandleCount}`);

    const rect = await toolbarDragIcon.boundingBox();
    if (!rect) {
      throw new Error('Toolbar drag icon not visible');
    }
    console.log(`[DEBUG] drag handle rect: ${JSON.stringify(rect)}`);

    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }

  /**
   * Get the drop position in IFRAME coordinates using frame.evaluate.
   * This gets the actual viewport coordinates that hydra.js will receive.
   */
  private async getDropPositionInIframeCoords(
    blockUid: string,
    insertAfter: boolean
  ): Promise<{ x: number; y: number }> {
    const iframe = this.getIframe();
    const block = iframe.locator(`[data-block-uid="${blockUid}"]`);

    // Use getCombinedBoundingBox to handle multi-element blocks (listing blocks)
    const rect = await this.getCombinedBoundingBox(block);

    return {
      x: rect.x + rect.width / 2,
      y: insertAfter
        ? rect.y + rect.height * 0.75
        : rect.y + rect.height * 0.25,
    };
  }

  /**
   * Convert iframe coordinates to page coordinates.
   */
  private async iframeCoordsToPageCoords(
    iframeCoords: { x: number; y: number }
  ): Promise<{ x: number; y: number }> {
    const iframeEl = this.page.locator('#previewIframe');
    const iframeBoxInPageCoords = await iframeEl.boundingBox();
    if (!iframeBoxInPageCoords) {
      throw new Error('Could not get iframe bounding box');
    }

    return {
      x: iframeCoords.x + iframeBoxInPageCoords.x,
      y: iframeCoords.y + iframeBoxInPageCoords.y,
    };
  }

  /**
   * Get the target drop position for a block in PAGE coordinates.
   * Returns Y at 25% for insertBefore, 75% for insertAfter.
   *
   * Note: We use evaluate() with getBoundingClientRect() to get coords relative
   * to the iframe's VIEWPORT (not scrollable content), then add the iframe's
   * position in the page. This ensures correct coords even after auto-scroll.
   */
  private async getDropPositionInPageCoords(
    targetBlock: Locator,
    insertAfter: boolean
  ): Promise<{ x: number; y: number }> {
    // For multi-element blocks (listings), use first/last element depending on direction
    const mode = insertAfter ? 'last' : 'first';

    // Use Playwright's boundingBox() which returns correct page coordinates
    // for elements inside iframes — no manual iframe offset math needed.
    const elements = await targetBlock.all();
    const targetEl = mode === 'last' ? elements[elements.length - 1] : elements[0];
    const box = await targetEl.boundingBox();
    if (!box) {
      throw new Error('Could not get target block bounding box');
    }

    // Position cursor at 75% (after) or 25% (before) of the block.
    // The drop logic uses blockSize/2 as threshold. Cursor must be inside
    // the block so elementFromPoint hits it.
    const result = {
      x: box.x + box.width / 2,
      y: insertAfter
        ? box.y + box.height * 0.75
        : box.y + box.height * 0.25,
    };

    return result;
  }

  // ============================================================================
  // DRAG AND DROP HELPER - STEP 1: START DRAG
  // ============================================================================

  /**
   * Start a drag operation from the toolbar drag handle.
   * Returns the starting position for reference.
   */
  private async startDragFromToolbar(): Promise<{ x: number; y: number }> {
    console.log('[DEBUG] startDragFromToolbar called');
    const startPosPage = await this.getToolbarDragIconCenterInPageCoords();
    console.log(`[DEBUG] startPosPage: ${JSON.stringify(startPosPage)}`);

    if (!this.isInPageViewport(startPosPage.y)) {
      throw new Error(
        `Toolbar drag icon is off-screen at Y=${startPosPage.y}. ` +
        `The block must be scrolled into view before dragging. ` +
        `Ensure clickBlockInIframe() scrolls the selected block into view.`
      );
    }

    console.log('[DEBUG] moving mouse and pressing down');
    await this.page.mouse.move(startPosPage.x, startPosPage.y);
    await this.page.mouse.down();
    console.log('[DEBUG] verifying drag shadow visible');
    await this.verifyDragShadowVisible();
    console.log('[DEBUG] drag started successfully');

    return startPosPage;
  }

  // ============================================================================
  // DRAG AND DROP HELPER - STEP 2: AUTO-SCROLL TO TARGET
  // ============================================================================

  /**
   * Wait for an element's position to stabilize (stop moving).
   * Returns when the element has a valid bounding box and position hasn't changed for 2 checks.
   *
   * Public: revealing a block starts an animation too — a carousel slides, a
   * panel opens — and anything that clicks or measures afterwards needs the
   * same guarantee the drag auto-scroll needs.
   */
  async waitForPositionStable(element: Locator): Promise<void> {
    let lastY: number | null = null;
    await expect(async () => {
      const rect = await element.boundingBox();
      expect(rect).not.toBeNull(); // Element must be visible
      const currentY = rect!.y;
      if (lastY !== null) {
        expect(Math.abs(currentY - lastY)).toBeLessThan(5);
      }
      lastY = currentY;
    }).toPass({ timeout: 2000, intervals: [50, 100, 200] });
  }

  /**
   * Auto-scroll the iframe until the target block is visible in the viewport.
   *
   * IMPORTANT: We scroll PAST the target, then move the cursor back to the drop position.
   * This ensures the cursor isn't at the scroll edge when we drop, which would cause
   * auto-scroll to continue and change the detected target block.
   */
  private async autoScrollToTarget(
    targetBlock: Locator,
    insertAfter: boolean,
    maxAttempts: number = 60
  ): Promise<{ x: number; y: number }> {
    // For multi-element blocks, use the relevant element for scroll detection:
    // - insertAfter=true: scroll until LAST element visible (dropping below it)
    // - insertAfter=false: scroll until FIRST element visible (dropping above it)
    const targetElement = insertAfter ? targetBlock.last() : targetBlock.first();
    const viewportSize = this.page.viewportSize();
    if (!viewportSize) throw new Error('Could not get viewport size');

    // Margin from viewport edge - target should be this far from edge before we stop scrolling.
    // This needs to be large enough to account for:
    // 1. The hydra.js auto-scroll zone (80px from edges)
    // 2. Scroll momentum/overshoot that can move the target after we stop
    // Using 200px gives buffer for ~100px of overshoot beyond the auto-scroll zone.
    const edgeMargin = 200;
    let lastTargetY: number | null = null;
    let stuckCount = 0;

    // Cache iframe bounds and edge positions — they don't change during drag
    const iframeEl = this.page.locator('#previewIframe');
    const iframeRect = await iframeEl.boundingBox();
    if (!iframeRect) throw new Error('Could not get iframe bounding box');
    const edgeThreshold = 10;
    const edgeX = iframeRect.x + iframeRect.width / 2;
    const edgeYUp = iframeRect.y + edgeThreshold;
    const edgeYDown = iframeRect.y + iframeRect.height - edgeThreshold;

    // Move cursor to the scroll edge once before the loop, then just jiggle it
    let currentEdgeY = 0;
    let edgeInitialized = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Verify drag shadow is still active (every 20 iterations to reduce overhead)
      if (attempt % 20 === 0) {
        await this.verifyDragShadowVisible();
      }

      // Check target position
      const quickRect = await this.getCombinedBoundingBox(targetElement);
      const targetY = iframeRect.y + quickRect.y + quickRect.height / 2;
      const isAboveViewport = targetY < edgeMargin;
      const isBelowViewport = targetY > viewportSize.height - edgeMargin;
      const isVisibleInViewport = targetY > 0 && targetY < viewportSize.height;
      const needsAutoScroll = isAboveViewport || isBelowViewport;

      // Debug logging every 10 attempts
      if (attempt % 10 === 0) {
        console.log(`[SCROLL] attempt=${attempt} targetY=${targetY.toFixed(0)} edgeMargin=${edgeMargin} viewportH=${viewportSize.height} above=${isAboveViewport} below=${isBelowViewport} visible=${isVisibleInViewport} needsScroll=${needsAutoScroll} t=${Date.now()}`);
      }

      if (!needsAutoScroll) {
        // Target is well within viewport (not near edges) - safe to drop
        console.log(`[SCROLL] Target in range! targetY=${targetY.toFixed(0)}`);
        // CRITICAL: Move cursor to safe zone BEFORE returning, to stop auto-scroll.
        await this.moveToSafeZone();
        await this.waitForPositionStable(targetElement);

        // Re-verify target is still visible after momentum settles.
        // moveToSafeZone moves cursor from scroll edge to center, which can trigger
        // additional scrolling as the cursor passes through the auto-scroll zone.
        // If the target drifted off-screen, use scrollIntoViewIfNeeded to correct it
        // rather than re-entering the auto-scroll loop (which would oscillate).
        const settledRect = await this.getCombinedBoundingBox(targetElement);
        const freshIframeRect = await iframeEl.boundingBox();
        if (!freshIframeRect) throw new Error('Could not get iframe bounding box');
        const settledY = freshIframeRect.y + settledRect.y + settledRect.height / 2;
        if (settledY < 0 || settledY > viewportSize.height) {
          console.log(`[SCROLL] Target drifted off-screen after settling! settledY=${settledY.toFixed(0)}, using scrollIntoView to correct`);
          await targetElement.scrollIntoViewIfNeeded();
          await this.waitForPositionStable(targetElement);
        }

        return await this.getDropPositionInPageCoords(targetBlock, insertAfter);
      }

      // Check if we've hit the scroll limit (target stopped moving)
      if (lastTargetY !== null && Math.abs(targetY - lastTargetY) < 5) {
        stuckCount++;
        // If target is visible and hasn't moved for 3 iterations, accept it
        if (stuckCount >= 3 && isVisibleInViewport) {
          console.log(`[SCROLL] Accepting position after scroll limit reached. targetY=${targetY.toFixed(0)}`);
          await this.moveToSafeZone();
          await this.waitForPositionStable(targetElement);

          // Re-verify after momentum settles
          const settledRect2 = await this.getCombinedBoundingBox(targetElement);
          const freshIframeRect2 = await iframeEl.boundingBox();
          if (!freshIframeRect2) throw new Error('Could not get iframe bounding box');
          const settledY2 = freshIframeRect2.y + settledRect2.y + settledRect2.height / 2;
          if (settledY2 < 0 || settledY2 > viewportSize.height) {
            console.log(`[SCROLL] Target drifted off-screen after scroll limit! settledY=${settledY2.toFixed(0)}, using scrollIntoView to correct`);
            await targetElement.scrollIntoViewIfNeeded();
            await this.waitForPositionStable(targetElement);
          }

          return await this.getDropPositionInPageCoords(targetBlock, insertAfter);
        }
      } else {
        stuckCount = 0;
      }
      lastTargetY = targetY;

      // Move cursor to edge to trigger auto-scroll.
      // Only do a full move on direction change; otherwise just jiggle by 1px
      // to keep rAF scrolling alive without expensive multi-step moves.
      const scrollUp = isAboveViewport;
      const targetEdgeY = scrollUp ? edgeYUp : edgeYDown;
      if (!edgeInitialized || Math.abs(currentEdgeY - targetEdgeY) > 20) {
        // Direction changed or first move — do a proper move
        await this.page.mouse.move(edgeX, targetEdgeY, { steps: 2 });
        currentEdgeY = targetEdgeY;
        edgeInitialized = true;
      } else {
        // Same direction — tiny jiggle to keep scroll events flowing
        currentEdgeY = targetEdgeY + (attempt % 2);
        await this.page.mouse.move(edgeX, currentEdgeY);
      }

      // Brief wait for scroll to take effect
      await this.page.waitForTimeout(50);
    }

    // If we get here, we've exceeded max attempts
    throw new Error(`Auto-scroll failed after ${maxAttempts} attempts`);
  }

  /**
   * Fast scroll directly to target using scrollIntoView.
   * Use this for most tests; use autoScrollToTarget with testAutoScroll=true to test auto-scroll.
   */
  private async fastScrollToTarget(
    targetBlock: Locator,
    insertAfter: boolean
  ): Promise<{ x: number; y: number }> {
    const targetElement = insertAfter ? targetBlock.last() : targetBlock.first();

    // Scroll target into view and wait for position to stabilize
    await targetElement.scrollIntoViewIfNeeded();
    await this.waitForPositionStable(targetElement);

    // Verify drag is still active
    await this.verifyDragShadowVisible();

    // Get drop position in page coordinates and move mouse there
    const dropPos = await this.getDropPositionInPageCoords(targetBlock, insertAfter);
    await this.page.mouse.move(dropPos.x, dropPos.y, { steps: 5 });
    await this.page.waitForTimeout(100);

    return dropPos;
  }

  /**
   * Wait for auto-scroll to make progress (target position changes) OR target becomes visible.
   * This handles the case where we hit the scroll limit before the target is within the edge margin.
   */
  private async waitForAutoScrollProgress(
    targetElement: Locator,
    prevY: number
  ): Promise<void> {
    const viewportSize = this.page.viewportSize();
    if (!viewportSize) throw new Error('Could not get viewport size');

    await expect(async () => {
      await this.verifyDragShadowVisible();
      // Quick position check using single element
      const rect = await this.getCombinedBoundingBox(targetElement);
      const iframeEl = this.page.locator('#previewIframe');
      const iframeRect = await iframeEl.boundingBox();
      if (!iframeRect) throw new Error('Could not get iframe bounding box');
      const newY = iframeRect.y + rect.y + rect.height / 2;

      // Success if target moved at least 5px
      const scrollAmount = Math.abs(newY - prevY);
      if (scrollAmount >= 5) {
        return; // Scroll is making progress
      }

      // Also succeed if target is now visible in viewport (scroll limit reached)
      const isInViewport = newY > 0 && newY < viewportSize.height;
      if (isInViewport) {
        return; // Target is visible, even if we hit scroll limit
      }

      throw new Error(`Waiting for auto-scroll: target moved only ${scrollAmount.toFixed(1)}px, newY=${newY.toFixed(0)}, prevY=${prevY.toFixed(0)}, rect.y=${rect.y.toFixed(0)}, viewportH=${viewportSize.height}`);
    }).toPass({ timeout: 2000, intervals: [100, 200, 300, 500] });
  }

  /**
   * Press-drag the mouse to a position relative to a target that may MOVE
   * because of hydra's auto-scroll, retargeting until the target stops drifting.
   *
   * Generalises the block-DnD retarget loop (moveToDropPosition, which recomputes
   * the drop point from the target's live box each pass) so it isn't tied to the
   * drag-shadow / insertAfter flow: any press-drag whose target auto-scrolls can
   * reuse it — e.g. a container edge-handle drag whose child slides up under the
   * cursor. The naive alternative (compute one target Y before the drag, move in
   * fixed steps) loses the target the moment auto-scroll engages.
   *
   * Each pass reads the target's LIVE page-coord box, moves the cursor to
   * `cursorFor(box)`, and settles once the box's Y has stopped changing for a few
   * passes (auto-scroll has either stopped or pinned the target at the viewport
   * edge). The mouse must already be pressed; the caller releases.
   *
   * @param target    element the cursor must reach a position relative to
   * @param cursorFor given the target's current page box, the {x,y} to move to
   * @param maxPasses attempts before giving up
   */
  async dragCursorToMovingTarget(
    target: Locator,
    cursorFor: (box: { x: number; y: number; width: number; height: number }) => { x: number; y: number },
    maxPasses: number = 40,
  ): Promise<void> {
    // hydra auto-scrolls when the cursor is within ~80px of the iframe viewport
    // edges. Compute a slightly larger safe band in page coords: a cursor inside
    // it is provably NOT triggering auto-scroll, so a stable target there is
    // genuinely settled — not merely paused by a load hiccup mid-scroll.
    const iframeBox = await this.page.locator('#previewIframe').boundingBox();
    if (!iframeBox) throw new Error('dragCursorToMovingTarget: no iframe bounding box');
    const ZONE = 90;
    const inSafeBand = (p: { x: number; y: number }) =>
      p.x >= iframeBox.x + ZONE && p.x <= iframeBox.x + iframeBox.width - ZONE &&
      p.y >= iframeBox.y + ZONE && p.y <= iframeBox.y + iframeBox.height - ZONE;

    let lastX: number | null = null;
    let lastY: number | null = null;
    let stablePasses = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      const box = await target.boundingBox();
      if (!box) throw new Error('dragCursorToMovingTarget: target has no bounding box');
      const pos = cursorFor(box);
      await this.page.mouse.move(pos.x, pos.y, { steps: 3 });
      await this.page.waitForTimeout(50);
      // Target stopped drifting on BOTH axes (axis-agnostic: vertical and
      // horizontal edge drags share this path).
      const stable = lastX !== null && Math.abs(box.x - lastX) < 2 && Math.abs(box.y - lastY!) < 2;
      // Settle when stable AND the cursor is clear of the auto-scroll zone (so
      // releasing here won't drift) — OR, as a fallback for a target pinned in
      // the zone at the scroll limit (can't be brought further in), when it has
      // been fully stable for a longer window. If stable-but-in-zone and NOT yet
      // at the limit, that's a load pause: keep going, don't settle early.
      if (stable && (inSafeBand(pos) ? ++stablePasses >= 3 : ++stablePasses >= 10)) {
        const settledBox = await target.boundingBox();
        if (!settledBox) throw new Error('dragCursorToMovingTarget: target vanished while settling');
        const settledPos = cursorFor(settledBox);
        await this.page.mouse.move(settledPos.x, settledPos.y, { steps: 3 });
        return;
      }
      if (!stable) stablePasses = 0;
      lastX = box.x;
      lastY = box.y;
    }
    throw new Error(`dragCursorToMovingTarget: target still drifting after ${maxPasses} passes`);
  }

  // ============================================================================
  // DRAG AND DROP HELPER - STEP 3: MOVE TO DROP POSITION
  // ============================================================================

  /**
   * Move the mouse to the drop position and verify the drop indicator is correct.
   *
   * NOTE: We continuously update the mouse position until the drop indicator is correct.
   * This handles the case where auto-scroll continues after we start moving to the target
   * (e.g., due to momentum/overshoot that causes the target to move after we calculated
   * the drop position).
   */
  private async moveToDropPosition(
    targetBlock: Locator,
    insertAfter: boolean,
    _initialDropPos: { x: number; y: number },
    skipVerification: boolean = false
  ): Promise<void> {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Get current position and move to it (recalculate each time in case scroll settled)
      const dropPosPage = await this.getDropPositionInPageCoords(targetBlock, insertAfter);
      await this.page.mouse.move(dropPosPage.x, dropPosPage.y, { steps: 5 });

      // Wait a moment for the drop indicator to update
      await this.page.waitForTimeout(100);

      // Verify the indicator is in the right position (unless skipped)
      if (skipVerification) {
        return;
      }

      try {
        await this.verifyDropIndicatorNearTarget(targetBlock, insertAfter, dropPosPage);
        return; // Success - indicator is in the right place
      } catch (error) {
        if (attempt < maxRetries - 1) {
          console.log(`[DROP] Indicator not in expected position, retrying (attempt ${attempt + 1}/${maxRetries})`);
          // Wait a bit for scroll to settle before retrying
          await this.page.waitForTimeout(100);
        } else {
          // Last attempt failed - re-throw the error
          throw error;
        }
      }
    }
  }

  // ============================================================================
  // DRAG AND DROP HELPER - STEP 4: DROP AND CLEANUP
  // ============================================================================

  /**
   * Complete the drag operation by releasing the mouse and waiting for cleanup.
   */
  private async completeDrop(
    targetBlock?: Locator,
    insertAfter?: boolean,
  ): Promise<void> {
    // Verify drop indicator is still in correct position right before dropping.
    // Between moveToDropPosition and here, evaluations and timing could shift things.
    if (targetBlock && insertAfter !== undefined) {
      await this.verifyDropIndicatorNearTarget(targetBlock, insertAfter);
    }

    // Get all block order before drop (using body to include all containers)
    const orderBefore = await this.getBlockOrder('body');

    await this.page.mouse.up();

    const iframe = this.getIframe();
    await expect(iframe.locator('.volto-hydra-drop-indicator')).not.toBeVisible({ timeout: 5000 });
    await expect(iframe.locator('.dragging')).not.toBeVisible({ timeout: 5000 });

    // Wait for block order to change AND render to stabilize.
    // getStableBlockCount inside the loop ensures we don't catch intermediate
    // states where container innerHTML is cleared during async re-render.
    await expect(async () => {
      await this.getStableBlockCount();
      const orderAfter = await this.getBlockOrder('body');
      if (JSON.stringify(orderBefore) === JSON.stringify(orderAfter)) {
        throw new Error('Block order has not changed yet');
      }
    }).toPass({ timeout: 5000 });
  }

  /**
   * Check if a Y position (in PAGE coordinates) is within the viewport.
   */
  private isInPageViewport(y: number): boolean {
    const viewportSize = this.page.viewportSize();
    if (!viewportSize) return false;
    return y >= 0 && y <= viewportSize.height;
  }

  /**
   * Move mouse towards iframe edge to trigger auto-scroll.
   */
  private async moveToScrollEdge(scrollUp: boolean): Promise<void> {
    const iframeElement = this.page.locator('#previewIframe');
    const iframeRect = await iframeElement.boundingBox();
    if (!iframeRect) throw new Error('Could not get iframe bounds');

    const edgeThreshold = 10; // Close to edge for faster scroll speed
    const edgeX = iframeRect.x + iframeRect.width / 2;
    const edgeY = scrollUp
      ? iframeRect.y + edgeThreshold
      : iframeRect.y + iframeRect.height - edgeThreshold;

    // Multiple small moves to trigger scroll
    for (let i = 0; i < 5; i++) {
      await this.page.mouse.move(edgeX, edgeY + (i % 2), { steps: 2 });
      await this.page.waitForTimeout(50);
    }
  }

  /**
   * Move cursor to a "safe zone" in the center of the viewport to stop auto-scroll.
   * This prevents race conditions where auto-scroll continues while cursor moves to target.
   */
  private async moveToSafeZone(): Promise<void> {
    const viewportSize = this.page.viewportSize();
    if (!viewportSize) throw new Error('Could not get viewport size');

    const iframeElement = this.page.locator('#previewIframe');
    const iframeRect = await iframeElement.boundingBox();
    if (!iframeRect) throw new Error('Could not get iframe bounds');

    // Move to center of viewport (well away from scroll edges)
    const safeX = iframeRect.x + iframeRect.width / 2;
    const safeY = viewportSize.height / 2;

    console.log(`[SCROLL] Moving to safe zone: (${safeX.toFixed(0)}, ${safeY.toFixed(0)})`);
    await this.page.mouse.move(safeX, safeY, { steps: 3 });

    // Wait for any residual scroll to settle
    await this.page.waitForTimeout(150);
  }

  /**
   * Drag a block to a new position.
   *
   * NOTE: This helper tests hydra.js auto-scroll functionality. When dragging
   * to blocks that are off-screen, we move the mouse to the viewport edge
   * to trigger hydra's auto-scroll, which scrolls the iframe content until
   * the target becomes visible.
   *
   * @param _dragHandle - Unused, kept for API compatibility
   * @param targetBlock - The block to drop near
   * @param insertAfter - If true, insert after target. If false, insert before.
   */
  /**
   * Reorder a row in the Contents view, by keyboard.
   *
   * Volto's Contents table is a dnd-kit sortable with no explicit sensors, so
   * it uses the defaults — PointerSensor AND KeyboardSensor. Driving it with
   * mouse.down/move/up does not work: dnd-kit's PointerSensor wants real
   * pointer events with the coalesced properties Playwright's mouse API does
   * not produce, so the drag never starts and NO @order request is sent. A demo
   * clip did exactly that for months: the rows appeared to drag, nothing was
   * reordered, and the failure surfaced three beats later somewhere else.
   *
   * The keyboard path is dnd-kit's own accessibility affordance and is exact:
   * focus the handle, Space to lift, Arrow to step, Space to drop. One step is
   * one position, so this says what it means.
   *
   * @param rowName - accessible name of the row to move (its path)
   * @param steps - positions to move; negative moves up
   */
  async reorderContentsRow(rowName: string, steps: number): Promise<void> {
    const row = this.page.getByRole('row', { name: rowName, exact: true });
    await expect(row).toBeVisible({ timeout: 10000 });
    await this.reorderContentsRowLocator(row, steps);
  }

  /** Move the folder's FIRST row, for a test that only needs "something moved". */
  async reorderFirstContentsRow(steps: number): Promise<void> {
    await expect
      .poll(() => this.page.locator('tbody tr').count(), { timeout: 30000 })
      .toBeGreaterThan(1);
    await this.reorderContentsRowLocator(this.page.locator('tbody tr').first(), steps);
  }

  /**
   * Reorder a row you already have a locator for. Prefer this when the row was
   * found by content — a row's ACCESSIBLE NAME is not its textContent (the
   * cells run together, "Document  TitlePublishedNoneNone"), so round-tripping
   * through getByRole({ name }) does not find it again.
   */
  async reorderContentsRowByLocator(row: Locator, steps: number): Promise<void> {
    await this.reorderContentsRowLocator(row, steps);
  }

  private async reorderContentsRowLocator(row: Locator, steps: number): Promise<void> {
    // The handle is the row's FIRST cell — it carries dnd-kit's listeners and
    // attributes, and is the only thing that starts a drag.
    const handle = row.locator('td').first().locator('button');
    await expect(handle).toBeVisible({ timeout: 5000 });

    const rows = this.page.locator('tbody tr');
    const label = ((await row.textContent()) || '').trim();
    const positionOf = async () =>
      (await rows.allTextContents()).map((t) => t.trim()).indexOf(label);
    const from = await positionOf();
    const target = rows.nth(Math.max(0, from + steps));
    await handle.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();

    const handleBox = await handle.boundingBox();
    const targetBox = await target.boundingBox();
    expect(handleBox && targetBox, 'the row and its target must be measurable').toBeTruthy();

    // Volto debounces the order request (Contents' `orderTimeout`), so the drop
    // returning does not mean the backend has heard it. Watch for the request
    // itself: a reorder the backend never heard about is not a reorder. It is a
    // PATCH on the CONTAINER carrying `ordering` — what Volto sends and what
    // plone.restapi accepts. Nothing in this flow calls an @order endpoint.
    const ordered = this.page.waitForResponse(
      (response) => {
        if (response.request().method() !== 'PATCH') return false;
        try {
          return Boolean(JSON.parse(response.request().postData() || '{}').ordering);
        } catch {
          return false;
        }
      },
      { timeout: 15000 },
    );

    await this.page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await this.page.mouse.down();
    // A small move FIRST, to activate the drag. This is the part that decides
    // whether any of it works: a pointer sensor starts on movement, and going
    // straight from `down` to a long move never activates one — the rows appear
    // to drag, nothing reorders, and no request is sent. Same shape the sidebar
    // child-block reorder uses.
    await this.page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2 + 5,
      { steps: 5 },
    );
    // The LIFT has to have happened before the real move means anything. dnd-kit
    // marks the row it is dragging (ContentsItem: `dragging-row`).
    await expect(row).toHaveClass(/dragging-row/, { timeout: 5000 });
    await this.page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2 + (steps > 0 ? 10 : -10),
      { steps: 10 },
    );
    await this.page.mouse.up();
    await expect(row).not.toHaveClass(/dragging-row/, { timeout: 5000 });
    await ordered;
  }

  async dragBlockWithMouse(
    _dragHandle: Locator,
    targetBlock: Locator,
    insertAfter: boolean = true,
    options: { testAutoScroll?: boolean } = {}
  ): Promise<void> {
    // Step 1: Start drag from toolbar
    await this.startDragFromToolbar();

    // Step 2: Scroll until target is in viewport
    // testAutoScroll=true uses hydra's rAF-based auto-scroll (slow in Playwright due to rAF throttling)
    // testAutoScroll=false (default) scrolls directly for faster tests
    let dropPosPage: { x: number; y: number };
    if (options.testAutoScroll) {
      // Use more attempts for explicit auto-scroll testing (each attempt ~100ms = ~30s total)
      dropPosPage = await this.autoScrollToTarget(targetBlock, insertAfter, 300);
    } else {
      dropPosPage = await this.fastScrollToTarget(targetBlock, insertAfter);
    }

    // Step 3: Move to drop position and verify indicator
    await this.moveToDropPosition(targetBlock, insertAfter, dropPosPage);

    // Step 4: Verify indicator is still correct and complete the drop
    await this.completeDrop(targetBlock, insertAfter);
  }

  /**
   * Drag a block after another block by their IDs.
   * First selects the source block, then drags it after the target block.
   * @param sourceBlockId - The block ID to drag
   * @param targetBlockId - The block ID to drop after
   */
  async dragBlockAfter(sourceBlockId: string, targetBlockId: string): Promise<void> {
    const iframe = this.getIframe();

    // Select the source block first
    await this.clickBlockInIframe(sourceBlockId);
    await this.waitForBlockSelectedInAdmin(sourceBlockId);

    // Get target block locator
    const targetBlock = iframe.locator(`[data-block-uid="${targetBlockId}"]`).first();

    // Use dragBlockWithMouse (first param is unused)
    await this.dragBlockWithMouse(targetBlock, targetBlock, true);
  }

  /**
   * Drag a block after another block and RELEASE, without asserting a reorder.
   * Use for drops that intentionally don't move immediately — e.g. a convert-drop
   * with multiple options, which opens the chooser first (ask-first) and only
   * moves once the user picks a type. Returns after the mouse is released.
   * @param sourceBlockId - The block ID to drag
   * @param targetBlockId - The block ID to drop after
   */
  async dragBlockAfterNoReorderAssert(sourceBlockId: string, targetBlockId: string): Promise<void> {
    const iframe = this.getIframe();
    await this.clickBlockInIframe(sourceBlockId);
    await this.waitForBlockSelectedInAdmin(sourceBlockId);
    const targetBlock = iframe.locator(`[data-block-uid="${targetBlockId}"]`).first();
    // Position after the target with the mouse still down, then release.
    await this.dragBlockWithMouseNoDrop(targetBlock, targetBlock, true);
    await this.page.mouse.up();
  }

  /**
   * Click "Convert" on the "Convert blocks?" confirm that a drop/paste opens when
   * it would change any block's @type (the trial-then-confirm gate). Waits for the
   * dialog, then commits.
   */
  async confirmConvert(): Promise<void> {
    const btn = this.page.locator('.ui.modal .actions button.primary');
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await expect(this.page.locator('.ui.modal')).toBeHidden({ timeout: 5000 });
  }

  /**
   * Drag a block after another and, because the drop converts its type, click
   * through the "Convert blocks?" confirm. Releases without asserting a reorder
   * (the move waits on the confirm), then commits via {@link confirmConvert}.
   */
  async dragBlockAfterConfirmConvert(sourceBlockId: string, targetBlockId: string): Promise<void> {
    await this.dragBlockAfterNoReorderAssert(sourceBlockId, targetBlockId);
    await this.confirmConvert();
  }

  /**
   * Drag a block before another block by their IDs.
   * First selects the source block, then drags it before the target block.
   * @param sourceBlockId - The block ID to drag
   * @param targetBlockId - The block ID to drop before
   */
  async dragBlockBefore(sourceBlockId: string, targetBlockId: string): Promise<void> {
    const iframe = this.getIframe();

    // Select the source block first
    await this.clickBlockInIframe(sourceBlockId);
    await this.waitForBlockSelectedInAdmin(sourceBlockId);

    // Get target block locator
    const targetBlock = iframe.locator(`[data-block-uid="${targetBlockId}"]`).first();

    // Use dragBlockWithMouse with insertAfter=false
    await this.dragBlockWithMouse(targetBlock, targetBlock, false);
  }

  /**
   * Drag a block to target position but DON'T complete the drop.
   * Use this to inspect drop indicator position during drag.
   * Call page.mouse.up() to release when done inspecting.
   *
   * @param _dragHandle - Unused, kept for API compatibility
   * @param targetBlock - The target block locator (where to drag to)
   * @param insertAfter - If true, position for insertion after target; if false, before
   * @param options.testAutoScroll - If true, use hydra's auto-scroll; if false (default), use fast scroll
   */
  async dragBlockWithMouseNoDrop(
    _dragHandle: Locator,
    targetBlock: Locator,
    insertAfter: boolean = true,
    options: { testAutoScroll?: boolean } = {}
  ): Promise<void> {
    // Step 1: Start drag from toolbar
    await this.startDragFromToolbar();

    // Step 2: Scroll until target is in viewport
    let dropPosPage: { x: number; y: number };
    if (options.testAutoScroll) {
      dropPosPage = await this.autoScrollToTarget(targetBlock, insertAfter);
    } else {
      dropPosPage = await this.fastScrollToTarget(targetBlock, insertAfter);
    }

    // Step 3: Move to drop position (skip verification - test will check indicator)
    await this.moveToDropPosition(targetBlock, insertAfter, dropPosPage, true);

    // Don't complete drop - let test inspect indicator and release mouse
  }

  /**
   * Drag a block horizontally to a target position (for blocks with data-block-add="right").
   * Uses X-axis position to determine left/right insertion.
   *
   * @param _dragHandle - Unused, kept for API compatibility
   * @param targetBlock - The target block locator (where to drop)
   * @param insertAfter - If true, insert to the right; if false, insert to the left
   * @param expectIndicator - Whether to expect drop indicator (true) or rejection (false)
   */
  async dragBlockWithMouseHorizontal(
    _dragHandle: Locator,
    targetBlock: Locator,
    insertAfter: boolean = true,
    expectIndicator: boolean = true
  ): Promise<boolean> {
    // Step 1: Start drag from toolbar
    await this.startDragFromToolbar();

    // Step 2: Calculate horizontal drop position
    const dropPosPage = await this.getHorizontalDropPosition(targetBlock, insertAfter);

    // Step 3: Move to drop position
    await this.page.mouse.move(dropPosPage.x, dropPosPage.y, { steps: 10 });

    // Step 4: Check drop indicator visibility
    const indicatorVisible = await this.checkDropIndicator(expectIndicator);

    // Step 5: Complete the drop
    await this.completeDrop();

    return indicatorVisible;
  }

  /**
   * Get the horizontal drop position for a target block.
   * Returns X at 25% for insertBefore (left), 75% for insertAfter (right).
   */
  private async getHorizontalDropPosition(
    targetBlock: Locator,
    insertAfter: boolean
  ): Promise<{ x: number; y: number }> {
    const targetRect = await targetBlock.boundingBox();
    if (!targetRect) {
      throw new Error('Could not get target block bounding box');
    }

    const dropX = insertAfter
      ? targetRect.x + targetRect.width * 0.75 // Right side
      : targetRect.x + targetRect.width * 0.25; // Left side
    const dropY = targetRect.y + targetRect.height / 2; // Center vertically

    return { x: dropX, y: dropY };
  }

  /**
   * Check if the drop indicator is visible as expected.
   */
  private async checkDropIndicator(expectIndicator: boolean): Promise<boolean> {
    const iframe = this.getIframe();
    const dropIndicator = iframe.locator('.volto-hydra-drop-indicator');

    if (expectIndicator) {
      await expect(dropIndicator).toBeVisible({ timeout: 2000 });
      return true;
    } else {
      await expect(dropIndicator).not.toBeVisible();
      return false;
    }
  }

  /**
   * Wait for the block count to reach a specific value.
   * This is a condition-based wait that replaces arbitrary timeouts.
   *
   * @param expectedCount - The expected number of blocks
   * @param timeout - Maximum time to wait in milliseconds (default 10000)
   * @throws Error if the expected count is not reached within the timeout
   */
  async waitForBlockCountToBe(expectedCount: number, timeout: number = 10000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const currentCount = await this.getBlockCount();

      if (currentCount === expectedCount) {
        return; // Success!
      }

      // Wait a bit before checking again
      await this.page.waitForTimeout(100);
    }

    // Timeout reached - get final count for error message
    const finalCount = await this.getBlockCount();
    throw new Error(
      `Block count did not reach expected value within ${timeout}ms. ` +
      `Expected: ${expectedCount}, Actual: ${finalCount}. ` +
      `This likely means the block add/remove operation did not complete. ` +
      `Check that postMessage communication is working and the Admin UI is processing block changes.`
    );
  }

  /**
   * Wait for the block count to stop changing, and return it.
   *
   * QUIESCENCE, NOT A CONDITION — and that distinction is the whole caveat.
   * "Same count twice" cannot tell FINISHED from HASN'T STARTED: sample before
   * an add lands and 1,1 reads as settled, so the caller proceeds too early.
   * Whenever the expected end state is known, don't call this — assert it:
   * `await expect(blocks).toHaveCount(n)` waits for the thing you actually mean
   * and says what went wrong when it doesn't happen. This is for the case where
   * no target exists (a frontend still hydrating async components).
   *
   * Fails rather than guesses: on timeout it throws with the counts it saw.
   * (It used to sleep 100ms per turn and, on timeout, RETURN the last count —
   * so a never-settling page silently handed the caller a number.)
   *
   * TWO PHASES, because "no measurement yet" and "the count keeps changing" are
   * different faults. One budget for both let a single slow round trip fail the
   * whole thing: on a saturated machine `getBlockOrder()` outlasted the entire
   * 5s, so the poll never completed one sample and reported "the page kept
   * re-rendering" having seen NOTHING (`counts seen: []`) — sending the reader
   * after a re-render that never happened. Phase 1 waits for a count to come
   * back at all; phase 2 judges stability with its own budget.
   *
   * @param timeout - Budget for EACH phase in milliseconds (default 5000)
   * @returns The stable block count
   */
  async getStableBlockCount(timeout: number = 5000): Promise<number> {
    // A caller often triggers a navigation (e.g. a search form submit) and then
    // polls immediately; evaluateAll throws "Execution context was destroyed"
    // if the iframe navigates mid-call. Treat that as "still settling" rather
    // than an error, and keep polling.
    const safeCount = async (): Promise<number> => {
      try {
        return await this.getBlockCount();
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (msg.includes('Execution context was destroyed')) return -1;
        throw e;
      }
    };

    const seen: number[] = [];

    // PHASE 1 — a measurement, any measurement. Until one arrives there is
    // nothing to call stable or unstable.
    await expect
      .poll(async () => safeCount(), {
        timeout,
        message:
          `The iframe never returned a block count within ${timeout}ms — ` +
          `navigation had not finished, or the machine was too loaded for the ` +
          `round trip to complete. This is NOT a re-rendering page.`,
      })
      .toBeGreaterThanOrEqual(0);

    let lastCount = -1;
    let stableChecks = 0;

    // expect.poll owns the interval and the failure — no sleep of our own, and
    // a page that never settles fails loudly instead of returning a number.
    await expect
      .poll(
        async () => {
          const currentCount = await safeCount();
          seen.push(currentCount);
          if (currentCount !== -1 && currentCount === lastCount) {
            stableChecks += 1;
          } else {
            lastCount = currentCount;
            stableChecks = 1;
          }
          return stableChecks;
        },
        {
          timeout,
          message:
            `Block count never settled within ${timeout}ms — counts seen: ` +
            `[${seen.join(', ')}] (-1 = iframe was navigating). The page kept ` +
            `re-rendering; if you know the count you expect, assert it with ` +
            `toHaveCount instead of waiting for quiescence. (A count DID come ` +
            `back — phase 1 passed — so this is genuinely instability.)`,
        },
      )
      .toBeGreaterThanOrEqual(2);

    return lastCount;
  }

  /**
   * Wait for a sidebar field value to change to a specific value.
   * This is a condition-based wait that replaces arbitrary timeouts.
   *
   * @param fieldName - The field name to check
   * @param expectedValue - The expected value
   * @param timeout - Maximum time to wait in milliseconds (default 5000)
   * @throws Error if the expected value is not reached within the timeout
   */
  async waitForFieldValueToBe(
    fieldName: string,
    expectedValue: string,
    timeout: number = 5000
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const currentValue = await this.getSidebarFieldValue(fieldName);

      if (currentValue === expectedValue) {
        return; // Success!
      }

      // Wait a bit before checking again
      await this.page.waitForTimeout(100);
    }

    // Timeout reached - get final value for error message
    const finalValue = await this.getSidebarFieldValue(fieldName);
    throw new Error(
      `Field "${fieldName}" did not reach expected value within ${timeout}ms. ` +
      `Expected: "${expectedValue}", Actual: "${finalValue}". ` +
      `This likely means the field update did not propagate or the form did not update.`
    );
  }

  /**
   * Logout from the Admin UI.
   * Clicks the PersonalTools button in the toolbar, then clicks Logout.
   *
   * @throws Error if logout UI elements cannot be found
   */
  async logout(): Promise<void> {
    // Look for PersonalTools button in the left toolbar
    // The button has class="user" and id="toolbar-personal"
    const userMenu = this.page
      .locator('#toolbar-personal')
      .or(this.page.locator('#toolbar button.user'))
      .or(this.page.locator('[aria-label="Personal tools"]'))
      .first();

    const menuCount = await userMenu.count();
    if (menuCount === 0) {
      throw new Error(
        'PersonalTools button not found. Check that user is logged in and on view page (not edit).',
      );
    }

    // Verify button is visible before clicking
    try {
      await userMenu.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      throw new Error(
        'PersonalTools button exists but is not visible. Check that the toolbar is fully loaded.',
      );
    }

    await userMenu.click();

    // Wait for the actual Logout link to appear. The .or() fallback exists
    // for Volto variants that don't emit #toolbar-logout, but on the live
    // tree (Volto 19) it does — and we MUST wait specifically for it
    // because an a11y announcement <span class="visually-hidden">
    // containing "Menu opened, Focus on Logout" appears slightly before
    // the real link, and an .or()/.first() race can resolve to that span.
    const primaryLogout = this.page.locator('#toolbar-logout');
    const primaryCount = await primaryLogout
      .waitFor({ state: 'visible', timeout: 4000 })
      .then(() => 1)
      .catch(() => 0);
    const logoutButton = primaryCount > 0
      ? primaryLogout
      : this.page
          .locator('a .icon.logout')
          .or(this.page.locator('[aria-label="Logout"]'))
          .or(this.page.locator('text=Logout'))
          .first();

    if (primaryCount === 0) {
      try {
        await logoutButton.waitFor({ state: 'visible', timeout: 2000 });
      } catch (e) {
        throw new Error(
          'Logout button did not appear after clicking user menu. ' +
          'Check that the menu dropdown is working correctly.'
        );
      }
    }

    await logoutButton.click();

    // Wait for redirect to login page
    try {
      await this.page.waitForURL(/.*login.*/, { timeout: 5000 });
    } catch (e) {
      // Check if we're on login page by looking for login form
      const loginForm = this.page.locator('input[type="password"]');
      const isOnLoginPage = await loginForm.isVisible();

      if (!isOnLoginPage) {
        throw new Error(
          'Logout did not redirect to login page. Check that logout is working correctly.'
        );
      }
    }
  }

  /**
   * Assert text selection in the iframe.
   * Returns selection information for further assertions.
   *
   * @param locator - The element locator (usually contenteditable element)
   * @param expectedText - Optional expected selected text
   * @param options - Optional assertion options
   * @returns Selection information object
   */
  async assertTextSelection(
    locator: Locator,
    expectedText?: string,
    options?: {
      shouldExist?: boolean;
      shouldBeCollapsed?: boolean;
      message?: string;
    }
  ): Promise<{
    hasSelection: boolean;
    isCollapsed: boolean;
    selectedText: string;
    rangeCount: number;
  }> {
    const {
      shouldExist = true,
      shouldBeCollapsed = false,
      message = 'Selection assertion'
    } = options || {};

    const selectionInfo = await locator.evaluate(() => {
      const sel = window.getSelection();
      return {
        hasSelection: sel !== null && sel.rangeCount > 0,
        isCollapsed: sel?.isCollapsed || false,
        selectedText: sel?.toString() || '',
        rangeCount: sel?.rangeCount || 0,
      };
    });

    if (shouldExist) {
      if (!selectionInfo.hasSelection) {
        throw new Error(`${message}: Expected selection to exist, but no selection found`);
      }
    } else {
      if (selectionInfo.hasSelection) {
        throw new Error(`${message}: Expected no selection, but found: "${selectionInfo.selectedText}"`);
      }
    }

    if (shouldExist && shouldBeCollapsed !== selectionInfo.isCollapsed) {
      throw new Error(
        `${message}: Expected selection to be ${shouldBeCollapsed ? 'collapsed' : 'not collapsed'}, ` +
        `but it was ${selectionInfo.isCollapsed ? 'collapsed' : 'not collapsed'}`
      );
    }

    if (expectedText !== undefined && selectionInfo.selectedText !== expectedText) {
      throw new Error(
        `${message}: Expected selected text "${expectedText}", ` +
        `but got "${selectionInfo.selectedText}"`
      );
    }

    return selectionInfo;
  }

  /**
   * Wait for the LinkEditor popup to appear and verify its position.
   * The LinkEditor should appear near the selected text in the iframe.
   *
   * IMPORTANT: The LinkEditor popup is ALWAYS rendered in the DOM when Redux
   * show_sidebar_editor is true. It hides itself by positioning off-screen
   * (at -10000, -10000) rather than using display:none or opacity:0.
   * This is controlled by PositionedToolbar which positions based on the
   * selection rect from useSelectionPosition. When no valid selection exists,
   * the popup is positioned off-screen.
   *
   * @param timeout Maximum time to wait for popup in milliseconds
   * @returns The popup element and its bounding box
   */
  async waitForLinkEditorPopup(timeout: number = 5000): Promise<{
    popup: Locator;
    boundingBox: { x: number; y: number; width: number; height: number };
  }> {
    // LinkEditor renders in a PositionedToolbar with className "add-link"
    // There may be multiple elements (one per Slate editor context) - find the one that's on-screen
    const popups = this.page.locator('.add-link, .slate-inline-toolbar, [data-slate-toolbar="link"]');

    // Wait for at least one to exist in DOM
    await popups.first().waitFor({ state: 'visible', timeout });

    // Poll for a popup that's actually on-screen (not at -10000,-10000)
    // The popup may exist but be positioned off-screen until selection position is calculated
    let popup: Locator | null = null;
    let boundingBox: { x: number; y: number; width: number; height: number } | null = null;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const count = await popups.count();

      for (let i = 0; i < count; i++) {
        const candidate = popups.nth(i);
        const box = await candidate.boundingBox();
        if (box && box.x > -100 && box.y > -100) {
          popup = candidate;
          boundingBox = box;
          break;
        }
      }

      if (popup && boundingBox) {
        break;
      }

      // Wait a bit before retrying
      await this.page.waitForTimeout(100);
    }

    if (!popup || !boundingBox) {
      const count = await popups.count();
      throw new Error(`LinkEditor popup not found on-screen. Found ${count} candidates but none at valid position.`);
    }

    // Verify popup has dimensions (width and height > 0)
    if (boundingBox.width === 0 || boundingBox.height === 0) {
      throw new Error(
        `LinkEditor popup has no dimensions! Size: ${boundingBox.width}x${boundingBox.height}`
      );
    }

    // AddLinkForm.componentDidMount does setTimeout(input.focus, 50). The
    // Escape/Enter handler is bound to the input, so callers that press
    // Escape immediately after this returns race the focus timeout. Wait
    // for the input to actually own focus before returning.
    await this.page.waitForFunction(
      () => {
        const input = document.querySelector(
          '.add-link input, .slate-inline-toolbar input',
        ) as HTMLInputElement | null;
        return input !== null && document.activeElement === input;
      },
      { timeout },
    );

    return { popup, boundingBox };
  }

  /**
   * Click at a specific position relative to a formatted element (link, bold, etc).
   *
   * @param editor - The contenteditable editor locator
   * @param position - Where to click: 'inside', 'before', or 'after'
   * @param formatSelector - CSS selector for the format (e.g., 'a' for links, 'strong' for bold)
   * @returns The formatted element that was clicked relative to
   */
  async clickRelativeToFormat(
    editor: Locator,
    position: 'inside' | 'before' | 'after',
    formatSelector: string = 'a'
  ): Promise<Locator> {
    // Wait for editor to be visible first (important for CI timing)
    await editor.waitFor({ state: 'visible', timeout: 10000 });

    // Find the formatted element within the editor
    const formattedElement = editor.locator(formatSelector).first();
    await formattedElement.waitFor({ state: 'visible', timeout: 5000 });

    const box = await formattedElement.boundingBox();
    if (!box) {
      throw new Error(`Formatted element ${formatSelector} has no bounding box`);
    }

    // Cache editor bounding box (call once, not twice)
    const editorBox = await editor.boundingBox();
    if (!editorBox) {
      throw new Error(`Editor has no bounding box`);
    }

    let clickX: number;
    let clickY: number = box.y + box.height / 2; // Middle vertically

    switch (position) {
      case 'inside':
        // Click in the middle of the formatted element
        clickX = box.x + box.width / 2;
        break;
      case 'before':
        // Click 5px before the formatted element
        clickX = box.x - 5;
        break;
      case 'after':
        // Click 5px after the formatted element
        clickX = box.x + box.width + 5;
        break;
    }

    // Click at the calculated position (use cached editorBox)
    await editor.click({
      position: {
        x: clickX - editorBox.x,
        y: clickY - editorBox.y,
      },
    });

    return formattedElement;
  }

  /**
   * Wait for all LinkEditor popups to be hidden.
   *
   * @param timeout - Maximum time to wait in milliseconds (default: 5000)
   */
  async waitForLinkEditorToClose(timeout: number = 5000): Promise<void> {
    // LinkEditor renders in a PositionedToolbar with className "add-link"
    // Wait for NO .add-link elements to be visible
    await this.page.waitForFunction(
      () => {
        const popups = document.querySelectorAll('.add-link');
        return Array.from(popups).every(p => {
          const style = window.getComputedStyle(p);
          return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        });
      },
      { timeout }
    );
  }

  /**
   * Click in the iframe and dispatch mousedown on admin document.
   *
   * In real browsers, clicking inside the iframe causes the parent window to
   * lose focus (blur event), which triggers blur-based handlers like closing
   * popups. Playwright doesn't trigger blur reliably when clicking in iframes,
   * so this method does both: the click AND the mousedown dispatch.
   *
   * @param target - Locator to click, or position relative to iframe
   * @param options - Click options (position, force, etc.)
   */
  async clickInIframeWithBlur(target: Locator): Promise<void> {
    // Click on the target (e.g., an editable element in the iframe)
    await target.click();

    // Dispatch mousedown on admin document to trigger blur-based handlers
    // This mimics what SyncedSlateToolbar.jsx does on window blur
    await this.page.evaluate(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      document.dispatchEvent(mousedownEvent);
    });
  }

  /**
   * Get the URL input field from the LinkEditor popup.
   * Throws if popup is not visible or input is not found.
   *
   * @returns The URL input locator
   */
  async getLinkEditorUrlInput(): Promise<Locator> {
    // First ensure popup is visible
    await this.waitForLinkEditorPopup();

    // Find the URL input within the popup
    const input = this.page.locator('.add-link input, .slate-inline-toolbar input, input[placeholder*="link" i]').first();

    // Wait for input to be visible
    await input.waitFor({ state: 'visible', timeout: 2000 });

    // Wait for the input to actually be focused (componentDidMount completed successfully)
    await expect(input).toBeFocused({ timeout: 2000 });

    return input;
  }

  /**
   * Get the Clear button from the LinkEditor popup.
   * The Clear button appears when the input has text.
   *
   * @returns The Clear button locator
   */
  async getLinkEditorClearButton(): Promise<Locator> {
    // Look for Clear button directly - it should be near the "Add link" input
    const clearButton = this.page.locator('button[aria-label="Clear"]').first();

    await clearButton.waitFor({ state: 'visible', timeout: 2000 });

    return clearButton;
  }

  /**
   * Get the Browse button from the LinkEditor popup.
   * The Browse button appears when the input is empty.
   *
   * @returns The Browse button locator
   */
  async getLinkEditorBrowseButton(): Promise<Locator> {
    // Look for Browse button directly - it should be near the "Add link" input
    const browseButton = this.page.locator('button[aria-label="Open object browser"]').first();

    await browseButton.waitFor({ state: 'visible', timeout: 2000 });

    return browseButton;
  }

  /**
   * Wait for the sidebar's Slate inline toolbar to appear and return it.
   * The sidebar toolbar is a .slate-inline-toolbar that is NOT the main .quanta-toolbar.
   * It appears when text is selected in the sidebar's Slate editor (e.g., RichTextWidget).
   *
   * @param timeout - Maximum time to wait in milliseconds (default: 5000)
   * @returns ElementHandle for the toolbar element
   */
  async waitForSidebarSlateToolbar(timeout: number = 5000): Promise<ElementHandle> {
    // Wait for toolbar and get it in a single atomic operation
    // This avoids race conditions where toolbar disappears between wait and get
    const toolbarHandle = await this.page.waitForFunction(
      () => {
        const toolbars = document.querySelectorAll(
          '.slate-inline-toolbar:not(.quanta-toolbar)',
        );
        for (const toolbar of toolbars) {
          const style = window.getComputedStyle(toolbar);
          if (style.opacity === '1') {
            return toolbar; // Return the element itself
          }
        }
        return null;
      },
      { timeout },
    );

    return toolbarHandle as unknown as ElementHandle;
  }

  /**
   * Get a format button from the sidebar's Slate toolbar.
   * Use this to click Bold, Italic, etc. in the sidebar editor's toolbar.
   *
   * @param toolbar - ElementHandle returned from waitForSidebarSlateToolbar()
   * @param format - The format to get: 'bold', 'italic', 'strikethrough', 'link', etc.
   * @returns ElementHandle for the button element
   */
  async getSidebarToolbarButton(
    toolbar: ElementHandle,
    format: 'bold' | 'italic' | 'strikethrough' | 'link'
  ): Promise<ElementHandle> {
    const formatTitle = format.charAt(0).toUpperCase() + format.slice(1);

    const buttonHandle = await toolbar.evaluateHandle((tb, title) => {
      const button = tb.querySelector(`[title*="${title}" i]`);
      return button;
    }, formatTitle);

    // Check if the handle wraps null
    const isNull = await buttonHandle.evaluate((el) => el === null);
    if (isNull) {
      throw new Error(`Format button "${format}" not found in sidebar toolbar`);
    }

    // Scroll into view to avoid "outside of viewport" issues
    await buttonHandle.evaluate((el) => (el as Element).scrollIntoView({ block: 'center' }));

    return buttonHandle as ElementHandle;
  }

  /**
   * Add a block via the sidebar ChildBlocksWidget.
   * Clicks the add button for the specified container field, and if a block chooser
   * appears (multiple allowed types), selects the specified block type.
   *
   * @param containerFieldTitle - The title of the container field section (e.g., 'Columns', 'Blocks')
   * @param blockType - The block type to add (e.g., 'column', 'slate', 'image'). If the container
   *                    only allows one type, this is ignored and the block is auto-inserted.
   */
  async addBlockViaSidebar(
    containerFieldTitle: string,
    blockType?: string,
  ): Promise<void> {
    // The container field section lives in the settings sidebar, which on mobile is a
    // collapsed off-screen sheet — open it first (no-op on desktop, where it's already
    // beside the canvas). Caller must have selected the container block.
    await this.openSidebar();
    // Find the container field section and its add button
    const section = this.page.locator('.container-field-section', {
      has: this.page.locator('.widget-title', { hasText: containerFieldTitle }),
    });
    const addButton = section.getByRole('button', { name: 'Add block' });
    await expect(addButton).toBeVisible({ timeout: 5000 });

    // A blockType is requested only for a MULTI-type container, where the chooser MUST open. A
    // single-allowed-type container auto-inserts on the Add click (no chooser). Either way, wait
    // for a real CONDITION — never a racy short timeout to guess which of the two happened.
    if (blockType) {
      await addButton.click();
      const blockChooser = this.page.locator('.blocks-chooser');
      await expect(blockChooser).toBeVisible({ timeout: 5000 });

      // Open the accordion section holding the target, then click it. We can't wait on the
      // getByRole locator directly: semantic-ui marks collapsed Accordion.Content aria-hidden, so
      // a button inside one is absent from the a11y tree — even `state: 'attached'` never resolves.
      // Hence the section is located via the DOM (textContent), not by role.
      const blockButton = blockChooser
        .getByRole('button', { name: new RegExp(blockType, 'i') })
        .first();
      if (!(await blockButton.isVisible().catch(() => false))) {
        const sectionIndex = await blockChooser.locator('.accordion > .content').evaluateAll(
          (contents, pattern) => {
            const re = new RegExp(pattern, 'i');
            return contents.findIndex((c) =>
              Array.from(c.querySelectorAll('button')).some((b) => re.test(b.textContent || '')),
            );
          },
          blockType,
        );
        if (sectionIndex < 0) {
          throw new Error(`addBlockViaSidebar('${blockType}'): not offered by the open chooser.`);
        }
        await blockChooser.locator('.accordion > .title').nth(sectionIndex).click();
      }
      await expect(blockButton).toBeVisible({ timeout: 5000 });
      await blockButton.click();
      await expect(blockChooser).toBeHidden({ timeout: 5000 });
    } else {
      // Single-allowed-type container auto-inserts on the Add click (no chooser). The insert can
      // land in a region the page-level block count doesn't track (e.g. a forced footer), so
      // there's no clean count/selector to await — confirm no chooser opened, which for a
      // single-type container is immediate, and gives the re-render a brief settle.
      await addButton.click();
      await this.page
        .locator('.blocks-chooser')
        .waitFor({ state: 'visible', timeout: 1000 })
        .catch(() => {});
    }
    // Mobile: dismiss the full-screen sheet so the newly-added block is tappable on
    // the canvas for the next step. Desktop: no-op.
    await this.closeSidebar();
  }

  /**
   * Click a block action button (e.g., Add Row Before, Add Column Before).
   * Handles both toolbar and overflow dropdown locations since buttons may
   * overflow to dropdown when toolbar is narrow.
   *
   * @param actionTitle - The title/label of the action button (e.g., 'Add Row Before')
   */
  async clickBlockAction(actionTitle: string): Promise<void> {
    const toolbar = this.page.locator('.quanta-toolbar');
    await toolbar.waitFor({ state: 'visible', timeout: 5000 });

    // First try to find the button directly in the toolbar
    const toolbarButton = toolbar.locator(`button[title="${actionTitle}"]`);
    if (await toolbarButton.isVisible().catch(() => false)) {
      await toolbarButton.click();
      return;
    }

    // Button not in toolbar - look in the overflow dropdown
    const dropdownTrigger = toolbar.locator('button[title="More options"]');
    if (!(await dropdownTrigger.isVisible().catch(() => false))) {
      throw new Error(
        `Block action "${actionTitle}" not found in toolbar and no dropdown available`
      );
    }

    await dropdownTrigger.click();

    // Wait for dropdown to open and find the button
    const dropdown = this.page.locator('.volto-hydra-dropdown-menu');
    await dropdown.waitFor({ state: 'visible', timeout: 3000 });

    const dropdownButton = dropdown.locator(`button[title="${actionTitle}"]`);
    if (!(await dropdownButton.isVisible().catch(() => false))) {
      throw new Error(
        `Block action "${actionTitle}" not found in toolbar or dropdown`
      );
    }

    await dropdownButton.click();
  }

  // =============================================================================
  // Object Browser Helpers
  // =============================================================================

  /**
   * Get the object browser popup locator.
   * The object browser can be:
   * - An aside[role="presentation"] (for link editor)
   * - A div with h2 "Choose Image" (for image selection from toolbar)
   *
   * @returns Locator for the object browser popup
   */
  getObjectBrowserPopup(): Locator {
    // Use last() since there may be multiple and the object browser is the newest
    return this.page.locator('aside[role="presentation"], .object-browser-wrapper').last();
  }

  /**
   * Wait for the object browser popup to be fully visible and ready.
   * If the OB opens at a path with no children (e.g. a leaf page), navigates
   * to the parent folder via the breadcrumb so items are visible.
   *
   * @param timeout - Maximum time to wait in milliseconds (default: 10000)
   * @returns Locator for the object browser popup
   */
  async waitForObjectBrowser(timeout: number = 10000): Promise<Locator> {
    // Wait for the Home button which indicates the OB is fully mounted
    // (breadcrumbs rendered means componentDidMount has run)
    const homeButton = this.page.getByRole('button', { name: 'Home' });
    await expect(homeButton).toBeVisible({ timeout });

    return this.page.locator('.object-browser').last();
  }

  /**
   * Navigate to the root (Home) in the object browser.
   * Clicks the Home button in the breadcrumb.
   *
   * @param objectBrowser - The object browser locator (from waitForObjectBrowser)
   */
  async objectBrowserNavigateHome(objectBrowser: Locator): Promise<void> {
    const homeBreadcrumb = objectBrowser.getByRole('button', { name: 'Home' });
    await homeBreadcrumb.waitFor({ state: 'visible', timeout: 2000 });
    await homeBreadcrumb.click();

    // Wait for the listing to update by checking for list items
    await expect(objectBrowser.locator('li[role="listitem"]').first()).toBeVisible({ timeout: 5000 });
  }

  /**
   * Navigate into a folder in the object browser.
   * Clicks the folder item to enter it.
   *
   * @param _objectBrowser - The object browser locator (unused, searches globally)
   * @param folderName - The name of the folder to navigate into (e.g., "Images" or /images/i)
   */
  /**
   * Wait for the object browser to finish fetching a level.
   *
   * The listing area shows `.ob-listing-loading` WHILE fetching and
   * `.object-listing` once the level is in, so a helper that waits for the
   * listing alone waits for something that is not there yet — and a helper that
   * waits a fixed beat races it. Wait for the browser's own signal.
   */
  async waitForObjectBrowserLevel(timeout = 10000): Promise<void> {
    const loading = this.page.locator('.ob-listing-loading');
    await loading
      .first()
      .waitFor({ state: 'hidden', timeout })
      .catch(() => {});
    await this.page
      .locator('.object-listing')
      .first()
      .waitFor({ state: 'attached', timeout })
      .catch(() => {});
  }

  async objectBrowserNavigateToFolder(_objectBrowser: Locator, folderName: string | RegExp): Promise<void> {
    // The browser queries its level when it opens; deciding anything before that
    // lands — including whether to climb — reads an empty listing as "this level
    // has nothing" and walks off in the wrong direction. The browser says when it
    // is fetching, so wait for that to clear rather than guessing at a beat.
    await this.waitForObjectBrowserLevel();
    const folderItem = this.page.locator('.object-listing li').filter({ hasText: folderName });

    const found = await folderItem.first().waitFor({ state: 'visible', timeout: 500 })
      .then(() => true)
      .catch(() => false);

    if (!found) {
      // Climb until the folder shows up. The browser opens in the CURRENT page's
      // folder, which is often a leaf with no children at all — a doc page, say —
      // so the target usually lives one or more levels UP rather than in view.
      //
      // Two affordances, because the browser has had both: the Back button in
      // its header (what it renders today) and breadcrumb sections. Try Back
      // first and fall back, rather than assuming either.
      const back = this.page.locator(
        '.object-browser button[aria-label="Back"], button[aria-label="Back"]',
      );
      const breadcrumbSections = this.page.locator('.object-browser .breadcrumbs .section');
      for (let level = 0; level < 5; level += 1) {
        if (await folderItem.first().isVisible().catch(() => false)) break;
        if (await back.first().isVisible().catch(() => false)) {
          await back.first().click();
        } else {
          const count = await breadcrumbSections.count();
          if (count < 2) break;
          await breadcrumbSections.nth(count - 2).click();
        }
        // The listing re-queries on each level; wait for the browser to say it
        // has finished rather than for a fixed beat.
        await this.waitForObjectBrowserLevel(5000);
      }
    }

    // Try to find and click the folder; if still not found, we're already inside it
    const nowFound = await folderItem.first().waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (nowFound) {
      // With the shadowed OB, clicking a folder row always navigates (all modes)
      await folderItem.first().click({ timeout: 2000 });
      // Wait for the level the click asked for, not for items in it. The browser
      // swaps the listing out for its loading state while fetching, so requiring
      // an item here waits for something that is not on screen yet — and a folder
      // with no children is a legitimate level, not a failure.
      await this.waitForObjectBrowserLevel();
    }
  }

  /**
   * Select an item in the object browser (closes the browser).
   * This is used to select an image or content item.
   *
   * @param _objectBrowser - The object browser locator (unused, searches globally)
   * @param itemName - The name of the item to select (e.g., "Test Image 1" or /test-image-1/i)
   */
  async objectBrowserSelectItem(_objectBrowser: Locator, itemName: string | RegExp): Promise<void> {
    const item = this.page.locator('.object-listing li').filter({ hasText: itemName });

    // Give the initial @search (componentDidMount) time to populate the listing.
    const itemQuickFound = await item.first().waitFor({ state: 'visible', timeout: 1500 })
      .then(() => true)
      .catch(() => false);

    if (!itemQuickFound) {
      // Item not in current listing (e.g. OB opened at a leaf page with no children).
      // Navigate up by clicking the parent breadcrumb section in the OB.
      const sections = this.page.locator('.object-browser .breadcrumbs .section');
      const count = await sections.count();
      if (count >= 2) {
        await sections.nth(count - 2).click();
        await this.page.waitForTimeout(1000);
      }
    }

    await item.first().waitFor({ state: 'visible', timeout: 10000 });

    // Use the radio/checkbox selection control if available (shadowed OB),
    // otherwise fall back to clicking the row directly.
    const selectControl = item.first().locator('.ob-select-control');
    if (await selectControl.isVisible().catch(() => false)) {
      await selectControl.click();
    } else {
      await item.first().click({ force: true });
    }

    // Wait for the object browser to close (single-select modes auto-close)
    const chooseImageHeading = this.page.getByRole('heading', { name: 'Choose Image' });
    const chooseTargetHeading = this.page.getByRole('heading', { name: 'Choose Target' });
    const browserHeading = await chooseImageHeading.isVisible().catch(() => false)
      ? chooseImageHeading
      : chooseTargetHeading;

    try {
      await expect(browserHeading).not.toBeVisible({ timeout: 2000 });
    } catch {
      // Object browser didn't auto-close, close it manually via the X button
      const banner = browserHeading.locator('..');
      const closeButton = banner.locator('button').last();
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
        await this.page.waitForTimeout(500);
      }
      if (await browserHeading.isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
      }
    }
  }

  /**
   * Open the object browser from a sidebar field and wait for it to be ready.
   *
   * @param fieldWrapper - Locator for the field wrapper (e.g., .field-wrapper-image)
   * @returns Locator for the open object browser popup
   */
  async openObjectBrowserFromField(fieldWrapper: Locator): Promise<Locator> {
    const browseButton = fieldWrapper.locator('button[aria-label="Open object browser"]');
    await expect(browseButton).toBeVisible({ timeout: 5000 });
    await browseButton.click();

    return this.waitForObjectBrowser();
  }

  /**
   * Open the object browser from a toolbar AddLinkForm popup.
   * Handles clearing existing value first if needed (browse button only shows when empty).
   *
   * @param popup - Locator for the AddLinkForm popup (e.g., .field-image-editor)
   * @param reopenButton - Locator for the button to reopen the popup after clearing
   * @returns Locator for the open object browser popup
   */
  async openObjectBrowserFromToolbarPopup(popup: Locator, reopenButton: Locator): Promise<Locator> {
    // Check if there's an existing value (clear button visible instead of browse)
    const clearButton = popup.locator('button[aria-label="Clear"]');
    const browseButton = popup.locator('button[aria-label="Open object browser"]');

    if (await clearButton.isVisible().catch(() => false)) {
      // Clear the value first
      await clearButton.click();

      // Popup closes on clear, reopen it
      await reopenButton.click();
      await expect(popup).toBeVisible({ timeout: 5000 });
    }

    // Now browse button should be visible
    await expect(browseButton).toBeVisible({ timeout: 5000 });
    await browseButton.click();

    return this.waitForObjectBrowser();
  }

  /**
   * Submit the AddLinkForm popup if it's still open.
   * The object browser selection sets the URL but doesn't auto-submit due to React async state.
   *
   * @param popup - Locator for the AddLinkForm popup (e.g., .field-image-editor, .field-link-editor)
   */
  async submitAddLinkFormIfOpen(popup: Locator): Promise<void> {
    const submitButton = popup.locator('button[aria-label="Submit"]');
    if (await submitButton.isVisible().catch(() => false)) {
      await submitButton.click();
    }
  }

  /**
   * Simulate drag-and-drop of an image file onto a target element.
   * Uses DataTransfer API to dispatch real drag events that react-dropzone handles.
   *
   * @param dropTarget - Locator for the drop zone element
   * @param filename - Name for the test file (default: 'drag-drop-test.png')
   */
  async dragDropImageFile(
    dropTarget: Locator,
    filename: string = 'drag-drop-test.png',
  ): Promise<void> {
    await expect(dropTarget).toBeVisible({ timeout: 5000 });

    // Scroll into view to ensure element is in viewport for elementFromPoint
    await dropTarget.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(100); // Brief wait for scroll to settle

    const box = await dropTarget.boundingBox();
    if (!box) throw new Error('Could not get bounding box for drop target');
    const dropX = box.x + box.width / 2;
    const dropY = box.y + box.height / 2;

    // Minimal valid 1x1 PNG as base64
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    await this.page.evaluate(
      ({ dropX, dropY, pngBase64, filename }) => {
        const byteCharacters = atob(pngBase64);
        const byteArray = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteArray[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: 'image/png' });
        const file = new File([blob], filename, { type: 'image/png' });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const element = document.elementFromPoint(dropX, dropY);
        if (!element) throw new Error('No element at drop coordinates');

        element.dispatchEvent(
          new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }),
        );
        element.dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
        );
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
        );
      },
      { dropX, dropY, pngBase64, filename },
    );
  }
}
