import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * End-to-end coverage for the typed-object_list seeded-empty flow — the form-field case that
 * dcd3114 read-fixed and 582f9d2 write-fixed. A form field seeded as `field_type: 'empty'`
 * (type in the typeField, no `@type`) must:
 *   1. get a '+' (getBlockAddability detects 'empty' via the typeField, not just @type), and
 *   2. when a type is picked, write it to `field_type` (not `@type`) via setBlockType so the
 *      field actually renders.
 * This guards both sides in CI so the object_list-vs-blocks_layout asymmetry can't re-open.
 */
test.describe('form empty field — pick a type (typed object_list)', () => {
  test('a seeded empty form field gets a + and picking a type writes field_type + renders it', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/form-empty-field-test-page');

    const iframe = helper.getIframe();

    // The form's only field is a seeded empty (field_type: 'empty', no @type).
    const emptyField = iframe.locator('[data-block-uid="empty-1"]');
    await expect(emptyField).toBeVisible({ timeout: 10000 });

    // Select it — the '+' must appear. Before dcd3114 this was count 0 (the empty was
    // detected only via @type, which a typed object_list item doesn't carry).
    await helper.clickBlockInIframe('empty-1');
    const addBtn = page.locator('.volto-hydra-add-button');
    await expect(addBtn).toBeVisible({ timeout: 5000 });

    // The '+' must sit IN THE MIDDLE of the empty block, over the centered '+' glyph hydra draws
    // ([data-hydra-empty]::after). Clicking the empty is the only way to type it, so an 'add
    // after' position (below/right of the block, where a normal block's + goes) strands the
    // editor: they click the glyph and nothing happens. Selector-based clicks can't catch that.
    const btnBox = (await addBtn.boundingBox())!;
    const emptyBox = (await emptyField.boundingBox())!;
    const btnCx = btnBox.x + btnBox.width / 2;
    const btnCy = btnBox.y + btnBox.height / 2;
    expect(btnCx).toBeGreaterThanOrEqual(emptyBox.x);
    expect(btnCx).toBeLessThanOrEqual(emptyBox.x + emptyBox.width);
    expect(btnCy).toBeGreaterThanOrEqual(emptyBox.y);
    expect(btnCy).toBeLessThanOrEqual(emptyBox.y + emptyBox.height);
    // ...and actually centered, not merely overlapping a corner.
    expect(Math.abs(btnCx - (emptyBox.x + emptyBox.width / 2))).toBeLessThan(2);
    expect(Math.abs(btnCy - (emptyBox.y + emptyBox.height / 2))).toBeLessThan(2);

    // Pick 'from' (the E-mail field type). onMutateBlock must write it to field_type, not
    // @type (which FormBlock ignores) — otherwise field_type stays 'empty' and nothing renders.
    await addBtn.click();
    await expect(page.locator('.blocks-chooser')).toBeVisible({ timeout: 5000 });
    await helper.selectBlockType('from');

    // The field now renders as an email input — proof the picked type landed in field_type.
    await expect(iframe.locator('.form-block input[type="email"]')).toBeVisible({ timeout: 5000 });
    // ...and it's no longer the empty placeholder.
    await expect(iframe.locator('.form-block', { hasText: 'Empty field — pick a type' })).toHaveCount(0);
    // It is the same item, typed in place: it keeps its id (the object_list's
    // idField), so it can still be selected and edited.
    await expect(iframe.locator('[data-block-uid="empty-1"] input[type="email"]')).toBeVisible();
  });

  test('with one allowed type, the + types the empty field in place and it keeps its id', async ({ page }) => {
    // /form-single-type-page: the form's fields allow only 'static_text' and
    // start empty, so the '+' converts the empty straight away, no chooser.
    // static_text has no schema defaults, so nothing but the '+' itself has to
    // carry the change to the canvas.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-single-type-page');
    const iframe = helper.getIframe();
    await expect(iframe.locator('[data-block-uid="empty-1"]')).toBeVisible({ timeout: 10000 });

    await helper.clickBlockInIframe('empty-1');
    await helper.clickAddBlockButton();
    await expect(page.locator('.blocks-chooser')).toHaveCount(0);
    // The same item, typed in place: it keeps its field_id (the object_list's
    // idField), so it renders as that field and can still be selected.
    await expect(iframe.locator('[data-block-uid="empty-1"] input[type="static_text"]')).toBeVisible({ timeout: 5000 });
    await helper.waitForBlockSelectedInAdmin('empty-1');
  });
});
