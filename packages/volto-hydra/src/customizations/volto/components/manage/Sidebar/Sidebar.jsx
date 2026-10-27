/**
 * Custom Sidebar for Volto Hydra with unified hierarchical view.
 * Replaces tabbed interface with stacked block settings and sticky headers.
 * Based on PLIP 6569: https://github.com/plone/volto/issues/6569
 */

import React, {
  useState,
  Fragment,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import PropTypes from 'prop-types';
import { Button } from 'semantic-ui-react';
import { useDispatch, useSelector } from 'react-redux';
import { compose } from 'redux';
import { withCookies } from 'react-cookie';
import { defineMessages, useIntl } from 'react-intl';
import cx from 'classnames';
import BodyClass from '@plone/volto/helpers/BodyClass/BodyClass';
import { getCookieOptions } from '@plone/volto/helpers/Cookies/cookies';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import expandSVG from '@plone/volto/icons/left-key.svg';
import collapseSVG from '@plone/volto/icons/right-key.svg';
import clearSVG from '@plone/volto/icons/clear.svg';
import './Sidebar.css';

/**
 * Calculate and apply sticky header offsets for VS Code-style stacking.
 * Each sticky header's `top` value is set to the cumulative height of
 * all preceding sticky headers.
 */
const updateStickyOffsets = (containerRef) => {
  if (!containerRef.current) return;

  const stickyHeaders = containerRef.current.querySelectorAll(
    '.sidebar-section-header.sticky-header',
  );

  let cumulativeTop = 0;
  stickyHeaders.forEach((header) => {
    header.style.top = `${cumulativeTop}px`;
    cumulativeTop += header.offsetHeight;
  });
};

const messages = defineMessages({
  page: {
    id: 'Page',
    defaultMessage: 'Page',
  },
  shrinkSidebar: {
    id: 'Shrink sidebar',
    defaultMessage: 'Shrink sidebar',
  },
  expandSidebar: {
    id: 'Expand sidebar',
    defaultMessage: 'Expand sidebar',
  },
  blocks: {
    id: 'Blocks',
    defaultMessage: 'Blocks',
  },
  closeSidebar: {
    id: 'Close sidebar',
    defaultMessage: 'Close sidebar',
  },
});

const Sidebar = (props) => {
  const intl = useIntl();
  const { cookies, content } = props;
  const [expanded, setExpanded] = useState(() => {
    // Mobile (≤767px) ALWAYS starts collapsed, regardless of the
    // sidebar_expanded cookie. The cookie is per-domain not
    // per-viewport, so a previous desktop session leaving the sidebar
    // open would force-open the full-screen sheet on a mobile visit,
    // hiding the canvas before the editor's first interaction.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 767px)').matches
    ) {
      return false;
    }
    // Desktop / tablet: honor the cookie (default open if unset).
    return cookies.get('sidebar_expanded') !== 'false';
  });
  const [size] = useState(0);
  const [showFull, setshowFull] = useState(true);
  const sidebarContentRef = useRef(null);

  const toolbarExpanded = useSelector((state) => state.toolbar.expanded);
  const type = useSelector((state) => state.schema?.schema?.title);

  // Update sticky header offsets when DOM changes
  useEffect(() => {
    // Initial calculation (deferred to ensure layout is complete)
    requestAnimationFrame(() => updateStickyOffsets(sidebarContentRef));

    // Set up MutationObserver to recalculate when headers change
    if (sidebarContentRef.current) {
      const observer = new MutationObserver(() => {
        // Use requestAnimationFrame to ensure DOM layout is complete
        // before measuring header heights and setting top offsets
        requestAnimationFrame(() => updateStickyOffsets(sidebarContentRef));
      });

      observer.observe(sidebarContentRef.current, {
        childList: true,
        subtree: true,
      });

      return () => observer.disconnect();
    }
  }, []);

  const onToggleExpanded = () => {
    cookies.set('sidebar_expanded', !expanded, getCookieOptions());
    setExpanded(!expanded);
    resetFullSizeSidebar();
  };

  const resetFullSizeSidebar = useCallback(() => {
    if (!expanded) {
      const currentResizer = document.querySelector('#sidebar');
      const sidebarContainer =
        currentResizer.getElementsByClassName('sidebar-container')[0];
      sidebarContainer.classList.remove('full-size');
      sidebarContainer.classList.remove('no-toolbar');
      setshowFull(true);
    }
  }, [expanded]);

  const onToggleFullSize = useCallback(() => {
    const currentResizer = document.querySelector('#sidebar');
    const sidebarContainer =
      currentResizer.getElementsByClassName('sidebar-container')[0];

    if (showFull) {
      sidebarContainer.classList.add('full-size');
      if (!toolbarExpanded) {
        sidebarContainer.classList.add('no-toolbar');
      } else {
        sidebarContainer.classList.remove('no-toolbar');
      }
    } else {
      sidebarContainer.classList.remove('full-size');
      sidebarContainer.classList.remove('no-toolbar');
    }
    setshowFull(!showFull);
  }, [showFull, toolbarExpanded]);

  return (
    <Fragment>
      <BodyClass
        className={expanded ? 'has-sidebar' : 'has-sidebar-collapsed'}
      />
      <div
        className={cx('sidebar-container', 'hydra-sidebar', {
          collapsed: !expanded,
        })}
        style={size > 0 ? { width: size } : null}
      >
        <Button
          aria-label={
            expanded
              ? intl.formatMessage(messages.shrinkSidebar)
              : intl.formatMessage(messages.expandSidebar)
          }
          className={
            content && content.review_state
              ? `${content.review_state} trigger`
              : 'trigger'
          }
          onClick={onToggleExpanded}
        />
        <Button
          className="full-size-sidenav-btn"
          onClick={onToggleFullSize}
          aria-label="full-screen-sidenav"
        >
          <Icon
            className="full-size-icon"
            name={showFull ? expandSVG : collapseSVG}
          />
        </Button>

        {/* Unified hierarchical sidebar content */}
        <div className="sidebar-content-wrapper" ref={sidebarContentRef}>
          {/* Page header - sticky at top, static text (deselect via block arrows) */}
          <div
            className="sidebar-section-header sticky-header page-header"
            data-page-type={type || intl.formatMessage(messages.page)}
          >
            <button
              className="section-title"
              onClick={() =>
                document.dispatchEvent(new CustomEvent('hydra-select-page'))
              }
            >
              {type || intl.formatMessage(messages.page)}
            </button>
            <button
              className="sidebar-close-button"
              onClick={onToggleExpanded}
              aria-label={intl.formatMessage(messages.closeSidebar)}
              title={intl.formatMessage(messages.closeSidebar)}
            >
              <Icon name={clearSVG} size="24px" />
            </button>
          </div>

          {/* Page metadata - portal target */}
          <div className="sidebar-section-content" id="sidebar-metadata">
            {/* Page metadata fields rendered here via portal */}
          </div>

          {/* Parent blocks section + current block headers - rendered dynamically via portal */}
          {/* display:contents makes this layout-transparent so sticky headers work */}
          <div id="sidebar-parents" style={{ display: 'contents' }}>
            {/* Parent block headers + current block header rendered here via portal */}
          </div>

          {/* Current block sidebar content - static element for SidebarPortal to find */}
          <div
            id="sidebar-properties"
            className="sidebar-section-content parent-block-settings"
          >
            {/* Current block's sidebar content rendered here via SidebarPortal */}
          </div>

          {/* Template block settings - shown when editing blocks inside a template */}
          <div
            id="sidebar-template-settings"
            className="sidebar-section-content parent-block-settings"
          >
            {/* Template block settings form portaled here */}
          </div>

          {/* Child blocks widget - portal target for nested blocks list */}
          {/* Note: id="sidebar-order" for backwards compatibility with tests */}
          <div
            className="sidebar-section child-blocks-section"
            id="sidebar-order"
          >
            {/* Child blocks widget rendered here */}
          </div>
        </div>
      </div>
      <div className={expanded ? 'pusher expanded' : 'pusher'} />
    </Fragment>
  );
};

Sidebar.propTypes = {
  documentTab: PropTypes.bool,
  blockTab: PropTypes.bool,
  settingsTab: PropTypes.bool,
};

Sidebar.defaultProps = {
  documentTab: true,
  blockTab: true,
  settingsTab: false,
};

export default compose(withCookies)(Sidebar);
