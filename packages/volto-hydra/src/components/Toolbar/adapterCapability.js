/**
 * What the CMS behind the bridge can actually do.
 *
 * The admin renders one UI for every backend, so an affordance has to be able
 * to ask. The rule the contract sets is that a capability is honest: absent
 * means the adapter will REJECT the call, so an affordance that needs it must
 * not appear. A control that fails on click is worse than one that was never
 * offered — the editor has already decided to do the thing and often typed
 * something before finding out.
 *
 * Answers true when there is no adapter at all, because then the admin is
 * talking to a Plone directly and everything Volto ships works as it always
 * did. This file is about withholding UI from a CMS that cannot serve it, not
 * about withholding it by default.
 */
import { getAdapterInfo } from '../../bridge/client';
import config from '@plone/volto/registry';

export function adapterSupports(capability) {
  if (!config.settings.useBridgeBackend) return true;
  const info = getAdapterInfo();
  // Before the announcement lands there is nothing to go on. Say no rather
  // than flashing a control that may not belong: the announcement arrives in
  // milliseconds and the alternative is an affordance that appears, then
  // disappears under the pointer.
  if (!info) return false;
  return Boolean(info.capabilities?.includes(capability));
}
