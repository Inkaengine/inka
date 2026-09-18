import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Issue #296 — "empty means absent" for optional block fields.
 *
 * The feature (reveal an empty optional field inline, from a toolbar toggle)
 * rests on renderers being DATA-DRIVEN: a field with no data renders no element.
 * Today they aren't — both the mock test frontend and the Nuxt example render the
 * element unconditionally so there's always an inline-edit target:
 *
 *   renderer.js:698-705   `<h1 data-edit-text="heading">${heading}</h1>` with `heading || ''`
 *                         and a grey `<div data-edit-media="image">` stand-in when there's no image
 *   block.vue:60-71       `<h1 class="hero-heading">`, `<p class="hero-subheading">`, `<a class="hero-button">`
 *                         unconditional, plus a `v-else` grey `.hero-image` div
 *
 * That's hack #1 from the issue ("per-block always-render"), and it leaks empty
 * elements into VIEW markup. These tests pin the contract that replaces it.
 *
 * `hero` is used because it is the only block exercising all four sentinel types
 * at once — plain string, textarea, slate, link and media.
 *
 * EXPECTED TO FAIL until the example renderers are made data-driven.
 */

/** field name → the attribute the bridge marks it with, and what kind of data it holds. */
const FIELDS = [
  { field: 'heading', kind: 'plain string', attr: 'data-edit-text' },
  { field: 'subheading', kind: 'textarea', attr: 'data-edit-text' },
  { field: 'description', kind: 'slate', attr: 'data-edit-text' },
  { field: 'buttonText', kind: 'plain string (in link)', attr: 'data-edit-text' },
  { field: 'buttonLink', kind: 'link', attr: 'data-edit-link' },
  { field: 'image', kind: 'media', attr: 'data-edit-media' },
] as const;

test.describe('Optional fields — empty means absent (#296)', () => {
  for (const { field, kind, attr } of FIELDS) {
    test(`empty ${kind} field "${field}" renders no element`, async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/optional-fields-page');

      const iframe = helper.getIframe();
      const selector = `[${attr}="${field}"]`;

      // Control first: the POPULATED hero must render the element. Without this the
      // test would pass vacuously on a typo'd selector or a block that never rendered.
      await expect(
        iframe.locator(`[data-block-uid="hero-full"] ${selector}`),
        `populated hero should render ${selector} — if this fails the selector or fixture is wrong, not the feature`,
      ).toHaveCount(1);

      // The actual contract: no data ⇒ no element.
      await expect(
        iframe.locator(`[data-block-uid="hero-empty"] ${selector}`),
        `empty hero must not render ${selector} (${kind}); an always-rendered element leaks into view markup`,
      ).toHaveCount(0);
    });

    test(`cleared ${kind} field "${field}" renders no element`, async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/optional-fields-page');

      const iframe = helper.getIframe();
      const selector = `[${attr}="${field}"]`;

      // "Cleared" is a DIFFERENT state from "never set", and it's the one the widgets
      // actually produce: ObjectBrowserWidget.removeItem writes `[]`, not undefined.
      // `[]` is truthy in JS, so the natural `if (block.field)` rule a renderer writes
      // would render an element for a field the editor just emptied. The bridge has to
      // normalise these away — a renderer must never need `.length` to get this right.
      await expect(
        iframe.locator(`[data-block-uid="hero-cleared"] ${selector}`),
        `cleared hero must not render ${selector} (${kind}); '' / [] must read as absent`,
      ).toHaveCount(0);
    });
  }
});

/**
 * The reveal affordance itself. Reveal is ALWAYS EXPLICIT — no auto-reveal on
 * selection or on insert — so an all-empty block stays an empty box until the
 * editor presses the toggle.
 */
