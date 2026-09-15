<template>
  <component :is="componentFor(block['@type'])" :block="block" :blockId="block['@uid']" :content="content" />
</template>

<script setup>
import { getImageUrl } from './utils.js';
import SlateBlock from './SlateBlock.vue';
import IntroductionBlock from './IntroductionBlock.vue';
import ImageBlock from './ImageBlock.vue';
import HeroBlock from './HeroBlock.vue';
import TeaserBlock from './TeaserBlock.vue';
import TableBlock from './TableBlock.vue';
import ColumnsBlock from './ColumnsBlock.vue';
import GridBlock from './GridBlock.vue';
import AccordionBlock from './AccordionBlock.vue';
import SliderBlock from './SliderBlock.vue';
import ListingBlock from './ListingBlock.vue';
import SearchBlock from './SearchBlock.vue';
import FormBlock from './FormBlock.vue';
import HeadingBlock from './HeadingBlock.vue';
import SeparatorBlock from './SeparatorBlock.vue';
import ButtonBlock from './ButtonBlock.vue';
import HighlightBlock from './HighlightBlock.vue';
import CalloutBlock from './CalloutBlock.vue';
import VideoBlock from './VideoBlock.vue';
import MapsBlock from './MapsBlock.vue';
import TocBlock from './TocBlock.vue';
import CodeExampleBlock from './CodeExampleBlock.vue';
import CookieConsentBlock from './CookieConsentBlock.vue';
import { h } from 'vue';

defineProps({ block: Object, blockId: String, content: Object });

const ListingItemBlock = {
  props: ['block'],
  render() {
    const b = this.block;
    const imgSrc = getImageUrl(b.image);
    return h('div', { 'data-block-uid': b['@uid'], class: 'listing-item' }, [
      imgSrc ? h('img', { src: imgSrc, alt: '', 'data-edit-media': 'image' }) : null,
      b.date ? h('time', { style: 'font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em' }, new Date(b.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })) : null,
      h('h4', null, [h('a', { href: contentPath(b.href), 'data-edit-link': 'href' }, b.title)]),
      b.description ? h('p', { 'data-edit-text': 'description' }, b.description) : null,
    ]);
  },
};

const typeMap = {
  slate: SlateBlock,
  introduction: IntroductionBlock,
  image: ImageBlock,
  hero: HeroBlock,
  teaser: TeaserBlock,
  slateTable: TableBlock,
  columns: ColumnsBlock,
  gridBlock: GridBlock,
  accordion: AccordionBlock,
  slider: SliderBlock,
  listing: ListingBlock,
  search: SearchBlock,
  form: FormBlock,
  heading: HeadingBlock,
  separator: SeparatorBlock,
  button: ButtonBlock,
  highlight: HighlightBlock,
  callout: CalloutBlock,
  video: VideoBlock,
  maps: MapsBlock,
  toc: TocBlock,
  codeExample: CodeExampleBlock,
  cookieConsent: CookieConsentBlock,
  summary: ListingItemBlock,
  default: ListingItemBlock,
};

function componentFor(type) {
  return typeMap[type] || {
    props: ['block'],
    render() {
      return h('div', { 'data-block-uid': this.block['@uid'], 'data-unknown-block-type': type }, '[not implemented]');
    },
  };
}
</script>
