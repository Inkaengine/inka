import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

/**
 * Map of component names referenced as implicit globals in the example files.
 * The plugin adds import statements for these so they resolve as modules.
 */
const COMPONENT_IMPORTS = {
  SlateNode:         './SlateNode.jsx',
  BlockRenderer:     './BlockRenderer.jsx',
  CookieConsentBlock: './CookieConsentBlock.jsx',
  SlateBlock:        './SlateBlock.jsx',
  IntroductionBlock: './IntroductionBlock.jsx',
  ListingBlock:      './ListingBlock.jsx',
  ColumnBlock:       './ColumnsBlock.jsx', // ColumnBlock is defined in ColumnsBlock.jsx
  HeroBlock:         './HeroBlock.jsx',
  ImageBlock:        './ImageBlock.jsx',
  TeaserBlock:       './TeaserBlock.jsx',
  TableBlock:        './TableBlock.jsx',
  ColumnsBlock:      './ColumnsBlock.jsx',
  GridBlock:         './GridBlock.jsx',
  AccordionBlock:    './AccordionBlock.jsx',
  SliderBlock:       './SliderBlock.jsx',
  FormBlock:         './FormBlock.jsx',
  SearchBlock:       './SearchBlock.jsx',
  HeadingBlock:      './HeadingBlock.jsx',
  SeparatorBlock:    './SeparatorBlock.jsx',
  ButtonBlock:       './ButtonBlock.jsx',
  HighlightBlock:    './HighlightBlock.jsx',
  CalloutBlock:      './CalloutBlock.jsx',
  VideoBlock:        './VideoBlock.jsx',
  MapsBlock:           './MapsBlock.jsx',
  TocBlock:            './TocBlock.jsx',
  TitleBlock:          './TitleBlock.jsx',
  DescriptionBlock:    './DescriptionBlock.jsx',
  LeadImageBlock:      './LeadImageBlock.jsx',
  DateFieldBlock:      './DateFieldBlock.jsx',
  EmptyBlock:          './EmptyBlock.jsx',
  EventMetadataBlock:  './EventMetadataBlock.jsx',
  SocialLinksBlock:    './SocialLinksBlock.jsx',
  CodeExampleBlock:    './CodeExampleBlock.jsx',
};

/**
 * Vite plugin to make doc example JSX files importable as modules.
 *
 * The example files in docs/blocks/examples/react/ are written as
 * documentation snippets — no imports, no exports. This plugin
 * auto-adds React imports, inter-component imports, and a default export.
 */
const examplesDir = path.resolve(__dirname, '../examples/react');

/**
 * Turn a doc-example snippet (written with no imports and no exports) into a real
 * module: add the React import, imports for the sibling components it references,
 * window-global shims for hydra helpers, and a default export of its first
 * top-level function.
 */
function synthesizeExample(code, fileName) {
  // Add React imports
  // Only import hooks actually used in this file (Fragment is auto-injected by React plugin for <>)
  const hooks = ['useState', 'useEffect'].filter(h => code.includes(h));
  const hookImports = hooks.length > 0 ? `, { ${hooks.join(', ')} }` : '';
  let imports = `import React${hookImports} from 'react';\n`;

  // Add imports for referenced components (skip self-imports)
  for (const [name, importPath] of Object.entries(COMPONENT_IMPORTS)) {
    const importFile = path.basename(importPath);
    if (importFile === fileName) continue;
    if (code.includes(name)) {
      imports += `import ${name} from '${importPath}';\n`;
    }
  }

  // Add hydra.js helpers for listing/search blocks.
  // Use arrow wrappers so these resolve at call time, not at module-import time
  // (main.jsx sets window globals after the App import chain has been evaluated).
  if (code.includes('expandListingBlocks')) {
    imports += `const expandListingBlocks = (...a) => window._expandListingBlocks(...a);\n`;
  }
  if (code.includes('ploneFetchItems')) {
    imports += `const ploneFetchItems = (...a) => window._ploneFetchItems(...a);\n`;
  }
  if (code.includes('API_URL')) {
    imports += `const _getApiUrl = () => window._API_URL;\n`;
    // Replace bare API_URL references with _getApiUrl() calls
    code = code.replace(/\bAPI_URL\b/g, '_getApiUrl()');
  }
  if (code.includes('contentPath')) {
    imports += `const contentPath = (...a) => window._contentPath(...a);\n`;
  }
  if (code.includes('expandTemplatesSync')) {
    imports += `const expandTemplatesSync = (...a) => window._expandTemplatesSync(...a);\n`;
  }

  // Find all top-level function declarations and export the first as default
  const fnNames = [];
  const fnRegex = /^function (\w+)/gm;
  let match;
  while ((match = fnRegex.exec(code)) !== null) {
    fnNames.push(match[1]);
  }

  let exports = '';
  if (fnNames.length > 0) {
    exports = `\nexport default ${fnNames[0]};\n`;
    if (fnNames.length > 1) {
      exports += fnNames.slice(1).map(n => `export { ${n} };`).join('\n') + '\n';
    }
  }

  return imports + code + exports;
}

function reactExamplesPlugin() {
  return {
    name: 'react-examples',
    transform(code, id) {
      if (!id.startsWith(examplesDir) || !id.endsWith('.jsx')) return;
      return synthesizeExample(code, path.basename(id));
    },
  };
}

/**
 * The dependency optimizer scans the module graph with esbuild directly and does
 * NOT run Vite `transform` hooks — so it would read the raw, export-less snippet
 * and fail: "No matching export in BlockRenderer.jsx for import 'default'" (older
 * esbuild tolerated it; esbuild 0.21+ makes it fatal, taking down the whole dev
 * server). Mirror the synthesis as an esbuild onLoad plugin so the scan/optimize
 * pass sees the same imports + default export the serve-time transform produces.
 */
const examplesEsbuildPlugin = {
  name: 'react-examples-esbuild',
  setup(build) {
    build.onLoad({ filter: /[\\/]examples[\\/]react[\\/][^\\/]+\.jsx$/ }, (args) => ({
      contents: synthesizeExample(readFileSync(args.path, 'utf8'), path.basename(args.path)),
      loader: 'jsx',
    }));
  },
};

export default defineConfig({
  plugins: [react(), reactExamplesPlugin()],
  optimizeDeps: {
    esbuildOptions: { plugins: [examplesEsbuildPlugin] },
  },
  resolve: {
    alias: {
      '$examples': path.resolve(__dirname, '../examples/react'),
      '$hydra': path.resolve(__dirname, '../../../packages/hydra-js/hydra.src.js'),
      '$helpers': path.resolve(__dirname, '../../../packages/helpers/index.js'),
      '$schemas': path.resolve(__dirname, '../block-definitions.json'),
    },
  },
});
