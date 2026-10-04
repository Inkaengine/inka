/**
 * Block formats declared as DATA: `settings.slate.blockFormats`.
 *
 *   settings.slate.blockFormats = [
 *     { type: 'h2', label: 'Heading 2', icon: { viewBox: '0 0 24 24', paths: ['M…'] } },
 *     { type: 'h3', label: 'Heading 3', icon: { … } },
 *   ];
 *
 * The format dropdown otherwise takes its entries — name, icon, which exist at
 * all — from volto-slate's button components. A frontend's config reaches the
 * admin as data over postMessage, so it can say which formats a region allows
 * (`allowedStyles`) but not what they are called or how they look, and a
 * format with no component (h5, h6) cannot be offered at all. Declared here,
 * each entry is a format in its own right: the dropdown lists exactly these, in
 * this order, filtered by the region's `allowedStyles`.
 *
 * The icon is data — a viewBox and path outlines — drawn by the admin. It is
 * never markup from the frontend: the admin renders an icon's content as HTML,
 * and markup arriving from the iframe would be script running in the admin.
 */
import { isStyleAllowed } from '../../../hydra-js/slateStyles.js';

const HEADING = /^h[1-6]$/;

const escapeAttr = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Icon data → the `{ attributes, content }` shape Volto's Icon component draws. */
function iconOf(icon, type) {
  if (icon === undefined) return undefined;
  if (
    !icon ||
    typeof icon !== 'object' ||
    !Array.isArray(icon.paths) ||
    !icon.paths.length
  ) {
    throw new Error(
      `settings.slate.blockFormats: the icon for "${type}" needs { viewBox, paths: ['M…'] }`,
    );
  }
  return {
    attributes: {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: String(icon.viewBox || '0 0 24 24'),
    },
    content: icon.paths.map((d) => `<path d="${escapeAttr(d)}"/>`).join(''),
  };
}

/**
 * The dropdown's entries for the declared formats, as button descriptors:
 * { name, format, title, icon, allowedChildren }. A heading keeps to the
 * headline children (`allowedHeadlineElements`), as volto-slate's own heading
 * buttons do.
 */
export function blockFormatButtons(
  formats,
  { slateRules, allowedHeadlineElements } = {},
) {
  return formats
    .map((f) => {
      if (!f || typeof f.type !== 'string' || !f.type) {
        throw new Error(
          'settings.slate.blockFormats: every entry needs a `type` (a slate element type)',
        );
      }
      if (typeof f.label !== 'string' || !f.label) {
        throw new Error(
          `settings.slate.blockFormats: "${f.type}" needs a \`label\``,
        );
      }
      return f;
    })
    .filter((f) => isStyleAllowed(f.type, slateRules))
    .map((f) => ({
      name: `format-${f.type}`,
      format: f.type,
      title: f.label,
      icon: iconOf(f.icon, f.type),
      allowedChildren: HEADING.test(f.type)
        ? allowedHeadlineElements
        : undefined,
    }));
}
