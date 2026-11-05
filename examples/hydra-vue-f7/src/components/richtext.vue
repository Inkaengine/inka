<template>
  <template v-if="node.type === 'link'"><f7-link :href="node.data.url" external :data-node-id="node.nodeId">{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child" /></f7-link></template>
  <template v-else-if="!node.type"><!-- "\n" is a line break (Shift+Enter in the editor), drawn as <br>; a break at the very end needs a second <br> to show. --><template v-for="(line, i) in node.text.split('\n')" :key="i"><br v-if="i" />{{ line }}</template><br v-if="node.text.endsWith('\n')" /></template>
  <component v-else :is="node.type" :data-node-id="node.nodeId">{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child" /></component>
</template>

<script>
export default {
  name: 'RichText',
  props: {
    node: {
      type: Object,
      required: true,
    },
  },
  computed: {
    subs() {
      const children = this.node.children || [];
      // The editor keeps an indented item's sub-list BESIDE the item it
      // belongs to (ul > li, ul); HTML puts it inside that item. The nodes
      // keep their own data-node-id, so editing reads them back where kept.
      if (this.node.type !== 'ul' && this.node.type !== 'ol') return children;
      const out = [];
      for (const child of children) {
        const prev = out[out.length - 1];
        if ((child.type === 'ul' || child.type === 'ol') && prev?.type === 'li') {
          out[out.length - 1] = { ...prev, children: [...prev.children, child] };
        } else {
          out.push(child);
        }
      }
      return out;
    },
  },
};
</script>
