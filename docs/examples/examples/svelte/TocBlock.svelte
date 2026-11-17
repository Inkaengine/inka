<script>
  export let block;
  export let content = {};

  $: entries = (() => {
    const result = [];
    if (!content?.blocks || !content?.blocks_layout?.items) return result;
    for (const id of content.blocks_layout.items) {
      const b = content.blocks[id];
      if (!b) continue;
      if (b['@type'] === 'heading' && b.heading) {
        result.push({ id, level: parseInt((b.tag || 'h2').slice(1)), text: b.heading });
      } else if (b['@type'] === 'slate' && b.value?.[0]?.type?.match(/^h[1-6]$/)) {
        const level = parseInt(b.value[0].type.slice(1));
        // The heading's own words: inline ones (bold, a link) hold theirs in children.
        const words = (nodes) => nodes.map((n) => (typeof n.text === 'string' ? n.text : words(n.children))).join('');
        const text = words(b.value[0].children);
        if (text.trim()) result.push({ id, level, text });
      }
    }
    return result;
  })();
</script>

<nav data-block-uid={block['@uid']} class="toc-block">
  {#if entries.length > 0}
    <ul>
      {#each entries as e (e.id)}
        <li style="margin-left: {(e.level - 2) * 1.5}em">
          <a href="#{e.id}">{e.text}</a>
        </li>
      {/each}
    </ul>
  {:else}
    <p>Table of Contents</p>
  {/if}
</nav>
