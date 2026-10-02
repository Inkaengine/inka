// Vitest project for the adapter conformance suite.
//
// The contract suite drives adapters directly — no DOM, no Volto, no browser —
// so a failing assertion names the intent that broke rather than "something in
// the stack". Kept separate from vitest.config.mjs because that one loads
// Volto's jsdom setup files and the whole config registry, which is pure
// overhead here.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests-adapters/contract/**/*.spec.ts'],
    // WordPress gets a larger budget because its BACKEND is slower, not because
    // its tests are. Measured: every request to WordPress-on-PHP-WASM costs
    // ~1.1s regardless of payload — a listing of one page and a listing of a
    // hundred are within 40ms of each other — because WordPress rebuilds itself
    // per request and opcache runs in file_cache_only mode, which skips parsing
    // but not execution. A test making thirty legitimate calls therefore cannot
    // fit in 30s no matter how good the adapter is.
    //
    // This is a budget matched to a measured floor, not a way to quieten slow
    // tests: the adapter work that mattered was done first (precise cache
    // invalidation on move and delete took the move tests from ~34s to ~12s),
    // and the floor itself is the environment's, not ours.
    testTimeout: process.env.TARGET === 'wordpress' ? 90_000 : 30_000,
    hookTimeout: process.env.TARGET === 'wordpress' ? 120_000 : 60_000,
    // Targets bind fixed ports, so files must not race each other for them.
    fileParallelism: false,
    // Boots WordPress once for the whole run; a no-op for the Plone target.
    globalSetup: ['./tests-adapters/global-setup.ts'],
  },
});