test.describe('Optional fields — reveal toggle (#296)', () => {
  test('toggle reveals every empty inline-editable field on the selected block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/optional-fields-page');

    const iframe = helper.getIframe();
    await helper.clickBlockInIframe('hero-empty');

    // Nothing is revealed until asked — this is the explicit-only contract.
    for (const { field, attr } of FIELDS) {
      await expect(
        iframe.locator(`[data-block-uid="hero-empty"] [${attr}="${field}"]`),
        `${field} must stay hidden before the toggle is pressed`,
      ).toHaveCount(0);
    }

    const toggle = page.locator('.optional-fields-toggle');
    await expect(toggle, 'quanta toolbar should offer the reveal toggle').toBeVisible({
      timeout: 5000,
    });
    await toggle.click();

    // Every empty inline-editable field now has an element to click.
    for (const { field, kind, attr } of FIELDS) {
      await expect(
        iframe.locator(`[data-block-uid="hero-empty"] [${attr}="${field}"]`),
        `${field} (${kind}) should be revealed after pressing the toggle`,
      ).toHaveCount(1);
    }
  });

  test('revealed but unfilled fields leave no trace in saved content', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/optional-fields-page');

    const iframe = helper.getIframe();
    await helper.clickBlockInIframe('hero-empty');
    await page.locator('.optional-fields-toggle').click();

    const heading = iframe.locator('[data-block-uid="hero-empty"] [data-edit-text="heading"]');
    await expect(heading).toHaveCount(1);

    // Step-by-step checks — assert the value is what we think at each stage rather
    // than only at the end, so a divergence is located instead of inferred.

    // 1. Revealed but unfilled: the seed must read as EMPTY (hydra strips zero-width
    //    when deciding emptiness), and carry the schema placeholder.
    await expect(heading).toHaveAttribute('data-empty', '');
    expect(
      (await heading.textContent())?.replace(/[​﻿]/g, ''),
      'revealed-but-unfilled heading should have no visible text',
    ).toBe('');

    // 2. Let the reveal SETTLE before touching anything. Revealing adds several
    //    elements at once, so the block grows and the admin mounts chrome over the
    //    newly-existing fields (a media overlay for the revealed image, repositioned
    //    outline/toolbar). Clicking into a still-resizing block races that, and the
    //    caret gets taken away mid-type. Wait for the condition — every revealable
    //    field present AND the block's geometry unchanged between polls — never a
    //    fixed sleep.
    for (const { field, attr } of FIELDS) {
      await expect(
        iframe.locator(`[data-block-uid="hero-empty"] [${attr}="${field}"]`),
        `${field} should be revealed before we start typing`,
      ).toHaveCount(1);
    }
    const blockBox = iframe.locator('[data-block-uid="hero-empty"]');
    let lastRect = '';
    await expect(async () => {
      const box = await blockBox.boundingBox();
      const rect = JSON.stringify(box);
      const settled = rect === lastRect;
      lastRect = rect;
      expect(settled, 'block geometry should stop changing after reveal').toBe(true);
    }).toPass({ timeout: 10000 });

    // 3. Clicking it must actually focus it (contenteditable, and the caret is in it).
    await heading.click();
    const focused = await iframe.locator('body').evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        editField: el?.closest?.('[data-edit-text]')?.getAttribute('data-edit-text') ?? null,
        editable: el?.isContentEditable ?? false,
      };
    });
    expect(focused, 'click on a revealed field should focus it for editing').toEqual({
      editField: 'heading',
      editable: true,
    });

    // 3. First keystroke: this is where the seeded value stops being empty, so it's
    //    the moment a re-render would steal focus. Assert BOTH the text and that we
    //    are still in the field.
    await page.keyboard.type('F');
    await expect(heading).toHaveText(/F/, { timeout: 5000 });
    const stillFocused = await iframe.locator('body').evaluate(
      () => document.activeElement?.closest?.('[data-edit-text]')?.getAttribute('data-edit-text') ?? null,
    );
    expect(stillFocused, 'focus must survive the first keystroke on a revealed field').toBe('heading');

    // 4. The rest of the word.
    await page.keyboard.type('illed in');
    await expect(heading).toHaveText(/Filled in/, { timeout: 5000 });

    await helper.saveContent();

    // Check what VIEW actually renders — that's the acceptance criterion
    // ("revealed-but-unfilled fields render nothing in view"), and it's stronger
    // than inspecting saved data: it proves no empty element leaked into the page.
    const savedBlock = iframe.locator('.hero-block').first();
    await expect(savedBlock).toContainText('Filled in', { timeout: 10000 });

    // Every field left unfilled must have produced NO element at all.
    await expect(savedBlock.locator('img'), 'unfilled image must not render').toHaveCount(0);
    await expect(savedBlock.locator('a'), 'unfilled button must not render').toHaveCount(0);
    await expect(
      savedBlock.locator('.hero-subheading, .hero-description'),
      'unfilled subheading/description must not render',
    ).toHaveCount(0);
  });

  test('a revealed slate field is typed into through its own empty paragraph', async ({ page }) => {
    // A slate field is never absent: with no schema default it holds one empty
    // paragraph, which the bridge gives a nodeId like any other. Reveal fills
    // THAT paragraph rather than inventing one, so the element the renderer draws
    // carries a data-node-id and the first keystroke maps back into the value.
    // Without the node there is nothing to map to, and the bridge raises its
    // "missing data-node-id" warning instead of taking the text.
    const nodeIdErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().includes('missing data-node-id')) {
        nodeIdErrors.push(m.text());
      }
    });

    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/optional-fields-page');
    const iframe = helper.getIframe();

    await helper.clickBlockInIframe('hero-empty');
    await page.locator('.optional-fields-toggle').click();

    const description = iframe.locator('[data-block-uid="hero-empty"] [data-edit-text="description"]');
    await expect(description).toHaveCount(1);
    await expect(
      description,
      'the revealed paragraph is the field\'s own default one, so it carries its node id',
    ).toHaveAttribute('data-node-id', /.+/);

    await helper.enterEditMode('hero-empty', 'description');
    await description.pressSequentially('Roads closed', { delay: 25 });
    await expect(description).toHaveText('Roads closed');
    expect(nodeIdErrors, 'typing into the revealed slate field must not lose its node').toEqual([]);

    await helper.saveContent();
    await expect(
      iframe.locator('.hero-block').filter({ hasText: 'Roads closed' }).locator('.hero-description'),
      'the typed text is saved as the description and shown in view',
    ).toHaveText('Roads closed', { timeout: 10000 });
  });

  test('a populated field emptied while editing keeps its element', async ({ page }) => {
    // "No data ⇒ no element" would otherwise make a field a trapdoor: delete the
    // last character and the element the caret sits in stops existing.
    //
    // It holds without any reveal machinery, because hydra suppresses the
    // re-render for the field being typed in. Worth pinning even so: the property
    // only started being AT RISK once renderers went data-driven.
    //
    // Note this is text-specific. Emptying a MEDIA field does remove its element,
    // deliberately — deleting an image has to mean the image is gone, or there's no
    // single action for "I want no image". Re-adding one inline is an explicit
    // reveal, and swapping never needs either (the toolbar image button replaces it
    // in one click). See inline-media-link-editing.spec.ts.
    //
    // hero-full's SUBHEADING is used because it starts POPULATED and owns its
    // element outright, unlike buttonText, whose <a> would survive on buttonLink
    // alone. (Not `heading`: that's a copy-from-target destination, so it displays
    // the link target's title rather than its stored value.)
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/optional-fields-page');

    const iframe = helper.getIframe();
    const heading = iframe.locator('[data-block-uid="hero-full"] [data-edit-text="subheading"]');
    await expect(heading).toHaveText('Populated subheading');

    await heading.click();
    await expect(async () => {
      const field = await iframe
        .locator('body')
        .evaluate(
          () =>
            document.activeElement?.closest?.('[data-edit-text]')?.getAttribute('data-edit-text') ??
            null,
        );
      expect(field).toBe('subheading');
    }).toPass({ timeout: 5000 });

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');

    // The element must survive being emptied, still editable, with the caret in it.
    await expect(
      heading,
      'the field being edited must not disappear when it becomes empty',
    ).toHaveCount(1);
    expect((await heading.textContent())?.replace(/[​﻿]/g, '')).toBe('');
    const stillFocused = await iframe
      .locator('body')
      .evaluate(
        () =>
          document.activeElement?.closest?.('[data-edit-text]')?.getAttribute('data-edit-text') ??
          null,
      );
    expect(stillFocused, 'caret must stay in the emptied field').toBe('subheading');

    // And typing continues in place.
    await page.keyboard.type('Refilled');
    await expect(heading).toHaveText(/Refilled/, { timeout: 5000 });
  });

  test('an empty optional field is not reported as a renderer error', async ({ page }) => {
    // Comment-syntax renderers name each field by CSS selector. Before "no data ⇒
    // no element", a selector matching nothing always WAS a renderer bug, so hydra
    // logged console.error. Now it's the correct outcome for an empty field, and
    // erroring on it would train devs to ignore the console — which is where the
    // genuine version of this warning has to land (content, or a revealed sentinel,
    // with no element).
    const selectorErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().includes('Comment selector')) {
        selectorErrors.push(m.text());
      }
    });

    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/optional-fields-page');

    // The populated hero proves the comment path ran at all, so an empty error list
    // can't just mean "nothing was materialised".
    await expect(
      helper.getIframe().locator('[data-block-uid="hero-full"] [data-edit-text="heading"]'),
    ).toHaveCount(1);

    expect(
      selectorErrors,
      'empty optional fields render no element by design — that must not be logged as an error',
    ).toEqual([]);
  });

  test('toggle does not appear on a block with nothing to reveal', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/optional-fields-page');

    await helper.clickBlockInIframe('hero-full');

    await expect(
      page.locator('.optional-fields-toggle'),
      'a fully populated block has no empty optional fields, so no toggle',
    ).toHaveCount(0);
  });
});
