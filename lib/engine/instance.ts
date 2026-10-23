import type { Engine } from './engine';
import type { DiffMenu } from './store';

let current: Engine | null = null;

export const setEngine = (e: Engine | null) => {
  current = e;
};
export const getEngine = () => current;

/** Runs an action against the live engine (no-op until it has mounted). */
export const act = (fn: (e: Engine) => unknown) => {
  if (current) fn(current);
};

/** Compare's differences panel, while it is mounted: its part of the right-click menu for a right click at `el` (null: from the keyboard). */
let diffMenu: ((el: Element | null) => DiffMenu | null) | null = null;
export const setDiffMenu = (f: typeof diffMenu) => {
  diffMenu = f;
};
export const getDiffMenu = (el: Element | null) => diffMenu?.(el) ?? null;
