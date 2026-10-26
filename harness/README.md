# Browser and performance harness

Real-browser checks (Chromium, Firefox, WebKit) and timing comparisons for Tool Kumar. The unit tests
stay in `tests/` (`pnpm test`).

```sh
pnpm e2e                      # every functional check, each in the engines it declares
pnpm e2e --smoke              # the quick set, Chromium only (~30 s once built)
pnpm e2e back menu            # suites or tests whose name contains "back" or "menu"
pnpm e2e -e firefox,webkit    # only these engines
pnpm e2e --slow               # include big-document checks (25–50 MB)
pnpm e2e --url https://tools.vikasmaur.com --smoke   # a running site instead of a local build
pnpm e2e --ref fix/some-branch back                   # today's checks against another branch's code
                              # (code older than the tk:engine mark is detected and waited for the old way;
                              #  add --legacy with --url for such a site)
pnpm e2e --list               # what would run

pnpm perf                     # timing checks, one at a time, 5 rounds
pnpm perf --base origin/main  # A/B: same checks on a build of main, interleaved
pnpm perf --save-baseline mybox / --baseline mybox   # compare with an earlier run on this machine
```

On GitHub Actions, on demand and within 1,000 billed minutes a month (`CI.md` has the levels and costs):

```sh
pnpm ci:usage                                         # minutes used this month and what's left; --runs lists them
gh workflow run check.yml -f level=unit               # unit tests (-f suites="parser diff" for some files)
gh workflow run check.yml -f level=e2e -f engines=firefox,webkit -f suites=editor   # suites in other engines
gh workflow run check.yml -f level=full -f engines=chromium,firefox,webkit         # everything, one job per engine
                                                      # -f ref=<branch> checks another branch; on a PR, add the
                                                      # ci:quick, ci:smoke or ci:full label instead
```

Big-document checks (tag `slow`) and perf runs stay on our machine. The workflow runs `pnpm e2e --skip-tag slow`,
and `--build-only` builds what the selected checks need without running them.

Other options:
- `-j N` sets how many checks run at once. The default is the number of cores.
- `--retries N` reruns failures and reports any that pass on a retry as flaky.
- `--repeat N` runs every check N times.
- `--bail` stops at the first failure.
- `--headed` shows the browsers.
- `--json file` writes the results to a file.
- `--rounds N` sets the number of perf rounds.

## How it stays fast

- **Builds are content-addressed.** A build's key is the git tree of the files that affect `next build`: the working tree, uncommitted edits included, minus `harness/`, `tests/`, `docs/` and `scripts/`.
  - Unchanged code is never rebuilt, and worktrees with the same code share one build.
  - Changing a check never triggers a rebuild.
  - Builds live in the cache, not in `.next`, so a running server survives a newer build next to it.
  - A new build starts from the last build's Turbopack cache.
- **Browsers are shared.** There is one browser process per engine for the whole run, and every test gets a fresh context, which takes milliseconds.
- **Waits are on conditions, never fixed sleeps.** The engine marks `performance.mark('tk:engine')` when the tool answers input, and the helpers in `lib/app.mjs` poll inside the page every 25 ms.
- **The longest checks start first.** Durations from earlier runs are kept in the cache, so a run ends when its longest chain does.
- **Service workers are blocked** unless a test asks for them. Otherwise the app's worker precaches every chunk in every fresh context.
- **Fixtures are generated once** per machine from seeds and cached. Nothing big is committed.

## Where things live

`HARNESS_CACHE` sets the cache location. The default is `~/.cache/tool-kumar-harness`. It's safe to delete.

| Path | What |
|---|---|
| `browsers/` | Playwright browsers for the pinned `playwright-core`. They are installed on first use, as hard links from `~/.cache/ms-playwright` when it has the same revisions. |
| `builds/<tree>-<variant>/` | Production builds. The newest 6 are kept (`HARNESS_KEEP_BUILDS`). |
| `fixtures/v1/` | Generated documents (see `lib/fixtures.mjs` for the names). |
| `results/<run>/` | `results.json` and screenshots of failures. `latest-e2e.json` / `latest-perf.json` hold the last run; `durations.json` holds the scheduling history. |
| `baselines/` | Saved perf runs (`--save-baseline`). Only compare a baseline on the machine that made it. |
| `tmp/` | Browser profiles and downloads. This keeps them off `/tmp`, which is a small RAM disk on some hosts. |

