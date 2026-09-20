import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * A hydra comment can name the element it annotates with `target(<selector>)`.
 *
 * Comment syntax is for markup you do not write. By default a comment annotates
 * the element right after it, so it has to sit directly above that element or
 * one of its ancestors — which is impossible when a third-party script builds
 * the markup somewhere you never render. The NSW cookie banner is that case: the
 * design system builds it into a fixed container at the end of <body>, outside
 * the consent block, so nothing the block renders can precede it. `target`
 * finds the element anywhere in the document instead; the other attributes, and
 * their own selectors, then apply to it exactly as they would to the next one.
 */
function page(html) {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  return window.document;
}

function materialize(document) {
  const previous = { document: globalThis.document, Node: globalThis.Node, NodeFilter: globalThis.NodeFilter };
  globalThis.document = document;
  globalThis.Node = document.defaultView.Node;
  globalThis.NodeFilter = document.defaultView.NodeFilter;
  try {
    const bridge = Object.assign(Object.create(Bridge.prototype), {
      getRenderedBlockData: () => undefined,
      isFieldAbsentFromRender: () => false,
    });
    bridge.materializeHydraComments();
  } finally {
    Object.assign(globalThis, previous);
  }
}

describe('hydra comment — target(<selector>)', () => {
  test('without target, the next element is annotated, as before', () => {
    const document = page(
      '<!-- hydra block-uid=card-1 edit-text=title(h3) --><div class="card"><h3>T</h3></div>',
    );
    materialize(document);
    expect(document.querySelector('.card').getAttribute('data-block-uid')).toBe('card-1');
    expect(document.querySelector('h3').getAttribute('data-edit-text')).toBe('title');
  });

  test('with target, the matched element is annotated wherever it is', () => {
    const document = page(`
      <main>
        <div data-block-uid="consent-1">
          <!-- hydra target(.nsw-cookie-banner) block-uid=consent-1 edit-text=message(.nsw-cookie-banner__content > p) /-->
          <button>Show cookie consent</button>
        </div>
      </main>
      <div class="nsw-sticky-container">
        <div class="nsw-cookie-banner">
          <div class="nsw-cookie-banner__content"><p>We use cookies.</p></div>
        </div>
      </div>`);
    materialize(document);
    expect(document.querySelector('.nsw-cookie-banner').getAttribute('data-block-uid')).toBe('consent-1');
    expect(
      document.querySelector('.nsw-cookie-banner__content > p').getAttribute('data-edit-text'),
    ).toBe('message');
    // Not the element after the comment: the button stays unannotated.
    expect(document.querySelector('button').hasAttribute('data-block-uid')).toBe(false);
  });

  test('a target selector may contain spaces', () => {
    const document = page(`
      <!-- hydra target(.outer .banner) block-uid=b-1 /-->
      <div class="outer"><div class="banner"></div></div>`);
    materialize(document);
    expect(document.querySelector('.banner').getAttribute('data-block-uid')).toBe('b-1');
  });

  test('a target not built yet is skipped, and annotated on the next pass', () => {
    const document = page('<!-- hydra target(.nsw-cookie-banner) block-uid=consent-1 /--><p>before</p>');
    expect(() => materialize(document)).not.toThrow();
    expect(document.querySelector('p').hasAttribute('data-block-uid')).toBe(false);

    const banner = document.createElement('div');
    banner.className = 'nsw-cookie-banner';
    document.body.appendChild(banner);
    materialize(document);
    expect(banner.getAttribute('data-block-uid')).toBe('consent-1');
  });
});
