

// Plone's default `plone.allowed_sizes` registry (scale name -> max width). plone.scale
// generates these on demand at `<@id>/@@images/<field>/<name>`. An image block ships
// only a `url` (a brain summary, no embedded scale URLs), so the block CONSTRUCTS its
// scale URLs from this set rather than requesting the bare `<@id>/@@images/image`
// original. The original is large + slow (a cold one hangs ~300s under the parallel SSG
// prerender and 500s the build), and as a file named `image` it collides with the
// `image/<scale>` directory form on IPX's disk cache (ENOTDIR). Building
// `@@images/<field>/<scale>` keeps `image` a directory consistently and only ever
// fetches small pre-generated scales. (Matches pretagov-site's imageProps.)
const PLONE_SCALES = {
    icon: 32, tile: 64, thumb: 128, mini: 200,
    preview: 400, teaser: 600, large: 800,
    larger: 1000, great: 1200, huge: 1600,
};
const DEFAULT_SIZES = "sm:100vw md:50vw lg:33vw";

export default function imageProps(block, bgStyles=false, imageField='image') {
    const { optimizeImage } = useOptimizeImage()
    const runtimeConfig = useRuntimeConfig()

    // https://demo.plone.org/images/penguin1.jpg/@@images/image-32-cecef57e6c78570023eb042501b45dc2.jpeg
    // https://hydra-api.pretagov.com/images/penguin1.jpg/++api++/@@images/image-1800-31be5b7f53648238b68cae0a3ec45dec.jpeg
    var bg_class = {}
    if (!block) {
        return {
            url: null,
            class: bg_class
        }
    }
    if (block?.preview_image) {
        block = block.preview_image;
    }
    // Handle array format (from Plone API): [{ download: '...', scales: {...} }]
    if (Array.isArray(block) && block.length > 0) {
        block = block[0];
    }
    var image_url = null;
    if (!block) {
        return {
            url: null,
            class: bg_class
        }
    } else if (typeof block === 'string') {
        // Plain URL string (e.g., data URI, external URL)
        image_url = block;
    } else if ('@id' in block && block?.image_scales) {
        // It's an image content object with scales
        image_url = block['@id'];
    } else if ('@id' in block && block?.hasPreviewImage) {
        // It's an href object with a preview image (e.g., teaser target)
        // Return early with the constructed URL since we don't have scale info
        image_url = block['@id'];
        image_url = image_url.startsWith("/") ? `${runtimeConfig.public.backendBaseUrl}${image_url}`: image_url;
        image_url = `${image_url}/@@images/preview_image`;
        return {
            url: image_url,
            class: bg_class,
        };
    } else if ('@id' in block) {
        // Image reference without scales (e.g., external URL, data URI, or from block conversion)
        image_url = block['@id'];
    } else if (block?.download) {
        image_url = block.download;
    }
    else if (block?.url && block['@type'] == "image") {
        // image block with url field - handle both string URLs and catalog brain format
        const urlValue = block.url;
        if (typeof urlValue === 'string') {
            image_url = urlValue;
        } else if (urlValue?.image_scales && urlValue?.image_field) {
            // Catalog brain format from listing expansion
            const field = urlValue.image_field;
            const scales = urlValue.image_scales[field];
            if (scales?.[0]?.download) {
                image_url = `${urlValue['@id'] || ''}/${scales[0].download}`;
            }
        } else if (!urlValue?.image_scales || !urlValue?.image_field) {
            // No image data — return null (listing placeholder handled by isInListing in template)
            return { url: null, class: bg_class };
        } else if (urlValue?.['@id']) {
            // Simple object with @id
            image_url = urlValue['@id'];
        }
    } else {
        return {
            url:null,
            class: bg_class
        }
    }

    if (!image_url ) {
      return {
        url:null,
        class: bg_class
        }
    } 
    image_url = image_url.startsWith("/") ? `${runtimeConfig.public.backendBaseUrl}${image_url}`: image_url;
    if (runtimeConfig.public.image_alias != '') {
        // in edit mode we are SPA so this won't work
        image_url = image_url.replace(runtimeConfig.public.backendBaseUrl, runtimeConfig.public.image_alias); // nuxt image alias
    }
    var srcset = "";
    var sizes = "";
    var width = block?.width;
    const field = block?.image_field ? block.image_field : null;

    // SVGs have no raster scales — Plone returns 0 bytes for `@@images/<field>/<scale>`,
    // which IPX rejects (IPX_INVALID_IMAGE). Serve the ORIGINAL for SVGs: it's the real
    // file, it's small (no prerender hang), and an SVG only ever uses the bare form, so
    // `<field>` is consistently a file and never collides with the scale-directory form.
    const imgMeta = Array.isArray(block?.image) ? block.image[0] : block?.image;
    const isSvg = /svg/i.test(block?.['content-type'] || '')
        || /svg/i.test(imgMeta?.['content-type'] || '')
        || /\.svg($|[?#])/i.test(image_url);

    if (isSvg && !image_url.includes('@@images') && !image_url.includes('@@download') && !image_url.startsWith('data:')) {
        // Serve the SVG via @@download/<field>/<filename>, NOT @@images/<field>.
        // Both return the original with image/svg+xml from Plone, but @@download
        // ends in the real filename (…/architecture.svg) while @@images/<field>
        // ends in the extensionless field name (…/image). IPX names its baked
        // static object after the source URL, so the @@images form produces an
        // EXTENSIONLESS object; Bunny then types it by extension (none →
        // application/octet-stream) and ignores the content-type we PUT, so the
        // browser won't render it. The @@download form keeps `.svg` on the object,
        // so Bunny serves image/svg+xml. Filename = the id's last path segment.
        const field = block?.image_field || 'image';
        const filename = image_url.split(/[?#]/)[0].split('/').pop();
        image_url = `${image_url}/@@download/${field}/${filename}`;
    } else if (block?.image_scales && block?.image_field && block.image_scales[block.image_field]?.[0]) {
        const field = block.image_field;
        const meta = block.image_scales[field][0];
        const scaleEntries = Object.values(meta.scales || {});
        srcset = Object.keys(meta.scales || {}).map((name) => {
            const scale = meta.scales[name];
            return `${image_url}/${scale.download} w${scale.width}`;
        }).join(", ");
        sizes = Object.keys(meta.scales || {}).map((name) => {
            const scale = meta.scales[name];
            return `${name}:${scale.width}px`;
        }).join(" ");
        // src must be a SCALE download (`@@images/<field>/<name>`), NOT the bare
        // top-level `meta.download` (`@@images/image`). The srcset above uses the
        // scale form, which needs `image` to be a DIRECTORY; a bare `image` src is a
        // FILE at the same path → IPX's disk cache can't be both (EEXIST/ENOTDIR),
        // and the bare original is the large slow variant that hangs the prerender.
        // (pretagov-site gets away with meta.download only because theirs is the
        // HASHED `image-<w>-<hash>.jpeg` — a unique file that never collides.)
        const isHashed = /@@images\/[^/]+-\d+-[0-9a-f]+\./.test(meta.download || '');
        if (isHashed) {
            image_url = `${image_url}/${meta.download}`;
        } else if (scaleEntries.length) {
            // Largest available scale as the src.
            const biggest = scaleEntries.reduce((a, b) => (b.width > a.width ? b : a));
            image_url = `${image_url}/${biggest.download}`;
        } else {
            image_url = `${image_url}/@@images/${field}/great`;
        }
    } else if (block?.scales) {
        srcset = Object.keys(block.scales).map((name) => {
            const scale = block.scales[name];
            return `${image_url}/${scale.download} w${scale.width}`;
        }).join(", ");
        image_url = block.download;
    } 
    else if (block?.url && block?.image_field) {
        // image block with image_field + url. Use a named SCALE, not the bare
        // `@@images/<field>` original — the bare form names the field a file and
        // collides with the `<field>/<scale>` directory form (EEXIST/ENOTDIR) while
        // being the large slow variant that hangs the SSG prerender.
        srcset = Object.entries(PLONE_SCALES)
            .map(([name, w]) => `${image_url}/@@images/${block.image_field}/${name} ${w}w`)
            .join(", ");
        sizes = DEFAULT_SIZES;
        image_url = `${image_url}/@@images/${block?.image_field}/great`;
    }
    else if ((block['@type'] == "image" || block['@type'] == "Image") && !image_url.includes('@@images') && !image_url.includes('@@download') && !image_url.includes('@@display-file') && !image_url.startsWith('data:')) {
        // Image block / Plone Image reference with only a base path (no embedded
        // scales). Construct the scale URLs from PLONE_SCALES rather than requesting
        // the bare `<base>/@@images/image` original: the original is large + slow (a
        // cold one hangs ~300s under the parallel SSG prerender), and as a file named
        // `image` it collides with the `image/<scale>` directory form on IPX's cache
        // (ENOTDIR). Every URL here is `@@images/<field>/<scale>`, so `image` is only
        // ever a directory and only small pre-generated scales are fetched.
        const fld = block?.image_field || 'image';
        srcset = Object.entries(PLONE_SCALES)
            .map(([name, w]) => `${image_url}/@@images/${fld}/${name} ${w}w`)
            .join(", ");
        sizes = DEFAULT_SIZES;
        image_url = `${image_url}/@@images/${fld}/great`;
    }
    else if (!image_url.startsWith('data:') && !image_url.includes('@@images') && !image_url.includes('@@download') && !image_url.includes('@@display-file') && !/\.[a-zA-Z]+$/.test(image_url)) {
        image_url = "";
    }
    // `${['hidden', 'duration-700', 'ease-linear', 'bg-center',  ] + (block?.preview_image? ['bg-cover', imageProps(block.preview_image[0]).bg]:['bg-gray-700', 'bg-blend-multiply', 'bg-no-repeat'])}`
    const size = block.size;
    const align = block.align;
    bg_class = [`background-image: url('${image_url}')`];
    if (bgStyles){
        bg_class = optimizeImage(image_url, {}, true).bgStyles;
    }
    return {
      url: image_url,
      size: size,
      align: align,
      srcset: srcset,
      sizes: sizes,
      class: bg_class,
      width: width,
    //   ...optimizeImage(
    //     image_url,
    //     /* options */
    //     {
    //       placeholder: false, // placeholder image before the actual image is fully loaded.
    //       //placeholder: props.placeholder, // placeholder image before the actual image is fully loaded.
    //     },
    //     true /* return bgStyles */,
    //   ),
  
    }
};


