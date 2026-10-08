<template>
  <div :data-block-uid="block['@uid']">
    <!-- No image ⇒ no element. While editing, Inka hands an empty image a
         stand-in to click; a visitor sees nothing. -->
    <template v-if="imgSrc">
      <a v-if="href" :href="href" data-edit-link="href">
        <img data-edit-media="url" :src="imgSrc" :alt="block.alt" />
      </a>
      <img v-else data-edit-media="url" :src="imgSrc" :alt="block.alt" />
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { getImageUrl } from './utils.js';
const props = defineProps({ block: Object });
const href = computed(() => props.block.href?.[0]?.['@id'] || props.block.href);
const imgSrc = computed(() => getImageUrl(props.block.url));
</script>
