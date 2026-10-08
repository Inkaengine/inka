'use strict';

// Provision an API token on boot, so the contract harness never needs the admin UI.
//
// Written to a file rather than logged: the harness reads it, and an access key in
// a log is an access key in CI output.
const fs = require('node:fs');
const path = require('node:path');

/** How many terms the contract's large-vocabulary assertion needs. */
const VOCABULARY_SIZE = 10_000;

const TOKEN_NAME = 'hydra-contract';
const TOKEN_FILE = path.join(__dirname, '..', '.hydra-api-token');

module.exports = {
  register() {},
  async bootstrap({ strapi }) {
    try {
      const service = strapi.service('admin::api-token');
      const existing = await service.getByName?.(TOKEN_NAME);
      if (existing) {
        // The access key is only returned at CREATE time, so a pre-existing token
        // is useless to us — replace it rather than boot without one.
        await service.revoke(existing.id);
      }
      const created = await service.create({
        name: TOKEN_NAME,
        description: 'Hydra adapter contract suite',
        type: 'full-access',
        lifespan: null,
      });
      fs.writeFileSync(TOKEN_FILE, created.accessKey, { mode: 0o600 });
      strapi.log.info(`[hydra] API token written to ${TOKEN_FILE}`);

      // Let an ANONYMOUS client read pages.
      //
      // Strapi answers 403 to the public role by default, so a frontend could not
      // render anything — and the suite's public-read tests ask exactly that: can a
      // visitor fetch the blocks with no credentials. Any headless Strapi site
      // serving a public frontend has to grant this, so the fixture does too; it is
      // configuration, not a workaround.
      const publicRole = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' } });
      if (publicRole) {
        for (const action of ['api::page.page.find', 'api::page.page.findOne']) {
          const existing = await strapi.db
            .query('plugin::users-permissions.permission')
            .findOne({ where: { action, role: publicRole.id } });
          if (!existing) {
            await strapi.db
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: publicRole.id } });
          }
        }
        strapi.log.info('[hydra] public read granted on api::page.page');
      }

      // A vocabulary big enough for the contract's type-ahead assertion.
      //
      // That test budgets a filtered query against an unfiltered one, so it
      // only distinguishes a server-side filter from an in-memory one if the
      // vocabulary is large — the Plone and WordPress fixtures generate ten
      // thousand terms for the same reason.
      //
      // Written through the query engine in ONE createMany rather than ten
      // thousand REST calls: the suite reseeds before every test and could not
      // afford it, which is why this is bootstrap work and the pages are not.
      const terms = await strapi.db.query('api::category.category').count();
      if (terms < VOCABULARY_SIZE) {
        await strapi.db.query('api::category.category').deleteMany({});
        await strapi.db.query('api::category.category').createMany({
          data: Array.from({ length: VOCABULARY_SIZE }, (_, n) => ({
            title: `Category ${n}`,
          })),
        });
        strapi.log.info(`[hydra] seeded ${VOCABULARY_SIZE} categories`);
      }
      const categoryRole = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' } });
      if (categoryRole) {
        for (const action of [
          'api::category.category.find',
          'api::category.category.findOne',
        ]) {
          const existing = await strapi.db
            .query('plugin::users-permissions.permission')
            .findOne({ where: { action, role: categoryRole.id } });
          if (!existing) {
            await strapi.db
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: categoryRole.id } });
          }
        }
      }
    } catch (error) {
      strapi.log.error(`[hydra] could not provision an API token: ${error.message}`);
    }
  },
};
