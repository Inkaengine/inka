<script>
  export let block;
  $: url = block.url?.[0]?.['@id'] ?? '';  // a link field: [{ '@id': url }]
  $: youtubeId = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?/]+)/)?.[1];
</script>

<div data-block-uid={block['@uid']} class="video-block">
  {#if youtubeId}
    <iframe
      src="https://www.youtube.com/embed/{youtubeId}"
      allowfullscreen
      style="width: 100%; aspect-ratio: 16/9; border: none"
      title="Video"
    />
  {:else if url}
    <video src={url} controls style="width: 100%">
      <track kind="captions" />
    </video>
  {:else}
    <p>No video URL set</p>
  {/if}
</div>
