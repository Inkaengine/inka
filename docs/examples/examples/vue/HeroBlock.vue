<template>
  <!-- Data-driven: render a field only when it has data. No data ⇒ no element, so
       view markup stays clean. Hydra reveals an empty optional field for editing by
       seeding it, which makes these same checks true — no edit-mode branch needed. -->
  <div :data-block-uid="block['@uid']" class="hero-block">
    <img v-if="block.image" data-edit-media="image" :src="heroImageSrc" alt="Hero image" />
    <h1 v-if="block.heading" data-edit-text="heading">{{ block.heading }}</h1>
    <p v-if="block.subheading" data-edit-text="subheading" v-html="subheadingHtml" />
    <div v-if="block.description" class="hero-description" data-edit-text="description">
      <SlateNode v-for="(node, i) in block.description" :key="i" :node="node" />
    </div>
    <a v-if="block.buttonText || block.buttonLink"
       data-edit-text="buttonText" data-edit-link="buttonLink" :href="buttonLink">
      {{ block.buttonText }}
    </a>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { getImageUrl } from './utils.js';
const props = defineProps({ block: Object });
const subheadingHtml = computed(() => (props.block.subheading || '').replace(/\n/g, '<br>'));
const buttonLink = computed(() => props.block.buttonLink?.[0]?.['@id'] || '');
const heroImageSrc = computed(() => getImageUrl(props.block.image));
</script>
