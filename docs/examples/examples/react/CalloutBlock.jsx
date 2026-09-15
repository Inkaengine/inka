const calloutLevels = {
  note:      { label: 'Note',      color: '#2563eb', bg: '#eff6ff' },
  tip:       { label: 'Tip',       color: '#059669', bg: '#ecfdf5' },
  warning:   { label: 'Warning',   color: '#d97706', bg: '#fffbeb' },
  important: { label: 'Important', color: '#dc2626', bg: '#fef2f2' },
};

function CalloutBlock({ block }) {
  const level = calloutLevels[block.variation] || calloutLevels.note;
  const blocks = block.blocks || {};
  const items = block.blocks_layout?.items || [];
  return (
    <aside
      data-block-uid={block['@uid']}
      className={`callout callout--${block.variation || 'note'}`}
      style={{ borderLeft: `4px solid ${level.color}`, background: level.bg, padding: '12px 16px', borderRadius: '4px', margin: '1em 0' }}
    >
      <div className="callout__label" style={{ fontWeight: 700, color: level.color, textTransform: 'uppercase', fontSize: '0.8em', letterSpacing: '0.05em', marginBottom: '4px' }}>
        {level.label}
      </div>
      <div className="callout__body">
        {items.map((id) => (
          <BlockRenderer key={id} block={{ ...blocks[id], '@uid': id }} />
        ))}
      </div>
    </aside>
  );
}
