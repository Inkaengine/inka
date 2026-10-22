/**
 * The expander bundle, and who it is worth enabling for.
 *
 * Volto's apiExpanders declare that these arrive embedded in the content
 * response: components skip their own fetch (hasApiExpander) and the reducers
 * read content['@components'].
 *
 * Enabled ONLY for adapters whose CMS expands natively, because for anyone
 * else it measurably costs more than it saves. An emulating adapter answers an
 * expansion by issuing the same intents itself, so the request count cannot go
 * down — and it goes UP, because Volto's reducers cache navigation, types and
 * actions in the store and skip re-fetching them, while expansion re-requests
 * the whole bundle on every content GET. Measured on the Drupal journey:
 * 190 requests without, 214 with, wall clock unchanged.
 *
 * Native expanders pay because the bundle rides along in a request that was
 * being made anyway: five route requests collapse into one.
 *
 * Retested once the adapters cached reads properly, on the theory that the
 * extra breadcrumbs/navigation/types an expansion asks for would then be free.
 * They are not: ungated, the Drupal journey went from 1.5 minutes to 6.9 and
 * failed. Caching removes the duplicate READS, but expansion still fans every
 * content GET out into four more intents, and on an emulating adapter that is
 * four more things to go wrong per route rather than four fewer requests.
 *
 * The list is EXACTLY what the contract can serve. navroot stays off
 * deliberately: hasApiExpander would report it as expanded, the component would
 * skip its own fetch, and the data would never arrive.
 *
 * `translations` is on now that the contract serves it (translations.get). It
 * has no component of its own to skip — the translation table and the
 * compare-languages pane both read it straight off the content, with no fetch
 * to fall back to — so it has to ride along or it is simply absent.
 *
 * Asked of every adapter, including ones with no multilingual story: the bundle
 * is declared statically, before any adapter has announced what it supports
 * (see client.js on why that cannot be deferred). An adapter that cannot serve
 * it omits it rather than failing the content read — see expandContext — and
 * the affordances that would read it are gated on site.get's
 * `features.multilingual` anyway.
 */
export const BRIDGE_EXPANDERS = [
  { match: '', GET_CONTENT: ['breadcrumbs', 'actions', 'types', 'translations'] },
  {
    match: '',
    GET_CONTENT: ['navigation'],
    querystring: (cfg) => ({
      'expand.navigation.depth': cfg.settings.navDepth,
    }),
  },
];
