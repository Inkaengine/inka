<template>
  <template v-if="!node.type"><!-- "\n" is a line break (Shift+Enter in the editor), drawn as <br>; a break at the very end needs a second <br> to show. --><template v-for="(line, i) in node.text.split('\n')" :key="i"><br v-if="i" />{{ line }}</template><br v-if="node.text.endsWith('\n')" /></template>
  <a v-else-if="node.type === 'link'" :href="node.data?.url" :data-node-id="node.nodeId">
    <SlateNode v-for="(c, i) in node.children" :key="i" :node="c" />
  </a>
  <component v-else :is="node.type" :data-node-id="node.nodeId">
    <SlateNode v-for="(c, i) in node.children" :key="i" :node="c" />
  </component>
</template>

<script setup>
defineProps({ node: Object });
</script>
