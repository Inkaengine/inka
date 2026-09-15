/**
 * The three sidebar pickers, in a real admin.
 *
 * Their unit tests all mock the schema context, so they pin the logic given a
 * context and say nothing about whether the sidebar supplies the right one.
 * Nothing else covers the case either: no integration spec drives a widget that
 * reads `useHydraSchemaContext()` — not `blockTypeSelect`, not
 * `schemaFieldSelect`, not `copyFromTarget`. That gap is why a picker could
 * offer the wrong blocks, or show a choice and store nothing, with every unit
 * test green.
 *
 * A form is the case that exercises it: its questions are object_list ITEMS, so
 * a widget on one has to know which item it is inside.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

/** The form fixture's questions, in the order the page holds them. */
const FIRST_QUESTION = 'field-name';
const LAST_QUESTION = 'field-file';

/**
 * A block as it was SAVED, read with the token the admin saved under: Volto
 * trades the seeded cookie for a JWT on login, and the mock keys a save by
 * whichever token sent it. Reading with the other one returns the untouched
 * page — indistinguishable from a save that did nothing.
 */
async function readBlock(page, path: string, blockUid: string) {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'auth_token')?.value;
  expect(token, 'the admin is logged in and holds a token').toBeTruthy();
  const res = await page.request.get(`${URLS.mockApi}/_test_data${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `${path} reads back`).toBeTruthy();
  return (await res.json()).blocks[blockUid];
}

/**
 * Open the FORM block's own sidebar form — the block carrying the three custom
 * widgets. Not the built-in search block: its schema belongs to Volto, so a
 * widget declared for it in this fixture never reaches the sidebar.
 *
 * Clicking the block WRAPPER selects nothing here — the click has to land on an
 * element the frontend annotated, which for this block is its headline (the
 * same gesture block-sync.spec.ts uses). Waiting for the toolbar is what proves
 * the selection happened; without it the sidebar is still the page's, and every
 * field lookup fails as "not found" rather than as "not selected".
 */
async function selectFormBlock(helper: AdminUIHelper, page) {
  await helper.clickBlockInIframe('form-block-1', {
    // Any element carrying the annotation, not an h2: the heading LEVEL is the
    // frontend's styling choice (nuxt's form block renders an h3, the mock an
    // h2) and this helper only needs to select the block. Hardcoding h2 failed
    // admin-nuxt on every picker test while the same tests passed elsewhere.
    // Within a form block only the heading carries `title`; its fields carry
    // `label`.
    selector: '[data-edit-text="title"]',
  });
  await expect(page.locator('.quanta-toolbar')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#sidebar-properties')).toBeVisible({
    timeout: 15000,
  });
}

/** Open a question's own sidebar form. */
async function selectQuestion(helper: AdminUIHelper, uid: string) {
  const iframe = helper.getIframe();
  await expect(iframe.locator(`[data-block-uid="${uid}"]`)).toBeVisible({
    timeout: 30000,
  });
  await helper.clickBlockInIframe(uid, { waitForToolbar: false });
}

/**
 * The entry for choosing nothing, however it is worded: ours (`emptyLabel`) or
 * Volto's own "No value", which it appends to every non-required select.
 */
const isEmptyEntry = (option: string) =>
  option.includes('—') || option.trim() === 'No value';

/** The options a react-select field is offering, as text. */
async function openMenu(page, field: string): Promise<string[]> {
  // Close whatever is open first. Reading a menu that is on its way out (or
  // another field's, still up) returns a list that has nothing to do with the
  // field being asked about — which reads as a failure of the widget rather
  // than of the reading.
  // Not Escape: it leaves block mode and deselects the block, taking the
  // sidebar with it. Clicking the target control closes any other menu anyway.
  const wrapper = page.locator(`#sidebar-properties .field-wrapper-${field}`);
  await expect(wrapper).toBeVisible({ timeout: 15000 });
  await wrapper.locator('.react-select__control').click();
  const menu = wrapper.locator('.react-select__menu');
  await menu.waitFor({ state: 'visible', timeout: 10000 });
  return menu.locator('.react-select__option').allTextContents();
}

