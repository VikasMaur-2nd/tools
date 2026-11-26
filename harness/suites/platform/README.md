# Platform checks

Run `pnpm e2e platform -j 2`. On the shared host, set
`HARNESS_HEAVY_LOCK=/home/ubuntu/seo-ops/heavy.lock`.
Use `-e chromium`, `-e firefox` or `-e webkit` for a separate engine report.

Privacy and WebMCP use Chromium, as the original scripts did. Offline checks and
the shared editor-helper regression run in Chromium, Firefox and WebKit. The
runner owns every browser and context. Privacy uses full Chromium with a human
user agent. WebMCP also enables `WebMCPTesting` and the `WebMCP` Blink feature.

## Coverage

Counts exclude the runner's automatic error check, which adds a check only when
an unexpected error occurs. The old diagnostic scripts logged observations
without assertions. The canary logged 23 action steps and a final leak verdict.

| Original script | Old checks | New checks | New tests |
| --- | ---: | ---: | ---: |
| `rv/c/canary.mjs` | 23 steps, 0 assertions | 65 | 8 |
| `phlive/beacon3.mjs` | 0, one unload observation | 5 | 1 |
| `phlive/leave.mjs` | 0, one pagehide observation | 3 | 1 |
| `phlive/cases.mjs` | 0, four scenarios | 12 | 4 |
| `phlive/cls2.mjs` | 0, five layout scenarios | 26 | 5 |
| `webmcp-test/e2e.mjs` | 27 | 31 | 5 |
| `webmcp-test/e2e-dl.mjs` | 12 | 12 | 2 |
| `rv/c/sw-offline.mjs`, default scenarios | 40 per engine | 44 per engine | 3 |
| Same script, optional `swupdate` | 3 per engine | 3 per engine | 1 |
| Same script, optional `upgrade` | 8 per engine | 8 per engine | 1 |
| None: deploy clean-up (`toolpage`, `rollback`, `homeretry`) | — | 33 per engine | 3 |

The offline total is 51 old checks and 88 new checks per engine. Four added
checks establish that the two builds differ and that visited pages reached the
cache before the proxy cuts their connections. The two clean-up scenarios check
that a deploy first seen on a tool page brings the shell along and deletes the
old build once its tab closes, and that a rollback keeps both builds' tabs whole
and deletes each build's leftovers when its own tabs close; a third, that a shell
which failed to follow a tool page to a new build follows on the next visit. WebMCP adds checks for
the contents of the conditional scripts and reading the last record of a large document.

Supplemental regressions add six mock transport checks and four editor-helper
checks per engine. The full matrix has 36 tests, 54 jobs and 436 checks per run.

The query-string canary remains a query-string privacy check. Document imports
use `#a=`, so a separate case verifies a real remote-document import and its
`json_loaded` event. Continuous-input and negative analytics checks wait for an
idle control visitor's request instead of sleeping for the old fixed intervals.

All requested local coverage is ported. `live-rec.mjs`, `live-token.mjs` and
`competitors.mjs` are omitted as requested because they require live services.
The older canaries are historical versions of the same flows, not additional
independent suites.

## Builds and fixtures

The existing `VARIANTS` settings are unchanged:

- `posthog-mock` uses token `phc_harness_canary` and host `http://127.0.0.1:4610`.
- `redeploy` sets `NEXT_PUBLIC_POSTHOG_UI_HOST=https://redeploy.harness.invalid`.
  This changes a lazy chunk and the entry chunk that names it while preserving
  the site's behavior. Both offline builds are cached by the normal build cache.
- `immutable` and `immutable-redeploy` are the same two builds in production's
  file layout. Vercel's adapter turns on Next's `supportsImmutableAssets`, so
  hashed files live under `/_next/static/immutable/` and chunks name each other
  as `"static/immutable/chunks/…"`. A harness adapter
  (`harness/lib/immutable-adapter.mjs`, loaded through `NEXT_ADAPTER_PATH`) does
  the same; `next.config.ts` is unchanged. Run the offline suite against them
  with `HARNESS_OFFLINE_IMMUTABLE=1 pnpm e2e platform/offline`. Under an adapter,
  prerendered HTML is written to `.next/server/route-cache/`, so tools that read
  `.next/server/app/` don't apply to these builds; the offline suite fetches
  over HTTP.

The proxy uses fresh ports, cuts worker connections as well as page connections,
and reports outstanding worker work over a MessageChannel. Update scenarios add
a version marker to the served worker, so Chromium, Firefox and WebKit perform
a real worker update even when the two variants have identical `sw.js` files.
Conditional response headers are removed when the proxy changes the worker body.
Migration cases wait for the replacement registration to activate, then reload
and verify its controller. Coalesced update checks are repeated when no worker
is installing or waiting.

`fixtures/legacy-sw.js` freezes the production worker from commit `90c3075`.
The upgrade case serves it with build A's HTML and assets, then installs the
current worker with the redeploy build. This preserves the old-worker migration
check without requiring a third build or reading an external reference folder.

## Reliability and known application failures

The mock is shared under the harness lock. Header tags isolate contexts, and
PostHog window IDs associate unload beacons whose headers Chromium omits. Form
decoding handles unpadded base64 and gzip. Searches include request headers and
case changes in generated identifiers. SDK scripts remain available in memory
if a cached build is pruned. A later test restarts a mock that expired while
other platform tests ran.

Asynchronous conditions use an awaited poll. Playwright 1.64's
`waitForFunction` accepts a returned Promise as truthy before its boolean result.
Page waits use `t.budget`. Replay verdicts require a final recording marker to
reach the mock before navigating away, and event checks wait for received events.
The browser's JavaScript user agent is pinned through pagehide because Chromium
restores its protocol override during navigation, which otherwise activates
PostHog's bot filter and drops pageleave.

PR #26 failures stay visible as `known` checks:

- Hover Minify or a Compare type-change count. The shared tooltip exposes
  document facts in replay on main. Site tooltips must remain readable afterward.
- Edit `/integrate` until it creates a link. The link-length hint exposes a
  document size in replay. Its JSX text nodes are checked separately from the size.
- Visit once, then go offline. Some lazy chunks and font subsets are absent.
- Deploy while a tab is open. The old build's assets are removed too soon;
  cleanup after its tabs close can also retain an old asset.
- Deploy with a named script returning 404. Main replaces the cached shell with
  an incomplete build. Its dependent feature checks fail under the same known bug.

Raw document marker checks have no known exemption. Only the document-fact
tooltip and link-length checks have privacy exemptions for PR #26. Failed lazy
features and resulting chunk errors remain failed checks under their causal PR.
Unexpected exceptions continue to fail the suite.
Firefox console entries labeled only `Error` are classified from their actual
Error arguments, so missing chunks remain distinguishable from unrelated failures.

The only shared helper change outside the requested platform/mock files is
`harness/lib/app.mjs`: synthetic paste performs the browser's native insertion
when the editor does not cancel the event, and view switching handles the narrow
picker that replaces tabs in Compare. Both APIs remain compatible.
