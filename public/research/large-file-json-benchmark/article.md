# Large JSON benchmark: opening, typing and number fidelity

We first tested six browser JSON tools on October 15, 2026. Tool Kumar at `19b7ac7` opened our 1 MB, 10 MB and 50 MB files in median times of 0.890 s, 2.482 s and 9.857 s. We then made major changes to Tool Kumar. This follow-up measures production `925fc3c`. The results below give actual counts. This is a research draft for owner review. Scheduled cells can contain failed or blocked outcomes; the tables report their actual coverage.

Disclosure: Tool Kumar's maker ran this study. We optimized Tool Kumar after the first measurements. We did not change any competitor. The latest six-tool comparison was interleaved on the resized host with the same 6 GiB browser budget for every tool. Earlier 2.5 GiB observations remain dated historical evidence. They are not pooled with the new comparison. Competitor source commits are unknown. Each visit records its date, scripts and any visible build tokens.

The latest six-tool measurements ran 2026-10-17, UTC. The latest Tool Kumar fidelity and rapid cut/paste checks ran on October 17, 2026. Competitor number-fidelity results remain dated October 15, 2026.

The original host had two CPUs and 7,801 MiB RAM. The owner resized it on October 17. The new host has four CPUs and 15,759 MiB RAM. The historical production timings include both hardware and code changes. They cannot isolate a code speedup. The separate local-build control below holds hardware constant. Its own completion status and sample counts are shown; the historical CDN difference is not a code-only estimate.

GitHub Production deployment `7136322793` associates `925fc3c6f004552a8cdea9628699de9735682d01` with a successful deployment. The saved served-page build token and immutable script paths provide separate evidence. No commit identifier is independently embedded in that page. The served build token was `0KTjE-idTF_Ru-giVfrP7`. Scripts used `/_next/static/immutable/chunks/`. This was a metadata-only capture, not a browser benchmark. The current repeat saves this evidence before and after each batch and rejects a batch if it changes.

Decimal MB describes file bytes. MiB describes process memory. Times below include input delivery and visible output, not the site's initial page load. Square brackets give the observed minimum and maximum. The [downloadable results](publish/summary.json) include per-run source paths, fixture hashes and commit evidence. The [measurement ledger](publish/measurement-ledger.md) lists every accepted attempt and its date. This is one shared host and one browser, not a capacity guarantee for every device.

## What we found

Tool Kumar at `925fc3c`, with the 6 GiB budget, recorded 3/3 opened, 0.383 s [0.369 s to 0.498 s] at 1 MB.

Tool Kumar at `925fc3c`, with the 6 GiB budget, recorded 3/3 opened, 1.572 s [1.507 s to 1.613 s] at 10 MB.

Tool Kumar at `925fc3c`, with the 6 GiB budget, recorded 3/3 opened, 9.051 s [8.925 s to 9.364 s] at 50 MB.

JSON Formatter Online won the original October 15 opening comparison at both smaller sizes. 1 MB: 0.427 s beside Tool Kumar 0.890 s. 10 MB: 1.223 s beside Tool Kumar 2.482 s. Those historical wins remain in their own table below.

At 1 MB, Tool Kumar's paste median was 0.358 s and JSON Formatter Online's was 0.461 s. The original study's JSON Formatter Online wins remain in the historical comparison. Read the spread before treating a small gap as a lead.

At 1 MB, the paste timings meet this study's tie rule because the observed ranges overlap or the short-operation gap is below 25%. The lower raw median remains visible; it does not establish a clear speed lead.

JSON Formatter Online's 10 MB paste median was 1.153 s, below Tool Kumar's 1.459 s. Each cell has three opening attempts. Read the spread and feature results beside the timing.

At 10 MB, the paste timings meet this study's tie rule because the observed ranges overlap or the short-operation gap is below 25%. The lower raw median remains visible; it does not establish a clear speed lead.

Code Beautify JSON Viewer, 50 MB: 3/3 exceeded memory cap.

JSON Beautifier, 50 MB: 3/3 opened, 28.159 s [27.785 s to 29.351 s].

JSON Viewer Stack, 50 MB: 2/3 opened, 49.822 s [49.213 s to 50.430 s]; 1/3 view detected, interaction obstructed.

JSON Formatter Online, 50 MB: 3/3 no formatted view within 90 s.

JSONLint, 50 MB: 1/3 unresponsive at 90 s; 2/3 exceeded memory cap.

At 1 MB, these tools had lower median renderer memory to the formatted view than Tool Kumar: JSON Formatter Online 156 MiB. Tool Kumar used 182 MiB. Full-run peaks and feature failures remain separate.

At 10 MB, these tools had lower median renderer memory to the formatted view than Tool Kumar: JSON Formatter Online 285 MiB. Tool Kumar used 436 MiB. Full-run peaks and feature failures remain separate.

All 4 current Tool Kumar fidelity observations kept the seven tested numeric values and duplicate members. Two checks require a real edit and a matching worker packed-tree reply. Those correctness checks use the original 2.5 GiB setup and remain separate from the new timing series.

The same-hardware local code control remains at the original 2.5 GiB budget. At 50 MB, its polled median fell from 9.127 s at `19b7ac7` to 8.649 s at `925fc3c`. Its precise DOM median increased from 6.388 s to 8.576 s. The evidence does not support a claim that every opening metric improved.

At 100 KB, Tool Kumar's minified Event Timing median/p95 was 88.0 ms / 216.0 ms. The prettified copy was 32.0 ms / 40.0 ms. Complete-profile counts were 3/3 and 3/3. The table gives actual byte counts and editor types. This comparison does not isolate wrapping, tokenization or line indexing as the cause.

At 1 MB, JSON Beautifier's minified Event Timing median/p95 was 1888.0 ms / 2376.0 ms. The prettified copy was 24.0 ms / 32.0 ms. Complete-profile counts were 3/6 and 3/3. The table gives actual byte counts and editor types. This comparison does not isolate wrapping, tokenization or line indexing as the cause.

Tool Kumar's 50 MB last-record search passed 3/3 times. Its median was 251 ms, with an observed range of 244 to 301 ms.

In minified 100 KB typing, JSON Beautifier had lower values than Tool Kumar on these measures. rAF median 57.9 ms, beside 72.5 ms; rAF p95 128.9 ms, beside 198.2 ms. Both have three complete matched profiles. These observed gaps do not establish a universal ranking.

In minified 100 KB typing, JSON Formatter Online had lower values than Tool Kumar on these measures. Event Timing median 40.0 ms, beside 88.0 ms; rAF median 17.6 ms, beside 72.5 ms; Event Timing p95 48.0 ms, beside 216.0 ms; rAF p95 25.1 ms, beside 198.2 ms. Both have three complete matched profiles. These observed gaps do not establish a universal ranking.

In prettified 100 KB typing, JSON Beautifier had lower values than Tool Kumar on these measures. Event Timing median 24.0 ms, beside 32.0 ms; rAF median 10.3 ms, beside 25.5 ms; rAF p95 16.2 ms, beside 34.0 ms. Both have three complete matched profiles. These observed gaps do not establish a universal ranking.

In prettified 100 KB typing, JSON Formatter Online had lower values than Tool Kumar on these measures. Event Timing median 16.0 ms, beside 32.0 ms; rAF median 12.7 ms, beside 25.5 ms; Event Timing p95 24.0 ms, beside 40.0 ms; rAF p95 17.6 ms, beside 34.0 ms. Both have three complete matched profiles. These observed gaps do not establish a universal ranking.

In prettified 1 MB typing, JSON Beautifier had lower values than Tool Kumar on these measures. rAF median 10.4 ms, beside 15.3 ms; Event Timing p95 32.0 ms, beside 40.0 ms; rAF p95 18.1 ms, beside 19.0 ms. Both have three complete matched profiles. These observed gaps do not establish a universal ranking.

In prettified 10 MB typing, JSON Formatter Online had lower values than Tool Kumar on these measures. Event Timing p95 32.0 ms, beside 40.0 ms. Both have three complete matched profiles. These observed gaps do not establish a universal ranking.

Tool Kumar's minified 10 MB typing had an Event Timing median/p95 of 32.0 ms / 56.0 ms. At 50 MB after Edit anyway, it was 40.0 ms / 56.0 ms. These are comparisons within the measured build, not a historical typing speedup.

Tool Kumar's prettified 10 MB typing had an Event Timing median/p95 of 24.0 ms / 40.0 ms. At 50 MB after Edit anyway, it was 56.0 ms / 72.0 ms. These are comparisons within the measured build, not a historical typing speedup.

Tool Kumar 50 MB prettified typing after Edit anyway supplied 3/3 complete profiles. Event Timing median/p95 was 56.0 ms / 72.0 ms. Output updates are separate.

At the start caret in the prettified 50 MB data fixture, the confirmed visible-output update median was 9918.5 ms across 3/3 profiles. Missing intervals are unconfirmed rather than estimated. The per-position notes distinguish failed output prepositioning, a hidden marker and an update found only in the later diagnostic.

Tool Kumar 50 MB minified typing after Edit anyway supplied 3/3 complete profiles. Event Timing median/p95 was 40.0 ms / 56.0 ms. Output updates are separate.

At the start caret in the minified 50 MB data fixture, the confirmed visible-output update median was 8987.1 ms across 3/3 profiles. Missing intervals are unconfirmed rather than estimated. The per-position notes distinguish failed output prepositioning, a hidden marker and an update found only in the later diagnostic.

## Before and after

The first Tool Kumar row is historical. We then changed Tool Kumar and resized the host. The latest six-tool rows use the same 6 GiB browser budget and interleaved attempts. The host and memory-budget columns expose those other changes, so this production before-and-after is not a code-only estimate. The local production-build control below holds the hardware and 2.5 GiB budget constant. Original 50 MB search failed; its fix and later verification remain below.

| Tool | Version | Date, UTC | Input path | Host | Browser budget | 1 MB | 10 MB | 50 MB |
|---|---|---|---|---|---|---|---|---|
| Tool Kumar | 19b7ac7, historical | 2026-10-15 | file | 2 CPUs; 7,801 MiB RAM | 2.5 GiB | 0.890 s | 2.482 s | 9.857 s |
| Tool Kumar | 925fc3c | 2026-10-17 | file | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 0.383 s [0.369 s to 0.498 s] | 3/3 opened, 1.572 s [1.507 s to 1.613 s] | 3/3 opened, 9.051 s [8.925 s to 9.364 s] |
| Code Beautify JSON Viewer | Public site, source commit unknown | 2026-10-17 | file | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 4.220 s [3.906 s to 6.389 s] | 3/3 opened, 21.888 s [20.511 s to 21.900 s]; 3 browser memory stops after the view appeared | 3/3 exceeded memory cap |
| JSON Beautifier | Public site, source commit unknown | 2026-10-17 | file | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 0.803 s [0.751 s to 0.961 s] | 3/3 opened, 5.510 s [5.305 s to 5.640 s] | 3/3 opened, 28.159 s [27.785 s to 29.351 s] |
| JSON Viewer Stack | Public site, source commit unknown | 2026-10-17 | paste | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 0.639 s [0.614 s to 0.714 s] | 2/3 opened, 8.598 s [8.548 s to 8.647 s]; 1/3 view detected, interaction obstructed | 2/3 opened, 49.822 s [49.213 s to 50.430 s]; 1/3 view detected, interaction obstructed |
| JSON Formatter Online | Public site, source commit unknown | 2026-10-17 | paste | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 0.461 s [0.427 s to 0.574 s] | 3/3 opened, 1.153 s [1.152 s to 1.204 s] | 3/3 no formatted view within 90 s |
| JSONLint | Public site, source commit unknown | 2026-10-17 | paste | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 6.432 s [5.775 s to 6.843 s] | 3/3 opened, 19.563 s [18.655 s to 20.103 s] | 1/3 unresponsive at 90 s; 2/3 exceeded memory cap |

### Original six-tool opening comparison

These are the October 15, 2026 observations on the two-CPU host with 7,801 MiB RAM and a 2.5 GiB browser budget. Tool Kumar used 19b7ac7. Competitor source commits are unknown. JSON Formatter Online had the lower 1 MB and 10 MB medians. Stack also had a lower 1 MB raw median, within the study tie rule. Failed and obstructed outcomes remain in the counts. These results are historical, separate from the new matched comparison.

