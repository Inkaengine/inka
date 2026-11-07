/**
 * HydraSchemaContext
 *
 * Provides blockPathMap, currentBlockId, formData, blocksConfig, and liveBlockDataRef
 * to schemaEnhancers. This allows childBlockConfig to determine if a block is inside
 * a parent container and whether the parent has a type selected.
 *
 * liveBlockDataRef contains the most recent data from each block's form,
 * updated synchronously when forms change (before React state propagates).
 */
import React from 'react';
// Static import (not a lazy `require`) so this module loads under bare-Node ESM —
// block-sanity's offline discovery reuses getLiveBlockData for `../` parent
// lookups in the fieldRules evaluator. No cycle: blockPath.js does not import
// this context module.
import { getBlockById } from '../utils/blockPath.js';

const HydraSchemaContext = React.createContext(null);

// Store for non-React access (schemaEnhancers are called outside React render)
let currentContextValue = null;

export const HydraSchemaProvider = ({ children, value }) => {
  // useLayoutEffect runs synchronously - cleanup happens before unmount completes
  // This prevents stale context leaking between tests in CI
  React.useLayoutEffect(() => {
    currentContextValue = value;
    return () => {
      currentContextValue = null;
    };
  }, [value]);

  // Set synchronously for immediate access during initial render
  // (useLayoutEffect hasn't run yet on first render)
  currentContextValue = value;

  // Plain JS rather than JSX: this is a .js file, and Vite (the unit tests)
  // parses .js without JSX, so any component test that imported it failed.
  return React.createElement(HydraSchemaContext.Provider, { value }, children);
};

/**
 * Hook for React components
 */
export const useHydraSchemaContext = () => {
  return React.useContext(HydraSchemaContext);
};

/**
 * Get context value for non-React code (like schemaEnhancers)
 * Includes liveBlockDataRef for accessing fresh parent block data.
 */
export const getHydraSchemaContext = () => {
  return currentContextValue;
};

/**
 * Temporarily set context value for non-React code.
 * Used by applySchemaDefaultsToFormData to set currentBlockId for each block.
 * Returns a function to restore the previous value.
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

export default HydraSchemaContext;
