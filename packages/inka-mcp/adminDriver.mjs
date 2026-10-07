/**
 * Drive a headless Inka admin's agent API (window.__inkaAgent) from Node,
 * through a Playwright page. The MCP server and the tests both use this.
 */

const READY_MS = 30000;
// A cold admin can take a while to render its first page.
const LOAD_MS = 60000;

/** Open a page's editor and wait until the agent API and the block map are there. */
export async function openForEdit(page, { adminUrl, path }) {
  await page.goto(`${adminUrl}${path.replace(/\/$/, '')}/edit`, { timeout: LOAD_MS });
  await waitForAgent(page);
}

/**
 * Throw away the editor's unsaved changes (after a dry run): a full reload,
 * which refetches the page. Client-side navigation would keep the edited state.
 */
export async function discardEdits(page) {
  await page.reload({ waitUntil: 'load' });
  await waitForAgent(page);
}

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
