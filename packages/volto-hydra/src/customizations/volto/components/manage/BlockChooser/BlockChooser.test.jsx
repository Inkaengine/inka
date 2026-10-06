import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-intl-redux';
import configureStore from 'redux-mock-store';
import jwt from 'jsonwebtoken';
import BlockChooser from './BlockChooser';

const store = configureStore()({
  intl: { locale: 'en', messages: {} },
  userSession: { token: jwt.sign({ fullname: 'Test' }, 'secret') },
});

// A single allowed block that is NOT `mostUsed`, so the "Most used" section is empty.
const blocksConfig = {
  text: {
    id: 'text',
    title: 'Text',
    icon: {},
    group: 'text',
    restricted: false,
    mostUsed: false,
  },
};

/**
 * The block chooser must not render a section that has no available blocks, and must default-open
 * the first section that DOES. blocksAvailable.mostUsed is always set (to a possibly-empty array),
 * so the stock key-presence filter let an empty "Most used" section through — and, being first, it
 * default-opened. This shadow filters groups by their block count instead.
 */
describe('BlockChooser (shadow) — empty sections', () => {
  it('hides the empty "Most used" section and opens the first non-empty section', () => {
    render(
      <Provider store={store}>
        <BlockChooser
          onInsertBlock={() => {}}
          currentBlock="theblockid"
          blocksConfig={blocksConfig}
          allowedBlocks={['text']}
        />
      </Provider>,
    );
    // The empty "Most used" section must not render at all...
    expect(screen.queryByText('Most used')).toBeNull();
    // ...and the first NON-empty section ('Text') is the one that defaults open.
    expect(screen.getByLabelText('Fold Text blocks')).toBeInTheDocument();
  });
});

/**
 * A block may say what it is for (`description`). The chooser is where an author
 * picks between blocks, so the description is there, on the block's button.
 */
describe('BlockChooser (shadow) — block descriptions', () => {
  it("gives a block's button its description", () => {
    render(
      <Provider store={store}>
        <BlockChooser
          onInsertBlock={() => {}}
          currentBlock="theblockid"
          blocksConfig={{
            text: { ...blocksConfig.text, description: 'Paragraphs, headings and lists.' },
          }}
          allowedBlocks={['text']}
        />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /Text/ })).toHaveAttribute(
      'title',
      'Paragraphs, headings and lists.',
    );
  });
});
