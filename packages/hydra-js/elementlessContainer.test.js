import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * A container is drawn by its own parts and by any children drawn outside them.
 *
 * A design system can draw a group of one as just that one: a single
 * collapsible section with no group around it. The container block holding it
 * still exists in the data, but nothing on the page carries its uid. Template
 * instances have always been found through their children; any container is
 * now, when nothing carries its own uid — so it is selected from a child
 * ("select parent"), outlined around its children, and its toolbar sits there.
 */
describe('getAllBlockElements: a container with no element of its own', () => {
  const elements = (html, blockPathMap, uid) => {
    const { window } = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
    const prev = { document: globalThis.document, window: globalThis.window };
    globalThis.document = window.document;
    globalThis.window = window;
    try {
      const bridge = Object.create(Bridge.prototype);
      bridge.blockPathMap = blockPathMap;
      return bridge.getAllBlockElements(uid).map((el) => el.id);
    } finally {
      globalThis.document = prev.document;
      globalThis.window = prev.window;
    }
  };
  const map = {
    group: { parentId: '_page' },
    item: { parentId: 'group' },
    other: { parentId: '_page' },
  };

  it('is drawn by its children', () => {
    expect(
      elements('<details id="d" data-block-uid="item"></details>', map, 'group'),
    ).toEqual(['d']);
  });

  it('is drawn by every child that has an element', () => {
    const two = { ...map, item2: { parentId: 'group' } };
    expect(
      elements(
        '<details id="a" data-block-uid="item"></details><details id="b" data-block-uid="item2"></details>',
        two,
        'group',
      ),
    ).toEqual(['a', 'b']);
  });

  it('reaches through a child that has no element either', () => {
    const nested = {
      group: { parentId: '_page' },
      middle: { parentId: 'group' },
      leaf: { parentId: 'middle' },
    };
    expect(elements('<p id="p" data-block-uid="leaf"></p>', nested, 'group')).toEqual(['p']);
  });

  it('is its own element when it draws one', () => {
    expect(
      elements(
        '<div id="g" data-block-uid="group"><details id="d" data-block-uid="item"></details></div>',
        map,
        'group',
      ),
    ).toEqual(['g']);
  });

  it('is its own parts and the children drawn outside them', () => {
    // A heading of the container's, drawn beside its children rather than
    // around them: the container is the heading and the children.
    expect(
      elements(
        '<h2 id="h" data-block-uid="group">Questions</h2><details id="d" data-block-uid="item"></details>',
        map,
        'group',
      ),
    ).toEqual(['h', 'd']);
  });

  it('is only its own element when its children are inside it', () => {
    // A carousel's slides sit inside it, some scrolled out of view: they do not
    // stretch the container across the page.
    const slides = { ...map, item2: { parentId: 'group' } };
    expect(
      elements(
        '<div id="g" data-block-uid="group"><div id="a" data-block-uid="item"></div><div id="b" data-block-uid="item2"></div></div>',
        slides,
        'group',
      ),
    ).toEqual(['g']);
  });

  it('is nowhere when neither it nor its children are drawn', () => {
    expect(elements('<p id="x" data-block-uid="other"></p>', map, 'group')).toEqual([]);
  });
});
