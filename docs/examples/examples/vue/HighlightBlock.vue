<template>
  <section
    :data-block-uid="block['@uid']"
    class="highlight-block"
    :style="{ ...bgStyle, padding: '40px 20px', color: 'white', borderRadius: '8px' }"
  >
    <div class="highlight-overlay" data-edit-media="image" style="background:rgba(0,0,0,0.4);padding:30px;border-radius:8px">
      <h2 data-edit-text="title">{{ block.title }}</h2>
      <div class="highlight-body" data-edit-text="description">
        <SlateNode v-for="(node, i) in block.description || []" :key="i" :node="node" />
      </div>
      <a
        v-if="block.cta_title"
        :href="ctaLink"
        data-edit-text="cta_title"
        data-edit-link="cta_link"
        class="highlight-cta"
        style="display:inline-block;padding:10px 20px;background:#007eb1;color:white;text-decoration:none;border-radius:4px;margin-top:16px"
      >
        {{ block.cta_title }}
      </a>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ block: Object });
const ctaLink = computed(() => props.block.cta_link?.[0]?.['@id'] || '');

const gradients = {
  'highlight-custom-color-1': 'linear-gradient(135deg, #1e3a5f, #2563eb)',
  'highlight-custom-color-2': 'linear-gradient(135deg, #064e3b, #059669)',
  'highlight-custom-color-3': 'linear-gradient(135deg, #581c87, #9333ea)',
  'highlight-custom-color-4': 'linear-gradient(135deg, #78350f, #d97706)',
  'highlight-custom-color-5': 'linear-gradient(135deg, #881337, #e11d48)',
};
const bgStyle = computed(() => {
  if (props.block.image) {
    return { backgroundImage: `url(${props.block.image})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  const gradient = gradients[props.block.styles?.descriptionColor] || 'linear-gradient(135deg, #334, #556)';
  return { background: gradient };
});
</script>
