"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { stripPagingFromPath } from "#utils/paging";
import { initBridge } from "#utils/hydra";
import BlocksList from "@/components/BlocksList";
// Bundle the doc-blocks schema bundle so addNodeIdsToAllSlateFields can
// see e.g. highlight.description as a slate widget — without this the
// bridge skips assigning data-node-id to slate field nodes.
import docPageDefinitions from "../../../../../docs/examples/block-definitions.json";
import { sharedBlocksConfig } from "@test-fixtures/shared-block-schemas.js";
const docBlocksConfig = {
  ...Object.fromEntries(
    Object.values(docPageDefinitions).flatMap((page) => Object.entries(page.blocks)),
  ),
  // One registry for every frontend. The doc bundle stays underneath because it
  // is what generates the block reference pages, but the schemas a frontend
  // publishes at INIT come from the shared file — the Nuxt example and the mock
  // test frontend read the same one. Building a separate registry here is why
  // title, description, leadimage, dateField and eventMetadata rendered as
  // "Not implemented Block" in this example while working everywhere else.
  ...sharedBlocksConfig,
};


export default function PageClient({ initialData, apiUrl }) {
  const [data, setData] = useState(initialData);
  // The blocks below use this as the CONTENT path they belong to (a listing
  // queries relative to it), so the paging segment has to come off — it names a
  // block, not a place in the content tree.
  const pathname = stripPagingFromPath(usePathname());

  useEffect(() => {
    initBridge({
      // A design system's own text styles (#295). Declared here because stored
      // content carrying `styleName` is validated against EVERY frontend that
      // serves it: block-sanity asks whether an author could have produced it,
      // and a style no menu offers fails that — correctly. The shared fixtures
      // use these, so the example frontends that run block-sanity declare them.
      voltoConfig: {
        settings: {
          slate: {
            styleMenu: {
              blockStyles: [{ cssClass: 'lead', label: 'Lead' }],
              inlineStyles: [{ cssClass: 'dropcap', label: 'Drop cap' }],
            },
          },
        },
      },
      page: {
        schema: {
          properties: {
                        // The page's content region is `items` — the KEY inside the shared
            // blocks_layout dict (formData.blocks_layout.items), which is what
            // buildBlockPathMap and the template merge look up. Declaring it as
            // `blocks_layout` meant they resolved blocks_layout.blocks_layout,
            // found nothing, and skipped the region: no path map for the page's
            // own blocks and no template merge, so definition blocks never got
            // the instance id that makes them unlockable.
            items: { title: 'Content', widget: 'blocks_layout', allowedBlocks: ['slate', 'image', 'video', 'teaser', 'title', 'description', 'introduction', 'leadimage', 'dateField', 'hero', 'columns', 'gridBlock', 'accordion', 'slider', 'listing', 'search', 'slateTable', 'heading', 'separator', 'button', 'highlight', 'maps', 'toc', 'form', 'codeExample', 'eventMetadata', 'socialLinks', 'suggest'] },
          },
        },
      },
      blocks: { ...docBlocksConfig },
      onEditChange: (updatedData) => {
        if (updatedData) {
          setData(updatedData);
        }
      },
    });
  }, []);

  // Update data when navigating to a new page (SSR provides fresh initialData)
  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  return (
    <div className="page">
      <BlocksList data={data} apiUrl={apiUrl} contextPath={pathname} />
    </div>
  );
}
