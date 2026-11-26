<template>
  <div :data-block-uid="block['@uid']" class="maps-block">
    <iframe
      v-if="block.url?.[0]?.['@id']"
      :src="block.url?.[0]?.['@id']"
      :title="block.title || 'Map'"
      allowfullscreen
      loading="lazy"
      style="width: 100%; height: 450px; border: none"
    />
    <p v-else>No map URL set</p>
  </div>
</template>

<script setup>
defineProps({ block: Object });
</script>
