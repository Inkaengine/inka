<script>
  import { getImageUrl } from './utils.js';
  import SlateBlock from './SlateBlock.svelte';
  import IntroductionBlock from './IntroductionBlock.svelte';
  import ImageBlock from './ImageBlock.svelte';
  import HeroBlock from './HeroBlock.svelte';
  import TeaserBlock from './TeaserBlock.svelte';
  import TableBlock from './TableBlock.svelte';
  import ColumnsBlock from './ColumnsBlock.svelte';
  import GridBlock from './GridBlock.svelte';
  import AccordionBlock from './AccordionBlock.svelte';
  import SliderBlock from './SliderBlock.svelte';
  import ListingBlock from './ListingBlock.svelte';
  import SearchBlock from './SearchBlock.svelte';
  import FormBlock from './FormBlock.svelte';
  import HeadingBlock from './HeadingBlock.svelte';
  import SeparatorBlock from './SeparatorBlock.svelte';
  import ButtonBlock from './ButtonBlock.svelte';
  import HighlightBlock from './HighlightBlock.svelte';
  import CalloutBlock from './CalloutBlock.svelte';
  import VideoBlock from './VideoBlock.svelte';
  import MapsBlock from './MapsBlock.svelte';
  import TocBlock from './TocBlock.svelte';
  import CodeExampleBlock from './CodeExampleBlock.svelte';
  import CookieConsentBlock from './CookieConsentBlock.svelte';

  export let block;
  export let content = {};
</script>

{#if block['@type'] === 'slate'}
  <SlateBlock {block} />
{:else if block['@type'] === 'introduction'}
  <IntroductionBlock {block} {content} />
{:else if block['@type'] === 'image'}
  <ImageBlock {block} />
{:else if block['@type'] === 'hero'}
  <HeroBlock {block} />
{:else if block['@type'] === 'teaser'}
  <TeaserBlock {block} />
{:else if block['@type'] === 'slateTable'}
  <TableBlock {block} />
{:else if block['@type'] === 'columns'}
  <ColumnsBlock {block} />
{:else if block['@type'] === 'gridBlock'}
  <GridBlock {block} />
{:else if block['@type'] === 'accordion'}
  <AccordionBlock {block} />
{:else if block['@type'] === 'slider'}
  <SliderBlock {block} />
{:else if block['@type'] === 'listing'}
  <ListingBlock {block} blockId={block['@uid']} />
{:else if block['@type'] === 'search'}
  <SearchBlock {block} blockId={block['@uid']} />
{:else if block['@type'] === 'form'}
  <FormBlock {block} />
{:else if block['@type'] === 'heading'}
  <HeadingBlock {block} />
{:else if block['@type'] === 'separator'}
  <SeparatorBlock {block} />
{:else if block['@type'] === 'button'}
  <ButtonBlock {block} />
{:else if block['@type'] === 'highlight'}
  <HighlightBlock {block} />
{:else if block['@type'] === 'callout'}
  <CalloutBlock {block} />
{:else if block['@type'] === 'video'}
  <VideoBlock {block} />
{:else if block['@type'] === 'maps'}
  <MapsBlock {block} />
{:else if block['@type'] === 'toc'}
  <TocBlock {block} {content} />
{:else if block['@type'] === 'cookieConsent'}
  <CookieConsentBlock {block} />
{:else if block['@type'] === 'codeExample'}
  <CodeExampleBlock {block} />
{:else if block['@type'] === 'summary' || block['@type'] === 'default'}
  <div data-block-uid={block['@uid']} class="listing-item">
    {#if block.image}
      {#if getImageUrl(block.image)}<img data-edit-media="image" src={getImageUrl(block.image)} alt="" />{/if}
    {/if}
    {#if block.date}<time style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">{new Date(block.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>{/if}
    <h4><a href={contentPath(block.href)} data-edit-link="href">{block.title}</a></h4>
    {#if block.description}<p data-edit-text="description">{block.description}</p>{/if}
  </div>
{:else}
  <div data-block-uid={block['@uid']} data-unknown-block-type={block['@type']}>[not implemented]</div>
{/if}
