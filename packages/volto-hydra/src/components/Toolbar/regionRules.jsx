import React from 'react';
import { useHydraSchemaContext } from '../../context';
import { isStyleAllowed } from '@volto-hydra/helpers/slateStyles.js';

/**
 * The slate rules of the region the block being edited sits in.
 *
 * The canvas toolbar passes them to each button as `slateRules`. Volto's own
 * slate toolbar — the one in the sidebar — renders every button as a bare
 * `<Btn />`, so there they come from the block form's HydraSchemaProvider
 * instead. A prop the toolbar passed wins, `null` included: that toolbar knows
 * its block.
 */
export function useRegionSlateRules(passed) {
  const context = useHydraSchemaContext();
  if (passed !== undefined) return passed;
  return context?.blockPathMap?.[context.currentBlockId]?.slateRules || null;
}

/**
 * Volto's link button, gone where the region refuses links (`a`), as the
 * canvas toolbar's is. Anything pasted or typed there is still stripped at
 * load and at save; this keeps the sidebar from offering what will not keep.
 */
export function regionGatedLinkButton(LinkButton) {
  if (!LinkButton) {
    throw new Error("volto-slate's link button is not among slate.buttons");
  }
  const RegionGatedLinkButton = ({ slateRules, ...props }) => {
    const rules = useRegionSlateRules(slateRules);
    if (!isStyleAllowed('link', rules)) return null;
    return <LinkButton {...props} />;
  };
  return RegionGatedLinkButton;
}
