/**
 * Injected Volto config accessors — pure, dependency-free.
 *
 * `blockPath.js` and `blockSync.js` hold the block-path traversal and the
 * fieldRules evaluator that block-sanity's discovery reuses OFFLINE (bare Node,
 * no Volto). Two values those modules need come from Volto's global registry —
 * `config.settings.defaultBlockType` and the `applyBlockDefaults` helper — plus
 * `config.blocks.blocksConfig` as a last-resort fallback. A static
 * `import config from '@plone/volto/registry'` at the top of either module makes
 * the WHOLE file un-loadable in bare Node (the specifier doesn't resolve), which
 * is why the pure `schemaValidation.mjs` had to be split out.
 *
 * Instead of splitting, inject those accessors ONCE. The hydra addon calls
 * `setInjectedVoltoConfig(...)` at init (where `config` is in scope); the pure
 * modules read them lazily via the getters below. No `@plone/volto` import in
 * either module → the offline discovery can load them and call the real evaluator.
 *
 * The values are process-stable (the same lifetime as the `config` singleton they
 * replace), so a module-level holder is no weaker than reaching for `config`.
 * Getters are lazy (`() => config.settings.defaultBlockType`) so a later addon
 * that changes a setting is still honoured. NO imports here — keep it that way.
 */

let injected = {};

/**
 * Inject the Volto-config-derived accessors the pure block-path utils need.
 * Called once by the hydra addon (src/index.js). Merges, so partial injections
 * (e.g. the offline discovery supplying only `getBlocksConfig`) are fine.
 *
 * @param {Object} accessors
 * @param {Function} [accessors.applyBlockDefaults] - @plone/volto/helpers applyBlockDefaults
 * @param {Function} [accessors.getDefaultBlockType] - () => config.settings.defaultBlockType
 * @param {Function} [accessors.getBlocksConfig] - () => config.blocks.blocksConfig
 * @param {Function} [accessors.getSlateStyleAliases] - () => config.settings.slate.styleAliases
 * @param {Function} [accessors.getSlateDefaultBlockType] - () => config.settings.slate.defaultBlockType
 */
export function setInjectedVoltoConfig(accessors) {
  injected = { ...injected, ...accessors };
}

/** The injected applyBlockDefaults, or undefined if not injected (offline). */
export function getApplyBlockDefaults() {
  return injected.applyBlockDefaults;
}

/** config.settings.defaultBlockType (via the injected getter), or null. */
export function getDefaultBlockType() {
  return injected.getDefaultBlockType?.() ?? null;
}

/** config.blocks.blocksConfig (via the injected getter), or undefined. */
export function getInjectedBlocksConfig() {
  return injected.getBlocksConfig?.();
}

/**
 * The slate-wide settings the style allow-list needs when it downgrades a node
 * (#295): what a disallowed style is renamed to, and what it falls back to.
 * Injected like the rest so the pure normalizer stays loadable offline.
 *
 * @returns {{ aliases: Object, defaultBlockType: string }}
 */
/**
 * The slate styles something actually renders, read from the LIVE registry:
 * every registered element type, plus the DS classes the style menu offers
 * (Volto stores the chosen one as the node's `styleName`). Returns null when
 * nothing has been injected, so a caller can fall back rather than judge content
 * against an empty vocabulary.
 *
 * @returns {string[]|null}
 */
export function getSlateVocabulary() {
  return injected.getSlateVocabulary?.() ?? null;
}

export function getSlateStyleGlobals() {
  return {
    aliases: injected.getSlateStyleAliases?.() || {},
    defaultBlockType: injected.getSlateDefaultBlockType?.() || 'p',
  };
}
