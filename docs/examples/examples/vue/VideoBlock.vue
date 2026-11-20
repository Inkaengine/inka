<template>
  <div :data-block-uid="block['@uid']" class="video-block">
    <a v-if="youtubeId && preview" :href="`https://www.youtube.com/watch?v=${youtubeId}`">
      <img data-edit-media="preview_image" :src="preview" alt="Play video" style="width: 100%" />
    </a>
    <iframe
      v-else-if="youtubeId"
      :src="`https://www.youtube.com/embed/${youtubeId}`"
      allowfullscreen
      style="width: 100%; aspect-ratio: 16/9; border: none"
    />
    <video
      v-else-if="url"
      :src="url"
      controls
      style="width: 100%"
      :poster="preview || undefined"
      :data-edit-media="preview ? 'preview_image' : undefined"
    />
    <p v-else>No video URL set</p>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { getImageUrl } from './utils.js';
const props = defineProps({ block: Object });
// A link field: [{ '@id': url }].
const url = computed(() => props.block.url?.[0]?.['@id'] ?? '');
const youtubeId = computed(() =>
  url.value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?/]+)/)?.[1],
);
// The preview image is what shows before the video plays. Empty means absent.
const preview = computed(() =>
  props.block.preview_image ? getImageUrl(props.block.preview_image) : '',
);
</script>
