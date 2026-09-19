import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * A reveal handle is revealed by what it IS.
 *
 * `data-block-selector` names the element that brings a block into view, and
 * the bridge used to `.click()` whatever carried it. That is right for a tab or
 * an accordion header, and wrong for the controls of a form whose questions
 * appear only when another is answered:
 *
 * - an `<option>` does nothing when clicked — and has no box of its own, so the
 *   bridge judged it hidden and never picked it at all;
 * - a checkbox TOGGLES, so revealing through one that was already ticked
 *   unticked it and hid the very block being revealed;
 * - a text box with a declared value was filled and then its form SUBMITTED,
 *   which is how a search reveals its answer but submits a contact form out
 *   from under an author in the editor.
 *
 * So: an option is selected in its dropdown, a checkbox or radio is ticked (and
 * left ticked), and a fill that already revealed the block stops there — the
 * form is only submitted when filling alone did not do it. Each option carries
 * its own handle, which is how one question reveals different blocks for
 * different answers without any new syntax.
 */
const PAGE = `<!DOCTYPE html>
  <form id="f">
    <select name="topic">
      <option value="">Choose</option>
      <option value="billing" data-block-selector="billing-address">Billing</option>
      <option value="other" data-block-selector="other-details">Other</option>
    </select>
    <input type="checkbox" name="agree" value="yes" data-block-selector="agree-details">
    <input name="name" data-block-selector="name-chosen" data-block-selector-input="Ada">
    <input name="q" data-block-selector="quick" data-block-selector-input="what is inka">
    <div data-block-uid="billing-address" hidden></div>
    <div data-block-uid="other-details" hidden></div>
    <div data-block-uid="agree-details" hidden></div>
    <div data-block-uid="name-chosen" hidden></div>
    <div data-block-uid="quick" hidden></div>
  </form>`;

/**
 * The page, wired the way a form's show-when rules wire it: each question
 * appears on the answer that unlocks it, synchronously, on the form's own
 * input/change events. `quick` is the search case — nothing on the page reveals
 * it; only submitting the query would.
 */
function page() {
  const { window } = new JSDOM(PAGE);
  const document = window.document;
  const form = document.getElementById('f');
  const show = (uid, on) => {
    document.querySelector(`[data-block-uid="${uid}"]`).hidden = !on;
  };
  const apply = () => {
    const topic = form.elements.topic.value;
    show('billing-address', topic === 'billing');
    show('other-details', topic === 'other');
    show('agree-details', form.elements.agree.checked);
    show('name-chosen', form.elements.name.value !== '');
  };
  form.addEventListener('change', apply);
  form.addEventListener('input', apply);
  let submitted = 0;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitted += 1;
  });
  return { window, document, form, submitted: () => submitted };
}

/** A bridge with only the parts a reveal touches. */
function bridgeOn(document) {
  return Object.assign(Object.create(Bridge.prototype), {
    blockPathMap: {},
    // As a browser reports it: an <option> has no box of its own, and anything
    // inside a `hidden` element is not on screen.
    isElementHidden: (el) => el.tagName === 'OPTION' || !!el.closest('[hidden]'),
    queryBlockElement: (uid) => document.querySelector(`[data-block-uid="${uid}"]`),
    elementIsVisibleInViewport: () => true,
    scrollBlockIntoView: () => {},
  });
}

// What the bridge reaches for as browser globals, taken from the page's own
// window so events and value setters belong to the same DOM as the elements.
const WINDOW_GLOBALS = ['Event', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement'];

function withDocument(document, fn) {
  const previous = globalThis.document;
  const previousRaf = globalThis.requestAnimationFrame;
  const previousGlobals = WINDOW_GLOBALS.map((k) => globalThis[k]);
  for (const k of WINDOW_GLOBALS) globalThis[k] = document.defaultView[k];
  globalThis.document = document;
  // The bridge polls for the target on the next frame; these tests are about
  // what it DID to the page, so the poll is a no-op.
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

const shown = (document, uid) =>
  !document.querySelector(`[data-block-uid="${uid}"]`).hidden;

describe('tryMakeBlockVisible — reveal by what the handle is', () => {
  test('an <option> is selected in its dropdown', () => {
    const p = page();
    withDocument(p.document, () => {
      bridgeOn(p.document).tryMakeBlockVisible('billing-address');
    });
    expect(p.form.elements.topic.value).toBe('billing');
    expect(shown(p.document, 'billing-address')).toBe(true);
  });

  test('one question reveals a different block for each answer', () => {
    const p = page();
    withDocument(p.document, () => {
      bridgeOn(p.document).tryMakeBlockVisible('other-details');
    });
    expect(p.form.elements.topic.value).toBe('other');
    expect(shown(p.document, 'other-details')).toBe(true);
    expect(shown(p.document, 'billing-address')).toBe(false);
  });

  test('a checkbox is ticked', () => {
    const p = page();
    withDocument(p.document, () => {
      bridgeOn(p.document).tryMakeBlockVisible('agree-details');
    });
    expect(p.form.elements.agree.checked).toBe(true);
    expect(shown(p.document, 'agree-details')).toBe(true);
  });

  test('a checkbox that is already ticked is left ticked, not toggled off', () => {
    const p = page();
    p.form.elements.agree.checked = true;
    // Ticked, yet the block is still hidden — whatever hid it, unticking the
    // box can only make it worse.
    withDocument(p.document, () => {
      bridgeOn(p.document).tryMakeBlockVisible('agree-details');
    });
    expect(p.form.elements.agree.checked).toBe(true);
  });

  test('a fill that already revealed the block does not submit the form', () => {
    const p = page();
    withDocument(p.document, () => {
      bridgeOn(p.document).tryMakeBlockVisible('name-chosen');
    });
    expect(p.form.elements.name.value).toBe('Ada');
    expect(shown(p.document, 'name-chosen')).toBe(true);
    expect(p.submitted()).toBe(0);
  });

  test('a fill that did not reveal the block still submits — the search case', () => {
    const p = page();
    withDocument(p.document, () => {
      bridgeOn(p.document).tryMakeBlockVisible('quick');
    });
    expect(p.form.elements.q.value).toBe('what is inka');
    expect(p.submitted()).toBe(1);
  });
});
