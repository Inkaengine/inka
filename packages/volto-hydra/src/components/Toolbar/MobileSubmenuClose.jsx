import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Mobile-only close affordance for Volto's #toolbar > .toolbar-content
 * submenus (the "Add Content", "More" → State/History/Links, etc.
 * menus). Volto stock has no close button in the submenu — the desktop
 * dismiss gesture is clicking outside, which doesn't translate to
 * mobile where the submenu is now a full-screen sheet.
 *
 * Instead of shadowing the massive Toolbar.jsx, this component watches
 * `.toolbar-content` for the `.show` class via MutationObserver, and
 * mounts a portaled close button when the menu is open. The button
 * dismisses the menu by clicking the currently-active toolbar trigger
 * (`.more` / `.add` / `.user` etc. with the `.expanded` class) — the
 * same toggle gesture Volto already wires.
 *
 * Hidden on desktop via mobile-tablet.css's `.mobile-sheet-close
 * { display: none }` rule outside the (max-width: 767px) media query.
 */
const MobileSubmenuClose = () => {
  const [open, setOpen] = useState(false);
  // A sheet that brings its own back-arrow (the Frontend & Viewport panel)
  // still hides the bottom bar, but gets no second arrow on top of its own.
  const [ownClose, setOwnClose] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    // A "submenu sheet" only exists when a toolbar BUTTON is in the
    // expanded state — that's Add, More, User, etc. opening their
    // dropdown into the .toolbar-content panel. Full-page routes
    // (Contents, Users, ⋯) ALSO mount inside .toolbar-content but
    // without any expanded toolbar button — so the bottom bar must
    // stay visible for those.
    const computeOpen = () => {
      const expanded = document.querySelector(
        '#toolbar-body .toolbar-button.expanded, ' +
          '#toolbar-body button.expanded, ' +
          '#toolbar-body button[aria-expanded="true"]',
      );
      const tc = document.querySelector('#toolbar .toolbar-content');
      return !!expanded && !!tc?.classList.contains('show');
    };

    const sync = () => {
      setOpen(computeOpen());
      setOwnClose(
        !!document.querySelector('#toolbar .toolbar-content .mobile-sheet-close'),
      );
    };

    // Watch ALL subtree attribute changes inside #toolbar — covers
    // toolbar-content.show class changes AND toolbar-button.expanded
    // / aria-expanded changes on the trigger buttons. If #toolbar
    // hasn't mounted yet, watch <body> until it appears.
    let toolbarObs = null;
    const attachObserver = (root) => {
      toolbarObs = new MutationObserver(sync);
      toolbarObs.observe(root, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-expanded'],
        childList: true,
      });
      sync();
    };

    const initial = document.getElementById('toolbar');
    if (initial) {
      attachObserver(initial);
    } else {
      const bodyObs = new MutationObserver(() => {
        if (toolbarObs) return;
        const tb = document.getElementById('toolbar');
        if (tb) {
          attachObserver(tb);
          bodyObs.disconnect();
        }
      });
      bodyObs.observe(document.body, { childList: true, subtree: true });
      return () => bodyObs.disconnect();
    }

    return () => {
      if (toolbarObs) toolbarObs.disconnect();
    };
  }, []);

  // Mark <body> so CSS can hide the bottom toolbar AND extend the
  // submenu sheet to the bottom of the viewport while a submenu is
  // open. The mobile design replaces the bottom toolbar with the
  // submenu (which has its own back-arrow at bottom-left) so the user
  // never sees two stacked toolbars on a phone.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.toggleAttribute('data-hydra-submenu-open', open);
    return () => document.body.removeAttribute('data-hydra-submenu-open');
  }, [open]);

  if (!open || ownClose) return null;
  if (typeof document === 'undefined') return null;

  const handleClick = () => {
    // The active trigger button has the `.expanded` class added by
    // Toolbar's toggleMenu state; clicking it re-toggles to close.
    const expandedTrigger = document.querySelector(
      '#toolbar-body .toolbar-button.expanded, #toolbar-body button.expanded',
    );
    if (expandedTrigger) {
      expandedTrigger.click();
      return;
    }
    // Fallback: any toolbar button whose aria-expanded is true.
    const ariaExpanded = document.querySelector(
      '#toolbar-body button[aria-expanded="true"]',
    );
    if (ariaExpanded) ariaExpanded.click();
  };

  return createPortal(
    <button
      type="button"
      className="mobile-sheet-close mobile-submenu-close"
      aria-label="Close menu"
      onClick={handleClick}
    >
      ←
    </button>,
    document.body,
  );
};

export default MobileSubmenuClose;
