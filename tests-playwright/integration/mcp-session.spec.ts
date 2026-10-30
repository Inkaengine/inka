/**
 * The MCP server's headless admin across calls: one admin page for the
 * session, moved from page to page within the admin rather than loaded
 * afresh for every call, and left between calls on a page with no editor, so
 * nothing a call did is held: no unsaved dry run, no lock.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures';
import { TEST_AUTH_TOKEN } from '../helpers/AdminUIHelper';
import { freshPage, whileEditing } from '../helpers/otherUser';
import { headlessAdmin } from '../../packages/inka-mcp/server.mjs';
import { getPage, editPage, search, movePage } from '../../packages/inka-mcp/tools.mjs';

const PAGE = '/_test_data/test-page';
const OTHER = '/_test_data/accordion-test-page';

test.describe('MCP headless admin session', () => {
  // The mock keys its state by token, so each test has its pages to itself.
  let token: string;
  let admin: ReturnType<typeof headlessAdmin>;

  test.beforeEach(({ urls }) => {
    token = `${TEST_AUTH_TOKEN}-${randomUUID()}`;
    admin = headlessAdmin({ adminUrl: urls.voltoSsr, auth: { token: async () => token } });
  });

  test.afterEach(async () => {
    await admin.close();
  });

  const stored = async (mockApi: string, path: string) => (await fetch(`${mockApi}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })).json();

  test('loads the admin once, for editor and site calls alike', async () => {
    test.setTimeout(90000);
    expect((await admin.withEditor(PAGE, getPage)).path).toBe(PAGE);
    expect((await admin.withEditor(OTHER, getPage)).path).toBe(OTHER);
    expect((await admin.withSite((site) => search(site, { text: 'accordion' }))).total).toBeGreaterThan(0);
    expect((await admin.withEditor(PAGE, getPage)).path).toBe(PAGE);
    expect(admin.adminLoads).toBe(1);
  });

  test('an editor call lets go of its page: no lock left behind', async ({ urls }) => {
    test.setTimeout(60000);
    // A page of its own: locks are seen by every session, and other tests edit the fixtures.
    const own = await freshPage(token);
    await admin.withEditor(own, async (agent) => {
      await getPage(agent);
      expect((await stored(urls.mockApi, own)).lock.locked).toBe(true);
    });
    expect((await stored(urls.mockApi, own)).lock.locked).toBe(false);
  });

  test("a dry run's changes are gone by the next call", async () => {
    test.setTimeout(60000);
    const before = await admin.withEditor(PAGE, getPage);
    await admin.withEditor(PAGE, (agent) => editPage(agent, {
      ops: [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@type': 'slate', value: 'Not kept' }] }],
      expectedVersion: before.version, dryRun: true, mintId: randomUUID,
    }));
    const after = await admin.withEditor(PAGE, getPage);
    expect(after.blocks.map((b) => b['@uid'])).toEqual(before.blocks.map((b) => b['@uid']));
  });

  test('calls made together run one at a time, each on its own page', async () => {
    test.setTimeout(90000);
    const [a, b] = await Promise.all([admin.withEditor(PAGE, getPage), admin.withEditor(OTHER, getPage)]);
    expect([a.path, b.path]).toEqual([PAGE, OTHER]);
  });

  test('a page another user is editing: the agent is told who, and its changes are refused', async () => {
    test.setTimeout(90000);
    const own = await freshPage(token);
    await whileEditing('jane', own, async () => {
      const read = await admin.withEditor(own, getPage);
      expect(read.lockedBy).toEqual({ user: 'jane', since: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });

      const ops = [{ op: 'add', after: 'para', blocks: [{ '@type': 'slate', value: 'Not now' }] }];
      // A dry run saves nothing, so it may go ahead, and says who holds the page.
      const dry = await admin.withEditor(own, (agent) => editPage(agent, { ops, expectedVersion: read.version, dryRun: true, mintId: randomUUID }));
      expect(dry.lockedBy.user).toBe('jane');
      await expect(admin.withEditor(own, (agent) => editPage(agent, { ops, expectedVersion: read.version, mintId: randomUUID })))
        .rejects.toThrow(/being edited by jane since/);
      await expect(admin.withSite((site) => movePage(site, { path: own, target: '/_test_data/container-test-page', expectedVersion: read.version })))
        .rejects.toThrow(/being edited by jane since/);
    });
  });
});
