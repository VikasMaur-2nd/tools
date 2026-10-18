import { useSyncExternalStore } from 'react';
const subscribe = () => () => {};
const client = () => true;
const server = () => false;

/** Keep early input from being lost before React attaches the event handlers. */
export function useReady() {
  return useSyncExternalStore(subscribe, client, server);
}
