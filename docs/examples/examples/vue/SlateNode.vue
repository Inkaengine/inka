<template>
  <template v-if="!node.type"><!-- "\n" is a line break (Shift+Enter in the editor), drawn as <br>; a break at the very end needs a second <br> to show. --><template v-for="(line, i) in node.text.split('\n')" :key="i"><br v-if="i" />{{ line }}</template><br v-if="node.text.endsWith('\n')" /></template>
  <a v-else-if="node.type === 'link'" :href="node.data?.url" :data-node-id="node.nodeId">
    <SlateNode v-for="(c, i) in node.children" :key="i" :node="c" />
  </a>
  <component v-else :is="node.type" :data-node-id="node.nodeId">
    <SlateNode v-for="(c, i) in kids" :key="i" :node="c" />
  </component>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ node: Object });

const isList = (n) => n.type === 'ul' || n.type === 'ol';

// The editor keeps an indented item's sub-list BESIDE the item it belongs to
// (ul > li, ul); HTML puts it inside that item (ul > li > ul). The nodes keep
// their own data-node-id, so editing reads them back where they are kept.
function nestSubLists(children) {
  const out = [];
  for (const child of children) {
    const prev = out[out.length - 1];
    if (isList(child) && prev?.type === 'li') {
      out[out.length - 1] = { ...prev, children: [...prev.children, child] };
    } else {
      out.push(child);
    }
  }
  return out;
}

const kids = computed(() =>
  isList(props.node) ? nestSubLists(props.node.children || []) : props.node.children || [],
);
</script>
