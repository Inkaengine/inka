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
import {
  getHydraSchemaContext,
  setHydraSchemaContext,
  getLiveBlockData,
} from '@volto-hydra/helpers/hydraSchemaContext.js';

export { getHydraSchemaContext, setHydraSchemaContext, getLiveBlockData };

const HydraSchemaContext = React.createContext(null);

export const HydraSchemaProvider = ({ children, value }) => {
  // useLayoutEffect runs synchronously - cleanup happens before unmount completes
  // This prevents stale context leaking between tests in CI
  React.useLayoutEffect(() => {
    setHydraSchemaContext(value);
    return () => {
      setHydraSchemaContext(null);
    };
  }, [value]);

  // Set synchronously for immediate access during initial render
  // (useLayoutEffect hasn't run yet on first render). The store is
  // @volto-hydra/helpers/hydraSchemaContext.js, for code outside React render.
  setHydraSchemaContext(value);

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

export default HydraSchemaContext;
