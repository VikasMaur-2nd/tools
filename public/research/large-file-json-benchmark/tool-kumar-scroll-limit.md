# Tool Kumar cannot reveal a late search match in the 50 MB fixture

Observed October 15, 2026, production https://tools.vikasmaur.com/, Chromium 145.0.7632.0, viewport 1366 × 900. No application files were changed.

1. Open `bench-50mb.json`, SHA-256 `c3e4ee5212c3500aaaf24c8a518c446ca4004ab6a3ed98b0b5037bdbec4ceb23`.
2. In Format view, press Ctrl+F, enter `TKLB-NEEDLE-LAST`, then Enter.
3. Find reports `1 of 1`, but the match never renders. The page still responds and Collapse all works.

The second measured run captured these values after the search deadline:

```json
{
  "findCount": "1 of 1",
  "requestedSizerHeight": "7.86035e+07px",
  "actualScrollHeight": 33554432,
  "scrollTop": 33553604,
  "clientHeight": 828
}
```

The view requests about 78.6 million vertical pixels. Chromium exposes only 33,554,432 pixels of scroll height. `lib/engine/codeview.ts` sets the sizer height to `rows * RH + 24` and maps a search hit directly to `scrollTop`; that cannot reach the late match after the browser clamps the scroll range. This is a rendering/scroll limit rather than an absent match.

Evidence is the `features.search.diagnostics` object in the second and, if captured, third 50 MB raw records. The first run also failed the same rendered-match predicate, before these extra diagnostics were added. All runs remain part of the study.

A future fix needs to map the logical row range into a bounded physical scroll range, or use a segmented scrolling design, and keep search, selection and folding in that mapping. That work belongs in a separate code task. If fixed, record a new dated verification instead of replacing the original study results silently.

## Re-verification, 2026-10-15, after fix 722ffec

On October 15, 2026, at 09:39 to 09:40 UTC, we repeated only Tool Kumar's three 50 MB runs against https://tools.vikasmaur.com/ after the developer reported deploying main `722ffec`. That fix adds `lib/engine/tall.ts` and scales scrolling above 15 million pixels. The original observations above remain unchanged.

The late search match now renders in **3 of 3 runs**. Every run reports `1 of 1`, renders `TKLB-NEEDLE-LAST` inside the visible Format view and passes Collapse all. All three search screenshots were inspected. The marker's text rectangle is at x=947, y=751, width=128, height=17 CSS pixels, inside the view at x=679, y=36, width=677, height=828. The repeated scroll measurements are below.

### Procedure and raw values

We used the existing harness and the original Tool Kumar 50 MB plan jobs, with only the purpose label changed to `reverify` and all output paths redirected to a separate directory. Chromium remains 145.0.7632.0, headless with GPU disabled, viewport 1366 × 900, a fresh profile and disabled cache per run. The 6 s settle, file input, opening predicate and two-frame wait, three wheel probes, three PageDown probes, Ctrl+F/Enter search, collapse check, 90 s opening deadline, 30 s feature deadlines and memory caps are unchanged.

The fixture is the same 49,998,859-byte `bench-50mb.json`, containing 60,051 records. Its SHA-256 was verified before the batch and independently recorded in each raw result as `c3e4ee5212c3500aaaf24c8a518c446ca4004ab6a3ed98b0b5037bdbec4ceb23`.

| Run | Started UTC | 1-minute load, start / end | Open, ms | Peak renderer, MiB | Peak browser tree, MiB | Search, ms | Collapse, ms |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | 09:39:31.454 | 2.35 / 3.61 | 13825 | 1518 | 1806 | 242 | 279 |
| 2 | 09:39:56.134 | 3.61 / 3.12 | 10449 | 1499 | 1787 | 221 | 310 |
| 3 | 09:40:16.885 | 3.12 / 3.46 | 10241 | 1467 | 1755 | 213 | 289 |

Scroll metrics were captured immediately after the successful search, before Escape and collapse. Heights and scroll positions are CSS pixels.

