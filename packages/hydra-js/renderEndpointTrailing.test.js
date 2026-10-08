import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * The LAST keystroke of a burst must reach the screen.
 *
 * Sidebar typing sends one undebounced FORM_DATA per character, and a
 * server-rendered frontend answers each with a fetch. While that fetch is in
 * flight the bridge cannot start another, so one of the messages is declined —
 * and the one most likely to be declined is the last, because it arrives while
 * the previous swap is still running.
 *
 * The code that declined it said "newer FORM_DATA will diff again against
 * current lastForm", but it had ALREADY advanced lastForm to the payload it
 * was declining. There was nothing left for a later diff to find, so the
 * dropped render never happened: the editor's final text stayed off the page
 * until they typed again.
 *
 * Asserted here, in jsdom, rather than only through the browser spec that
 * caught it: that one depends on how fast the machine is — it posts fourteen
 * messages and watches the DOM — so it reported this as a flake on a loaded CI
 * runner for as long as it existed. The property is about the bridge's own
 * bookkeeping, and nothing was testing it directly.
 */
function harness({ holdFetch }) {
  const { window } = new JSDOM(
    '<!DOCTYPE html><body><div id="page">' +
      '<div data-block-uid="b1">old</div></div></body>',
  );
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  globalThis.window = window;
  globalThis.document = window.document;

  /**每 swap's fetch, resolved by the test so the race is deterministic. */
  const pending = [];
  globalThis.fetch = () =>
    new Promise((resolve) => {
      const respond = (html) =>
        resolve({ ok: true, text: async () => html, status: 200 });
      pending.push(respond);
      if (!holdFetch) respond('<div data-block-uid="b1">rendered</div>');
    });

  const bridge = Object.create(Bridge.prototype);
  const listeners = [];
  bridge.onEditChange = (fn) => listeners.push(fn);
  // Not under test here: the SKIP path for text the iframe already shows.
  bridge._isTextOnlyAndDomMatches = () => false;
  bridge._installRenderEndpoint('/__render', '#page');

  return {
    send: (text) =>
      listeners.forEach((fn) =>
        fn({ blocks: { b1: { '@type': 'slate', value: [{ text }] } } }),
      ),
    pending,
    bridge,
    text: () => window.document.querySelector('[data-block-uid="b1"]')?.textContent,
    restore: () => Object.assign(globalThis, previous),
  };
}

describe('the render endpoint coalescing FORM_DATA', () => {
  let h;
  afterEach(() => h?.restore());

  it('renders the newest form after a swap that was in flight', async () => {
    h = harness({ holdFetch: true });

    h.send('a'); // starts a swap, which we hold open
    h.send('ab'); // declined: a swap is in flight
    h.send('abc'); // declined too; this is the text the editor can see

    // One swap at a time: that constraint is the reason a render gets owed.
    expect(h.pending.length).toBe(1);
    expect(h.bridge.hasPendingRender()).toBe(true);

    // The first swap lands.
    h.pending[0]('<div data-block-uid="b1">a</div>');
    await new Promise((r) => setTimeout(r, 0));

    // And the one that was owed must follow, carrying the NEWEST form —
    // not 'ab', which was superseded before anything was sent.
    // The owed render. Before the fix this stayed at 1 — the burst's last
    // text was never sent, and the DOM kept what the first swap had drawn.
    expect(h.pending.length).toBe(2);
    h.pending[1]('<div data-block-uid="b1">abc</div>');
    await new Promise((r) => setTimeout(r, 0));

    expect(h.text()).toBe('abc');
    expect(h.bridge.hasPendingRender()).toBe(false);
  });

  it('reports nothing pending once a burst has drained', async () => {
    h = harness({ holdFetch: false });
    h.send('a');
    await new Promise((r) => setTimeout(r, 0));
    // What the browser spec now waits on instead of a wall-clock budget.
    expect(h.bridge.hasPendingRender()).toBe(false);
  });
});
