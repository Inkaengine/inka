import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * A handle is activated where a person's click would land.
 *
 * `data-block-selector` goes on the element a frontend renders. A design
 * system's script then often turns that element into a shell around the
 * control it builds for itself: the NSW accordion empties its
 * `.nsw-accordion__title`, puts a `<button>` inside it, and binds the toggle —
 * and `aria-expanded` — to that button.
 *
 * A person clicking the title hits the button: the event starts there and
 * bubbles outward. `shell.click()` starts at the shell, so it never reaches the
 * button's listener at all — the panel stayed shut, and every block inside it
 * was unreachable from the sidebar. It went unnoticed while the harness clicked
 * the handle with a real mouse click, which lands on the button like a person's
 * does; asking the bridge instead is what showed it.
 */
const ACCORDION = `<!DOCTYPE html>
  <div class="nsw-accordion">
    <div class="nsw-accordion__title" data-block-selector="panel-1 c2">
      <button class="nsw-accordion__button" type="button" aria-expanded="false">
        The second panel
      </button>
    </div>
    <div class="nsw-accordion__content" hidden>
      <p data-block-uid="c2">Content of the second panel.</p>
    </div>
  </div>`;

/** The accordion as its design system wires it: the BUTTON toggles the panel. */
function accordion() {
  const { window } = new JSDOM(ACCORDION);
  const document = window.document;
  const button = document.querySelector('.nsw-accordion__button');
  const content = document.querySelector('.nsw-accordion__content');
  let shellClicks = 0;
  document
    .querySelector('.nsw-accordion__title')
    .addEventListener('click', (e) => {
      if (e.target === e.currentTarget) shellClicks += 1;
    });
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', open ? 'false' : 'true');
    content.hidden = open;
  });
  return { window, document, button, content, shellClicks: () => shellClicks };
}

/** A bridge with only the parts a reveal touches. */
function bridgeOn(document) {
  return Object.assign(Object.create(Bridge.prototype), {
    blockPathMap: {},
    isElementHidden: (el) => !!el.closest('[hidden]'),
    queryBlockElement: (uid) => document.querySelector(`[data-block-uid="${uid}"]`),
    elementIsVisibleInViewport: () => true,
    scrollBlockIntoView: () => {},
  });
}

const WINDOW_GLOBALS = ['Event', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement'];

function withDocument(document, fn) {
  const previous = globalThis.document;
  const previousRaf = globalThis.requestAnimationFrame;
  const previousGlobals = WINDOW_GLOBALS.map((k) => globalThis[k]);
  for (const k of WINDOW_GLOBALS) globalThis[k] = document.defaultView[k];
  globalThis.document = document;
  globalThis.requestAnimationFrame = () => 0;
  try {
    fn();
  } finally {
    globalThis.document = previous;
    globalThis.requestAnimationFrame = previousRaf;
    WINDOW_GLOBALS.forEach((k, i) => {
      globalThis[k] = previousGlobals[i];
    });
  }
}

describe('tryMakeBlockVisible — the control a script built inside the handle', () => {
  test('a block inside the panel is revealed by the button the design system built', () => {
    const a = accordion();
    withDocument(a.document, () => {
      bridgeOn(a.document).tryMakeBlockVisible('c2');
    });
    expect(a.content.hidden).toBe(false);
    expect(a.button.getAttribute('aria-expanded')).toBe('true');
  });

  test('an open panel is left open — the state is read where the script keeps it', () => {
    const a = accordion();
    a.button.setAttribute('aria-expanded', 'true');
    a.content.hidden = false;
    withDocument(a.document, () => {
      bridgeOn(a.document).tryMakeBlockVisible('c2');
    });
    // Clicking the button again would have closed the very panel being revealed.
    expect(a.content.hidden).toBe(false);
    expect(a.shellClicks()).toBe(0);
  });
});

/**
 * The shell only stands in for a control it wholly contains. A handle that is a
 * control itself, or that holds several, is clicked as it always was — a click
 * on a card carrying one link is a click on the card.
 */
const OWN_CONTROL = `<!DOCTYPE html>
  <div>
    <button data-block-selector="tab-1" aria-expanded="false" id="own">Tab one</button>
    <div data-block-selector="tab-2" id="several">
      <button id="a">Previous</button>
      <button id="b">Next</button>
    </div>
    <div data-block-uid="tab-1" hidden></div>
    <div data-block-uid="tab-2" hidden></div>
  </div>`;

describe('tryMakeBlockVisible — handles that need no resolving', () => {
  const wired = () => {
    const { window } = new JSDOM(OWN_CONTROL);
    const document = window.document;
    const clicked = [];
    for (const id of ['own', 'a', 'b', 'several']) {
      document.getElementById(id).addEventListener('click', (e) => {
        if (e.target === e.currentTarget) clicked.push(id);
      });
    }
    return { document, clicked };
  };

  test('a handle that is itself a control is clicked', () => {
    const w = wired();
    withDocument(w.document, () => {
      bridgeOn(w.document).tryMakeBlockVisible('tab-1');
    });
    expect(w.clicked).toEqual(['own']);
  });

  test('a handle holding several controls is clicked itself, not one of them', () => {
    const w = wired();
    withDocument(w.document, () => {
      bridgeOn(w.document).tryMakeBlockVisible('tab-2');
    });
    expect(w.clicked).toEqual(['several']);
  });
});
