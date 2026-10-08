import { test, expect } from './fixtures';

/**
 * Mock Parent Window Inline Editing Tests
 *
 * These tests verify inline editing functionality using a mock parent window
 * instead of full Volto. This tests the postMessage protocol and hydra.js
 * behavior without needing the full Volto stack.
 *
 * Focus areas:
 * - Selection and cursor behavior
 * - Typing works correctly
 * - Deleting works
 * - Events are blocked until update is re-rendered
 *
 * Architecture:
 * - Parent page (mock-parent.html) contains iframe
 * - Iframe loads test-frontend with hydra.js
 * - Mock parent responds to SLATE_TRANSFORM_REQUEST messages with updated Slate JSON
 * - Frontend re-renders when it receives FORM_DATA from parent
 */

test.describe('Inline Editing with Mock Parent', () => {
  test('should load mock parent with iframe and initial content', async ({ helper, page }) => {
    // Verify parent page loaded
    await expect(page.locator('h1')).toContainText('Mock Parent Window');

    // Verify iframe loaded with blocks
    const iframe = helper.getIframe();
    await expect(iframe.locator('[data-block-uid="mock-block-1"]')).toBeVisible();

    // Click block to select it (this will set contenteditable)
    // Use waitForToolbar: false since mock parent doesn't have Volto's quanta-toolbar
    await helper.clickBlockInIframe('mock-block-1', { waitForToolbar: false });

    // Verify initial content
    const content = await iframe.locator('[contenteditable="true"]').first().textContent();
    expect(content?.trim()).toBe('Text to format');
  });

  test('should handle selection and apply formatting', async ({ helper, page }) => {
    const iframe = helper.getIframe();

    // Click block to select it (this will set contenteditable)
    await helper.clickBlockInIframe('mock-block-1', { waitForToolbar: false });

    const editable = iframe.locator('[contenteditable="true"]');

    // Click to focus the editable
    await editable.click();

    // Select all text
    await page.keyboard.press('ControlOrMeta+a');

    // Verify selection exists in iframe (polls until text is selected)
    await expect.poll(() => editable.evaluate(() => window.getSelection()?.toString())).toBe('Text to format');

    // Apply bold using keyboard shortcut (triggers SLATE_TRANSFORM_REQUEST)
    await page.keyboard.press('ControlOrMeta+b');

    // Wait for bold formatting to appear
    await helper.waitForFormattedText(editable, 'Text to format', 'bold');

    // Verify bold was applied
    const boldEl = editable.locator(helper.getFormatSelector('bold')).first();
    await expect(boldEl).toContainText('Text to format');
  });

  test('should maintain cursor position after typing', async ({ helper, page }) => {
    const iframe = helper.getIframe();
    const editable = iframe.locator('[contenteditable="true"]');

    // Click on the editable, then press Home to move cursor to the beginning.
    // Avoid clicking at x=1 — the drag handle overlay sits at the left edge
    // and intercepts pointer events.
    await editable.click();
    await page.keyboard.press('Home');

    // Type some text
    await page.keyboard.type('Hello ');

    // Verify text was added at the beginning
    await expect(editable).toContainText(/^Hello\s+Text to format/);
  });

  test('should handle deleting text with backspace', async ({ helper, page }) => {
    const iframe = helper.getIframe();
    const editable = iframe.locator('[contenteditable="true"]');

    // Click at the end
    await editable.click();
    await page.keyboard.press('End');

    // Delete some characters
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    // Verify text was deleted
    const content = await editable.textContent();
    expect(content).not.toContain('mat'); // 'format' should have lost 'mat'
  });

  test('should buffer input during slow transform and replay after completion', async ({ helper, page }) => {
    // Configure mock parent to simulate a slow transform (500ms delay)
    await page.evaluate(() => {
      window.mockParent.setTransformDelay(500);
    });

    const iframe = helper.getIframe();
    const editable = await helper.getEditorLocator('mock-block-1', 'value');

    // Select all text using keyboard (works across all frontends)
    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');
    await expect.poll(() =>
      helper.getCleanSelectionText(iframe.locator('[contenteditable="true"]'))
    ).toBe('Text to format');

    // Apply bold using keyboard shortcut to trigger transform
    await page.keyboard.press('ControlOrMeta+b');
    // Ctrl+B starts blocking synchronously — typed keys are buffered

    // Type during the slow transform - should be buffered (not inserted yet)
    await page.keyboard.type('BUFFERED');

    // Verify the typed text was NOT inserted yet (buffered during pending transform)
    const textDuringBlock = await editable.textContent();
    console.log('[TEST] Text after typing attempt during transform:', textDuringBlock);
    expect(textDuringBlock).not.toContain('BUFFERED');

    // Wait for transform to complete and buffered text to be replayed
    // The buffered text should appear after cursor is restored
    await expect(editable).toContainText('BUFFERED');

    // Verify bold was applied and BUFFERED replaced original text
    await helper.waitForFormattedText(editable, 'BUFFERED', 'bold');
    await expect(editable).not.toContainText('Text to format');

    // Reset delay for other tests
    await page.evaluate(() => {
      window.mockParent.setTransformDelay(0);
    });
  });

  test('text echo arriving before format response does not lose buffered keystrokes', async ({ helper, page }) => {
    // Reproduce the race condition:
    // 1. Type "Hello" → debounce fires → INLINE_EDIT_DATA sent
    // 2. Ctrl+B → blocking starts, SLATE_TRANSFORM_REQUEST sent
    // 3. " world" typed → buffered
    // 4. Text echo FORM_DATA arrives DURING blocking (before format response)
    // 5. If the echo triggers replayBufferAndUnblock, it drains the buffer
    //    into the pre-format DOM. The format response then overwrites it,
    //    losing the replayed text.
    //
    // We control timing precisely: slow transform (500ms), and manually
    // send the text echo from the test during the blocking window.

    await page.evaluate(() => {
      window.mockParent.setTransformDelay(500);
    });

    const iframe = helper.getIframe();
    const editable = await helper.getEditorLocator('mock-block-1', 'value');

    // Type initial text and wait for debounce to settle
    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Hello');
    await page.waitForTimeout(500);

    // Ctrl+B starts blocking, transform will take 500ms
    await page.keyboard.press('ControlOrMeta+b');
    await page.waitForTimeout(20); // Ensure blocking is set

    // Type during blocking — these go into the event buffer
    await page.keyboard.type(' world');

    // NOW send a text echo FORM_DATA — simulating the INLINE_EDIT_DATA echo
    // arriving during the blocking window (before the format response).
    // This is the exact race: the echo has no formatRequestId.
    await page.evaluate(() => {
      const iframe = document.getElementById('previewIframe');
      const echoData = JSON.parse(JSON.stringify(window.mockParent.getFormData()));
      iframe.contentWindow.postMessage({
        type: 'FORM_DATA',
        data: echoData,
        blockPathMap: window.mockParent.buildBlockPathMap(),
      }, '*');
      console.log('[TEST] Sent text echo FORM_DATA during blocking');
    });

    // Wait for format response (500ms transform) + replay
    await expect(async () => {
      const text = await helper.getCleanTextContent(editable);
      expect(text).toBe('Hello world');
    }).toPass({ timeout: 10000 });

    // Cleanup
    await page.evaluate(() => {
      window.mockParent.setTransformDelay(0);
    });
  });

  test('Redux echo after format response does not overwrite replayed keystrokes', async ({ helper, page }) => {
    // Reproduce the Redux re-render cascade race:
    //
    // In real Volto, after sending the format response FORM_DATA, View.jsx
    // calls onChangeFormData() → Redux update → useEffect → ANOTHER FORM_DATA
    // (without formatRequestId) with the same formatted content.
    //
    // If this "Redux echo" arrives while afterContentRender is in its
    // double-rAF window (after format response rendered, before buffer replay),
    // it triggers callback(formData) → re-renders DOM with PRE-REPLAY data
    // → buffer replay text is lost.
    //
    // The mock parent's mockDuplicateFormData flag sends a duplicate FORM_DATA
    // 50ms after the format response (without formatRequestId) — exactly like
    // a Redux echo. This works cross-origin since postMessage is allowed.

    await page.evaluate(() => {
      window.mockParent.setTransformDelay(200);
      window.mockParent.setDuplicateFormData(true);
    });

    const iframe = helper.getIframe();
    const editable = await helper.getEditorLocator('mock-block-1', 'value');

    // Type initial text and wait for debounce to settle
    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Hello');
    await page.waitForTimeout(500);

    // Ctrl+B starts blocking, transform will take 200ms
    await page.keyboard.press('ControlOrMeta+b');
    await page.waitForTimeout(20); // Ensure blocking is set

    // Type during blocking — these go into the event buffer
    await page.keyboard.type(' world');

    // Wait for format response + replay
    // The Redux echo should NOT overwrite the replayed " world"
    await expect(async () => {
      const text = await helper.getCleanTextContent(editable);
      expect(text).toBe('Hello world');
    }).toPass({ timeout: 10000 });

    // Cleanup
    await page.evaluate(() => {
      window.mockParent.setDuplicateFormData(false);
      window.mockParent.setTransformDelay(0);
    });
  });

  test('Redux echo after format does not destroy selection for subsequent Ctrl+A', async ({ helper, page }) => {
    // Reproduce the CI-flaky scenario:
    // 1. Apply bold to selected text
    // 2. Redux echo (duplicate FORM_DATA) arrives and re-renders DOM
    // 3. Immediately try Ctrl+A — selection should work, not return empty
    //
    // Under load, the echo re-render can destroy focus/selection state,
    // causing the next Ctrl+A to silently fail (empty selection).

    await page.evaluate(() => {
      window.mockParent.setDuplicateFormData(true);
    });

    const iframe = helper.getIframe();
    const editable = await helper.getEditorLocator('mock-block-1', 'value');

    // Select all and apply bold
    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');
    await expect.poll(() => editable.evaluate(() =>
      window.getSelection()?.toString()
    )).toBe('Text to format');

    await page.keyboard.press('ControlOrMeta+b');

    // Wait for bold to be applied (format response + render)
    await helper.waitForFormattedText(editable, 'Text to format', 'bold');

    // Wait long enough for the Redux echo (50ms) to arrive and re-render
    await page.waitForTimeout(200);

    // Now try Ctrl+A — this should select all text even after the echo re-render.
    //
    // Click first, don't just focus(). The field's text is STILL fully selected from
    // the Ctrl+A above (that is the point — the echo didn't destroy it), and Ctrl+A on
    // an already-fully-selected field ESCALATES to block mode by design: hydra's
    // `text → block → siblings` ladder, the same one Gutenberg documents ("select all
    // text in current block... press again to select parent block or all blocks").
    // Block mode deliberately has NO text selected — hydra sets
    // `body[data-hydra-edit-mode="block"]`, which turns off user-select so an iOS
    // long-press can't start a word-selection mid-gesture. So a bare focus()+Ctrl+A
    // here asserts the opposite of the design and only ever passed by accident.
    // Clicking collapses the selection to a caret, so Ctrl+A does what this test means
    // it to: select the field's text again, proving focus/selection survived the echo.
    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');

    const selection = await expect.poll(async () => {
      return editable.evaluate(() => window.getSelection()?.toString().trim() || '');
    }, { timeout: 5000 }).toBeTruthy();

    // Verify we can apply another format (un-bold) without error
    await page.keyboard.press('ControlOrMeta+b');

    // Text should still exist after removing bold
    await expect(async () => {
      const text = await helper.getCleanTextContent(editable);
      expect(text).toBe('Text to format');
    }).toPass({ timeout: 5000 });

    await page.evaluate(() => {
      window.mockParent.setDuplicateFormData(false);
    });
  });

  test('should handle partial text selection', async ({ helper, page }) => {
    const iframe = helper.getIframe();
    const editable = iframe.locator('[contenteditable="true"]');

    await editable.click();

    // Select just "Text" (first word) using helper that walks text nodes
    await helper.selectTextRange(editable, 0, 4);

    // Verify selection was set (strip BOM/ZWS for nextjs compatibility)
    const selectionResult = await editable.evaluate((el) => {
      const sel = el.ownerDocument.defaultView.getSelection();
      const text = (sel?.toString() || '').replace(/[\uFEFF\u200B]/g, '');
      return { text, collapsed: sel?.isCollapsed };
    });
    expect(selectionResult.collapsed).toBe(false);
    expect(selectionResult.text).toBe('Text');

    // Apply bold using keyboard shortcut
    await page.keyboard.press('ControlOrMeta+b');

    // Wait for bold formatting to render
    await helper.waitForFormattedText(editable, 'Text', 'bold');

    const html = await editable.innerHTML();
    console.log('[TEST] HTML after partial selection formatting:', html);
    expect(html).toContain('Text');
    expect(html).toContain('to format');

    // Note: selection restoration after format is tested in integration tests
    // (with real Slate toolbar). Mock parent can't compute correct post-format
    // selection paths — that requires Slate's editor.selection.
  });

  test('should exchange correct postMessage types', async ({ helper, page }) => {
    const messages: string[] = [];

    // Track console messages to verify protocol
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('SLATE_TRANSFORM_REQUEST') ||
          text.includes('FORM_DATA') ||
          text.includes('INITIAL_DATA')) {
        messages.push(text);
        console.log('[PROTOCOL]', text);
      }
    });

    const iframe = helper.getIframe();
    const editable = iframe.locator('[contenteditable="true"]');

    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.waitForTimeout(200);

    // Apply bold using keyboard shortcut
    await page.keyboard.press('ControlOrMeta+b');
    await page.waitForTimeout(500);

    // Verify we saw the expected messages
    const hasTransformRequest = messages.some(m => m.includes('SLATE_TRANSFORM_REQUEST'));
    const hasFormData = messages.some(m => m.includes('FORM_DATA'));

    console.log('[TEST] Protocol messages:', { hasTransformRequest, hasFormData });

    expect(hasTransformRequest || hasFormData).toBe(true); // At least one should be present
  });

  test('should render data-node-id attributes in HTML after formatting', async ({ helper, page }) => {
    const iframe = helper.getIframe();
    const editable = iframe.locator('[contenteditable="true"]');

    // Click to focus the editable
    await editable.click();

    // Select all text
    await page.keyboard.press('ControlOrMeta+a');

    // Verify selection exists in iframe (polls until text is selected)
    await expect.poll(() => editable.evaluate(() => window.getSelection()?.toString())).toBe('Text to format');

    // Apply bold using keyboard shortcut
    await page.keyboard.press('ControlOrMeta+b');

    // Wait for bold formatting to appear
    await helper.waitForFormattedText(editable, 'Text to format', 'bold');

    // Get the rendered HTML
    const outerHtml = await editable.evaluate((el) => el.outerHTML);
    console.log('[TEST] Rendered outerHTML after formatting:', outerHtml);

    // Verify the paragraph element has data-node-id attribute
    expect(outerHtml).toContain('data-node-id=');
    expect(outerHtml).toMatch(/<p[^>]*data-node-id="[^"]+"/);

    // The nodeId should NOT be a temp fallback - it should be a real nodeId from hydra.js
    // For now, we're checking that data-node-id exists (even if it's temp-0)
    // TODO: Verify hydra.js is adding real nodeIds instead of renderer falling back to temp-*
    expect(outerHtml).toMatch(/data-node-id="([^"]+)"/);

    const nodeIdMatch = outerHtml.match(/data-node-id="([^"]+)"/);
    if (nodeIdMatch) {
      console.log('[TEST] Found data-node-id:', nodeIdMatch[1]);
    }
  });

  test('space-only buffer replay is not destroyed by ensureValidInsertionTarget', async ({ helper, page }) => {
    // Reproduce the exact flaky bug from inline-editing-formatting.spec.ts:655.
    //
    // When only a space character is buffered during a format transform:
    // 1. Ctrl+B → blocking starts, SLATE_TRANSFORM_REQUEST sent
    // 2. Space typed → buffered (1 char)
    // 3. Format response arrives → re-render → restoreSlateSelection (ensureZwsPosition
    //    creates BOM in empty bold span) → replayBufferAndUnblock → insertText(" ")
    //    cleans up BOM sibling, inserts space → UNBLOCK
    // 4. Next keydown "w" → element keydown handler calls ensureValidInsertionTarget()
    // 5. BUG: ensureValidInsertionTarget sees the space-only text node inside the
    //    bold <span data-node-id="0.1">, walks up to <p data-edit-text="value"
    //    data-node-id="0">, hits data-edit-text BEFORE data-node-id → breaks
    //    without checking P's content ("Hello ") → replaces space with FEFF
    //
    // We use a transform delay to ensure ONLY the space is buffered,
    // then type the rest after the transform completes.

    const iframe = helper.getIframe();
    const editable = await helper.getEditorLocator('mock-block-1', 'value');

    // Type "Hello" and wait for it to settle
    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Hello');
    await page.waitForTimeout(300);

    // Set a short delay — long enough for the space to be buffered,
    // short enough that subsequent chars arrive after unblocking
    await page.evaluate(() => {
      window.mockParent.setTransformDelay(100);
    });

    // Ctrl+B: toggle bold (prospective formatting with collapsed cursor)
    await page.keyboard.press('ControlOrMeta+b');

    // Type space immediately — should be buffered during the 100ms transform
    await page.waitForTimeout(20); // ensure blocking is set
    await page.keyboard.press('Space');

    // Wait for the transform to complete and space to be replayed
    await page.waitForTimeout(200);

    // Now type "world" — these arrive AFTER unblocking, as direct keystrokes.
    // The "w" keydown will trigger ensureValidInsertionTarget on the space.
    await page.keyboard.type('world');

    // Verify the space was preserved — "Hello world", not "Helloworld"
    await expect(async () => {
      const text = await helper.getCleanTextContent(editable);
      expect(text).toBe('Hello world');
    }).toPass({ timeout: 5000 });

    // Cleanup
    await page.evaluate(() => {
      window.mockParent.setTransformDelay(0);
    });
  });

  test('FORM_DATA arriving mid-keystroke does not lose characters', async ({ helper, page }) => {
    // Reproduce the sidebar typing race condition:
    // In real Volto, sidebar edits trigger an undebounced round-trip:
    //   sidebar onChange → Redux → useEffect → FORM_DATA to iframe → re-render
    // Each FORM_DATA re-renders the iframe DOM. If a keystroke arrives during
    // the re-render window, it could be lost.
    //
    // We simulate this by scheduling FORM_DATA messages with known partial texts
    // from the parent during typing. Uses postMessage (cross-origin safe).

    const iframe = helper.getIframe();
    const editable = await helper.getEditorLocator('mock-block-1', 'value');

    // Type initial content
    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Hello');
    await page.waitForTimeout(300);

    // Schedule FORM_DATA messages with progressive partial texts during typing.
    // Each message simulates the sidebar having received and echoed back the
    // user's text at that point. Sent every 15ms to overlap with keystroke timing.
    await page.evaluate(() => {
      const iframeEl = document.getElementById('previewIframe') as HTMLIFrameElement;
      const partials = ['Hello', 'Hello ', 'Hello w', 'Hello wo', 'Hello wor'];
      let i = 0;
      (window as any).__echoInterval = setInterval(() => {
        if (i >= partials.length) {
          clearInterval((window as any).__echoInterval);
          (window as any).__echoInterval = null; // signal "scheduler done" for waitForFunction below
          return;
        }
        const formData = JSON.parse(JSON.stringify(window.mockParent.getFormData()));
        formData.blocks['mock-block-1'].value = [
          { type: 'p', children: [{ text: partials[i] }] },
        ];
        iframeEl.contentWindow!.postMessage({
          type: 'FORM_DATA',
          data: formData,
          blockPathMap: window.mockParent.buildBlockPathMap(),

        }, '*');
        i++;
      }, 15);
    });

    // Now type more text — scheduled FORM_DATA arrives during typing
    await page.keyboard.press('End');
    await page.keyboard.type(' world', { delay: 10 });

    // Wait for the echo scheduler to finish posting (real condition,
    // not a fixed sleep). After this the bridge may still be processing
    // queued FORM_DATA — the stable gate below handles that.
    await page.waitForFunction(
      () => !(window as any).__echoInterval,
      { timeout: 3000 },
    );

    // Stable-for-N-consecutive-polls gate: text must equal "Hello world"
    // for 3 polls in a row (~300ms of stability). Folds the "wait for
    // the last echo to drain through the bridge" beat into the same
    // condition — no separate waitForTimeout needed. If a late echo
    // arrives after the first correct match and reverts the text (the
    // bug the test is designed to detect), the counter resets and we
    // keep waiting; if the bridge's resolution is genuinely broken
    // the poll times out.
    let prev = '';
    let stable = 0;
    await expect.poll(async () => {
      const text = await helper.getCleanTextContent(editable);
      if (text === prev && text === 'Hello world') stable++;
      else { stable = 0; prev = text; }
      return stable >= 3;
    }, { timeout: 5000, intervals: [100, 150, 200] }).toBe(true);

    // Cleanup
    await page.evaluate(() => {
      if ((window as any).__echoInterval) {
        clearInterval((window as any).__echoInterval);
        delete (window as any).__echoInterval;
      }
    });
  });

  test('typing after framework re-render is captured (observer survives DOM replacement)', async ({ helper, page }) => {
    // When onEditChange triggers a framework re-render (Vue, React), the
    // framework may replace the DOM element the MutationObserver was watching.
    // After re-render, typing must still be captured by hydra.js.
    // This catches bugs where the observer is attached to a now-detached element.

    const iframe = helper.getIframe();
    const editable = await helper.getEditorLocator('mock-block-1', 'value');

    // Type initial text
    await editable.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Before');
    await page.waitForTimeout(500); // Let debounce send INLINE_EDIT_DATA

    // Send FORM_DATA to trigger onEditChange → framework re-render.
    // The re-render replaces DOM nodes. Observer must survive.
    await page.evaluate(() => {
      const iframeEl = document.getElementById('previewIframe') as HTMLIFrameElement;
      const formData = JSON.parse(JSON.stringify(window.mockParent.getFormData()));
      const blockPathMap = window.mockParent.buildBlockPathMap();
      iframeEl.contentWindow!.postMessage({
        type: 'FORM_DATA',
        data: formData,
        blockPathMap,
      }, '*');
    });
    await page.waitForTimeout(500); // Let re-render complete

    // Type more text AFTER the re-render
    await page.keyboard.type(' After');
    await page.waitForTimeout(500);

    // Verify both parts are captured
    await expect(async () => {
      const text = await helper.getCleanTextContent(editable);
      expect(text).toBe('Before After');
    }).toPass({ timeout: 5000 });
  });

  test('rapid FORM_DATA from sidebar typing shows final text, not stale render', async ({ helper, page }) => {
    // Reproduce the flaky integration test "editing text in Admin UI updates iframe".
    //
    // In real Volto, sidebar typing sends rapid FORM_DATA messages (one per
    // keystroke, undebounced). Each triggers onEditChange → renderContentWithListings
    // which is async when listings are present. Multiple concurrent async renders
    // can complete out of order, causing stale data to overwrite the latest.
    //
    // We simulate this by sending rapid FORM_DATA messages (one per character
    // of "Make this bold") from the parent via postMessage (cross-origin safe)
    // and verifying the final DOM shows the full text, not a stale partial.

    const iframe = helper.getIframe();

    // Wait for initial content
    await expect(iframe.locator('[data-block-uid="mock-block-1"]')).toBeVisible();
    await helper.clickBlockInIframe('mock-block-1', { waitForToolbar: false });

    // Send rapid FORM_DATA messages simulating sidebar typing "Make this bold"
    const text = 'Make this bold';
    for (let i = 1; i <= text.length; i++) {
      const partialText = text.substring(0, i);
      await page.evaluate(({ partialText }) => {
        const iframeEl = document.getElementById('previewIframe') as HTMLIFrameElement;
        const formData = JSON.parse(JSON.stringify(window.mockParent.getFormData()));
        formData.blocks['mock-block-1'].value = [
          { type: 'p', children: [{ text: partialText }] },
        ];
        iframeEl.contentWindow!.postMessage({
          type: 'FORM_DATA',
          data: formData,
          blockPathMap: window.mockParent.buildBlockPathMap(),

        }, '*');
      }, { partialText });
    }

    // Wait on the BRIDGE'S STATE, not on a stopwatch.
    //
    // This used to require the text to hold still for three consecutive polls
    // inside 5s, as a proxy for "every render has drained". That is a guess
    // about how fast the machine is: under load the last swap had not finished
    // when the budget expired, and a loaded CI runner reported it as a stale
    // render. hasPendingRender() is the real condition — a swap in flight, or
    // one owed behind it — so this waits for exactly as long as the work takes
    // and no longer.
    //
    // The assertion that follows is unchanged in strength: once nothing is
    // pending, the DOM is final, and a stale partial surviving to that point
    // still fails. It fails DETERMINISTICALLY now rather than when the machine
    // happens to be busy.
    const blockLocator = iframe.locator('[data-block-uid="mock-block-1"]');
    const pending = () =>
      iframe
        .locator('body')
        .evaluate(
          () => (window as any).__hydraBridge?.hasPendingRender?.() === true,
        );

    // The text first, THEN the drain — in that order, and not the other way
    // round. Asking "is anything pending?" before the postMessages have been
    // delivered answers no because nothing has STARTED, which passed the gate
    // instantly and asserted against whatever had rendered so far ("Ma"). A
    // state wait has to wait for the state to ARRIVE, not merely to be absent.
    await expect
      .poll(() => helper.getCleanTextContent(blockLocator), {
        timeout: 15_000,
        intervals: [100, 150, 200],
      })
      .toBe('Make this bold');

    // And it has to SURVIVE the drain: a late swap completing afterwards is
    // exactly how a stale partial used to win, and that is what this test
    // exists to catch. No stopwatch — hasPendingRender() is the condition.
    await expect
      .poll(pending, { timeout: 15_000, intervals: [100, 150, 200] })
      .toBe(false);
    expect(await helper.getCleanTextContent(blockLocator)).toBe('Make this bold');
  });

  // NOTE: "should handle selection across node boundaries and delete" test moved to
  // tests-playwright/integration/inline-editing-basic.spec.ts because it requires
  // SLATE_TRANSFORM_REQUEST processing which only works with full Volto Admin UI
});
