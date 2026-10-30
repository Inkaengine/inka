/**
 * The hosted MCP's admin pages: a fixed number, shared by every user. A page
 * handed from one user to another keeps nothing of the first; a user's own
 * page is kept for their next call; users at once each act as themselves.
 */
import { test, expect } from '../fixtures';
import { tokenFor } from '../helpers/otherUser';
import { adminPool, browserSlots } from '../../packages/inka-mcp/adminPool.mjs';
import { pagePool } from '../../packages/inka-mcp/pagePool.mjs';
import { getPage } from '../../packages/inka-mcp/tools.mjs';
import { subjectOf } from '../../packages/inka-mcp/tokenStore.mjs';

// A fixture page no other spec uses: one test here holds its lock.
const PAGE = '/_test_data/line-breaks-page';

const userFor = (id: string) => ({ id, token: tokenFor(id) });

test.describe('MCP admin pages, shared by users', () => {
  test('a page handed to another user keeps nothing of the one before', async ({ urls }) => {
    test.setTimeout(90000);
    const slots = browserSlots({ adminUrl: urls.voltoSsr });
    const pool = pagePool({ size: 1, slots });
    const [alice, bob] = [userFor('alice'), userFor('bob')];
    try {
      const before = await pool.use(alice, async (slot) => {
        await slot.page.evaluate(() => {
          localStorage.setItem('left-by', 'alice');
          sessionStorage.setItem('left-by', 'alice');
        });
        return slot.context;
      });
      await pool.use(bob, async (slot) => {
        expect(slot.context).not.toBe(before);
        expect(await slot.page.evaluate(() => [localStorage.getItem('left-by'), sessionStorage.getItem('left-by')]))
          .toEqual([null, null]);
        // Signed in as bob (the admin renews its token as it loads, so it is
        // bob's token, not the one he came with), and nothing of alice's.
        const cookies = await slot.context.cookies();
        expect(subjectOf(cookies.find((c) => c.name === 'auth_token')!.value)).toBe('bob');
        expect(cookies.filter((c) => c.value.split('.').length === 3).map((c) => subjectOf(c.value))).not.toContain('alice');
      });
    } finally {
      await pool.close();
      await slots.closeBrowser();
    }
  });

  test("a user's page is kept for their next call", async ({ urls }) => {
    test.setTimeout(90000);
    const pool = adminPool({ adminUrl: urls.voltoSsr, size: 2 });
    const alice = pool.forUser(async () => userFor('alice-kept'));
    try {
      await alice.withEditor(PAGE, getPage);
      await alice.withSite((site) => site.search({ text: 'accordion', limit: 1 }));
      await alice.withEditor(PAGE, getPage);
      expect(pool.stats.adminLoads).toBe(1);
    } finally {
      await pool.close();
    }
  });

  test('users at once each act as themselves: one sees the other editing', async ({ urls }) => {
    test.setTimeout(90000);
    const pool = adminPool({ adminUrl: urls.voltoSsr, size: 2 });
    const alice = pool.forUser(async () => userFor('alice'));
    const bob = pool.forUser(async () => userFor('bob'));
    try {
      // While alice's call has the page open in its editor (her lock), bob reads it.
      const bobSaw = await alice.withEditor(PAGE, async (agent) => {
        expect((await getPage(agent)).lockedBy).toBeUndefined();
        return bob.withEditor(PAGE, getPage);
      });
      expect(bobSaw.lockedBy.user).toBe('alice');
      expect(pool.stats.open).toBe(2);
    } finally {
      await pool.close();
    }
  });
});
