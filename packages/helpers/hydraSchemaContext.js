/**
 * The editor's schema context, for code that runs outside React render (the
 * schema enhancers, field rules and block sync): blockPathMap, currentBlockId,
 * formData, blocksConfig, and liveBlockDataRef, the most recent data from each
 * block's form, updated before React state propagates.
 *
 * The admin's HydraSchemaProvider sets it while it renders. With no provider
 * (offline discovery, a test) it is null, and callers fall back to the data
 * they were given.
 */
import { getBlockById } from './blockPath.js';

let currentContextValue = null;

/** The current context, or null. */
export const getHydraSchemaContext = () => {
  return currentContextValue;
};

/**
 * Set the context, as the provider does and as code that needs a context for
 * one call does (applySchemaDefaultsToFormData sets currentBlockId per block).
 * Returns a function that restores the previous value.
 */
export const setHydraSchemaContext = (value) => {
  const previousValue = currentContextValue;
  currentContextValue = value;
  return () => {
    currentContextValue = previousValue;
  };
};

/**
 * Get block data, checking liveBlockDataRef first for fresh data.
 * Use this instead of getBlockById when you need the most current data
 * (e.g., checking if parent has a type selected).
 *
 * Accepts an optional `fallback` object with { formData, blockPathMap } —
 * used by callers that have those values explicitly (e.g., buildBlockPathMap
 * pass 2, where there is no React context). The hydraContext path still
 * takes precedence so live form-internal state wins during sidebar renders.
 */
export const getLiveBlockData = (blockId, fallback) => {
  if (currentContextValue) {
    const { liveBlockDataRef, formData, blockPathMap } = currentContextValue;

    // Check liveBlockDataRef first (contains fresh data from form internal state)
    if (liveBlockDataRef?.current?.[blockId]) {
      return liveBlockDataRef.current[blockId];
    }

    // Fall back to formData (page-level state)
    if (formData && blockPathMap) {
      return getBlockById(formData, blockPathMap, blockId);
    }
  }

  // Last resort: caller-provided formData + blockPathMap (no React context)
  if (fallback?.formData && fallback?.blockPathMap) {
    return getBlockById(fallback.formData, fallback.blockPathMap, blockId);
  }

  return null;
};
