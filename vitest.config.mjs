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
const ploneAliases = {
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
    // Two projects, because these are two different kinds of test and jsdom is
    // not free. The addon's component tests need a DOM and Volto's config
    // registry; the block/markdown engine, the adapters and the pure helpers
    // are data in, data out, and paying for jsdom plus Volto's setup on every
    // one of them cost more than the tests themselves.
    //
    // Measured on the docs corpus round-trip, the slowest file in the suite:
    // ~156s under jsdom, ~78s under node for exactly the same assertions. The
    // rest of its cost is the engine's own — verify-on-emit is O(n²) per page by
    // design — and that is not this config's business; paying for a DOM none of
    // it touches was.
    projects: [
      {
        resolve: { alias: ploneAliases },
        test: {
          name: 'addon',
          globals: true,
          environment: 'jsdom',
          root: __dirname,
          include: [
            'packages/volto-hydra/**/*.{test,spec}.{js,jsx,ts,tsx}',
            // The playwright suites' own helpers, tested directly rather than
            // inferred from a green e2e run. They build real DOM fixtures —
            // selectablePoint picks a click target, measureStylesInPage reads
            // computed styles — so they need jsdom as much as the addon does.
            // `.test.` only: the specs themselves are `.spec.ts`.
            'tests-playwright/helpers/**/*.test.{js,ts}',
            // The coverage REPORTER (tests-playwright/coverage-reporter.ts)
            // lives at the suite root, next to playwright.config's reference to
            // it. Its unit test proves onEnd actually fails the run on a gap.
            'tests-playwright/*.test.{js,ts}',
          ],
          exclude: ['**/node_modules/**'],
          // Volto's own setup: the shared config registry
          // (settings.slate.extensions etc.) and the DOM shims (matchMedia,
          // IntersectionObserver), so tests don't bootstrap Volto themselves.
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
      },
      {
        resolve: { alias: ploneAliases },
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          root: __dirname,
          // No setupFiles: none of these import @plone/*, and Volto's
          // test-setup-globals.js assigns to `window` on load, which is the one
          // thing a node environment does not have.
          include: [
            // any docs-tree unit tests
            'docs/**/*.{test,spec}.mjs',
            // blockmd: the prototype engine and the slate <-> markdown core
            'lib/**/*.{test,spec}.mjs',
            // The pure data helpers (buildQuerystringSearchBody etc.) —
            // server-safe, no DOM.
            'packages/helpers/**/*.{test,spec}.{js,jsx,ts,tsx}',
            // The CMS adapters' own unit tests (no CMS needed). They had
            // per-package jest configs that no CI step ever invoked, so they
            // never ran there.
            'packages/hydra-adapters-*/**/*.test.js',
          ],
          // hydra-js has its own jest harness; covered by
          // `cd packages/hydra-js && pnpm test` in CI.
          exclude: ['**/node_modules/**', 'packages/hydra-js/**'],
        },
      },
    ],
  },
});
