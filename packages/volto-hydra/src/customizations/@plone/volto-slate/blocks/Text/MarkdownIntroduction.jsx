import { Segment, List } from 'semantic-ui-react';
import React, { useState } from 'react';

/**
 * Collapsible markdown introduction for the slate block sidebar.
 * Collapsed by default to reduce sidebar clutter.
 */
const MarkdownIntroduction = (props) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <header
        className="header"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer', opacity: expanded ? 1 : 0.7 }}
      >
        <h2>Markdown shortcuts {expanded ? '▾' : '▸'}</h2>
      </header>

      {expanded && (
        <Segment secondary attached style={{ fontFamily: 'monospace' }}>
          <List>
            <List.Item key={1} style={{ fontSize: 'xx-large' }}>
              ## Heading
            </List.Item>
            <List.Item key={2} style={{ fontSize: 'x-large' }}>
              ### Subheading
            </List.Item>

            <List.Item key={3} style={{ paddingTop: '1rem' }}>
              * unordered list item
            </List.Item>
            <List.Item key={4}>+ unordered list item</List.Item>
            <List.Item key={5}>- unordered list item</List.Item>

            <List.Item key={6} style={{ paddingTop: '1rem' }}>
              1. ordered list item
            </List.Item>
            <List.Item key={7}>1) ordered list item</List.Item>

            <List.Item key={8} className="callout">
              &gt; block quote
            </List.Item>
            <List.Item key={9} style={{ fontWeight: 'bold' }}>
              **bold text**
            </List.Item>
            <List.Item key={10} style={{ fontWeight: 'bold' }}>
              __bold text__
            </List.Item>
            <List.Item key={11} style={{ fontStyle: 'italic' }}>
              *italic text*
            </List.Item>
            <List.Item key={12} style={{ fontStyle: 'italic' }}>
              _italic text_
            </List.Item>
            <List.Item key={13} style={{ textDecoration: 'line-through' }}>
              ~~strikethrough text~~
            </List.Item>
          </List>
        </Segment>
      )}
    </div>
  );
};

export default MarkdownIntroduction;
