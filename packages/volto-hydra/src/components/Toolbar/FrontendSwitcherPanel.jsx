import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Icon } from '@plone/volto/components';
import mobileSVG from '@plone/volto/icons/mobile.svg';
import tabletSVG from '@plone/volto/icons/tablet.svg';
import screenSVG from '@plone/volto/icons/screen.svg';
import settingsSVG from '@plone/volto/icons/settings.svg';
import { setViewportPreset, setFrontendPreviewUrl } from '../../actions';
import getSavedURLs, { getURlsFromEnv } from '../../utils/getSavedURLs';
import rememberedFrontendUrl from '../../utils/getRememberedFrontendUrl';
import getDomainInitials from '../../utils/getDomainInitials';
import FrontendSettingsModal from './FrontendSettingsModal';
import './FrontendSwitcher.css';

const VIEWPORT_PRESETS = [
  { id: 'mobile', icon: mobileSVG, label: 'Mobile', width: '375px' },
  { id: 'tablet', icon: tabletSVG, label: 'Tablet', width: '768px' },
  { id: 'desktop', icon: screenSVG, label: 'Desktop', width: null },
];

/**
 * Get 2-letter initials from a URL's hostname.
 * - localhost:3003 → LO
 * - mysite.com → MY
 * - nuxt-blog.vercel.app → NB (split on -, take first letter of each part)
 * - Fallback: first 2 chars uppercased
 */
const FrontendSwitcherPanel = ({
  closeMenu,
}) => {
  const dispatch = useDispatch();
  const activePreset = useSelector(
    (state) => state.viewportPreset?.preset || 'desktop',
  );
  const reduxUrl = useSelector(
    (state) => state.frontendPreviewUrl?.url,
  );
  // Resolve effective URL same as View.jsx: Redux → cookie → first env URL
  const activeUrl = reduxUrl || rememberedFrontendUrl() || getURlsFromEnv()[0]?.url;
  const [showSettings, setShowSettings] = useState(false);
  const [entries, setEntries] = useState(() => getSavedURLs());

  const refreshUrls = () => setEntries(getSavedURLs());

  return (
    <div className="pastanaga-menu frontend-switcher-panel">
      {/* Mobile-only back-arrow — pinned bottom-left of the
       * bottom-sheet via mobile-tablet.css's .mobile-sheet-close rule.
       * Hidden on desktop where click-outside is the dismiss gesture. */}
      {closeMenu && (
        <button
          type="button"
          className="mobile-sheet-close"
          aria-label="Close panel"
          onClick={closeMenu}
        >
          ←
        </button>
      )}
      {/* Viewport section */}
      <header>
        <h2>Viewport</h2>
      </header>
      <div className="pastanaga-menu-list">
        <ul>
          {VIEWPORT_PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                className={`frontend-switcher-viewport-btn${activePreset === preset.id ? ' active' : ''}`}
                aria-label={preset.label}
                onClick={() => dispatch(setViewportPreset(preset.id))}
              >
                <Icon name={preset.icon} size="24px" />
                <span className="pastanaga-menu-label">{preset.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Frontend URLs section */}
      <header>
        <h2>Frontend</h2>
      </header>
      <div className="pastanaga-menu-list">
        <ul>
          {entries.map(({ url, name }) => {
            const isActive = activeUrl === url;
            return (
              <li key={url}>
                <button
                  className={`frontend-switcher-url-item${isActive ? ' active' : ''}`}
                  onClick={() => {
                    dispatch(setFrontendPreviewUrl(url));
                    closeMenu();
                  }}
                  title={url}
                >
                  <span className="frontend-switcher-url-icon">
                    {getDomainInitials(url)}
                  </span>
                  <span className="pastanaga-menu-label">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Settings */}
      <div className="pastanaga-menu-list">
        <ul>
          <li>
            <button className="frontend-switcher-settings-btn" onClick={() => setShowSettings(true)}>
              <Icon name={settingsSVG} size="24px" />
              <span className="pastanaga-menu-label">Settings</span>
            </button>
          </li>
        </ul>
      </div>

      {showSettings && (
        <FrontendSettingsModal
          onClose={() => setShowSettings(false)}
          onUrlsChanged={refreshUrls}
        />
      )}
    </div>
  );
};

export default FrontendSwitcherPanel;
