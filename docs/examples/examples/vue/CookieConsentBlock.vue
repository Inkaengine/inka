<template>
  <!--
    A block drawn in three places, two of them hidden.

    The block's own element is the bar; its `message` is read in a BANNER at the
    foot of the page and its `analyticsPurpose` beside a tick box in a
    PREFERENCES DIALOG. Both sit OUTSIDE the block's element — a real frontend
    usually teleports them to <body>, where a design system's own JavaScript
    puts them — and both are hidden until their trigger is pressed. So "is the block visible?" is the wrong question, and each trigger
    names the FIELD its half holds instead.
  -->
  <div class="cookie-consent">
    <div :data-block-uid="block['@uid']" class="cookie-consent__bar">
      <strong>Cookie consent</strong>
      <!-- "I reveal where `message` is edited": focusing Banner message in the
           sidebar makes the bridge click this, so the banner is on screen while
           its wording is written. -->
      <button type="button"
        :data-block-selector="`${block['@uid']}#message`"
        @click="showBanner = true">Show the banner</button>
      <!-- The other half. One handle is one click, so a block-level handle
           could only ever open one of the two. -->
      <button type="button"
        :data-block-selector="`${block['@uid']}#analyticsPurpose`"
        @click="showDialog = true">Show cookie preferences</button>
    </div>

    <!-- Both halves live outside this block's DOM, so their editable text is
         annotated where it is READ. A real frontend often teleports these to
         <body>, where a design system's own JavaScript puts them; sibling
         elements are the same thing as far as the bridge is concerned — outside
         the block's element, and hidden. -->
      <div class="cookie-banner" :data-block-selector="`${block['@uid']}#message`"
        :hidden="!showBanner" role="alert">
        <p data-edit-text="message">{{ slateToText(block.message) }}</p>
        <button type="button" @click="showBanner = false">Accept all</button>
        <button type="button" @click="showDialog = true">Manage preferences</button>
      </div>
      <div class="cookie-dialog" :data-block-selector="`${block['@uid']}#analyticsPurpose`"
        :hidden="!showDialog" role="dialog">
        <h2>Manage cookie preferences</h2>
        <label><input type="checkbox" name="analytics" /> Analytics</label>
        <p data-edit-text="analyticsPurpose">{{ block.analyticsPurpose }}</p>
        <button type="button" @click="showDialog = false">Save</button>
      </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const props = defineProps({ block: Object });
const showBanner = ref(true);
const showDialog = ref(false);

// Slate is an array of nodes; the banner shows its text. A real frontend would
// render the marks and links too — kept flat here so the pattern stays visible.
function slateToText(value) {
  if (!Array.isArray(value)) return '';
  return value
    .map((node) => node.text ?? (node.children || []).map((c) => c.text ?? '').join(''))
    .join('');
}
</script>
