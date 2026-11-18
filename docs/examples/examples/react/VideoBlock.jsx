function VideoBlock({ block }) {
  const url = block.url?.[0]?.['@id'] ?? '';  // a link field: [{ '@id': url }]
  const youtubeId = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?/]+)/)?.[1];

  return (
    <div data-block-uid={block['@uid']} className="video-block">
      {youtubeId ? (
        <iframe
          src={`https://www.youtube.com/embed/${youtubeId}`}
          allowFullScreen
          style={{ width: '100%', aspectRatio: '16/9', border: 'none' }}
        />
      ) : url ? (
        <video src={url} controls style={{ width: '100%' }} />
      ) : (
        <p>No video URL set</p>
      )}
    </div>
  );
}
