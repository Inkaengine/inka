/**
 * A change to a page, checked before it is previewed or saved, with the
 * validator the content in this repo goes through (plone-content-validator.cjs:
 * the deploy gate, the mock API and the `plone-content` CLI use it): each
 * block's fields against its schema, and the page's structure, ids and
 * references.
 *
 * The page is one page of a live site, so the validator is given the page and
 * the templates its blocks fill, and hands back each reference to anything
 * else (`elsewhere`); those are looked up on the site. And only what the change
 * brings is refused: a problem the page already had is not the agent's to fix
 * before it may change anything else.
 */
import validator from '../../tests-playwright/fixtures/plone-content-validator.cjs';
import { buildIdFieldMap } from '../hydra-js/buildBlockPathMap.js';

const { checkIntegrity, checkBlockSchemas, fieldMapFromSchemas } = validator;

/** The change would leave the page invalid: what the validator says, one line each. */
export class DraftInvalid extends Error {}

/** The templates a page's blocks fill, as references (a path, or resolveuid/<uid>). */
function templateRefs(page) {
  return [...new Set([...JSON.stringify(page).matchAll(/"templateId":"([^"]+)"/g)].map(([, ref]) => ref))];
}

/** The path `ref` (a path, or resolveuid/<uid>) names on `site`, or null when nothing has it. */
async function pathOf(ref, site) {
  const uid = ref.match(/resolveuid\/([a-z0-9][-a-z0-9]*)/);
  if (!uid) return ref;
  const found = await site.search({ uid: uid[1], limit: 1 });
  return found.total ? found.items[0].path : null;
}

/** Is `kind` ('path' or 'uid') `value` on `site`? */
async function onSite({ kind, value }, site) {
  if (kind === 'path') return site.exists(value);
  return (await site.search({ uid: value, limit: 1 })).total > 0;
}

/** What the validator finds wrong with `data`, the page at `path`. */
async function problems(data, { path, blocksConfig, templates, site }) {
  const idFieldMap = buildIdFieldMap(blocksConfig, { formatMessage: (m) => m?.defaultMessage || '' });
  const items = [{ rel: path, data: { ...data, '@id': path } }, ...templates];
  const integrity = checkIntegrity(items, { schemasFor: () => blocksConfig, idFieldMap, elsewhere: true });
  const missing = [];
  for (const reference of integrity.elsewhere) {
    if (!(await onSite(reference, site))) missing.push(reference.message);
  }
  const schemas = checkBlockSchemas([items[0]], fieldMapFromSchemas(blocksConfig), { idFieldMap });
  return [...integrity.errors, ...missing, ...schemas.errors]
    // Only the page's own problems: the templates are checked for what the page needs of them.
    .filter((line) => line.trim().startsWith(`${path}:`))
    .map((line) => line.trim());
}

/**
 * The check the editing tools take (tools.mjs: `check({ path, saved, draft })`),
 * for the page open in `agent`'s editor, looking references up on `site`.
 */
export function draftCheck(agent, site) {
  return async ({ path, saved, draft }) => checkDraft({
    path, saved, draft, blocksConfig: (await agent.getBlockSchemas()).types, site,
  });
}

/**
 * Check `draft` (the page at `path` as the change leaves it, stored shape)
 * against `saved` (as it was): DraftInvalid with each problem the change
 * brings. `blocksConfig` is the page's block schemas (getBlockSchemas().types);
 * `site` the admin's site API.
 */
export async function checkDraft({ path, saved, draft, blocksConfig, site }) {
  const templates = [];
  for (const ref of templateRefs([saved, draft])) {
    const at = await pathOf(ref, site);
    if (at) templates.push({ rel: at, data: { ...(await site.get(at)), '@id': at } });
  }
  const context = { path, blocksConfig, templates, site };
  const before = new Set(await problems(saved, context));
  const brought = (await problems(draft, context)).filter((line) => !before.has(line));
  if (brought.length) {
    throw new DraftInvalid(`the change would leave the page invalid, so nothing was previewed or saved:\n${brought.join('\n')}`);
  }
}
