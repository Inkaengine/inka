<template>
  <aside
    :data-block-uid="block['@uid']"
    :class="`callout callout--${block.variation || 'note'}`"
    :style="{ borderLeft: `4px solid ${level.color}`, background: level.bg, padding: '12px 16px', borderRadius: '4px', margin: '1em 0' }"
  >
    <div
      class="callout__label"
      :style="{ fontWeight: 700, color: level.color, textTransform: 'uppercase', fontSize: '0.8em', letterSpacing: '0.05em', marginBottom: '4px' }"
    >
      {{ level.label }}
    </div>
    <div class="callout__body">
      <BlockRenderer v-for="id in items" :key="id" :block="{ ...block.blocks?.[id], '@uid': id }" />
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue';
import BlockRenderer from './BlockRenderer.vue';
const props = defineProps({ block: Object });

const calloutLevels = {
  note:      { label: 'Note',      color: '#2563eb', bg: '#eff6ff' },
  tip:       { label: 'Tip',       color: '#059669', bg: '#ecfdf5' },
  warning:   { label: 'Warning',   color: '#d97706', bg: '#fffbeb' },
  important: { label: 'Important', color: '#dc2626', bg: '#fef2f2' },
};
const level = computed(() => calloutLevels[props.block.variation] || calloutLevels.note);
const items = computed(() => props.block.blocks_layout?.items || []);
</script>