| Tool | Input path | 1 MB | 10 MB | 50 MB |
|---|---|---|---|---|
| Tool Kumar | file | 0.890 s [0.889 s to 0.900 s]; 3/3 ok | 2.482 s [2.290 s to 2.498 s]; 3/3 ok | 9.857 s [9.165 s to 9.924 s]; 3/3 ok |
| Code Beautify JSON Viewer | file | 4.407 s [3.803 s to 6.011 s]; 3/3 ok; 2 memory stops in the full run | Not measured; 3/3 exceeded memory cap; 3 memory stops in the full run | Not measured; 3/3 exceeded memory cap; 3 memory stops in the full run |
| JSON Beautifier | file | 0.863 s [0.788 s to 0.999 s]; 3/3 ok | 6.138 s [6.069 s to 6.322 s]; 3/3 ok | Not measured; 3/3 exceeded memory cap; 3 memory stops in the full run |
| JSON Viewer Stack | paste | 0.686 s [0.647 s to 0.725 s]; 1/3 view detected, interaction obstructed; 2/3 ok | 8.895 s [8.816 s to 8.973 s]; 2/3 ok; 1/3 view detected, interaction obstructed | Not measured; 3/3 unresponsive at 90 s |
| JSON Formatter Online | paste | 0.427 s [0.409 s to 0.464 s]; 3/3 ok | 1.223 s [1.218 s to 1.224 s]; 3/3 ok | Not measured; 3/3 no formatted view within 90 s |
| JSONLint | paste | 6.820 s [6.646 s to 7.395 s]; 3/3 ok | 20.475 s [20.216 s to 21.063 s]; 3/3 ok | Not measured; 3/3 exceeded memory cap; 3 memory stops in the full run |

[Original opening data](results/summary.json) give the per-run references. The higher memory budget also changes competitor outcomes: JSON Beautifier now opens 50 MB in all three primary attempts. That change cannot be assigned to Tool Kumar code.

### Same-hardware comparison of the code

We built `19b7ac7`, `aee1ae3` and `925fc3c` as clean local production builds on the resized four-CPU host. The table has three file-path rounds per source and size. Source order reverses in the second round. These are local `pnpm build` and `pnpm start` timings, not CDN timings. The original versions retain their accepted first rounds from earlier on October 17. Remaining rounds and the latest version were measured later that day. Every run records load and build identity. Shared-host and time variation remain; the ranges show that variation. Servers start outside the lock. Timed browser runs hold the lock and run alone.

| Source commit | File size | Opened | Polled output | In-page DOM | In-page two frames |
|---|---|---|---|---|---|
| 19b7ac7 | 1 MB | 3/3 | 0.866 s [0.834 s to 0.874 s] | 0.748 s [0.721 s to 0.779 s] | 0.821 s [0.795 s to 0.843 s] |
| 19b7ac7 | 10 MB | 3/3 | 2.031 s [1.983 s to 2.059 s] | 1.487 s [1.434 s to 1.489 s] | 2.014 s [1.963 s to 2.034 s] |
| 19b7ac7 | 50 MB | 3/3 | 9.127 s [8.915 s to 9.155 s] | 6.388 s [6.270 s to 6.466 s] | 9.097 s [8.901 s to 9.109 s] |
| aee1ae3 | 1 MB | 3/3 | 2.365 s [2.365 s to 2.369 s] | 1.742 s [1.736 s to 1.743 s] | 2.295 s [2.293 s to 2.300 s] |
| aee1ae3 | 10 MB | 3/3 | 2.849 s [2.826 s to 3.170 s] | 2.229 s [2.199 s to 2.232 s] | 2.839 s [2.817 s to 2.913 s] |
| aee1ae3 | 50 MB | 3/3 | 12.421 s [12.395 s to 12.566 s] | 9.364 s [9.228 s to 9.413 s] | 12.389 s [12.341 s to 12.509 s] |
| 925fc3c | 1 MB | 3/3 | 0.393 s [0.376 s to 0.393 s] | 0.247 s [0.242 s to 0.259 s] | 0.336 s [0.332 s to 0.347 s] |
| 925fc3c | 10 MB | 3/3 | 1.496 s [1.473 s to 1.510 s] | 1.394 s [1.379 s to 1.398 s] | 1.417 s [1.401 s to 1.422 s] |
| 925fc3c | 50 MB | 3/3 | 8.649 s [8.566 s to 8.667 s] | 8.576 s [8.491 s to 8.611 s] | 8.607 s [8.516 s to 8.637 s] |

[Local production build evidence](results/2026-10-17-local-code/summary.json) includes source commits, build IDs, disk checks, per-run evidence and scratch cleanup. This compares code versions on one hardware condition. It cannot assign the whole historical CDN timing difference to code changes.

The optional intermediate baseline at `aee1ae3` on October 15 exposed a soft-wrap cost. Its file-path medians were 3.028 s, 4.221 s and 21.229 s by polling. Its in-page DOM medians were 2.203 s, 3.087 s and 12.751 s. At 1 MB, turning wrap off reduced the DOM time from about 2.2 s to about 0.9 s in the separate A/B. That baseline is not substituted for the original study. [Baseline source](/home/ubuntu/seo-ops/perf/baseline-aee1ae3/comparison-baseline-aee1ae3.json).

## Fresh opening results

Each primary cell has three scheduled fresh-profile attempts. Failed attempts are counted. The same 6 GiB browser-tree budget and 3,500 MiB host available-memory floor apply to every tool. File opening is used where the original study used it; paste is used for Stack, JSON Formatter Online and JSONLint. Opening retains the original JavaScript clipboard/input helpers. Editing and rapid cut/paste use trusted CDP keyboard commands. Tool Kumar has both paths. JSON Beautifier requires Beautify. JSONLint requires Validate and Prettify. JSON Hero remains excluded because it uploads the document.

