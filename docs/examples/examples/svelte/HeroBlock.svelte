<script>
  import SlateNode from './SlateNode.svelte';
  import { getImageUrl } from './utils.js';
  export let block;

  $: subheadingHtml = (block.subheading || '').replace(/\n/g, '<br>');
  $: buttonLink = block.buttonLink?.[0]?.['@id'] || '';
  $: heroImageSrc = getImageUrl(block.image);
</script>

<!-- Data-driven: render a field only when it has data. No data ⇒ no element, so
     view markup stays clean. Hydra reveals an empty optional field for editing by
     seeding it, which makes these same checks true — no edit-mode branch needed. -->
<div data-block-uid={block['@uid']} class="hero-block">
  {#if block.image}
    <img data-edit-media="image" src={heroImageSrc} alt="Hero image" />
  {/if}
  {#if block.heading}
    <h1 data-edit-text="heading">{block.heading}</h1>
  {/if}
  {#if block.subheading}
    <p data-edit-text="subheading">{@html subheadingHtml}</p>
  {/if}
  {#if block.description}
    <div class="hero-description" data-edit-text="description">
      {#each block.description as node, i (i)}
        <SlateNode {node} />
      {/each}
    </div>
  {/if}
  {#if block.buttonText || block.buttonLink}
    <a data-edit-text="buttonText" data-edit-link="buttonLink" href={buttonLink}>
      {block.buttonText}
    </a>
  {/if}
</div>
