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

  /**
   * Take a document out of publication.
   *
   * The one workflow move Strapi's REST API does not expose. Publishing is
   * `PUT /api/:plural/:documentId?status=published`; there is no counterpart,
   * so without this an editor could publish and never retract — which is the
   * half of a workflow that matters when something goes out by mistake.
   */
  async unpublish(ctx) {
    const { collection, documentId } = ctx.params;
    const uid = `api::${collection}.${collection}`;
    if (!strapi.contentTypes[uid]) {
      return ctx.notFound(`No content type ${uid}`);
    }
    const document = await strapi.documents(uid).unpublish({ documentId });
    if (!document) {
      // Not found rather than a silent success: an unpublish that moved
      // nothing would report the document retracted while it stayed public.
      return ctx.notFound(`No document ${documentId} in ${uid}`);
    }
    ctx.body = { documentId, unpublished: true };
  },
};
