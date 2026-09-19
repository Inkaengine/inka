<!-- src/routes/[...slug]/+page.svelte -->
<script>
  import { onMount } from 'svelte'
  import { initBridge } from '@hydra-js/hydra.js'

  let page = $state(null)
  let editing = $state(false)

  onMount(async () => {
    // Only init the bridge when loaded inside the editor.
    if (window.name.startsWith('hydra')) {
      editing = true
      initBridge({
        // Declare the one block type we render richly.
        blocks: { card: { blockSchema: { properties: {
          image: { widget: 'image' },
          title: { type: 'string' },
          description: { type: 'string' },
          link: { widget: 'url' },
        } } } },
        // Re-render on every edit.
        onEditChange: (data) => { page = data },
      })
    } else {
      // On the live site: fetch this page and render once.
      const res = await fetch(`/++api++${window.location.pathname}`)
      page = await res.json()
    }
  })
</script>

{#if page}
  {#each page.blocks_layout?.items ?? [] as id}
    {#if page.blocks[id]['@type'] === 'card'}
      <!-- The card block is rendered editable. -->
      <div data-block-uid={editing ? id : undefined}>
        <a href={page.blocks[id].link} data-edit-link={editing ? 'link' : undefined}>
          <img src={page.blocks[id].image} data-edit-media={editing ? 'image' : undefined} />
          <h3 data-edit-text={editing ? 'title' : undefined}>{page.blocks[id].title}</h3>
          <p data-edit-text={editing ? 'description' : undefined}>{page.blocks[id].description}</p>
        </a>
      </div>
    {:else}
      <!-- Everything else is shown as raw JSON. -->
      <pre data-block-uid={editing ? id : undefined}>{JSON.stringify(page.blocks[id], null, 2)}</pre>
    {/if}
  {/each}
{/if}
