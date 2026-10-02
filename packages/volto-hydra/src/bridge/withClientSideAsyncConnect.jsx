/**
 * Run a route component's asyncConnect promises on the CLIENT.
 *
 * Volto attaches route-level data loading to components as `reduxAsyncConnect`
 * and relies on `loadOnServer` to run it during SSR; ReduxAsyncConnect then
 * does not re-run it for the initial page load, because the data is already in
 * the serialised store. A bridge-backed admin has no server-side CMS, so that
 * pass never happens and nothing else takes it up — the data is simply never
 * fetched, on either side.
 *
 * Contents is where that showed: it renders <Unauthorized/> unless
 * `objectActions` is populated, so the listing came back correct and the panel
 * still said the user could not see it.
 *
 * App-level asyncConnect already had this problem solved, by making its
 * promises run when `useBridgeBackend` is set (see loadsInThisEnvironment in
 * the App customization). This is the same fix for a route component.
 */
import { useEffect } from 'react';
import { useStore } from 'react-redux';
import hoistNonReactStatics from 'hoist-non-react-statics';
import config from '@plone/volto/registry';
import { ensureSiteLoaded } from './site';

export default function withClientSideAsyncConnect(Component) {
  /**
   * Route components are code-split, so the loader is NOT on the component
   * this HOC receives — that is only loadable's wrapper. It lives on the
   * default export of the chunk, which exists once the chunk has loaded.
   * Reading it off the wrapper silently found nothing to run.
   */
  const loadersFor = async () => {
    if (Component.reduxAsyncConnect) return Component.reduxAsyncConnect;
    const mod = await Component.load?.();
    return mod?.default?.reduxAsyncConnect ?? mod?.reduxAsyncConnect ?? [];
  };

  function WithClientSideAsyncConnect(props) {
    const store = useStore();
    const pathname = props.location?.pathname;

    useEffect(() => {
      if (!config.settings.useBridgeBackend) return;
      let cancelled = false;
      (async () => {
        const items = await loadersFor();
        if (cancelled) return;
        // The site first, always. A route loader's content read has its expand
        // list built from the store as it goes out, and the api middleware drops
        // `translations` unless the site is already known to be multilingual —
        // so a deep link to /edit or /manage-translations that raced the site
        // read came back with no translations and no way to notice. Settled once
        // per session: every later route finds it loaded and does not wait.
        await ensureSiteLoaded(store);
        if (cancelled) return;
        for (const item of items) {
          // The shape redux-connect passes its promises.
          item.promise?.({
            store,
            location: props.location,
            params: props.match?.params ?? {},
          });
        }
      })();
      return () => {
        cancelled = true;
      };
      // Re-run per route: the editor moves between folders without remounting.
    }, [store, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

    return <Component {...props} />;
  }

  hoistNonReactStatics(WithClientSideAsyncConnect, Component);
  // NOT the loader itself: leaving it on would let ReduxAsyncConnect fetch the
  // same data again on client-side navigation, on top of the effect above.
  delete WithClientSideAsyncConnect.reduxAsyncConnect;
  WithClientSideAsyncConnect.displayName = `ClientSideAsyncConnect(${
    Component.displayName || Component.name || 'Component'
  })`;
  return WithClientSideAsyncConnect;
}
