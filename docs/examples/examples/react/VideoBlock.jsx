import { getImageUrl } from './utils.js';

function VideoBlock({ block }) {
  const url = block.url?.[0]?.['@id'] ?? '';  // a link field: [{ '@id': url }]
  const youtubeId = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?/]+)/)?.[1];
  // The preview image is what shows before the video plays. Empty means absent.
  const preview = block.preview_image ? getImageUrl(block.preview_image) : '';

  return (
    <div data-block-uid={block['@uid']} className="video-block">
      {youtubeId && preview ? (
        <a href={`https://www.youtube.com/watch?v=${youtubeId}`}>
          <img data-edit-media="preview_image" src={preview} alt="Play video" style={{ width: '100%' }} />
        </a>
      ) : youtubeId ? (
        <iframe
          src={`https://www.youtube.com/embed/${youtubeId}`}
          allowFullScreen
          style={{ width: '100%', aspectRatio: '16/9', border: 'none' }}
        />
      ) : url ? (
        <video
          src={url}
          controls
          style={{ width: '100%' }}
          {...(preview ? { poster: preview, 'data-edit-media': 'preview_image' } : {})}
        />
      ) : (
        <p>No video URL set</p>
      )}
    </div>
  );
}
