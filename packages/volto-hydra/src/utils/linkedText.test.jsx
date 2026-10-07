import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LinkedText, unlinkedText } from './linkedText';

/**
 * Advice a frontend writes for authors (a block's description, a rule's
 * warning) is one string, and may link to where it comes from with a markdown
 * link: `[text](url)`. Nothing else in it is markup.
 */
describe('LinkedText', () => {
  it('draws a markdown link as a link, opened beside the editor', () => {
    const { container } = render(
      <LinkedText text="Headings must not skip a level. [Read the guidance](https://example.com/headings)" />,
    );
    const a = container.querySelector('a');
    expect(a.textContent).toBe('Read the guidance');
    expect(a.getAttribute('href')).toBe('https://example.com/headings');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toBe('Headings must not skip a level. Read the guidance');
  });

  it('draws text without a link as it is', () => {
    const { container } = render(<LinkedText text="Just advice." />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('Just advice.');
  });

  it('draws several links, and relative ones', () => {
    const { container } = render(<LinkedText text="See [one](/a) and [two](https://b.example)." />);
    const links = [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['one', '/a'],
      ['two', 'https://b.example'],
    ]);
    expect(container.textContent).toBe('See one and two.');
  });

  it('does not make a link of a script URL', () => {
    const { container } = render(<LinkedText text="[x](javascript:alert(1))" />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('does not render HTML in the text', () => {
    const { container } = render(<LinkedText text="<b>bold</b>" />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('<b>bold</b>');
  });
});

describe('unlinkedText', () => {
  it('keeps the words of each link and drops the URL (for a tooltip, which cannot hold a link)', () => {
    expect(unlinkedText('Paragraphs and headings. [Guidance](https://example.com/text)')).toBe(
      'Paragraphs and headings. Guidance',
    );
  });

  it('passes undefined through', () => {
    expect(unlinkedText(undefined)).toBeUndefined();
  });
});
