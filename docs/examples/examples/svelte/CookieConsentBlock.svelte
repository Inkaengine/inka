<script>
  // A block drawn in three places, two of them hidden. The bar is the block's
  // own element; `message` is read in a banner at the foot of the page and
  // `analyticsPurpose` beside a tick box in a preferences dialog, both hidden
  // until their trigger is pressed. Each trigger names the FIELD its half holds,
  // because one block-level handle is one click and could open only one of them.
  export let block;

  let showBanner = true;
  let showDialog = false;

  // Slate is an array of nodes; the banner shows its text.
  function slateToText(value) {
    if (!Array.isArray(value)) return '';
    return value
      .map((node) => node.text ?? (node.children || []).map((c) => c.text ?? '').join(''))
      .join('');
  }
</script>

<div data-block-uid={block['@uid']} class="cookie-consent">
  <div class="cookie-consent__bar">
    <strong>Cookie consent</strong>
    <button type="button"
      data-block-selector={`${block['@uid']}#message`}
      on:click={() => (showBanner = true)}>Show the banner</button>
    <button type="button"
      data-block-selector={`${block['@uid']}#analyticsPurpose`}
      on:click={() => (showDialog = true)}>Show cookie preferences</button>
  </div>
</div>

<!-- Svelte renders these where they are written; a real frontend would portal
     them to <body>, as the React and Vue examples do. What matters for the
     pattern is that they are OUTSIDE the block's element and hidden. -->
<div class="cookie-banner" data-block-selector={`${block['@uid']}#message`}
  hidden={!showBanner} role="alert">
  <p data-edit-text="message">{slateToText(block.message)}</p>
  <button type="button" on:click={() => (showBanner = false)}>Accept all</button>
  <button type="button" on:click={() => (showDialog = true)}>Manage preferences</button>
</div>

<div class="cookie-dialog" data-block-selector={`${block['@uid']}#analyticsPurpose`}
  hidden={!showDialog} role="dialog">
  <h2>Manage cookie preferences</h2>
  <label><input type="checkbox" name="analytics" /> Analytics</label>
  <p data-edit-text="analyticsPurpose">{block.analyticsPurpose}</p>
  <button type="button" on:click={() => (showDialog = false)}>Save</button>
</div>
