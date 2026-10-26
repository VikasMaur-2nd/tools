# Where the checks run (plan)

The approach:
- **Everyday checking happens directly on our machine** with the harness. No runner, no GitHub.
- **GitHub Actions only runs when asked.** It gives a clean, independent second opinion when that's
  worth paying for: before merging, or to check something on a fresh machine.

Nothing runs on every push. The repository is private on GitHub Free, so Actions gets **2,000 minutes a
month** on GitHub's 2-core Linux runners. Running only on demand keeps us well inside that.

## On our machine: run directly

| When | Command | Time here |
|---|---|---|
| While editing | `pnpm test parser` (one file) | ~0.3 s |
| | `pnpm typecheck` | ~15 s |
| | `pnpm e2e <suite> -e chromium` (the suite you touched; the build is reused when only checks changed) | seconds–minutes |
| Before pushing | `pnpm lint && pnpm test && pnpm e2e --smoke` | ~2–3 min |
| Before merging editor / engine / parser / service-worker / perf changes | `pnpm e2e` (328 jobs, Chromium + Firefox + WebKit) and `pnpm e2e --slow --tag slow` | ~1 h / ~12 min at load ~12 |
| | `pnpm perf --base origin/main` (interleaved A/B; Lighthouse: `pnpm perf lighthouse`) | ~30–40 min |
| Another branch's code | `pnpm e2e --ref <branch>` | |

A nightly full run is optional. It would be a T3 scheduled task on this machine that runs the commands
above and opens or updates a "Nightly harness" issue. It costs no GitHub minutes. Only add it if you want it.

## GitHub Actions: on demand only

One workflow, `.github/workflows/check.yml`, with two ways to start it and three levels. It never starts
on push.

**Ways to start it:**
- **A PR label.** Add `ci:quick`, `ci:smoke` or `ci:full` to a PR. The workflow removes the label as it
  starts, so each label runs exactly once. Re-add it to run again after new commits.
- **By hand.** Actions → check → Run workflow, or `gh workflow run check.yml -f ref=<branch> -f level=smoke`.
  Inputs: `ref`, `level`, `engines` (default `chromium`), and optional `url` to test a deployed site
  instead of building, for example production after a deploy.

**Levels:**

| Level | Runs | Billed minutes (2-core runner, estimate) |
|---|---|---|
| `quick` | install, lint, typecheck, unit tests | ~4 |
| `smoke` | `quick` + build (cached) + `pnpm e2e --smoke` (18 checks incl. the first-load JS budget) | ~9 |
| `full` | `smoke` + every functional suite in the chosen engines | ~30 Chromium only; Firefox and WebKit roughly double each |
| `url` given | `pnpm e2e --smoke --url <url>`: no build, just Chromium | ~3 |

**Typical month:**
- One `ci:smoke` per PR before merging: about 65 × 9 ≈ 600 min.
- A handful of `full` runs on risky PRs: about 5 × 30 ≈ 150 min.
- A production smoke after notable deploys: about 20 × 3 ≈ 60 min.
- That's about **800 minutes (40%)**, and every run is a deliberate choice.

**Keeping each run cheap:**
- **One job per run.** GitHub rounds every job up to a whole minute.
- **Cancel superseded runs:** `concurrency` keyed on the PR, with `cancel-in-progress: true`.
- **Cache:**
  - the pnpm store (`actions/setup-node` with `cache: pnpm`);
  - the harness browsers (`~/.cache/tool-kumar-harness/browsers`, keyed by the `playwright-core` version);
  - `.next/cache` through the harness build cache (an incremental build is about half the time);
  - `.test-build`.
- **Report:** results go to the job summary (`GITHUB_STEP_SUMMARY`), and failure screenshots are uploaded
  as an artifact.

**Gating:** GitHub Free can't make checks required on a private repository, so a run is advice, not a
lock. The PR guide line: "run `ci:smoke` (and `ci:full` for editor/engine/SW/perf changes) before asking
to merge". Agents start the label and end their turn; T3's `watch_pull_request` wakes them when the check
finishes, with no `sleep` loops.

**Usage guard:** the workflow's first step reads the month's Actions usage. If usage is past 1,600
minutes, a `full` run stops with a note unless it was started by hand with `force: true`.

## To implement (after approval)

1. `.github/workflows/check.yml`: labels and `workflow_dispatch`; levels `quick`, `smoke`, `full` and `url`;
   removes its label; caches; usage guard.
2. Create the three labels.
3. The PR guide line above.
4. Optional: the nightly T3 scheduled task.
