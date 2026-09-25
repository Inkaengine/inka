/* eslint-disable @next/next/no-img-element */
"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import SlateBlock, { SlateInline } from "@/components/SlateBlock";
import CodeExampleBlock from "@/components/CodeExampleBlock/CodeExampleBlock";
import CookieConsentBlock from "@/components/CookieConsentBlock/CookieConsentBlock";
import { expandTemplatesSync, expandListingBlocks, ploneFetchItems, staticBlocks, contentPath } from "#utils/helpers";
import { isEditMode } from "#utils/hydra";
import SwiperSlider from "@/components/SwiperSlider";
import { pageFromPath } from "#utils/paging";

// Template context for nested block expansion
const TemplateContext = createContext({ templates: {}, templateState: {} });

/**
 * Expand child blocks using expandTemplatesSync with template context
 * For blocks dicts: expand(layout, blocks)
 * For object_list arrays: expand(items, null, '@id')
 */
function useExpand() {
  const { templates, templateState } = useContext(TemplateContext);
  return (layout, blocks, idField) =>
    expandTemplatesSync(layout, {
      blocks,
      templateState,
      templates,
      ...(idField && { idField }),
    });
}

/**
 * Render Slate JSON nodes inline (for hero descriptions, table cells, etc.)
 */
function SlateNodes({ value }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  // Render inline — no [data-edit-text="value"] wrapper. Callers like the
  // hero description put the slate content inside their own
  // [data-edit-text="description"] (or similar) container and must not nest
  // another edit-text container inside it, otherwise the bridge's DOM-to-
  // Slate round-trip reads an empty value from the outer container.
  return <SlateInline value={value} />;
}

/**
 * Get a display URL from a link value (handles Plone's array/object format).
 * Strips the backend base URL to return relative paths for internal links.
 */
function getUrl(value, apiUrl) {
  if (!value) return "";
  if (Array.isArray(value) && value.length) value = value[0];
  if (typeof value === "object" && value["@id"]) return contentPath(value["@id"], apiUrl);
  if (typeof value === "object" && value.url) return value.url;
  return contentPath(String(value), apiUrl);
}

/**
 * Get image props from a block value (handles all Plone image formats).
 * Ported from Nuxt composables/imageProps.js
 * @param {object|string|Array} block - image value in various Plone formats
 * @param {string} backendBaseUrl - backend base URL for relative paths
 * @returns {{ url: string|null, size: string, align: string, srcset: string, sizes: string, width: number }}
 */
function imageProps(block, backendBaseUrl) {
  if (!block) return { url: null };

  // Unwrap preview_image field
  if (block?.preview_image) {
    block = block.preview_image;
  }
  // Handle array format: [{ download, scales }]
  if (Array.isArray(block) && block.length > 0) {
    block = block[0];
  }

  if (!block) return { url: null };

  let image_url = null;

  if (typeof block === "string") {
    // Plain URL string (e.g., data URI, external URL)
    image_url = block;
  } else if ("@id" in block && block?.image_scales) {
    // Image content object with scales
    image_url = block["@id"];
  } else if ("@id" in block && block?.hasPreviewImage) {
    // href object with a preview image (e.g., teaser target)
    image_url = block["@id"];
    image_url = image_url.startsWith("/") ? `${backendBaseUrl}${image_url}` : image_url;
    image_url = `${image_url}/@@images/preview_image`;
    return { url: image_url };
  } else if ("@id" in block) {
    // Image reference with only a base path — a relation field ships
    // [{ "@id": "/images/penguin1.jpg" }] with no scales and no @type. The @id is
    // the Image object; its bytes live at @@images/image (the bare path 404s), so
    // add the scale suffix now, mirroring the hasPreviewImage branch above. The
    // final @type-driven suffix below can't help here — there is no @type.
    image_url = block["@id"];
    image_url = image_url.startsWith("/") ? `${backendBaseUrl}${image_url}` : image_url;
    if (
      !image_url.includes("@@images") &&
      !image_url.includes("@@download") &&
      !image_url.includes("@@display-file") &&
      !image_url.startsWith("data:")
    ) {
      image_url = `${image_url}/@@images/image`;
    }
    return { url: image_url };
  } else if (block?.download) {
    image_url = block.download;
  } else if (block?.url && block["@type"] === "image") {
    // Image block with url field
    const urlValue = block.url;
    if (typeof urlValue === "string") {
      image_url = urlValue;
    } else if (urlValue?.image_scales && urlValue?.image_field) {
      // Catalog brain format from listing expansion
      const field = urlValue.image_field;
      const scales = urlValue.image_scales[field];
      if (scales?.[0]?.download) {
        image_url = `${urlValue["@id"] || ""}/${scales[0].download}`;
      }
    } else if (urlValue?.["@id"]) {
      image_url = urlValue["@id"];
    }
  } else {
    return { url: null };
  }

  if (!image_url) return { url: null };

  // Prepend backend base URL for relative paths
  image_url = image_url.startsWith("/") ? `${backendBaseUrl}${image_url}` : image_url;

  let srcset = "";
  let sizes = "";
  const width = block?.width;

  // Use image_scales download path if available
  if (block?.image_scales && block?.image_field) {
    const field = block.image_field;
    srcset = Object.keys(block.image_scales[field][0].scales).map((name) => {
      const scale = block.image_scales[field][0].scales[name];
      return `${image_url}/${scale.download} ${scale.width}w`;
    }).join(", ");
    sizes = Object.keys(block.image_scales[field][0].scales).map((name) => {
      const scale = block.image_scales[field][0].scales[name];
      return `${name}:${scale.width}px`;
    }).join(" ");
    image_url = `${image_url}/${block.image_scales[field][0].download}`;
  } else if (block?.scales) {
    srcset = Object.keys(block.scales).map((name) => {
      const scale = block.scales[name];
      return `${image_url}/${scale.download} ${scale.width}w`;
    }).join(", ");
    image_url = block.download;
  } else if (block?.url && block?.image_field) {
    image_url = `${image_url}/@@images/${block.image_field}`;
  } else if (
    (block["@type"] === "image" || block["@type"] === "Image") &&
    !image_url.includes("@@images") &&
    !image_url.includes("@@download") &&
    !image_url.includes("@@display-file") &&
    !image_url.startsWith("data:")
  ) {
    // Image block / Plone Image reference without scale info — add the default
    // image scale. Accept both the block @type "image" and the content @type
    // "Image" (capital), as nuxt's imageProps does.
    image_url = `${image_url}/@@images/image`;
  }

  return {
    url: image_url,
    size: block.size,
    align: block.align,
    srcset,
    sizes,
    width,
  };
}

/**
 * Teaser helpers: use block data if overwrite is set OR if hrefObj has no content data
 */
function getTeaserTitle(block) {
  const hrefObj = block.href?.[0];
  const hrefObjHasContentData = hrefObj?.title !== undefined;
  const useBlockData = block.overwrite || !hrefObjHasContentData;
  if (useBlockData) return block.title || hrefObj?.title || "";
  return hrefObj?.title || "";
}

function getTeaserDescription(block) {
  const hrefObj = block.href?.[0];
  const hrefObjHasContentData = hrefObj?.title !== undefined;
  const useBlockData = block.overwrite || !hrefObjHasContentData;
  if (useBlockData) return block.description || hrefObj?.description || "";
  return hrefObj?.description || "";
}

/**
 * Format a date string for display
 */
function formatDate(dateStr, showTime) {
  if (!dateStr) return "";
  const opts = { year: "numeric", month: "long", day: "numeric" };
  if (showTime) {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
  }
  return new Date(dateStr).toLocaleDateString(undefined, opts);
}

/**
 * YouTube ID extraction
 */
function getYouTubeId(url) {
  if (!url) return null;
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?/]+)/
  );
  return m ? m[1] : null;
}

// ─── Social Icons ────────────────────────────────────────────────────────────

