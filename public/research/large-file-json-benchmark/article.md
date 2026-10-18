# Large JSON benchmark: opening, typing and number fidelity

We first tested six browser JSON tools on October 15, 2026. Tool Kumar at `19b7ac7` opened our 1 MB, 10 MB and 50 MB files in median times of 0.890 s, 2.482 s and 9.857 s. We then changed Tool Kumar and measured it again. This update measures production `95945cd` on October 18, 2026. The October 17 report at `925fc3c` is the saved initial-results reference `TK-LFJSON-INITIAL-2026-10-17`.

Disclosure: Tool Kumar's maker ran this study. We optimized Tool Kumar after the first measurements. We did not change the competitors. Tool Kumar and JSON Formatter Online have fresh October 18 observations where the tables say so. Other competitor results remain dated October 17. Competitor number fidelity remains dated October 15. Historical results are kept under their measured commits. This is a draft for review.

Production deployment `7150826741` succeeded at `2026-10-18T06:16:56Z` for `95945cd06fbc70cfdf1cd85acaa38f1c86a4dc7a`. The served build token was `YV8u2eNrP_GoYaUSkqO5C`. Scripts used `/_next/static/immutable/chunks/`. Before and after every accepted batch, the runner checked remote main, deployment status and the served build. A changed batch does not enter the tables. The page itself does not independently expose the commit.

## What we found

Tool Kumar at `95945cd`, 1 MB through the file path: 3/3 opened, 0.336 s [0.331 s to 0.337 s].

Tool Kumar at `95945cd`, 10 MB through the file path: 3/3 opened, 1.433 s [1.421 s to 1.480 s].

Tool Kumar at `95945cd`, 50 MB through the file path: 3/3 opened, 8.307 s [8.269 s to 8.897 s].

At 1 MB through paste, Tool Kumar recorded 0.322 s [0.317 s to 0.338 s]; JSON Formatter Online recorded 0.461 s [0.427 s to 0.574 s]. Tool Kumar's observation is October 18. JSON Formatter Online's is October 17.

At 10 MB through paste, Tool Kumar recorded 1.370 s [1.358 s to 1.413 s]; JSON Formatter Online recorded 1.124 s [1.112 s to 1.138 s]. Tool Kumar's observation is October 18. JSON Formatter Online's is October 18.

This paste comparison meets the stated tie rule. The lower raw median remains visible. It does not establish a clear speed lead.

At 100 KB, Tool Kumar's minified Event Timing median/p95 changed from 88.0 ms / 216.0 ms at `925fc3c` to 32.0 ms / 40.0 ms at `95945cd`. The rAF medians were 72.5 ms and 12.4 ms. This is a dated shared-host comparison, not an isolated per-commit experiment.

At 100 KB, Tool Kumar's prettified Event Timing median/p95 changed from 32.0 ms / 40.0 ms at `925fc3c` to 32.0 ms / 48.0 ms at `95945cd`. The rAF medians were 25.5 ms and 25.2 ms. This is a dated shared-host comparison, not an isolated per-commit experiment.

For minified 50 MB JSON after Edit anyway, the confirmed first-caret visible-output median was 8987.1 ms at `925fc3c` and 326.8 ms at `95945cd`, in 3/3 new profiles. Other positions and missing intervals stay separate below.

Typing in that minified 50 MB source had Event Timing median/p95 40.0 ms / 56.0 ms at `925fc3c` and 40.0 ms / 64.0 ms at `95945cd`. The faster output claim is separate from typing response. Shared-host variation remains.

For prettified 50 MB JSON after Edit anyway, the confirmed first-caret visible-output median was 9918.5 ms at `925fc3c` and 353.1 ms at `95945cd`, in 3/3 new profiles. Other positions and missing intervals stay separate below.

Typing in that prettified 50 MB source had Event Timing median/p95 56.0 ms / 72.0 ms at `925fc3c` and 56.0 ms / 72.0 ms at `95945cd`. The faster output claim is separate from typing response. Shared-host variation remains.

JSON Beautifier, prettified 100 KB, had lower observed values on these measures: Event Timing median 24.0 ms beside Tool Kumar 32.0 ms; rAF median 10.3 ms beside 25.2 ms; Event Timing p95 40.0 ms beside Tool Kumar 48.0 ms; rAF p95 16.2 ms beside 36.1 ms. 2026-10-17; public site. Both cells have three complete matched profiles. These gaps are not a universal ranking.

JSON Formatter Online, prettified 100 KB, had lower observed values on these measures: Event Timing median 16.0 ms beside Tool Kumar 32.0 ms; rAF median 12.4 ms beside 25.2 ms; Event Timing p95 24.0 ms beside Tool Kumar 48.0 ms; rAF p95 17.5 ms beside 36.1 ms. 2026-10-18; public site. Both cells have three complete matched profiles. These gaps are not a universal ranking.

JSON Beautifier, prettified 1 MB, had lower observed values on these measures: rAF median 10.4 ms beside 12.2 ms; rAF p95 18.1 ms beside 18.5 ms. 2026-10-17; public site. Both cells have three complete matched profiles. These gaps are not a universal ranking.

The original JSON Formatter Online wins at 1 MB and 10 MB remain in the historical table. The same-hardware local control still shows a 50 MB precise DOM regression from 6.388 s at `19b7ac7` to 8.576 s at `925fc3c`. We did not rebuild that control for this update.

## Before and after

The first production comparison used a two-core host. The newer rounds used four cores and more RAM. Browser budgets also changed from 2.5 GiB to 6 GiB. Those production differences combine code, host and time effects. The separate local control holds hardware and its 2.5 GiB budget constant.

| Tool | Version | Date, UTC | Input path | Host | Browser budget | 1 MB | 10 MB | 50 MB |
|---|---|---|---|---|---|---|---|---|
| Tool Kumar | 19b7ac7, historical | 2026-10-15 | file | 2 CPUs; 7,801 MiB RAM | 2.5 GiB | 0.890 s | 2.482 s | 9.857 s |
| Tool Kumar | 925fc3c | 2026-10-17 | file | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 0.383 s [0.369 s to 0.498 s] | 3/3 opened, 1.572 s [1.507 s to 1.613 s] | 3/3 opened, 9.051 s [8.925 s to 9.364 s] |
| Tool Kumar | 95945cd | 2026-10-18 | file | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 0.336 s [0.331 s to 0.337 s] | 3/3 opened, 1.433 s [1.421 s to 1.480 s] | 3/3 opened, 8.307 s [8.269 s to 8.897 s] |
| Code Beautify JSON Viewer | Public site | October 17 | file | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 4.220 s [3.906 s to 6.389 s] | 3/3 opened, 21.888 s [20.511 s to 21.900 s]; 3 browser memory stops overall | 3/3 exceeded memory cap; 3 browser memory stops overall |
| JSON Beautifier | Public site | October 17 | file | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 0.803 s [0.751 s to 0.961 s] | 3/3 opened, 5.510 s [5.305 s to 5.640 s] | 3/3 opened, 28.159 s [27.785 s to 29.351 s] |
| JSON Viewer Stack | Public site | October 17 | paste | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 0.639 s [0.614 s to 0.714 s] | 2/3 opened, 8.598 s [8.548 s to 8.647 s]; 1/3 view detected, interaction obstructed | 2/3 opened, 49.822 s [49.213 s to 50.430 s]; 1/3 view detected, interaction obstructed |
| JSON Formatter Online | Public site | October 17; 10 MB October 18 | paste | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 0.461 s [0.427 s to 0.574 s] | 3/3 opened, 1.124 s [1.112 s to 1.138 s] | 3/3 no formatted view within 90 s |
| JSONLint | Public site | October 17 | paste | 4 CPUs; 15,759 MiB RAM | 6 GiB | 3/3 opened, 6.432 s [5.775 s to 6.843 s] | 3/3 opened, 19.563 s [18.655 s to 20.103 s] | 1/3 unresponsive at 90 s; 2/3 exceeded memory cap; 2 browser memory stops overall |

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

Three attempts per current opening cell. Tool Kumar is measured October 18 at `95945cd`. JSON Formatter Online 10 MB is also October 18. Every other competitor cell remains October 17. No retained observation is relabeled as a new visit. The same 6 GiB browser budget applies. A preview followed by a browser stop is not a usable-size pass.

