import { getImageUrl } from './utils.js';

function HeroBlock({ block }) {
  const subheading = (block.subheading || '').replace(/\n/g, '<br>');
  const buttonLink = block.buttonLink?.[0]?.['@id'] || '';
  const imageSrc = getImageUrl(block.image);

  // Data-driven: render a field only when it has data. No data ⇒ no element, so
  // view markup stays clean. Hydra reveals an empty optional field for editing by
  // seeding it, which makes these same checks true — no edit-mode branch needed.
  return (
    <div data-block-uid={block['@uid']} className="hero-block">
      {imageSrc && (
        <img data-edit-media="image" src={imageSrc} alt="Hero image" />
      )}
      {block.heading && <h1 data-edit-text="heading">{block.heading}</h1>}
      {block.subheading && (
        <p data-edit-text="subheading" dangerouslySetInnerHTML={{ __html: subheading }} />
      )}
      {block.description && (
        <div className="hero-description" data-edit-text="description">
          {block.description.map((node, i) => (
            <SlateNode key={i} node={node} />
          ))}
        </div>
      )}
      {(block.buttonText || block.buttonLink) && (
        <a data-edit-text="buttonText" data-edit-link="buttonLink" href={buttonLink}>
          {block.buttonText}
        </a>
      )}
    </div>
  );
}
