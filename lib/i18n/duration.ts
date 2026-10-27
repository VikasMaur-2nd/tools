/*
 * Durations for display (a JWT's expiry, see ui.ts's dur): their own module, so the JWT reader isn't part of
 * the first load.
 */

const UNIT: [string, number][] = [['year', 31536000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];

/** A duration in words: "45 seconds", "1 hour 59 minutes", "3 days 4 hours", "40 days". */
export function duration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const word = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  for (let k = 0; k < UNIT.length; k++) {
    const [name, size] = UNIT[k];
    const n = Math.floor(s / size);
    if (!n && size > 1) continue;
    // A second unit only while the first is small ("1 hour 59 minutes", not "40 days 3 hours").
    const next = UNIT[k + 1];
    const m = next && n < 10 ? Math.floor((s - n * size) / next[1]) : 0;
    return m ? `${word(n, name)} ${word(m, next[0])}` : word(n, name);
  }
  return '0 seconds';
}

/** Compact non-negative duration: 45s, 12m, 2h, 3d, 1y. */
export const compact = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return s < 60
    ? s + 's'
    : s < 3600
      ? ((s / 60) | 0) + 'm'
      : s < 86400
        ? ((s / 3600) | 0) + 'h'
        : s < 31536000
          ? ((s / 86400) | 0) + 'd'
          : ((s / 31536000) | 0) + 'y';
};
