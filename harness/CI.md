# Where the checks run

- **Everyday checking happens on our machine** with the harness. No runner, no GitHub.
- **GitHub Actions runs only when asked**, to take work off our machine: the unit tests, the Firefox and
  WebKit suites, a full run before merging, or a check on a fresh machine.
- **Actions may use at most 1,000 billed minutes a month** for this repository, half of the 2,000 that
  GitHub Free gives a private repository. Past that, everything runs on our machine. Nothing runs on push.

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

Big-document checks (`--slow`, 25–50 MB) and perf runs always stay here: GitHub's runners have 2 cores
and 7 GB of memory, and their timings are too noisy to compare.

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

**Levels**, with billed minutes on the 2-core runner (`pnpm ci:usage` prints the current estimates):

| Level | Runs | Billed minutes |
|---|---|---|
| `unit` | unit tests | ~3 |
| `quick` (`ci:quick`) | lint, typecheck, unit tests | ~5 |
| `smoke` (`ci:smoke`) | `quick` + build + the smoke checks in Chromium (incl. the first-load JS budget) | ~10 |
| `e2e` | build + the browser checks in `engines` (no lint or unit tests) | ~20 per engine |
| `full` | `quick` + `e2e` | ~23 in Chromium; ~57 in three engines (`ci:full`) |
| with `url` | the level's browser checks against the site, no build | smoke ~3 |

A `suites` filter costs less than the table: setup and the build are about 5 minutes, the rest scales
with the tests the filter matches.

### Jobs

A run is **one job**, because GitHub rounds every job up to a whole minute and each job pays for its own
setup. The exception is the whole browser set in two or three engines (`ci:full`, or `full`/`e2e` with
several engines and no `suites`): then a first job runs the code checks and makes the builds, and **one job
per engine** runs the browser checks in parallel on those builds. That costs about 2 minutes more per
extra engine and finishes in about a third of the time, instead of an hour. With a `suites` filter the
engines share one job, since setup would be most of each job.

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
- **Browsers** are downloaded by the harness as each job needs them, which is as fast as a cache here.
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

- `ci:smoke` on most PRs: 50 × 10 ≈ 500 minutes.
- `ci:full` on a few risky PRs: 5 × 57 ≈ 285 minutes.
- Offloaded unit tests and single suites: 20 × 5 ≈ 100 minutes.
- That's about 900 of the 1,000; the guard stops anything past it.
