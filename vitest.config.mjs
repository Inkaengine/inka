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
// hydra-js stays on its own jest setup (it has ESM-specific needs);
// this config only covers volto-hydra's addon tests.
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

export default defineConfig({
  resolve: {
    alias: ploneAliases,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'packages/volto-hydra/**/*.{test,spec}.{js,jsx,ts,tsx}',
      // Upstream's own suites, run against our shadows via shadowAliases.
      'core/packages/volto/src/helpers/Url/Url.test.js',
      'core/packages/volto-slate/src/utils/blocks.test.js',
      // any docs-tree unit tests
      'docs/**/*.{test,spec}.mjs',
      // blockmd: the prototype engine and the slate <-> markdown core
      'lib/**/*.{test,spec}.mjs',
      // The pure data helpers (buildQuerystringSearchBody etc.) — server-safe,
      // no DOM, so their unit tests live alongside them here.
      'packages/helpers/**/*.{test,spec}.{js,jsx,ts,tsx}',
      // Pure aggregation helpers used BY the playwright suites (coverage
      // bookkeeping, no browser). Their contract — "one example is enough",
      // "reported only when no example covers it" — is worth testing directly
      // rather than inferring it from a green e2e run. `.test.` only: the
      // playwright specs themselves are `.spec.ts` and must not be collected.
      'tests-playwright/helpers/**/*.test.{js,ts}',
      // The coverage REPORTER (tests-playwright/coverage-reporter.ts) lives at
      // the suite root, next to playwright.config's reference to it. Its unit
      // test proves onEnd actually fails the run on a gap. `.test.` only, so
      // the `.spec.ts` playwright specs at this level are never collected.
      'tests-playwright/*.test.{js,ts}',
    ],
    // hydra-js has its own jest harness; covered by `cd packages/hydra-js && pnpm test` in CI.
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
  },
});
