/**
 * Header — suppressed in the Hydra admin.
 *
 * The admin frames a preview iframe and supplies its own chrome; the page's
 * own header is rendered by the frontend INSIDE that iframe. App.jsx is
 * upstream's only consumer of this component, so rendering null here is the
 * same suppression the App.jsx shadow used to do by commenting out the tag —
 * without forking 329 lines of App.jsx to say it, and without going stale
 * when upstream changes App (which cost us two fixes: e8fac8543's undefined-
 * blockType guard and 61eb4d2f8's staticContext on ConnectionRefusedView).
 *
 * A shadow that renders nothing cannot drift: what upstream does inside a
 * component we never render does not matter.
 */
const Header = () => null;

export default Header;
