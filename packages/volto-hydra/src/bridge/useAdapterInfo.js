/**
 * What the adapter says it is, as state that keeps up.
 *
 * Reading getAdapterInfo() during render looks equivalent and is not: the
 * announcement arrives after the first paint, and nothing about it touches the
 * redux store — so a component that read it once was frozen at whatever was
 * true before the frontend answered. A control gated on a capability then
 * stayed hidden for the whole session, which is exactly the failure the
 * capability check was added to prevent.
 *
 * client.js makes the same point about deciding anything from capabilities at
 * call time; this is the React-shaped way to do it instead.
 */
import { useEffect, useState } from 'react';
import { getAdapterInfo, subscribeAdapter } from './client';

export default function useAdapterInfo() {
  const [info, setInfo] = useState(getAdapterInfo);
  useEffect(() => subscribeAdapter(setInfo), []);
  return info;
}