const SOCIAL_ICONS = {
  "github.com":
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>',
  "youtube.com":
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
  "x.com":
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  "twitter.com":
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  "mastodon.social":
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 0 0 .023-.043v-1.809a.052.052 0 0 0-.02-.041.053.053 0 0 0-.046-.01 20.282 20.282 0 0 1-4.709.547c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 0 1-.319-1.433.053.053 0 0 1 .066-.054 19.648 19.648 0 0 0 4.636.536c.397 0 .794 0 1.192-.013 1.99-.059 4.088-.163 5.985-.67a.175.175 0 0 0 .023-.006c2.298-.665 4.48-2.688 4.623-7.828.006-.238.046-2.476.046-2.717 0-.833.31-5.907-.046-7.172zM19.903 13.24h-2.558v-5.9c0-1.243-.525-1.875-1.575-1.875-1.16 0-1.74.749-1.74 2.23v3.227h-2.544V7.695c0-1.481-.58-2.23-1.74-2.23-1.05 0-1.576.632-1.576 1.875v5.9H5.612V7.514c0-1.243.317-2.232.954-2.965.657-.733 1.517-1.108 2.584-1.108 1.234 0 2.17.474 2.795 1.423L12 4.958l.055.906c.625-.95 1.56-1.423 2.795-1.423 1.066 0 1.926.375 2.583 1.108.637.733.955 1.722.955 2.965v5.726z"/></svg>',
  "bsky.app":
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.785 2.627 3.6 3.494 6.67 3.06-4.576.78-5.865 3.36-3.397 5.94 3.006 3.144 5.434-1.056 6.103-3.26.079-.26.114-.39.114-.26 0-.13.035 0 .114.26.669 2.204 3.097 6.404 6.103 3.26 2.468-2.58 1.179-5.16-3.397-5.94 3.07.434 5.885-.433 6.67-3.06.246-.828.624-5.79.624-6.479 0-.688-.139-1.86-.902-2.203-.66-.299-1.664-.621-4.3 1.24C12.046 4.747 9.087 8.686 8 10.8z"/></svg>',
};

const DEFAULT_LINK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

function getSocialInfo(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const svg = SOCIAL_ICONS[hostname];
    return svg ? { name: hostname, svg } : { name: hostname, svg: DEFAULT_LINK_SVG };
  } catch {
    return { name: "Link", svg: DEFAULT_LINK_SVG };
  }
}

// ─── Facet helpers (search block) ────────────────────────────────────────────

const FACET_FIELD_OPTIONS = {
  review_state: [
    { value: "private", title: "Private" },
    { value: "pending", title: "Pending" },
    { value: "published", title: "Published" },
  ],
  portal_type: [
    { value: "Document", title: "Page" },
    { value: "News Item", title: "News Item" },
    { value: "Event", title: "Event" },
    { value: "Image", title: "Image" },
    { value: "File", title: "File" },
    { value: "Link", title: "Link" },
  ],
};

function getFacetField(facet) {
  if (typeof facet.field === "object") {
    return facet.field?.value || "";
  }
  return facet.field || "";
}

function getFacetOptions(facet) {
  const field = getFacetField(facet);
  return FACET_FIELD_OPTIONS[field] || [];
}

// ─── Paging Component ────────────────────────────────────────────────────────

function Paging({ paging, buildUrl, onNavigate }) {
  if (!paging || paging.totalPages <= 1) return null;
  const handleClick = (e, page) => {
    e.preventDefault();
    onNavigate(page);
  };
  return (
    <nav aria-label="Page Navigation" className="paging" style={{ marginTop: "1rem" }}>
      <ul style={{ display: "inline-flex", listStyle: "none", padding: 0, gap: 0 }}>
        {paging.prev !== null && (
          <li>
            <a
              href={buildUrl(paging.prev)}
              className="paging-prev"
              data-linkable-allow
              data-block-selector={`-${paging.size || 1}`}
              onClick={(e) => handleClick(e, paging.prev)}
              style={{ padding: "0.25rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "4px 0 0 4px", color: "#6b7280", backgroundColor: "#fff" }}
            >
              Previous
            </a>
          </li>
        )}
        {paging.pages && paging.pages.map((pg) => (
          <li key={pg.page}>
            <a
              href={buildUrl(pg.page - 1)}
              className={`paging-page${paging.currentPage === pg.page - 1 ? " current" : ""}`}
              data-linkable-allow
              onClick={(e) => handleClick(e, pg.page - 1)}
              style={{
                padding: "0.25rem 0.75rem",
                border: "1px solid #d1d5db",
                color: "#6b7280",
                backgroundColor: paging.currentPage === pg.page - 1 ? "#dbeafe" : "#fff",
              }}
            >
              {pg.page}
            </a>
          </li>
        ))}
        {paging.next !== null && (
          <li>
            <a
              href={buildUrl(paging.next)}
              className="paging-next"
              data-linkable-allow
              data-block-selector={`+${paging.size || 1}`}
              onClick={(e) => handleClick(e, paging.next)}
              style={{ padding: "0.25rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "0 4px 4px 0", color: "#6b7280", backgroundColor: "#fff" }}
            >
              Next
            </a>
          </li>
        )}
      </ul>
    </nav>
  );
}

// ─── Listing Block (async fetcher with paging) ──────────────────────────────

const DEFAULT_PAGE_SIZE = 6;

// Build a paging path. STRIP any trailing slash from the context first: a root
// context ("/") would otherwise give "/" + "/@pg_…" = "//@pg_…", a
// protocol-relative URL the browser reads as a host (the "@" splits userinfo),
// so history.pushState throws SecurityError. Latent until the bridge could
// actually click the pager to reveal an off-page child; now it can.
const buildPagingPath = (contextPath, id, page) =>
  page === 0
    ? contextPath || "/"
    : `${(contextPath || "/").replace(/\/+$/, "")}/@pg_${id}_${page}`;

function ListingBlock({ id, block, data, apiUrl, contextPath }) {
  const [items, setItems] = useState([]);
  const [paging, setPaging] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);

  // Read initial page from URL on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentPage(pageFromPath(window.location.pathname, id));
    }
  }, [id]);

  useEffect(() => {
    if (!apiUrl) return;
    const fetchItems = {
      listing: ploneFetchItems({ apiUrl, contextPath: contextPath || "/" }),
    };
    expandListingBlocks([id], {
      blocks: { [id]: block },
      fetchItems,
      itemTypeField: "variation",
      paging: { start: currentPage * DEFAULT_PAGE_SIZE, size: DEFAULT_PAGE_SIZE },
    }).then((result) => {
      setItems(result.items || []);
      setPaging(result.paging || null);
    });
  }, [id, block, apiUrl, contextPath, currentPage]);

  const buildPagingUrl = useCallback((page) => buildPagingPath(contextPath, id, page), [id, contextPath]);

  const handleNavigate = useCallback((page) => {
    setCurrentPage(page);
    // Update URL without full page reload
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", buildPagingPath(contextPath, id, page));
    }
  }, [id, contextPath]);

  if (!items.length && !paging) return null;
  return (
    <>
      {/* Key by the item, not by the block. expandListingBlocks gives every
          item the LISTING's uid — deliberately, so the bridge addresses them
          all as that block — so @uid is the same string for all of them and
          React duplicates or omits children. @id is the content each item is.
          The uid still goes to `id`, which is what the bridge reads. */}
      {items.map((item, index) => (
        <Block key={item["@id"] ?? `${item["@uid"] ?? "item"}-${index}`} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
      ))}
      <Paging paging={paging} buildUrl={buildPagingUrl} onNavigate={handleNavigate} />
    </>
  );
}

