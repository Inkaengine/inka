/**
 * The text toolbar sorts its buttons by calling each one (inka#485). Some are
 * components with hooks (volto-slate's link button), and calling one runs its
 * hooks as the toolbar's own, so WHICH buttons are called must not depend on
 * the list a frontend sends or on what the selected block's region allows: the
 * one toolbar redraws as the author moves between regions with different rules.
 */
import { describe, it, expect } from 'vitest';
import { probeToolbarButtons } from './toolbarButtonKinds';

const BlockButton = () => null;
const MarkButton = () => null;

function registry() {
  const called = [];
  const buttons = {
    bold: () => { called.push('bold'); return { type: MarkButton, props: { format: 'strong' } }; },
    h2: () => { called.push('h2'); return { type: BlockButton, props: { format: 'h2' } }; },
    // A component with hooks: it can't be called outside a render.
    link: () => { called.push('link'); throw new Error('Invalid hook call'); },
  };
  return { buttons, called };
}

describe('probeToolbarButtons', () => {
  it('says which buttons are block formats, and the format each applies', () => {
    const { buttons } = registry();
    expect(probeToolbarButtons(buttons, BlockButton)).toEqual({
      bold: { block: false, format: 'strong' },
      h2: { block: true, format: 'h2' },
      link: { block: false, format: undefined },
    });
  });

  it('calls every registered button once, in the same order, whatever is listed or allowed', () => {
    const first = registry();
    probeToolbarButtons(first.buttons, BlockButton);
    const second = registry();
    probeToolbarButtons(second.buttons, BlockButton);
    expect(first.called).toEqual(['bold', 'h2', 'link']);
    expect(second.called).toEqual(first.called);
  });
});
