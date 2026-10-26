// Speed budgets in unit tests use the process's CPU time, not the clock. Wall time grows several
// times over when other programs keep the machine busy (shared CI boxes, parallel test files, other
// agents on a dev host), which made these budgets fail with nothing wrong; CPU time barely moves.

/** Milliseconds of CPU time (user + system, all threads) this process has used so far. */
export function cpuNow(): number {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
}
