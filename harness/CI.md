# Where the checks run (plan)

The plan uses GitHub Actions for cheap, deterministic gates on every change, and our own machine for
everything heavy or timing-sensitive. The repository is private on GitHub Free, so Actions gets **2,000
minutes a month** on GitHub's 2-core Linux runners, and we must stay inside that. Jobs run on our own
machine through a self-hosted runner cost **0 minutes**.

## Budget

Rule: stay below about 1,200 minutes a month, so a busy month still fits.

| Where | What | When | Billed minutes |
|---|---|---|---|
| GitHub (hosted) | `check`: install, lint, typecheck, unit tests, build, smoke set (incl. JS budget) | every PR push that touches app code | ~9 per run |
| GitHub (hosted) | `production-smoke`: smoke set against tools.vikasmaur.com | each successful production deploy | ~3 per run |
| Own machine (self-hosted) | `nightly`: everything else, below | 03:00 UTC daily | 0 |
| Own machine (self-hosted) | `full`: full matrix + perf A/B on one PR | PR label `full-check`, or by hand | 0 |

How the estimate is made:
- The repository had 26 PRs in 12 days, about 65 a month. With superseded runs cancelled, that's roughly
  2 billed runs per PR, so about 130 runs × 9 min ≈ 1,170 min.
- Production deploys add about 40 × 3 ≈ 120 min.
- That totals about 1,290 min, or 65% of the allowance.
- If the month runs hot (more than 1,300 used by the 20th), switch `check` to lint + typecheck + unit
  only (~4 min). The smoke set then moves to the self-hosted runner until the month resets. The usage
  guard below automates that warning.

Ways the GitHub side saves minutes:
- **One job, not several.** GitHub rounds every job up to a whole minute.
- **Cancel superseded runs:** `concurrency` keyed on the PR, with `cancel-in-progress: true`.
- **Skip what can't change behaviour:** `paths-ignore: docs/**, **/*.md, harness/CI.md`. Draft PRs are skipped too.
- **Cache:**
  - the pnpm store (`actions/setup-node` with `cache: pnpm`);
  - the harness browsers (`~/.cache/tool-kumar-harness/browsers`, keyed by the `playwright-core` version, about 100 MB for the Chromium headless shell);
  - `.next/cache` through the harness build cache, which makes a build incremental (about half the time);
  - `.test-build` (unit tests only re-transpile changed files).
- **Chromium only on GitHub.** Firefox and WebKit run on our machine.
- **Pushes to `main` that merge a PR don't rerun `check`.** The job skips commits whose message starts
  with "Merge pull request #"; the PR was checked. Direct pushes to `main` do run it.

## What runs where

### Every PR push: GitHub-hosted `check` (gate, ~9 min)
```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck            # next typegen && tsc --noEmit
pnpm test                 # unit tests; CPU-time speed budgets, so a shared runner doesn't flake
pnpm e2e --smoke -j 2     # builds once (cached), then 18 checks in Chromium; ~35 s here
```
- The smoke set covers:
  - every sitemap URL (HTTP, titles, canonical, h1, main, lang, description);
  - 12 page types on desktop and phone in light and dark;
  - paste → valid → every view on 3 tool pages;
  - first-load JavaScript per page against `harness/budgets.json`.
- A bundle that grows fails here with the exact byte delta. `HARNESS_UPDATE_BUDGETS=1 pnpm e2e budget`
  records a deliberate change.
- Results go to the job summary (`GITHUB_STEP_SUMMARY`), and failure screenshots are uploaded as an artifact.
- Agents push and end their turn: T3's `watch_pull_request` wakes them when the check finishes. No
  `sleep` loops (they cost 10.9 h last fortnight).

### Each production deploy: GitHub-hosted `production-smoke` (~3 min)
- Triggered by `deployment_status` with environment Production and state success.
- Runs `pnpm e2e --smoke --url https://tools.vikasmaur.com`. There's no build: it only installs and gets Chromium.
- It catches what local builds can't: CDN headers, the real service worker, Vercel config.

