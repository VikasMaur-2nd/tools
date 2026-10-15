/** Runs `fn` when the main thread is idle, at most `timeout` ms from now (soon, where requestIdleCallback is missing). */
export const idle = (fn: () => void, timeout = 5000) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, Math.min(200, timeout)));

let port: MessagePort | null = null;
const queue: (() => void)[] = [];

/** Runs `fn` in a new task right away: lets the page handle input between steps of long work (no timer clamping). */
export const soon = (fn: () => void) => {
  if (!port) {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => queue.shift()?.();
    port = ch.port2;
  }
  queue.push(fn);
  port.postMessage(0);
};
