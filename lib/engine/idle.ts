/** Runs `fn` when the main thread is idle (soon, where requestIdleCallback is missing). */
export const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 200));
