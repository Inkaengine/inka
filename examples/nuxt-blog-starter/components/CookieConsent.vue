<template>
  <!--
    One block drawn in three places, two of them hidden.

    The bar is the block's own element and is always on screen; the `message` is
    read in a BANNER and the `analyticsPurpose` beside a tick box in a
    PREFERENCES DIALOG. Both sit OUTSIDE the block's element — a real frontend
    teleports them to <body>, where a design system's own JavaScript puts them —
    and both are hidden until their trigger is pressed.

    So "is the block visible?" is the wrong question here, and one handle cannot
    serve two halves: each trigger names the FIELD its half holds, and the bridge
    opens the half whose field the author reached for in the sidebar.
  -->
  <div :data-block-uid="block_uid" class="cookie-consent-bar my-4 flex flex-wrap items-center gap-3 rounded border border-gray-200 bg-gray-50 p-3">
    <strong>Cookie consent</strong>
    <button type="button"
      :data-block-selector="`${block_uid}#message`"
      data-linkable-allow
      class="rounded border border-gray-300 px-3 py-1 text-sm"
      @click="showBanner = true">Show the banner</button>
    <button type="button"
      :data-block-selector="`${block_uid}#analyticsPurpose`"
      data-linkable-allow
      class="rounded border border-gray-300 px-3 py-1 text-sm"
      @click="showDialog = true">Show cookie preferences</button>
  </div>

  <!-- Outside the block's element, and annotated where the text is READ. -->
  <!-- Each half advertises the field it holds: it is outside the block's
       element, so without that the wording inside belongs to no block and is
       not editable. The bar's trigger is what the bridge clicks to open it. -->
  <div v-show="showBanner" :data-block-selector="`${block_uid}#message`"
    class="cookie-banner rounded bg-gray-900 p-4 text-white" role="alert">
    <p v-for="(node, i) in message" :key="i" data-edit-text="message" :data-node-id="node.nodeId">
      {{ nodeText(node) }}
    </p>
    <button type="button" class="mt-2 rounded bg-white px-3 py-1 text-sm text-gray-900" @click="showBanner = false">Accept all</button>
  </div>

  <div v-show="showDialog" :data-block-selector="`${block_uid}#analyticsPurpose`"
    class="cookie-dialog rounded border border-gray-300 p-4" role="dialog">
    <h2 class="font-semibold">Manage cookie preferences</h2>
    <label class="mt-2 flex items-center gap-2">
      <input type="checkbox" name="analytics"> Analytics
    </label>
    <p data-edit-text="analyticsPurpose">{{ block.analyticsPurpose }}</p>
    <button type="button" class="mt-2 rounded border px-3 py-1 text-sm" @click="showDialog = false">Save</button>
  </div>
</template>

<script setup>
const props = defineProps({ block: Object, block_uid: String });
const showBanner = ref(false);
const showDialog = ref(false);
const message = computed(() => props.block.message || []);
// Slate is an array of nodes; the banner shows their text. A real frontend
// renders the marks and links too — kept flat here so the pattern stays visible.
const nodeText = (node) =>
  node.text ?? (node.children || []).map((c) => c.text ?? '').join('');
</script>
