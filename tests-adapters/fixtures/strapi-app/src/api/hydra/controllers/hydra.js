'use strict';

/**
 * Answer with a content type's attributes as Strapi itself holds them.
 *
 * Unmapped on purpose: turning Strapi's field types into the admin's canonical
 * ones is the ADAPTER's job, and doing it here would put knowledge of Hydra
 * inside the CMS, where no test of the adapter could see it.
 */
module.exports = {
  async schema(ctx) {
    const { collection } = ctx.params;
    const uid = `api::${collection}.${collection}`;
    const contentType = strapi.contentTypes[uid];
    if (!contentType) {
      // 404, not an empty schema: an add form built from attributes that do
      // not exist would offer fields nothing can store.
      return ctx.notFound(`No content type ${uid}`);
    }
    ctx.body = {
      uid,
      info: contentType.info,
      attributes: contentType.attributes,
    };
  },
};
