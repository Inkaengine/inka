// Render the site's icons from public/favicon.svg (the Inka mark):
//   public/favicon.ico            16, 32 and 48px on a white tile (an .ico can't follow
//                                 dark mode), for browsers without SVG favicons
//   public/apple-touch-icon.png   180px, on white, for home screens
import { fileURLToPath } from 'node:url';
import { renderIcons, tile, homeScreen } from '../../../scripts/icons.mjs';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
await renderIcons(`${pub}favicon.svg`, pub, [
  { file: 'favicon.ico', sizes: [16, 32, 48], style: tile },
  { file: 'apple-touch-icon.png', size: 180, style: homeScreen },
]);
