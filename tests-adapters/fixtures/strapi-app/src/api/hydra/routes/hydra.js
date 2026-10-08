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
  ],
};
