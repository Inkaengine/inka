<script>
  import { getImageUrl } from './utils.js';
  export let block;
  $: url = block.url?.[0]?.['@id'] ?? '';  // a link field: [{ '@id': url }]
  $: youtubeId = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?/]+)/)?.[1];
  // The preview image is what shows before the video plays. Empty means absent.
  $: preview = block.preview_image ? getImageUrl(block.preview_image) : '';
</script>

<div data-block-uid={block['@uid']} class="video-block">
  {#if youtubeId && preview}
    <a href="https://www.youtube.com/watch?v={youtubeId}" data-edit-link="url">
      <img data-edit-media="preview_image" src={preview} alt="Play video" style="width: 100%" />
    </a>
  {:else if youtubeId}
    <iframe
      src="https://www.youtube.com/embed/{youtubeId}"
      allowfullscreen
      style="width: 100%; aspect-ratio: 16/9; border: none"
      title="Video"
    />
  {:else if url}
    <video
      src={url}
      controls
      style="width: 100%"
      poster={preview || undefined}
      data-edit-media={preview ? 'preview_image' : undefined}
    >
      <track kind="captions" />
    </video>
  {:else}
    <p>No video URL set</p>
  {/if}
</div>
