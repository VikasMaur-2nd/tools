# Where the checks run

- **Everyday checking happens on our machine** with the harness. No runner, no GitHub.
- **GitHub Actions runs only when asked**, to take work off our machine: the unit tests, the Firefox and
  WebKit suites, a full run before merging, or a check on a fresh machine.
- **Actions may use at most 1,000 billed minutes a month** for this repository, half of the 2,000 that
  GitHub Free gives a private repository (October 2026: 2,000, raised by the user; `RAISED` in
  scripts/ci-usage.mjs). Past that, everything runs on our machine. Nothing runs on push.

## On our machine

| When | Command | Time here |
|---|---|---|
| While editing | `pnpm test parser` (one file) | ~0.3 s |
| | `pnpm typecheck` | ~15 s |
| | `pnpm e2e <suite> -e chromium` (the suite you touched; the build is reused when only checks changed) | seconds–minutes |
| Before pushing | `pnpm lint && pnpm test && pnpm e2e --smoke` | ~2–3 min |
| Before merging editor / engine / parser / service-worker / perf changes | `pnpm e2e` (328 jobs, Chromium + Firefox + WebKit) and `pnpm e2e --slow --tag slow` | ~1 h / ~12 min at load ~12 |
| | `pnpm perf --base origin/main` (interleaved A/B; Lighthouse: `pnpm perf lighthouse`) | ~30–40 min |
| Another branch's code | `pnpm e2e --ref <branch>` | |

Big-document checks (`--slow`, 25–50 MB) stay here, and so do perf runs compared across machines or days.
A before/after of two commits can run on Actions (`perf.yml`, below): both builds run in the same job on the
same runner, one after the other, so they are compared under the same conditions. GitHub's runners have 2
cores and 7 GB of memory: their timings are slower and noisier than ours, memory figures are not.

## GitHub Actions

### Starting a run

- **A PR label.** Add `ci:quick`, `ci:smoke` or `ci:full` to a PR. The run checks the PR merged into
  `main` and removes the label as it starts, so add it again after new commits. A newer run of the same
  label cancels the older one. `.github/workflows/check-label.yml` does this.
- **By hand.** Actions → check → Run workflow, or from a terminal:

```sh
pnpm ci:usage                                                        # minutes used this month, what's left, what runs cost
gh workflow run check.yml -f level=unit                              # unit tests
gh workflow run check.yml -f level=e2e -f engines=firefox,webkit -f suites=editor   # a suite in Firefox and WebKit
gh workflow run check.yml -f level=full -f engines=chromium,firefox,webkit         # everything, three engines
gh workflow run check.yml -f level=smoke -f ref=fix/some-branch      # another branch (default: main)
gh workflow run check.yml -f level=smoke -f url=https://tools.vikasmaur.com          # a running site, no build
gh run list -w check.yml                                             # then: gh run view <id> [--log-failed]
```

**Inputs** (`.github/workflows/check.yml`):

| Input | What it does | Default |
|---|---|---|
| `level` | `unit`, `quick`, `smoke`, `e2e` or `full` (below) | `smoke` |
| `engines` | Browsers for `e2e` and `full`: `chromium`, `firefox`, `webkit`, or a list like `firefox,webkit` | `chromium` |
| `suites` | A filter, as on our machine: suites or test names for `e2e` and `full` (`"editor features"`), test files for `unit` (`"parser diff"`) | all |
| `ref` | The branch, tag or commit to check | the branch the run starts from (`main`) |
| `url` | Check a running site instead of a build. Only browser checks run; tests that need a special build are skipped | |

**Levels**, with billed minutes on the 2-core runner. `pnpm ci:usage` prints the guard's current
estimates.

| Level | Runs | Billed minutes | Wall time |
|---|---|---|---|
| `unit` | unit tests | 3 | ~2.5 min |
| `quick` (`ci:quick`) | lint, typecheck, unit tests | 3 | ~2.5 min |
| `smoke` (`ci:smoke`) | `quick` + build + the smoke checks in Chromium (incl. the first-load JS budget) | 5 | ~4 min |
| `e2e` | build + the browser checks in `engines` (no lint or unit tests) | ~14 per engine | |
| `full` | `quick` + `e2e` | ~16 in Chromium; ~40 in three engines (`ci:full`) | ~15 min in three engines |
| with `url` | the level's browser checks against the site, no build | smoke 2 | |

Measured on PR #29: setup takes about 35 s per job, lint 15 s, typecheck 10 s, the unit tests 1.5 min, a
production build 41 s without any cache, the OS packages 12 s (Chromium), 18 s (Firefox) and 34 s (WebKit),
and the smoke checks 18 s. The browser checks run at about the speed of our machine, so a whole engine is
9–10 minutes. A `suites` filter costs only the tests it matches plus about 2 minutes, though the guard
counts it as the whole set.

### Before/after on Actions (`perf.yml`)

