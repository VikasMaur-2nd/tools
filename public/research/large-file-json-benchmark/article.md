# Large JSON benchmark: opening, typing and number fidelity

We first tested six browser JSON tools on October 15, 2026. Tool Kumar at `19b7ac7` opened our 1 MB, 10 MB and 50 MB files in median times of 0.890 s, 2.482 s and 9.857 s. We then made major changes to Tool Kumar. The current production target is `925fc3c`. Its repeat is recorded below with actual counts. This is an unfinished research draft. It is not ready to publish.

Disclosure: Tool Kumar's maker ran this study. We optimized Tool Kumar after the first measurements. We did not change any competitor. Earlier Tool Kumar results stay under their measured commits. Competitor observations retained from October 17 have their own dates, paths and counts. They were interleaved with the earlier `b7157f6` series, not with this later repeat. No competitor result has been relabeled as a new run.

The original host had two CPUs and 7,801 MiB RAM. The owner resized it on October 17. The new host has four CPUs and 15,759 MiB RAM. The historical production timings include both hardware and code changes. They cannot isolate a code speedup. The separate local-build control below holds hardware constant. Its own completion status and sample counts are shown; the historical CDN difference is not a code-only estimate.

GitHub Production deployment `7136322793` associates `925fc3c6f004552a8cdea9628699de9735682d01` with a successful deployment. The saved served-page build token and immutable script paths provide separate evidence. No commit identifier is independently embedded in that page. The served build token was `0KTjE-idTF_Ru-giVfrP7`. Scripts used `/_next/static/immutable/chunks/`. This was a metadata-only capture, not a browser benchmark. The current repeat saves this evidence before and after each batch and rejects a batch if it changes.

Decimal MB describes file bytes. MiB describes process memory. Times below include input delivery and visible output, not the site's initial page load. Square brackets give the observed minimum and maximum. The [downloadable results](publish/summary.json) include per-run source paths, fixture hashes and commit evidence. The [measurement ledger](publish/measurement-ledger.md) lists every accepted attempt and its date. This is one shared host and one browser, not a capacity guarantee for every device.

## What we found

At 1 MB, latest Tool Kumar recorded 3/3 opened, 0.420 s [0.392 s to 0.671 s].

At 10 MB, latest Tool Kumar recorded 3/3 opened, 1.720 s [1.565 s to 1.745 s].

At 50 MB, latest Tool Kumar recorded 3/3 opened, 10.785 s [9.192 s to 11.763 s].

The lowest observed polled time at 1 MB was JSON Formatter Online, 0.375 s. The table gives the actual repeat count and input path. This is a partial comparison.

The lowest observed polled time at 10 MB was JSON Formatter Online, 1.163 s. The table gives the actual repeat count and input path. This is a partial comparison.

Tool Kumar's 10 MB file opening was slower in the current repeat, 1.720 s, than the earlier single b7157f6 observation, 1.160 s. The current cell has 3 runs; the earlier cell has 1. Host pressure and the measurement time changed. This does not isolate a code regression.

Tool Kumar's 50 MB file opening was slower in the current repeat, 10.785 s, than the earlier single b7157f6 observation, 5.049 s. The current cell has 3 runs; the earlier cell has 1. Host pressure and the measurement time changed. This does not isolate a code regression.

The 50 MB last-record search passed 3/3 times. Opening probes kept its default read-only state. The separate editing and cut/paste checks use Edit anyway.

The 50 MB search median was 291 ms, with an observed range of 279 to 2543 ms. The slowest successful search still took more than two seconds.

On the paste path at 1 MB, JSON Formatter Online's retained 0.375 s observation was lower than Tool Kumar's 0.466 s median. Tool Kumar has 3 runs and that competitor cell has 1. This is a partial same-day comparison, not a repeated fresh ranking.

On the paste path at 10 MB, JSON Formatter Online's retained 1.163 s observation was lower than Tool Kumar's 1.504 s median. Tool Kumar has 3 runs and that competitor cell has 1. This is a partial same-day comparison, not a repeated fresh ranking.

Under the original 2.5 GiB browser budget, 100 MB formatted output appeared in 17.101 s before the watchdog stopped the browser. That run could not establish full usability. The separate 6 GiB capacity tests below use the resized host's extra memory without replacing those earlier observations.

All 4 current fidelity observations kept the seven numeric values and both duplicate members. Both worker checks graded rendered Format and Tree after a trusted edit and a matching packed-tree reply.

JSON Formatter Online won the original smaller-file comparison. It took 0.43 s at 1 MB and 1.22 s at 10 MB, beside Tool Kumar's 0.89 s and 2.48 s. Those wins remain part of the record. The current table retains each sample count and input path. Competitor cells are single observations, so they do not supply new repeated estimates. A tree that opens but cannot search to its last record is a different result from a fully usable document.

On the same resized host, local 1 MB polled opening fell from 0.866 s at 19b7ac7 to 0.393 s at 925fc3c. The 50 MB result was mixed. Its polled median fell from 9.127 s to 8.649 s, but the precise in-page DOM median increased from 6.388 s to 8.576 s. The code control does not support a claim that every opening metric improved.

The 50 MB typing attempts did not supply three complete matched profiles under the fixed 2.5 GiB browser cap. The first attempts stopped during preparation. A later minified attempt reached the first burst before the cap stop. The 2.5 GiB series supplies no valid combined 50 MB typing median. The separate 6 GiB observations are reported in the size-capacity section. The source opened editable after Edit anyway, but that alone did not establish sustained typing within the cap. The failures remain in the editing table.

The 100 KB minified source had an Event Timing median of 88.0 ms and p95 of 744.0 ms. Its prettified partner was 32.0 ms and 56.0 ms. These smaller sources used the native textarea path. The larger editable fixtures used the custom virtual editor. Smaller was not always faster to type in this setup. This does not isolate wrapping as the cause.

## Before and after

The first Tool Kumar row uses the original study. Its later 50 MB scrolling fix is described separately below. The Host column makes the hardware change explicit. The latest Tool Kumar row uses only the 925fc3c repeat. Competitor rows retain October 17 observations. Counts show the partial coverage. We compare the same polled completion metric across versions. The original study did not have the later in-page observer.

