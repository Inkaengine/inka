/**
 * edit_blocks' `update` changes what it names and nothing else: a field set to
 * null is removed, a field that is an object of fields (`styles`, an
 * objectBlocks' `content`) takes the fields named and keeps the rest, and a
 * region named replaces that region only (inka#674). Each is a dry run in the
 * real editor: the result is the editor's own state, nothing is saved.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { agentOn, waitForAgent, siteOn } from '../../packages/inka-mcp/adminDriver.mjs';
import { getPage, editPage } from '../../packages/inka-mcp/tools.mjs';
import { draftCheck } from '../../packages/inka-mcp/checkDraft.mjs';

const mintId = () => crypto.randomUUID();

async function editing(page, path) {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit(path);
  await waitForAgent(page);
  return agentOn(page);
}

/** The block `uid` after a dry run of `set` on it. */
async function afterUpdate(page, agent, uid, set) {
  const read = await getPage(agent);
  const dry = await editPage(agent, {
    check: draftCheck(agent, siteOn(page)), ops: [{ op: 'update', id: uid, set }],
    expectedVersion: read.version, dryRun: true, mintId,
  });
  const find = (blocks) => {
    for (const b of blocks) {
      if (b['@uid'] === uid) return b;
      for (const v of Object.values(b)) if (Array.isArray(v) && v[0]?.['@type']) { const f = find(v); if (f) return f; }
    }
    return null;
  };
  return find(dry.page.blocks);
}

test.describe('edit_blocks update', () => {
  test('a field set to null is removed', async ({ page }) => {
    const agent = await editing(page, '/search-test-page');
    const block = await afterUpdate(page, agent, 'search-block-1', { facetsTitle: 'Filter by' });
    expect(block.facetsTitle).toBe('Filter by');
    // The editor keeps a dry run's change until it is discarded: this one starts from it.
    const cleared = await afterUpdate(page, agent, 'search-block-1', { facetsTitle: null });
    expect(Object.keys(cleared)).not.toContain('facetsTitle');
  });

  test('an object of fields takes the fields named and keeps the rest, its blocks included', async ({ page }) => {
    const agent = await editing(page, '/object-blocks-page');
    const block = await afterUpdate(page, agent, 'ob-1', { content: { headline: { md: 'New headline' } } });
    expect(block.content.headline.md).toBe('New headline');
    expect(block.content.body.map((b) => b['@uid'])).toEqual(['child-1', 'child-2']);
  });

  test('a region named replaces that region, and leaves the others', async ({ page }) => {
    const agent = await editing(page, '/search-test-page');
    const block = await afterUpdate(page, agent, 'search-block-1', {
      quickAnswer: [{ '@type': 'slate', value: { md: 'Try the help pages' } }],
    });
    expect(block.quickAnswer.map((b) => b.value?.md)).toEqual(['Try the help pages']);
    expect(block.listing.map((b) => b['@uid'])).toEqual(['results-listing']);
  });
});