| Tool | Input path | Date, 2026 UTC | 1 MB | 10 MB | 50 MB |
|---|---|---|---|---|---|
| [Tool Kumar](https://tools.vikasmaur.com/) | file | October 18 | 3/3 opened, 0.336 s [0.331 s to 0.337 s] | 3/3 opened, 1.433 s [1.421 s to 1.480 s] | 3/3 opened, 8.307 s [8.269 s to 8.897 s] |
| [Tool Kumar](https://tools.vikasmaur.com/) | paste | October 18 | 3/3 opened, 0.322 s [0.317 s to 0.338 s] | 3/3 opened, 1.370 s [1.358 s to 1.413 s] | Not tested |
| [Code Beautify JSON Viewer](https://codebeautify.org/jsonviewer) | file | October 17 | 3/3 opened, 4.220 s [3.906 s to 6.389 s] | 3/3 opened, 21.888 s [20.511 s to 21.900 s]; 3 browser memory stops overall | 3/3 exceeded memory cap; 3 browser memory stops overall |
| [JSON Beautifier](https://jsonbeautifier.org/) | file | October 17 | 3/3 opened, 0.803 s [0.751 s to 0.961 s] | 3/3 opened, 5.510 s [5.305 s to 5.640 s] | 3/3 opened, 28.159 s [27.785 s to 29.351 s] |
| [JSON Viewer Stack](https://jsonviewer.stack.hu/) | paste | October 17 | 3/3 opened, 0.639 s [0.614 s to 0.714 s] | 2/3 opened, 8.598 s [8.548 s to 8.647 s]; 1/3 view detected, interaction obstructed | 2/3 opened, 49.822 s [49.213 s to 50.430 s]; 1/3 view detected, interaction obstructed |
| [JSON Formatter Online](https://jsonformatter.com/) | paste | October 17; 10 MB October 18 | 3/3 opened, 0.461 s [0.427 s to 0.574 s] | 3/3 opened, 1.124 s [1.112 s to 1.138 s] | 3/3 no formatted view within 90 s |
| [JSONLint](https://jsonlint.com/) | paste | October 17 | 3/3 opened, 6.432 s [5.775 s to 6.843 s] | 3/3 opened, 19.563 s [18.655 s to 20.103 s] | 1/3 unresponsive at 90 s; 2/3 exceeded memory cap; 2 browser memory stops overall |

### Firefox opening supplement

These are fresh Firefox observations at `95945cd`. They use the same file hashes, viewport, settle time, done predicate, two frames and 6 GiB browser budget. Firefox has different launch settings and a Playwright transport. Its results stay separate from Chromium. No earlier matched Firefox baseline exists here, so this study cannot confirm or reject a reported 3% code regression.

| Size | Attempts | Outcome | Polled median and range | Precise DOM median | Two-frame median |
|---|---|---|---|---|---|
| 1 MB | 3 | {'ok': 3} | 0.303 s [0.293 s to 0.318 s] | 0.255 s [0.246 s to 0.264 s] | 0.274 s [0.265 s to 0.283 s] |
| 10 MB | 3 | {'ok': 3} | 2.799 s [2.782 s to 2.873 s] | 1.795 s [1.768 s to 1.850 s] | 1.856 s [1.855 s to 1.881 s] |
| 50 MB | 3 | {'ok': 3} | 14.172 s [13.981 s to 14.457 s] | 12.714 s [11.824 s to 12.906 s] | 12.723 s [12.511 s to 12.918 s] |

## Formatted output and an editable input are different milestones

The next table uses current Chromium file-path runs. The enabled-input observer looks for a populated enabled DOM input. It does not isolate the earliest successful whole-document edit for every editor. Quiet inputs may need a click. Full editing profiles below provide the later input evidence. The 50 MB fixture opens read-only by default and becomes editable after Edit anyway.

| Size | Runs | Polled formatted output | Precise DOM | Two frames | Enabled populated input | Activation to enabled input |
|---|---|---|---|---|---|---|
| 1 MB | 3 | 0.336 s [0.331 s to 0.337 s] | 0.208 s [0.207 s to 0.210 s] | 0.294 s [0.293 s to 0.297 s] | 0.720 s [0.705 s to 0.749 s] | 0.054 s [0.052 s to 0.054 s] |
| 10 MB | 3 | 1.433 s [1.421 s to 1.480 s] | 1.347 s [1.325 s to 1.420 s] | 1.369 s [1.348 s to 1.441 s] | 2.555 s [2.443 s to 2.647 s] | 0.156 s [0.067 s to 0.161 s] |
| 50 MB | 3 | 8.307 s [8.269 s to 8.897 s] | 8.205 s [8.203 s to 8.857 s] | 8.236 s [8.230 s to 8.884 s] | Not measured | Not measured |

## Editing large JSON

Each complete profile types twenty trusted CDP keys at requested 100 ms intervals at matched first, middle and last email values. It uses a reversible space and one-second warm-up. Combined quantiles require three profiles with all three positions. The columns keep Event Timing separate from the rAF bound. Event Timing has a 16 ms reporting threshold. Missing faster events are censored, not zero. A frame callback does not prove compositor paint.

The source-size label refers to minified data bytes. Its two-space copy contains the same tokens and more bytes. Tool Kumar now uses its custom editor for a line of at least 5,000 characters, including our minified 100 KB file. The actual editor observed in each new profile is recorded. Small short-line sources can still use a native textarea. At 50 MB, the profile clicks Edit anyway. Manual-button and same-editor output workflows are labeled separately.

| Tool | Input editor | Output design |
|---|---|---|
| Tool Kumar | Custom virtual editor with a native textarea passage | Live formatted view |
| Code Beautify JSON Viewer | Ace input, JSONEditor tree output | Auto Update enabled by default |
| JSON Beautifier | Ace | Beautify button |
| JSON Viewer Stack | Textarea, Ext tree output | Viewer tab |
| JSON Formatter Online | CodeMirror | Format button rewrites the same editor |
| JSONLint | Monaco | Validate and Prettify rewrite the same editor |

In button-based tools, the public action follows a common 150 ms pause and a source check. That delay is included in final-key-to-output timing. Separate button-to-output intervals remain in the download. For already-prettified JSON Formatter Online and JSONLint, source and formatted output share one editor. Their separate formatter-completion interval is excluded because it cannot be isolated fairly.

| Tool | Date and version | Format | Data size | Edit anyway | Complete / attempted | Event median | Event p95 | rAF median | rAF p95 | Visible-output update by position | Longest frame | Longest long task |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tool Kumar | 2026-10-18; 95945cd | minified | 100 KB | No | 3/3 | 32.0 ms | 40.0 ms | 12.4 ms | 15.5 ms | start: 177.4 ms in 3/3; middle: unconfirmed; end: unconfirmed | 16.8 ms | Not measured |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 100 KB | No | 3/3 | 32.0 ms | 48.0 ms | 25.2 ms | 36.1 ms | start: 300.0 ms in 3/3; middle: 303.4 ms in 3/3; end: 316.7 ms in 3/3 | 33.4 ms | Not measured |
| Tool Kumar | 2026-10-18; 95945cd | minified | 1 MB | No | 3/3 | 32.0 ms | 48.0 ms | 9.7 ms | 18.2 ms | start: 716.0 ms in 3/3; middle: unconfirmed; end: unconfirmed | 50.1 ms | 1387.0 ms |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 1 MB | No | 3/3 | 24.0 ms | 32.0 ms | 12.2 ms | 18.5 ms | start: 796.1 ms in 3/3; middle: unconfirmed; end: unconfirmed | 16.8 ms | Not measured |
| Tool Kumar | 2026-10-18; 95945cd | minified | 10 MB | No | 3/3 | 40.0 ms | 56.0 ms | 12.0 ms | 22.2 ms | start: 248.1 ms in 3/3; middle: 274.3 ms in 3/3; end: 248.1 ms in 3/3 | 66.8 ms | 55.0 ms |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 10 MB | Yes | 3/3 | 24.0 ms | 32.0 ms | 14.5 ms | 18.4 ms | start: 252.3 ms in 3/3; middle: 257.4 ms in 3/3; end: 254.1 ms in 3/3 | 33.4 ms | Not measured |
| Tool Kumar | 2026-10-18; 95945cd | minified | 50 MB | Yes | 3/3 | 40.0 ms | 64.0 ms | 7.6 ms | 28.9 ms | start: 326.8 ms in 3/3; middle: unconfirmed; end: unconfirmed | 99.9 ms | 86.0 ms |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 50 MB | Yes | 3/3 | 56.0 ms | 72.0 ms | 30.8 ms | 51.7 ms | start: 353.1 ms in 3/3; middle: unconfirmed; end: unconfirmed | 116.8 ms | 104.0 ms |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 100 KB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 100 KB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 1 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 1 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 10 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 10 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSON Beautifier | 2026-10-17; public site | minified | 100 KB | No | 3/4 | 176.0 ms | 272.0 ms | 57.9 ms | 128.9 ms | start: 314.9 ms in 3/4; middle: 369.9 ms in 1/4; end: 22.0 ms in 2/4 | 266.6 ms | 256.0 ms |
| JSON Beautifier | 2026-10-17; public site | prettified | 100 KB | No | 3/3 | 24.0 ms | 40.0 ms | 10.3 ms | 16.2 ms | start: 204.7 ms in 3/3; middle: 207.4 ms in 2/3; end: 216.1 ms in 2/3 | 16.8 ms | Not measured |
| JSON Beautifier | 2026-10-17; public site | minified | 1 MB | No | 3/6 | 1888.0 ms | 2376.0 ms | 1157.3 ms | 1556.3 ms | start: 2098.2 ms in 3/6; middle: unconfirmed; end: 2223.3 ms in 1/6 | 1883.2 ms | 1373.0 ms |
| JSON Beautifier | 2026-10-17; public site | prettified | 1 MB | No | 3/3 | 24.0 ms | 32.0 ms | 10.4 ms | 18.1 ms | start: 393.7 ms in 3/3; middle: 347.3 ms in 3/3; end: unconfirmed | 33.3 ms | Not measured |
| JSON Beautifier | 2026-10-17; public site | minified | 10 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSON Beautifier | 2026-10-17; public site | prettified | 10 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: 1544.1 ms in 1/3; middle: unconfirmed; end: unconfirmed | 83.4 ms | 69.0 ms |
| JSON Beautifier | 2026-10-17; public site | minified | 50 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSON Beautifier | 2026-10-17; public site | prettified | 50 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSON Viewer Stack | 2026-10-17; public site | minified | 100 KB | No | 1/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | 16.8 ms | Not measured |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 100 KB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSON Viewer Stack | 2026-10-17; public site | minified | 1 MB | No | 3/3 | 3112.0 ms | 4016.0 ms | 3099.1 ms | 3999.0 ms | start: unconfirmed; middle: unconfirmed; end: unconfirmed | 3733.2 ms | 2767.0 ms |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 1 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSON Viewer Stack | 2026-10-17; public site | minified | 10 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 10 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSON Formatter Online | 2026-10-18; public site | minified | 100 KB | No | 3/3 | 40.0 ms | 80.0 ms | 21.0 ms | 50.0 ms | start: 252.8 ms in 3/3; middle: unconfirmed; end: unconfirmed | 83.4 ms | 66.0 ms |
| JSON Formatter Online | 2026-10-18; public site | prettified | 100 KB | No | 3/3 | 16.0 ms | 24.0 ms | 12.4 ms | 17.5 ms | start: unconfirmed; middle: unconfirmed; end: unconfirmed | 16.8 ms | Not measured |
| JSON Formatter Online | 2026-10-17; public site | minified | 1 MB | No | 3/3 | 40.0 ms | 56.0 ms | 22.0 ms | 32.4 ms | start: 284.7 ms in 3/3; middle: unconfirmed; end: unconfirmed | 183.4 ms | 63.0 ms |
| JSON Formatter Online | 2026-10-17; public site | prettified | 1 MB | No | 3/3 | 32.0 ms | 40.0 ms | 25.3 ms | 29.0 ms | start: unconfirmed; middle: unconfirmed; end: unconfirmed | 100.1 ms | 75.0 ms |
| JSON Formatter Online | 2026-10-18; public site | minified | 10 MB | No | 3/3 | 64.0 ms | 112.0 ms | 51.6 ms | 83.9 ms | start: 764.1 ms in 3/3; middle: unconfirmed; end: unconfirmed | 150.0 ms | 106.0 ms |
| JSON Formatter Online | 2026-10-18; public site | prettified | 10 MB | No | 2/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | 100.0 ms | 74.0 ms |
| JSONLint | 2026-10-17; public site | minified | 100 KB | No | 2/4 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | 149.9 ms | 125.0 ms |
| JSONLint | 2026-10-17; public site | prettified | 100 KB | No | 0/4 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | 166.6 ms | 113.0 ms |
| JSONLint | 2026-10-17; public site | minified | 1 MB | No | 3/3 | 2040.0 ms | 2912.0 ms | 2019.7 ms | 2870.5 ms | start: unconfirmed; middle: unconfirmed; end: unconfirmed | 2083.2 ms | 1483.0 ms |
| JSONLint | 2026-10-17; public site | prettified | 1 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSONLint | 2026-10-17; public site | minified | 10 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |
| JSONLint | 2026-10-17; public site | prettified | 10 MB | No | 0/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured | start: unconfirmed; middle: unconfirmed; end: unconfirmed | Not measured | Not measured |

[Per-position editing details](publish/editing-details.md) include the editor design, fixture bytes, operation samples and incomplete attempts. Failed profiles remain outcomes. Their missing combined quantiles are not estimates of typing latency.

## Visible output after an edit

The clock starts at the final trusted keydown of a burst. It ends on the frame after the full changed marker appears inside the clipped output viewport. This is a scalar edit inside an email string. It does not measure every structural edit or setting. Input response and output completion are separate. Middle/end markers that remain offscreen do not supply visible-output intervals. Later search diagnostics cannot recover an earlier completion time.

| Tool Kumar version | Date | Format | Data size | Start median and confirmed profiles | Middle median and confirmed profiles | End median and confirmed profiles |
|---|---|---|---|---|---|---|
| 95945cd | 2026-10-18 | prettified | 100 KB | 300.0 ms; 3/3 | 303.4 ms; 3/3 | 316.7 ms; 3/3 |
| 95945cd | 2026-10-18 | minified | 100 KB | 177.4 ms; 3/3 | Unconfirmed | Unconfirmed |
| 95945cd | 2026-10-18 | prettified | 10 MB | 252.3 ms; 3/3 | 257.4 ms; 3/3 | 254.1 ms; 3/3 |
| 95945cd | 2026-10-18 | minified | 10 MB | 248.1 ms; 3/3 | 274.3 ms; 3/3 | 248.1 ms; 3/3 |
| 95945cd | 2026-10-18 | prettified | 1 MB | 796.1 ms; 3/3 | Unconfirmed | Unconfirmed |
| 95945cd | 2026-10-18 | minified | 1 MB | 716.0 ms; 3/3 | Unconfirmed | Unconfirmed |
| 95945cd | 2026-10-18 | prettified | 50 MB | 353.1 ms; 3/3 | Unconfirmed | Unconfirmed |
| 95945cd | 2026-10-18 | minified | 50 MB | 326.8 ms; 3/3 | Unconfirmed | Unconfirmed |

### Historical output and typing comparison

These October 17 values remain attached to `925fc3c`. They supplied the findings that prompted the new work. No typing baseline exists for `19b7ac7` or `aee1ae3`.

| Version | Date | Format | Data size | Event median / p95 | rAF median / p95 | First-caret output median |
|---|---|---|---|---|---|---|
| 925fc3c | 2026-10-17 | minified | 100 KB | 88.0 ms / 216.0 ms | 72.5 ms / 198.2 ms | 262.9 ms |
| 95945cd | 2026-10-18 | minified | 100 KB | 32.0 ms / 40.0 ms | 12.4 ms / 15.5 ms | 177.4 ms |
| 925fc3c | 2026-10-17 | prettified | 100 KB | 32.0 ms / 40.0 ms | 25.5 ms / 34.0 ms | 320.2 ms |
| 95945cd | 2026-10-18 | prettified | 100 KB | 32.0 ms / 48.0 ms | 25.2 ms / 36.1 ms | 300.0 ms |
| 925fc3c | 2026-10-17 | minified | 50 MB | 40.0 ms / 56.0 ms | 12.7 ms / 26.0 ms | 8987.1 ms |
| 95945cd | 2026-10-18 | minified | 50 MB | 40.0 ms / 64.0 ms | 7.6 ms / 28.9 ms | 326.8 ms |
| 925fc3c | 2026-10-17 | prettified | 50 MB | 56.0 ms / 72.0 ms | 30.9 ms / 50.6 ms | 9918.5 ms |
| 95945cd | 2026-10-18 | prettified | 50 MB | 56.0 ms / 72.0 ms | 30.8 ms / 51.7 ms | 353.1 ms |

### Enter, Backspace, paste and Undo

Each independent action starts from the original source and caret. The snippet contains 200 characters and uses trusted clipboard paste when available. These clocks are keydown-to-rAF bounds. They do not prove completion of a separate formatter update. Enter inside a JSON string temporarily invalidates the document. Undo effect checks are separate from their frame bounds.

| Tool | Date and version | Format | Data size | Enter rAF median / p95 | Backspace rAF median / p95 | Snippet rAF median / p95 | Undo rAF median / p95 | Confirmed Undo effects |
|---|---|---|---|---|---|---|---|---|
| Tool Kumar | 2026-10-18; 95945cd | minified | 100 KB | 11.2 ms / 37.3 ms | 6.6 ms / 37.7 ms | 10.8 ms / 16.9 ms | 11.5 ms / 15.9 ms | 9 |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 100 KB | 73.5 ms / 122.1 ms | 29.2 ms / 48.7 ms | 36.6 ms / 68.2 ms | 345.8 ms / 363.8 ms | 9 |
| Tool Kumar | 2026-10-18; 95945cd | minified | 1 MB | 9.8 ms / 20.1 ms | 8.9 ms / 16.5 ms | 15.0 ms / 38.5 ms | 15.3 ms / 17.1 ms | 9 |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 1 MB | 15.6 ms / 87.3 ms | 10.4 ms / 84.5 ms | 13.2 ms / 73.2 ms | 12.5 ms / 17.0 ms | 9 |
| Tool Kumar | 2026-10-18; 95945cd | minified | 10 MB | 18.1 ms / 36.7 ms | 12.8 ms / 13.0 ms | 32.0 ms / 66.6 ms | 30.0 ms / 44.7 ms | 9 |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 10 MB | 37.7 ms / 48.5 ms | 30.9 ms / 55.2 ms | 19.9 ms / 25.7 ms | 23.3 ms / 24.9 ms | 9 |
| Tool Kumar | 2026-10-18; 95945cd | minified | 50 MB | 17.5 ms / 117.3 ms | 9.3 ms / 18.7 ms | 16.5 ms / 70.9 ms | 12.7 ms / 61.1 ms | 9 |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 50 MB | 119.2 ms / 190.5 ms | 72.4 ms / 136.4 ms | 44.9 ms / 115.4 ms | 34.7 ms / 56.3 ms | 9 |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 100 KB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 100 KB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 1 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 1 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 10 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 10 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSON Beautifier | 2026-10-17; public site | minified | 100 KB | 41.2 ms / 149.5 ms | 34.6 ms / 100.3 ms | 31.7 ms / 103.9 ms | 11.7 ms / 21.5 ms | 0 |
| JSON Beautifier | 2026-10-17; public site | prettified | 100 KB | 9.7 ms / 24.0 ms | 15.0 ms / 23.3 ms | 9.7 ms / 16.2 ms | 12.6 ms / 17.2 ms | 0 |
| JSON Beautifier | 2026-10-17; public site | minified | 1 MB | 80.7 ms / 145.5 ms | 61.1 ms / 198.1 ms | 58.0 ms / 67.6 ms | 58.4 ms / 84.7 ms | 0 |
| JSON Beautifier | 2026-10-17; public site | prettified | 1 MB | 12.4 ms / 35.3 ms | 8.9 ms / 15.5 ms | 10.7 ms / 26.1 ms | 11.1 ms / 17.5 ms | 0 |
| JSON Beautifier | 2026-10-17; public site | minified | 10 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSON Beautifier | 2026-10-17; public site | prettified | 10 MB | 40.4 ms / 40.4 ms | 30.1 ms / 30.1 ms | 29.7 ms / 29.7 ms | 12.2 ms / 12.2 ms | 0 |
| JSON Beautifier | 2026-10-17; public site | minified | 50 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSON Beautifier | 2026-10-17; public site | prettified | 50 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSON Viewer Stack | 2026-10-17; public site | minified | 100 KB | 48.4 ms / 64.5 ms | 28.1 ms / 29.2 ms | 29.0 ms / 36.5 ms | 27.5 ms / 30.6 ms | 3 |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 100 KB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSON Viewer Stack | 2026-10-17; public site | minified | 1 MB | 410.4 ms / 475.6 ms | 273.3 ms / 338.3 ms | 256.8 ms / 314.6 ms | 253.8 ms / 295.5 ms | 9 |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 1 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSON Viewer Stack | 2026-10-17; public site | minified | 10 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 10 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSON Formatter Online | 2026-10-18; public site | minified | 100 KB | 61.8 ms / 142.7 ms | 23.5 ms / 73.2 ms | 48.9 ms / 132.2 ms | 24.6 ms / 202.6 ms | 9 |
| JSON Formatter Online | 2026-10-18; public site | prettified | 100 KB | 13.2 ms / 22.6 ms | 8.3 ms / 15.4 ms | 9.6 ms / 27.1 ms | 11.4 ms / 17.0 ms | 9 |
| JSON Formatter Online | 2026-10-17; public site | minified | 1 MB | 59.0 ms / 90.4 ms | 58.9 ms / 85.3 ms | 67.8 ms / 99.6 ms | 36.1 ms / 66.4 ms | 9 |
| JSON Formatter Online | 2026-10-17; public site | prettified | 1 MB | 32.3 ms / 43.3 ms | 31.4 ms / 39.2 ms | 31.6 ms / 51.7 ms | 26.8 ms / 27.8 ms | 9 |
| JSON Formatter Online | 2026-10-18; public site | minified | 10 MB | 47.2 ms / 59.9 ms | 49.3 ms / 60.5 ms | 69.1 ms / 108.2 ms | 35.4 ms / 43.5 ms | 9 |
| JSON Formatter Online | 2026-10-18; public site | prettified | 10 MB | 26.6 ms / 45.0 ms | 30.1 ms / 44.2 ms | 31.6 ms / 42.7 ms | 26.4 ms / 28.8 ms | 8 |
| JSONLint | 2026-10-17; public site | minified | 100 KB | 14.5 ms / 50.8 ms | 23.6 ms / 120.8 ms | 8.0 ms / 137.9 ms | 30.2 ms / 131.4 ms | 11 |
| JSONLint | 2026-10-17; public site | prettified | 100 KB | 20.9 ms / 78.5 ms | 70.7 ms / 75.2 ms | 9.8 ms / 15.3 ms | 76.8 ms / 94.9 ms | 0 |
| JSONLint | 2026-10-17; public site | minified | 1 MB | 276.1 ms / 1460.6 ms | 194.8 ms / 1272.5 ms | 23.1 ms / 1308.4 ms | 391.8 ms / 1579.0 ms | 5 |
| JSONLint | 2026-10-17; public site | prettified | 1 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSONLint | 2026-10-17; public site | minified | 10 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |
| JSONLint | 2026-10-17; public site | prettified | 10 MB | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | Not measured / Not measured | 0 |

### Input scrolling

The native input scroller moves through twenty equal steps, 50 ms apart. Frame times measure this scripted scroll, not touch or wheel handling. Page-scroll fallbacks are excluded from input-scroll quantiles.

| Tool | Date and version | Format | Data size | Frame median | Frame p95 | Longest frame | Observed scroll outcomes |
|---|---|---|---|---|---|---|---|
| Tool Kumar | 2026-10-18; 95945cd | minified | 100 KB | 16.7 ms | 16.8 ms | 16.8 ms | measured; measured; measured |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 100 KB | 16.7 ms | 50.0 ms | 50.1 ms | measured; measured; measured |
| Tool Kumar | 2026-10-18; 95945cd | minified | 1 MB | 16.7 ms | 16.7 ms | 16.8 ms | measured; measured; measured |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 1 MB | 16.7 ms | 16.7 ms | 83.3 ms | measured; measured; measured |
| Tool Kumar | 2026-10-18; 95945cd | minified | 10 MB | 16.7 ms | 83.3 ms | 366.7 ms | measured; measured; measured |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 10 MB | 16.7 ms | 66.7 ms | 499.9 ms | measured; measured; measured |
| Tool Kumar | 2026-10-18; 95945cd | minified | 50 MB | 49.9 ms | 66.7 ms | 83.4 ms | measured; measured; measured |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 50 MB | 16.7 ms | 66.6 ms | 83.4 ms | measured; measured; measured |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 100 KB | Not measured | Not measured | Not measured |  |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 100 KB | Not measured | Not measured | Not measured |  |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 1 MB | Not measured | Not measured | Not measured |  |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 1 MB | Not measured | Not measured | Not measured |  |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 10 MB | Not measured | Not measured | Not measured |  |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 10 MB | Not measured | Not measured | Not measured |  |
| JSON Beautifier | 2026-10-17; public site | minified | 100 KB | 16.7 ms | 16.7 ms | 16.8 ms | measured; measured; measured; measured |
| JSON Beautifier | 2026-10-17; public site | prettified | 100 KB | 16.7 ms | 16.8 ms | 16.8 ms | measured; measured; measured |
| JSON Beautifier | 2026-10-17; public site | minified | 1 MB | 33.4 ms | 66.7 ms | 1183.3 ms | measured; measured; measured; measured; measured; measured |
| JSON Beautifier | 2026-10-17; public site | prettified | 1 MB | 16.7 ms | 16.8 ms | 33.3 ms | measured; measured; measured |
| JSON Beautifier | 2026-10-17; public site | minified | 10 MB | Not measured | Not measured | Not measured |  |
| JSON Beautifier | 2026-10-17; public site | prettified | 10 MB | Not measured | Not measured | Not measured |  |
| JSON Beautifier | 2026-10-17; public site | minified | 50 MB | Not measured | Not measured | Not measured |  |
| JSON Beautifier | 2026-10-17; public site | prettified | 50 MB | Not measured | Not measured | Not measured |  |
| JSON Viewer Stack | 2026-10-17; public site | minified | 100 KB | 16.7 ms | 16.8 ms | 16.8 ms | measured |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 100 KB | Not measured | Not measured | Not measured |  |
| JSON Viewer Stack | 2026-10-17; public site | minified | 1 MB | 16.7 ms | 16.8 ms | 16.8 ms | measured; measured; measured |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 1 MB | Not measured | Not measured | Not measured |  |
| JSON Viewer Stack | 2026-10-17; public site | minified | 10 MB | Not measured | Not measured | Not measured |  |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 10 MB | Not measured | Not measured | Not measured |  |
| JSON Formatter Online | 2026-10-18; public site | minified | 100 KB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | 2026-10-18; public site | prettified | 100 KB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | 2026-10-17; public site | minified | 1 MB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | 2026-10-17; public site | prettified | 1 MB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | 2026-10-18; public site | minified | 10 MB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSON Formatter Online | 2026-10-18; public site | prettified | 10 MB | Not measured | Not measured | Not measured | Page scroll fallback; no native input range; Page scroll fallback; no native input range; Page scroll fallback; no native input range |
| JSONLint | 2026-10-17; public site | minified | 100 KB | 16.7 ms | 16.8 ms | 83.4 ms | measured; measured; measured; measured |
| JSONLint | 2026-10-17; public site | prettified | 100 KB | 16.7 ms | 16.8 ms | 16.8 ms | measured; measured; measured; measured |
| JSONLint | 2026-10-17; public site | minified | 1 MB | 16.7 ms | 399.9 ms | 1466.7 ms | measured; measured; measured |
| JSONLint | 2026-10-17; public site | prettified | 1 MB | Not measured | Not measured | Not measured |  |
| JSONLint | 2026-10-17; public site | minified | 10 MB | Not measured | Not measured | Not measured |  |
| JSONLint | 2026-10-17; public site | prettified | 10 MB | Not measured | Not measured | Not measured |  |

### Opening minified and prettified copies

These opening times come from the editing-profile visits. The timed input and done predicate match the opening study. Counts can differ from the dedicated primary opening table. The data-size label describes the minified partner.

| Tool | Date and version | Format | Data size | Actual bytes | Lines | Opening median | Complete / attempted typing profiles | Editor design |
|---|---|---|---|---|---|---|---|---|
| Tool Kumar | 2026-10-18; 95945cd | minified | 100 KB | 99638 | 1 | 403.0 ms | 3/3 | Custom virtual editor with a native textarea passage |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 100 KB | 186427 | 7945 | 337.0 ms | 3/3 | Native textarea with virtual syntax highlighting |
| Tool Kumar | 2026-10-18; 95945cd | minified | 1 MB | 999554 | 1 | 364.0 ms | 3/3 | Custom virtual editor with a native textarea passage |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 1 MB | 1863123 | 79196 | 405.0 ms | 3/3 | Custom virtual editor with a native textarea passage |
| Tool Kumar | 2026-10-18; 95945cd | minified | 10 MB | 9999719 | 1 | 1618.0 ms | 3/3 | Custom virtual editor with a native textarea passage |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 10 MB | 18592911 | 788600 | 1580.0 ms | 3/3 | Custom virtual editor with a native textarea passage |
| Tool Kumar | 2026-10-18; 95945cd | minified | 50 MB | 49998859 | 1 | 8622.0 ms | 3/3 | Custom virtual editor with a native textarea passage |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 50 MB | 92806317 | 3930172 | 10958.0 ms | 3/3 | Custom virtual editor with a native textarea passage |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 100 KB | 99638 | 1 | 2166.0 ms | 0/3 | Ace input, JSONEditor tree output |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 100 KB | 186427 | 7945 | 2110.0 ms | 0/3 | Ace input, JSONEditor tree output |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 1 MB | 999554 | 1 | 3914.0 ms | 0/3 | Ace input, JSONEditor tree output |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 1 MB | 1863123 | 79196 | 2907.0 ms | 0/3 | Ace input, JSONEditor tree output |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 10 MB | 9999719 | 1 | 20850.0 ms | 0/3 | Ace input, JSONEditor tree output |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 10 MB | 18592911 | 788600 | 10710.0 ms | 0/3 | Ace input, JSONEditor tree output |
| JSON Beautifier | 2026-10-17; public site | minified | 100 KB | 99638 | 1 | 311.0 ms | 3/4 | Ace |
| JSON Beautifier | 2026-10-17; public site | prettified | 100 KB | 186427 | 7945 | 322.0 ms | 3/3 | Ace |
| JSON Beautifier | 2026-10-17; public site | minified | 1 MB | 999554 | 1 | 777.0 ms | 3/6 | Ace |
| JSON Beautifier | 2026-10-17; public site | prettified | 1 MB | 1863123 | 79196 | 811.0 ms | 3/3 | Ace |
| JSON Beautifier | 2026-10-17; public site | minified | 10 MB | 9999719 | 1 | 5316.0 ms | 0/3 | Ace |
| JSON Beautifier | 2026-10-17; public site | prettified | 10 MB | 18592911 | 788600 | 5497.0 ms | 0/3 | Ace |
| JSON Beautifier | 2026-10-17; public site | minified | 50 MB | 49998859 | 1 | 27489.0 ms | 0/3 | Ace |
| JSON Beautifier | 2026-10-17; public site | prettified | 50 MB | 92806317 | 3930172 | 27316.0 ms | 0/3 | Ace |
| JSON Viewer Stack | 2026-10-17; public site | minified | 100 KB | 99638 | 1 | 226.0 ms | 1/3 | Textarea, Ext tree output |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 100 KB | 186427 | 7945 | Not measured | 0/3 | Not confirmed |
| JSON Viewer Stack | 2026-10-17; public site | minified | 1 MB | 999554 | 1 | 649.0 ms | 3/3 | Textarea, Ext tree output |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 1 MB | 1863123 | 79196 | Not measured | 0/3 | Not confirmed |
| JSON Viewer Stack | 2026-10-17; public site | minified | 10 MB | 9999719 | 1 | 8710.0 ms | 0/3 | Textarea, Ext tree output |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 10 MB | 18592911 | 788600 | Not measured | 0/3 | Not confirmed |
| JSON Formatter Online | 2026-10-18; public site | minified | 100 KB | 99638 | 1 | 297.0 ms | 3/3 | CodeMirror |
| JSON Formatter Online | 2026-10-18; public site | prettified | 100 KB | 186427 | 7945 | 280.0 ms | 3/3 | CodeMirror |
| JSON Formatter Online | 2026-10-17; public site | minified | 1 MB | 999554 | 1 | 362.0 ms | 3/3 | CodeMirror |
| JSON Formatter Online | 2026-10-17; public site | prettified | 1 MB | 1863123 | 79196 | 353.0 ms | 3/3 | CodeMirror |
| JSON Formatter Online | 2026-10-18; public site | minified | 10 MB | 9999719 | 1 | 1152.0 ms | 3/3 | CodeMirror |
| JSON Formatter Online | 2026-10-18; public site | prettified | 10 MB | 18592911 | 788600 | 1041.0 ms | 2/3 | CodeMirror |
| JSONLint | 2026-10-17; public site | minified | 100 KB | 99638 | 1 | 1029.0 ms | 2/4 | Monaco |
| JSONLint | 2026-10-17; public site | prettified | 100 KB | 186427 | 7945 | 711.0 ms | 0/4 | Monaco |
| JSONLint | 2026-10-17; public site | minified | 1 MB | 999554 | 1 | 5929.0 ms | 3/3 | Monaco |
| JSONLint | 2026-10-17; public site | prettified | 1 MB | 1863123 | 79196 | 1676.0 ms | 0/3 | Monaco |
| JSONLint | 2026-10-17; public site | minified | 10 MB | 9999719 | 1 | 19234.0 ms | 0/3 | Monaco |
| JSONLint | 2026-10-17; public site | prettified | 10 MB | 18592911 | 788600 | 10443.0 ms | 0/3 | Monaco |

### Failed and incomplete editing attempts

| Tool | Date and version | Format | Data size | Outcome | Reason | Raw source |
|---|---|---|---|---|---|---|
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 100 KB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing1__2026-10-17T18-59-06-031Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 100 KB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing2__2026-10-17T20-21-42-243Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 100 KB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing3__2026-10-17T21-02-40-101Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 100 KB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing1__2026-10-17T19-10-34-176Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 100 KB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing2__2026-10-17T20-12-46-736Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 100 KB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing3__2026-10-17T21-12-30-963Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 1 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing1__2026-10-17T19-22-39-447Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 1 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing2__2026-10-17T20-39-51-767Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 1 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing3__2026-10-17T21-19-50-826Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 1 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing1__2026-10-17T19-42-18-379Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 1 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing2__2026-10-17T20-28-45-817Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 1 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing3__2026-10-17T21-31-24-518Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 10 MB | Memory watchdog stop during editing preparation | browser memory 6154 MiB exceeded the 6144 MiB cap | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing1__2026-10-17T19-49-59-338Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 10 MB | Memory watchdog stop during editing preparation | browser memory 6148 MiB exceeded the 6144 MiB cap | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing2__2026-10-17T20-59-25-369Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | minified | 10 MB | Memory watchdog stop during editing preparation | browser memory 6146 MiB exceeded the 6144 MiB cap | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing3__2026-10-17T21-39-06-960Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 10 MB | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing1__2026-10-17T19-58-45-642Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 10 MB | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing2__2026-10-17T20-50-12-958Z.json |
| Code Beautify JSON Viewer | 2026-10-17; public site | prettified | 10 MB | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing3__2026-10-17T21-50-10-706Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 100 KB | partly measured | start: Ace caret clamped before target: {"method":"Ace public gotoLine, caret only","cursor":{"row":0,"column":1},"lines":7945,"requestedLine":1,"requestedColumn":354,"targetLineCharacters":1,"visibleSourcePrefix":"{"} | results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing2__2026-10-17T20-20-47-751Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 1 MB | partly measured | start: Ace caret clamped before target: {"method":"Ace public gotoLine, caret only","cursor":{"row":0,"column":1},"lines":79196,"requestedLine":1,"requestedColumn":355,"targetLineCharacters":1,"visibleSourcePrefix":"{"} | results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing1__2026-10-17T19-28-09-152Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 1 MB | partly measured | start: Ace caret clamped before target: {"method":"Ace public gotoLine, caret only","cursor":{"row":0,"column":1},"lines":79196,"requestedLine":1,"requestedColumn":355,"targetLineCharacters":1,"visibleSourcePrefix":"{"} | results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing2__2026-10-17T20-38-10-720Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 1 MB | partly measured | start: Ace caret clamped before target: {"method":"Ace public gotoLine, caret only","cursor":{"row":0,"column":1},"lines":79196,"requestedLine":1,"requestedColumn":355,"targetLineCharacters":1,"visibleSourcePrefix":"{"} | results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing3__2026-10-17T21-21-15-854Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 10 MB | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing1__2026-10-17T19-51-23-171Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 10 MB | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing2__2026-10-17T20-58-34-066Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 10 MB | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing3__2026-10-17T21-40-31-129Z.json |
| JSON Beautifier | 2026-10-17; public site | prettified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing1__2026-10-17T20-00-02-692Z.json |
| JSON Beautifier | 2026-10-17; public site | prettified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing2__2026-10-17T20-49-16-758Z.json |
| JSON Beautifier | 2026-10-17; public site | prettified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing3__2026-10-17T21-52-31-313Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 50 MB | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing1__2026-10-17T22-10-06-305Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 50 MB | crashed | Runtime.evaluate: timeout 64586.386442999996ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing2__2026-10-17T22-33-37-144Z.json |
| JSON Beautifier | 2026-10-17; public site | minified | 50 MB | Memory watchdog stop during editing preparation | browser memory 6145 MiB exceeded the 6144 MiB cap | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing3__2026-10-17T22-39-06-305Z.json |
| JSON Beautifier | 2026-10-17; public site | prettified | 50 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing1__2026-10-17T22-17-50-729Z.json |
| JSON Beautifier | 2026-10-17; public site | prettified | 50 MB | unresponsive during editing | Input.dispatchKeyEvent: timeout 15000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing2__2026-10-17T22-26-30-958Z.json |
| JSON Beautifier | 2026-10-17; public site | prettified | 50 MB | unresponsive during editing | Runtime.evaluate: timeout 30000ms | results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing3__2026-10-17T22-46-42-714Z.json |
| JSON Viewer Stack | 2026-10-17; public site | minified | 100 KB | could not be measured | interaction obstructed by another element | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing1__2026-10-17T19-01-09-368Z.json |
| JSON Viewer Stack | 2026-10-17; public site | minified | 100 KB | could not be measured | interaction obstructed by another element | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing2__2026-10-17T20-20-29-829Z.json |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 100 KB | error | error: Runtime.evaluate: timeout 89999.914643ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing1__2026-10-17T19-14-10-090Z.json |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 100 KB | error | error: Runtime.evaluate: timeout 89999.905321ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing2__2026-10-17T20-09-59-975Z.json |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 100 KB | error | error: Runtime.evaluate: timeout 89999.906347ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing3__2026-10-17T21-14-25-243Z.json |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 1 MB | error | error: Runtime.evaluate: timeout 89999.887762ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing1__2026-10-17T19-44-35-456Z.json |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 1 MB | error | error: Runtime.evaluate: timeout 89999.915127ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing2__2026-10-17T20-25-53-751Z.json |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 1 MB | error | error: Runtime.evaluate: timeout 89999.90706900001ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing3__2026-10-17T21-33-44-430Z.json |
| JSON Viewer Stack | 2026-10-17; public site | minified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing1__2026-10-17T19-52-13-586Z.json |
| JSON Viewer Stack | 2026-10-17; public site | minified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing2__2026-10-17T20-57-10-637Z.json |
| JSON Viewer Stack | 2026-10-17; public site | minified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing3__2026-10-17T21-41-25-129Z.json |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 10 MB | error | error: Runtime.evaluate: timeout 89999.901186ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing1__2026-10-17T20-00-59-280Z.json |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 10 MB | error | error: Runtime.evaluate: timeout 89999.907898ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing2__2026-10-17T20-47-29-275Z.json |
| JSON Viewer Stack | 2026-10-17; public site | prettified | 10 MB | error | error: Runtime.evaluate: timeout 89999.867241ms | results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing3__2026-10-17T21-56-19-900Z.json |
| JSON Formatter Online | 2026-10-18; public site | prettified | 10 MB | partly measured | end: Find did not render the caret target | results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json |
| JSONLint | 2026-10-17; public site | minified | 100 KB | partly measured | start: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing1__2026-10-17T19-03-54-543Z.json |
| JSONLint | 2026-10-17; public site | minified | 100 KB | partly measured | middle: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing2__2026-10-17T20-17-32-250Z.json |
| JSONLint | 2026-10-17; public site | prettified | 100 KB | partly measured | end: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing1__2026-10-17T19-18-55-416Z.json |
| JSONLint | 2026-10-17; public site | prettified | 100 KB | partly measured | start: Missing source/output edit marker, unexpected trusted-key count or missing frame; middle: Missing source/output edit marker, unexpected trusted-key count or missing frame; end: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing1__2026-10-17T19-25-34-801Z.json |
| JSONLint | 2026-10-17; public site | prettified | 100 KB | partly measured | middle: Missing source/output edit marker, unexpected trusted-key count or missing frame; end: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing2__2026-10-17T20-07-32-664Z.json |
| JSONLint | 2026-10-17; public site | prettified | 100 KB | partly measured | end: Missing source/output edit marker, unexpected trusted-key count or missing frame | results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing3__2026-10-17T21-17-00-937Z.json |
| JSONLint | 2026-10-17; public site | prettified | 1 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing1__2026-10-17T19-47-26-943Z.json |
| JSONLint | 2026-10-17; public site | prettified | 1 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing2__2026-10-17T20-23-34-311Z.json |
| JSONLint | 2026-10-17; public site | prettified | 1 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing3__2026-10-17T21-36-34-046Z.json |
| JSONLint | 2026-10-17; public site | minified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing1__2026-10-17T19-55-58-249Z.json |
| JSONLint | 2026-10-17; public site | minified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing2__2026-10-17T20-53-45-737Z.json |
| JSONLint | 2026-10-17; public site | minified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing3__2026-10-17T21-45-02-960Z.json |
| JSONLint | 2026-10-17; public site | prettified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing1__2026-10-17T20-06-06-654Z.json |
| JSONLint | 2026-10-17; public site | prettified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing2__2026-10-17T20-42-34-338Z.json |
| JSONLint | 2026-10-17; public site | prettified | 10 MB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing3__2026-10-17T22-03-49-607Z.json |

## Everyday use and overall choice

There is no weighted overall score or direct measure of everyday convenience. These are judgments about the measured tasks. Tool Kumar remains the overall choice when capacity, last-record search and the tested numeric fidelity matter. The October 17 recommendation of JSON Formatter Online for small everyday files was an initial judgment, not a permanent title. The fresh 100 KB and 10 MB comparison below is the basis for reassessing it.

| Tool | Date and version | Format | Data size | Complete / attempted | Event median | Event p95 | rAF median | rAF p95 |
|---|---|---|---|---|---|---|---|---|
| Tool Kumar | 2026-10-18; 95945cd | minified | 100 KB | 3/3 | 32.0 ms | 40.0 ms | 12.4 ms | 15.5 ms |
| JSON Formatter Online | 2026-10-18; public site | minified | 100 KB | 3/3 | 40.0 ms | 80.0 ms | 21.0 ms | 50.0 ms |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 100 KB | 3/3 | 32.0 ms | 48.0 ms | 25.2 ms | 36.1 ms |
| JSON Formatter Online | 2026-10-18; public site | prettified | 100 KB | 3/3 | 16.0 ms | 24.0 ms | 12.4 ms | 17.5 ms |
| Tool Kumar | 2026-10-18; 95945cd | minified | 10 MB | 3/3 | 40.0 ms | 56.0 ms | 12.0 ms | 22.2 ms |
| JSON Formatter Online | 2026-10-18; public site | minified | 10 MB | 3/3 | 64.0 ms | 112.0 ms | 51.6 ms | 83.9 ms |
| Tool Kumar | 2026-10-18; 95945cd | prettified | 10 MB | 3/3 | 24.0 ms | 32.0 ms | 14.5 ms | 18.4 ms |
| JSON Formatter Online | 2026-10-18; public site | prettified | 10 MB | 2/3 | Fewer than three complete matched profiles | Fewer than three complete matched profiles | Not measured | Not measured |

For everyday minified 100 KB sources, Tool Kumar had the lower keydown-to-frame median, 12.4 ms beside JSON Formatter Online 21.0 ms. Its Event Timing median/p95 was 32.0 ms / 40.0 ms, beside 40.0 ms / 80.0 ms. That measured case supports Tool Kumar over the initial small-file recommendation. Other formats and tail latencies remain separate.

JSON Formatter Online retained the lower everyday prettified 100 KB keydown-to-frame median, 12.4 ms beside Tool Kumar 25.2 ms. Its Event Timing median/p95 was 16.0 ms / 24.0 ms, beside 32.0 ms / 48.0 ms. This remains a measured convenience tradeoff for that source format.

A lower median on one task does not establish the best tool for every person. The findings above keep every competitor win visible. For precision-sensitive IDs or financial values, the dated fidelity results still matter alongside typing and opening.

## How large a file did each tool handle?

The size ladder below is retained from October 17. Tool Kumar was `925fc3c`. It has not been rerun beyond 50 MB for `95945cd`. Its 200 MB success and 400 MB failure must not be treated as new-version measurements. These are tested brackets, not exact maximum sizes.

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

The rows identify their measurement date. Current Tool Kumar rows cover 1 MB, 10 MB and 50 MB. Larger Tool Kumar rows and the other retained tools keep their October 17 evidence. JSON Formatter Online 10 MB was repeated October 18. Feature results follow opening and are not inferred from the appearance of a preview.

| Tool | Date and version | Data size | Opening | Tree | Last-record search | Collapse | Scroll to end | Input probe |
|---|---|---|---|---|---|---|---|---|
| Tool Kumar | 2026-10-18; 95945cd | 1 MB | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 verified character edit |
| Tool Kumar | 2026-10-17; 925fc3c | 5 MB | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 verified character edit |
| Tool Kumar | 2026-10-18; 95945cd | 10 MB | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 verified character edit |
| Tool Kumar | 2026-10-17; 925fc3c | 25 MB | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 read-only by default |
| Tool Kumar | 2026-10-18; 95945cd | 50 MB | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 read-only by default |
| Tool Kumar | 2026-10-17; 925fc3c | 100 MB | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 read-only by default |
| Tool Kumar | 2026-10-17; 925fc3c | 200 MB | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 read-only by default |
| Tool Kumar | 2026-10-17; 925fc3c | 400 MB | 1/1 no formatted view within 90 s | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| Code Beautify JSON Viewer | 2026-10-17; public site | 1 MB | 3/3 ok | 3/3 visible | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 verified character edit |
| Code Beautify JSON Viewer | 2026-10-17; public site | 5 MB | 1/1 ok | 1/1 visible | 1/1 unresponsive at 30 s | 1/1 not tested after previous feature froze | 1/1 ok | 1/1 could not be checked |
| Code Beautify JSON Viewer | 2026-10-17; public site | 10 MB | 3/3 ok | 3/3 visible | 3/3 unresponsive at 30 s | 3/3 not tested after previous feature froze | 3/3 ok | 3/3 could not be checked |
| Code Beautify JSON Viewer | 2026-10-17; public site | 50 MB | 3/3 exceeded memory cap | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached |
| JSON Beautifier | 2026-10-17; public site | 1 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok | 2/3 not available; 1/3 ok | 3/3 ok | 3/3 verified character edit |
| JSON Beautifier | 2026-10-17; public site | 5 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 verified character edit |
| JSON Beautifier | 2026-10-17; public site | 10 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok | 2/3 not available; 1/3 ok | 3/3 ok | 3/3 verified character edit |
| JSON Beautifier | 2026-10-17; public site | 25 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok | 1/1 not available | 1/1 could not be checked | 1/1 verified character edit |
| JSON Beautifier | 2026-10-17; public site | 50 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok | 2/3 not available; 1/3 ok | 3/3 could not be checked | 3/3 verified character edit |
| JSON Beautifier | 2026-10-17; public site | 100 MB | 1/1 crashed | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| JSON Viewer Stack | 2026-10-17; public site | 1 MB | 3/3 ok | 3/3 visible | 3/3 not available | 3/3 ok | 3/3 ok | 3/3 verified character edit |
| JSON Viewer Stack | 2026-10-17; public site | 5 MB | 1/1 ok | 1/1 visible | 1/1 not available | 1/1 ok | 1/1 ok | 1/1 verified character edit |
| JSON Viewer Stack | 2026-10-17; public site | 10 MB | 1/3 view detected, interaction obstructed; 2/3 ok | 1/3 not reached; 2/3 visible | 1/3 not reached; 2/3 not available | 1/3 not reached; 2/3 ok | 1/3 not reached; 2/3 ok | 1/3 not reached; 2/3 verified character edit |
| JSON Viewer Stack | 2026-10-17; public site | 50 MB | 1/3 view detected, interaction obstructed; 2/3 ok | 1/3 not reached; 2/3 visible | 1/3 not reached; 2/3 not available | 1/3 not reached; 2/3 ok | 1/3 not reached; 2/3 ok | 1/3 not reached; 2/3 could not be checked |
| JSON Formatter Online | 2026-10-17; public site | 1 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok | 3/3 no result within 30 s | 3/3 ok | 3/3 verified character edit |
| JSON Formatter Online | 2026-10-17; public site | 5 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok | 1/1 no result within 30 s | 1/1 ok | 1/1 verified character edit |
| JSON Formatter Online | 2026-10-18; public site | 10 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok | 3/3 no result within 30 s | 3/3 ok | 3/3 verified character edit |
| JSON Formatter Online | 2026-10-17; public site | 25 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok | 1/1 no result within 30 s | 1/1 ok | 1/1 verified character edit |
| JSON Formatter Online | 2026-10-17; public site | 50 MB | 3/3 no formatted view within 90 s | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached |
| JSONLint | 2026-10-17; public site | 1 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 verified character edit |
| JSONLint | 2026-10-17; public site | 5 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 could not be checked |
| JSONLint | 2026-10-17; public site | 10 MB | 3/3 ok | 3/3 not offered in tested view | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 could not be checked |
| JSONLint | 2026-10-17; public site | 25 MB | 1/1 ok | 1/1 not offered in tested view | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 could not be checked |
| JSONLint | 2026-10-17; public site | 50 MB | 1/3 unresponsive at 90 s; 2/3 exceeded memory cap | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached | 3/3 not reached |

## Memory

Memory is RSS plus swap from the browser process tree, sampled every 200 ms. Renderer-to-view and full-feature-run peaks cover different intervals. Post-burst values are recorded but do not isolate per-key cost. Every row below uses the common 6 GiB browser budget. Firefox process totals are kept in its separate download.

| Tool | Date and version | Size | Attempts | Renderer to view or stop median, MiB | Full renderer peak median, MiB | Full browser peak median, MiB | Cap stops |
|---|---|---|---|---|---|---|---|
| Code Beautify JSON Viewer | 2026-10-17; public site | 10 MB | 3 | 2474 | 5825 | 6160 | 3 |
| Code Beautify JSON Viewer | 2026-10-17; public site | 1 MB | 3 | 697 | 2489 | 2836 | 0 |
| Code Beautify JSON Viewer | 2026-10-17; public site | 50 MB | 3 | 5825 | 5825 | 6159 | 3 |
| Code Beautify JSON Viewer | 2026-10-17; public site | 5 MB | 1 | 1512 | 5811 | 6151 | 1 |
| JSON Beautifier | 2026-10-17; public site | 100 MB | 1 | 5235 | 5235 | 5534 | 0 |
| JSON Beautifier | 2026-10-17; public site | 10 MB | 3 | 1164 | 1656 | 1958 | 0 |
| JSON Beautifier | 2026-10-17; public site | 1 MB | 3 | 378 | 466 | 771 | 0 |
| JSON Beautifier | 2026-10-17; public site | 25 MB | 1 | 2645 | 2809 | 3107 | 0 |
| JSON Beautifier | 2026-10-17; public site | 50 MB | 3 | 4792 | 4792 | 5084 | 0 |
| JSON Beautifier | 2026-10-17; public site | 5 MB | 1 | 793 | 935 | 1235 | 0 |
| JSON Formatter Online | 2026-10-17; public site | 1 MB | 3 | 156 | 212 | 515 | 0 |
| JSON Formatter Online | 2026-10-17; public site | 25 MB | 1 | 462 | 675 | 973 | 0 |
| JSON Formatter Online | 2026-10-17; public site | 50 MB | 3 | 1119 | 1119 | 1391 | 0 |
| JSON Formatter Online | 2026-10-17; public site | 5 MB | 1 | 210 | 329 | 634 | 0 |
| JSON Viewer Stack | 2026-10-17; public site | 10 MB | 3 | 665 | 1658 | 1975 | 0 |
| JSON Viewer Stack | 2026-10-17; public site | 1 MB | 3 | 204 | 288 | 593 | 0 |
| JSON Viewer Stack | 2026-10-17; public site | 50 MB | 3 | 2709 | 5098 | 5487 | 0 |
| JSON Viewer Stack | 2026-10-17; public site | 5 MB | 1 | 412 | 951 | 1259 | 0 |
| JSONLint | 2026-10-17; public site | 10 MB | 3 | 1671 | 2263 | 2598 | 0 |
| JSONLint | 2026-10-17; public site | 1 MB | 3 | 597 | 788 | 1141 | 0 |
| JSONLint | 2026-10-17; public site | 25 MB | 1 | 2115 | 6039 | 6390 | 1 |
| JSONLint | 2026-10-17; public site | 50 MB | 3 | 5705 | 5705 | 6146 | 2 |
| JSONLint | 2026-10-17; public site | 5 MB | 1 | 1269 | 1544 | 1902 | 0 |
| Tool Kumar | 2026-10-17; 925fc3c | 100 MB | 1 | 2094 | 2547 | 2838 | 0 |
| Tool Kumar | 2026-10-17; 925fc3c | 200 MB | 1 | 4767 | 4767 | 5048 | 0 |
| Tool Kumar | 2026-10-17; 925fc3c | 25 MB | 1 | 788 | 827 | 1117 | 0 |
| Tool Kumar | 2026-10-17; 925fc3c | 400 MB | 1 | 147 | 147 | 433 | 0 |
| Tool Kumar | 2026-10-17; 925fc3c | 5 MB | 1 | 232 | 324 | 625 | 0 |
| JSON Formatter Online | 2026-10-18; public site | 10 MB | 3 | 281 | 400 | 695 | 0 |
| Tool Kumar | 2026-10-18; 95945cd | 10 MB | 3 | 348 | 525 | 820 | 0 |
| Tool Kumar | 2026-10-18; 95945cd | 1 MB | 3 | 183 | 225 | 518 | 0 |
| Tool Kumar | 2026-10-18; 95945cd | 50 MB | 3 | 1204 | 1349 | 1636 | 0 |

Tool Kumar memory before and after is shown separately below. The full-run window includes navigation and feature probes. Shared-host variation remains, and this is not an isolated per-key memory cost.

| Version | Date | Data size | Renderer to view median, MiB | Full renderer peak median, MiB | Full browser peak median, MiB |
|---|---|---|---|---|---|
| 925fc3c | 2026-10-17 | 1 MB | 182 | 222 | 522 |
| 95945cd | 2026-10-18 | 1 MB | 183 | 225 | 518 |
| 925fc3c | 2026-10-17 | 10 MB | 436 | 568 | 869 |
| 95945cd | 2026-10-18 | 10 MB | 348 | 525 | 820 |
| 925fc3c | 2026-10-17 | 50 MB | 1168 | 1327 | 1616 |
| 95945cd | 2026-10-18 | 50 MB | 1204 | 1349 | 1636 |

At 1 MB, lower renderer-to-view medians than Tool Kumar 183 MiB were recorded by JSON Formatter Online 156 MiB, 2026-10-17; public site.

At 10 MB, lower renderer-to-view medians than Tool Kumar 348 MiB were recorded by JSON Formatter Online 281 MiB, 2026-10-18; public site.

## Select all, cut and paste

The October 18 correctness check sends trusted Ctrl+A, Ctrl+X and Ctrl+V without a DOM read or pause between cut and paste. It copies the restored input and checks the exact fixture SHA-256. The input must remain editable. Each fresh profile contains three sequences. These are sequences, not independent browser runs.

| Size | Edit anyway | Sequences | Outcome | Raw source |
|---|---|---|---|---|
| 10 MB | False | 3 | passed | results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb__refresh-file1__2026-10-18T06-25-30-840Z.json |
| 1 MB | False | 3 | passed | results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb__refresh-file1__2026-10-18T06-25-15-879Z.json |
| 50 MB | True | 3 | passed | results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb__refresh-file1__2026-10-18T06-25-51-426Z.json |

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

The latest checks below target `95945cd`, October 18. Small-file observations and worker-path scalar edits are separate. The worker fixture contains a 2.1-million-character padding string. A trusted edit adds X inside the export string. The seven numeric cases and duplicate members remain in the document. The adapter requires a matching packed-tree response from a parse or analysis request, then grades visible Format and Tree text. Worker messages identify the path; their values do not supply the verdict.

| Path | Rendered view | Number values | Duplicate members | Observation | Raw source |
|---|---|---|---|---|---|
| Small document | format | 7/7 kept | kept | captured | results/refresh-2026-10-18T06-23-00-569Z/results/raw-fidelity/2026-10-18/tool-kumar__run1__2026-10-18T06-24-21-248Z.json |
| Small document | format | 7/7 kept | kept | captured | results/refresh-2026-10-18T06-23-00-569Z/results/raw-fidelity/2026-10-18/tool-kumar__run2__2026-10-18T06-29-28-849Z.json |
| After edit | No graded capture | Unconfirmed | Unconfirmed | No packed tree observed after the edit | results/refresh-2026-10-18T06-23-00-569Z/results/raw-fidelity/2026-10-18/tool-kumar__run3__2026-10-18T06-24-34-810Z.json |
| Scalar edit and packed-tree reply | format | 7/7 kept | kept | captured | results/refresh-2026-10-18T06-23-00-569Z/results/raw-fidelity/2026-10-18/tool-kumar__run3__2026-10-18T06-30-00-507Z.json |
| Scalar edit and packed-tree reply | tree | 7/7 kept | kept | captured | results/refresh-2026-10-18T06-23-00-569Z/results/raw-fidelity/2026-10-18/tool-kumar__run3__2026-10-18T06-30-00-507Z.json |
| Scalar edit and packed-tree reply | format | 7/7 kept | kept | captured | results/refresh-2026-10-18T06-23-00-569Z/results/raw-fidelity/2026-10-18/tool-kumar__run4__2026-10-18T06-29-42-038Z.json |
| Scalar edit and packed-tree reply | tree | 7/7 kept | kept | captured | results/refresh-2026-10-18T06-23-00-569Z/results/raw-fidelity/2026-10-18/tool-kumar__run4__2026-10-18T06-29-42-038Z.json |

The initial worker attempt timed out on an obsolete message predicate before any graded capture. It remains unconfirmed. One corrected normal-navigation visit is documented in [the refresh correction log](results/refresh-2026-10-18T06-23-00-569Z/RETRIES.md). This check covers selected literals and operations. It does not prove byte-identical output for every setting or every edit.

## Why the original native formatter was faster

JSON Formatter Online's inspected Format handler used `JSON.parse` and `JSON.stringify`. JavaScript's native number conversion is fast and can round JSON number literals. In the original Node check, that round trip changed 602 of 1,204 unsafe integer account numbers in the hashed 1 MB fixture. This is a script check, not a count from a competitor's large rendered output.

```js
JSON.stringify(JSON.parse('{"id":9007199254756831}'))
// '{"id":9007199254756832}'
```

The October 15 parser comparison pinned Tool Kumar to `e84bb4295cc1ec0c02e940f78313a2f2aa72ed50`. Warm best paired parse-plus-format times were 21.0 ms for native versus 85.3 ms for Tool Kumar at 1 MB, and 296.7 ms versus 1,020.8 ms at 10 MB. The original Tool Kumar code also scheduled formatting after 60 ms for small documents or 250 ms for larger ones. Those facts explain part of the original gap. Node stage times cannot be subtracted from browser times to isolate rendering.

We repeated the stage check on October 18 with parser and formatter copies pinned to `95945cd06fbc70cfdf1cd85acaa38f1c86a4dc7a`. The table times full formatting paths in Node. It does not measure the new incremental edit-to-output path or explain a browser result by subtraction.

| Fixture | Implementation | Cold parse / format / total, ms | Warm best, ms | Warm median, ms |
|---|---|---|---|---|
| 1 MB | native | 8.7 / 11.6 / 20.4 | 8.5 / 11.4 / 20.1 | 9.1 / 11.5 / 20.6 |
| 1 MB | tool-kumar | 45.0 / 73.9 / 118.9 | 38.8 / 26.7 / 65.5 | 40.4 / 32.5 / 80.3 |
| 1 MB | source-reindent | 0.0 / 48.0 / 48.0 | 0.0 / 24.8 / 24.8 | 0.0 / 38.4 / 38.4 |
| 10 MB | native | 170.4 / 198.5 / 369.0 | 86.1 / 126.6 / 212.7 | 87.1 / 126.8 / 214.9 |
| 10 MB | tool-kumar | 290.5 / 450.8 / 741.3 | 280.1 / 438.8 / 727.8 | 352.5 / 494.9 / 842.4 |
| 10 MB | source-reindent | 0.0 / 311.8 / 311.8 | 0.0 / 290.0 / 290.0 | 0.0 / 309.7 / 309.7 |

Each implementation and fixture runs in a fresh Node process. The first call is cold and the next five are warm. Reads, imports and explicit garbage collection are outside the timed intervals. Best parse, format and paired total can come from different calls. The source re-indenter formats source text directly, before later analysis. [Current parse-cost script](results/refresh-2026-10-18T06-23-00-569Z/parse-cost.mjs).

## What changed for Tool Kumar users?

The changes below were made after the first benchmark. They make this an optimized follow-up comparison. The retained competitor observations are dated separately. Competitors were not changed by us.

- [Output first, `f08ea76`](https://github.com/VikasMaur-2nd/tools/commit/f08ea76), October 15. A large document can show formatted text before the input editor, tree and statistics finish.
- [Warm the open path, `47a846b`](https://github.com/VikasMaur-2nd/tools/commit/47a846b), October 15. Opening a file no longer waits for the service worker to finish before warming the work it needs.
- [Virtual input, `de505fd`](https://github.com/VikasMaur-2nd/tools/commit/de505fd), October 15. The editor draws visible rows and uses a bounded native input passage for large documents.
- [Worker analysis and output, `2dfd33d`](https://github.com/VikasMaur-2nd/tools/commit/2dfd33d), October 15. Large-document typing moves analysis and output work off the page's main thread.
- [Packed parse, `31b8b6f`](https://github.com/VikasMaur-2nd/tools/commit/31b8b6f), October 16. The worker sends its parsed tree to the page, which rebuilds it in short slices between input events.
- [Editable up to 16 million characters, `611eea4`](https://github.com/VikasMaur-2nd/tools/commit/611eea4), October 16. The default editable range expands. Characters are not bytes; this does not mean a universal 16 MB limit.
- [Retry the editor module, `b7157f6`](https://github.com/VikasMaur-2nd/tools/commit/b7157f6), October 16. A failed module load can be retried when the large-document editor is needed.

The next changes belong to the October 17 repeat at 925fc3c. The commit links document their implementation. The measured opening, editing, search and correctness results above describe that measured build. They do not isolate each commit or verify every reported browser fix.

- [Share large-document edits, `eacc5c9`](https://github.com/VikasMaur-2nd/tools/commit/eacc5c9), October 16. The editor changes how it stores edits to long documents.
- [Bound output updates, `e80c71a`](https://github.com/VikasMaur-2nd/tools/commit/e80c71a), October 16. The Format view splits output work across tasks.
- [Keep pasted documents editable, `94e1da0`](https://github.com/VikasMaur-2nd/tools/commit/94e1da0), October 17. Pasting a replacement source changes its editor activation path. The round-trip check above tests that behavior.
- [Retry worker startup, `925fc3c`](https://github.com/VikasMaur-2nd/tools/commit/925fc3c), October 17. Worker startup can retry after a failure. This study has not tested Safari repeat visits.

The default size threshold is an implementation detail linked above. Our fixtures test specific character counts; they do not locate the exact threshold boundary. Those October 17 observations stop at 925fc3c. Later changes need another measurement before they can replace its numbers.

- [Long lines use the custom editor, `a45bff4`](https://github.com/VikasMaur-2nd/tools/commit/a45bff4), October 18. A minified source with a line of at least 5,000 characters can use the large-document editor even below 250,000 total characters. The 100 KB profiles above test the actual editor used.

- [Caret status after editor switches, `ba8b1b6`](https://github.com/VikasMaur-2nd/tools/commit/ba8b1b6), October 18. The status bar receives the new editor caret. This study does not independently grade every status-bar switch.

- [Incremental source and formatting, `29d83eb`](https://github.com/VikasMaur-2nd/tools/commit/29d83eb), [retained output patches, `94a5b2d`](https://github.com/VikasMaur-2nd/tools/commit/94a5b2d), and [checkpoint preparation, `95945cd`](https://github.com/VikasMaur-2nd/tools/commit/95945cd), October 18. The Format view can update from a scalar edit. The measured scalar-burst output intervals above test the resulting behavior. Structural edits, sorting and escaping can use a full pass. Their separate end-to-end cost was not isolated here.

## The original 50 MB search failure and its fix

Tool Kumar at `19b7ac7` opened and collapsed 50 MB in all three runs. Its search reported "1 of 1" but did not render the last-record match in any run. Chromium clamped a requested scroll height of about 78.6 million pixels to 33,554,432 pixels. A successful opening had hidden a navigation failure.

Fix [`722ffec`](https://github.com/VikasMaur-2nd/tools/commit/722ffec) bounds the physical scroll height at 15,000,000 pixels. The October 15, 09:39 to 09:40 UTC production repeat rendered the final match and collapsed the file in all three runs. Its opening median was 10.449 s [10.241 s to 13.825 s], beside the original 9.857 s [9.165 s to 9.924 s]. Its renderer median was 1,499 MiB [1,467 to 1,518], beside the original 1,486 MiB [1,468 to 1,512]. The 6.0% slower opening in that shared-host repeat does not isolate the fix's effect. Both sets remain in the evidence. [Failure and re-verification](tool-kumar-scroll-limit.md).

The October 18 production repeat at `95945cd` records {'ok': 3} for last-record search in three primary file-path attempts. The new results remain separate from the original failure and its fix.

## Method and reproducibility

The minified UTF-8 fixtures model a deterministic customer API export. Their two-space partners preserve the exact token stream. They include Unicode, unsafe integers and duplicate-key fidelity cases in separate correctness fixtures. Original fixture SHA-256 values were checked after the cache restoration and before navigation. Every editing record verifies its own source against the unchanged deterministic manifest.

The main browser remains Chromium 145.0.7632.0 headless shell at 1366 by 900, GPU disabled. The host has four logical CPUs and 15,759 MiB RAM. The browser-tree budget is 6 GiB, with a 3,500 MiB available-memory floor and at least 8,000 MiB available at browser start. Each visit uses a fresh profile, disabled browser cache, six-second settle and one-second pre-input wait. Dedicated opening runs use the inherited input path and done predicate, with 100 ms polling and two frames. Precise DOM and frame times come from the same in-page observer as the baseline.

Opening through paste uses the inherited synthetic clipboard-event helper, with the source staged before timing. That is the same helper used for the original comparison. Editing uses trusted CDP key input and trusted Ctrl+V from the browser clipboard. The two input methods describe different tests and are labeled separately.

Every measurement holds the shared benchmark lock through `flock --close`. Load must be below 4 before the lock and before each run. Timed runs run alone. Batches release the lock within about eight minutes. No web server starts inside it. Browser profiles are deleted after their run. Every navigation and provenance request is entered in the page-load ledger. No challenge bypass, ad click or server upload is allowed.

Only batches with unchanged before/after production evidence enter the new summaries. New Tool Kumar records name `95945cd06fbc70cfdf1cd85acaa38f1c86a4dc7a`. Competitor source commits are unknown. Their visit times and served scripts remain recorded. The October 18 JSON Formatter Online visits are new scheduled observations, not retries of old results. The other competitors keep their actual dates and failures. All earlier dated directories and the designated initial-results snapshot are unchanged.

[Full methodology](methodology.md), [fixtures](fixtures.sha256.jsonl), [results](publish/summary.json), [latest refresh](publish/latest-refresh-summary.json), [Firefox supplement](publish/firefox-summary.json), [editing details](publish/editing-details.md) and [corrections](results/refresh-2026-10-18T06-23-00-569Z/RETRIES.md) retain the source references. Run the following command from the study directory for a new dated Tool Kumar series. The `--commit` option pins an expected deployment or labels an alternate URL.

```bash
./refresh.sh --url https://tools.vikasmaur.com/ --runs 3 --editing-runs 3
```

## Limitations

Small timing gaps inside the spread, or below 25% for operations under two seconds, are treated as ties. A shared host, advertisements, network and a headless browser limit the result. A viewer, formatter and validator also do different work. Code Beautify optional Big Num mode remains untested. The default-mode competitor fidelity observations remain October 15.

This update has no matched earlier Firefox baseline. It cannot establish a 3% Firefox regression. Safari-specific copying, offline repeat visits and failed-worker recovery were not tested. The new scalar edit checks do not prove byte-identical full output for all settings. Structural-edit output completion, sort/escape costs and a status-bar caret audit remain unconfirmed. Earliest whole-document editability was not isolated fairly for every editor.

Some output intervals remain unconfirmed when their marker is outside the visible output. For already-prettified JSON Formatter Online and JSONLint, source and formatted text use the same editor, so a separate formatter-completion instant cannot be isolated. Operation frame bounds do not establish all Enter, Backspace, paste or Undo output-completion times. Page-scroll fallbacks are excluded. No mobile performance or minify/prettify-toggle benchmark was added.

The October 17 size ladder is historical at `925fc3c`. It was not rerun above 50 MB. Browser stops are not universal maximum sizes. Previously blocked tools remain outside the comparison. JSON Hero remains excluded for server upload.

## FAQ

### Which tool should I try for a 50 MB JSON file?

At `95945cd`, Tool Kumar recorded 3/3 opened, 8.307 s [8.269 s to 8.897 s]. Its 50 MB source opens read-only and needs Edit anyway. The typing and scalar-output tables then describe its editable state. The other tools retain their dated opening and size outcomes above.

### Is JSON Formatter Online faster than Tool Kumar?

It won the original 1 MB and 10 MB opening comparison. The latest paste and 100 KB/10 MB editing tables show where its lower medians or tails remain. Its number-fidelity and memory results describe separate tradeoffs. A single opening or typing metric does not establish the best everyday tool.

### Does formatting keep large IDs exactly?

The October 15 default-mode check found that Tool Kumar kept the seven numeric cases and both duplicate members. Each competitor changed the seven values and dropped a duplicate member. The new Tool Kumar observations above grade rendered output after a real scalar edit. Failed captures stay unconfirmed. These selected cases are not a proof for every export or setting.

### Can I edit a large document as soon as I see formatted output?

Output can appear before input activation or later analysis finishes. Tool Kumar sources over 16 million characters open read-only by default and need Edit anyway. A prettified partner has more characters and may cross that threshold. Use the enabled-input observations and complete typing profiles together.

### Why measure minified and prettified sources separately?

A minified source puts much of the document on one huge line. A prettified source adds bytes and many short lines. Those inputs can exercise different editor paths. The two formats have the same deterministic data and matched caret values.

### Does the before-and-after isolate code changes?

The original production comparison includes a host resize and a memory-budget change. The October 17 local control holds hardware and its 2.5 GiB budget constant for `19b7ac7`, `aee1ae3` and `925fc3c`. The October 18 refresh uses the same host and 6 GiB budget as the saved initial results, but shared-host pressure and observation time still vary. No new local or historical Firefox control was run.

### Why is output-update time separate from typing latency?

The editor can accept a key before its formatted output catches up. The new scalar-output intervals and typing Event Timing/rAF values measure different milestones. Button-based tools also require an explicit action. Unconfirmed output timing is reported as unconfirmed.

### Did this benchmark guide Tool Kumar improvements?

Yes. The initial findings included slow minified 100 KB typing and about 9 to 10 s first-caret 50 MB output updates. The owner then changed those paths. The before-and-after tables keep the old commit and the new measurements visible. We did not modify competitors.

### Do these results establish privacy?

No. These synthetic workflows and request observations are narrower than an audit of every data flow. The [separate privacy study](/blogs/json-formatter-privacy-study) explains its scope.

## Editorial options

Chosen headline: Large JSON benchmark: opening, typing and number fidelity

- Minified vs. prettified JSON: opening and typing in six tools

- Large JSON files: what six browser tools could open and edit
