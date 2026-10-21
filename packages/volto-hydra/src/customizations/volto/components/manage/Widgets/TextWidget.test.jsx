import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-intl-redux';
import configureStore from 'redux-mock-store';
import TextWidget from './TextWidget';

const store = configureStore()({ intl: { locale: 'en', messages: {} } });

const renderWidget = (props) =>
  render(
    <Provider store={store}>
      <TextWidget id="lead" title="Lead" onChange={() => {}} {...props} />
    </Provider>,
  );

/**
 * `wrap` shows a single-line value over as many lines as it needs, but it must
 * stay ONE line: a textarea is only used for its wrapping, never to store a
 * second line.
 */
describe('TextWidget (shadow) — wrap', () => {
  it('without wrap is the stock single-line input', () => {
    renderWidget({ value: 'One line' });
    const field = screen.getByDisplayValue('One line');
    expect(field.tagName).toBe('INPUT');
  });

  it('with wrap shows the value in a textarea so it can wrap', () => {
    renderWidget({ value: 'One line', wrap: true });
    expect(screen.getByDisplayValue('One line').tagName).toBe('TEXTAREA');
  });

  it.each(['Enter', 'Shift+Enter'])('ignores %s', (key) => {
    renderWidget({ value: 'One line', wrap: true });
    const field = screen.getByDisplayValue('One line');
    // fireEvent returns false when the handler called preventDefault.
    const notPrevented = fireEvent.keyDown(field, { key: 'Enter', shiftKey: key === 'Shift+Enter' });
    expect(notPrevented).toBe(false);
  });

  it('turns a pasted line break into a space', () => {
    const onChange = vi.fn();
    renderWidget({ value: '', wrap: true, onChange });
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'First line  \r\n\n  second line' },
    });
    expect(onChange).toHaveBeenCalledWith('lead', 'First line second line');
  });

  it('keeps clearing the field as "no value", like the stock widget', () => {
    const onChange = vi.fn();
    renderWidget({ value: 'x', wrap: true, onChange });
    fireEvent.change(screen.getByDisplayValue('x'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('lead', undefined);
  });
});
