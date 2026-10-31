/**
 * Admin pages in a headless browser, shared by every user of the MCP server
 * (pagePool.mjs decides who gets which page). One browser; each page has a
 * browser context of its own, signed in as the user it serves.
 *
 * A page handed to another user gets a new context: no cookies, storage,
 * cached responses or open frames carry over from the user before (the
 * editor's clipboard, private content the last user could see). A user's own
 * page is kept for their next call, so it costs a page move, not a load.
 */
import { chromium } from 'playwright';
import { pagePool } from './pagePool.mjs';
import { openAdmin, openForEdit, createPage, park, agentOn, siteOn } from './adminDriver.mjs';
import { frontendUrlOf, previewDraft } from './preview.mjs';

/** The browser work behind the pool's slots (see pagePool's `slots`). */
export function browserSlots({ adminUrl, frontendUrl, onAdminLoad = () => {} }) {
  let browser;
  const authCookie = (token) => ({ name: 'auth_token', value: token, url: adminUrl, sameSite: 'Lax' });
  return {
    async assign(slot, user) {
      if (slot.context) await slot.context.close();
      browser ??= await chromium.launch();
      slot.context = await browser.newContext();
      await slot.context.addCookies([
        authCookie(user.token),
        // The admin's front-end choice, as its switcher stores it: a cookie
        // named for the admin's port (utils/cookieNames.js).
        ...(frontendUrl ? [{
          name: `iframe_url_${new URL(adminUrl).port || '80'}`, value: frontendUrl, url: adminUrl, sameSite: 'Lax',
        }] : []),
      ]);
      slot.page = await slot.context.newPage();
      slot.page.on('load', onAdminLoad);
      await openAdmin(slot.page, { adminUrl });
      slot.user = user;
    },
    async retoken(slot, user) {
      await slot.context.addCookies([authCookie(user.token)]);
      slot.user = user;
    },
    async park(slot) {
      await park(slot.page);
    },
    async close(slot) {
      await slot.context?.close();
    },
    async closeBrowser() {
      await browser?.close();
    },
  };
}

/**
 * The admin for the MCP tools: `size` pages shared by every user.
 * `forUser(currentUser)` gives the tools' view of it for one user, where
 * `currentUser()` resolves to { id, token } (the token as renewed now).
 */
export function adminPool({ adminUrl, frontendUrl, size, waitMs, maxIdleMs }) {
  let adminLoads = 0;
  const slots = browserSlots({ adminUrl, frontendUrl, onAdminLoad: () => { adminLoads++; } });
  const pool = pagePool({ size, slots, waitMs, maxIdleMs });
  const as = async (currentUser, work) => pool.use(await currentUser(), (slot) => work(slot.page));
  return {
    forUser(currentUser) {
      return {
        withEditor(path, work) {
          return as(currentUser, async (page) => {
            await openForEdit(page, { path });
            return work(agentOn(page), {
              // The site-wide API is on every admin page, the editor's included.
              site: siteOn(page),
              // Render a draft of this page as a visitor sees it, in its own page
              // (with `focus`, just that block of it), its picture in `maxChars`.
              render: async (draft, viewport, { maxChars, focus }) => {
                const renderedOn = await frontendUrlOf(page);
                const rendered = await previewDraft(page.context(), { frontendUrl: renderedOn, path, draft, viewport, focus, maxChars });
                return { ...rendered, renderedOn: new URL(renderedOn).origin };
              },
            });
          });
        },
        /** Work site-wide, from the parked admin: no editor, and so no lock. */
        withSite(work) {
          return as(currentUser, (page) => work(siteOn(page)));
        },
        /** Add a page through the admin's add form, then work in its editor. */
        withNewPage({ parent, type, title }, work) {
          return as(currentUser, async (page) => {
            await createPage(page, { parent, type, title });
            return work(agentOn(page));
          });
        },
      };
    },
    /** Pages open and busy, the pool's size, and how many full admin loads there have been. */
    get stats() {
      return { ...pool.stats, adminLoads };
    },
    async close() {
      await pool.close();
      await slots.closeBrowser();
    },
  };
}
