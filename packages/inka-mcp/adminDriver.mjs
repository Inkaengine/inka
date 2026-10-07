/**
 * Drive a headless Inka admin's agent API (window.__inkaAgent) from Node,
 * through a Playwright page. The MCP server and the tests both use this.
 */

// A cold admin can take a while to render its first page, and its front end
// (a dev server's first compile, a busy machine) a while more to connect.
const LOAD_MS = 60000;
const READY_MS = 60000;

/** Open a page's editor and wait until the agent API and the block map are there. */
export async function openForEdit(page, { adminUrl, path }) {
  await page.goto(`${adminUrl}${path.replace(/\/$/, '')}/edit`, { timeout: LOAD_MS });
  await waitForAgent(page);
}

/**
 * Add a page as a person does: the admin's add form for `type` under `parent`,
 * its title filled in, saved. The admin then opens the new page's editor; this
 * resolves with the new page's path once the agent API is there. A form the
 * CMS or the admin refuses (a required field, a type not allowed there) throws
 * with what the form says.
 */
export async function createPage(page, { adminUrl, parent, type, title }) {
  await page.goto(
    `${adminUrl}${parent.replace(/\/$/, '')}/add?type=${encodeURIComponent(type)}`,
    { timeout: LOAD_MS },
  );
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.status() === 201,
    { timeout: READY_MS },
  );
  created.catch(() => {}); // a refusal wins the race; its timeout is then nobody's
  const errors = page.locator('.toast-inner-content, .field.error .ui.label, .ui.message.error');
  // Settles to what the form says if it refuses; never rejects, so it can be
  // left behind once the page is created.
  const refused = errors.first().waitFor({ state: 'visible', timeout: READY_MS })
    .then(() => errors.allInnerTexts(), () => null);
  await page.locator('#field-title input, input#field-title, input[name="title"]').first().fill(title);
  await page.locator('#toolbar-save').click();
  const outcome = await Promise.race([created.then((response) => ({ response })), refused.then((said) => ({ said }))]);
  if (!outcome.response) {
    if (!outcome.said) throw new Error('create_page: the add form neither saved nor said why');
    throw new Error(`create_page: the add form refused it: ${outcome.said.join(' / ')}`);
  }
  const response = outcome.response;
  const path = new URL((await response.json())['@id']).pathname;
  await page.waitForURL((url) => url.pathname === `${path}/edit`, { timeout: READY_MS });
  await waitForAgent(page);
  return path;
}

/**
 * Throw away the editor's unsaved changes (after a dry run): a full reload,
 * which refetches the page. Client-side navigation would keep the edited state.
 */
export async function discardEdits(page) {
  await page.reload({ waitUntil: 'load' });
  await waitForAgent(page);
}

/**
 * Wait until the editor can be edited: the agent API and its block map, AND
 * the front end's bridge connected (the admin has sent it the page). Before
 * that handshake the admin re-initialises its state from the form when the
 * front end connects, and an edit made in between is silently lost.
 */
export async function waitForAgent(page) {
  await page.waitForFunction(
    () => {
      const agent = window.__inkaAgent;
      const map = agent?.getPage().blockPathMap;
      return !!map && Object.keys(map).length > 0;
    },
    null,
    { timeout: READY_MS },
  );
  const frame = page.locator('#previewIframe').contentFrame();
  const deadline = Date.now() + READY_MS;
  while (!(await frame.locator('body').evaluate(() => window.__hydraBridge?.initialized === true))) {
    if (Date.now() > deadline) {
      throw new Error(`the front end's bridge did not connect within ${READY_MS / 1000}s`);
    }
    await page.waitForTimeout(100);
  }
}

/** An agent (see editBlocks.mjs) whose methods run in the admin page. */
export function agentOn(page) {
  const call = (method, arg) => page.evaluate(
    ([m, a]) => window.__inkaAgent[m](a),
    [method, arg],
  );
  return {
    getPage: () => call('getPage'),
    getDraft: () => call('getDraft'),
    getBlockSchemas: () => call('getBlockSchemas'),
    insert: (op) => call('insert', op),
    update: (op) => call('update', op),
    remove: (id) => call('remove', id),
    move: (op) => call('move', op),
    save: (op) => call('save', op),
  };
}

/**
 * Open a page of the admin that holds no editor (the site's contents view):
 * the site-wide API is there, and no page is locked for editing.
 */
export async function openSite(page, { adminUrl }) {
  await page.goto(`${adminUrl}/contents`, { timeout: LOAD_MS });
  await page.waitForFunction(() => !!window.__inkaSite, null, { timeout: READY_MS });
}

/** The site-wide API (window.__inkaSite), its methods run in the admin page. */
export function siteOn(page) {
  const call = (method, arg) => page.evaluate(
    ([m, a]) => window.__inkaSite[m](a),
    [method, arg],
  );
  return {
    search: (query) => call('search', query),
    get: (path) => call('get', path),
    version: (path) => call('version', path),
    move: (op) => call('move', op),
    rename: (op) => call('rename', op),
    remove: (path) => call('remove', path),
  };
}
