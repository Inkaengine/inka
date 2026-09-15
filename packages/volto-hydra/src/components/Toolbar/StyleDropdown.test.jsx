/**
 * hydra replaces volto-slate's styleMenu button GLOBALLY, so the "declare
 * nothing, get nothing" branch decides what every consumer's toolbar looks
 * like — not just one that opted in.
 *
 * This was an admin-mock test, asserting no `#style-menu` on an unrestricted
 * page. That stopped being expressible once the test frontend declared a style
 * menu for every page (it had to: discovery harvests blocksConfig from ONE page
 * load, so a page-scoped menu made stored `styleName` content look unauthorable).
 * The guarantee is the component's, so it is tested as the component's.
 */
import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import config from '@plone/volto/registry';

vi.mock('slate-react', () => ({ useSlate: () => ({}) }));
// `@plone/volto/components` is a barrel that drags in Volto's store, which needs
// razzle's `@root` aliases — not available under vitest. Only the Icon is used.
vi.mock('@plone/volto/components', () => ({
  Icon: ({ name }) => <span data-icon={String(name)} />,
}));
vi.mock('@plone/volto/icons/paint.svg', () => ({ default: 'paint.svg' }));
vi.mock('@plone/volto-slate/editor/plugins/StyleMenu/utils', () => ({
  isBlockStyleActive: () => false,
  isInlineStyleActive: () => false,
  toggleStyle: () => {},
}));

import StyleDropdown from './StyleDropdown';

const withMenu = (styleMenu) => {
  config.settings.slate = { ...(config.settings.slate || {}), styleMenu };
};

describe('StyleDropdown', () => {
  test('renders nothing when a frontend declares no styles', () => {
    withMenu(undefined);
    expect(render(<StyleDropdown />).container.innerHTML).toBe('');
  });

  test('renders nothing for an empty menu, rather than an empty dropdown', () => {
    withMenu({ blockStyles: [], inlineStyles: [] });
    expect(render(<StyleDropdown />).container.innerHTML).toBe('');
  });

  test('renders the trigger once a style is declared', () => {
    withMenu({ blockStyles: [{ cssClass: 'lead', label: 'Lead' }], inlineStyles: [] });
    const { container } = render(<StyleDropdown />);
    expect(container.querySelector('#style-menu')).not.toBeNull();
  });

  test('one kind alone is enough — an inline-only menu still shows', () => {
    withMenu({ blockStyles: [], inlineStyles: [{ cssClass: 'dropcap', label: 'Drop cap' }] });
    const { container } = render(<StyleDropdown />);
    expect(container.querySelector('#style-menu')).not.toBeNull();
  });

  // A region's slate rules reach the styles a DESIGN SYSTEM ships, not just
  // slate's own element types — a style menu entry is keyed by its class
  // (`.nsw-small`), the shape getSlateVocabulary reports it under. Without
  // this the declaration was enforced everywhere EXCEPT the one surface an
  // author uses to apply it.
  /** The menu opens into a PORTAL, so its items are never in `container`. */
  const openedLabels = ({ container }) => {
    // The trigger opens on mouseDown, not click.
    fireEvent.mouseDown(container.querySelector('#style-menu'));
    return [...document.querySelectorAll('.style-dropdown-item')].map(
      (i) => i.textContent,
    );
  };

  const RULES = {
    allowedStyles: null,
    disallowedStyles: ['.small'],
    allowedMarks: null,
    disallowedMarks: null,
  };

  test('a style this region disallows is not offered', () => {
    withMenu({
      blockStyles: [
        { cssClass: 'lead', label: 'Lead' },
        { cssClass: 'small', label: 'Small' },
      ],
      inlineStyles: [],
    });
    expect(openedLabels(render(<StyleDropdown slateRules={RULES} />))).toEqual([
      'Lead',
    ]);
  });

  test('inline styles are gated the same way', () => {
    withMenu({
      blockStyles: [],
      inlineStyles: [{ cssClass: 'small', label: 'Small' }],
    });
    // Nothing left to offer, so there is no control at all — the same call the
    // empty-menu case makes, rather than a dropdown that opens onto nothing.
    const { container } = render(<StyleDropdown slateRules={RULES} />);
    expect(container.innerHTML).toBe('');
  });

  test('with no rules every declared style is offered, as before', () => {
    withMenu({
      blockStyles: [
        { cssClass: 'lead', label: 'Lead' },
        { cssClass: 'small', label: 'Small' },
      ],
      inlineStyles: [],
    });
    expect(openedLabels(render(<StyleDropdown />))).toEqual(['Lead', 'Small']);
  });
});
