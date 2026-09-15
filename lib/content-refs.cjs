/**
 * Shared reference-classification for content validation, used by the one
 * content validator (plone-content-validator.cjs), which validates both the JSON
 * data.json tree and the markdown-decoded tree -- they are the same content
 * shape. Mirrors pretagov-site/validate-content.py's link logic.
 */
'use strict';

// Fields that hold a reference to other content.
const LINK_FIELDS = ['url', 'href', 'image', 'preview_image', 'preview_image_link', 'backgroundImage'];

/** Every reference string in a field value, in any shape: "…", [{@id}], {@id}. */
function refStrings(val) {
  const out = [];
  const pushId = (o) => { if (o && typeof o === 'object' && typeof o['@id'] === 'string') out.push(o['@id']); };
  if (typeof val === 'string') out.push(val);
  else if (Array.isArray(val)) val.forEach(pushId);
  else if (val && typeof val === 'object') pushId(val);
  return out.filter((s) => s !== '');
}

/**
 * Classify a reference. Returns null when verified/recognized, or a reason string
 * when it is a failure. Nothing is silently accepted -- an unrecognized form
 * fails loudly. `hasUid(uid)` / `hasPath(path)` answer existence against the tree.
 */
function refFailure(ref, { hasUid, hasPath }) {
  const ru = ref.match(/resolveuid\/([a-f0-9]{10,})/);
  if (ru) return hasUid(ru[1]) ? null : `broken resolveuid/${ru[1]}`;
  if (/^https?:\/\//.test(ref)) return null;             // external — unverifiable offline
  if (/^(mailto:|tel:|data:)/.test(ref)) return null;    // known schemes
  if (ref.startsWith('#')) return null;                  // in-page anchor
  if (/\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(ref)) return null; // frontend media assets
  if (ref.startsWith('/') || ref.startsWith('../')) {
    let base = ref.replace(/^(\.\.\/)+/, '');
    if (!base.startsWith('/')) base = '/' + base;
    base = base.split('/@@')[0].split('/++')[0].replace(/\/+$/, '') || '/';
    return hasPath(base) ? null : `path not in content: ${base}`;
  }
  const relAction = ref.replace(/^\.\//, '');
  if (/^(@@|\+\+)/.test(relAction)) return null;
  if (/^(add|edit|view|delete|sharing|contents|folder_contents|login|logout|history)(\?|\/|#|$)/.test(relAction)) return null;
  return `unrecognized reference form: ${ref.slice(0, 60)}`;
}

module.exports = { LINK_FIELDS, refStrings, refFailure };