| Tool | Version | Date, UTC | Host | 1 MB | 10 MB | 50 MB |
|---|---|---|---|---|---|---|
| Tool Kumar | 19b7ac7 | 2026-10-15 | 2 CPUs; 7,801 MiB RAM | 0.890 s [0.889 s to 0.900 s] | 2.482 s [2.290 s to 2.498 s] | 9.857 s [9.165 s to 9.924 s] |
| Tool Kumar | b7157f6, partial | 2026-10-17 | 4 CPUs; 15,759 MiB RAM | 1/1 opened, 0.675 s [0.675 s to 0.675 s] | 1/1 opened, 1.160 s [1.160 s to 1.160 s] | 1/1 opened, 5.049 s [5.049 s to 5.049 s] |
| Tool Kumar | 925fc3c | 2026-10-17 | 4 CPUs; 15,759 MiB RAM | 3/3 opened, 0.420 s [0.392 s to 0.671 s] | 3/3 opened, 1.720 s [1.565 s to 1.745 s] | 3/3 opened, 10.785 s [9.192 s to 11.763 s] |
| Code Beautify JSON Viewer | public site, retained | 2026-10-17 | 4 CPUs; 15,759 MiB RAM | 1/1 opened, 4.058 s [4.058 s to 4.058 s] | 1/1 exceeded memory cap | 1/1 exceeded memory cap |
| JSON Beautifier | public site, retained | 2026-10-17 | 4 CPUs; 15,759 MiB RAM | 1/1 opened, 0.802 s [0.802 s to 0.802 s] | 1/1 opened, 5.309 s [5.309 s to 5.309 s] | 1/1 exceeded memory cap |
| JSON Viewer Stack | public site, retained | 2026-10-17 | 4 CPUs; 15,759 MiB RAM | 1/1 opened, 0.664 s [0.664 s to 0.664 s] | 1/1 view detected, interaction obstructed | 1/1 exceeded memory cap |
| JSON Formatter Online | public site, retained | 2026-10-17 | 4 CPUs; 15,759 MiB RAM | 1/1 opened, 0.375 s [0.375 s to 0.375 s] | 1/1 opened, 1.163 s [1.163 s to 1.163 s] | 1/1 no formatted view within 90 s |
| JSONLint | public site, retained | 2026-10-17 | 4 CPUs; 15,759 MiB RAM | 1/1 opened, 5.994 s [5.994 s to 5.994 s] | 1/1 opened, 19.715 s [19.715 s to 19.715 s] | 1/1 exceeded memory cap |

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

The target is three attempts per primary cell. Actual counts are shown. Retained competitor cells currently have one attempt each. A formatted or tree view must satisfy the original adapter predicate. A page that only retains minified input does not pass. File opening is used for Tool Kumar, Code Beautify and JSON Beautifier. Stack, JSON Formatter Online and the JSONLint validator use paste. JSON Beautifier then requires Beautify. JSONLint requires Validate and Prettify.

| Tool | 1 MB | 10 MB | 50 MB |
|---|---|---|---|
| Tool Kumar | 3/3 opened, 0.420 s [0.392 s to 0.671 s] | 3/3 opened, 1.720 s [1.565 s to 1.745 s] | 3/3 opened, 10.785 s [9.192 s to 11.763 s] |
| Code Beautify JSON Viewer | 1/1 opened, 4.058 s [4.058 s to 4.058 s] | 1/1 exceeded memory cap | 1/1 exceeded memory cap |
| JSON Beautifier | 1/1 opened, 0.802 s [0.802 s to 0.802 s] | 1/1 opened, 5.309 s [5.309 s to 5.309 s] | 1/1 exceeded memory cap |
| JSON Viewer Stack | 1/1 opened, 0.664 s [0.664 s to 0.664 s] | 1/1 view detected, interaction obstructed | 1/1 exceeded memory cap |
| JSON Formatter Online | 1/1 opened, 0.375 s [0.375 s to 0.375 s] | 1/1 opened, 1.163 s [1.163 s to 1.163 s] | 1/1 no formatted view within 90 s |
| JSONLint | 1/1 opened, 5.994 s [5.994 s to 5.994 s] | 1/1 opened, 19.715 s [19.715 s to 19.715 s] | 1/1 exceeded memory cap |

JSON Hero remains excluded from this refresh. The original study observed a document upload to its server and did not confirm completion of its single 1 MB run. We did not send another document. Cap stops are watchdog stops, not natural browser crashes. An obstructed view stays in the record and has no successful timing median.

## Formatted output and an editable input are different milestones

The polled metric includes the harness's checks and two frames. It is the direct comparison with the original study. The in-page DOM metric records the same visible predicate inside the page. The two-frame metric records two animation frames after it. Polling can finish later when other work occupies the main thread.

Input-enabled time is a separate DOM observation. A dormant Tool Kumar input gets one public activation click after the opening screenshot; the raw record also gives its click-to-enabled interval. Its input-ready total therefore includes the observer's delayed click and is not an automatic-readiness claim. A default read-only notice stays read-only in this opening table. The separate typing study explicitly clicks Edit anyway where needed. This column records a visible, enabled input with content where that content is exposed by a native textarea. Some editors are already enabled at input delivery. It does not prove that the whole file is ready to edit. We also insert one space through the site's input and try Undo after the other checks. The final column records that separate observation. A virtual editor may keep only a passage of the document in its textarea.

