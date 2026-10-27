/**
 * Advice a frontend writes for authors — a block's `description`, a rule's
 * `warning` — is one string, and may link to where it comes from with a
 * markdown link, `[text](url)`. Nothing else in it is markup: the rest is
 * drawn as text (React escapes it), and only http(s), mailto and relative URLs
 * become links.
 */
import React from 'react';

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const SAFE_URL = /^(https?:|mailto:|\/|#|\.)/i;

/** The text with each link drawn as a link, opened beside the editor. */
export const LinkedText = ({ text }) => {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const [whole, label, url] = m;
    if (!SAFE_URL.test(url)) continue;
    parts.push(text.slice(last, m.index));
    parts.push(
      <a key={m.index} href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>,
    );
    last = m.index + whole.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
};

/** The text with each link reduced to its words — for a tooltip, which cannot hold a link. */
export const unlinkedText = (text) => text?.replace(LINK, '$1');