| Tool | Input path | 1 MB | 10 MB | 50 MB |
|---|---|---|---|---|
| [Tool Kumar](https://tools.vikasmaur.com/) | file | 3/3 opened, 0.383 s [0.369 s to 0.498 s] | 3/3 opened, 1.572 s [1.507 s to 1.613 s] | 3/3 opened, 9.051 s [8.925 s to 9.364 s] |
| [Tool Kumar](https://tools.vikasmaur.com/) | paste | 3/3 opened, 0.358 s [0.343 s to 0.540 s] | 3/3 opened, 1.459 s [1.406 s to 1.504 s] | 3/3 opened, 8.720 s [8.367 s to 10.046 s] |
| [Code Beautify JSON Viewer](https://codebeautify.org/jsonviewer) | file | 3/3 opened, 4.220 s [3.906 s to 6.389 s] | 3/3 opened, 21.888 s [20.511 s to 21.900 s]; 3 browser memory stops after the view appeared | 3/3 exceeded memory cap |
| [JSON Beautifier](https://jsonbeautifier.org/) | file | 3/3 opened, 0.803 s [0.751 s to 0.961 s] | 3/3 opened, 5.510 s [5.305 s to 5.640 s] | 3/3 opened, 28.159 s [27.785 s to 29.351 s] |
| [JSON Viewer Stack](https://jsonviewer.stack.hu/) | paste | 3/3 opened, 0.639 s [0.614 s to 0.714 s] | 2/3 opened, 8.598 s [8.548 s to 8.647 s]; 1/3 view detected, interaction obstructed | 2/3 opened, 49.822 s [49.213 s to 50.430 s]; 1/3 view detected, interaction obstructed |
| [JSON Formatter Online](https://jsonformatter.com/) | paste | 3/3 opened, 0.461 s [0.427 s to 0.574 s] | 3/3 opened, 1.153 s [1.152 s to 1.204 s] | 3/3 no formatted view within 90 s |
| [JSONLint](https://jsonlint.com/) | paste | 3/3 opened, 6.432 s [5.775 s to 6.843 s] | 3/3 opened, 19.563 s [18.655 s to 20.103 s] | 1/3 unresponsive at 90 s; 2/3 exceeded memory cap |

[The six-tool comparison export](publish/comparison-summary.json) gives every source path and actual attempt. The earlier 2.5 GiB results remain in the original downloadable package and prior series. A memory stop after opening, an overlay, a timeout and a natural crash are different results.

### Earlier observations on the resized host

All rows below use the four-CPU host on October 17, 2026. Source versions, observation time, sample counts and the memory budget differ. The earlier b7157f6 single observations at 10 MB and 50 MB were lower than the new medians. They remain visible. The difference between these production series does not isolate a code regression or improvement. The local-build control above keeps the hardware and budget constant.

| Source and series | Browser budget | 1 MB file | 10 MB file | 50 MB file |
|---|---|---|---|---|
| b7157f6, earlier single observations | 2.5 GiB | 1 run; 0.675 s [0.675 s to 0.675 s] | 1 run; 1.160 s [1.160 s to 1.160 s] | 1 run; 5.049 s [5.049 s to 5.049 s] |
| 925fc3c, earlier repeat | 2.5 GiB | 3 runs; 0.420 s [0.392 s to 0.671 s] | 3 runs; 1.720 s [1.565 s to 1.745 s] | 3 runs; 10.785 s [9.192 s to 11.763 s] |
| 925fc3c, current comparison | 6 GiB | 3/3 opened, 0.383 s [0.369 s to 0.498 s] | 3/3 opened, 1.572 s [1.507 s to 1.613 s] | 3/3 opened, 9.051 s [8.925 s to 9.364 s] |

The downloadable results retain the earlier b7157f6 observations in retainedSeries and the earlier 925fc3c repeat in currentOnly. Their exact times and raw paths remain dated separately.

## Formatted output and an editable input are different milestones

The polled metric is the original visible-output predicate followed by two frames. The in-page observer runs that predicate within the page. Two frames is a frame bound, not a compositor timestamp. An enabled input is a separate DOM observation and is not proof that the whole document can be edited. We did not isolate the earliest possible full-document editing time for every tool. Some editors expose an enabled control before source loading finishes, while virtual editors expose only a passage. The later reversible probe and preparation also delay verification. The reversible space/Undo probe and full typing profiles provide stronger input evidence. A quiet Tool Kumar input receives a public activation click outside opening timing. Its total input-enabled interval includes that delayed click. Read-only defaults remain separate from Edit anyway.

| Tool | Size | Path | Runs | Polled output | In-page DOM | Two frames | Input enabled | Activation click to enabled | Reversible character probe |
|---|---|---|---|---|---|---|---|---|---|
| Tool Kumar | 1 MB | file | 3 | 0.383 s [0.369 s to 0.498 s] | 0.239 s [0.221 s to 0.359 s] | 0.328 s [0.311 s to 0.453 s] | 0.767 s [0.750 s to 0.881 s] | 0.055 s [0.045 s to 0.085 s] | 3/3 verified character edit |
| Tool Kumar | 10 MB | file | 3 | 1.572 s [1.507 s to 1.613 s] | 1.477 s [1.417 s to 1.519 s] | 1.499 s [1.440 s to 1.550 s] | 2.792 s [2.660 s to 2.882 s] | 0.164 s [0.089 s to 0.166 s] | 3/3 verified character edit |
| Tool Kumar | 50 MB | file | 3 | 9.051 s [8.925 s to 9.364 s] | 8.935 s [8.835 s to 9.269 s] | 8.960 s [8.860 s to 9.295 s] | Not measured | Not measured | 3/3 read-only by default |
| Code Beautify JSON Viewer | 1 MB | file | 3 | 4.220 s [3.906 s to 6.389 s] | 2.305 s [1.907 s to 3.471 s] | 4.049 s [3.767 s to 5.226 s] | 0.005 s [0.003 s to 0.156 s] | Not measured | 3/3 verified character edit |
| Code Beautify JSON Viewer | 10 MB | file | 3 | 21.888 s [20.511 s to 21.900 s] | 6.224 s [4.863 s to 6.552 s] | 20.602 s [19.873 s to 21.129 s] | 0.007 s [0.005 s to 0.011 s] | Not measured | 3/3 could not be checked |
| Code Beautify JSON Viewer | 50 MB | file | 3 | Not measured | Not measured | Not measured | Not measured | Not measured | 3/3 not reached |
| JSON Beautifier | 1 MB | file | 3 | 0.803 s [0.751 s to 0.961 s] | 0.650 s [0.628 s to 0.776 s] | 0.670 s [0.650 s to 0.834 s] | 0.007 s [0.006 s to 0.009 s] | Not measured | 3/3 verified character edit |
| JSON Beautifier | 10 MB | file | 3 | 5.510 s [5.305 s to 5.640 s] | 5.118 s [4.906 s to 5.198 s] | 5.253 s [5.051 s to 5.350 s] | 0.003 s [0.001 s to 0.005 s] | Not measured | 3/3 verified character edit |
| JSON Beautifier | 50 MB | file | 3 | 28.159 s [27.785 s to 29.351 s] | 24.236 s [24.032 s to 25.207 s] | 25.307 s [25.114 s to 26.267 s] | 0.008 s [0.007 s to 0.013 s] | Not measured | 3/3 verified character edit |
| JSON Viewer Stack | 1 MB | paste | 3 | 0.639 s [0.614 s to 0.714 s] | 0.543 s [0.511 s to 0.588 s] | 0.584 s [0.532 s to 0.617 s] | 0.327 s [0.318 s to 0.365 s] | Not measured | 3/3 verified character edit |
| JSON Viewer Stack | 10 MB | paste | 3 | 8.598 s [8.548 s to 8.647 s] | 8.473 s [8.441 s to 8.505 s] | 8.524 s [8.477 s to 8.571 s] | 2.786 s [2.780 s to 2.793 s] | Not measured | 1/3 not reached; 2/3 verified character edit |
| JSON Viewer Stack | 50 MB | paste | 3 | 49.822 s [49.213 s to 50.430 s] | 49.754 s [49.129 s to 50.379 s] | 49.770 s [49.145 s to 50.395 s] | 14.122 s [13.782 s to 14.463 s] | Not measured | 1/3 not reached; 2/3 could not be checked |
| JSON Formatter Online | 1 MB | paste | 3 | 0.461 s [0.427 s to 0.574 s] | 0.289 s [0.249 s to 0.371 s] | 0.298 s [0.258 s to 0.380 s] | 0.124 s [0.118 s to 0.128 s] | Not measured | 3/3 verified character edit |
| JSON Formatter Online | 10 MB | paste | 3 | 1.153 s [1.152 s to 1.204 s] | 0.986 s [0.978 s to 1.040 s] | 1.026 s [1.019 s to 1.082 s] | 0.371 s [0.367 s to 0.405 s] | Not measured | 3/3 verified character edit |
| JSON Formatter Online | 50 MB | paste | 3 | Not measured | Not measured | Not measured | Not measured | Not measured | 3/3 not reached |
| JSONLint | 1 MB | paste | 3 | 6.432 s [5.775 s to 6.843 s] | 5.578 s [5.336 s to 5.854 s] | 6.184 s [5.557 s to 6.535 s] | 0.015 s [0.006 s to 0.020 s] | Not measured | 3/3 verified character edit |
| JSONLint | 10 MB | paste | 3 | 19.563 s [18.655 s to 20.103 s] | 13.755 s [13.709 s to 13.762 s] | 14.225 s [14.075 s to 18.603 s] | 0.876 s [0.006 s to 0.916 s] | Not measured | 3/3 could not be checked |
| JSONLint | 50 MB | paste | 3 | Not measured | Not measured | Not measured | Not measured | Not measured | 3/3 not reached |

The typing profiles separately time the public Edit anyway click to the enabled-input DOM check. This excludes opening and earlier preparation. It is not the time of the first successful key.

| Tool | Data size | Source format | Confirmed / activated profiles | Click to enabled median | Observed range |
|---|---|---|---|---|---|
| Tool Kumar | 10 MB | prettified | 3/3 | 236.8 ms | 216.4 ms to 271.6 ms |
| Tool Kumar | 50 MB | minified | 3/3 | 64.2 ms | 61.0 ms to 77.0 ms |
| Tool Kumar | 50 MB | prettified | 3/3 | 889.1 ms | 889.1 ms to 1056.8 ms |

## Editing large JSON

The new six-tool typing series uses the same 6 GiB browser budget for every tool. Each minified and two-space prettified cell has three scheduled fresh-profile attempts at 100 KB, 1 MB and 10 MB of minified data. The pretty file has more bytes. A 50 MB competitor cell is attempted only if its input is confirmed editable; Tool Kumar clicks Edit anyway. The same unique email carets lie in the first, middle and last records. The twenty-character burst is requested at ten characters per second. Enter, Backspace, a 200-character paste, Undo and scrolling are separate probes. Failed or blocked cells stay visible.

| Tool | Input editor | Output design |
|---|---|---|
| Tool Kumar | Custom virtual editor with a native textarea passage; Native textarea with virtual syntax highlighting | Live formatted view |
| Code Beautify JSON Viewer | Ace input, JSONEditor tree output | Auto Update enabled by default |
| JSON Beautifier | Ace | Beautify button |
| JSON Viewer Stack | Textarea, Ext tree output | Viewer tab |
| JSON Formatter Online | CodeMirror | Format button rewrites the same editor |
| JSONLint | Monaco | Validate and Prettify rewrite the same editor |

Event Timing observes event-to-presentation durations at or above 16 ms. Missing faster events are censored, not zero. The rAF cross-check records trusted keydown to the next animation frame; it is not a compositor timestamp. Median and p95 require three complete matched profiles. A partial profile cannot supply a normal combined quantile. A whole-profile deadline can stop preparation before any burst. That is not assigned an ordinary-key freeze or latency. Raw status, preparation phase and reason remain in the download. Output latency starts at the final key and ends at the frame after the full marker is visibly rendered. Counts accompany output intervals. A public button is clicked only in button-driven tools, after a common 150 ms pause and a source check. That preparation is included in the final-key-to-output interval. Button-to-output values are separate in the download. For prettified input in JSON Formatter Online and JSONLint, the formatted view is also the input editor. Typing already changes that view. We do not assign a separate formatter-finish time from its button or a later DOM mutation. Raw observer intervals remain in the evidence and are excluded from the output summary.

| Tool | Format | Data size | Complete / attempted profiles | Typing outcome | Event median | Event p95 | rAF median | rAF p95 | Output update | Longest frame | Longest long task |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Tool Kumar | minified | 100 KB | 3/3 | measured | 88.0 ms | 216.0 ms | 72.5 ms | 198.2 ms | start: 262.9 ms in 3/3; middle: 240.2 ms in 3/3; end: 217.3 ms in 3/3 | 216.7 ms | 130.0 ms |
| Tool Kumar | prettified | 100 KB | 3/3 | measured | 32.0 ms | 40.0 ms | 25.5 ms | 34.0 ms | start: 320.2 ms in 3/3; middle: 312.6 ms in 3/3; end: 316.9 ms in 3/3 | 33.4 ms | No task at or above 50 ms recorded |
| Tool Kumar | minified | 1 MB | 3/3 | measured | 32.0 ms | 48.0 ms | 13.0 ms | 18.6 ms | start: 735.1 ms in 3/3; middle: Not confirmed; end: Not confirmed | 33.4 ms | No task at or above 50 ms recorded |
| Tool Kumar | prettified | 1 MB | 3/3 | measured | 24.0 ms | 40.0 ms | 15.3 ms | 19.0 ms | start: 766.8 ms in 3/3; middle: Not confirmed; end: Not confirmed | 33.3 ms | No task at or above 50 ms recorded |
| Tool Kumar | minified | 10 MB | 3/3 | measured | 32.0 ms | 56.0 ms | 9.6 ms | 26.1 ms | start: 2541.1 ms in 3/3; middle: 2536.0 ms in 3/3; end: 2371.9 ms in 3/3 | 66.7 ms | 54.0 ms |
| Tool Kumar | prettified | 10 MB; Edit anyway | 3/3 | measured | 24.0 ms | 40.0 ms | 10.9 ms | 19.4 ms | start: 2792.8 ms in 3/3; middle: 2750.8 ms in 3/3; end: 2723.9 ms in 2/3 | 33.3 ms | No task at or above 50 ms recorded |
| Tool Kumar | minified | 50 MB; Edit anyway | 3/3 | measured | 40.0 ms | 56.0 ms | 12.7 ms | 26.0 ms | start: 8987.1 ms in 3/3; middle: Not confirmed; end: Not confirmed | 99.9 ms | 90.0 ms |
| Tool Kumar | prettified | 50 MB; Edit anyway | 3/3 | measured | 56.0 ms | 72.0 ms | 30.9 ms | 50.6 ms | start: 9918.5 ms in 3/3; middle: Not confirmed; end: Not confirmed | 133.4 ms | 111.0 ms |
| Code Beautify JSON Viewer | minified | 100 KB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | prettified | 100 KB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | minified | 1 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | prettified | 1 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | minified | 10 MB | 0/3 | Memory watchdog stop during editing preparation | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | prettified | 10 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | minified | 50 MB | 0/0 | Not tested: No confirmed editable 50 MB input in the primary size checks | Not measured | Not measured | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | prettified | 50 MB | 0/0 | Not tested: No confirmed editable 50 MB input in the primary size checks | Not measured | Not measured | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Beautifier | minified | 100 KB | 3/4 | measured; partly measured | 176.0 ms | 272.0 ms | 57.9 ms | 128.9 ms | start: 314.9 ms in 3/4; middle: 369.9 ms in 1/4; end: 22.0 ms in 2/4 | 266.6 ms | 256.0 ms |
| JSON Beautifier | prettified | 100 KB | 3/3 | measured | 24.0 ms | 40.0 ms | 10.3 ms | 16.2 ms | start: 204.7 ms in 3/3; middle: 207.4 ms in 2/3; end: 216.1 ms in 2/3 | 16.8 ms | No task at or above 50 ms recorded |
| JSON Beautifier | minified | 1 MB | 3/6 | measured; partly measured | 1888.0 ms | 2376.0 ms | 1157.3 ms | 1556.3 ms | start: 2098.2 ms in 3/6; middle: Not confirmed; end: 2223.3 ms in 1/6 | 1883.2 ms | 1373.0 ms |
| JSON Beautifier | prettified | 1 MB | 3/3 | measured | 24.0 ms | 32.0 ms | 10.4 ms | 18.1 ms | start: 393.7 ms in 3/3; middle: 347.3 ms in 3/3; end: Not confirmed | 33.3 ms | No task at or above 50 ms recorded |
| JSON Beautifier | minified | 10 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| JSON Beautifier | prettified | 10 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: 1544.1 ms in 1/3; middle: Not confirmed; end: Not confirmed | 83.4 ms | 69.0 ms |
| JSON Beautifier | minified | 50 MB | 0/3 | Memory watchdog stop during editing preparation; crashed; unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| JSON Beautifier | prettified | 50 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | minified | 100 KB | 1/3 | could not be measured; measured | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | 16.8 ms | Not measured |
| JSON Viewer Stack | prettified | 100 KB | 0/3 | error | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | minified | 1 MB | 3/3 | measured | 3112.0 ms | 4016.0 ms | 3099.1 ms | 3999.0 ms | start: Not confirmed; middle: Not confirmed; end: Not confirmed | 3733.2 ms | 2767.0 ms |
| JSON Viewer Stack | prettified | 1 MB | 0/3 | error | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | minified | 10 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | prettified | 10 MB | 0/3 | error | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | minified | 50 MB | 0/0 | Not tested: No confirmed editable 50 MB input in the primary size checks | Not measured | Not measured | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | prettified | 50 MB | 0/0 | Not tested: No confirmed editable 50 MB input in the primary size checks | Not measured | Not measured | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Formatter Online | minified | 100 KB | 3/3 | measured | 40.0 ms | 48.0 ms | 17.6 ms | 25.1 ms | start: 241.2 ms in 3/3; middle: Not confirmed; end: Not confirmed | 33.4 ms | No task at or above 50 ms recorded |
| JSON Formatter Online | prettified | 100 KB | 3/3 | measured | 16.0 ms | 24.0 ms | 12.7 ms | 17.6 ms | Already formatted in the same editor; no distinct output interval | 16.8 ms | No task at or above 50 ms recorded |
| JSON Formatter Online | minified | 1 MB | 3/3 | measured | 40.0 ms | 56.0 ms | 22.0 ms | 32.4 ms | start: 284.7 ms in 3/3; middle: Not confirmed; end: Not confirmed | 183.4 ms | 63.0 ms |
| JSON Formatter Online | prettified | 1 MB | 3/3 | measured | 32.0 ms | 40.0 ms | 25.3 ms | 29.0 ms | Already formatted in the same editor; no distinct output interval | 100.1 ms | 75.0 ms |
| JSON Formatter Online | minified | 10 MB | 3/3 | measured | 64.0 ms | 112.0 ms | 50.6 ms | 82.7 ms | start: 792.1 ms in 3/3; middle: Not confirmed; end: Not confirmed | 150.0 ms | 105.0 ms |
| JSON Formatter Online | prettified | 10 MB | 3/3 | measured | 32.0 ms | 32.0 ms | 25.3 ms | 27.5 ms | Already formatted in the same editor; no distinct output interval | 100.0 ms | 75.0 ms |
| JSON Formatter Online | minified | 50 MB | 0/0 | Not tested: No confirmed editable 50 MB input in the primary size checks | Not measured | Not measured | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Formatter Online | prettified | 50 MB | 0/0 | Not tested: No confirmed editable 50 MB input in the primary size checks | Not measured | Not measured | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSONLint | minified | 100 KB | 2/4 | measured; partly measured | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | 149.9 ms | 125.0 ms |
| JSONLint | prettified | 100 KB | 0/4 | partly measured | Not measured | Not measured | Not measured | Not measured | Already formatted in the same editor; no distinct output interval | 166.6 ms | 113.0 ms |
| JSONLint | minified | 1 MB | 3/3 | measured | 2040.0 ms | 2912.0 ms | 2019.7 ms | 2870.5 ms | start: Not confirmed; middle: Not confirmed; end: Not confirmed | 2083.2 ms | 1483.0 ms |
| JSONLint | prettified | 1 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | Already formatted in the same editor; no distinct output interval | Not measured | Not measured |
| JSONLint | minified | 10 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| JSONLint | prettified | 10 MB | 0/3 | unresponsive during editing | Not measured | Not measured | Not measured | Not measured | Already formatted in the same editor; no distinct output interval | Not measured | Not measured |
| JSONLint | minified | 50 MB | 0/0 | Not tested: No confirmed editable 50 MB input in the primary size checks | Not measured | Not measured | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSONLint | prettified | 50 MB | 0/0 | Not tested: No confirmed editable 50 MB input in the primary size checks | Not measured | Not measured | Not measured | Not measured | Not confirmed | Not measured | Not measured |

If a virtual editor does not expose the source marker in its rendered DOM, the runner stops the timing observer and uses public Select all and Copy to check the full source in the browser clipboard. This is source correctness evidence, not a visible-output timestamp. Each affected first JSONLint 100 KB format received one documented corrected profile. JSON Beautifier's affected minified 100 KB and 1 MB profiles received one preparation correction each. Their warm-up Undo had left the source prettified at the first caret. The corrected preparation verifies public Ace focus, the fixture line count and its first email after trusted paste. At most one extra paste is permitted if the opening format remains. Original incomplete profiles remain counted. The 10 MB preparation timeouts do not establish that same first-caret defect and received no correction under this rule.



At 50 MB, every tool restores the source through trusted Undo and checks its exact clipboard hash between independent actions. At most four Undo commands precede one trusted source-paste fallback for an editor that rewrites or resets history. Hashing streams 1 MiB text chunks outside typing. The fallback and every source hash are recorded. Smaller cells keep the common trusted-paste restoration. No editor source model is changed directly. The prior Tool Kumar-only 50 MB series used a different restoration preparation and remains dated context. Post-burst browser, renderer and host-memory snapshots are retained per caret in the download. They include any output work completed before that snapshot and are not isolated memory costs per keystroke.

### Enter, Backspace, paste and Undo

[The editing detail tables](publish/editing-details.md) and [complete editing data](publish/comparison-summary.json) give operation median/p95, sample counts, Undo confirmation and each caret separately. Enter inside a string can temporarily invalidate JSON, so it does not give an output-update comparison. Operation intervals use trusted keydown to the next rAF. Input-event-to-frame bounds are also retained separately. Any Input.insertText fallback is labeled. A command frame alone does not confirm that the text changed. A fast Undo command is distinct from verification that the source was restored. The visible-output interval covers the valid twenty-character burst. We did not isolate a separate formatted-output completion time for Enter, Backspace, snippet paste or Undo in every tool. There is no historical typing baseline for `19b7ac7` or `aee1ae3`, so this study claims no measured typing speedup across those commits.

### Input scrolling

The input probe advances through twenty equal positions in its native scroll range at 50 ms intervals. These frame intervals describe that probe, not every wheel gesture. A one-line editor may scroll horizontally. When no native input range is exposed and the runner falls back to scrolling the page, that attempt supplies no input-scroll quantile. The fallback remains in the raw record.

| Tool | Format | Data size | Median frame | p95 frame | Longest frame | Outcome |
|---|---|---|---|---|---|---|
| Tool Kumar | minified | 100 KB | 16.7 ms | 50.0 ms | 66.6 ms | measured; measured; measured |
| Tool Kumar | prettified | 100 KB | 16.7 ms | 33.3 ms | 33.4 ms | measured; measured; measured |
| Tool Kumar | minified | 1 MB | 16.7 ms | 16.8 ms | 33.3 ms | measured; measured; measured |
| Tool Kumar | prettified | 1 MB | 16.7 ms | 16.8 ms | 83.4 ms | measured; measured; measured |
| Tool Kumar | minified | 10 MB | 16.7 ms | 33.3 ms | 383.3 ms | measured; measured; measured |
| Tool Kumar | prettified | 10 MB | 16.7 ms | 16.8 ms | 499.9 ms | measured; measured; measured |
| Tool Kumar | minified | 50 MB | 66.6 ms | 83.3 ms | 100.1 ms | measured; measured; measured |
| Tool Kumar | prettified | 50 MB | 16.7 ms | 33.4 ms | 33.4 ms | measured; measured; measured |
| Code Beautify JSON Viewer | minified | 100 KB | Not measured | Not measured | Not measured | Not reached |
| Code Beautify JSON Viewer | prettified | 100 KB | Not measured | Not measured | Not measured | Not reached |
| Code Beautify JSON Viewer | minified | 1 MB | Not measured | Not measured | Not measured | Not reached |
| Code Beautify JSON Viewer | prettified | 1 MB | Not measured | Not measured | Not measured | Not reached |
| Code Beautify JSON Viewer | minified | 10 MB | Not measured | Not measured | Not measured | Not reached |
| Code Beautify JSON Viewer | prettified | 10 MB | Not measured | Not measured | Not measured | Not reached |
| JSON Beautifier | minified | 100 KB | 16.7 ms | 16.7 ms | 16.8 ms | measured; measured; measured; measured |
| JSON Beautifier | prettified | 100 KB | 16.7 ms | 16.8 ms | 16.8 ms | measured; measured; measured |
| JSON Beautifier | minified | 1 MB | 33.4 ms | 66.7 ms | 1183.3 ms | measured; measured; measured; measured; measured; measured |
| JSON Beautifier | prettified | 1 MB | 16.7 ms | 16.8 ms | 33.3 ms | measured; measured; measured |
| JSON Beautifier | minified | 10 MB | Not measured | Not measured | Not measured | Not reached |
| JSON Beautifier | prettified | 10 MB | Not measured | Not measured | Not measured | Not reached |
| JSON Beautifier | minified | 50 MB | Not measured | Not measured | Not measured | Not reached |
| JSON Beautifier | prettified | 50 MB | Not measured | Not measured | Not measured | Not reached |
| JSON Viewer Stack | minified | 100 KB | 16.7 ms | 16.8 ms | 16.8 ms | measured |
| JSON Viewer Stack | prettified | 100 KB | Not measured | Not measured | Not measured | Not reached |
| JSON Viewer Stack | minified | 1 MB | 16.7 ms | 16.8 ms | 16.8 ms | measured; measured; measured |
| JSON Viewer Stack | prettified | 1 MB | Not measured | Not measured | Not measured | Not reached |
| JSON Viewer Stack | minified | 10 MB | Not measured | Not measured | Not measured | Not reached |
| JSON Viewer Stack | prettified | 10 MB | Not measured | Not measured | Not measured | Not reached |
| JSON Formatter Online | minified | 100 KB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | prettified | 100 KB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | minified | 1 MB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | prettified | 1 MB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | minified | 10 MB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | prettified | 10 MB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSONLint | minified | 100 KB | 16.7 ms | 16.8 ms | 83.4 ms | measured; measured; measured; measured |
| JSONLint | prettified | 100 KB | 16.7 ms | 16.8 ms | 16.8 ms | measured; measured; measured; measured |
| JSONLint | minified | 1 MB | 16.7 ms | 399.9 ms | 1466.7 ms | measured; measured; measured |
| JSONLint | prettified | 1 MB | Not measured | Not measured | Not measured | Not reached |
| JSONLint | minified | 10 MB | Not measured | Not measured | Not measured | Not reached |
| JSONLint | prettified | 10 MB | Not measured | Not measured | Not measured | Not reached |

### Opening minified and prettified copies

The data-size label refers to the minified export. Exact byte and line counts describe the larger pretty copy. The same public opening workflow runs before each typing profile. The counts include documented correction visits; those visits are distinct fresh profiles, and the raw records keep their retry flag. Failed opening observations stay outside the conditional timing and remain in the outcome ledger.

| Tool | Format | Data size | Actual bytes | Lines | Timed openings / attempted profiles | Opening median | Opening p95 |
|---|---|---|---|---|---|---|---|
| Tool Kumar | minified | 100 KB | 99638 | 1 | 3/3 | 0.582 s | 0.606 s |
| Tool Kumar | prettified | 100 KB | 186427 | 7945 | 3/3 | 0.399 s | 0.430 s |
| Tool Kumar | minified | 1 MB | 999554 | 1 | 3/3 | 0.341 s | 0.374 s |
| Tool Kumar | prettified | 1 MB | 1863123 | 79196 | 3/3 | 0.407 s | 0.503 s |
| Tool Kumar | minified | 10 MB | 9999719 | 1 | 3/3 | 1.490 s | 1.520 s |
| Tool Kumar | prettified | 10 MB | 18592911 | 788600 | 3/3 | 1.597 s | 1.600 s |
| Tool Kumar | minified | 50 MB | 49998859 | 1 | 3/3 | 8.579 s | 8.676 s |
| Tool Kumar | prettified | 50 MB | 92806317 | 3930172 | 3/3 | 11.020 s | 11.166 s |
| Code Beautify JSON Viewer | minified | 100 KB | 99638 | 1 | 3/3 | 2.166 s | 2.475 s |
| Code Beautify JSON Viewer | prettified | 100 KB | 186427 | 7945 | 3/3 | 2.110 s | 2.222 s |
| Code Beautify JSON Viewer | minified | 1 MB | 999554 | 1 | 3/3 | 3.914 s | 3.932 s |
| Code Beautify JSON Viewer | prettified | 1 MB | 1863123 | 79196 | 3/3 | 2.907 s | 3.014 s |
| Code Beautify JSON Viewer | minified | 10 MB | 9999719 | 1 | 3/3 | 20.850 s | 21.450 s |
| Code Beautify JSON Viewer | prettified | 10 MB | 18592911 | 788600 | 3/3 | 10.710 s | 11.458 s |
| JSON Beautifier | minified | 100 KB | 99638 | 1 | 4/4 | 0.311 s | 0.506 s |
| JSON Beautifier | prettified | 100 KB | 186427 | 7945 | 3/3 | 0.322 s | 0.325 s |
| JSON Beautifier | minified | 1 MB | 999554 | 1 | 6/6 | 0.777 s | 0.884 s |
| JSON Beautifier | prettified | 1 MB | 1863123 | 79196 | 3/3 | 0.811 s | 0.815 s |
| JSON Beautifier | minified | 10 MB | 9999719 | 1 | 3/3 | 5.316 s | 5.379 s |
| JSON Beautifier | prettified | 10 MB | 18592911 | 788600 | 3/3 | 5.497 s | 5.522 s |
| JSON Beautifier | minified | 50 MB | 49998859 | 1 | 2/3 | 27.489 s | 28.522 s |
| JSON Beautifier | prettified | 50 MB | 92806317 | 3930172 | 3/3 | 27.316 s | 27.729 s |
| JSON Viewer Stack | minified | 100 KB | 99638 | 1 | 1/3 | 0.226 s | 0.226 s |
| JSON Viewer Stack | prettified | 100 KB | 186427 | 7945 | 0/3 | Not measured | Not measured |
| JSON Viewer Stack | minified | 1 MB | 999554 | 1 | 3/3 | 0.649 s | 0.659 s |
| JSON Viewer Stack | prettified | 1 MB | 1863123 | 79196 | 0/3 | Not measured | Not measured |
| JSON Viewer Stack | minified | 10 MB | 9999719 | 1 | 3/3 | 8.710 s | 8.896 s |
| JSON Viewer Stack | prettified | 10 MB | 18592911 | 788600 | 0/3 | Not measured | Not measured |
| JSON Formatter Online | minified | 100 KB | 99638 | 1 | 3/3 | 0.284 s | 0.298 s |
| JSON Formatter Online | prettified | 100 KB | 186427 | 7945 | 3/3 | 0.284 s | 0.289 s |
| JSON Formatter Online | minified | 1 MB | 999554 | 1 | 3/3 | 0.362 s | 0.399 s |
| JSON Formatter Online | prettified | 1 MB | 1863123 | 79196 | 3/3 | 0.353 s | 0.354 s |
| JSON Formatter Online | minified | 10 MB | 9999719 | 1 | 3/3 | 1.208 s | 1.212 s |
| JSON Formatter Online | prettified | 10 MB | 18592911 | 788600 | 3/3 | 1.090 s | 1.101 s |
| JSONLint | minified | 100 KB | 99638 | 1 | 4/4 | 1.029 s | 1.897 s |
| JSONLint | prettified | 100 KB | 186427 | 7945 | 4/4 | 0.711 s | 1.020 s |
| JSONLint | minified | 1 MB | 999554 | 1 | 3/3 | 5.929 s | 6.514 s |
| JSONLint | prettified | 1 MB | 1863123 | 79196 | 3/3 | 1.676 s | 2.007 s |
| JSONLint | minified | 10 MB | 9999719 | 1 | 3/3 | 19.234 s | 21.900 s |
| JSONLint | prettified | 10 MB | 18592911 | 788600 | 3/3 | 10.443 s | 11.107 s |

### Historical typing observations

The original `19b7ac7` study and `aee1ae3` baseline did not measure typing. The October 16 two-CPU `b7157f6` refresh has one verified 100 KB profile per format, not a three-run baseline. Minified rAF median/p95 was 688.3/1,253.1 ms, while JSON Formatter Online recorded 51.4/83.7 ms. Tool Kumar's prettified source was 24.4/32.2 ms, beside JSON Formatter Online's 10.8/18.1 ms. Those historical competitor wins remain visible. The new series changes code, hardware and memory budget, so its difference cannot be assigned to code alone. Sources are in results/2026-10-16-refresh/editing-summary.json and the original raw references in that download.


The earlier 925fc3c repeat used a 2.5 GiB browser budget. At 50 MB it supplied prettified 0/4 complete matched profiles, minified 0/4 complete matched profiles. Those attempts included memory stops during source preparation and supplied no combined 50 MB typing quantile. They remain in the downloadable results. They are separate from the new 6 GiB profiles and their hash-verified Undo preparation. A preparation stop is not assigned a per-key latency.

### Failed and incomplete editing attempts

| Tool | Source | Outcome | Reason | Raw source |
|---|---|---|---|---|
| Code Beautify JSON Viewer | 100kb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing1__2026-10-17T18-59-06-031Z.json |
| Code Beautify JSON Viewer | 100kb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing2__2026-10-17T20-21-42-243Z.json |
| Code Beautify JSON Viewer | 100kb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing3__2026-10-17T21-02-40-101Z.json |
| Code Beautify JSON Viewer | 100kb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing1__2026-10-17T19-10-34-176Z.json |
| Code Beautify JSON Viewer | 100kb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing2__2026-10-17T20-12-46-736Z.json |
| Code Beautify JSON Viewer | 100kb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing3__2026-10-17T21-12-30-963Z.json |
| Code Beautify JSON Viewer | 1mb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing1__2026-10-17T19-22-39-447Z.json |
| Code Beautify JSON Viewer | 1mb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing2__2026-10-17T20-39-51-767Z.json |
| Code Beautify JSON Viewer | 1mb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing3__2026-10-17T21-19-50-826Z.json |
| Code Beautify JSON Viewer | 1mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing1__2026-10-17T19-42-18-379Z.json |
| Code Beautify JSON Viewer | 1mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing2__2026-10-17T20-28-45-817Z.json |
| Code Beautify JSON Viewer | 1mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing3__2026-10-17T21-31-24-518Z.json |
| Code Beautify JSON Viewer | 10mb | Memory watchdog stop during editing preparation | browser memory 6154 MiB exceeded the 6144 MiB cap | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing1__2026-10-17T19-49-59-338Z.json |
| Code Beautify JSON Viewer | 10mb | Memory watchdog stop during editing preparation | browser memory 6148 MiB exceeded the 6144 MiB cap | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing2__2026-10-17T20-59-25-369Z.json |
| Code Beautify JSON Viewer | 10mb | Memory watchdog stop during editing preparation | browser memory 6146 MiB exceeded the 6144 MiB cap | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing3__2026-10-17T21-39-06-960Z.json |
| Code Beautify JSON Viewer | 10mb-pretty | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing1__2026-10-17T19-58-45-642Z.json |
| Code Beautify JSON Viewer | 10mb-pretty | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing2__2026-10-17T20-50-12-958Z.json |
| Code Beautify JSON Viewer | 10mb-pretty | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing3__2026-10-17T21-50-10-706Z.json |
| JSON Beautifier | 100kb | partly measured | start: Ace caret clamped before target: {"method":"Ace public gotoLine, caret only","cursor":{"row":0,"column":1},"lines":7945,"requestedLine":1,"requestedColumn":354,"targetLineCharacters":1,"visibleSourcePrefix":"{"} | results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing2__2026-10-17T20-20-47-751Z.json |
| JSON Beautifier | 1mb | partly measured | start: Ace caret clamped before target: {"method":"Ace public gotoLine, caret only","cursor":{"row":0,"column":1},"lines":79196,"requestedLine":1,"requestedColumn":355,"targetLineCharacters":1,"visibleSourcePrefix":"{"} | results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing1__2026-10-17T19-28-09-152Z.json |
| JSON Beautifier | 1mb | partly measured | start: Ace caret clamped before target: {"method":"Ace public gotoLine, caret only","cursor":{"row":0,"column":1},"lines":79196,"requestedLine":1,"requestedColumn":355,"targetLineCharacters":1,"visibleSourcePrefix":"{"} | results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing2__2026-10-17T20-38-10-720Z.json |
| JSON Beautifier | 1mb | partly measured | start: Ace caret clamped before target: {"method":"Ace public gotoLine, caret only","cursor":{"row":0,"column":1},"lines":79196,"requestedLine":1,"requestedColumn":355,"targetLineCharacters":1,"visibleSourcePrefix":"{"} | results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing3__2026-10-17T21-21-15-854Z.json |
| JSON Beautifier | 10mb | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing1__2026-10-17T19-51-23-171Z.json |
| JSON Beautifier | 10mb | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing2__2026-10-17T20-58-34-066Z.json |
| JSON Beautifier | 10mb | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing3__2026-10-17T21-40-31-129Z.json |
| JSON Beautifier | 10mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing1__2026-10-17T20-00-02-692Z.json |
| JSON Beautifier | 10mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing2__2026-10-17T20-49-16-758Z.json |
| JSON Beautifier | 10mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing3__2026-10-17T21-52-31-313Z.json |
| JSON Beautifier | 50mb | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing1__2026-10-17T22-10-06-305Z.json |
| JSON Beautifier | 50mb | crashed | Runtime.evaluate: timeout 64586.386442999996ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing2__2026-10-17T22-33-37-144Z.json |
| JSON Beautifier | 50mb | Memory watchdog stop during editing preparation | browser memory 6145 MiB exceeded the 6144 MiB cap | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing3__2026-10-17T22-39-06-305Z.json |
| JSON Beautifier | 50mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing1__2026-10-17T22-17-50-729Z.json |
| JSON Beautifier | 50mb-pretty | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing2__2026-10-17T22-26-30-958Z.json |
| JSON Beautifier | 50mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 30000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing3__2026-10-17T22-46-42-714Z.json |
| JSON Viewer Stack | 100kb | could not be measured | interaction obstructed by another element | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing1__2026-10-17T19-01-09-368Z.json |
| JSON Viewer Stack | 100kb | could not be measured | interaction obstructed by another element | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing2__2026-10-17T20-20-29-829Z.json |
| JSON Viewer Stack | 100kb-pretty | error | error: Runtime.evaluate: timeout 89999.914643ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing1__2026-10-17T19-14-10-090Z.json |
| JSON Viewer Stack | 100kb-pretty | error | error: Runtime.evaluate: timeout 89999.905321ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing2__2026-10-17T20-09-59-975Z.json |
| JSON Viewer Stack | 100kb-pretty | error | error: Runtime.evaluate: timeout 89999.906347ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing3__2026-10-17T21-14-25-243Z.json |
| JSON Viewer Stack | 1mb-pretty | error | error: Runtime.evaluate: timeout 89999.887762ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing1__2026-10-17T19-44-35-456Z.json |
| JSON Viewer Stack | 1mb-pretty | error | error: Runtime.evaluate: timeout 89999.915127ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing2__2026-10-17T20-25-53-751Z.json |
| JSON Viewer Stack | 1mb-pretty | error | error: Runtime.evaluate: timeout 89999.90706900001ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing3__2026-10-17T21-33-44-430Z.json |
| JSON Viewer Stack | 10mb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing1__2026-10-17T19-52-13-586Z.json |
| JSON Viewer Stack | 10mb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing2__2026-10-17T20-57-10-637Z.json |
| JSON Viewer Stack | 10mb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing3__2026-10-17T21-41-25-129Z.json |
| JSON Viewer Stack | 10mb-pretty | error | error: Runtime.evaluate: timeout 89999.901186ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing1__2026-10-17T20-00-59-280Z.json |
| JSON Viewer Stack | 10mb-pretty | error | error: Runtime.evaluate: timeout 89999.907898ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing2__2026-10-17T20-47-29-275Z.json |
| JSON Viewer Stack | 10mb-pretty | error | error: Runtime.evaluate: timeout 89999.867241ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing3__2026-10-17T21-56-19-900Z.json |
| JSONLint | 100kb | partly measured | start: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing1__2026-10-17T19-03-54-543Z.json |
| JSONLint | 100kb | partly measured | middle: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing2__2026-10-17T20-17-32-250Z.json |
| JSONLint | 100kb-pretty | partly measured | end: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing1__2026-10-17T19-18-55-416Z.json |
| JSONLint | 100kb-pretty | partly measured | start: Missing source/output edit marker, unexpected trusted-key count or missing frame; middle: Missing source/output edit marker, unexpected trusted-key count or missing frame; end: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing1__2026-10-17T19-25-34-801Z.json |
| JSONLint | 100kb-pretty | partly measured | middle: Missing source/output edit marker, unexpected trusted-key count or missing frame; end: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing2__2026-10-17T20-07-32-664Z.json |
| JSONLint | 100kb-pretty | partly measured | end: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing3__2026-10-17T21-17-00-937Z.json |
| JSONLint | 1mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing1__2026-10-17T19-47-26-943Z.json |
| JSONLint | 1mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing2__2026-10-17T20-23-34-311Z.json |
| JSONLint | 1mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing3__2026-10-17T21-36-34-046Z.json |
| JSONLint | 10mb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing1__2026-10-17T19-55-58-249Z.json |
| JSONLint | 10mb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing2__2026-10-17T20-53-45-737Z.json |
| JSONLint | 10mb | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing3__2026-10-17T21-45-02-960Z.json |
| JSONLint | 10mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing1__2026-10-17T20-06-06-654Z.json |
| JSONLint | 10mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing2__2026-10-17T20-42-34-338Z.json |
| JSONLint | 10mb-pretty | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing3__2026-10-17T22-03-49-607Z.json |
| Code Beautify JSON Viewer | 50mb | Not tested | No confirmed editable 50 MB input in the primary size checks | results/2026-10-17-competitors-6g/skipped.jsonl |
| Code Beautify JSON Viewer | 50mb-pretty | Not tested | No confirmed editable 50 MB input in the primary size checks | results/2026-10-17-competitors-6g/skipped.jsonl |
| JSON Viewer Stack | 50mb | Not tested | No confirmed editable 50 MB input in the primary size checks | results/2026-10-17-competitors-6g/skipped.jsonl |
| JSON Viewer Stack | 50mb-pretty | Not tested | No confirmed editable 50 MB input in the primary size checks | results/2026-10-17-competitors-6g/skipped.jsonl |
| JSON Formatter Online | 50mb | Not tested | No confirmed editable 50 MB input in the primary size checks | results/2026-10-17-competitors-6g/skipped.jsonl |
| JSON Formatter Online | 50mb-pretty | Not tested | No confirmed editable 50 MB input in the primary size checks | results/2026-10-17-competitors-6g/skipped.jsonl |
| JSONLint | 50mb | Not tested | No confirmed editable 50 MB input in the primary size checks | results/2026-10-17-competitors-6g/skipped.jsonl |
| JSONLint | 50mb-pretty | Not tested | No confirmed editable 50 MB input in the primary size checks | results/2026-10-17-competitors-6g/skipped.jsonl |

The excluded first JSONLint 50 MB opening attempt may have overlapped a short local hash check. Its unresponsive outcome remains in the evidence. Its single isolated correction is used instead. Feature correction visits do not add a fourth primary opening sample. [Adapter corrections and isolation record](publish/comparison-retries.md) explain the changes. Safari-specific copying and offline worker retries remain untested.

## How large a file did each tool handle?

[Minified and prettified fixture hashes](publish/editing-fixtures.sha256.json) include the intermediate sizes. [Extended fixture hashes](publish/extra-fixtures.sha256.jsonl) record the 100 MB, 200 MB and 400 MB sources. The downloadable seeded generator accepts a third argument such as 100 or 200 for decimal MB.

These are tested brackets, not exact maximum sizes. The primary 1, 10 and 50 MB comparison has three scheduled attempts per cell. Gap and larger-size checks have one attempt per eligible cell. The predeclared primary sizes still run after a smaller failure. An exploratory gap is skipped if any earlier smaller primary or gap attempt failed to open or hit the watchdog. A tool climbs beyond 50 MB only if all of its primary 50 MB attempts opened without a watchdog stop. Thus an obstructed Stack attempt prevents its larger ladder even though two other 50 MB previews opened. Every 6 GiB browser run requires at least 8,000 MiB host available memory to start. A later feature failure is shown beside opening, not hidden behind its timing.

| Tool | Largest formatted preview | Largest view without obstruction or browser stop | Smallest size with a view failure or browser stop | Sizes tried |
|---|---|---|---|---|
| Tool Kumar | 200 MB | 200 MB; 1/1 runs | 400 MB: no formatted view within 90 s | 1 MB, 5 MB, 10 MB, 25 MB, 50 MB, 100 MB, 200 MB, 400 MB |
| Code Beautify JSON Viewer | 10 MB | 1 MB; 3/3 runs | 5 MB: browser memory 6151 MiB exceeded the 6144 MiB cap | 1 MB, 5 MB, 10 MB, 50 MB |
| JSON Beautifier | 50 MB | 50 MB; 3/3 runs | 100 MB: crashed | 1 MB, 5 MB, 10 MB, 25 MB, 50 MB, 100 MB |
| JSON Viewer Stack | 50 MB | 50 MB; 2/3 runs | 10 MB: view detected, interaction obstructed | 1 MB, 5 MB, 10 MB, 50 MB |
| JSON Formatter Online | 25 MB | 25 MB; 1/1 runs | 50 MB: no formatted view within 90 s | 1 MB, 5 MB, 10 MB, 25 MB, 50 MB |
| JSONLint | 25 MB | 10 MB; 3/3 runs | 25 MB: browser memory 6390 MiB exceeded the 6144 MiB cap | 1 MB, 5 MB, 10 MB, 25 MB, 50 MB |

Public size-limit statements from the pages loaded in this refresh are listed below. A page with no matching statement is not treated as a promise of unlimited files. We did not infer a documented maximum from the browser cap.

| Tool | Loaded public page | Limit text observed |
|---|---|---|
| Tool Kumar | https://tools.vikasmaur.com/ | No size-limit statement found on the loaded page |
| Code Beautify JSON Viewer | https://codebeautify.org/jsonviewer | No size-limit statement found on the loaded page |
| JSON Beautifier | https://jsonbeautifier.org/ | No size-limit statement found on the loaded page |
| JSON Viewer Stack | https://jsonviewer.stack.hu/ | No size-limit statement found on the loaded page |
| JSON Formatter Online | https://jsonformatter.com/ | No size-limit statement found on the loaded page |
| JSONLint | https://jsonlint.com/ | No size-limit statement found on the loaded page |

Largest formatted preview includes a view detected before an overlay or later memory stop. Largest view without obstruction or browser stop requires the opening predicate to pass and the browser to finish the run without an overlay or watchdog stop. Its counts show how often that happened at the largest size. A later failed search, folding or editing probe stays in the feature matrix. These columns do not establish successful navigation or sustained editing. A cap message, a responsive minified editor, a hung page and a crash are separate outcomes. The first failure describes our browser, cap and fixture shape. It does not establish a product's universal file limit. Files with one long line can behave differently from files with many short lines.

### Earlier Tool Kumar-only 6 GiB capacity test

The resized instance had room to test beyond the old browser cap. On October 17, 2026, we repeated Tool Kumar capacity checks at `925fc3c` with a 6 GiB total-browser budget, instead of 2.5 GiB. The watchdog still stopped below 3,500 MiB of host available memory. Each run required at least 8,000 MiB available at its start. Browser, viewport, fixture generator, six-second settle and opening predicate stayed the same. Production evidence was unchanged before and after every accepted batch.

These are one-attempt exploratory size tests, not repeated performance estimates. They are separate from the earlier comparison and do not establish competitor limits under the larger budget. A formatted preview and completion of all navigation checks remain separate outcomes. Default input at these sizes is read-only. This ladder does not test editing above the original 50 MB data size.

| Source size | Actual bytes | Polled formatted view | Last-record search | Collapse | Scroll to end | Tree | Peak total browser | Full-run outcome |
|---|---|---|---|---|---|---|---|---|
| 100 MB | 99999788 | 21.362 s | ok | ok | ok | ok | 2819 MiB | Completed |
| 200 MB | 199999972 | 39.708 s | ok | ok | ok | ok | 5049 MiB | Completed |
| 400 MB | 399999594 | no formatted view within 90 s | Not reached | Not reached | Not reached | Not reached | 430 MiB | no formatted view within 90 s |

The [public large-file guide](https://tools.vikasmaur.com/tools/large-json-viewer) states a 300 MB safety limit. The pinned source implements 300 MiB, or 314,572,800 bytes. The 400 MB fixture exceeds that guard and produced no formatted view within 90 s. The browser watchdog did not stop that run. The largest successful fixture here is 200 MB; we did not measure the exact boundary between 200 MB and the guard.

### Earlier Tool Kumar-only 50 MB typing test

These earlier Tool Kumar-only profiles are not pooled with the new six-tool typing results. They click Edit anyway and use the same first, middle and last record carets, twenty trusted CDP characters at ten per second, Enter, Backspace, a 200-character paste, Undo and input-scrolling checks. The minified and prettified sources contain the same data. The larger pretty file has its own byte count and hash. Preparation uses trusted Undo, with an exact source hash checked at the end. Values below combine only three complete matched profiles. Failed profiles remain outcomes in the download. Event Timing and the rAF cross-check retain the threshold and frame limitations described in the main editing section.

| Source format | Actual bytes | Complete profiles / attempts | Event median | Event p95 | rAF median | rAF p95 | Output update | Longest frame | Longest long task |
|---|---|---|---|---|---|---|---|---|---|
| prettified | 92806317 | 3/3 | 56.0 ms | 96.0 ms | 36.1 ms | 64.1 ms | start: Not confirmed; middle: Not confirmed; end: Not confirmed | 83.3 ms | 79.0 ms |
| minified | 49998859 | 3/3 | 48.0 ms | 104.0 ms | 10.2 ms | 63.3 ms | start: 9755.1 ms in 2/3 profiles; middle: Not confirmed; end: Not confirmed | 166.7 ms | 159.0 ms |

The minified start position supplied confirmed visible-output intervals in two of three profiles, 9.755 s and 10.093 s after the final key. Other positions and the prettified profiles did not supply confirmed intervals within the observer window. Later public-search diagnostics sometimes found the marker, which establishes eventual content, not its update time. The successful typing profiles do not establish equally fast formatted-output updates.

The separate capacity download includes per-operation frame times, Undo confirmation, source hash checks, scrolling frames, individual caret positions and every incomplete attempt. A failure in caret preparation is not assigned a keystroke latency.

[Supplemental capacity measurements](publish/capacity-summary.json) contain fixture hashes, limits, raw-source references, failed attempts and deployment checks. A stop at the new budget would still be a benchmark stop, not a universal maximum file size.

## Which features still worked at each size?

Search passes only when the unique last-record marker is rendered. A collapsed tree that shows the final root member does not prove that every nested record is reachable. A match counter alone does not pass. Scroll-to-end requires the final record or final member in the public view. A default read-only Tool Kumar input can still become editable with Edit anyway; its full typing rows show that separate action. Code editors' folds are separate from a tree viewer. A not-available field means no recognized control was available to this probe, not a promise that no other public operation exists.

| Tool | Data size | Opening outcome | Tree | Last-record search | Collapse | Scroll to end | Input probe |
|---|---|---|---|---|---|---|---|
| Tool Kumar | 1 MB | 3/3 ok | 3/3 ok | 3/3 ok; median 93.0 ms | 3/3 ok; median 114.0 ms | 3/3 ok | 3/3 verified character edit |
| Tool Kumar | 5 MB | 1/1 ok | 1/1 ok | 1/1 ok; median 86.0 ms | 1/1 ok; median 107.0 ms | 1/1 ok | 1/1 verified character edit |
| Tool Kumar | 10 MB | 3/3 ok | 3/3 ok | 3/3 ok; median 89.0 ms | 3/3 ok; median 120.0 ms | 3/3 ok | 3/3 verified character edit |
| Tool Kumar | 25 MB | 1/1 ok | 1/1 ok | 1/1 ok; median 199.0 ms | 1/1 ok; median 178.0 ms | 1/1 ok | 1/1 read-only by default |
| Tool Kumar | 50 MB | 3/3 ok | 3/3 ok | 3/3 ok; median 251.0 ms | 3/3 ok; median 323.0 ms | 3/3 ok | 3/3 read-only by default |
| Tool Kumar | 100 MB | 1/1 ok | 1/1 ok | 1/1 ok; median 349.0 ms | 1/1 ok; median 742.0 ms | 1/1 ok | 1/1 read-only by default |
| Tool Kumar | 200 MB | 1/1 ok | 1/1 ok | 1/1 ok; median 433.0 ms | 1/1 ok; median 1253.0 ms | 1/1 ok | 1/1 read-only by default |
| Tool Kumar | 400 MB | 1/1 no formatted view within 90 s | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| Code Beautify JSON Viewer | 1 MB | 3/3 ok | 3/3 visible | 3/3 ok; median 21008.0 ms | 3/3 ok; median 3862.0 ms | 3/3 ok | 3/3 verified character edit |
| Code Beautify JSON Viewer | 5 MB | 1/1 ok | 1/1 visible | 1/1 unresponsive at 30 s | 1/1 not tested after previous feature froze | 1/1 ok | 1/1 could not be checked |
| Code Beautify JSON Viewer | 10 MB | 3/3 ok | 3/3 visible | 3/3 unresponsive at 30 s | 3/3 not tested after previous feature froze | 3/3 ok | 3/3 could not be checked |
| Code Beautify JSON Viewer | 50 MB | 3/3 exceeded memory cap | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached |
| JSON Beautifier | 1 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok; median 93.0 ms | 2/3 not available; 1/3 ok; median 131.0 ms | 3/3 ok | 3/3 verified character edit |
| JSON Beautifier | 5 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok; median 116.0 ms | 1/1 ok; median 235.0 ms | 1/1 ok | 1/1 verified character edit |
| JSON Beautifier | 10 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok; median 265.0 ms | 2/3 not available; 1/3 ok; median 1250.0 ms | 3/3 ok | 3/3 verified character edit |
| JSON Beautifier | 25 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok; median 991.0 ms | 1/1 not available | 1/1 could not be checked | 1/1 verified character edit |
| JSON Beautifier | 50 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok; median 1810.0 ms | 2/3 not available; 1/3 ok; median 11023.0 ms | 3/3 could not be checked | 3/3 verified character edit |
| JSON Beautifier | 100 MB | 1/1 crashed | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| JSON Viewer Stack | 1 MB | 3/3 ok | 3/3 visible | 3/3 not available | 3/3 ok; median 360.0 ms | 3/3 ok | 3/3 verified character edit |
| JSON Viewer Stack | 5 MB | 1/1 ok | 1/1 visible | 1/1 not available | 1/1 ok; median 401.0 ms | 1/1 ok | 1/1 verified character edit |
| JSON Viewer Stack | 10 MB | 1/3 view detected, interaction obstructed; 2/3 ok | 1/3 not reached; 2/3 visible | 1/3 not reached; 2/3 not available | 1/3 not reached; 2/3 ok; median 601.0 ms | 1/3 not reached; 2/3 ok | 1/3 not reached; 2/3 verified character edit |
| JSON Viewer Stack | 50 MB | 1/3 view detected, interaction obstructed; 2/3 ok | 1/3 not reached; 2/3 visible | 1/3 not reached; 2/3 not available | 1/3 not reached; 2/3 ok; median 2832.0 ms | 1/3 not reached; 2/3 ok | 1/3 not reached; 2/3 could not be checked |
| JSON Formatter Online | 1 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok; median 484.0 ms | 3/3 no result within 30 s | 3/3 ok | 3/3 verified character edit |
| JSON Formatter Online | 5 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok; median 944.0 ms | 1/1 no result within 30 s | 1/1 ok | 1/1 verified character edit |
| JSON Formatter Online | 10 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok; median 2084.0 ms | 3/3 no result within 30 s | 3/3 ok | 3/3 verified character edit |
| JSON Formatter Online | 25 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok; median 12917.0 ms | 1/1 no result within 30 s | 1/1 ok | 1/1 verified character edit |
| JSON Formatter Online | 50 MB | 3/3 no formatted view within 90 s | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached |
| JSONLint | 1 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok; median 192.0 ms | 3/3 ok; median 150.0 ms | 3/3 ok | 3/3 verified character edit |
| JSONLint | 5 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok; median 322.0 ms | 1/1 ok; median 243.0 ms | 1/1 ok | 1/1 could not be checked |
| JSONLint | 10 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok; median 214.0 ms | 3/3 ok; median 429.0 ms | 3/3 ok | 3/3 could not be checked |
| JSONLint | 25 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok; median 364.0 ms | 1/1 ok; median 25369.0 ms | 1/1 ok | 1/1 could not be checked |
| JSONLint | 50 MB | 1/3 unresponsive at 90 s; 2/3 exceeded memory cap | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached |

The JSON Formatter Online shortcut probe could fold inner nodes without collapsing the root. Later scheduled visits inspect and use an actual visible root fold control if offered. Shortcut failures are not evidence that no folding exists. The JSON Beautifier collapse adapter initially had no probe. One corrected 1 MB visit and the first 10 MB visit found no Linux fold-all binding. Later scheduled visits also look for a visible line-1 fold widget. The download preserves the actual control evidence. These probe limits are not converted into a product-wide claim that folding is absent.

## Memory

Renderer-to-view is the consistent opening window. Renderer memory is the largest renderer process's RSS plus swap. Browser memory sums the process tree. A failed opening's window ends at its stop, so its memory value does not imply a view appeared. Full-run renderer and browser peaks include later checks and advertising. The 6 GiB browser budget sums RSS plus swap across the process tree; shared pages can be counted more than once. These values are not JavaScript heap size. Compare the original 2.5 GiB and later 6 GiB series separately.

| Tool | Size | Runs | Renderer to view or stop median, MiB | Full renderer peak median, MiB | Full browser peak median, MiB | Cap stops |
|---|---|---|---|---|---|---|
| Tool Kumar | 1 MB | 3 | 182 | 222 | 522 | 0 |
| Tool Kumar | 5 MB | 1 | 232 | 324 | 625 | 0 |
| Tool Kumar | 10 MB | 3 | 436 | 568 | 869 | 0 |
| Tool Kumar | 25 MB | 1 | 788 | 827 | 1117 | 0 |
| Tool Kumar | 50 MB | 3 | 1168 | 1327 | 1616 | 0 |
| Tool Kumar | 100 MB | 1 | 2094 | 2547 | 2838 | 0 |
| Tool Kumar | 200 MB | 1 | 4767 | 4767 | 5048 | 0 |
| Tool Kumar | 400 MB | 1 | 147 | 147 | 433 | 0 |
| Code Beautify JSON Viewer | 1 MB | 3 | 697 | 2489 | 2836 | 0 |
| Code Beautify JSON Viewer | 5 MB | 1 | 1512 | 5811 | 6151 | 1 |
| Code Beautify JSON Viewer | 10 MB | 3 | 2474 | 5825 | 6160 | 3 |
| Code Beautify JSON Viewer | 50 MB | 3 | 5825 | 5825 | 6159 | 3 |
| JSON Beautifier | 1 MB | 3 | 378 | 466 | 771 | 0 |
| JSON Beautifier | 5 MB | 1 | 793 | 935 | 1235 | 0 |
| JSON Beautifier | 10 MB | 3 | 1164 | 1656 | 1958 | 0 |
| JSON Beautifier | 25 MB | 1 | 2645 | 2809 | 3107 | 0 |
| JSON Beautifier | 50 MB | 3 | 4792 | 4792 | 5084 | 0 |
| JSON Beautifier | 100 MB | 1 | 5235 | 5235 | 5534 | 0 |
| JSON Viewer Stack | 1 MB | 3 | 204 | 288 | 593 | 0 |
| JSON Viewer Stack | 5 MB | 1 | 412 | 951 | 1259 | 0 |
| JSON Viewer Stack | 10 MB | 3 | 665 | 1658 | 1975 | 0 |
| JSON Viewer Stack | 50 MB | 3 | 2709 | 5098 | 5487 | 0 |
| JSON Formatter Online | 1 MB | 3 | 156 | 212 | 515 | 0 |
| JSON Formatter Online | 5 MB | 1 | 210 | 329 | 634 | 0 |
| JSON Formatter Online | 10 MB | 3 | 285 | 421 | 717 | 0 |
| JSON Formatter Online | 25 MB | 1 | 462 | 675 | 973 | 0 |
| JSON Formatter Online | 50 MB | 3 | 1119 | 1119 | 1391 | 0 |
| JSONLint | 1 MB | 3 | 597 | 788 | 1141 | 0 |
| JSONLint | 5 MB | 1 | 1269 | 1544 | 1902 | 0 |
| JSONLint | 10 MB | 3 | 1671 | 2263 | 2598 | 0 |
| JSONLint | 25 MB | 1 | 2115 | 6039 | 6390 | 1 |
| JSONLint | 50 MB | 3 | 5705 | 5705 | 6146 | 2 |

In the original study, JSON Formatter Online used less renderer memory than Tool Kumar at 1 MB, 218 versus 241 MiB, and at 10 MB, 418 versus 488 MiB. Those historical wins remain valid for that setup. The new table supplies the higher-budget comparison.

## Select all, cut and paste

The current correctness probe sends trusted Ctrl+A, Ctrl+X and Ctrl+V without a DOM read or sleep between cut and paste. It then copies the restored input through Ctrl+A and Ctrl+C. Its SHA-256 must match the original fixture, and the input must remain editable. Three sequences run in the same fresh profile. This checks source preservation, not keystroke latency.

| Size | Edit anyway | Sequences | Outcome | Source |
|---|---|---|---|---|
| 10mb | False | 3 | passed | results/2026-10-17-925fc3c/results/raw/tool-kumar__10mb__refresh-file1__2026-10-17T08-00-38-815Z.json |
| 1mb | False | 3 | passed | results/2026-10-17-925fc3c/results/raw/tool-kumar__1mb__refresh-file1__2026-10-17T08-00-23-320Z.json |
| 50mb | True | 3 | passed | results/2026-10-17-925fc3c/results/raw/tool-kumar__50mb__refresh-file1__2026-10-17T08-01-34-565Z.json |
## Number fidelity


We checked a separate 425-byte synthetic document in the six tools, twice each in fresh profiles on October 15, 2026. We used the same file or paste path and default settings as the speed study. JSONLint needed the whitespace-only minified equivalent to expose Prettify; two initial harness attempts and one retry per run are documented in [the capture log](results/raw-fidelity/2026-10-15/RETRIES.md). We read the formatted text or displayed tree values, expanded the duplicate-key object, and saved text and screenshots. We did not grade the source editor, a hidden editor model or a downloaded file. The two runs agreed for every tool.

| Tool | Number values, 7 cases | Duplicate members | Representation notes, 6 cases |
|---|---|---|---|
| Tool Kumar | 7/7 kept | Both kept | All 6 spellings kept |
| Code Beautify JSON Viewer | 7/7 changed | Only a: 2 kept | 5 number spellings normalized; é kept |
| JSON Beautifier | 7/7 changed | Only a: 2 kept | 5 number spellings normalized; é kept |
| JSON Viewer Stack | 7/7 changed | Only a: 2 kept | 5 number spellings normalized; é kept |
| JSON Formatter Online | 7/7 changed | Only a: 2 kept | 5 number spellings normalized; é kept |
| JSONLint | 7/7 changed | Only a: 2 kept | 5 number spellings normalized; é kept |

JSONLint warned about unsafe-integer precision and duplicate keys during validation. Those warnings did not prevent the changes after Prettify.

The seven number cases are four integers beyond the safe-integer range, two long decimals and `1e400`. All five tools other than Tool Kumar displayed `9007199254756831` as `9007199254756832`. They displayed the 19-digit ID `1234567890123456789` as `1234567890123456800`, and `12345678901234567.89` as `12345678901234568`. Tool Kumar kept the source literals in both runs.

Overflow differed. JSON Viewer Stack displayed `1e400` as `Infinity`. Code Beautify, JSON Beautifier and JSON Formatter Online displayed `null`. JSONLint displayed `null`. Neither `Infinity` nor `null` preserves the original finite mathematical number. Tool Kumar displayed `1e400`. Each of the other five tools kept only `a: 2` from `{"a":1,"a":2}`. Duplicate names are an interoperability hazard because parsers handle them differently. Here, losing the first member counts as information loss, separately from numeric precision.

The representation notes are not failures. `1.0` becoming `1`, `1.50` becoming `1.5`, `1e2` or `1E+2` becoming `100`, and `-0` becoming `0` are treated as the same mathematical value for this check. Negative zero can matter to some programs, so its spelling is still recorded. The string `"é"` kept its character; tree labels can omit JSON quote marks. Tool Kumar kept all six spellings. Code Beautify also offers a "Big Num" checkbox, which was unchecked by default. We did not test that optional mode.

The [fixture](fidelity.json), [SHA-256](fidelity.sha256.json), [per-case verdicts](results/fidelity-summary.json) and capture references in the downloadable results make these statements checkable. Tool Kumar production visits recorded remote main `e84bb4295cc1ec0c02e940f78313a2f2aa72ed50` before testing; this is the remote-main reference, not an independent attestation of the deployed bundle's commit. These are small-document observations on one date, not proof that every operation or export preserves every JSON value.


### Latest Tool Kumar check

| Path | Rendered view | Number values | Duplicate members | Source |
|---|---|---|---|---|
| Small document | format | 7/7 kept | kept | results/2026-10-17-925fc3c/results/raw-fidelity/2026-10-17/tool-kumar__run1__2026-10-17T07-55-23-842Z.json |
| Small document | format | 7/7 kept | kept | results/2026-10-17-925fc3c/results/raw-fidelity/2026-10-17/tool-kumar__run2__2026-10-17T08-00-09-899Z.json |
| After edit and packed-tree reply | format | 7/7 kept | kept | results/2026-10-17-925fc3c/results/raw-fidelity/2026-10-17/tool-kumar__run3__2026-10-17T07-53-31-023Z.json |
| After edit and packed-tree reply | tree | 7/7 kept | kept | results/2026-10-17-925fc3c/results/raw-fidelity/2026-10-17/tool-kumar__run3__2026-10-17T07-53-31-023Z.json |
| After edit and packed-tree reply | format | 7/7 kept | kept | results/2026-10-17-925fc3c/results/raw-fidelity/2026-10-17/tool-kumar__run4__2026-10-17T07-55-37-244Z.json |
| After edit and packed-tree reply | tree | 7/7 kept | kept | results/2026-10-17-925fc3c/results/raw-fidelity/2026-10-17/tool-kumar__run4__2026-10-17T07-55-37-244Z.json |

The small fixture alone cannot test the new worker path. The second fixture adds a 2,100,000-character string without changing any numeric case. After opening it, we insert a space through the input, wait for a worker reply containing a packed tree, then capture Format and Tree separately. We grade rendered text with exact decimal arithmetic. Internal worker messages confirm which path ran; their values are not the graded output. This does not audit every export or every operation.

## Why the original native formatter was faster

JSON Formatter Online's inspected Format handler used `JSON.parse` and `JSON.stringify`. JavaScript's native number conversion is fast and can round JSON number literals. In the original Node check, that round trip changed 602 of 1,204 unsafe integer account numbers in the hashed 1 MB fixture. This is a script check, not a count from a competitor's large rendered output.

```js
JSON.stringify(JSON.parse('{"id":9007199254756831}'))
// '{"id":9007199254756832}'
```

The October 15 parser comparison pinned Tool Kumar to `e84bb4295cc1ec0c02e940f78313a2f2aa72ed50`. Warm best paired parse-plus-format times were 21.0 ms for native versus 85.3 ms for Tool Kumar at 1 MB, and 296.7 ms versus 1,020.8 ms at 10 MB. The original Tool Kumar code also scheduled formatting after 60 ms for small documents or 250 ms for larger ones. Those facts explain part of the original gap. Node stage times cannot be subtracted from browser times to isolate rendering.

We repeated the stage check on 2026-10-17 with production parser and formatter copies pinned to `925fc3c6f004552a8cdea9628699de9735682d01`. We also timed the new source re-indenter, which writes formatted output before the node analysis.

| Fixture | Implementation | Cold parse / format / total, ms | Warm best, ms | Warm median, ms |
|---|---|---|---|---|
| 1 MB | native | 8.8 / 12.0 / 20.8 | 8.4 / 11.5 / 19.9 | 8.9 / 11.7 / 20.6 |
| 1 MB | tool-kumar | 59.8 / 116.5 / 176.3 | 41.7 / 24.8 / 69.4 | 44.6 / 41.0 / 87.9 |
| 1 MB | source-reindent | 0.0 / 76.0 / 76.0 | 0.0 / 26.9 / 26.9 | 0.0 / 42.7 / 42.7 |
| 10 MB | native | 143.2 / 174.2 / 317.4 | 84.4 / 128.8 / 213.2 | 88.8 / 129.6 / 219.4 |
| 10 MB | tool-kumar | 274.3 / 354.5 / 628.9 | 273.9 / 354.5 / 628.4 | 303.6 / 415.2 / 714.0 |
| 10 MB | source-reindent | 0.0 / 440.8 / 440.8 | 0.0 / 297.9 / 297.9 | 0.0 / 329.6 / 329.6 |

Each implementation and fixture runs in a fresh Node process. The first call is cold. The next five are warm. Reads, imports and explicit garbage collection sit outside the timed intervals. Stage bests and paired best totals can come from different calls. The source re-indenter's parse column only contains call overhead because that path formats source text directly. It is not a replacement for the later validation and tree analysis. [Latest parse-cost script](results/2026-10-17-925fc3c/parse-cost.mjs).

## What changed for Tool Kumar users?

The changes below were made after the first benchmark. They make this an optimized follow-up comparison. The retained competitor observations are dated separately. Competitors were not changed by us.

- [Output first, `f08ea76`](https://github.com/VikasMaur-2nd/tools/commit/f08ea76), October 15. A large document can show formatted text before the input editor, tree and statistics finish.
- [Warm the open path, `47a846b`](https://github.com/VikasMaur-2nd/tools/commit/47a846b), October 15. Opening a file no longer waits for the service worker to finish before warming the work it needs.
- [Virtual input, `de505fd`](https://github.com/VikasMaur-2nd/tools/commit/de505fd), October 15. The editor draws visible rows and uses a bounded native input passage for large documents.
- [Worker analysis and output, `2dfd33d`](https://github.com/VikasMaur-2nd/tools/commit/2dfd33d), October 15. Large-document typing moves analysis and output work off the page's main thread.
- [Packed parse, `31b8b6f`](https://github.com/VikasMaur-2nd/tools/commit/31b8b6f), October 16. The worker sends its parsed tree to the page, which rebuilds it in short slices between input events.
- [Editable up to 16 million characters, `611eea4`](https://github.com/VikasMaur-2nd/tools/commit/611eea4), October 16. The default editable range expands. Characters are not bytes; this does not mean a universal 16 MB limit.
- [Retry the editor module, `b7157f6`](https://github.com/VikasMaur-2nd/tools/commit/b7157f6), October 16. A failed module load can be retried when the large-document editor is needed.

The next changes belong to the current repeat. The commit links document their implementation. The measured opening, editing, search and correctness results above describe this build. They do not isolate each commit or verify every reported browser fix.

- [Share large-document edits, `eacc5c9`](https://github.com/VikasMaur-2nd/tools/commit/eacc5c9), October 16. The editor changes how it stores edits to long documents.
- [Bound output updates, `e80c71a`](https://github.com/VikasMaur-2nd/tools/commit/e80c71a), October 16. The Format view splits output work across tasks.
- [Keep pasted documents editable, `94e1da0`](https://github.com/VikasMaur-2nd/tools/commit/94e1da0), October 17. Pasting a replacement source changes its editor activation path. The round-trip check above tests that behavior.
- [Retry worker startup, `925fc3c`](https://github.com/VikasMaur-2nd/tools/commit/925fc3c), October 17. Worker startup can retry after a failure. This study has not tested Safari repeat visits.

The default size threshold is an implementation detail linked above. Our fixtures test specific character counts; they do not locate the exact threshold boundary. The record for this article stops at the measured deployment. Later changes need another measurement before they can replace its numbers.

## The original 50 MB search failure and its fix

Tool Kumar at `19b7ac7` opened and collapsed 50 MB in all three runs. Its search reported "1 of 1" but did not render the last-record match in any run. Chromium clamped a requested scroll height of about 78.6 million pixels to 33,554,432 pixels. A successful opening had hidden a navigation failure.

Fix [`722ffec`](https://github.com/VikasMaur-2nd/tools/commit/722ffec) bounds the physical scroll height at 15,000,000 pixels. The October 15, 09:39 to 09:40 UTC production repeat rendered the final match and collapsed the file in all three runs. Its opening median was 10.449 s [10.241 s to 13.825 s], beside the original 9.857 s [9.165 s to 9.924 s]. Its renderer median was 1,499 MiB [1,467 to 1,518], beside the original 1,486 MiB [1,468 to 1,512]. The 6.0% slower opening in that shared-host repeat does not isolate the fix's effect. Both sets remain in the evidence. [Failure and re-verification](tool-kumar-scroll-limit.md).

## Method and reproducibility

The deterministic minified UTF-8 files model a synthetic customer API export. They include Unicode, emoji, escapes, unsafe integers and nesting to depth seven. Original sizes are 999,554 bytes, 9,999,719 bytes and 49,998,859 bytes. The 50 MB fixture has 60,051 records. Only its last record contains `TKLB-NEEDLE-LAST`. New intermediate sizes use the same seeded generator and have separate hashes. Every run records its file's SHA-256.

The browser is Chromium 145.0.7632.0 headless shell, at 1366 by 900, with GPU disabled. The latest six-tool series uses the 6 GiB browser budget for every tool. Historical and local-code results keep their original 2.5 GiB budget. The original ARM64 host had two CPUs and 7,801 MiB RAM. After the October 17 resize, the fresh series uses four CPUs and 15,759 MiB RAM. The earlier series keeps its 2.5 GiB cap. The latest comparison raises the common cap to 6 GiB and reports those observations separately. The complete environment is recorded in the download. Each observation starts a fresh profile, disables the browser cache, loads the public page and waits six seconds. Preparation and loading the synthetic clipboard into the page happen before timing. The earlier October 17 2.5 GiB series also interleaved Tool Kumar with competitors, with its actual partial counts preserved. The latest six-tool repeat interleaves all five competitors with Tool Kumar at the same memory budget. Earlier Tool Kumar-only checks remain dated separately.

Every timed run uses `flock --close` on the shared benchmark lock. Servers start outside that lock. Timed runs run alone. Load must be below 4 before taking it and before starting each run. Batches release the lock within about eight minutes. The watchdog samples every 200 ms. The latest six-tool series stops above 6 GiB across the browser tree or below 3,500 MiB host available memory, and requires at least 8,000 MiB available before a browser starts. Earlier 2.5 GiB runs keep their original 700 MiB floor and starting rules. These budgets are not mixed. Ending load can rise; we keep it in the record.

The opening deadline is 90 s. Polling can stop earlier if the protocol fails. We report elapsed-at-stop separately from the nominal deadline. Search and collapse each get one 30 s wall-clock budget. Ordinary wheel and PageDown probes follow opening. New scroll-to-end, tree and reversible edit checks run afterward. No ad is clicked, no challenge is bypassed, and there is at most one documented retry for a harness defect. A blocked page is not tested.

Before and after each batch we save remote main, GitHub's Production deployment and success status, the served page build token and script list. A batch with changed version evidence is invalidated and repeated. Each record names its measured commit and batch. This associates the page with a deployment; it does not pretend that remote main alone proves which bundle ran.

[The full methodology](methodology.md), [fixture generator](generate-fixtures.mjs), [hashes](fixtures.sha256.jsonl) and [downloadable results](publish/summary.json) document the procedure. The study's one-command `refresh.sh` reruns the Tool Kumar paths and regenerates its dated tables against a supplied URL and expected commit. It preserves earlier results.

Safari no-break-space copying and repeat-visit worker startup were not tested in this Chromium-only refresh. The developer reports are not study evidence. The draft makes no Safari verification claim.

## Limitations

A viewer, a text formatter and a validator do different work. The file and paste paths are not interchangeable. We retain default expansion, wrap and number-handling settings. Code Beautify's optional Big Num mode was not tested. The fidelity check covers selected literals and duplicate members, not every possible JSON document or export.

Small timing gaps inside the run spread, or below about 25% for operations under two seconds, are treated as ties. A lower median alone is not evidence of a universal speed lead. The shared host, advertisements, network, headless browser and memory cap limit the result. We did not run mobile input benchmarks or field Core Web Vitals measurements.

The earlier study could not test JSONFormatter, JSON Editor Online, Curious Concept or Dadroit V Web because of browser challenges or access blocks. FreeFormatter returned connection and access errors. JSON Crack's graph did not render even for its sample in the study browser. They remain outside this six-tool timing comparison. No challenge bypass or server upload was added for this refresh.

## FAQ

### Which tool should I try for a 50 MB JSON file?

Tool Kumar opened 3/3 attempts, with a 9.051 s file-path median. JSON Beautifier opened 3/3, with a 28.159 s median. Stack opened 2/3; the other attempt was obstructed. Code Beautify and JSONLint reached memory stops or unresponsiveness. JSON Formatter Online supplied no formatted view within 90 s. Read the feature and typing rows before treating an opening as proof of smooth editing. Tool Kumar's default read-only state can be changed with Edit anyway.

### Is JSON Formatter Online faster than Tool Kumar?

It won at 1 MB and 10 MB in the original study. In the new comparison, its 10 MB paste median was 1.153 s, below Tool Kumar's 1.459 s. That small paste comparison meets our stated tie rule; the lower median remains visible. It also used less renderer memory to the formatted view at 1 MB and 10 MB. The timing, spread, number-fidelity findings and later feature failures describe different tradeoffs.

### Does formatting keep large IDs exactly?

The October 15 default-mode fidelity check found that Tool Kumar kept all seven numeric cases. Each of the other five tools changed all seven and lost the first duplicate member. JSONLint warned before Prettify. The separate latest Tool Kumar check above is the evidence for the new worker and tree path. A number-spelling change such as `1.0` to `1` is a note, not a numeric-value failure here.

### Is a cap stop the tool's maximum file size?

No. It is the point where this study stopped the browser. More memory or a different browser could change the result. We report a tested success, a first observed failure and any limit found on the loaded public page separately.

### Can I edit a large document as soon as I see formatted output?

Not always. Tool Kumar draws output before some input and analysis work. Up to 16 million characters opens editable; our quiet inputs were activated with a click. The 50 MB fixture opens read-only and needs Edit anyway. A prettified copy can cross that character threshold even when its minified partner does not. Other tools can also render a view while input or later actions remain busy. Use the input-enabled observation, activation interval, reversible edit probe and full typing profiles together.

### Is minified JSON easier to edit?

A smaller file can still cost more to edit. A minified document puts all its text on one line. Wrapping or measuring that line can slow an editor. The prettified partner has more bytes and many short lines, which tests line indexing and virtualization instead. The editing table reports both formats separately. A fast opening does not establish fast typing.

### Does the before-and-after isolate the effect of code changes?

The historical production rows combine code changes with the host resize and different memory budgets. The separate local production-build control compares 19b7ac7, aee1ae3 and 925fc3c on the same four-CPU host with the same 2.5 GiB budget, three rounds per source and size. That comparison holds hardware constant. Shared-host pressure and observation time can still vary, so it retains the observed ranges.

### Why is output-update time separate from typing latency?

A source editor can respond to a key before its separate formatted view or tree updates. Some tools need a button or Viewer tab. We report typing frames and visible-output updates separately, with the workflow and confirmed interval counts. JSON Formatter Online and JSONLint use the same editor for source and formatted text. For already-prettified input, a separate formatting-finish timestamp could not be isolated fairly.

### Did Tool Kumar improve because this benchmark was used to optimize it?

Yes. The original measurements exposed slow paths and a 50 MB search defect. We changed Tool Kumar afterward and repeated the public workflows. We did not modify competitors. That advantage and the before-and-after results are disclosed near the top.

### Do these results establish privacy?

No. Fresh browser profiles and synthetic data reduce exposure in the experiment. No document marker was observed in requests from the tested local workflows in the original study. That is narrower than an audit of every data flow. The [separate privacy study](/blogs/json-formatter-privacy-study) describes its network checks and limits.

## Editorial options

Chosen headline: Large JSON benchmark: opening, typing and number fidelity

Alternative headlines:

- Minified vs. prettified JSON: opening and typing in six tools
- Large JSON files: what six browser tools could open and edit
