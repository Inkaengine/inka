import { getImageUrl } from './utils.js';

function BlockRenderer({ block, content }) {
  const type = block['@type'];
  switch (type) {
    case 'slate':         return <SlateBlock block={block} />;
    case 'title':         return <TitleBlock block={block} content={content} />;
    case 'description':   return <DescriptionBlock block={block} content={content} />;
    case 'introduction':  return <IntroductionBlock block={block} content={content} />;
    case 'image':         return <ImageBlock block={block} />;
    case 'leadimage':     return <LeadImageBlock block={block} content={content} />;
    case 'dateField':     return <DateFieldBlock block={block} content={content} />;
    case 'hero':          return <HeroBlock block={block} />;
    case 'teaser':        return <TeaserBlock block={block} />;
    case 'slateTable':    return <TableBlock block={block} />;
    case 'columns':       return <ColumnsBlock block={block} />;
    case 'gridBlock':     return <GridBlock block={block} />;
    case 'accordion':     return <AccordionBlock block={block} />;
    case 'slider':        return <SliderBlock block={block} />;
    case 'listing':       return <ListingBlock block={block} blockId={block['@uid']} />;
    case 'search':        return <SearchBlock block={block} blockId={block['@uid']} />;
    case 'form':          return <FormBlock block={block} />;
    case 'heading':       return <HeadingBlock block={block} />;
    case 'separator':     return <SeparatorBlock block={block} />;
    case 'button':      return <ButtonBlock block={block} />;
    case 'highlight':     return <HighlightBlock block={block} />;
    case 'callout':       return <CalloutBlock block={block} />;
    case 'video':         return <VideoBlock block={block} />;
    case 'maps':          return <MapsBlock block={block} />;
    case 'toc':           return <TocBlock block={block} content={content} />;
    case 'codeExample':   return <CodeExampleBlock block={block} />;
    case 'cookieConsent': return <CookieConsentBlock block={block} />;
    case 'empty':         return <EmptyBlock block={block} />;
    case 'eventMetadata': return <EventMetadataBlock block={block} content={content} />;
    case 'socialLinks':   return <SocialLinksBlock block={block} />;
    case 'summary':
    case 'default':
      return (
        <div data-block-uid={block['@uid']} className="listing-item">
          {getImageUrl(block.image) && <img data-edit-media="image" src={getImageUrl(block.image)} alt="" />}
          {block.date && <time style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{new Date(block.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>}
          <h4><a href={contentPath(block.href)} data-edit-link="href">{block.title}</a></h4>
          {block.description && <p data-edit-text="description">{block.description}</p>}
        </div>
      );
    default:              return <div data-block-uid={block['@uid']} data-unknown-block-type={type}>[not implemented]</div>;
  }
}
