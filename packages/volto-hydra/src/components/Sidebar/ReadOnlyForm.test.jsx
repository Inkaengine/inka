/**
 * A locked block's settings are shown as text by ReadOnlyForm. Its regions are
 * not settings: the editable form draws a `blocks_layout` field with a hidden
 * widget, and the sidebar lists the region's blocks in a section of its own.
 * ReadOnlyForm skips fields by widget rather than drawing them through the
 * widget registry, so a region it does not know is shown as a setting with no
 * value ("—") — once for every region, under every block that holds the one
 * selected.
 */
import React from 'react';
import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';

import { ReadOnlyForm } from './ReadOnlyForm';

const schema = {
  fieldsets: [
    { id: 'default', title: 'Default', fields: ['sidebar', 'heading', 'main'] },
  ],
  properties: {
    sidebar: {
      title: 'Sidebar',
      choices: [
        ['none', 'None'],
        ['left', 'Left'],
      ],
    },
    heading: { title: 'Heading', widget: 'blocks_layout', allowedBlocks: ['title'] },
    main: { title: 'Main content', widget: 'blocks_layout' },
  },
};

describe('ReadOnlyForm', () => {
  test("shows a locked block's settings, not its regions", () => {
    const { container } = render(
      <ReadOnlyForm schema={schema} formData={{ sidebar: 'left' }} />,
    );
    const labels = [...container.querySelectorAll('.readonly-field-label')].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(['Sidebar']);
    expect(container.querySelector('.readonly-field-value').textContent).toBe(
      'Left',
    );
  });
});