Environment settings:
- `HARNESS_WORKERS` sets the default `-j`.
- `HARNESS_TIMEOUT_SCALE` multiplies every timeout, for slow machines.
- `HARNESS_HEAVY_LOCK=/path/lock` runs builds under `flock` with other jobs on a shared machine.
- `HEADED=1` is the same as `--headed`.
- `HARNESS_HEADERS` is JSON for extra headers on every request to the target. Example for a protected Vercel preview: `{"x-vercel-protection-bypass":"…","x-vercel-set-bypass-cookie":"true"}`. HTTP-level checks should use `t.fetch`.

## Writing a check

A suite is a file in `harness/suites/` (subfolders are fine; files starting with `_` are helpers, not suites):

```js
import { defaults, test } from '../lib/api.mjs';

defaults({ engines: 'all', tags: ['nav'] });   // every test below

test('a 7 MB document survives /privacy and Back', { tags: ['slow'], slots: 'all' }, async (t) => {
  await t.open('/');                                   // waits for the tool's engine
  await t.app.openFile(t.page, 'rows-60000');          // a generated fixture, through Open file
  const before = await t.app.docHash(t.page);
  await t.app.navigate(t.page, '/privacy');
  await t.page.goBack();
  await t.app.waitValid(t.page);
  t.check(await t.app.docHash(t.page) === before, 'same document after Back');
});
```

`t` has:

| Member | What it is |
|---|---|
| `t.page`, `t.context` | A fresh Playwright page and context, closed after the test. |
| `t.base` | The target URL. |
| `t.fetch(url, init)` | `fetch` with the target's extra headers, for HTTP-level checks. |
| `t.engine` | The engine name. |
| `t.open(path, { tool })` | Opens a path. It waits for the engine unless you pass `tool: false`. |
| `t.check(cond, what, detail, { known })` | A soft check: the test continues. `known: "PR #NN: …"` marks a failure an open PR already fixes, `known: "bug: …"` one still open: it is reported but does not fail the run, and the report says when it starts passing (then drop the mark). |
| `t.assert(cond, what, detail)` | A hard check: the test stops. |
| `t.budget(ms)` | A time limit for responsiveness checks. It is stretched when the machine's load is above its core count, and by `HARNESS_TIMEOUT_SCALE`. |
| `t.metric(name, value, unit)` | Records a measurement for perf runs. |
| `t.log(...)` | Shown when the test fails. |
| `t.newPage(opts)` | A second page in its own context (a phone layout, a second tab). |
| `t.fixture(name)` / `t.fixtureText(name)` | A generated document's path or text. |
| `t.errors` | Page errors and console errors. A test fails on any of these unless it sets `allowErrors`. |
| `t.app` | The helpers in `lib/app.mjs`: `waitValid`, `waitStatus`, `setText`, `paste`, `openFile`, `command`, `docHash`, `view`, `navigate`, `status`, `where`, `clipboard`. |

The clipboard is stubbed in every context: `navigator.clipboard.writeText` stores the text in `window.__clip`. In the page, `window.__vis(selector)` returns the visible match. Next.js keeps up to three left pages hidden in the DOM, so always act on visible elements.

Test options are listed at the top of `lib/api.mjs`:
- `engines`
- `tags`: `slow`, `perf` or `smoke`
- `page: false` for HTTP-only checks
- `mobile` / `dark` / `locale` / `serviceWorkers: 'allow'`
- `variant` for a separate build, such as `posthog-mock`
- `timeout`
- `slots: 'all'` to run alone
- `allowErrors`

### Perf checks

Tag a test `perf` and record values with `t.metric`. `pnpm perf` runs each perf test once per round, one at a time.
- With `--base <ref>`, every round runs both builds, alternating which goes first.
- The report shows the median, p90 and n, plus the change against the base or baseline with a noise estimate (MAD).
- Prefer CPU time and in-page frame timing to wall time on busy machines.