### Nightly: own machine, self-hosted runner (0 min, ~1.5 h)
```sh
pnpm test --slow                                  # incl. 100k-row exports
pnpm e2e -j 4                                     # every check, Chromium + Firefox + WebKit (328 jobs)
pnpm e2e --slow --tag slow -j 2                   # 25–50 MB documents
pnpm perf --base origin/main --skip-tag lighthouse --save-baseline nightly   # interleaved A/B, CPU-time metrics
pnpm perf lighthouse --rounds 3                   # mobile Lighthouse on 3 page types
```
- The job opens or updates one GitHub issue, "Nightly harness", with failures, perf changes beyond
  noise, and known checks that started passing. It closes the issue when everything is green.
- Baselines stay on that machine (`~/.cache/tool-kumar-harness/baselines`). They are only comparable on
  the machine that made them.

### On demand for one PR: own machine (0 min)
- Triggered by adding the `full-check` label (or by hand: `workflow_dispatch` with a branch).
- Runs the full matrix and `pnpm perf --base origin/main` on that PR. The result posts back as a PR check.
- Meant for editor/engine/parser/service-worker changes and anything performance-sensitive, before merging.

### While working: the agent's own loop (local, seconds)
- `pnpm test parser`: one file in about 0.3 s instead of the whole suite.
- `pnpm typecheck`.
- `pnpm e2e <suite> -e chromium`: the suite you touched. The build is reused when only checks changed.
- `pnpm e2e --ref <branch>`: today's checks against another branch's code.

## The own machine

The recommended setup is a GitHub Actions self-hosted runner, registered to this repository with the
label `tool-kumar-device`. This is why:
- Jobs show up as normal checks and run history in GitHub.
- They're triggered by schedule, label or button.
- They cost no Actions minutes (GitHub's billing page: "GitHub Actions usage is free for self-hosted runners").

Setup is a one-time step that needs the repo owner:
1. Get a registration token: Settings → Actions → Runners → New, or `gh api -X POST repos/VikasMaur-2nd/tools/actions/runners/registration-token`.
2. Install the arm64 runner in `~/actions-runner` and run it as a user service.
3. Set `HARNESS_HEAVY_LOCK=/home/ubuntu/seo-ops/heavy.lock` in its environment, so its builds queue behind other agents' heavy jobs on this shared host.

Caveats:
- **Load:** this EC2 host is shared and often at load 10–40, so wall-clock perf numbers swing. The perf
  suite compensates (interleaved A/B, CPU time, frame-accurate in-page timing, MAD noise). For decisions,
  rerun at a quiet hour or on a quieter machine. Correctness checks are unaffected
  (`t.budget()` stretches stall limits by load).
- **Safety:** the repo is private, so only collaborators can trigger jobs. Never enable it for fork PRs.
- **Alternative without a runner:** a T3 scheduled task runs the same commands nightly and posts a
  commit status with `gh api repos/:owner/:repo/statuses/:sha`. It's simpler to set up but less visible.

## Gating

GitHub Free can't enforce required status checks on a private repository (that needs Pro or Team). So:
- `check` is advisory there. Agents and reviewers treat a red check as blocking; the PR guide says so.
- If the account moves to Pro, make `check` a required check on `main`.

## Usage guard

A weekly scheduled job (self-hosted, 0 min) reads the month's Actions usage from GitHub's billing usage
API (`gh api /users/VikasMaur-2nd/settings/billing/usage`; check the current endpoint when implementing)
and comments on the "Nightly harness" issue when the projection passes 1,300 minutes.

## To implement (after approval)

1. `.github/workflows/check.yml`: hosted, as above.
2. `.github/workflows/production-smoke.yml`: hosted, `deployment_status`.
3. `.github/workflows/device.yml`: self-hosted; nightly, `full-check` label, `workflow_dispatch`.
4. `.github/workflows/usage.yml`: self-hosted, weekly.
5. Register the self-hosted runner on this machine. This needs the owner's go-ahead: it adds a runner to the repo.
6. A PR guide line: "wait for `check`; ask for `full-check` on editor/engine/SW/perf changes".
