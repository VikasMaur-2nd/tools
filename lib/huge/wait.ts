/**
 * Waiting without making the engine async: HugeDoc's queries are synchronous, so what they need that isn't here
 * yet (file blocks not read, the JS parser not loaded) throws a Wait; the worker (serve.ts) awaits it and asks
 * again. Queries keep no state between tries, so asking again is safe.
 */
export class Wait extends Error {
  constructor(readonly until: () => Promise<unknown>) {
    super('Wait');
  }
}

/** A read that may stall (Chromium's stream readers have: RESEARCH-REPORT.md §4): `tries` attempts, each given `ms`. */
export async function watched<T>(read: () => Promise<T>, ms = 20_000, tries = 3): Promise<T> {
  for (let k = 1; ; k++) {
    let timer = 0;
    try {
      return await Promise.race([
        read(),
        new Promise<never>((_, fail) => {
          timer = setTimeout(() => fail(new Error('Read stalled')), ms) as unknown as number;
        }),
      ]);
    } catch (e) {
      if (k >= tries) throw new Error('Read failed');
      void e;
    } finally {
      clearTimeout(timer);
    }
  }
}
