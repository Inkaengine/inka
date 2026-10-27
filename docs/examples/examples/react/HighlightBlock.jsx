const highlightGradients = {
  'highlight-custom-color-1': 'linear-gradient(135deg, #1e3a5f, #2563eb)',
  'highlight-custom-color-2': 'linear-gradient(135deg, #064e3b, #059669)',
  'highlight-custom-color-3': 'linear-gradient(135deg, #581c87, #9333ea)',
  'highlight-custom-color-4': 'linear-gradient(135deg, #78350f, #d97706)',
  'highlight-custom-color-5': 'linear-gradient(135deg, #881337, #e11d48)',
};

import { getImageUrl } from './utils.js';

function HighlightBlock({ block }) {
  const title = block.title || '';
  const description = block.description || [];
  const imageSrc = getImageUrl(block.image);
  const ctaText = block.cta_title || '';
  const ctaLink = block.cta_link?.[0]?.['@id'] || '';
  const gradient = highlightGradients[block.styles?.descriptionColor] || 'linear-gradient(135deg, #334, #556)';
  const bgStyle = imageSrc
    ? { backgroundImage: `url(${imageSrc})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: gradient };

  return (
    <section
      data-block-uid={block['@uid']}
      className="highlight-block"
      style={{ ...bgStyle, padding: '40px 20px', color: 'white', borderRadius: '8px' }}
    >
      <div className="highlight-overlay" data-edit-media="image" style={{ background: 'rgba(0,0,0,0.4)', padding: '30px', borderRadius: '8px' }}>
        <h2 data-edit-text="title">{title}</h2>
        <div className="highlight-body" data-edit-text="description">
          {description.map((node, i) => (
            <SlateNode key={i} node={node} />
          ))}
        </div>
        {ctaText && (
          <a href={ctaLink} data-edit-text="cta_title" data-edit-link="cta_link" className="highlight-cta"
            style={{ display: 'inline-block', padding: '10px 20px', background: '#007eb1', color: 'white', textDecoration: 'none', borderRadius: '4px', marginTop: '16px' }}>
            {ctaText}
          </a>
        )}
      </div>
    </section>
  );
}
