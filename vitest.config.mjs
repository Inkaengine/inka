// Vitest config for the volto-hydra addon's unit tests.
//
// Why vitest, not jest? Volto 19 itself migrated to vitest for its own
// tests; the legacy razzle-jest path is unmaintained (razzle's
// createJestConfig was written for Jest 26 and breaks under Jest 30 with
// a chain of version-mismatched deep deps: jest-environment-jsdom@26
// vs @jest/transform@30, babel-jest@26 vs @jest/transform@30, etc.).
// Aligning all of them via pnpm.overrides would be brittle. Vitest is the
// supported direction; using it here lets us share Volto's catalog
// version pin and skip the legacy ecosystem entirely.
//
// hydra-js and @inka/testing run their own vitest configs; this one does
// not collect them.
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve @plone/* imports to their workspace source directories. Razzle's
// webpack does this implicitly via the customization-paths machinery, but
// vite needs explicit aliases for subpath imports like
// `@plone/volto-slate/utils` because the workspace packages don't declare
// an `exports` map.
// Shadows that EXTEND an upstream module rather than replace it, mapped so the
// upstream specifier resolves to OUR copy — the way razzle's customization
// machinery resolves it in the real app. That lets upstream's own test file run
// against our fork (see `include` below), which is the only coverage the
// untouched majority of a fork has: ours tests the additions, upstream's tests
// everything we did not mean to change. The Url shadow is 385 lines, covered by
// 14 cases of ours against upstream's 77.
//
// Only for EXTENDING shadows. Where a shadow replaces a component outright —
// Header renders null, Sidebar is a different layout, Diff renders two iframes —
// upstream's tests must fail by design, and aliasing them would be noise.
//
// Order matters: these specific paths must precede the '@plone/volto' prefix.
const shadowAliases = {
  '@plone/volto/helpers/Url/Url': path.resolve(
    __dirname,
    'packages/volto-hydra/src/customizations/volto/helpers/Url/Url.js',
  ),
  '@plone/volto-slate/utils/blocks': path.resolve(
    __dirname,
    'packages/volto-hydra/src/customizations/@plone/volto-slate/utils/blocks.js',
  ),
};

const ploneAliases = {
  ...shadowAliases,
  '@plone/volto-slate': path.resolve(__dirname, 'core/packages/volto-slate/src'),
  '@plone/volto': path.resolve(__dirname, 'core/packages/volto/src'),
  '@plone/components': path.resolve(__dirname, 'core/packages/components/src'),
  '@plone/registry': path.resolve(__dirname, 'core/packages/registry/src'),
};

// Upstream's own test files import their subject RELATIVELY (`from './Url'`),
// and a Vite alias matches the specifier string, so `shadowAliases` — keyed on
// `@plone/volto/helpers/Url/Url` — never fires for them. Without this plugin
// those suites silently test core/'s copy instead of ours: they stayed green
// with the 19.5.1 `getApiSuffix` port reverted, which is coverage that measures
// nothing. Redirect the relative specifier to the shadow, but only from the
// exact upstream test file, so no other './Url' import is affected.
const UPSTREAM_SUITES = [
  {
    test: 'core/packages/volto/src/helpers/Url/Url.test.js',
    source: './Url',
    shadow:
      'packages/volto-hydra/src/customizations/volto/helpers/Url/Url.js',
  },
  {
    test: 'core/packages/volto-slate/src/utils/blocks.test.js',
    source: './blocks',
    shadow:
      'packages/volto-hydra/src/customizations/@plone/volto-slate/utils/blocks.js',
  },
  // Not a test: volto-slate's own editor imports its normalizer relatively, and
  // the admin build resolves that to the shadow, so tests of the editor must too.
  {
    test: 'core/packages/volto-slate/src/editor/extensions/index.js',
    source: './normalizeNode',
    shadow:
      'packages/volto-hydra/src/customizations/@plone/volto-slate/editor/extensions/normalizeNode.js',
  },
];

function redirectUpstreamSuitesToShadows() {
  return {
    name: 'hydra-redirect-upstream-suites-to-shadows',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;
      const hit = UPSTREAM_SUITES.find(
        (s) =>
          s.source === source &&
          path.resolve(__dirname, s.test) === path.resolve(importer),
      );
      return hit ? path.resolve(__dirname, hit.shadow) : null;
    },
  };
}

/** Tests of a server that runs on Node, which need Node's environment (the node-servers project below). */
const NODE_SERVER_TESTS = [
  'packages/inka-mcp/http.test.mjs',
];

export default defineConfig({
  plugins: [redirectUpstreamSuitesToShadows()],
  resolve: {
    alias: ploneAliases,
  },
  test: {
    environment: 'jsdom',
    include: [
      'packages/volto-hydra/**/*.{test,spec}.{js,jsx,ts,tsx}',
      // Upstream's own suites, run against our shadows via shadowAliases.
      'core/packages/volto/src/helpers/Url/Url.test.js',
      'core/packages/volto-slate/src/utils/blocks.test.js',
      // any docs-tree unit tests
      'docs/**/*.{test,spec}.mjs',
      // blockmd: the prototype engine and the slate <-> markdown core
      'packages/blockmd/**/*.{test,spec}.mjs',
      // The pure data helpers (buildQuerystringSearchBody etc.) — server-safe,
      // no DOM, so their unit tests live alongside them here.
      'packages/helpers/**/*.{test,spec}.{js,jsx,ts,tsx}',
      // The MCP server: the agent page format and the tools.
      'packages/inka-mcp/**/*.{test,spec}.mjs',
      // Repo checks at the suite root. `.test.` only, so the `.spec.ts`
      // playwright specs at this level are never collected.
      'tests-playwright/*.test.{js,ts}',
    ],
    // hydra-js and packages/testing run their own vitest configs, from their
    // own test scripts, which the root `pnpm test` calls after this suite.
    exclude: ['**/node_modules/**', 'packages/hydra-js/**'],
    // Reuse Volto's setup files via the workspace. These initialise the
    // shared config registry (settings.slate.extensions etc.) and DOM
    // shims (matchMedia, IntersectionObserver) so tests don't have to
    // bootstrap Volto themselves.
    setupFiles: [
      path.resolve(__dirname, 'core/packages/volto/test-setup-globals.js'),
      path.resolve(__dirname, 'core/packages/volto/test-setup-config.jsx'),
      // Hydra-specific: invoke volto-slate's applyConfig so the slate
      // plugin chain (Markdown etc.) populates settings.slate.extensions.
      // Volto's setup files initialise the bare config registry but don't
      // invoke addon applyConfig chains.
      path.resolve(__dirname, 'vitest-setup-hydra.js'),
    ],
    projects: [
      {
        extends: true,
        test: {
          name: 'hydra',
          exclude: NODE_SERVER_TESTS,
          // For core's files, which we can't change: Volto's setup imports
          // @testing-library/jest-dom, which calls the global expect, and
          // upstream's suites above use describe/it/expect unimported. Our own
          // tests import what they use.
          globals: true,
        },
      },
      // Servers that run on Node, tested on Node: jsdom's globals (its
      // AbortController among them) are not Node's, and Node's own fetch
      // refuses them, so a server under test there fails where it never
      // would. Volto's setup files need a window, so these go without.
      { test: { name: 'node-servers', include: NODE_SERVER_TESTS, environment: 'node' } },
    ],
  },
});
