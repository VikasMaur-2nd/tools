/**
 * From what size a file opens in huge-file mode (lib/huge, loaded only then) instead of the editor: 300 MiB,
 * less on a device that reports little memory (a document in the editor takes several times its size), or
 * what `localStorage['tk:hugeMin']` says (bytes; "0": every file), to try huge mode with small files.
 */
export function hugeMin(): number {
  try {
    const set = localStorage.getItem('tk:hugeMin');
    if (set) return +set;
  } catch {
    /* storage refused (private mode) */
  }
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return gb ? Math.min(HUGE_MIN, gb * 64 * 1024 * 1024) : HUGE_MIN;
}

/** The size from which huge mode opens a file on a device with memory to spare. */
export const HUGE_MIN = 300 * 1024 * 1024;
