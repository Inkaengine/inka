<script>
  export let node;
</script>

{#if node.text !== undefined}
  <!-- "\n" is a line break (Shift+Enter in the editor), drawn as <br>; a break at the very end needs a second <br> to show. -->
  {#each node.text.split('\n') as line, i}{#if i}<br />{/if}{line}{/each}{#if node.text.endsWith('\n')}<br />{/if}
{:else if node.type === 'link'}
  <a href={node.data?.url} data-node-id={node.nodeId}>{#each node.children || [] as c, i (i)}<svelte:self node={c} />{/each}</a>
{:else}
  <svelte:element this={node.type} data-node-id={node.nodeId}>{#each node.children || [] as c, i (i)}<svelte:self node={c} />{/each}</svelte:element>
{/if}
