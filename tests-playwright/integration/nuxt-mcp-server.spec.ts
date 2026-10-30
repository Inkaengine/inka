/**
 * The MCP server on a front end other than the admin's default: Nuxt. A
 * nuxt-* spec, so it runs where the Nuxt front end is started (nuxt-specific).
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures';
import { TEST_AUTH_TOKEN } from '../helpers/AdminUIHelper';
import { connect, CALL } from '../helpers/mcpClient';

const PAGE = '/_test_data/test-page';

test('INKA_FRONTEND_URL: the editor, and so the preview, use that front end', async ({ urls }) => {
  test.setTimeout(180000);
  const client = await connect({ INKA_TOKEN: `${TEST_AUTH_TOKEN}-${randomUUID()}`, INKA_FRONTEND_URL: urls.nuxt });
  try {
    const read = JSON.parse((await client.callTool({ name: 'get_page', arguments: { path: PAGE } }, undefined, CALL)).content[0].text);
    const ops = [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@type': 'slate', value: 'Previewed on *Nuxt*' }] }];
    const result = await client.callTool({
      name: 'edit_blocks', arguments: { path: PAGE, expectedVersion: read.version, ops, dryRun: true, preview: 'desktop' },
    }, undefined, CALL);
    expect(result.isError, (result.content as any[])[0].text).toBeFalsy();
    const dry = JSON.parse((result.content as any[])[0].text);
    expect(dry.renderedOn).toBe(urls.nuxt);
    // The edit is in the page, then in the render.
    expect(JSON.stringify(dry.page)).toContain('Previewed on *Nuxt*');
    expect(dry.renderedText).toContain('Previewed on Nuxt');
  } finally {
    await client.close();
  }
});
