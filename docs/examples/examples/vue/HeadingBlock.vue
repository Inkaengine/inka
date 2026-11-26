<template>
  <component :is="block.tag" :data-block-uid="block['@uid']" data-edit-text="heading">
    {{ block.heading }}
  </component>
</template>

<script setup>
defineProps({ block: Object });
</script>