`pnpm perf <check> --ref <candidate> --base <base>` in a job of its own per engine and check: the job builds
both commits and runs the check on each, one after the other. The table the runner prints goes into the job
summary; `results.json` and each run's metrics as JSON lines (`BREAKER_MEM_OUT`) are kept as an artifact for
30 days. A `ci:perf` label on a PR runs a quick one (opening `bench-1mb` in Chromium, the PR against `main`).

```sh
gh workflow run perf.yml -f checks="perf/editor › open bench-10mb" -f ref=my-branch            # against main, Chromium
gh workflow run perf.yml -f checks="breaker/memory › records 100mb; breaker/memory › strings 100mb" \
  -f ref=t3/optimize-json-memory-performance -f engines=chromium,firefox,webkit \
  -f settings="BREAKER_MEM_SIZES=100 BREAKER_MEM_VIEWS=tree BREAKER_MEM_FIND=0" -f minutes=15
```

| Input | What it does | Default |
|---|---|---|
| `checks` | Perf checks, separated by `;` (a job each, per engine) | |
| `ref` | The candidate: branch, tag or commit | |
| `base` | What it is compared with | `main` |
| `harness` | Where the checks come from, when not from the candidate (a check main doesn't have yet) | the candidate |
| `engines` | `chromium`, `firefox`, `webkit` or a list (a job each) | `chromium` |
| `settings` | Settings for the checks, `NAME=value` words | |
| `minutes` | What one job is expected to take, for the budget guard | 12 |

A job costs its setup, the browser's OS packages, two production builds (~1.5 min) and the check on both
builds. A document of 100 MB or more may not fit in the runner's 7 GB: the memory check stops a run when less
than 1.5 GiB is left (it fails, saying so), which is itself a result.

### Jobs

A run is **one job**, because GitHub rounds every job up to a whole minute and each job pays for its own
setup. The exception is the whole browser set in two or three engines (`ci:full`, or `full`/`e2e` with
several engines and no `suites`): then a first job runs the code checks and makes the builds, and **one job
per engine** runs the browser checks in parallel on those builds. That costs about a minute more per engine
(setup and rounding: ~40 instead of ~38 for `ci:full`) and takes about 15 minutes instead of 40. With a
`suites` filter the engines share one job, since setup would be a large part of each job.

### The budget

Every job starts with `node scripts/ci-usage.mjs --guard`:
- It adds up this month's billed minutes of every run in the repository (calendar month, UTC): each job's
  time on its runner rounded up to a whole minute, which is how GitHub bills Linux runners. A run still
  going counts its estimate if that's more. (GitHub's run timing API reports 0 billable minutes here, and
  the account's billing API needs a token the workflow doesn't have, so the guard counts the jobs itself.)
- It adds this run's estimate. A `suites` filter is estimated as the whole set, since the guard runs before
  anything is installed.
- If the total would pass 1,000, the job stops before installing anything, and the job summary says so with
  the command to run on our machine instead, like "Budget reached: nothing ran … Run `pnpm e2e editor -e
  webkit` locally." There's no override.
- If the usage can't be read (the API is down or rate-limited), the job stops too, saying why.

`pnpm ci:usage` prints the same numbers on our machine (`--runs` lists every run). Check it before
starting something large late in the month.

### Keeping runs cheap

- **pnpm store**: cached by `actions/setup-node`.
- **Production builds**: cached by the harness's content key, so the same code is never built twice, even
  across runs (`ci:smoke` then `ci:full` on the same commit builds once), and new code builds from the last
  build's Turbopack cache. The builds' `node_modules` aren't cached; they're reinstalled from the pnpm store.
- **Browsers** are downloaded by the harness as each job needs them: about 5 s each, as fast as a cache.
- **Unit tests** run two files at a time (`--test-concurrency=$(nproc)`); `node --test` would run one at a
  time on 2 cores.
- **Timeouts**: 20 minutes for code-only levels, 60 for the first job of a browser run, 40 per engine job.
- **Cancelled when superseded**: a newer label run of the same PR and label cancels the older one.

### Reading the results

- The run's summary shows the budget line, the code checks and each browser job's results with the failed
  checks.
- Failed browser checks upload their screenshots and `results.json` as an artifact (`failures-…`, kept 7
  days).
- `gh run view <id> --log-failed` prints only the failing steps' logs.

### Gating

GitHub Free can't make checks required on a private repository, so a run is advice, not a lock. The PR
guide line: "run `ci:smoke` (and `ci:full` for editor/engine/SW/perf changes) before asking to merge".
Agents add the label and end their turn; T3's `watch_pull_request` wakes them when the check finishes.

### A typical month

- `ci:smoke` on most PRs: 60 × 5 ≈ 300 minutes.
- `ci:full` on the editor, engine, parser, service-worker and perf PRs: 10 × 40 ≈ 400 minutes.
- Offloaded unit tests and Firefox/WebKit suites: 50 × 4 ≈ 200 minutes.
- That's about 900 of the 1,000. The guard stops anything past it, and the rest runs on our machine.
