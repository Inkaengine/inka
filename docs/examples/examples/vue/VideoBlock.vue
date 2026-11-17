<template>
  <div :data-block-uid="block['@uid']" class="video-block">
    <iframe
      v-if="youtubeId"
      :src="`https://www.youtube.com/embed/${youtubeId}`"
      allowfullscreen
      style="width: 100%; aspect-ratio: 16/9; border: none"
    />
    <video v-else-if="url" :src="url" controls style="width: 100%" />
    <p v-else>No video URL set</p>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ block: Object });
// A link field: [{ '@id': url }].
const url = computed(() => props.block.url?.[0]?.['@id'] ?? '');
const youtubeId = computed(() =>
  url.value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?/]+)/)?.[1],
);
</script>
