"use client";
import React, { useState } from "react";
import { Menu as SemanticMenu } from "semantic-ui-react";
import Link from "next/link";

function getPath(item) {
  return '/' + (item['@id'] || '').replace(/^https?:\/\/[^/]+\//, '');
}

// Semantic UI's dropdown markup, opened and closed here. semantic-ui-react's
// Dropdown finds its DOM node with ReactDOM.findDOMNode, which React 19
// removed, so rendering it throws and takes the whole layout down.
function NavDropdown({ item }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`ui dropdown item${open ? " active visible" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      {item.title}
      <i aria-hidden="true" className="dropdown icon" />
      <div className={`menu transition${open ? " visible" : ""}`}>
        {item.items.map((child, i) => (
          <Link key={i} className="item" href={getPath(child)}>
            {child.title}
          </Link>
        ))}
      </div>
    </div>
  );
}

function NavItem({ item }) {
  const path = getPath(item);

  if (item.items && item.items.length > 0) {
    return <NavDropdown item={item} />;
  }

  return (
    <SemanticMenu.Item as={Link} href={path}>
      {item.title}
    </SemanticMenu.Item>
  );
}

export default function NavMenu({ items = [] }) {
  return (
    <SemanticMenu>
      <SemanticMenu.Item as={Link} href="/">
        Home
      </SemanticMenu.Item>
      {items.map((item, index) => (
        <NavItem key={index} item={item} />
      ))}
    </SemanticMenu>
  );
}
