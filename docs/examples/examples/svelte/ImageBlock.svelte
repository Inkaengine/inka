<script>
  import { getImageUrl } from './utils.js';
  export let block;
  $: href = block.href?.[0]?.['@id'] || block.href;
  $: imgSrc = getImageUrl(block.url);
</script>

<!-- No image ⇒ no element. While editing, Inka hands an empty image a
     stand-in to click; a visitor sees nothing. -->
<div data-block-uid={block['@uid']}>
  {#if imgSrc && href}
    <a {href} data-edit-link="href">
      <img data-edit-media="url" src={imgSrc} alt={block.alt} />
    </a>
  {:else if imgSrc}
    <img data-edit-media="url" src={imgSrc} alt={block.alt} />
  {/if}
</div>
