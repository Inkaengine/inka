// Vitest setup for Hydra: apply volto-slate's plugin config so
// `settings.slate.extensions` is populated. Volto's own
// test-setup-config.jsx initialises the bare config registry but doesn't
// invoke addon applyConfig chains — for our slate-touching tests we need
// volto-slate's setup to run too (Markdown plugin sets slate.extensions).
import { beforeEach } from 'vitest';
import voltoSlateApplyConfig from '@plone/volto-slate';
import config from '@plone/volto/registry';
import { applyBlockDefaults } from '@plone/volto/helpers';
import { setInjectedVoltoConfig } from './packages/volto-hydra/src/utils/injectedVoltoConfig.js';

voltoSlateApplyConfig(config);

// blockPath.js / blockSync.js no longer import `@plone/volto/registry`
// or `applyBlockDefaults` directly (so the offline block-sanity discovery can
// load them) — they read these via an injected seam. hydra's addon applyConfig
// sets it at runtime; mirror that here so the unit tests do too.
setInjectedVoltoConfig({
  applyBlockDefaults,
  getDefaultBlockType: () => config.settings.defaultBlockType,
  getBlocksConfig: () => config.blocks.blocksConfig,
});

// Give the worker a macrotask before every test. Synchronous tests never yield,
// so a file of them runs as one uninterrupted block, and the worker can't take
// the replies to its progress reports until it ends. Past 60s vitest fails the
// run with "Timeout calling onTaskUpdate", every test passing: the docs-corpus
// round-trip (lib/prototype-roundtrip.test.mjs, ~55-62s) did that on CI.
beforeEach(() => new Promise((resolve) => setTimeout(resolve, 0)));
