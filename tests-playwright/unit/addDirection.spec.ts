/**
 * getAddDirection() — the axis a container's children sit on.
 *
 * It decides where the `+` appears, which edges a drag inserts at, and which
 * axis the drop indicator is drawn on. Getting it wrong makes a container's
 * inner edges hard to hit: a stacked list treated as a row has its insert edges
 * on its left and right borders, so a cursor in the middle is half the block's
 * width from either, and any enclosing block's edge wins instead.
 *
 * The default used to be nesting-depth parity — page level stacks, one level in
 * is a row — which is a guess about layout that layout already answers. These
 * tests pin the measured behaviour, and the fallback for when there is nothing
 * to measure.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

test.describe('getAddDirection() — measured, not guessed', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  /** Build two sibling blocks laid out on `axis`, and read the direction. */
  async function directionFor(axis: 'row' | 'column') {
    const body = helper.getIframe().locator('body');
    return body.evaluate((_b, layout) => {
      const bridge = (window as any).__hydraBridge;
      const host = document.createElement('div');
      host.style.display = 'flex';
      host.style.flexDirection = layout;
      host.setAttribute('data-block-uid', 'dir-parent');
      for (const uid of ['dir-a', 'dir-b']) {
        const child = document.createElement('div');
        child.setAttribute('data-block-uid', uid);
        child.style.width = '200px';
        child.style.height = '50px';
        host.appendChild(child);
      }
      document.body.appendChild(host);

      // The map the bridge reads siblings and regions from.
      bridge.blockPathMap = {
        ...(bridge.blockPathMap || {}),
        'dir-parent': { parentId: null, region: 'items' },
        'dir-a': { parentId: 'dir-parent', region: 'items' },
        'dir-b': { parentId: 'dir-parent', region: 'items' },
      };

      const measured = bridge._measureAddDirection(document.querySelector('[data-block-uid="dir-a"]'));
      host.remove();
      return measured;
    }, axis);
  }

  test('side by side reads as a row', async () => {
    expect(await directionFor('row')).toBe('right');
  });

  test('stacked reads as a column', async () => {
    expect(await directionFor('column')).toBe('bottom');
  });

  test('a lone child has no axis, so nothing is measured', async () => {
    const body = helper.getIframe().locator('body');
    const measured = await body.evaluate(() => {
      const bridge = (window as any).__hydraBridge;
      const host = document.createElement('div');
      host.setAttribute('data-block-uid', 'solo-parent');
      const only = document.createElement('div');
      only.setAttribute('data-block-uid', 'solo-a');
      only.style.width = '200px';
      only.style.height = '50px';
      host.appendChild(only);
      document.body.appendChild(host);
      bridge.blockPathMap = {
        ...(bridge.blockPathMap || {}),
        'solo-parent': { parentId: null, region: 'items' },
        'solo-a': { parentId: 'solo-parent', region: 'items' },
      };
      const out = bridge._measureAddDirection(document.querySelector('[data-block-uid="solo-a"]'));
      host.remove();
      return out;
    });
    // null, so getAddDirection falls back to the depth guess rather than
    // inventing an axis from one block.
    expect(measured).toBeNull();
  });

  test('a sibling in a DIFFERENT region is not evidence', async () => {
    // A footer holds menu columns, secondary links and social icons — different
    // regions on different axes. Measuring a column against a link would say the
    // columns stack, which is the wrong answer for where a new column goes.
    const body = helper.getIframe().locator('body');
    const measured = await body.evaluate(() => {
      const bridge = (window as any).__hydraBridge;
      const host = document.createElement('div');
      host.style.display = 'flex';
      host.style.flexDirection = 'column';
      host.setAttribute('data-block-uid', 'multi-parent');
      for (const uid of ['reg-a', 'reg-other']) {
        const child = document.createElement('div');
        child.setAttribute('data-block-uid', uid);
        child.style.width = '200px';
        child.style.height = '50px';
        host.appendChild(child);
      }
      document.body.appendChild(host);
      bridge.blockPathMap = {
        ...(bridge.blockPathMap || {}),
        'multi-parent': { parentId: null, region: 'columns' },
        'reg-a': { parentId: 'multi-parent', region: 'columns' },
        'reg-other': { parentId: 'multi-parent', region: 'social' },
      };
      const out = bridge._measureAddDirection(document.querySelector('[data-block-uid="reg-a"]'));
      host.remove();
      return out;
    });
    expect(measured).toBeNull();
  });
});