| Run | Find count | Match renders in viewport | Requested sizer height, raw CSS | Actual scrollHeight | scrollTop | clientHeight |
|---|---|---|---|---:|---:|---:|
| 1 | `1 of 1` | Yes | `1.5e+07px` | 15000000 | 14999172 | 828 |
| 2 | `1 of 1` | Yes | `1.5e+07px` | 15000000 | 14999172 | 828 |
| 3 | `1 of 1` | Yes | `1.5e+07px` | 15000000 | 14999172 | 828 |

All three runs opened successfully. Wheel and PageDown probes returned frames, and neither memory limit fired. Starting available memory was 3,017, 3,750 and 3,592 MiB. The copied batch script checked load before and after acquiring `flock /home/ubuntu/seo-ops/heavy.lock`; the copied runner checked again before each run. All starting and ending loads were below 4. One batch completed in 66,065 ms, holding the lock for about 66 s, with the original outer timeout still set to 580 s plus 5 s for cleanup. `TMPDIR` was `/home/ubuntu/.cache/perf-tmp`. Only three Tool Kumar navigations were made; no other site's page was loaded. No document-marker upload or document-sized request was observed.

The original harness captured count and scroll diagnostics only on failed checks. This separate copy also captures them after successful checks, plus a marker rectangle and screenshot before closing search. These observations run after the feature timer stops and do not change its actions or completion predicate. Full-run memory sampling includes them. In this repeat, every full-run renderer and browser peak already occurred by the end of opening.

### Original and repeat side by side

| Metric, 50 MB | Original October 15 study, before fix | Re-verification October 15, 09:39 to 09:40 UTC |
|---|---|---|
| Opens | 3/3 | 3/3 |
| Last-record search renders | 0/3 | 3/3 |
| Collapse | 3/3 | 3/3 |
| Median open, seconds, with range | 9.857 [9.165 to 9.924], reported as 9.86 in the draft | 10.449 [10.241 to 13.825] |
| Median peak renderer, MiB, with range | 1486 [1468 to 1512] | 1499 [1467 to 1518] |
| Median peak browser tree, MiB, with range | 1771 [1754 to 1798] | 1787 [1755 to 1806] |
| Sizer height / actual scrollHeight | `7.86035e+07px` / 33,554,432, recorded in runs 2 and 3 | `1.5e+07px` / 15,000,000 in all three runs |
| scrollTop / clientHeight after search | 33,553,604 / 828, recorded in runs 2 and 3 | 14,999,172 / 828 in all three runs |

The repeat's median opening was 592 ms slower, or 6.0%, and its slowest run took 13.825 s. This is a shared-host repeat with different load readings, so it does not isolate a performance effect of the fix. Median peak renderer memory rose by 13 MiB, or 0.9%, with overlapping ranges. Median peak browser-tree memory rose by 16 MiB, also about 0.9%. The main confirmed change is that search now reaches and renders the last-record match within the bounded 15-million-pixel scroll range. These measurements verify that reported failure case; they do not audit every selection, folding or scrolling path.

### Separate evidence

All paths below are relative to this study directory. Original raw records, aggregate results and the original visit ledger were preserved.

- `results/raw-reverify/2026-10-15-after-722ffec/results/raw/` contains the three new per-run JSON records, including fixture hashes, load, memory timelines, probes, search diagnostics and marker rectangles.
- `results/raw-reverify/2026-10-15-after-722ffec/evidence/runs/*__search.jpg` contains the three visible-match screenshots.
- `results/raw-reverify/2026-10-15-after-722ffec/fixture-verification.json`, `page-loads.jsonl`, `logs/batches.jsonl` and `logs/console-batch-1.log` record the fixture check, three visits, batch duration and load gates. Each filename after the first shares that directory prefix.
- `results/raw-reverify/2026-10-15-after-722ffec/provenance/` contains the copied documents from before this update, original file hashes and the exact harness diff. `audit.json` in the repeat directory records the preservation and measurement checks.

The scroll-limit decision is now resolved for this fixture and browser. Keep the original failure as a dated finding and present this successful follow-up alongside it. No git checkout was modified and nothing was published.