| Tool | Size | Path | Polled output | In-page DOM | In-page two frames | Input enabled | Activation click to enabled | Character edit |
|---|---|---|---|---|---|---|---|---|
| Tool Kumar | 1 MB | file | 0.420 s [0.392 s to 0.671 s] | 0.276 s [0.264 s to 0.451 s] | 0.382 s [0.347 s to 0.610 s] | 0.900 s [0.802 s to 1.527 s] | 0.096 s [0.066 s to 0.290 s] | 3/3 verified character edit |
| Tool Kumar | 10 MB | file | 1.720 s [1.565 s to 1.745 s] | 1.576 s [1.493 s to 1.674 s] | 1.605 s [1.516 s to 1.697 s] | 2.820 s [2.800 s to 3.178 s] | 0.162 s [0.088 s to 0.163 s] | 3/3 verified character edit |
| Tool Kumar | 50 MB | file | 10.785 s [9.192 s to 11.763 s] | 10.673 s [9.136 s to 11.686 s] | 10.753 s [9.162 s to 11.717 s] | Not measured | Not measured | 3/3 read-only by default |
| Code Beautify JSON Viewer | 1 MB | file | 4.058 s [4.058 s to 4.058 s] | 2.062 s [2.062 s to 2.062 s] | 3.650 s [3.650 s to 3.650 s] | 0.016 s [0.016 s to 0.016 s] | Not measured | 1/1 not reached |
| Code Beautify JSON Viewer | 10 MB | file | Not measured | Not measured | Not measured | Not measured | Not measured | 1/1 not reached |
| Code Beautify JSON Viewer | 50 MB | file | Not measured | Not measured | Not measured | Not measured | Not measured | 1/1 not reached |
| JSON Beautifier | 1 MB | file | 0.802 s [0.802 s to 0.802 s] | 0.637 s [0.637 s to 0.637 s] | 0.683 s [0.683 s to 0.683 s] | 0.007 s [0.007 s to 0.007 s] | Not measured | 1/1 verified character edit |
| JSON Beautifier | 10 MB | file | 5.309 s [5.309 s to 5.309 s] | 4.905 s [4.905 s to 4.905 s] | 5.035 s [5.035 s to 5.035 s] | 0.010 s [0.010 s to 0.010 s] | Not measured | 1/1 verified character edit |
| JSON Beautifier | 50 MB | file | Not measured | Not measured | Not measured | Not measured | Not measured | 1/1 not reached |
| JSON Viewer Stack | 1 MB | paste | 0.664 s [0.664 s to 0.664 s] | 0.556 s [0.556 s to 0.556 s] | 0.580 s [0.580 s to 0.580 s] | 0.313 s [0.313 s to 0.313 s] | Not measured | 1/1 verified character edit |
| JSON Viewer Stack | 10 MB | paste | Not measured | Not measured | Not measured | Not measured | Not measured | 1/1 not reached |
| JSON Viewer Stack | 50 MB | paste | Not measured | Not measured | Not measured | Not measured | Not measured | 1/1 not reached |
| JSON Formatter Online | 1 MB | paste | 0.375 s [0.375 s to 0.375 s] | 0.212 s [0.212 s to 0.212 s] | 0.218 s [0.218 s to 0.218 s] | 0.099 s [0.099 s to 0.099 s] | Not measured | 1/1 verified character edit |
| JSON Formatter Online | 10 MB | paste | 1.163 s [1.163 s to 1.163 s] | 0.996 s [0.996 s to 0.996 s] | 1.034 s [1.034 s to 1.034 s] | 0.379 s [0.379 s to 0.379 s] | Not measured | 1/1 verified character edit |
| JSON Formatter Online | 50 MB | paste | Not measured | Not measured | Not measured | Not measured | Not measured | 1/1 not reached |
| JSONLint | 1 MB | paste | 5.994 s [5.994 s to 5.994 s] | 5.178 s [5.178 s to 5.178 s] | 5.364 s [5.364 s to 5.364 s] | 0.005 s [0.005 s to 0.005 s] | Not measured | 1/1 verified character edit |
| JSONLint | 10 MB | paste | 19.715 s [19.715 s to 19.715 s] | 14.066 s [14.066 s to 14.066 s] | 19.004 s [19.004 s to 19.004 s] | 0.009 s [0.009 s to 0.009 s] | Not measured | 1/1 could not be checked |
| JSONLint | 50 MB | paste | Not measured | Not measured | Not measured | Not measured | Not measured | 1/1 not reached |
| Tool Kumar | 1 MB | paste | 0.466 s [0.375 s to 0.570 s] | 0.322 s [0.243 s to 0.349 s] | 0.413 s [0.330 s to 0.489 s] | 0.656 s [0.580 s to 0.715 s] | Not measured | 3/3 verified character edit |
| Tool Kumar | 10 MB | paste | 1.504 s [1.426 s to 1.827 s] | 1.366 s [1.323 s to 1.712 s] | 1.390 s [1.354 s to 1.735 s] | 1.963 s [1.940 s to 2.207 s] | Not measured | 3/3 verified character edit |

The required editing study below measures source typing separately from those opening milestones. Live and button-driven output updates are labeled.

## Editing large JSON

The editing plan tests minified and two-space prettified copies of the same records at 100 KB, 1 MB and 10 MB of minified data. The pretty copy is larger in bytes. The current Tool Kumar target is three fresh-profile attempts per cell. Retained competitor cells show their actual counts. The table explicitly lists the unmeasured tool, format and size combinations. Most competitor typing cells are unfinished. The opening comparison is broader than the editing comparison. Every attempt remains visible. A burst inserts twenty characters at ten per second into an email string in the first, middle and last record. The caret is inside the string so the burst keeps JSON valid. Tool Kumar attempts click Edit anyway where required, and those rows are labeled. Character count and default editability are recorded separately. A larger pretty copy can cross a size threshold that the minified copy does not. Preparation time is outside the typing clock.

| Tool | Input editor | Output design |
|---|---|---|
| Tool Kumar | Native textarea with virtual syntax highlighting at 100 KB; Custom virtual editor with a native textarea passage at 1 MB, 10 MB, 50 MB | Live formatted view |
| Code Beautify JSON Viewer | Ace input, JSONEditor tree output at 100 KB | Auto Update enabled by default |
| JSON Beautifier | Ace at 100 KB | Beautify button |
| JSON Formatter Online | CodeMirror at 1 MB | Format button rewrites the same editor |

Event Timing captures the browser event-to-presentation duration, rounded and subject to a 16 ms threshold. Missing fast events are censored. A median or p95 shown as <16 ms is a bound, not a zero or an estimated exact value. The coverage column gives recorded events out of verified keys. The rAF cross-check gives every trusted keydown-to-next-frame observation. It is a frame bound, not a compositor paint timestamp. Output values run from the final trusted keydown to the frame after the final marker appears. They are position medians in start, middle and end order, where confirmed. The same clock works for editors that do not emit native input events. Button workflows click after a common 150 ms pause and a source check; the download also gives button-to-output time.

