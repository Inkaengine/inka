<script>
  export let node;

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

  $: kids = node.type && isList(node) ? nestSubLists(node.children || []) : node.children || [];
</script>

{#if node.text !== undefined}
  <!-- "\n" is a line break (Shift+Enter in the editor), drawn as <br>; a break at the very end needs a second <br> to show. -->
  {#each node.text.split('\n') as line, i}{#if i}<br />{/if}{line}{/each}{#if node.text.endsWith('\n')}<br />{/if}
{:else if node.type === 'link'}
  <a href={node.data?.url} data-node-id={node.nodeId}>{#each node.children || [] as c, i (i)}<svelte:self node={c} />{/each}</a>
{:else}
  <svelte:element this={node.type} data-node-id={node.nodeId}>{#each kids as c, i (i)}<svelte:self node={c} />{/each}</svelte:element>
{/if}
