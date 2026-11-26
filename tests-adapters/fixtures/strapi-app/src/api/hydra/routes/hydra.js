'use strict';

/**
 * The one route this fixture adds to Strapi.
 *
 * Strapi describes its own content types only behind /api/content-type-builder,
 * which needs an admin session — an API token cannot read it. So a headless
 * admin that wants to render an add form has nothing to render it from, and the
 * adapter needs the schema exposed deliberately, exactly as the WordPress
 * adapter needs its companion plugin for post locks.
 *
 * Read-only, and only the schema: no content passes through here.
 */
module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/hydra/schema/:collection',
      handler: 'hydra.schema',
    },
    {
      // UNPUBLISHING, which the content API cannot do.
      //
      // `PUT /api/pages/:id?status=published` publishes — verified — but the
      // reverse does nothing: `?status=draft` returns 200 and leaves the
      // published variant in place, and there is no unpublish action (405).
      // The Document Service has unpublish(); this exposes it.
      method: 'POST',
      path: '/hydra/unpublish/:collection/:documentId',
      handler: 'hydra.unpublish',
    },
  ],
};