| Tool | Source format | Data size | Verified bursts | Outcome | Event Timing median | Event Timing p95 | Event entries / keys | rAF median | rAF p95 | Output update, ms | Longest frame, ms | Longest long task, ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tool Kumar | prettified | 100 KB | 3/3 complete profiles; 9/9 verified bursts | measured | 32.0 ms | 56.0 ms | 179/180 | 27.3 ms | 45.7 ms | start: 311.0 ms; middle: 313.5 ms; end: 325.9 ms | 100.0 ms | 67.0 ms |
| Tool Kumar | minified | 100 KB | 3/3 complete profiles; 9/9 verified bursts | measured | 88.0 ms | 744.0 ms | 180/180 | 73.1 ms | 727.6 ms | start: 282.0 ms; middle: 244.7 ms; end: 212.7 ms | 949.9 ms | 495.0 ms |
| Tool Kumar | prettified | 10 MB; Edit anyway | 3/3 complete profiles; 9/9 verified bursts | measured | 32.0 ms | 56.0 ms | 179/180 | 15.9 ms | 29.4 ms | start: 2932.4 ms; middle: 3050.2 ms; end: 3329.1 ms | 83.3 ms | No task at or above 50 ms recorded |
| Tool Kumar | minified | 10 MB | 3/3 complete profiles; 9/9 verified bursts | measured | 48.0 ms | 88.0 ms | 179/180 | 14.1 ms | 31.5 ms | start: 2704.0 ms; middle: 2780.8 ms; end: 2579.0 ms | 83.4 ms | 73.0 ms |
| Tool Kumar | prettified | 1 MB | 3/3 complete profiles; 9/9 verified bursts | measured | 24.0 ms | 48.0 ms | 178/180 | 11.6 ms | 18.5 ms | start: 830.2 ms; middle: Not confirmed; end: Not confirmed | 16.8 ms | No task at or above 50 ms recorded |
| Tool Kumar | minified | 1 MB | 3/3 complete profiles; 9/9 verified bursts | measured | 32.0 ms | 56.0 ms | 177/180 | 11.4 ms | 18.6 ms | start: 780.0 ms; middle: Not confirmed; end: Not confirmed | 50.1 ms | 66.0 ms |
| Tool Kumar | prettified | 50 MB; Edit anyway | 0/4 complete profiles; 0/12 verified bursts | Browser cap during editing preparation | Fewer than three complete matched profiles | Fewer than three complete matched profiles | 0/0 | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| Tool Kumar | minified | 50 MB; Edit anyway | 0/4 complete profiles; 0/12 verified bursts | Browser cap during editing preparation | Fewer than three complete matched profiles | Fewer than three complete matched profiles | 0/0 | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | minified | 100 KB | 0/1 complete profiles; 0/3 verified bursts | unresponsive during editing | Fewer than three complete matched profiles | Fewer than three complete matched profiles | 0/0 | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | Not measured | Not measured |
| JSON Beautifier | minified | 100 KB | 0/1 complete profiles; 2/3 verified bursts | partly measured | Fewer than three complete matched profiles | Fewer than three complete matched profiles | 0/0 | Not measured | Not measured | start: Not confirmed; middle: Not confirmed; end: Not confirmed | 149.9 ms | 138.0 ms |
| JSON Formatter Online | prettified | 1 MB | 1/1 complete profiles; 3/3 verified bursts | measured | Fewer than three complete matched profiles | Fewer than three complete matched profiles | 56/60 | Not measured | Not measured | start: 261.8 ms; middle: 267.3 ms; end: 359.0 ms | 100.0 ms | 74.0 ms |
| JSON Formatter Online | minified | 1 MB | 1/1 complete profiles; 3/3 verified bursts | measured | Fewer than three complete matched profiles | Fewer than three complete matched profiles | 60/60 | Not measured | Not measured | start: 281.6 ms; middle: Not confirmed; end: Not confirmed | 33.3 ms | No task at or above 50 ms recorded |
| Code Beautify JSON Viewer | prettified | 100 KB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | minified | 1 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | prettified | 1 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | minified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| Code Beautify JSON Viewer | prettified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Beautifier | prettified | 100 KB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Beautifier | minified | 1 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Beautifier | prettified | 1 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Beautifier | minified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Beautifier | prettified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | minified | 100 KB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | prettified | 100 KB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | minified | 1 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | prettified | 1 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | minified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Viewer Stack | prettified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Formatter Online | minified | 100 KB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Formatter Online | prettified | 100 KB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Formatter Online | minified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSON Formatter Online | prettified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSONLint | minified | 100 KB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSONLint | prettified | 100 KB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSONLint | minified | 1 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSONLint | prettified | 1 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSONLint | minified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |
| JSONLint | prettified | 10 MB | 0 profiles | Not measured in the retained series | Not measured | Not measured | 0/0 | Not measured | Not measured | Not confirmed | Not measured | Not measured |

The combined rAF median and p95 require at least three complete profiles with matched first, middle and end coverage. All keys in those complete profiles are pooled. Failed and incomplete profiles remain beside the conditional timing, with their observed stalls. If one position is unmeasurable, use the position table rather than comparing different sets of positions. A burst with missing or untrusted input events is not used for per-key summaries. Its failure remains in the downloadable records. A tool with no editable input or a frozen page keeps that outcome. A longest frame or task can come from an incomplete burst; it is an observed stall, not a verified per-key sample. A missing output marker means the visible update could not be confirmed, not an estimated debounce. Read each row with its editor design. JSONLint can validate an already-prettified source without offering Prettify. In that case the changed input alone does not isolate a formatted-output update, so the output interval stays unconfirmed. The Long Tasks API records tasks at or above 50 ms. If no such task was recorded in a verified burst, the table says so. That is not a measured zero-duration task. There is no combined winner score.

### Matched caret positions

The [editing detail tables](publish/editing-details.md) give each position separately, including incomplete attempts. The [machine-readable editing results](editing-summary.json) link every position to its raw source.

### Enter, Backspace, snippet and Undo

These are separate next-frame observations. The snippet contains 200 characters. The method column distinguishes trusted clipboard Ctrl+V from earlier direct Input.insertText observations or a clipboard fallback. Undo effect confirmation is separate from its command-to-frame time. Enter inside a string can temporarily invalidate JSON, so it does not supply an output-update comparison. Before moving to the next record, the runner restores the chosen source through trusted input. Later 50 MB profiles use trusted Undo and a final exact-source hash check to avoid repeatedly pasting a second whole document. Other profiles restore through trusted clipboard paste. Both methods are outside the typing clock and are recorded per profile.

The [editing detail tables](publish/editing-details.md) report median, p95, sample count, paste method and Undo effect for every tool, format, size and operation. A missing sample remains unmeasured.

### Input scrolling

This is a full-range rendering probe. It advances through twenty equally spaced native scroll positions at 50 ms intervals. Frame intervals describe that probe, not every wheel gesture. An unwrapped one-line editor can need horizontal scrolling. A missing native range remains unmeasured.

