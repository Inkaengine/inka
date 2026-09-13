<template>
  <template v-if="node.type === 'link'"
    ><NuxtLink :to="getUrl(node.data)" class="underline" external :data-node-id="node.nodeId"
      >{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child"
    /></NuxtLink>
  </template>
  <ul v-else-if="node.type === 'ul'" class="list-disc list-inside mx-4" :data-node-id="node.nodeId"
    >{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child"
  /></ul>
  <ol v-else-if="node.type === 'ol'" class="list-decimal list-inside mx-4" :data-node-id="node.nodeId"
    >{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child"
  /></ol>
  <template v-else-if="!node.type">{{ node.text }}</template>
  <blockquote v-else-if="node.type === 'blockquote'"
    class="border-l-4 border-gray-300 pl-4 py-2 my-4 italic text-gray-600"
    :data-node-id="node.nodeId"
    >{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child"
  /></blockquote>
  <component v-else :is="node.type" :data-node-id="node.nodeId"
    :id="anchorId"
    :data-linkable-id="anchorName"
    :style="node.textAlign ? { textAlign: node.textAlign } : undefined"
    >{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child"
  /></component>
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
      const { children } = this.node;
      return (children && children) || [];
    },
    // This frontend tags every heading as a deep-link anchor (a frontend
    // choice). Explicit node.data.anchorId wins; otherwise a heading's id/label
    // are derived from its text. Non-headings without an explicit id get none.
    isHeading() {
      return /^h[1-6]$/.test(this.node.type || '');
    },
    headingText() {
      const collect = (n) =>
        n == null
          ? ''
          : typeof n.text === 'string'
            ? n.text
            : (n.children || []).map(collect).join('');
      return collect(this.node).trim();
    },
    isAnchor() {
      return this.isHeading || !!(this.node.data && this.node.data.anchorId);
    },
    anchorId() {
      const explicit = this.node.data && this.node.data.anchorId;
      if (explicit) return explicit;
      return this.isHeading && this.headingText
        ? this.slugify(this.headingText)
        : undefined;
    },
    anchorName() {
      // Defined (even '') for every anchor element so data-linkable-id is always
      // emitted — the tag-driven refresh needs the tag present on empty headings.
      if (!this.isAnchor) return undefined;
      const explicit = this.node.data && this.node.data.anchorName;
      return explicit || this.headingText || '';
    },
  },
  methods: {
    slugify(s) {
      return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    },
  },
};
</script>
