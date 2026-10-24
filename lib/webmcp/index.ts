/**
 * WebMCP (https://webmachinelearning.github.io/webmcp/): lets an AI agent in the browser use
 * the JSON tool through named functions (./tools.ts) instead of clicking through the page.
 * Where the browser has no WebMCP, this check is all that runs; elsewhere the tools load
 * once the page is idle.
 */
import { idle } from '../engine/idle';
import type { ModelContext } from './register';

/** Offers the tools while the JSON tool is on the page; returns what withdraws them. */
export function startAgentTools(): () => void {
  const mc = (document as Document & { modelContext?: ModelContext }).modelContext ?? (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (!mc) return () => {};
  const stop = new AbortController();
  idle(() => {
    if (!stop.signal.aborted) import('./register').then((m) => m.register(mc, stop.signal)).catch(() => {});
  }, 2000);
  return () => stop.abort();
}