| Tool | Format | Data size | Median frame, ms | p95 frame, ms | Longest frame, ms | Outcome |
|---|---|---|---|---|---|---|
| Tool Kumar | prettified | 100 KB | 16.7 ms | 33.3 ms | 33.4 ms | measured; measured; measured |
| Tool Kumar | minified | 100 KB | 16.7 ms | 50.1 ms | 99.9 ms | measured; measured; measured |
| Tool Kumar | prettified | 10 MB | 16.7 ms | 49.9 ms | 716.6 ms | measured; measured; measured |
| Tool Kumar | minified | 10 MB | 16.7 ms | 49.9 ms | 600.1 ms | measured; measured; measured |
| Tool Kumar | prettified | 1 MB | 16.7 ms | 16.8 ms | 66.7 ms | measured; measured; measured |
| Tool Kumar | minified | 1 MB | 16.7 ms | 16.8 ms | 33.4 ms | measured; measured; measured |
| Tool Kumar | prettified | 50 MB | Not measured | Not measured | Not measured | Not reached |
| Tool Kumar | minified | 50 MB | Not measured | Not measured | Not measured | Not reached |
| Code Beautify JSON Viewer | minified | 100 KB | Not measured | Not measured | Not measured | Not reached |
| JSON Beautifier | minified | 100 KB | 16.7 ms | 16.8 ms | 16.8 ms | measured |
| JSON Formatter Online | prettified | 1 MB | 16.7 ms | 83.3 ms | 100.1 ms | measured |
| JSON Formatter Online | minified | 1 MB | 33.4 ms | 166.7 ms | 166.7 ms | measured |

### Opening the prettified copy

Size labels refer to the minified data. Exact source bytes and line counts make the larger pretty copies explicit. These opening observations use the public workflow before any typing probe.

| Tool | Source format | Data size | Actual bytes | Lines | Median opening | p95 opening |
|---|---|---|---|---|---|---|
| Tool Kumar | prettified | 100 KB | 186427 | 7945 | 0.432 s | 0.535 s |
| Tool Kumar | minified | 100 KB | 99638 | 1 | 0.614 s | 0.629 s |
| Tool Kumar | prettified | 10 MB | 18592911 | 788600 | 1.697 s | 1.753 s |
| Tool Kumar | minified | 10 MB | 9999719 | 1 | 1.861 s | 1.924 s |
| Tool Kumar | prettified | 1 MB | 1863123 | 79196 | 0.447 s | 0.465 s |
| Tool Kumar | minified | 1 MB | 999554 | 1 | 0.405 s | 0.421 s |
| Tool Kumar | prettified | 50 MB | 92806317 | 3930172 | 11.437 s | 12.817 s |
| Tool Kumar | minified | 50 MB | 49998859 | 1 | 8.944 s | 10.719 s |
| Code Beautify JSON Viewer | minified | 100 KB | 99638 | 1 | 2.080 s | 2.080 s |
| JSON Beautifier | minified | 100 KB | 99638 | 1 | 0.281 s | 0.281 s |
| JSON Formatter Online | prettified | 1 MB | 1863123 | 79196 | 0.373 s | 0.373 s |
| JSON Formatter Online | minified | 1 MB | 999554 | 1 | 0.372 s | 0.372 s |

The incomplete October 16 series on the two-CPU host is kept outside these medians. Its first Tool Kumar 100 KB minified run had a 688.3 ms rAF median and 1,253.1 ms p95, beside JSON Formatter Online at 51.4 ms and 83.7 ms. Tool Kumar's prettified partner was 24.4 ms and 32.2 ms, beside 10.8 ms and 18.1 ms. These are single-run observations, not historical three-run cells. Their raw references remain in the study.

No typing observations exist for the original `19b7ac7` study or the `aee1ae3` opening baseline. Separate typing numbers from the dev thread do not supply a historical cell. We do not claim a measured typing speedup across those versions. Full-run renderer peaks include typing and appear in the editing download. We did not add minify/prettify toggle timing because it would change the required source and update workflow.

### Failed and incomplete editing attempts

| Tool | Format | Data size | Outcome | Reason | Raw source |
|---|---|---|---|---|---|
| Tool Kumar | prettified | 50 MB | Browser cap during editing preparation | browser memory 2746 MiB exceeded the 2560 MiB cap | results/2026-10-17-925fc3c/results/raw/tool-kumar__50mb-pretty__editing1__2026-10-17T08-33-09-565Z.json |
| Tool Kumar | prettified | 50 MB | Browser cap during editing preparation | browser memory 2647 MiB exceeded the 2560 MiB cap | results/2026-10-17-925fc3c/results/raw/tool-kumar__50mb-pretty__editing1__2026-10-17T08-35-48-226Z.json |
| Tool Kumar | prettified | 50 MB | Browser cap during editing preparation | browser memory 2576 MiB exceeded the 2560 MiB cap | results/2026-10-17-925fc3c/results/raw/tool-kumar__50mb-pretty__editing2__2026-10-17T08-41-21-066Z.json |
| Tool Kumar | prettified | 50 MB | Browser cap during editing preparation | browser memory 2642 MiB exceeded the 2560 MiB cap | results/2026-10-17-925fc3c/results/raw/tool-kumar__50mb-pretty__editing3__2026-10-17T08-59-48-063Z.json |
| Tool Kumar | minified | 50 MB | Browser cap during editing preparation | browser memory 2580 MiB exceeded the 2560 MiB cap | results/2026-10-17-925fc3c/results/raw/tool-kumar__50mb__editing1__2026-10-17T08-31-12-835Z.json |
| Tool Kumar | minified | 50 MB | Browser cap during editing preparation | browser memory 2619 MiB exceeded the 2560 MiB cap | results/2026-10-17-925fc3c/results/raw/tool-kumar__50mb__editing1__2026-10-17T08-34-39-624Z.json |
| Tool Kumar | minified | 50 MB | Browser cap during editing preparation | browser memory 2788 MiB exceeded the 2560 MiB cap | results/2026-10-17-925fc3c/results/raw/tool-kumar__50mb__editing2__2026-10-17T08-40-36-192Z.json |
| Tool Kumar | minified | 50 MB | Browser cap during editing preparation | browser memory 2682 MiB exceeded the 2560 MiB cap | results/2026-10-17-925fc3c/results/raw/tool-kumar__50mb__editing3__2026-10-17T08-59-03-709Z.json |
| Code Beautify JSON Viewer | minified | 100 KB | unresponsive during editing | Runtime.evaluate: timeout 5000ms | results/2026-10-17-resized/results/raw/code-beautify-json-viewer__100kb__editing1__2026-10-17T01-13-06-310Z.json |
| JSON Beautifier | minified | 100 KB | partly measured | See the saved opening outcome and notes | results/2026-10-17-resized/results/raw/json-beautifier__100kb__editing1__2026-10-17T01-13-54-276Z.json |

The first 50 MB attempt in each format and its one corrected caret retry reached the browser cap during preparation. No normal per-key result is assigned to those attempts. They remain counted. Later scheduled 50 MB profiles avoid whole-document preparation pastes. A source-restoration failure occurs before the affected burst. It cannot supply a per-key latency or prove that one ordinary key would fail. The restoration itself replaces the whole document and can add undo history. A full-page ad stops interaction without a dismissal.