// ─── Grid Block ──────────────────────────────────────────────────────────────
// A grid pages its children the SAME way whether or not one of them is a listing:
// staticBlocks windows the static children (threading `seen`), and a listing child
// pages through ListingBlock. Paging is not conditional on a listing — a plain
// grid of cards renders a pager and pages just like a grid with a listing, so a
// child on a later page has a data-block-selector control the bridge can reveal it
// through.
function GridBlock({ id, block, data, apiUrl, contextPath }) {
  const [currentPage, setCurrentPage] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined") setCurrentPage(pageFromPath(window.location.pathname, id));
  }, [id]);

  const layout = block.blocks_layout?.items || [];
  const blocks = block.blocks || {};
  const start = currentPage * DEFAULT_PAGE_SIZE;
  const hasListing = layout.some((cid) => blocks[cid]?.["@type"] === "listing");

  // A grid pages ALL its children as ONE combined window. When a listing is
  // present its items must be FETCHED, so we window the whole layout through
  // expandListingBlocks (async) — which walks the layout, fetches each listing
  // and windows every manual child inline against the running position. A
  // manual block AFTER a listing therefore lands on whatever page the listing's
  // item count pushes it to, and the bridge reveals it by paging the grid. A
  // pure-static grid needs no fetch, so it windows synchronously through
  // staticBlocks — same paging, SSR-friendly, no hydration flash. Paging is not
  // conditional on a listing; only whether the window is fetched async is.
  const [asyncItems, setAsyncItems] = useState(null);
  const [asyncPaging, setAsyncPaging] = useState(null);
  useEffect(() => {
    if (!hasListing) return;
    const fetchItems = { listing: ploneFetchItems({ apiUrl: apiUrl || "", contextPath: contextPath || "/" }) };
    expandListingBlocks(layout, {
      blocks,
      fetchItems,
      itemTypeField: "variation",
      paging: { start, size: DEFAULT_PAGE_SIZE },
    }).then((res) => {
      setAsyncItems(res.items || []);
      setAsyncPaging(res.paging || null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, block, apiUrl, contextPath, start, hasListing]);

  let items;
  let paging;
  if (hasListing) {
    items = asyncItems || [];
    paging = asyncPaging;
  } else {
    const res = staticBlocks(layout, { blocks, paging: { start, size: DEFAULT_PAGE_SIZE } });
    items = res.items;
    paging = res.paging;
  }

  const buildPagingUrl = (page) => buildPagingPath(contextPath, id, page);
  const handleNavigate = (page) => {
    setCurrentPage(page);
    if (typeof window !== "undefined") window.history.pushState({}, "", buildPagingUrl(page));
  };

  return (
    <div data-block-uid={id} data-block-container="{}" className="grid-block" style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(layout.length, 4)}, 1fr)`, gap: "1rem" }}>
      {items.map((item, index) => (
        <Block key={item["@id"] ?? `${item["@uid"] ?? "cell"}-${index}`} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
      ))}
      <Paging paging={paging} buildUrl={buildPagingUrl} onNavigate={handleNavigate} />
    </div>
  );
}

// ─── Accordion Block (with open/close panel tracking) ────────────────────────

function AccordionBlock({ id, block, data, apiUrl, contextPath }) {
  const expand = useExpand();
  const panels = expand(block.panels || [], null, "@id");

  // Track open panels — first panel open by default
  const [openPanels, setOpenPanels] = useState(() => {
    const initial = {};
    if (panels.length > 0) {
      initial[panels[0]["@uid"]] = true;
    }
    return initial;
  });

  const toggle = (panelUid) => {
    setOpenPanels((prev) => ({ ...prev, [panelUid]: !prev[panelUid] }));
  };

  return (
    <div data-block-uid={id} className="accordion-block">
      {panels.map((panel, i) => {
        const children = expand(panel.blocks_layout?.items || [], panel.blocks || {});
        const isOpen = !!openPanels[panel["@uid"]];
        // What the toggle button can reveal: the panel itself and every block
        // inside it, since the editor can select any of them from the document
        // tree while the panel is closed. The bridge clicks this handle to open
        // the panel before measuring the selected block.
        const revealTargets = [panel["@uid"], ...(panel.blocks_layout?.items || [])].join(" ");
        return (
          <div key={panel["@uid"] || i} data-block-uid={panel["@uid"]} style={{ border: "1px solid #e5e7eb" }}>
            <h2>
              <button
                type="button"
                onClick={() => toggle(panel["@uid"])}
                aria-expanded={isOpen ? "true" : "false"}
                data-block-selector={revealTargets}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "1.25rem", fontWeight: 500, cursor: "pointer",
                  backgroundColor: isOpen ? "#f3f4f6" : "transparent", border: "none",
                  color: isOpen ? "#111827" : "#6b7280",
                }}
              >
                <span data-edit-text="title">{panel.title || `Panel ${i + 1}`}</span>
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none"
                  style={{ transform: isOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s" }}>
                  <path d="M9 5L5 1L1 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </h2>
            {/* A closed panel HIDES its content, it does not unmount it. The
                blocks inside are real blocks the editor can select from the
                document tree, and a selected block that isn't in the DOM has no
                rect, no toolbar and nothing to reveal — so the bridge can never
                bring it into view. display:none is what hydra expects here. */}
            <div
              style={{ padding: "1.25rem", borderTop: "1px solid #e5e7eb", display: isOpen ? "block" : "none" }}
            >
              {children.map((item) => (
                <Block key={item["@uid"]} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Callout Block (note / tip / warning / important admonition) ─────────────
// A callout is a container: its body is a region of child blocks (blocks_layout),
// each rendered through <Block>. Without this the callout — and its child slate —
// never rendered on nextjs, so the block-sanity reveal of the child timed out.
const CALLOUT_LEVELS = {
  note: { label: "Note", color: "#2563eb", bg: "#eff6ff" },
  tip: { label: "Tip", color: "#059669", bg: "#ecfdf5" },
  warning: { label: "Warning", color: "#d97706", bg: "#fffbeb" },
  important: { label: "Important", color: "#dc2626", bg: "#fef2f2" },
};

function CalloutBlock({ id, block, data, apiUrl, contextPath }) {
  const expand = useExpand();
  const level = CALLOUT_LEVELS[block.variation] || CALLOUT_LEVELS.note;
  const children = expand(block.blocks_layout?.items || [], block.blocks || {});
  return (
    <aside
      data-block-uid={id}
      className={`callout callout--${block.variation || "note"}`}
      style={{ borderLeft: `4px solid ${level.color}`, background: level.bg, padding: "12px 16px", borderRadius: 4, margin: "1em 0" }}
    >
      <div style={{ fontWeight: 700, color: level.color, textTransform: "uppercase", fontSize: "0.8em", letterSpacing: "0.05em", marginBottom: 4 }}>
        {level.label}
      </div>
      <div>
        {children.map((item) => (
          <Block key={item["@uid"]} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
        ))}
      </div>
    </aside>
  );
}

// ─── Form Block (with state tracking, validation, submit) ────────────────────

function FormBlock({ id, block, data, apiUrl, contextPath }) {
  // Editing is a browser fact — isEditMode() reads window.name / ?_edit, and the
  // server has neither — so this stays false through the first render and
  // matches the HTML the server sent. Flipping it after mount is what adds the
  // stand-ins, which is why a visitor's page never contains one at all.
  const [showHiddenFields, setShowHiddenFields] = useState(false);
  useEffect(() => {
    setShowHiddenFields(isEditMode());
  }, []);
  const expand = useExpand();
  const formFields = expand(block.subblocks || [], null, "field_id");

  const [formValues, setFormValues] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [success, setSuccess] = useState(false);

  const getFormValue = (fieldId) => formValues[fieldId] ?? "";

  const setFormValue = (fieldId, value) => {
    setFormValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const toggleMultiChoice = (fieldId, opt, checked) => {
    const current = formValues[fieldId] || [];
    const arr = Array.isArray(current) ? [...current] : [];
    if (checked) {
      if (!arr.includes(opt)) arr.push(opt);
    } else {
      const idx = arr.indexOf(opt);
      if (idx >= 0) arr.splice(idx, 1);
    }
    setFormValue(fieldId, arr);
  };

  const validateForm = () => {
    const errors = {};
    for (const field of formFields) {
      if (!field.required) continue;
      if (field.field_type === "static_text" || field.field_type === "hidden") continue;
      const value = formValues[field.field_id];
      const hasValue = Array.isArray(value) ? value.length > 0 : (value !== "" && value !== undefined && value !== false);
      if (!hasValue) {
        errors[field.field_id] = `${field.label} is required.`;
      }
    }
    // Email format validation for 'from' fields
    for (const field of formFields) {
      if (field.field_type !== "from") continue;
      const value = formValues[field.field_id];
      if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors[field.field_id] = "Please enter a valid email address.";
      }
    }
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    const submitData = formFields
      .filter((f) => f.field_type !== "static_text")
      .map((f) => ({
        field_id: f.field_id,
        label: f.label,
        value: formValues[f.field_id] ?? "",
      }));

    const cp = contextPath || "/";
    const response = await fetch(`${apiUrl}${cp}/@submit-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ block_id: id, data: submitData }),
    });
    if (response.ok || response.status === 204) {
      setSuccess(true);
    }
  };

  const inputStyle = (fieldId) => ({
    width: "100%", padding: "0.5rem",
    border: `1px solid ${formErrors[fieldId] ? "#ef4444" : "#d1d5db"}`,
    borderRadius: "0.5rem",
  });

  return (
    <div data-block-uid={id} className="form-block">
      {block.title && <h3 data-edit-text="title">{block.title}</h3>}
      {success ? (
        <div className="form-success" style={{ padding: "1rem", backgroundColor: "#f0fdf4", color: "#166534", borderRadius: "0.5rem", marginBottom: "1rem" }}>
          {block.send_message || "Form submitted successfully."}
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {formFields.map((field) => (
            <div
              key={field["@uid"]}
              data-block-uid={field["@uid"]}
              data-block-type={field.field_type}
              data-block-add="bottom"
              style={{ marginBottom: "1rem" }}
            >
              {field.field_type === "text" && (
                <>
                  <label data-edit-text="label">
                    {field.label}{field.required && <span style={{ color: "red" }}> *</span>}
                  </label>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  <input type="text" name={field.field_id} placeholder={field.placeholder || ""}
                    value={getFormValue(field.field_id)}
                    onChange={(e) => setFormValue(field.field_id, e.target.value)}
                    style={inputStyle(field.field_id)} />
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </>
              )}
              {field.field_type === "textarea" && (
                <>
                  <label data-edit-text="label">
                    {field.label}{field.required && <span style={{ color: "red" }}> *</span>}
                  </label>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  <textarea name={field.field_id} rows={4}
                    value={getFormValue(field.field_id)}
                    onChange={(e) => setFormValue(field.field_id, e.target.value)}
                    style={inputStyle(field.field_id)} />
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </>
              )}
              {field.field_type === "number" && (
                <>
                  <label data-edit-text="label">
                    {field.label}{field.required && <span style={{ color: "red" }}> *</span>}
                  </label>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  <input type="number" name={field.field_id}
                    value={getFormValue(field.field_id)}
                    onChange={(e) => setFormValue(field.field_id, e.target.value)}
                    style={inputStyle(field.field_id)} />
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </>
              )}
              {field.field_type === "select" && (
                <>
                  <label data-edit-text="label">
                    {field.label}{field.required && <span style={{ color: "red" }}> *</span>}
                  </label>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  <select name={field.field_id}
                    value={getFormValue(field.field_id)}
                    onChange={(e) => setFormValue(field.field_id, e.target.value)}
                    style={inputStyle(field.field_id)}>
                    <option value="">Select...</option>
                    {(field.input_values || []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </>
              )}
              {field.field_type === "single_choice" && (
                <fieldset>
                  <legend data-edit-text="label">
                    {field.label}{field.required && <span style={{ color: "red" }}> *</span>}
                  </legend>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  {(field.input_values || []).map((opt) => (
                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <input type="radio" name={field.field_id} value={opt}
                        checked={getFormValue(field.field_id) === opt}
                        onChange={() => setFormValue(field.field_id, opt)} /> {opt}
                    </label>
                  ))}
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </fieldset>
              )}
              {field.field_type === "multiple_choice" && (
                <fieldset>
                  <legend data-edit-text="label">
                    {field.label}{field.required && <span style={{ color: "red" }}> *</span>}
                  </legend>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  {(field.input_values || []).map((opt) => (
                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <input type="checkbox" name={field.field_id} value={opt}
                        checked={(getFormValue(field.field_id) || []).includes(opt)}
                        onChange={(e) => toggleMultiChoice(field.field_id, opt, e.target.checked)} /> {opt}
                    </label>
                  ))}
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </fieldset>
              )}
              {field.field_type === "checkbox" && (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input type="checkbox" name={field.field_id}
                      checked={!!getFormValue(field.field_id)}
                      onChange={(e) => setFormValue(field.field_id, e.target.checked)} />
                    <span data-edit-text="label">{field.label}{field.required && <span style={{ color: "red" }}> *</span>}</span>
                  </label>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </>
              )}
              {field.field_type === "date" && (
                <>
                  <label data-edit-text="label">
                    {field.label}{field.required && <span style={{ color: "red" }}> *</span>}
                  </label>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  <input type="date" name={field.field_id}
                    value={getFormValue(field.field_id)}
                    onChange={(e) => setFormValue(field.field_id, e.target.value)}
                    style={inputStyle(field.field_id)} />
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </>
              )}
              {field.field_type === "from" && (
                <>
                  <label data-edit-text="label">
                    {field.label}{field.required && <span style={{ color: "red" }}> *</span>}
                  </label>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  <input type="email" name={field.field_id}
                    value={getFormValue(field.field_id)}
                    onChange={(e) => setFormValue(field.field_id, e.target.value)}
                    style={inputStyle(field.field_id)} />
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </>
              )}
              {field.field_type === "attachment" && (
                <>
                  <label data-edit-text="label">
                    {field.label}{field.required && <span style={{ color: "red" }}> *</span>}
                  </label>
                  {field.description && <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>}
                  <input type="file" name={field.field_id}
                    onChange={(e) => setFormValue(field.field_id, e.target.files?.[0]?.name || "")} />
                  {formErrors[field.field_id] && <p className="form-error" style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.25rem" }}>{formErrors[field.field_id]}</p>}
                </>
              )}
              {field.field_type === "static_text" && (
                <div>
                  {field.label && <strong data-edit-text="label">{field.label}</strong>}
                  {field.description && <p>{field.description}</p>}
                </div>
              )}
              {field.field_type === "hidden" && (
                <>
                  <input type="hidden" name={field.field_id} value={field.value || ""} />
                  {/* A hidden field has no visual form, so the block had no
                      size and the author had nothing to click. Shown — marked
                      as hidden — only while editing, so a visitor's page
                      carries no trace of it. */}
                  {showHiddenFields && <div className="hidden-field-standin">
                    <span className="hidden-field-badge">Hidden</span>
                    <span data-edit-text="label">{field.label}</span>
                  </div>}
                </>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: "0.75rem", paddingTop: "0.5rem" }}>
            <button type="submit" className="form-submit" data-edit-text="submit_label">
              {block.submit_label || "Submit"}
            </button>
            {block.show_cancel && (
              <button type="reset" data-edit-text="cancel_label"
                onClick={() => { setFormValues({}); setFormErrors({}); }}>
                {block.cancel_label || "Cancel"}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Search Block (with facets, search input, sort) ──────────────────────────

function SearchBlock({ id, block, data, apiUrl, contextPath }) {
  const expand = useExpand();
  const facets = expand(block.facets || [], null, "@id");
  const searchResults = expand(block.blocks_layout?.listing || [], block.blocks || {});

  const [searchText, setSearchText] = useState("");
  const [facetValues, setFacetValues] = useState({});
  const [sortOn, setSortOn] = useState("");

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    setSearchText(formData.get("SearchableText") || "");
  };

  // A block that exists ONLY once a question has been asked — the quick-answer
  // region. The input carries the sample question (data-block-selector-input)
  // and the submit button the uid, so the editor can reveal it by asking; a
  // React-controlled input is exactly the case setDeclaredValue's native
  // setter exists for. In-place here (state), no navigation.
  const quickAnswerUid = block.blocks_layout?.quickAnswer?.[0] || "";
  const quickAnswerChild = quickAnswerUid ? block.blocks?.[quickAnswerUid] : null;
  const revealProps = quickAnswerUid
    ? { "data-block-selector": quickAnswerUid }
    : {};
  const revealInputProps = quickAnswerUid && block.quickAnswerSample
    ? { ...revealProps, "data-block-selector-input": block.quickAnswerSample }
    : {};
  const quickAnswer = quickAnswerUid && quickAnswerChild && searchText ? (
    <div data-block-uid={quickAnswerUid} className="quick-answer"
      style={{ margin: "1rem 0", padding: "0.75rem", backgroundColor: "#eef3fb", borderRadius: "0.5rem" }}>
      <div data-edit-text="answer">{quickAnswerChild.answer || ""}</div>
    </div>
  ) : null;

  const handleSortChange = (e) => {
    setSortOn(e.target.value);
  };

  const isFacetChecked = (facet, value) => {
    const field = getFacetField(facet);
    const current = facetValues[field];
    if (Array.isArray(current)) return current.includes(value);
    return current === value;
  };

  const handleFacetCheckboxChange = (e) => {
    const checkbox = e.target;
    const field = checkbox.dataset.field;
    const value = checkbox.value;

    setFacetValues((prev) => {
      const current = prev[field];
      const currentValues = Array.isArray(current) ? [...current] : current ? [current] : [];

      if (checkbox.checked) {
        if (!currentValues.includes(value)) currentValues.push(value);
      } else {
        const idx = currentValues.indexOf(value);
        if (idx !== -1) currentValues.splice(idx, 1);
      }

      const next = { ...prev };
      if (currentValues.length === 0) {
        delete next[field];
      } else if (currentValues.length === 1) {
        next[field] = currentValues[0];
      } else {
        next[field] = currentValues;
      }
      return next;
    });
  };

  const handleFacetSelectChange = (e) => {
    const field = e.target.dataset.field;
    const value = e.target.value;
    setFacetValues((prev) => {
      const next = { ...prev };
      if (value) {
        next[field] = value;
      } else {
        delete next[field];
      }
      return next;
    });
  };

  const getListingTotalResults = () => {
    const listingUid = block.blocks_layout?.listing?.[0];
    if (!listingUid) return null;
    const listingBlock = block.blocks?.[listingUid];
    return listingBlock?._paging?.totalItems || listingBlock?.items_total || null;
  };

  const renderFacet = (facet, i) => {
    if (facet.type === "slate" || facet.type === "image") {
      return (
        <div key={facet["@uid"] || i} data-block-uid={facet["@uid"]} data-block-add="bottom"
          style={{ padding: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "4px", minWidth: "12rem" }}>
          <Block block={facet} id={facet["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
        </div>
      );
    }
    return (
      <div key={facet["@uid"] || i} data-block-uid={facet["@uid"]} data-block-type={facet.type} data-block-add="bottom"
        style={{ padding: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "4px", minWidth: "12rem" }}>
        <div data-edit-text="title" style={{ fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.5rem" }}>{facet.title}</div>
        {facet.type === "selectFacet" && (
          <select data-field={getFacetField(facet)} onChange={handleFacetSelectChange} style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "0.875rem" }}>
            <option value="">Select...</option>
            {getFacetOptions(facet).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.title}</option>
            ))}
          </select>
        )}
        {facet.type === "daterangeFacet" && (
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <input type="date" style={{ padding: "0.25rem 0.5rem", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "0.875rem" }} />
            <span style={{ color: "#9ca3af" }}>&mdash;</span>
            <input type="date" style={{ padding: "0.25rem 0.5rem", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "0.875rem" }} />
          </div>
        )}
        {facet.type === "toggleFacet" && (
          <div style={{ marginTop: "0.25rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
              <input type="checkbox" />
              {getFacetOptions(facet)?.[0]?.title || "Toggle"}
            </label>
          </div>
        )}
        {facet.type !== "selectFacet" && facet.type !== "daterangeFacet" && facet.type !== "toggleFacet" && (
          <div>
            {getFacetOptions(facet).map((opt) => (
              <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                <input type="checkbox" value={opt.value} className="facet-checkbox"
                  data-field={getFacetField(facet)}
                  checked={isFacetChecked(facet, opt.value)}
                  onChange={handleFacetCheckboxChange} />
                {opt.title}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  const totalResults = getListingTotalResults();

  // Facets on left/right side variation
  if (block.variation === "facetsLeftSide" || block.variation === "facetsRightSide") {
    return (
      <div data-block-uid={id} className="search-block">
        {block.headline && <h2 data-edit-text="headline">{block.headline}</h2>}
        {block.showSearchInput && (
          <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <input type="text" name="SearchableText" placeholder="Search..." defaultValue={searchText}
              {...revealInputProps}
              style={{ flex: 1, padding: "0.5rem 1rem", border: "1px solid #d1d5db", borderRadius: "0.5rem" }} />
            <button type="submit" {...revealProps} style={{ padding: "0.5rem 1rem", backgroundColor: "#2563eb", color: "#fff", borderRadius: "0.5rem", border: "none" }}>
              Search
            </button>
          </form>
        )}
        {quickAnswer}
        <div style={{ display: "flex", gap: "1.5rem", flexDirection: block.variation === "facetsRightSide" ? "row-reverse" : "row" }}>
          {facets.length > 0 && (
            <aside className="search-facets" style={{ width: "16rem", flexShrink: 0 }}>
              <div style={{ padding: "1rem", backgroundColor: "#f9fafb", borderRadius: "0.5rem" }}>
                {block.facetsTitle && <h3 data-edit-text="facetsTitle" style={{ fontWeight: 600, marginBottom: "0.75rem", color: "#374151" }}>{block.facetsTitle}</h3>}
                {facets.map((facet, i) => (
                  <div key={facet["@uid"] || i} style={{ marginBottom: "1rem", paddingBottom: "1rem", borderBottom: "1px solid #e5e7eb" }}>
                    {renderFacet(facet, i)}
                  </div>
                ))}
              </div>
            </aside>
          )}
          <div className="search-results" style={{ flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
              {block.showTotalResults && totalResults && (
                <p style={{ color: "#4b5563" }}>{totalResults} results</p>
              )}
              {block.showSortOn && block.sortOnOptions?.length > 0 && (
                <div className="search-sort">
                  <label style={{ fontSize: "0.875rem", color: "#4b5563", marginRight: "0.5rem" }}>Sort by:</label>
                  <select onChange={handleSortChange} style={{ padding: "0.25rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "0.875rem" }}>
                    {block.sortOnOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {searchResults.map((item) => (
              <Block key={item["@uid"]} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Default: facets on top
  return (
    <div data-block-uid={id} className="search-block">
      {block.headline && <h2 data-edit-text="headline">{block.headline}</h2>}
      {block.showSearchInput && (
        <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input type="text" name="SearchableText" placeholder="Search..." defaultValue={searchText}
            {...revealInputProps}
            style={{ flex: 1, padding: "0.5rem 1rem", border: "1px solid #d1d5db", borderRadius: "0.5rem" }} />
          <button type="submit" {...revealProps} style={{ padding: "0.5rem 1rem", backgroundColor: "#2563eb", color: "#fff", borderRadius: "0.5rem", border: "none" }}>
            Search
          </button>
        </form>
      )}
      {quickAnswer}
      {facets.length > 0 && (
        <>
          {block.facetsTitle && <h3 data-edit-text="facetsTitle" style={{ fontWeight: 600, marginBottom: "0.75rem", color: "#374151" }}>{block.facetsTitle}</h3>}
          <div className="search-facets" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem", padding: "1rem", backgroundColor: "#f9fafb", borderRadius: "0.5rem" }}>
            {facets.map((facet, i) => renderFacet(facet, i))}
          </div>
        </>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
        {block.showTotalResults && totalResults && (
          <p style={{ color: "#4b5563" }}>{totalResults} results</p>
        )}
        {block.showSortOn && block.sortOnOptions?.length > 0 && (
          <div className="search-sort">
            <label style={{ fontSize: "0.875rem", color: "#4b5563", marginRight: "0.5rem" }}>Sort by:</label>
            <select onChange={handleSortChange} style={{ padding: "0.25rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "0.875rem" }}>
              {block.sortOnOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="search-results">
        {searchResults.map((item) => (
          <Block key={item["@uid"]} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
        ))}
      </div>
    </div>
  );
}

/**
 * Stand-in for an image block that has no image yet: a transparent-grey SVG with
 * real intrinsic dimensions, so it lays out like the image it will become and
 * gives the author something to click. Kept at module scope — a data URI rebuilt
 * per render would change identity and churn the DOM.
 */
const IMAGE_BLOCK_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='%23e5e7eb'/%3E%3C/svg%3E";

// ─── Block Component ─────────────────────────────────────────────────────────

function Block({ block, id, data, apiUrl, contextPath }) {
  const type = block["@type"];
  const expand = useExpand();

  switch (type) {
    // ── Slate (rich text) ──
    case "slate":
      return (
        <div data-block-uid={id}>
          <SlateBlock
            value={
              block.value || [
                { nodeId: 1, type: "p", children: [{ text: "\u00A0" }] },
              ]
            }
          />
        </div>
      );

    // ── Title ──
    case "title":
      return (
        <h1 data-block-uid={id} data-edit-text="/title">
          {data.title}
        </h1>
      );

    // ── Description ──
    case "description":
      return (
        <p data-block-uid={id} data-edit-text="/description" className="description">
          {data.description}
        </p>
      );

    // ── Introduction — standalone slate value at block.value, not page fields
    case "introduction":
      return (
        <div data-block-uid={id} className="introduction-block">
          <div data-edit-text="value">
            <SlateNodes value={block.value || []} />
          </div>
        </div>
      );

    // ── Image ──
    case "image": {
      const imgProps = imageProps(block, apiUrl);
      // An image block with no image still renders one — a grey placeholder at
      // the shape a real image would take. This block exists to hold an image,
      // so the author has to be able to click it to set one, and a block that
      // renders nothing has no box to click and no toolbar to reveal from.
      // That is NOT the always-render hack #296 forbids: that rule is about
      // OPTIONAL fields (a hero's image), which stay absent until revealed.
      const src = imgProps.url || IMAGE_BLOCK_PLACEHOLDER;
      const href = getUrl(block.href, apiUrl);
      return (
        <div
          data-block-uid={id}
          className={`image-size-${imgProps.size || block.size || "l"} image-align-${imgProps.align || block.align || "center"}`}
        >
          {href ? (
            <a href={href} className="image-link" data-edit-link="href">
              <img data-edit-media="url" src={src} alt={block.alt || ""}
                {...(imgProps.srcset ? { srcSet: imgProps.srcset, sizes: imgProps.sizes } : {})}
                {...(imgProps.width ? { width: imgProps.width } : {})} />
            </a>
          ) : (
            <img data-edit-media="url" data-edit-link="href" src={src} alt={block.alt || ""}
              {...(imgProps.srcset ? { srcSet: imgProps.srcset, sizes: imgProps.sizes } : {})}
              {...(imgProps.width ? { width: imgProps.width } : {})} />
          )}
        </div>
      );
    }

    // ── Lead Image ──
    case "leadimage": {
      const leadImgProps = imageProps(data.preview_image, apiUrl);
      if (!leadImgProps.url) return <div data-block-uid={id} />;
      return (
        <div data-block-uid={id} className="leadimage-block">
          <img data-edit-media="preview_image" src={leadImgProps.url} alt="" loading="lazy"
            {...(leadImgProps.srcset ? { srcSet: leadImgProps.srcset, sizes: leadImgProps.sizes } : {})} />
        </div>
      );
    }

    // ── Date Field ──
    case "dateField": {
      const field = block.dateField || "effective";
      return (
        <div data-block-uid={id} className="datefield-block">
          <span data-edit-text={`/${field}`}>
            {formatDate(data[field], block.showTime)}
          </span>
        </div>
      );
    }

    // ── Hero ──
    case "hero":
      return (
        <div data-block-uid={id} className="hero-block">
          {block.image ? (
            <img
              className="hero-image"
              data-edit-media="image"
              src={imageProps(block.image, apiUrl).url || ""}
              alt="Hero image"
            />
          ) : (
            <div className="hero-image hero-placeholder" data-edit-media="image" />
          )}
          <h1 className="hero-heading" data-edit-text="heading">
            {block.heading}
          </h1>
          <p className="hero-subheading" data-edit-text="subheading">
            {block.subheading}
          </p>
          <div className="hero-description" data-edit-text="description">
            <SlateNodes value={block.description} />
          </div>
          {block.buttonText && (
            <a
              className="hero-button"
              href={getUrl(block.buttonLink, apiUrl)}
              data-edit-link="buttonLink"
              data-edit-text="buttonText"
            >
              {block.buttonText}
            </a>
          )}
        </div>
      );

    // ── Teaser ──
    case "teaser": {
      const teaserHref = getUrl(block.href, apiUrl);
      const teaserTitle = getTeaserTitle(block);
      const teaserDesc = getTeaserDescription(block);
      const teaserImgProps = block.preview_image
        ? imageProps(block.preview_image, apiUrl)
        : block.href?.[0]?.hasPreviewImage
          ? imageProps(block.href[0], apiUrl)
          : null;
      return (
        <div
          data-block-uid={block._blockUid || id}
          data-block-readonly={block.overwrite ? undefined : ""}
          className="teaser-block"
        >
          {teaserImgProps?.url ? (
            <a href={teaserHref} data-edit-link="href">
              <img
                data-edit-media="preview_image"
                src={teaserImgProps.url}
                alt=""
                className="teaser-image"
              />
            </a>
          ) : (
            <div
              data-edit-media="preview_image"
              className="teaser-image-placeholder"
              style={{ height: "200px", backgroundColor: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <span style={{ color: "#9ca3af" }}>Click to add image</span>
            </div>
          )}
          <div className="teaser-content">
            {teaserTitle && (
              <a href={teaserHref} data-edit-link="href">
                {/* head_title is a schema field like any other, so it needs the
                    annotation that makes it editable. Rendering it bare put the
                    author in the worst position: the kicker is right there on
                    screen, visibly part of the teaser they are editing, and
                    clicking it does nothing at all. */}
                {block.head_title && (
                  <div className="teaser-head-title" data-edit-text="head_title">
                    {block.head_title}
                  </div>
                )}
                <h2 className="teaser-title" data-edit-text="title">
                  {teaserTitle}
                </h2>
              </a>
            )}
            {teaserDesc && (
              <p className="teaser-description" data-edit-text="description">
                {teaserDesc}
              </p>
            )}
            <a href={teaserHref} className="teaser-link" data-edit-link="href">
              Read more
            </a>
          </div>
        </div>
      );
    }

    // ── Columns ──
    case "columns": {
      return (
        <div data-block-uid={id} data-block-container="{allowed:['Column'],add:'horizontal'}" className="columns-block" style={{ display: "flex", gap: "1rem" }}>
          {block.title && <h3 data-edit-text="title">{block.title}</h3>}
          {(block.blocks_layout?.columns || []).map((columnId) => {
            const col = block.blocks?.[columnId];
            if (!col) return null;
            const children = expand(col.blocks_layout?.items || [], col.blocks || {});
            return (
              <div key={columnId} data-block-uid={columnId} data-block-add="right" style={{ flex: 1 }}>
                {col.title && <h4 data-edit-text="title">{col.title}</h4>}
                {children.map((item) => (
                  <Block key={item["@uid"]} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
                ))}
              </div>
            );
          })}
        </div>
      );
    }

    // ── Grid Block ──
    case "gridBlock":
      return <GridBlock id={id} block={block} data={data} apiUrl={apiUrl} contextPath={contextPath} />;

    // ── Section — a plain container: a wrapper and the blocks it holds ──
    case "section": {
      const sectionChildren = expand(block.blocks_layout?.items || [], block.blocks || {});
      return (
        <section data-block-uid={id} data-block-container="{}" className="section-block">
          {sectionChildren.map((item) => (
            <Block key={item["@uid"]} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
          ))}
        </section>
      );
    }

    // ── Context navigation — its entries are child blocks: `navItem`s written by
    // hand, or a `listing` that generates them from a query. Both are rendered
    // as blocks, so each keeps its own data-block-uid and stays selectable.
    case "contextNavigation": {
      const navChildren = expand(block.blocks_layout?.items || [], block.blocks || {});
      return (
        <nav
          data-block-uid={id}
          data-block-container="{}"
          className="context-navigation-block"
          aria-label={block.ariaLabel || "Section navigation"}
        >
          {navChildren.map((item) => (
            <Block key={item["@uid"]} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
          ))}
        </nav>
      );
    }

    // ── Nav item — one entry of a contextNavigation ──
    case "navItem": {
      const navHref = getUrl(block.href, apiUrl);
      return (
        <div data-block-uid={id} className="nav-item-block">
          <a href={navHref || "#"} data-edit-link="href" data-edit-text="label">
            {block.label || ""}
          </a>
        </div>
      );
    }

    // ── Accordion ──
    case "accordion":
      return <AccordionBlock id={id} block={block} data={data} apiUrl={apiUrl} contextPath={contextPath} />;

    case "callout":
      return <CalloutBlock id={id} block={block} data={data} apiUrl={apiUrl} contextPath={contextPath} />;

    // ── Slider ──
    case "slider": {
      const slides = expand(block.slides || [], null, "@id");
      return (
        <section data-block-uid={id} data-block-container="{allowed:['Slide'],add:'horizontal'}" className="slider-block">
          <SwiperSlider slides={slides} apiUrl={apiUrl} imageProps={imageProps} getUrl={getUrl} />
        </section>
      );
    }

    // ── Listing ──
    case "listing":
      return (
        <div data-block-uid={id} className="listing-block">
          <ListingBlock id={id} block={block} data={data} apiUrl={apiUrl} contextPath={contextPath} />
        </div>
      );

    // ── Search ──
    case "search":
      return <SearchBlock id={id} block={block} data={data} apiUrl={apiUrl} contextPath={contextPath} />;

    // ── Slate Table ──
    case "objectBlocks": {
      // Fields grouped under a widget:'object' (#245). The headline (slate) and
      // href (link) live directly on block.content; the body is a blocks_layout
      // region nested at content.blocks_layout.body over content.blocks. Field
      // paths use the `content/...` object-descent form, so the annotations name
      // the path hydra writes back to — not a flat field name.
      const content = block.content || {};
      const body = expand(content.blocks_layout?.body || [], content.blocks || {});
      return (
        <div data-block-uid={id} className="object-blocks-block">
          {/* A div, not a heading: slate renders <p>, and a <p> inside an <h3>
              is invalid — the browser relocates it, server and client disagree,
              and React drops the subtree ("Expected server HTML to contain a
              matching <p> in <div>"), taking the nested blocks with it. Vue
              tolerates the same markup, which is why only this frontend broke. */}
          {(content.headline || []).length > 0 && (
            <div className="ob-headline" data-edit-text="content/headline">
              <SlateNodes value={content.headline} />
            </div>
          )}
          {content.href !== undefined && (
            <a data-edit-link="content/href" href={content.href || "#"}>
              Object link
            </a>
          )}
          <div className="object-blocks-body">
            {body.map((item) => (
              <Block key={item["@uid"]} block={item} id={item["@uid"]} data={data} apiUrl={apiUrl} contextPath={contextPath} />
            ))}
          </div>
        </div>
      );
    }

    case "slateTable": {
      const rows = expand(block.table?.rows || [], null, "key");
      return (
        <div data-block-uid={id} className="table-block">
          <table>
            <tbody>
              {rows.map((row) => {
                const cells = expand(row.cells || [], null, "key");
                return (
                  <tr key={row["@uid"]} data-block-uid={row["@uid"]} data-block-add="bottom">
                    {cells.map((cell) => {
                      const CellTag = cell.type === "header" ? "th" : "td";
                      return (
                        <CellTag
                          key={cell["@uid"]}
                          data-block-uid={cell["@uid"]}
                          data-block-add="right"
                          data-edit-text="value"
                        >
                          <SlateNodes value={cell.value} />
                        </CellTag>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    // ── Suggest — the vocabularySelect worked example. The live type-ahead
    // is the docs' SuggestBlock; here the resting markup renders and stays
    // editable. ──
    case "suggest": {
      return (
        <div data-block-uid={id} className="suggest">
          <label htmlFor={`${id}-input`} data-edit-text="label">
            {block.label || ""}
          </label>
          <input
            id={`${id}-input`}
            name="answer"
            type="text"
            defaultValue={block.value || ""}
            aria-autocomplete="list"
            autoComplete="off"
          />
          <ul className="suggest__list" hidden></ul>
        </div>
      );
    }

    // ── Heading ──
    case "heading": {
      const Tag = block.tag || "h2";
      return (
        <Tag data-block-uid={id} data-edit-text="heading">
          {block.heading || ""}
        </Tag>
      );
    }

    // ── Separator ──
    case "separator":
      return <hr data-block-uid={id} />;

    // ── Button ──
    case "button":
      return (
        <div data-block-uid={id} className="button-block">
          <a
            href={getUrl(block.href, apiUrl)}
            data-edit-link="href"
            className="button"
          >
            <span data-edit-text="title">{block.title || "Button"}</span>
          </a>
        </div>
      );

    // ── Highlight ──
    case "highlight": {
      const highlightImgProps = imageProps(block.image, apiUrl);
      return (
        <section
          data-block-uid={id}
          className="highlight-block"
          style={{ position: "relative", overflow: "hidden", borderRadius: "8px" }}
        >
          {/* data-edit-media on BOTH branches: the backdrop element exists either
              way (it is the block's background), so annotating it costs no extra
              markup and is the only way this image is editable at all — as a CSS
              background it has no <img> for the editor to aim at. */}
          {highlightImgProps.url ? (
            <div
              data-edit-media="image"
              style={{
                position: "absolute", inset: 0,
                backgroundImage: `url(${highlightImgProps.url})`,
                backgroundSize: "cover", backgroundPosition: "center",
              }}
            />
          ) : (
            <div data-edit-media="image" style={{ position: "absolute", inset: 0, backgroundColor: block.color || "#f0f0f0" }} />
          )}
          <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.5)" }} />
          <div style={{ position: "relative", padding: "4rem 1rem", textAlign: "center", color: "#fff" }}>
            <h2 data-edit-text="title" style={{ marginBottom: "1rem" }}>{block.title}</h2>
            <div data-edit-text="description" style={{ marginBottom: "2rem" }}>
              <SlateNodes value={block.description || block.value || []} />
            </div>
            {block.cta_title && (
              <a
                href={getUrl(block.cta_link, apiUrl)}
                data-edit-text="cta_title"
                data-edit-link="cta_link"
                className="highlight-cta"
                style={{ padding: "0.75rem 1.25rem", backgroundColor: "#1d4ed8", color: "#fff", borderRadius: "8px", textDecoration: "none" }}
              >
                {block.cta_title}
              </a>
            )}
          </div>
        </section>
      );
    }

    // ── Video ──
    case "video": {
      // A doc video ships a relative Plone download path
      // (/docs/static/hydra-demo.mp4/@@download/file). Left relative it resolves
      // to the nextjs origin (:3007) and 404s — the backend serves it, so prepend
      // the API base for a root-relative URL, exactly as imageProps does. An
      // absolute URL (a YouTube link) is left untouched.
      const rawVideoUrl = block.url || "";
      const videoUrl = rawVideoUrl.startsWith("/") ? `${apiUrl}${rawVideoUrl}` : rawVideoUrl;
      const ytId = getYouTubeId(videoUrl);
      return (
        <div data-block-uid={id} className="video-block">
          {ytId ? (
            <iframe
              src={`https://www.youtube.com/embed/${ytId}`}
              allowFullScreen
              style={{ width: "100%", aspectRatio: "16/9", border: "none" }}
            />
          ) : videoUrl ? (
            <video src={videoUrl} controls style={{ width: "100%" }} />
          ) : (
            <p>No video URL set</p>
          )}
        </div>
      );
    }

    // ── Maps ──
    case "maps":
      return (
        <div data-block-uid={id} className="maps-block">
          {block.title && <h3 data-edit-text="title">{block.title}</h3>}
          {block.url ? (
            <iframe
              src={block.url}
              data-edit-link="url"
              title={block.title || "Map"}
              allowFullScreen
              loading="lazy"
              style={{ width: "100%", height: "450px", border: "none" }}
            />
          ) : (
            <p>No map URL configured</p>
          )}
        </div>
      );

    // ── Table of Contents ──
    case "toc": {
      // Generate TOC entries from heading blocks in page data
      const tocEntries = [];
      const layout = data?.blocks_layout?.items || [];
      for (const bid of layout) {
        const b = data?.blocks?.[bid];
        if (!b) continue;
        if (b["@type"] === "heading" && b.heading) {
          tocEntries.push({ id: bid, level: parseInt((b.tag || "h2").slice(1)), text: b.heading });
        } else if (b["@type"] === "slate" && b.value?.[0]?.type?.match(/^h[1-6]$/)) {
          const level = parseInt(b.value[0].type.slice(1));
          const text = b.plaintext || b.value[0].children?.map(c => c.text).join("") || "";
          if (text.trim()) tocEntries.push({ id: bid, level, text });
        }
      }
      return (
        <nav data-block-uid={id} className="toc-block">
          <h3>Table of Contents</h3>
          {tocEntries.length > 0 ? (
            <ul style={{ listStyle: "disc", paddingLeft: "1.25rem" }}>
              {tocEntries.map((e) => (
                <li key={e.id} style={{ marginLeft: `${(e.level - 2) * 1.5}em` }}>
                  <a href={`#${e.id}`}>{e.text}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "#9ca3af", fontStyle: "italic" }}>No headings found</p>
          )}
        </nav>
      );
    }

    // ── Form ──
    case "form":
      return <FormBlock id={id} block={block} data={data} apiUrl={apiUrl} contextPath={contextPath} />;

    // ── Code Example ──
    case "codeExample":
      return <CodeExampleBlock id={id} block={block} />;

    // ── Cookie Consent ──
    // The two halves it words are rendered outside its element, each opened by
    // the trigger that names the field it holds.
    case "cookieConsent":
      return <CookieConsentBlock id={id} block={block} SlateNodes={SlateNodes} />;

    // ── Empty ──
    case "empty":
      return <div data-block-uid={id} className="empty-block" style={{ minHeight: "60px" }} />;

    // ── Event Metadata ──
    case "eventMetadata":
      return (
        <div data-block-uid={id} className="event-metadata">
          <dl>
            {data.start && (
              <div className="event-row">
                <dt>When</dt>
                <dd>
                  <span data-edit-text="/start">{formatDate(data.start, true)}</span>
                  {data.end && (
                    <span>
                      {" – "}
                      <span data-edit-text="/end">{formatDate(data.end, true)}</span>
                    </span>
                  )}
                </dd>
              </div>
            )}
            {data.location && (
              <div className="event-row">
                <dt>Where</dt>
                <dd data-edit-text="/location">{data.location}</dd>
              </div>
            )}
            {data.event_url && (
              <div className="event-row">
                <dt>Website</dt>
                <dd><a href={data.event_url}>{data.event_url}</a></dd>
              </div>
            )}
            {(data.contact_name || data.contact_email || data.contact_phone) && (
              <div className="event-row">
                <dt>Contact</dt>
                <dd>
                  {data.contact_name && <span data-edit-text="/contact_name">{data.contact_name}</span>}
                  {data.contact_email && <span> · <a href={`mailto:${data.contact_email}`}>{data.contact_email}</a></span>}
                  {data.contact_phone && <span data-edit-text="/contact_phone"> · {data.contact_phone}</span>}
                </dd>
              </div>
            )}
          </dl>
        </div>
      );

    // ── Social Links ──
    case "socialLinks": {
      const links = expand(block.links || [], null, "@id");
      return (
        <div data-block-uid={id} className="social-links">
          <span>Follow us:</span>
          {links.map((link, i) => {
            const info = getSocialInfo(link.url);
            return (
              <a
                key={link["@uid"] || i}
                data-block-uid={link["@uid"]}
                data-block-add="right"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                data-edit-link="url"
                title={info.name}
                dangerouslySetInnerHTML={{ __html: info.svg }}
              />
            );
          })}
        </div>
      );
    }

    // ── Default listing item: title + description (no image) ──
    case "default":
      return (
        <div data-block-uid={id} className="listing-item default-item">
          <h4>
            <a href={getUrl(block.href, apiUrl)} data-edit-link="href" data-edit-text="title">
              {block.title}
            </a>
          </h4>
          {block.description && (
            <p data-edit-text="description">{block.description}</p>
          )}
        </div>
      );

    // ── Summary listing item: image thumbnail + title + description ──
    case "summary": {
      const summaryImgProps = block.image ? imageProps(block.image, apiUrl) : null;
      return (
        <div data-block-uid={id} className="listing-item summary-item" style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
          {summaryImgProps?.url && (
            <img
              data-edit-media="image"
              src={summaryImgProps.url}
              alt=""
              style={{ width: "8rem", height: "6rem", objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
              {...(summaryImgProps.srcset ? { srcSet: summaryImgProps.srcset, sizes: summaryImgProps.sizes } : {})}
            />
          )}
          <div style={{ flex: 1 }}>
            {block.date && (
              <time>{formatDate(block.date)}</time>
            )}
            <h4>
              <a href={getUrl(block.href, apiUrl)} data-edit-link="href" data-edit-text="title">
                {block.title}
              </a>
            </h4>
            {block.description && (
              <p data-edit-text="description">{block.description}</p>
            )}
          </div>
        </div>
      );
    }

    // ── Unknown ──
    default:
      return (
        <div data-block-uid={id}>
          Unknown block: {type}
        </div>
      );
  }
}

// ─── BlocksList (entry point) ────────────────────────────────────────────────

const BlocksList = ({ data, apiUrl, contextPath }) => {
  if (!data?.blocks_layout?.items) return null;

  const templates = data._templates || {};
  const templateState = {};

  return (
    <TemplateContext.Provider value={{ templates, templateState }}>
      <div className="blocks-list">
        {data.blocks_layout.items.map((id) => {
          const block = data.blocks[id];
          if (!block) return null;
          return <Block key={id} block={block} id={id} data={data} apiUrl={apiUrl} contextPath={contextPath} />;
        })}
      </div>
      {/* The page's footer region (blocks_layout.footer). */}
      {data.blocks_layout.footer?.length > 0 && (
        <footer className="blocks-footer">
          {data.blocks_layout.footer.map((id) => {
            const block = data.blocks[id];
            if (!block) return null;
            return <Block key={id} block={block} id={id} data={data} apiUrl={apiUrl} contextPath={contextPath} />;
          })}
        </footer>
      )}
    </TemplateContext.Provider>
  );
};

export default BlocksList;