test.describe('Sidebar pickers', () => {
  test('direction: a question in the MIDDLE offers earlier ones and no later ones', async ({
    page,
  }) => {
    // From the LAST question every sibling is "before", so the only exclusion
    // exercised is itself. The middle is where `direction` has to choose.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await selectQuestion(helper, 'field-message'); // 4th of 11

    const offered = await openMenu(page, 'show_when_field');
    const questions = offered.filter((o) => !isEmptyEntry(o));
    expect(questions, 'exactly the questions above it, in page order').toEqual([
      'Full Name',
      'Email Address',
      'Subject',
    ]);
  });

  test('scope: a picker never reaches into another form on the same page', async ({
    page,
  }) => {
    // The second form opens with a question labelled "Full Name" too. A picker
    // that scopes by region rather than by MY region offers it, and the rule
    // points at a question this form's visitor never answers — which reads, in
    // the sidebar, exactly like the right choice.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await selectQuestion(helper, 'other-topic'); // 2nd question of form TWO

    const offered = await openMenu(page, 'show_when_field');
    const questions = offered.filter((o) => !isEmptyEntry(o));
    expect(
      questions,
      "only its own form's earlier question, not the other form's",
    ).toEqual(['Full Name']);
    // Its own form's "Full Name" is `other-name`; the other form's is
    // `field-name`. Which one was offered is settled by the stored value in the
    // valueField test, not by the label.
  });

  test('blockPicker offers the questions BEFORE this one, and nothing else', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');

    // The LAST question: everything above it is fair game, itself is not.
    await selectQuestion(helper, LAST_QUESTION);
    const offered = await openMenu(page, 'show_when_field');
    expect(
      offered.some((o) => o.includes('Full Name')),
      'a question above this one is offered',
    ).toBe(true);
    expect(
      offered.some((o) => o.includes('Attach a file')),
      'a question cannot depend on itself',
    ).toBe(false);

    // The FIRST question: nothing precedes it, so no QUESTION may be offered.
    // This is the assertion that catches a picker reading the wrong block — it
    // offers a plausible-looking list instead of none.
    //
    // Asserted as "none of the other questions", not as an empty menu: the menu
    // always carries an entry for choosing nothing, and whose wording that is
    // belongs to the empty-entry test below, not to this one.
    await selectQuestion(helper, FIRST_QUESTION);
    const forFirst = await openMenu(page, 'show_when_field');
    const questionLabels = [
      'Full Name',
      'Email Address',
      'Subject',
      'Message',
      'Priority',
      'Attach a file',
    ];
    expect(
      forFirst.filter((o) => questionLabels.some((q) => o.includes(q))),
      'the first question has nothing to depend on',
    ).toEqual([]);
  });

  test('the entry for choosing nothing reads as the schema asked', async ({
    page,
  }) => {
    // `emptyLabel` is a documented option on all three pickers, and the schemas
    // in this repo and its consumers set it to wording that matters — "always
    // show" and "never locked" mean opposite things, and both are "no rule".
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await selectQuestion(helper, FIRST_QUESTION);

    const offered = await openMenu(page, 'show_when_field');
    expect(
      offered,
      'the empty entry uses the wording the schema gave it',
    ).toContain('— always show —');
  });

  test('valueField: what is STORED is the named field, not the block id', async ({
    page,
  }) => {
    // The previous version of this test asserted the sidebar still displayed
    // the label — which a widget keeping its own state passes. What matters is
    // the value on the block: a rule is evaluated against what a question
    // submits, so it has to be `field_id`.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await selectQuestion(helper, LAST_QUESTION);

    const wrapper = page.locator(
      '#sidebar-properties .field-wrapper-show_when_field',
    );
    await wrapper.locator('.react-select__control').click();
    const menu = wrapper.locator('.react-select__menu');
    await menu.waitFor({ state: 'visible', timeout: 10000 });
    await menu
      .locator('.react-select__option', { hasText: 'Full Name' })
      .click();
    // A second, ordinary edit on the same item: if the label survives the save
    // and the picked question does not, the fault is this field's, not the
    // item's.
    await helper.setSidebarFieldValue('label', 'Attach a file (renamed)');
    await helper.saveContent();

    // The token the ADMIN saved with, not the one the helper set: Volto trades
    // the seeded cookie for a real JWT on login, and the mock keeps a save
    // under whichever token sent it. Reading with the wrong one returns the
    // untouched page, which looks exactly like a save that did nothing.
    const cookies = await page.context().cookies();
    const token = cookies.find((c) => c.name === 'auth_token')?.value;
    expect(token, 'the admin is logged in and holds a token').toBeTruthy();
    const saved = await page.request.get(
      `${URLS.mockApi}/_test_data/form-test-page`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );
    expect(saved.ok(), 'the page reads back').toBeTruthy();
    const body = await saved.json();
    const questions = body.blocks['form-block-1'].subblocks;
    const stored = questions.find((f) => f.field_id === 'field-file');
    expect(
      stored?.label,
      'an ordinary edit on the same item survives the save',
    ).toBe('Attach a file (renamed)');
    expect(
      stored?.show_when_field,
      'the field_id of the chosen question — not its label, uid or index',
    ).toBe('field-name');
  });

  test('blockPicker keeps the choice when the block is left and reselected', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await selectQuestion(helper, LAST_QUESTION);

    const wrapper = page.locator(
      '#sidebar-properties .field-wrapper-show_when_field',
    );
    await wrapper.locator('.react-select__control').click();
    const menu = page.locator('.react-select__menu');
    await menu.waitFor({ state: 'visible', timeout: 10000 });
    await menu
      .locator('.react-select__option', { hasText: 'Full Name' })
      .click();

    // Kept, rather than shown and dropped: leave the block and come back, so
    // the value has to have survived the form data rather than living in the
    // widget's own state.
    await expect(wrapper.locator('.react-select__single-value')).toContainText(
      'Full Name',
    );
    await selectQuestion(helper, FIRST_QUESTION);
    await selectQuestion(helper, LAST_QUESTION);
    await expect(
      wrapper.locator('.react-select__single-value'),
      'the picked question survives leaving the block and returning',
    ).toContainText('Full Name', { timeout: 15000 });
  });

  test('a field revealed by a rule on an ITEM appears once the rule is met', async ({
    page,
  }) => {
    // fieldRules on an object_list item have never been verified against a live
    // admin — the note left when a table's per-item rule was deferred says
    // exactly that. This is the combination: the picker sets a value, and a
    // rule on the SAME item reveals the field that depends on it.
    //
    // A consumer hit this as "the rule will not save". If it reproduces here it
    // is hydra's, with the smallest fixture that shows it; if it passes, the
    // fault is in the consumer's own schema.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await selectQuestion(helper, LAST_QUESTION);

    const condition = page.locator(
      '#sidebar-properties .field-wrapper-show_when_is',
    );
    await expect(
      condition,
      'the condition is hidden while no question is named',
    ).toHaveCount(0);

    const wrapper = page.locator(
      '#sidebar-properties .field-wrapper-show_when_field',
    );
    await wrapper.locator('.react-select__control').click();
    const menu = wrapper.locator('.react-select__menu');
    await menu.waitFor({ state: 'visible', timeout: 10000 });
    await menu
      .locator('.react-select__option', { hasText: 'Full Name' })
      .click();

    await expect(
      condition,
      'naming a question reveals the comparison that depends on it',
    ).toBeVisible({ timeout: 15000 });
  });

  test('vocabularySelect lists the vocabularies the site keeps', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    // The dropdown question is the one that can take its options from a list.
    await selectQuestion(helper, 'field-subject');

    // An empty menu is what a failed request looks like — the widget swallows
    // the error and renders nothing — so the assertion is that terms arrived.
    const offered = await openMenu(page, 'options_from');
    expect(
      offered.filter((o) => !isEmptyEntry(o)).length,
      'the site lists its vocabularies',
    ).toBeGreaterThan(0);
  });

  test('vocabularySelect: the NAME is stored, not the title or the URL', async ({
    page,
  }) => {
    // `@vocabularies` answers `{'@id', title}` — no token — so the value has to
    // be cut from the @id. Storing the URL would bake this site's origin into
    // content; storing the title happens to look identical here, because
    // plone.restapi uses the name as the title.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await selectFormBlock(helper, page);

    const offered = await openMenu(page, 'optionsFrom');
    expect(
      offered.filter((o) => !isEmptyEntry(o)).sort(),
      'every vocabulary the site lists',
    ).toEqual([
      'plone.app.vocabularies.Keywords',
      'plone.app.vocabularies.ReallyUserFriendlyTypes',
    ]);

    // Set through the helper, which asserts the control actually took the value
    // before moving on — so "the save lost it" and "the click never landed"
    // stay distinguishable.
    await helper.setSidebarFieldValue(
      'optionsFrom',
      'plone.app.vocabularies.Keywords',
    );
    // An ordinary field on the same block, changed in the same session: if this
    // survives and the vocabulary does not, the loss belongs to that field.
    await helper.setSidebarFieldValue('title', 'Renamed by the test');

    // Is it in the FORM DATA, or only in the widget? Leaving the block and
    // coming back re-renders the sidebar from the stored data, so a value that
    // never left the widget disappears here — which separates "the widget did
    // not report it" from "the save dropped it".
    await selectQuestion(helper, FIRST_QUESTION);
    await selectFormBlock(helper, page);
    await expect(
      page.locator(
        '#sidebar-properties .field-wrapper-optionsFrom .react-select__single-value',
      ),
      'the chosen vocabulary is in the block data, not just on screen',
    ).toContainText('Keywords', { timeout: 15000 });

    await helper.saveContent();

    const stored = await readBlock(page, '/form-test-page', 'form-block-1');
    expect(
      stored.title,
      'an ordinary edit on the same block survives the save',
    ).toBe('Renamed by the test');
    expect(
      stored.optionsFrom,
      `the vocabulary NAME — usable as @vocabularies/<name> anywhere. Stored keys: ${''}`,
    ).toBe('plone.app.vocabularies.Keywords');
  });

  test('querystringSelect: offers SORTABLE indexes and stores the index name', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await selectFormBlock(helper, page);

    const offered = await openMenu(page, 'sortOn');
    const indexes = offered.filter((o) => !isEmptyEntry(o));
    expect(indexes, 'the catalog says these can be sorted on').toContain(
      'Effective date',
    );
    expect(
      indexes,
      'and not one it only allows filtering on — portal_type is sortable: false',
    ).not.toContain('Type');
    expect(offered.some(isEmptyEntry), 'no sorting is a real answer').toBe(
      true,
    );

    await page
      .locator('#sidebar-properties .field-wrapper-sortOn .react-select__menu')
      .locator('.react-select__option', { hasText: 'Effective date' })
      .click();
    await helper.saveContent();

    const stored = await readBlock(page, '/form-test-page', 'form-block-1');
    expect(
      stored.sortOn,
      'the index NAME a query is built from, not the title an author reads',
    ).toBe('effective');
  });

  test('querystringSelect: `multiple` stores a chosen subset, in order', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await selectFormBlock(helper, page);

    // Through the helper for each pick: it knows a control toggles, and it
    // asserts the value took — a hand-rolled loop clicks the control a second
    // time and closes the menu it is about to read.
    for (const label of ['Title', 'Creation date']) {
      await helper.setSidebarFieldValue('sortOnOptions', label);
    }

    // In the block data, or only on screen? Leaving and returning re-renders
    // the sidebar from what the block holds.
    await selectQuestion(helper, FIRST_QUESTION);
    await selectFormBlock(helper, page);
    await expect(
      page.locator(
        '#sidebar-properties .field-wrapper-sortOnOptions .react-select__value-container',
      ),
      'both chosen indexes are in the block data',
    ).toContainText('Title', { timeout: 15000 });

    await helper.saveContent();

    const stored = await readBlock(page, '/form-test-page', 'form-block-1');
    expect(
      stored.sortOnOptions,
      'an array of index names, in the order the author picked them',
    ).toEqual(['sortable_title', 'created']);
  });
});
