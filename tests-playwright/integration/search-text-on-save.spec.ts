import { expect, test } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Saving a page writes each block's search text from what it holds now, so an edit is
 * findable. What Plone does with it is tested against real Plone in the backend addon
 * (tests/restapi/test_search_text.py).
 */
test('a save carries the search text of what was just typed', async ({ page }) => {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/test-page');

  const word = 'Findableword';
  await helper.editBlockTextInIframe('block-1-uuid', word);

  const save = page.waitForRequest(
    (request) => request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith('/test-page'),
  );
  await helper.saveContent();
  const { blocks } = (await save).postDataJSON();

  // A slate block whose `plaintext` already says it needs no copy: restapi reads either.
  const saved = blocks['block-1-uuid'];
  expect(saved.searchableText ?? saved.plaintext).toContain(word);
});
