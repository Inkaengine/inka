function MapsBlock({ block }) {
  const url = block.url?.[0]?.['@id'] ?? '';  // a link field: [{ '@id': url }]

  return (
    <div data-block-uid={block['@uid']} className="maps-block">
      {url ? (
        <iframe
          src={url}
          title={block.title || 'Map'}
          allowFullScreen
          loading="lazy"
          style={{ width: '100%', height: '450px', border: 'none' }}
        />
      ) : (
        <p>No map URL set</p>
      )}
    </div>
  );
}
