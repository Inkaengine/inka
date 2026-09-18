<!-- pages/[...slug].vue -->
<template>
  <div v-for="id in page?.blocks_layout?.items" :key="id"
       :data-block-uid="editing ? id : undefined">
    <!-- The card block is rendered editable; anything else is shown as raw JSON. -->
    <a v-if="page.blocks[id]['@type'] === 'card'"
       :href="page.blocks[id].link"
       :data-edit-link="editing ? 'link' : undefined">
      <!-- data-edit-media: click to pick/upload image · data-edit-text: edit text in place -->
      <img :src="page.blocks[id].image" :data-edit-media="editing ? 'image' : undefined" />
      <h3 :data-edit-text="editing ? 'title' : undefined">{{ page.blocks[id].title }}</h3>
      <p :data-edit-text="editing ? 'description' : undefined">{{ page.blocks[id].description }}</p>
    </a>
    <pre v-else>{{ JSON.stringify(page.blocks[id], null, 2) }}</pre>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { initBridge } from '@hydra-js/hydra.js'

const page = ref(null)
const editing = ref(false)

onMounted(async () => {
  // Only init the bridge when loaded inside the editor.
  if (window.name.startsWith('hydra')) {
    editing.value = true
    initBridge({
      // Declare the one block type we render richly.
      blocks: { card: { blockSchema: { properties: {
        image: { widget: 'image' },
        title: { type: 'string' },
        description: { type: 'string' },
        link: { widget: 'url' },
      } } } },
      // Re-render on every edit.
      onEditChange: (data) => { page.value = data },
    })
  } else {
    // On the live site: fetch this page and render once.
    page.value = await (await fetch(`/++api++${useRoute().path}`)).json()
  }
})
</script>