On the earlier two-CPU host, a Code Beautify 100 KB diagnostic captured a 65.4 s frame gap and a browser-cap stop. Its page-read budget differed, so it is preserved as diagnostic evidence. The one corrected standard-budget attempt also became unresponsive during typing. Neither failure receives a normal keystroke median. The [retry log](results/2026-10-16-refresh/RETRIES.md) explains every correction.

Earlier Tool Kumar 1 MB minified and prettified attempts on `b7157f6` could not prepare the requested caret, even after their permitted harness retry. They sent no timed burst. They remain preparation failures in the retained download and are not evidence of a typing freeze.

## How large a file did each tool handle?

These are partial tested brackets, not exact maximum sizes. Tool Kumar has one exploratory gap run at 5 MB and 25 MB. Competitor gap sizes remain unmeasured. The primary 1 MB, 10 MB and 50 MB cells target three repeats and show actual counts. That fixed comparison attempts all three sizes even if a smaller primary run fails. We stop climbing a tool's exploratory ladder at its first opening failure. Only a tool that passes 50 MB can try 100 MB, with at least 3,500 MB available in `free -m` before it starts. The same browser cap still applies.

| Tool | Largest opened in the 2.5 GiB series | First observed failure or cap stop in that series | Sizes tried |
|---|---|---|---|
| Tool Kumar | 100 MB | 100 MB: 1/1 opened, 17.101 s [17.101 s to 17.101 s]; 1 cap stop(s) during the full run | 1 MB, 5 MB, 10 MB, 25 MB, 50 MB, 100 MB |
| Code Beautify JSON Viewer | 1 MB | 1 MB: 1/1 opened, 4.058 s [4.058 s to 4.058 s]; 1 cap stop(s) during the full run | 1 MB, 10 MB, 50 MB |
| JSON Beautifier | 10 MB | 50 MB: 1/1 exceeded memory cap; 1 cap stop(s) during the full run | 1 MB, 10 MB, 50 MB |
| JSON Viewer Stack | 1 MB | 10 MB: 1/1 view detected, interaction obstructed | 1 MB, 10 MB, 50 MB |
| JSON Formatter Online | 10 MB | 50 MB: 1/1 no formatted view within 90 s | 1 MB, 10 MB, 50 MB |
| JSONLint | 10 MB | 10 MB: 1/1 opened, 19.715 s [19.715 s to 19.715 s]; 1 cap stop(s) during the full run | 1 MB, 10 MB, 50 MB |

Public size-limit statements from the pages loaded in this refresh are listed below. A page with no matching statement is not treated as a promise of unlimited files. We did not infer a documented maximum from the browser cap.

| Tool | Loaded public page | Limit text observed |
|---|---|---|
| Tool Kumar | https://tools.vikasmaur.com/ | No size-limit statement found on the loaded page |
| Code Beautify JSON Viewer | https://codebeautify.org/jsonviewer | No size-limit statement found on the loaded page |
| JSON Beautifier | https://jsonbeautifier.org/ | No size-limit statement found on the loaded page |
| JSON Viewer Stack | https://jsonviewer.stack.hu/ | No size-limit statement found on the loaded page |
| JSON Formatter Online | https://jsonformatter.com/ | No size-limit statement found on the loaded page |
| JSONLint | https://jsonlint.com/ | No size-limit statement found on the loaded page |

A cap message, a responsive minified editor, a hung page and a crash are separate outcomes. The first failure describes our browser, cap and fixture shape. It does not establish a product's universal file limit. Files with one long line can behave differently from files with many short lines.

### Supplemental size tests with a 6 GiB browser budget

The resized instance had room to test beyond the old browser cap. On October 17, 2026, we repeated Tool Kumar capacity checks at `925fc3c` with a 6 GiB total-browser budget, instead of 2.5 GiB. The watchdog still stopped below 3,500 MiB of host available memory. Each run required at least 8,000 MiB available at its start. Browser, viewport, fixture generator, six-second settle and opening predicate stayed the same. Production evidence was unchanged before and after every accepted batch.

These are one-attempt exploratory size tests, not repeated performance estimates. They are separate from the earlier comparison and do not establish competitor limits under the larger budget. A formatted preview and completion of all navigation checks remain separate outcomes. Default input at these sizes is read-only. This ladder does not test editing above the original 50 MB data size.

| Source size | Actual bytes | Polled formatted view | Last-record search | Collapse | Scroll to end | Tree | Peak total browser | Full-run outcome |
|---|---|---|---|---|---|---|---|---|
| 100 MB | 99999788 | 21.362 s | ok | ok | ok | ok | 2819 MiB | Completed |
| 200 MB | 199999972 | 39.708 s | ok | ok | ok | ok | 5049 MiB | Completed |
| 400 MB | 399999594 | no formatted view within 90 s | Not reached | Not reached | Not reached | Not reached | 430 MiB | no formatted view within 90 s |

