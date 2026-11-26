function ContextNavigationBlock({ block, blocks }) {
  const items = block.blocks_layout?.items || [];
  return (
    <nav
      data-block-uid={block['@uid']}
      aria-label={block.ariaLabel || 'Section navigation'}
      className="context-navigation"
    >
      <ul role="list" className="context-navigation-list">
        {items.map(id => {
          const child = blocks[id];
          if (!child) return null;
          if (child['@type'] === 'listing') {
            return <ListingNav key={id} block={child} blockId={id} />;
          }
          return <NavItem key={id} block={{ ...child, '@uid': id }} />;
        })}
      </ul>
    </nav>
  );
}

function NavItem({ block }) {
  // Both manual and listing-synth items share shape: `href` is the
  // object_browser array `[{ '@id': string }]` (the listing variation's
  // fieldMappings.@default maps `getURL` → `href` via type='link'). `label`
  // is a string. `_level` is set by the parent ContextNavigationBlock
  // after computing minDepth across all sibling hrefs.
  const here = window.location.pathname.replace(/\/edit$/, '');
  const itemPath = new URL(block.href[0]['@id'], window.location.origin).pathname;
  const active = itemPath === here;
  const inPath = !active && here.startsWith(itemPath + '/');
  return (
    <li>
      <a
        href={itemPath}
        data-block-uid={block['@uid']}
        data-edit-link="href"
        className={`nav-item level-${block._level} ${active ? 'current' : ''} ${inPath ? 'in-path' : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        <span data-edit-text="label">{block.label}</span>
      </a>
    </li>
  );
}
