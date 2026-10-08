<template>
  <!-- Mobile-first: native `<details>` open at ≥768px, collapsed below.
       Open state is driven by a matchMedia listener on mount so the
       disclosure has real mobile UX (tap summary to expand) while desktop
       readers see the list directly. `data-block-selector` on summary
       carries this contextNavigation's uid + every child's uid, so the
       bridge can match any of them via the `~=` word-list match and set
       `details.open = true` to expose the selected block during admin
       editing. -->
  <nav :data-block-uid="blockId"
       :aria-label="block.ariaLabel"
       class="context-navigation">
    <details ref="detailsRef" class="context-navigation-disclosure">
      <!-- Summary doubles as the visible header (desktop: styled as a
           small-caps section label, à la Stripe/MDN/Primer; mobile: the
           tap target for the disclosure). block.ariaLabel renders here
           via [data-edit-text] so authors can inline-edit the heading
           text just like any other string field; clicking the span
           positions the cursor AND triggers <details>'s native toggle,
           but that's a benign side-effect — the summary stays visible
           whether the details is open or closed, so editing continues
           without losing the cursor. -->
      <summary class="context-navigation-summary"
               :data-block-selector="exposedUids"><span data-edit-text="ariaLabel">{{ block.ariaLabel }}</span></summary>
      <ul role="list" :id="`${blockId}-list`" class="context-navigation-list">
        <li v-for="entry in entries" :key="entry.blockId">
          <a :href="entry.itemPath"
             :data-block-uid="entry.blockId"
             :class="entry.classes"
             :aria-current="entry.active ? 'page' : null"
             data-edit-link="href">
            <span data-edit-text="label">{{ entry.block.label }}</span>
          </a>
        </li>
      </ul>
      <!-- Non-nav children (e.g. a seeded 'empty' placeholder when the nav has no
           items yet) are delegated to the central block dispatch, which renders
           'empty' as a selectable placeholder. contextNavigation doesn't reject or
           special-case them — 'empty' is a universal placeholder, never a declared type. -->
      <Block v-for="item in extras" :key="item.blockId"
             :block_uid="item.blockId" :block="item.block" :data="block" />
    </details>
  </nav>
</template>

<script setup>
// contextNavigation parent renderer.
//
// Walks block.blocks_layout.items; for each navItem, keeps it as-is; for each
// listing, expands via expandListingBlocks (with the listing's
// fieldMappings.@default mapping @id→href via type='link' and title→label).
// Output: a single flat list. Level for each entry is derived from
// pathDepth(href) relative to the shallowest sibling — the visual indent
// matches URL nesting without any manual `level` field on navItem.
//
// Wrapped in <Suspense> from block.vue because the listing expansion is
// async (fetches via the Plone REST API).
// `ref` from vue; `useRoute` is a Nuxt auto-import composable so no explicit
// import is needed for it (same pattern as ListingBlock.vue).
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { expandListingBlocks, ploneFetchItems } from '@hydra-js/helpers';

const props = defineProps({
  blockId: { type: String, required: true },
  block: { type: Object, required: true },
  apiUrl: { type: String, required: true },
  contextPath: { type: String, required: true },
});

const route = useRoute();

// Mobile-first: open above 768px, closed below. matchMedia listener
// re-evaluates on viewport changes so resize works without reload.
// User toggling the summary still overrides until the next matchMedia
// change — that's standard <details> behavior.
const detailsRef = ref(null);
const DESKTOP_QUERY = '(min-width: 768px)';
let mql = null;
const onMediaChange = (e) => {
  if (detailsRef.value) detailsRef.value.open = e.matches;
};
onMounted(() => {
  if (typeof window === 'undefined') return;
  mql = window.matchMedia(DESKTOP_QUERY);
  if (detailsRef.value) detailsRef.value.open = mql.matches;
  mql.addEventListener('change', onMediaChange);
});
onBeforeUnmount(() => {
  if (mql) mql.removeEventListener('change', onMediaChange);
});

const NAV_LISTING_SIZE = 1000;

// space-separated list of uids the disclosure exposes — own uid + every
// direct child block id (manual navItems + listing block ids). Used by
// the bridge's data-block-selector `~=` word-list match to open the
// disclosure when admin selects any of these blocks.
const exposedUids = computed(() => {
  const childIds = props.block.blocks_layout?.items || [];
  return [props.blockId, ...childIds].join(' ');
});

