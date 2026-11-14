<template>
  <template v-if="node.type === 'link'"
    ><NuxtLink :to="getUrl(node.data)" class="underline" external :data-node-id="node.nodeId"
      >{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child"
    /></NuxtLink>
  </template>
  <ul v-else-if="node.type === 'ul'" class="list-disc list-inside mx-4" :class="node.styleName" :data-node-id="node.nodeId"
    >{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child"
  /></ul>
  <ol v-else-if="node.type === 'ol'" class="list-decimal list-inside mx-4" :class="node.styleName" :data-node-id="node.nodeId"
    >{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child"
  /></ol>
  <!-- An inline style is a leaf mark (`style-<cssClass>`), so a styled leaf needs an element to carry the class; a plain leaf stays bare text. -->
  <span v-else-if="!node.type && leafClass" :class="leafClass"><template v-for="(line, i) in lines" :key="i"><br v-if="i" />{{ line }}</template><br v-if="trailingBreak" /></span>
  <template v-else-if="!node.type"><!-- "\n" is a line break (Shift+Enter in the editor), drawn as <br>; a break at the very end needs a second <br> to show. --><template v-for="(line, i) in lines" :key="i"><br v-if="i" />{{ line }}</template><br v-if="trailingBreak" /></template>
  <blockquote v-else-if="node.type === 'blockquote'"
    class="border-l-4 border-gray-300 pl-4 py-2 my-4 italic text-gray-600"
    :class="node.styleName"
    :data-node-id="node.nodeId"
    >{{ node.text }}<RichText v-for="child in subs" :key="child.nodeId" :node="child"
  /></blockquote>
  <component v-else :is="node.type" :data-node-id="node.nodeId"
    :class="node.styleName"
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
    // The style menu stores a block style as `styleName` on the element and an
    // inline style as a `style-<cssClass>` mark on the leaf; both become classes.
    leafClass() {
      const classes = Object.keys(this.node)
        .filter((key) => key.startsWith('style-') && this.node[key])
        .map((key) => key.slice('style-'.length));
      return classes.length ? classes.join(' ') : null;
    },
    lines() {
      return this.node.text.split('\n');
    },
    trailingBreak() {
      return this.node.text.endsWith('\n');
    },
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
