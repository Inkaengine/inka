import { getImageUrl } from './utils.js';

function ImageBlock({ block }) {
  const src = getImageUrl(block.url);
  const alt = block.alt || '';
  const href = block.href?.[0]?.['@id'] || block.href;

  // No image ⇒ no element. While editing, Inka hands an empty image a
  // stand-in to click; a visitor sees nothing.
  if (!src) return <div data-block-uid={block['@uid']} />;
  const img = <img data-edit-media="url" src={src} alt={alt} />;

  return (
    <div data-block-uid={block['@uid']}>
      {href ? (
        <a href={href} data-edit-link="href">{img}</a>
      ) : (
        <>{img}</>
      )}
    </div>
  );
}
