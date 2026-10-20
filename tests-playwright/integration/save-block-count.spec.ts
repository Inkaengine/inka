/**
 * Saving an edit must not leave a second copy of the edited block behind.
 *
 * On a production site a homepage hero appeared twice: one block carrying the
 * newly typed text, and a second block under a fresh uuid carrying the text as
 * it had been BEFORE that edit, sitting immediately after the original.
 *
 * Nothing in the stored content could say what produced it. The editor batches
 * a session into a single PATCH, so "the author duplicated the block and then
 * edited the original" and "the editor wrote a stale snapshot back alongside
 * the edited one" land as the same transaction, holding the same two values.
 * Reading the content, or the ZODB, cannot separate them.
 *
 * This can. It asserts the thing both stories disagree about: whether a save
 * can add a block the author did not ask for. The old value is checked for
 * explicitly rather than the count alone, because a stale copy is only
 * recognisable by the text it carries.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

const PAGE = '/test-page';
const BLOCK = 'block-1-uuid';
const TYPED = 'Edited once, saved once';

test.describe('saving an edit', () => {
  test('editing a block and saving does not add a second copy of it', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();

    // The mock keeps a save in the session of the token that sent it, so every
    // read here goes through the admin's own token.
    const token = (await page.context().cookies()).find(
      (c) => c.name === 'auth_token',
    )?.value;
    expect(token, 'the admin is logged in and holds a token').toBeTruthy();

    const readPage = async () => {
      const res = await page.request.get(`${URLS.mockApi}/_test_data${PAGE}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
      expect(res.ok()).toBeTruthy();
      return res.json();
    };

    const before = await readPage();
    const idsBefore = Object.keys(before.blocks).sort();
    const textBefore = JSON.stringify(before.blocks[BLOCK]);

    await helper.navigateToEdit(PAGE);
    const editor = await helper.enterEditMode(BLOCK);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(TYPED);
    await expect(editor).toHaveText(TYPED);

    await page
      .locator('#toolbar-save, button:has-text("Save")')
      .first()
      .click();
    await expect(page).not.toHaveURL(/\/edit(\?|$)/, { timeout: 15000 });

    const after = await readPage();

    // The edit landed — without this the rest could pass on a save that did
    // nothing at all.
    expect(JSON.stringify(after.blocks[BLOCK])).toContain(TYPED);

    // Not one block more, and not one id different: a duplicate arrives under
    // a new uuid, so the id SET is what catches it, not the length.
    expect(Object.keys(after.blocks).sort()).toEqual(idsBefore);
    expect(after.blocks_layout.items).toEqual(before.blocks_layout.items);

    // And nothing is still holding the pre-edit value. This is the shape the
    // production duplicate had: the original moved on, the copy kept the text
    // as it was at the moment it was made.
    const stale = Object.entries(after.blocks).filter(
      ([id, block]) => id !== BLOCK && JSON.stringify(block) === textBefore,
    );
    expect(
      stale.map(([id]) => id),
      'no block carries the value this block had before the edit',
    ).toEqual([]);
  });
});
