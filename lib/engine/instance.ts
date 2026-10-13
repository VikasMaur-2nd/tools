import type { Engine } from './engine';

let current: Engine | null = null;

export const setEngine = (e: Engine | null) => {
  current = e;
};
export const getEngine = () => current;

/** Runs an action against the live engine (no-op until it has mounted). */
export const act = (fn: (e: Engine) => unknown) => {
  if (current) fn(current);
};
