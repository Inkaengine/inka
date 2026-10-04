/**
 * The block library an agent can be shown: for each block type, a one-paragraph
 * description (the first paragraph of its docs example page) and a screenshot of
 * its first instance there, rendered by the test frontend. Single-source: both
 * come from the live docs, nothing is hand-written.
 *
 *   node examples.mjs <cacheDir>     # writes <cacheDir>/<type>.jpg + library.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodePage } from '../../lib/prototype-mapping.mjs';
import { storedToSimple, simpleToStored } from '../mcp-format/formats.mjs';
import { screenshotBlock, closeBrowser } from './render.mjs';

const DOCS = new URL('../../docs/', import.meta.url).pathname;

/** Block types offered to the agent, and the docs example page showing each. */
export const LIBRARY = {
  slate: 'examples/slate.md',
  heading: 'examples/heading.md',
  hero: 'examples/hero.md',
  introduction: 'examples/introduction.md',
  highlight: 'examples/highlight.md',
  callout: 'examples/callout.md',
  button: 'examples/button.md',
  image: 'examples/image-block.md',
  video: 'examples/video.md',
  separator: 'examples/separator.md',
  teaser: 'examples/teaser.md',
  gridBlock: 'examples/grid/index.md',
  columns: 'examples/columns.md',
  accordion: 'examples/accordion.md',
  slider: 'examples/slider.md',
  slateTable: 'examples/table.md',
  listing: 'examples/listing.md',
  toc: 'examples/toc.md',
};

/**
 * Examples the docs page can't show locally: YouTube refuses embeds from
 * localhost, so the video example plays the docs' own demo file instead.
 */
const API = `http://localhost:${process.env.HYDRA_MOCK_API_PORT ?? 8888}`;
const LOCAL_EXAMPLES = {
  video: { '@type': 'video', url: `${API}/docs/static/hydra-demo.mp4/@@download/file` },
};

const urlPath = (rel) => `/docs/${rel.replace(/(\/index)?\.md$/, '')}`;

export async function buildLibrary(dir) {
  mkdirSync(dir, { recursive: true });
  const lib = {};
  for (const [type, rel] of Object.entries(LIBRARY)) {
    const stored = decodePage(readFileSync(join(DOCS, rel), 'utf8'));
    const simple = storedToSimple(stored);
    const intro = simple.find((b) => b['@type'] === 'slate' && b.value?.md && !b.value.md.startsWith('#'));
    // The block to show: the first of its type that isn't the intro paragraph itself.
    const idx = stored.blocks_layout.items.findIndex((id, i) => stored.blocks[id]['@type'] === type && simple[i] !== intro);
    if (idx < 0) throw new Error(`${rel}: no ${type} block to show`);
    let uid = stored.blocks_layout.items[idx];
    let draft;
    if (LOCAL_EXAMPLES[type]) {
      const local = simpleToStored([LOCAL_EXAMPLES[type]]);
      draft = local; uid = local.blocks_layout.items[0];
    }
    const jpeg = await screenshotBlock(urlPath(rel), uid, { draft });
    writeFileSync(join(dir, `${type}.jpg`), jpeg);
    lib[type] = { description: intro?.value.md ?? '', image: `${type}.jpg`, bytes: jpeg.length };
    console.log(type, `${(jpeg.length / 1024).toFixed(0)}KB`);
  }
  writeFileSync(join(dir, 'library.json'), JSON.stringify(lib, null, 1));
  return lib;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildLibrary(process.argv[2]);
  await closeBrowser();
}