The [public large-file guide](https://tools.vikasmaur.com/tools/large-json-viewer) states a 300 MB safety limit. The pinned source implements 300 MiB, or 314,572,800 bytes. The 400 MB fixture exceeds that guard and produced no formatted view within 90 s. The browser watchdog did not stop that run. The largest successful fixture here is 200 MB; we did not measure the exact boundary between 200 MB and the guard.

### Supplemental 50 MB editing with the 6 GiB budget

These profiles click Edit anyway and use the same first, middle and last record carets, twenty trusted CDP characters at ten per second, Enter, Backspace, a 200-character paste, Undo and input-scrolling checks. The minified and prettified sources contain the same data. The larger pretty file has its own byte count and hash. Preparation uses trusted Undo, with an exact source hash checked at the end. Values below combine only three complete matched profiles. Failed profiles remain outcomes in the download. Event Timing and the rAF cross-check retain the threshold and frame limitations described in the main editing section.

| Source format | Actual bytes | Complete profiles / attempts | Event median | Event p95 | rAF median | rAF p95 | Output update | Longest frame | Longest long task |
|---|---|---|---|---|---|---|---|---|---|
| prettified | 92806317 | 3/3 | 56.0 ms | 96.0 ms | 36.1 ms | 64.1 ms | start: Not confirmed; middle: Not confirmed; end: Not confirmed | 83.3 ms | 79.0 ms |
| minified | 49998859 | 3/3 | 48.0 ms | 104.0 ms | 10.2 ms | 63.3 ms | start: 9755.1 ms in 2/3 profiles; middle: Not confirmed; end: Not confirmed | 166.7 ms | 159.0 ms |

The minified start position supplied confirmed visible-output intervals in two of three profiles, 9.755 s and 10.093 s after the final key. Other positions and the prettified profiles did not supply confirmed intervals within the observer window. Later public-search diagnostics sometimes found the marker, which establishes eventual content, not its update time. The successful typing profiles do not establish equally fast formatted-output updates.

The separate capacity download includes per-operation frame times, Undo confirmation, source hash checks, scrolling frames, individual caret positions and every incomplete attempt. A failure in caret preparation is not assigned a keystroke latency.

[Supplemental capacity measurements](publish/capacity-summary.json) contain fixture hashes, limits, raw-source references, failed attempts and deployment checks. A stop at the new budget would still be a benchmark stop, not a universal maximum file size.

## Which features still worked at each size?

Search passes only when the tool renders the unique value in the last record. A match counter alone does not pass. Scroll-to-end checks use the public view and record its final text. Tree checks identify a separate Tree view where one is available. Code editors' fold controls are reported as collapse, not as a separate tree viewer. The default input probe is the reversible character check described above. It does not click Edit anyway. The separate cut/paste table and editing study report what happened after that button. A read-only default in this matrix is not a permanent editing limit.

| Tool | Size | View opened | Tree | Last-record search | Collapse | Scroll to end | Default input probe |
|---|---|---|---|---|---|---|---|
| Tool Kumar | 1 MB | 3/3 | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 verified character edit |
| Tool Kumar | 5 MB | 1/1 | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 verified character edit |
| Tool Kumar | 10 MB | 3/3 | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 verified character edit |
| Tool Kumar | 25 MB | 1/1 | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 read-only by default |
| Tool Kumar | 50 MB | 3/3 | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 ok | 3/3 read-only by default |
| Tool Kumar | 100 MB | 1/1 | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| Code Beautify JSON Viewer | 1 MB | 1/1 | 1/1 visible | 1/1 unresponsive at 30 s | 1/1 not tested after previous feature froze | 1/1 ok | 1/1 not reached |
| Code Beautify JSON Viewer | 10 MB | 0/1 | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| Code Beautify JSON Viewer | 50 MB | 0/1 | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| JSON Beautifier | 1 MB | 1/1 | 1/1 not offered in tested view | 1/1 ok | 1/1 not available | 1/1 ok | 1/1 verified character edit |
| JSON Beautifier | 10 MB | 1/1 | 1/1 not offered in tested view | 1/1 ok | 1/1 not available | 1/1 ok | 1/1 verified character edit |
| JSON Beautifier | 50 MB | 0/1 | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| JSON Viewer Stack | 1 MB | 1/1 | 1/1 visible | 1/1 not available | 1/1 ok | 1/1 ok | 1/1 verified character edit |
| JSON Viewer Stack | 10 MB | 0/1 | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| JSON Viewer Stack | 50 MB | 0/1 | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| JSON Formatter Online | 1 MB | 1/1 | 1/1 not offered in tested view | 1/1 ok | 1/1 no result within 30 s | 1/1 ok | 1/1 verified character edit |
| JSON Formatter Online | 10 MB | 1/1 | 1/1 not offered in tested view | 1/1 ok | 1/1 no result within 30 s | 1/1 ok | 1/1 verified character edit |
| JSON Formatter Online | 50 MB | 0/1 | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |
| JSONLint | 1 MB | 1/1 | 1/1 not offered in tested view | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 verified character edit |
| JSONLint | 10 MB | 1/1 | 1/1 not offered in tested view | 1/1 ok | 1/1 ok | 1/1 ok | 1/1 could not be checked |
| JSONLint | 50 MB | 0/1 | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached | 1/1 not reached |

Not available means the tested view has no corresponding control. Not reached means opening failed first. Not confirmed means the prescribed action did not supply the required DOM evidence. It is not a claim that no other action could work. A collapsed tree with a visible final root member does not prove that every nested record was reachable; the last-record search is the stronger check.

## Memory

Each value is the median peak, followed by the observed range. Renderer memory is the largest renderer process's resident memory plus swap. Browser memory sums the browser process tree. Shared pages can be counted more than once in that sum. This is not the JavaScript heap.

| Tool | Size | Renderer to view, MiB | Full renderer, MiB | Full browser, MiB | Outcomes |
|---|---|---|---|---|---|
| Tool Kumar | 1 MB | 184 [183 to 185] | 226 [221 to 255] | 522 [515 to 555] | ok |
| Tool Kumar | 10 MB | 452 [443 to 458] | 563 [542 to 718] | 863 [849 to 1020] | ok |
| Tool Kumar | 50 MB | 1161 [1156 to 1161] | 1402 [1381 to 1789] | 1686 [1672 to 2216] | ok |
| Code Beautify JSON Viewer | 1 MB | 812 [812 to 812] | 2185 [2185 to 2185] | 2570 [2570 to 2570] | ok; 1 full-run cap stops |
| Code Beautify JSON Viewer | 10 MB | 2213 [2213 to 2213] | 2213 [2213 to 2213] | 2563 [2563 to 2563] | exceeded memory cap; 1 full-run cap stops |
| Code Beautify JSON Viewer | 50 MB | 2241 [2241 to 2241] | 2241 [2241 to 2241] | 2570 [2570 to 2570] | exceeded memory cap; 1 full-run cap stops |
| JSON Beautifier | 1 MB | 389 [389 to 389] | 475 [475 to 475] | 784 [784 to 784] | ok |
| JSON Beautifier | 10 MB | 1282 [1282 to 1282] | 1450 [1450 to 1450] | 1756 [1756 to 1756] | ok |
| JSON Beautifier | 50 MB | 2324 [2324 to 2324] | 2324 [2324 to 2324] | 2623 [2623 to 2623] | exceeded memory cap; 1 full-run cap stops |
| JSON Viewer Stack | 1 MB | 209 [209 to 209] | 288 [288 to 288] | 593 [593 to 593] | ok |
| JSON Viewer Stack | 10 MB | 674 [674 to 674] | 674 [674 to 674] | 996 [996 to 996] | view detected, interaction obstructed |
| JSON Viewer Stack | 50 MB | 2190 [2190 to 2190] | 2190 [2190 to 2190] | 2580 [2580 to 2580] | exceeded memory cap; 1 full-run cap stops |
| JSON Formatter Online | 1 MB | 158 [158 to 158] | 221 [221 to 221] | 527 [527 to 527] | ok |
| JSON Formatter Online | 10 MB | 288 [288 to 288] | 427 [427 to 427] | 726 [726 to 726] | ok |
| JSON Formatter Online | 50 MB | 1126 [1126 to 1126] | 1126 [1126 to 1126] | 1406 [1406 to 1406] | no formatted view within 90 s |
| JSONLint | 1 MB | 646 [646 to 646] | 861 [861 to 861] | 1239 [1239 to 1239] | ok |
| JSONLint | 10 MB | 1654 [1654 to 1654] | 2270 [2270 to 2270] | 2648 [2648 to 2648] | ok; 1 full-run cap stops |
| JSONLint | 50 MB | 2167 [2167 to 2167] | 2167 [2167 to 2167] | 2596 [2596 to 2596] | exceeded memory cap; 1 full-run cap stops |

The full-run peak includes the later search, collapse, tree and edit checks, as well as ads. The first current file run at each size also includes the extra cut/paste correctness check. Full-run observation windows therefore differ; renderer-to-view is the consistent opening-memory comparison. The added compatibility probes extend that window beyond the original study. Use renderer-to-view when comparing opening alone. A browser-cap stop can leave a lower recorded renderer peak because other processes also consume the cap.

In the original study JSON Formatter Online used less renderer memory than Tool Kumar at 1 MB, 218 versus 241 MiB, and at 10 MB, 418 versus 488 MiB. Code Beautify's original 1 MB opening peak was 677 MiB. Its full-run peak rose to 2,210 MiB during search, and two of the three searches hit the browser cap. An opening time alone hid that later failure. [Original data](results/summary.json).

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
| Small document | format | 7/7 kept | kept | results/raw-fidelity/2026-10-17/tool-kumar__run1__2026-10-17T07-55-23-842Z.json |
| Small document | format | 7/7 kept | kept | results/raw-fidelity/2026-10-17/tool-kumar__run2__2026-10-17T08-00-09-899Z.json |
| After edit and packed-tree reply | format | 7/7 kept | kept | results/raw-fidelity/2026-10-17/tool-kumar__run3__2026-10-17T07-53-31-023Z.json |
| After edit and packed-tree reply | tree | 7/7 kept | kept | results/raw-fidelity/2026-10-17/tool-kumar__run3__2026-10-17T07-53-31-023Z.json |
| After edit and packed-tree reply | format | 7/7 kept | kept | results/raw-fidelity/2026-10-17/tool-kumar__run4__2026-10-17T07-55-37-244Z.json |
| After edit and packed-tree reply | tree | 7/7 kept | kept | results/raw-fidelity/2026-10-17/tool-kumar__run4__2026-10-17T07-55-37-244Z.json |

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

The browser is Chromium 145.0.7632.0 headless shell, at 1366 by 900, with GPU disabled. The original ARM64 host had two CPUs and 7,801 MiB RAM. After the October 17 resize, the fresh series uses four CPUs and 15,759 MiB RAM. The 2.5 GiB total-browser cap remains the same. The complete environment is recorded in the download. Each observation starts a fresh profile, disables the browser cache, loads the public page and waits six seconds. Preparation and loading the synthetic clipboard into the page happen before timing. The earlier October 17 series interleaved Tool Kumar with competitors. The current repeat is Tool Kumar only.

Every timed run uses `flock --close` on the shared benchmark lock. Servers start outside that lock. Timed runs run alone. Load must be below 4 before taking it and before starting each run. Batches release the lock within about eight minutes. The browser watchdog samples every 200 ms and stops at 2.5 GiB across the browser tree or below 700 MiB of host available memory. Primary large runs require at least 2,000 MiB available. The 100 MB ladder has the higher 3,500 MB starting rule. Ending load can rise; we keep it in the record.

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

Read the current 50 MB row together with search, scroll, collapse and editing. A file can produce formatted output before its input is editable. A read-only default can still support navigation. The measured brackets describe this fixture and memory cap. Test the same actions on your own synthetic file before relying on them.

### Is JSON Formatter Online faster than Tool Kumar?

It was faster at both 1 MB and 10 MB in the original study. The fresh table gives the dated comparison after Tool Kumar's changes. Keep the input path, run spread and feature outcomes beside each timing. Native number conversion can be fast while changing unsafe integers.

### Does formatting keep large IDs exactly?

The October 15 default-mode fidelity check found that Tool Kumar kept all seven numeric cases. Each of the other five tools changed all seven and lost the first duplicate member. JSONLint warned before Prettify. The separate latest Tool Kumar check above is the evidence for the new worker and tree path. A number-spelling change such as `1.0` to `1` is a note, not a numeric-value failure here.

### Is a cap stop the tool's maximum file size?

No. It is the point where this study stopped the browser. More memory or a different browser could change the result. We report a tested success, a first observed failure and any limit found on the loaded public page separately.

### Can I edit a large document as soon as I see formatted output?

Not always. Tool Kumar now draws output before some input and analysis work. Its default editable threshold is in characters. Other tools can also render a view while input or later actions remain busy. Use the separate input-enabled and character-edit columns.

### Is minified JSON easier to edit?

A smaller file can still cost more to edit. A minified document puts all its text on one line. Wrapping or measuring that line can slow an editor. The prettified partner has more bytes and many short lines, which tests line indexing and virtualization instead. The editing table reports both formats separately. A fast opening does not establish fast typing.

### Does the before-and-after isolate the effect of code changes?

We optimized Tool Kumar after the first study, and the owner later resized the test host. The original measurements and the fresh results use different hardware conditions. The table labels them. Every tool in the fresh comparison uses the same new host. We do not assign the whole historical timing difference to code changes.

### Why is output-update time separate from typing latency?

An editor can respond to a key before it reformats the document. Some tools also need a Format button or Viewer tab. We report the next paint or frame separately from the visible formatted update. The manual workflow and its common harness delay are labeled.

### Did Tool Kumar improve because this benchmark was used to optimize it?

Yes. The original measurements exposed slow paths and a 50 MB search defect. We changed Tool Kumar afterward and repeated the public workflows. We did not modify competitors. That advantage and the before-and-after results are disclosed near the top.

### Do these results establish privacy?

No. Fresh browser profiles and synthetic data reduce exposure in the experiment. No document marker was observed in requests from the tested local workflows in the original study. That is narrower than an audit of every data flow. The [separate privacy study](/blogs/json-formatter-privacy-study) describes its network checks and limits.

## Editorial options

Chosen headline: Large JSON benchmark: opening, typing and number fidelity

Alternative headlines:

- Minified vs. prettified JSON: opening and typing in six tools
- Large JSON files: what six browser tools could open and edit