async function expandChildren() {
  const flat = [];
  const extras = [];
  for (const childId of props.block.blocks_layout.items) {
    const child = props.block.blocks[childId];
    if (child['@type'] === 'navItem') {
      flat.push({ block: child, blockId: childId });
    } else if (child['@type'] === 'listing') {
      // The cnav listing's `relativePath ..` means "my section". Fetched
      // from the current page, Plone's @querystring-search drops the
      // current page — it always excludes its own context object — so the
      // page can't appear in its own nav. Fetch from the PARENT folder and
      // step the relativePath down one level (`..` -> `.`): same tree
      // slice, but the current page comes back as a normal result with its
      // getObjPositionInParent (so it sorts into place); only the parent
      // is excluded.
      const parentPath = props.contextPath.replace(/\/[^/]+\/?$/, '') || '/';
      const stepDown = (v) => {
        const s = String(v || '').split('/').filter(Boolean);
        if (s[0] === '..') s.shift();
        return s.length ? s.join('/') : '.';
      };
      const shifted = {
        ...child,
        querystring: {
          ...child.querystring,
          query: (child.querystring?.query || []).map((c) =>
            c.i === 'path' && c.o?.includes('relativePath')
              ? { ...c, v: stepDown(c.v) }
              : c,
          ),
        },
      };
      const result = await expandListingBlocks([childId], {
        blocks: { [childId]: shifted },
        fetchItems: {
          listing: ploneFetchItems({
            apiUrl: props.apiUrl,
            contextPath: parentPath,
          }),
        },
        paging: { start: 0, size: NAV_LISTING_SIZE },
        itemTypeField: 'variation',
      });
      for (const item of result.items) {
        // A listing with no results yields, while editing, one 'empty'
        // placeholder carrying its uid: draw it as the selectable placeholder
        // (extras), not as a nav link with no label.
        if (item['@type'] === 'empty') extras.push({ block: item, blockId: item['@uid'] });
        else flat.push({ block: item, blockId: item['@uid'] });
      }
    } else {
      // Not a nav child (navItem/listing). Don't reject it — delegate to the central
      // block dispatch (<Block> in the template). A seeded 'empty' placeholder is the
      // common case (empty nav); block.vue renders 'empty' as a selectable placeholder.
      extras.push({ block: child, blockId: childId });
    }
  }

  // A freshly-typed navItem (just picked from the chooser to replace a seeded empty) has no
  // href yet — tolerate it (treat as root-level, render as a plain anchor) instead of crashing
  // the whole nav on href[0]['@id'].
  const pathOf = (entry) => {
    const h = entry.block.href?.[0]?.['@id'];
    return h ? new URL(h, 'http://placeholder').pathname : '';
  };
  const segsOf = (p) => p.split('/').filter(Boolean);
  const here = route.path.replace(/\/$/, '');

  // Optional: prepend the section root (Volto's `includeTop`). Derived
  // from the shallowest item's parent — listings anchored on one path
  // share that parent. One small fetch for the root's title.
  if (props.block.includeTop && flat.length > 0) {
    const minDepthForRoot = Math.min(...flat.map((e) => segsOf(pathOf(e)).length));
    const shallowSegs = segsOf(pathOf(flat.find((e) => segsOf(pathOf(e)).length === minDepthForRoot)));
    const rootSegs = shallowSegs.slice(0, -1);
    if (rootSegs.length > 0) {
      const rootPath = '/' + rootSegs.join('/');
      const res = await fetch(`${props.apiUrl}/++api++${rootPath}`, {
        headers: { Accept: 'application/json' },
      });
      const rootData = await res.json();
      flat.unshift({
        block: {
          '@type': 'navItem',
          label: rootData.title,
          href: [{ '@id': rootData['@id'] }],
        },
        blockId: `${props.blockId}-top`,
      });
    }
  }

  const paths = flat.map(pathOf);
  const segs = paths.map(segsOf);
  const depths = segs.map((s) => s.length);
  const minDepth = Math.min(...depths);

  // Orphan prune: a listing filter (e.g. exclude_from_nav) can drop a
  // folder while still returning its deeper, non-excluded descendants —
  // those would otherwise surface as stray roots. Drop any entry with a
  // missing ancestor between the section root and itself, so hiding a
  // folder hides its whole subtree.
  const pathSet = new Set(paths.map((p) => p.replace(/\/$/, '')));
  const hasAllAncestors = (itemSegs) => {
    for (let d = minDepth; d < itemSegs.length; d++) {
      if (!pathSet.has('/' + itemSegs.slice(0, d).join('/'))) return false;
    }
    return true;
  };

  // Smart-expansion filter (default true): drop entries that are
  // descendants of unrelated siblings — typical docs sidebar UX.
  // Mirrors filterByCurrentPath in renderer.js.
  const expandCurrentOnly = props.block.expandCurrentOnly !== false;
  const currSegs = here.split('/').filter(Boolean);
  const startIdx = minDepth - 1;
  const passes = (itemSegs) => {
    if (!expandCurrentOnly) return true;
    const lastItemIdx = itemSegs.length - 1;
    for (let i = startIdx; i < itemSegs.length; i++) {
      if (i >= currSegs.length) return true; // descendant of current
      if (itemSegs[i] !== currSegs[i]) return i === lastItemIdx; // sibling at ancestor level
    }
    return true; // ancestor of current (or current)
  };

  const entries = flat.flatMap((entry, i) => {
    if (!passes(segs[i]) || !hasAllAncestors(segs[i])) return [];
    const itemPath = paths[i];
    const stripped = itemPath.replace(/\/$/, '');
    const active = stripped === here;
    const inPath = !active && here.startsWith(stripped + '/');
    const level = Math.max(1, Math.min(3, depths[i] - minDepth + 1));
    return [{
      block: entry.block,
      blockId: entry.blockId,
      itemPath,
      active,
      classes: [
        'nav-item',
        `level-${level}`,
        active ? 'current' : '',
        inPath ? 'in-path' : '',
      ].filter(Boolean),
    }];
  });

  return { entries, extras };
}

// Re-expanded whenever the block changes (an edit to a navItem or to the
// listing's query): expanding only at setup left the nav showing what it was
// first given until the page reloaded.
const expanded = ref(await expandChildren());
watch(() => props.block, async () => { expanded.value = await expandChildren(); }, { deep: true });
const entries = computed(() => expanded.value.entries);
const extras = computed(() => expanded.value.extras);
</script>
