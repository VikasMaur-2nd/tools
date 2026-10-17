# Methodology: opening 1 MB, 10 MB and 50 MB JSON in online JSON viewers

<!-- BEGIN accepted 925fc3c status -->
## Current accepted 925fc3c observations

Updated 2026-10-17T09:22:35.791791+00:00. These are results from unchanged before/after deployment evidence. The wider study is incomplete.

| File | Runs | Polled opening | In-page DOM | Two frames | Last-record search |
|---|---|---|---|---|---|
| 1mb | 3 | 0.420 s | 0.276 s | 0.382 s | 3/3 passed |
| 10mb | 3 | 1.720 s | 1.576 s | 1.605 s | 3/3 passed |
| 50mb | 3 | 10.785 s | 10.673 s | 10.753 s | 3/3 passed |

There are 4 accepted fidelity observations. The rendered views kept the seven tested numeric values and both duplicate members in every completed capture. Two worker checks require a real edit followed by a parse request and matching packed-tree reply. This is limited case coverage, not universal losslessness.

The 10mb trusted cut/paste probe passed 3 exact-hash sequences. Edit anyway used: False.
The 1mb trusted cut/paste probe passed 3 exact-hash sequences. Edit anyway used: False.
The 50mb trusted cut/paste probe passed 3 exact-hash sequences. Edit anyway used: True.

Editing counts and failures:

- 100kb-pretty: 3/3 complete matched profiles; measured.
- 100kb: 3/3 complete matched profiles; measured.
- 10mb-pretty: 3/3 complete matched profiles; measured.
- 10mb: 3/3 complete matched profiles; measured.
- 1mb-pretty: 3/3 complete matched profiles; measured.
- 1mb: 3/3 complete matched profiles; measured.
- 50mb-pretty: 0/4 complete matched profiles; Browser cap during editing preparation.
- 50mb: 0/4 complete matched profiles; Browser cap during editing preparation.

| Typing source | Format | Complete profiles | Event Timing median / p95 | rAF median / p95 |
|---|---|---|---|---|
| 100kb | prettified | 3/3 | 32.0 ms / 56.0 ms | 27.3 ms / 45.7 ms |
| 100kb | minified | 3/3 | 88.0 ms / 744.0 ms | 73.1 ms / 727.6 ms |
| 10mb | prettified | 3/3 | 32.0 ms / 56.0 ms | 15.9 ms / 29.4 ms |
| 10mb | minified | 3/3 | 48.0 ms / 88.0 ms | 14.1 ms / 31.5 ms |
| 1mb | prettified | 3/3 | 24.0 ms / 48.0 ms | 11.6 ms / 18.5 ms |
| 1mb | minified | 3/3 | 32.0 ms / 56.0 ms | 11.4 ms / 18.6 ms |
| 50mb | prettified | 0/4 | Fewer than three complete matched profiles / Fewer than three complete matched profiles | Unmeasured / Unmeasured |
| 50mb | minified | 0/4 | Fewer than three complete matched profiles / Fewer than three complete matched profiles | Unmeasured / Unmeasured |

The 100 KB minified source has a slow typing tail. Its Event Timing p95 is 744 ms, versus 56 ms for the prettified partner. These files use the native textarea path; the larger editable sources use the custom editor. This does not isolate the cause. The owner was told. The 50 MB attempts and their single preparation retries hit the fixed browser cap. They do not supply valid combined per-key quantiles.


The same-hardware local code control is complete. These are local production builds, not CDN timings. Each source and size has three accepted rounds.

| Source | Size | Polled median | In-page DOM median |
|---|---|---|---|
| 19b7ac7 | 1mb | 0.866 s | 0.748 s |
| 19b7ac7 | 10mb | 2.031 s | 1.487 s |
| 19b7ac7 | 50mb | 9.127 s | 6.388 s |
| aee1ae3 | 1mb | 2.365 s | 1.742 s |
| aee1ae3 | 10mb | 2.849 s | 2.229 s |
| aee1ae3 | 50mb | 12.421 s | 9.364 s |
| 925fc3c | 1mb | 0.393 s | 0.247 s |
| 925fc3c | 10mb | 1.496 s | 1.394 s |
| 925fc3c | 50mb | 8.649 s | 8.576 s |

Local build IDs, loads, source versions and per-run records are in `results/2026-10-17-local-925fc3c/summary.json`. The original sources keep their first rounds from earlier that day. Shared-host and measurement-time variation remain.


50 MB opening is slower than the earlier single b7157f6 observation of 5.049 s. The three-run current median is 10.785 s. These observations do not isolate code from host pressure. The owner was told. Both values remain in the article. The original 19b7ac7 median was 9.857 s on the earlier two-CPU host.

Safari no-break-space copying and repeat-visit worker startup remain untested. Competitors retain their actual dated observations and counts. The retained competitor comparison has unfinished cells. Repository checks and the draft PR have separate completion records. The size ladder stopped after the 100 MB view appeared and the browser cap stopped the process before search.

Sources: `results/2026-10-17-925fc3c/summary.json`, `editing-summary.json`, `fidelity-summary.json`, `completed.jsonl`, `batches.jsonl` and `verification/`. Every aggregate links raw records.
<!-- END accepted 925fc3c status -->
<!-- BEGIN 925fc3c protocol -->
## Current editing and correctness procedure

The 925fc3c series requests three fresh profiles per source size and format. The source data sizes are 100 KB, 1 MB, 10 MB and 50 MB. Two-space fixtures preserve the exact token stream. Their actual bytes, UTF-16 characters, line counts, matching email carets and hashes are in `results/2026-10-17-925fc3c/editing-fixtures.sha256.json`. Every current browser record checks its selected fixture against that manifest before navigation.

Twenty trusted CDP keydown/up pairs insert characters at requested 100 ms intervals into the first, middle and last email string. A reversible space and one-second wait provide warm-up. Enter, Backspace, a 200-character clipboard paste and Undo are separate actions at each position. A burst needs twenty trusted keys with observed rAF timestamps, plus the inserted marker in the input or confirmed visible output. Combined per-key quantiles require three profiles with all three matched positions. Event Timing uses a 16 ms threshold. Missing fast events are censored. The rAF cross-check is a frame bound, not a compositor paint timestamp. The Long Tasks API records tasks at or above 50 ms.

The output clock starts at the last trusted keydown. A visible marker in the clipped output viewport ends it on the next frame. A separate button clock is retained for manual workflows. An unconfirmed interval stays unconfirmed. Later Tool Kumar profiles search for the changed marker after the observer stops. That diagnostic can confirm eventual content, but cannot recover the original update time.

Ordinary profiles restore source with trusted Ctrl+V from the browser clipboard outside the timing window. The fixture is staged once through a browser-local file read. Large Tool Kumar caret preparation initially used public Tree Find and Enter. Native inputs use selection APIs without value mutation. After two 50 MB cap stops, one retry per source format used visible input rows' source-offset attributes, a trusted click and native passage selection. Both retries also reached the cap during preparation and remain counted. No further profile 1 retry is allowed. Later scheduled 50 MB profiles use trusted Undo to avoid accumulating whole-document replacement snapshots, and check the exact source hash after completion. Their method is recorded separately. They use the same burst, rate, carets, clocks and cap. No attempt silently replaces a failed result.

Tool Kumar 50 MB probes click the public Edit anyway button before typing. The default opening probes leave that notice in place. The cut/paste correctness check separately sends trusted Ctrl+A, Ctrl+X and Ctrl+V without a sleep or DOM read between cut and paste. It copies the restored source and compares its SHA-256 with the original. Three sequences in one fresh profile are reported as sequences, not three independent browser runs. It also checks that the input remains editable. This does not establish latency for sustained typing.

Small fidelity profiles and the 2.1-million-character worker fixture are separate observations. The worker check requires a trusted edit, a later parse request and a matching packed-tree response. Rendered Format and Tree text supply the values graded with exact decimal arithmetic. Worker messages only identify the path. Safari copying, offline repeat visits and failed-worker startup retries are outside this Chromium-only check.

<!-- END 925fc3c protocol -->


## Production refresh for 925fc3c, October 17, 2026

The active Tool Kumar repeat is `results/2026-10-17-925fc3c/`. GitHub Production deployment 7136322793 succeeded at 07:15:32 UTC for `925fc3c6f004552a8cdea9628699de9735682d01`. The served HTML returned build token `0KTjE-idTF_Ru-giVfrP7` and `/_next/static/immutable/chunks/` scripts. See `verification/initial-provenance.json` in that directory. This metadata-only request does not supply a benchmark result.

Accepted current observations are listed above. The remaining jobs wait for load below 4. The runner waits below load 4, then uses `flock --close`, rechecks load before each job, and releases the lock between batches. It starts no server. Every current run will record the measured commit and before/after version evidence.

The study draft, publication package and local blog source now mark the repeat as incomplete. They preserve the original study, October 16 failures, partial October 17 observations on b7157f6, and dated competitor results. No old Tool Kumar result is relabeled as 925fc3c. The old three-run comparator remains historical. Current competitor cells have one accepted attempt each and show that count. The local code-only control is also incomplete.

The current plan includes file opening/readiness at 1/10/50 MB, paste at 1/10 MB, both source formats for editing at 100 KB/1/10/50 MB, search at 50 MB, four fidelity observations, and parser stages. Typing clicks Edit anyway when the public control is present. Three runs per editing cell are requested. Before per-key summaries, every profile must verify twenty trusted keys at each of the matched three positions. Failed preparation is distinct from a typing freeze.

New correctness coverage sends rapid trusted select-all/cut/paste commands and compares the copied restored source with the original SHA-256. It checks that the input stays editable. The worker-fidelity probe requires a parse request and matching packed-tree reply after a real trusted edit. Safari repeat visits and no-break-space clipboard behavior remain untested. Developer reference numbers are not study data.

Refresh command, from this directory:

```bash
./refresh.sh --url https://tools.vikasmaur.com/ --commit 925fc3c --runs 3 --editing-runs 3
```

This creates a new results directory and regenerates its opening, editing and fidelity tables. `--dry-run` checks the plan without loading a page. Earlier dated directories are never overwritten. The active already-created repeat can resume with `node run.mjs https://tools.vikasmaur.com/ 925fc3c6f004552a8cdea9628699de9735682d01` from its own directory after confirming no runner is active. Do not start a duplicate.

The previous notes below describe historical states.

Status: measurement complete on October 15, 2026. The original design preceded measurement. All 55 planned measured jobs finished; changes discovered during the pilot and measurement are listed at the end.

## Question

When a developer opens a large JSON document in a free online JSON viewer or formatter, does the formatted or tree view
appear, how long does it take, does the page stay usable afterwards, how much memory does the browser tab use, and do
search and collapse still work?

## Tools

Starting point: the eleven tools from the earlier privacy study
(https://tools.vikasmaur.com/blogs/json-formatter-privacy-study), plus Tool Kumar, plus two tools that appear for
"large JSON viewer" searches (JSON Crack, Dadroit V Web). Rules:

- No tool that needs an account was included. No sign-in, no paid plan.
- Bot challenges, CAPTCHAs and access-denied pages are never bypassed. The browser uses its default headless user agent
  and no stealth or evasion. A tool that shows a challenge or denies access is recorded as **not tested**, with a screenshot.
- Each tool is tested through the input path a person would use, preferring **Open file** over paste when the tool offers
  it. Files are chosen through the page's own `<input type=file>`, which is what the Open dialog fills in.
- Each tool keeps its default view and settings, except the buttons a person must press to get formatted output.

| Tool | URL | Input path used | Formatted view counted as visible when |
|---|---|---|---|
| Tool Kumar | https://tools.vikasmaur.com/ | Open file | Format view shows `"export": "customers"` (pretty-printed) |
| Code Beautify JSON Viewer | https://codebeautify.org/jsonviewer | File button (Auto Update on, the default) | Tree on the right shows the top-level keys |
| JSON Beautifier | https://jsonbeautifier.org/ | Open (left editor), then "Beautify >>" | Right editor shows pretty-printed text |
| JSON Viewer Stack | https://jsonviewer.stack.hu/ | Paste into Text tab (no file control), then Viewer tab | Tree shows the top-level keys |
| JSON Formatter Online (jsonformatter.com) | https://jsonformatter.com/ | Paste (no file control), then Format | Editor shows pretty-printed indented key lines in its rendered viewport |
| JSONLint, validator | https://jsonlint.com/ | Click editor to load it, paste (no file control on the validator page), Validate, then Prettify | Editor shows pretty-printed lines |
| JSON Compare | https://jsoncompare.org/ | Not measured | Excluded because it is a diff tool, outside the viewer/formatter comparison |
| JSON Hero | https://jsonhero.io/ | Drop zone file picker (uploads to jsonhero.io) | The created viewer page shows the top-level keys |
| JSONFormatter | https://jsonformatter.org/ | Not attempted | not tested: Cloudflare "Just a moment" challenge |
| JSON Editor Online | https://jsoneditoronline.org/ | Not attempted | not tested: Cloudflare "Just a moment" challenge |
| Curious Concept JSON Formatter | https://jsonformatter.curiousconcept.com/ | Not attempted | not tested: Cloudflare "Attention Required" block |
| FreeFormatter | https://www.freeformatter.com/json-formatter.html | Not attempted | not tested: browser got a connection error; plain HTTP requests got 403 Forbidden |
| Dadroit V Web | https://dadroit.com/vweb | Not attempted | not tested: Cloudflare "Just a moment" challenge |
| JSON Crack | https://jsoncrack.com/editor | Not attempted | not measured: its graph view did not render in headless Chromium, even for its built-in sample, so "view visible" could not be measured fairly |

## Server-side tools and being a good citizen

- Every run records all network requests made after the document is supplied. The document contains a unique marker
  (`TKLB-7F3A-MARKER`). A tool is treated as **server-side** if any request after input carries the marker, or a request
  body of at least half the document size.
- JSON Hero sent the marker to `jsonhero.io` in a 3.8 KB adapter check (consistent with the privacy study). It is tested
  **once, at 1 MB only**. No 10 MB or 50 MB document is sent to any server.
- If a tool assumed to be local is seen uploading the document at 1 MB, it is not tested at larger sizes.
- Page loads per site are counted in `page-loads.jsonl` (exploration, adapter development, pilot and measured runs).
  There is no load testing: one browser, one page and one document at a time, with sequential visits and gaps between batches.

## Test files

`generate-fixtures.mjs` writes deterministic, minified, UTF-8 JSON shaped like an API export:
`{"meta": {...}, "data": [records...], "next_cursor": null}`. Each record has an integer id, a UUID, a 16-digit
`account_number` above 2^53 written as a bare JSON number (it loses precision in `JSON.parse`), names and cities in
several scripts (Latin with diacritics, Cyrillic, CJK, Arabic, Turkish), emoji, ISO dates, booleans, nulls, floats, tags
arrays, a nested address with geo coordinates, and 0 to 3 orders with nested line items and notes containing escaped
quotes, newlines, tabs and backslashes. Maximum nesting depth is 7. The last record carries `"search_probe":
"TKLB-NEEDLE-LAST"` for the search check. Smaller files are prefixes of the same record stream.

| File | Bytes | Records | SHA-256 |
|---|---|---|---|
| bench-1mb.json | 999,554 | 1,204 | eb614d34851b87cc1fe0eee6e8610b32ed63d750db51891469f1ecd34fce63ed |
| bench-10mb.json | 9,999,719 | 12,025 | 1fc37b1b236e28c4c3aa850ffd9100f2fc08f58f9c7a7d1e7006d034ee73a76d |
| bench-50mb.json | 49,998,859 | 60,051 | c3e4ee5212c3500aaaf24c8a518c446ca4004ab6a3ed98b0b5037bdbec4ceb23 |

(`bench-tiny.json`, 3,854 bytes, was used only to develop the adapters.) Re-running the generator reproduces the same
hashes (checked twice).

## Metrics

All times come from the harness clock (Node `performance.now()`), which keeps running while the page is frozen.

1. **Time to formatted view**: from supplying the file (or dispatching the paste) until the "visible when" condition in
   the table is true *and* two animation frames have rendered. It includes any button presses the tool requires, made as
   soon as the tool is ready for them. The harness polls the page every 100 ms. A poll cannot run while the page's main
   thread is busy, so a frozen page cannot be counted as done.
2. **Outcome** (most important): `ok`; `no formatted view within 90 s` (page responsive but no output, or an error);
   `unresponsive at 90 s` (main thread did not answer within 3 s at the deadline); `crashed` (renderer crash);
   `exceeded the memory cap` (killed by the watchdog).
3. **Longest main-thread freeze during loading**: the longest single [long task](https://developer.mozilla.org/docs/Web/API/PerformanceLongTaskTiming)
   between input and view visible, plus total blocking time (sum of each long task's time over 50 ms).
4. **Responsiveness after load**: 1 s after the view appears, three mouse-wheel scrolls over the output and three PageDown
   key presses (after clicking into the output). Each value is the time from dispatching the trusted input event to the
   next rendered frame. Long tasks after load are recorded too.
5. **Peak memory**: sampled every 200 ms from `/proc` as resident plus swapped memory (VmRSS + VmSwap), for the largest
   renderer process (the tab) and for the whole browser process tree. Swap is included because this host swaps heavily.
   RSS includes shared libraries, so absolute numbers are somewhat higher than Chrome's Task Manager would show.
6. **Features at size** (same page load, after the responsiveness probes), each with a 30 s limit:
   - *Search*: use the tool's own search (Ctrl+F in code editors, the search box in tree views) for `TKLB-NEEDLE-LAST`,
     which only occurs in the last record. Done when the match is rendered in the output, i.e. the view scrolled or
     expanded to it.
   - *Collapse*: the tool's own collapse-all/fold-all control (or collapsing the root node in a tree). Done when record
     fields are no longer rendered.
   - "not available" means the tool has no such control in the view under test (for example a plain text area).

## Memory cap and timeouts

- **Timeout**: 90 s from input to formatted view.
- **Memory cap**: the watchdog kills the browser if the whole browser process tree exceeds **2.5 GiB** (RSS + swap), or
  if the host's MemAvailable drops below **700 MiB**. Either is recorded as "exceeded the memory cap" with the reason.
  Runs at 10 MB and 50 MB start only when the host has at least 2,000 MiB available (1,200 MiB for 1 MB). The result file records which limit fired. The host floor can stop a run before the browser cap on this shared host.
- A 2.5 GiB cap is well below what a desktop browser may use, so "exceeded the memory cap" means "needed more than
  2.5 GiB here", not "crashes on every computer".

## Procedure

1. Fresh browser profile per run (deleted afterwards), cache disabled, viewport 1366 x 900.
2. Load the tool, wait for the load event, then 6 s for lazy editors and scripts.
3. Check for a challenge or access-denied page (if so: screenshot, stop, "not tested").
4. Untimed preparation: tool-specific clicks such as loading an editor. For paste tools, the file is read from disk into
   the page beforehand (standing in for clipboard contents), so the paste itself is what is timed. The paste is a
   trusted-looking `paste` event with `clipboardData` for code editors, and `execCommand('insertText')` for plain text areas
   (the closest equivalent to a real paste into a text area).
5. Timed section: supply the file or paste, press the required buttons as soon as they are usable, poll until the view
   is visible or 90 s pass.
6. Screenshot, responsiveness probes, feature checks, long-task and memory collection, network summary.
7. Pilot: 1 MB on three tools (Tool Kumar, Code Beautify, JSON Formatter Online); results not used.
8. Measured runs: 3 runs per tool and size, each in a fresh profile. Tool order alternates between runs so that slow
   periods on the shared host do not always hit the same tool.

## Environment

- Host: shared AWS ARM64 machine, 2 vCPUs, 7.8 GB RAM, about 4.6 GB swap that is mostly in use by other sessions.
- Browser: Chromium 145.0.7632.0 (Playwright headless shell build 1208), `--headless --no-sandbox --disable-gpu
  --disable-dev-shm-usage`, default user agent.
- Harness: Node 24, no dependencies, Chrome DevTools Protocol over the built-in WebSocket.
- Contention controls: measurement runs hold `/home/ubuntu/seo-ops/heavy.lock` (`flock`), in batches of at most about
  10 minutes; a batch starts only when the 1-minute load average is below 4. Each result records load average at start and end, plus MemAvailable at start and throughout the sampled memory timeline.
- Network: the tools are loaded over the public internet from one location (IP geolocation not asserted).

## Analysis rules

- Report the median of 3 runs with min to max range. Outcomes are reported as counts (for example "3 of 3 ok").
- Differences smaller than the spread of the runs, or smaller than about 25 percent at under 2 s, are reported as ties.
- Conclusions focus on large, robust differences: works vs freezes vs crashes, seconds vs tens of seconds, memory
  hundreds of MiB apart. Absolute times are from a slow, contended 2-core machine and will be faster on a typical laptop.

## Limitations (known before running)

- One browser engine (Chromium), headless, one machine, one network location, one date. Tools change often.
- Headless Chromium with GPU disabled; tools that need WebGL or a GPU (JSON Crack's graph) cannot be measured.
- Bot protection kept several well-known tools out of the test, including JSON Editor Online and JSONFormatter.
- Different tools do different work: a tree viewer, a code editor and a plain text area are not equivalent, and the
  "visible" condition is tool-specific. The table above documents each one.
- Paste tools are tested with a synthetic paste (the page receives a real `paste` event, but the operating-system
  clipboard is not involved).
- Server-side tools are tested at 1 MB once only, by design.
- The memory cap (2.5 GiB) is lower than many desktops allow; a tool that hit it might finish on a bigger machine.
- Tool Kumar is made by the same person who ran this study.

## Coordinator decisions before the pilot

The coordinator authorized a 1-minute load gate below 4. Every batch records `uptime`, rechecks after taking the shared lock, and each run records its starting and ending load. Runs also wait if their starting load is 4 or higher. JSON Compare is excluded because it is a diff tool. JSONLint stays in the study and is labeled as a validator. JSON Hero receives one 1 MB measured document only. No challenge is bypassed. The measured plan contains 55 page loads across seven sites.

## Changes after the pilot

Before the pilot, batch.sh was changed to gate below load 4 both before and after locking. The runner rechecks the gate before each run and reserves 300 s before starting another run. An outer timeout ends the batch within 590 s, including browser cleanup. Browser teardown also kills direct child processes. The runner stops if a supposedly local tool sends the document marker. Pilot observations follow below.

The first pilot showed that Code Beautify could open the 1 MB tree but freeze during search. It also exposed a timeout issue: the old feature budget applied only after opening and typing, which let a nominal 30 s check consume much longer. Feature operations now share one 30 s wall-clock deadline. If a feature leaves the page unresponsive, subsequent feature checks are labeled not tested after the freeze rather than issuing more commands. The original pilot record is retained and excluded from measured results. No extra Code Beautify pilot page load is planned.

Measured records also save the memory peak up to the end of the opening phase in `memoryToView`, separately from the peak over opening, responsiveness and feature checks. The summary's main memory column includes feature checks. This matters when a tree opens normally but search allocates much more memory. A feature deadline failure on a responsive page is reported as no result within 30 s; missing selectors remain harness errors.

The JSON Formatter Online pilot exposed a second adapter issue. A large paste scrolls to the end of CodeMirror's virtualized document, so the first header is no longer in the DOM. The old readiness check never clicked Format. That pilot is marked invalid, not a product failure. Readiness now checks the enabled Format button and nonempty rendered content, and completion checks rendered pretty-printed indented key lines. A second 1 MB pilot on that site verifies the fix. No measured result uses the invalid adapter.

The corrected JSON Formatter Online pilot opened the 1 MB document and passed the search check. Its fold-all attempt did not meet the complete-collapse predicate within 30 s. The valid pilots showed no document marker or document-sized request body leaving any of the three sites. Code Beautify's unrelated small POSTs were retained as network evidence and were not classified as document uploads. The three valid pilot screenshots were inspected. Measured runs begin only after these fixes.

The first measured JSON Viewer Stack run displayed an ordinary full-page ad over its tree. A probe click hit that ad and navigated to its advertiser. The raw record keeps the URL and screenshot; its scroll, key and feature values are marked invalid and removed from analysis. Its outcome is view detected, interaction obstructed, not a confirmed usable view. A hit-test guard now prevents clicking covered input and feature controls. Output covered at the interaction point is recorded as obstructed and receives no interaction probes. This does not dismiss or bypass a bot challenge. No extra page load was used to fix this guard.

Late in the study, failed but responsive feature checks gained small diagnostic captures of the search query/count and scroll dimensions. The remaining runs also record console errors, up to 20 short messages. These are post-failure diagnostics and do not change the timed action or completion criteria. One extra HTML source-inspection request to jsonformatter.com, plus its JavaScript asset, checked whether Format uses an asynchronous or delayed state update. The published handler reads the CodeMirror document synchronously, calls JSON.parse and JSON.stringify, then updates the document; caught errors are logged to the console. This request is in the visit ledger separately from browser measurements.

The second Tool Kumar 50 MB run found the search marker but could not render it. The captured find count was 1 of 1, while the requested sizer height was about 78.6 million pixels and the actual scroll height was capped at 33,554,432 pixels. This explains a failed rendered-match predicate on a responsive page. It is retained as a Tool Kumar limitation, not a harness timeout error. See tool-kumar-scroll-limit.md.

## Final measurement audit

All 55 planned measured records are present, unique and match the fixture hashes. Starting and ending 1-minute load ranged from 0.47 to 3.52, always below 4. No measured batch held the lock for more than 303 s; the outer timeout remains below ten minutes. Fourteen stops hit the total-browser cap, including two after Code Beautify had opened 1 MB successfully. None hit the host memory floor. Only JSON Hero sent the document marker or a document-sized request body. See results/audit.json.

The third JSON Formatter Online 50 MB run captured TypeErrors in the editor's measurement and update code, including its Format update path. All three 50 MB runs stayed responsive but retained minified input through the 90 s deadline. These are recorded as no formatted view, not a natural crash or a memory-cap stop.

The ledger contains 112 browser test visits across this study and its earlier development, plus one source-inspection HTML request. The source inspection also fetched a JavaScript asset. One accidental advertiser landing is documented separately and its interaction measurements are excluded. Full per-site counts are in results/page-load-summary.md.

## Version 2, October 15, 2026: rendered-output fidelity

The original large-file measurements and the three-run production scroll re-verification are preserved. `draft-v1.md` retains the complete previous article. Version 2 adds a separate fidelity study, not an output audit of every field in the 1 MB to 50 MB documents.

`fidelity.json` is a synthetic literal document under 5 KB. `fidelity.sha256.json` records its UTF-8 byte length and SHA-256. It has seven numeric-value cases: four unsafe integers, including a negative value and a 19-digit ID; two long decimals; and `1e400`. A separate nested object has two `a` members with values 1 and 2. Six representation notes cover `1.0`, `1.50`, `1e2`, `1E+2`, `-0` and `"é"`. Numeric values and duplicate-member preservation are graded separately. Spelling normalization is not a failure. Negative zero is treated as the same mathematical value here, while retaining a note about its sign.

`fidelity.mjs` reuses `sites.mjs`, the original dependency-free CDP client, injected page helpers and memory watchdog. The original `bench.mjs`, `sites.mjs` and `lib/` files are unchanged. File-input tools receive the fixture through their original file selectors. Paste tools receive the literal text through the original clipboard or insertText adapter. The same Format, Beautify, Viewer or Validate plus Prettify controls are used. Tree viewers are expanded through their own controls. Defaults are retained. In particular, Code Beautify's Big Num checkbox is unchecked; its optional mode is not tested.

Each of the six tools has two independent fresh-profile observations. The second round reverses tool order. JSON Hero is excluded and receives no new upload. Each navigation is appended to `page-loads.jsonl` with purpose exactly `fidelity`, including an unsuccessful harness attempt. No challenge or advertisement is clicked. Clicks are hit-tested; an obstruction stops the action. Profiles are created only in TMPDIR and deleted on close.

Output is read from the rendered DOM using `innerText` and displayed code lines or tree rows. No parsed object, editor document model, clipboard copy, download or source-editor text is used as output evidence. Captures include raw text, PNG screenshots, row positions and diagnostic DOM. The harness captures the initial output and the bottom of an actual scroll container when applicable. Only unobstructed captures count. Each run's raw record is under `results/raw-fidelity/2026-10-15/`. The derived `results/fidelity-summary.json` gives each case's source token, displayed token and verdict, and hashes every source record.

`analyze-fidelity.py` compares numeric tokens with Python's arbitrary-precision Decimal. It never uses floating-point parsing as the reference. Duplicate-member counts and order are checked separately. The two words `null` and `Infinity` do not preserve the source numeric value of `1e400`. Tree labels without JSON quote marks are presentation notes. The string's actual Unicode character is checked.

Two capture adaptations are documented in `results/raw-fidelity/2026-10-15/RETRIES.md`. Code Beautify run 1's initial screenshot shows every case; a later erroneous scroll moved the entire page away. Its derived verdict uses that first complete unobstructed capture, and the original record is unchanged. The harness now stops its ancestor search before the page body.

JSONLint's multiline input validated and showed precision and duplicate-key warnings, but the adapter could not find Prettify. Those two attempts do not count as formatted-output observations. Each received one documented retry with `fidelity-minified.json`, which only removes LF whitespace from the literal fixture. No number token, string value, member order or duplicate member changes. Its separate hash is in `fidelity-minified.sha256.json`. Both retries produced formatted output and are the two final JSONLint observations. The two initial attempts remain excluded as harness errors. No further retry was made.

Every browser job and Node timing job runs through `v2-batch.sh`, inside `flock /home/ubuntu/seo-ops/heavy.lock`, with `TMPDIR=/home/ubuntu/.cache/perf-tmp`. The 1-minute load must be below 4 before attempting the lock, after acquiring it, and before each browser run or timing worker. A refusal at the load gate starts no browser. A hard outer timeout ends a batch below ten minutes. Loads at the start and end of each observation are retained; an ending load above 4 does not retroactively invalidate a run that began below the gate. New batch logs are under `logs/`.

Tool Kumar's remote production main reference is read with `git ls-remote origin main` for the run records. This establishes the remote-main reference at observation time, not an independent mapping from a deployed bundle to a commit. Parser copies and the reference engine file come from the read-only `origin/main` git objects at the full commit recorded in `vendor/`. No checkout, branch, worktree or application file is written.

## Version 2: parser and formatter costs

`parse-cost.mjs` compares native `JSON.parse` and `JSON.stringify(v, null, 2)` with Tool Kumar's `parse` and production `formatDoc(src, result, '  ')`. The copied `parser.ts` and `format.ts` are under a directory named for the full source commit. The only TypeScript code adaptation is changing `format.ts`'s import to `./parser.ts` for Node 24. Original bytes, source hashes and the adaptation are retained in that directory. `package.json` only declares ES module mode. The engine reference documents `afterDoc`'s 60 ms or 250 ms scheduled-format delay; that delay is not part of this microbenchmark.

Each fixture and implementation runs in a separate fresh Node process. The original 1 MB and 10 MB files are read before timing and their SHA-256 hashes recorded. There is one first-call cold sample after module import, followed by five warm samples. Explicit garbage collection is outside each timed region. Each sample times parsing, then formatting the parsed result, then records their paired total. The full output length is consumed as a check. `formatDoc` can use a native fast path only when the parser's `exact` flag permits it; these unsafe-integer fixtures use the lossless path, with `exact: false` recorded.

Best-of-five and median-of-five are computed independently for parsing, formatting and the paired total. The independently best stages are not added to manufacture a best total. The first call is not a machine-boot or cold disk-cache test. Module loading, input reads and GC calls are excluded. The script checkpoints completed workers so that a high-load stop can release the lock and resume without rerunning completed work. An earlier aborted attempt at the load gate has no complete result and is not used.

These Node timings explain a measurable parser/formatter cost, but they do not partition the earlier browser timing. The runtimes, dates within the day and Tool Kumar code snapshots differ. Browser rendering and remaining application work were not profiled. The speed article retains JSON Formatter Online's wins and does not assign the unexplained remainder to a particular subsystem.

The same script independently counts unsafe `account_number` literals changed by native parsing in the original 1 MB fixture, using BigInt comparison to the source decimal tokens. This script count is distinct from observing a competitor's fully rendered large output.

## Version 2 interpretation correction

The original JSON Viewer Stack 50 MB records have status `unresponsive at 90 s`, but their elapsed-at-stop values are 35,437, 36,521 and 35,835 ms. Each records `Runtime.evaluate: timeout 3000ms` as the last polling error. The article and publication outcome grid therefore report unresponsiveness during opening, checked after 35.4 to 36.5 s, rather than claiming a confirmed 90-second wait. Original raw records and aggregates remain unchanged. This correction neither establishes later recovery nor proves a browser crash.


## October 16, 2026 refresh

The owner requested a production repeat after Tool Kumar's speed changes and fresh competitor observations on the same day. The isolated runner and all new raw data are under `results/2026-10-16-refresh/`. The original `results/raw/`, aggregates and earlier dated directories are protected by SHA-256 in the new directory's `before.sha256.json`. `draft-v2.md` preserves the previous draft.

The refresh copies the baseline `aee1ae3` runner, with its exact in-page DOM and two-frame observation. It retains Chromium 145.0.7632.0, a 1366 by 900 viewport, GPU off, fresh profiles, disabled cache, the six-second page settle, one-second pre-input wait, original fixtures and SHA-256, input delivery, done predicates, polling interval and feature deadlines. Three primary runs per tool and size are interleaved with Tool Kumar. Tool Kumar also gets three paste observations at 1 MB and 10 MB. JSON Hero receives no new visit or upload.

The added observer uses the same completion predicate for each competitor and waits for that workflow's final manual trigger. This prevents already-prettified input from counting as a completed manual-format action before the click. Tool Kumar has no manual trigger in this path, so its baseline predicate is unchanged. It separately observes an enabled input. Native textareas that expose the full source must contain text. Virtual editor passages can contain only part of the document. Enabled-input time is not treated as proof of a successful edit. After historical scrolling, search and collapse, the runner tests a public Tree view where relevant, inserts one space through the input, and attempts Undo. The required editing extension below supersedes the initial optional scope and measures typing separately from manual or automatic output updates.

An extra scroll-to-end probe runs after the original wheel and PageDown checks and before search. It records rendered final text and scroll dimensions. A visible final root member in a collapsed tree does not prove every record is navigable. Last-record search remains the separate stronger test. Added probes extend full-run memory observation. `memoryToView` preserves the opening-only measurement for comparison. A frozen or killed renderer no longer prevents the runner from saving its outcome when it cannot return a precise snapshot. These are harness changes, not changes to the sites.

Every batch uses `flock /home/ubuntu/seo-ops/heavy.lock`, with load below 4 before acquiring it, after acquiring it, and before each run. TMPDIR is `/home/ubuntu/.cache/perf-tmp`. It stops starting work after about 210 seconds and reserves room for a full run and final verification within its 470-second outer limit. The lock is released between batches. Each record names its batch and production commit. Browser profiles are deleted on normal cleanup. No build runs during a benchmark batch.

Before and after each batch, `verify.mjs` records `git ls-remote origin main`, GitHub's Production deployment and success status, page HTML hash, the page's build token, response headers and scripts. These read-only HTTP page loads are counted. GitHub's deployment links the page to a commit; remote main alone is not represented as proof of the deployed bundle. A batch whose commit or build evidence changes is invalid and its jobs are repeated. Invalid attempts remain on disk and in the page-load ledger. Ending provenance checks may run when load has risen because they do no performance work and must detect a deployment during the batch.

The 5 MB and 25 MB files use the original generator's seed and record stream, with independent byte counts and hashes. Exploratory ladder observations use one run. A tool stops climbing at its first observed failure. Primary 1, 10 and 50 MB repeats remain the preplanned comparison, even when a lower size fails. Only tools that pass 50 MB can try 100 MB and larger. Both fixture preparation and each large observation check `free -m` for at least 3,500 available. The 2.5 GiB browser cap still applies. A skipped larger size is not a failure. A largest tested success is not an exact maximum.

Latest fidelity observations repeat the small literal fixture twice. Two additional fresh profiles use a derivative with a 2,100,000-character string. The numeric literals, spelling cases and duplicate members are unchanged. A real input edit triggers the worker; message metadata confirms a packed tree reply. Format and Tree are then captured and graded separately using Python Decimal and duplicate-member occurrences. Internal message data are not the graded output. The extra fixture has a separate SHA-256 in each record. Competitor fidelity remains dated October 15 and is labeled separately.

Pinned current `lib/json/parser.ts`, `format.ts` and `pack.ts` copies are in `vendor/tool-kumar-<commit>/`, with originals and provenance. The parser-stage repeat adds source re-indenting beside the previous native and lossless parse-plus-format paths. It does not imply that source re-indenting performs validation or builds a tree. Every timing worker runs under the same gate and lock.

`./refresh.sh --url https://tools.vikasmaur.com/ --commit <sha> --runs 5` makes a new dated directory, repeats only Tool Kumar's primary file and paste batches and fidelity checks, and regenerates `summary.json` and `tables.md`. For another URL, the supplied commit is a caller-provided source label, not independent deployment attestation. This script never builds, edits a checkout, deploys, or replaces historical data.

### Required editing extension, October 16 owner addition

Editing is now a required part of the study. It has three fresh-profile runs per tool, source format and data size. The common sizes are 100 KB, 1 MB and 10 MB of minified source. The prettified partner contains the same data, with two-space indentation, and can have many more bytes. Exact bytes, characters, line counts, hashes and caret positions are recorded in `editing-fixtures.sha256.json`. The generator re-indents source literals directly. It does not round-trip the fixtures through native JSON numbers. Tool Kumar 50 MB attempts explicitly click Edit anyway where present. Other 50 MB typing attempts are allowed only for tools that produce a usable editable view.

The same email values in the first, middle and last record identify matched caret positions in both formats. Positioning is outside timing. Native textarea selection, Ace's public caret API, CodeMirror and Monaco's public Go to line dialog, and Tool Kumar's public Tree find and double-click action move the caret. These actions do not mutate the source. Every measured mutation uses trusted CDP keydown/up pairs or Input.insertText. The source is restored with trusted input between positions. Those whole-document replacements can add undo history. Full-run memory and later preparation failures include that work; a restoration failure is not reported as proof that a successfully opened file cannot accept a single edit. Single-editor tools that prettified the source while opening also restore the selected source format before typing. Each run gets one reversible space as warm-up, followed by a one-second wait.

A burst has twenty characters, requested at 100 ms intervals. CDP commands are queued at that rate rather than waiting for a slow key's acknowledgment. Actual dispatch and event timestamps are saved. A capture listener records each trusted keydown and input, then timestamps the next requestAnimationFrame. This is a next-frame bound, not a direct compositor paint timestamp. Event Timing is observed with `durationThreshold: 16` and `buffered: true`. Its duration is the browser's rounded event-to-presentation observation. Events absent below that threshold are censored, not assigned zero milliseconds. The tables report all-key rAF median and p95 alongside the separate thresholded Event Timing observations and coverage. A normal latency sample requires twenty trusted keydown events, their observed next frames and successful CDP acknowledgments. Native input events are editor-dependent; CodeMirror can handle beforeinput without emitting input. Their absence is recorded separately and does not invalidate trusted-key timing. Source DOM and visible output markers provide separate edit evidence. Unexpected key counts or missing frames remain unverified.

Enter, Backspace, a 200-character snippet and Undo have separate action windows. Enter inside a string can temporarily invalidate JSON. That intermediate invalid state is not graded as an output-update time. Source restoration before the next position prevents changes in line count from moving later tests. A MutationObserver captures when a final burst marker appears in the visible output and the following frame. Live output and a manually clicked Beautify or Viewer tab are labeled separately. Manual workflows also record the click-to-output interval. An unobservable or offscreen output stays unconfirmed. Editor models and hidden parsed values do not count as output evidence.

Scrolling uses twenty equally spaced steps over the input's exposed native scroll range, 50 ms apart, with rAF frame intervals. Horizontal range is used for an unwrapped one-line Ace input. A custom editor with no exposed native range is reported unmeasurable rather than assigned an estimated smoothness value. The method is a repeatable full-range rendering probe, not a claim about every human wheel gesture. rAF intervals and long tasks during typing are separate from scrolling intervals. Peak memory covers the whole editing run. The optional minify/prettify toggle timing is omitted unless it can be measured without altering the required inputs or adding an unfair workflow.

Three opening observations from the prettified editing runs use the same initial public input workflow and output predicate. JSONLint's prettified source needs Validate but can already have a formatted view without offering Prettify; that already-formatted condition is recorded separately. No historical typing results are available from the original study. The dev thread's typing numbers do not supply a before-and-after cell.

The final-marker output observer scans only after the twentieth key, because the complete marker cannot exist earlier. Its cumulative callback execution cost is recorded. Earlier adapter observations retain their measured callback cost and harness hashes. No recorded latency has instrumentation time subtracted. Smaller differences near the observer cost or the run spread are not claimed as tool wins.

Source preparation now uses a trusted clipboard paste. Whole-document `Input.insertText` can exercise a large composition insertion rather than a tool's normal paste handler. The first prettified 100 KB Tool Kumar attempt and the already-retried JSONLint minified attempt timed out before a typing burst during that preparation. They remain separate source-preparation outcomes, not inferred per-key latencies. The permitted Tool Kumar case retry follows normal Ctrl+V handling. JSONLint's already-retried case is not retried again. Clipboard permission is granted only in the fresh measurement browser. If clipboard source preparation is unavailable, the case remains unmeasurable. The small 200-character snippet also uses trusted Ctrl+V where available; earlier `Input.insertText` snippets and any fallback are labeled separately.

Independent Enter, Backspace and snippet actions begin from the same original source and caret in the final protocol. The runner restores source between them. This avoids an editor’s Enter indentation changing what Backspace deletes. Earlier first-round action windows that ran Backspace immediately after Enter are retained and labeled in their harness revision; their input-to-frame values do not establish a matched deletion operation. Typing-burst timing is unaffected by that later action order.

Output-update summaries use the final trusted keydown timestamp for every editor, rather than the native input callback. CodeMirror does not emit a native input event for every handled key. This analysis correction uses the saved timestamps and does not repeat a page load. The endpoint is the frame after the final marker becomes visibly rendered. Manual tools wait for the common 150 ms post-burst pause and source check before their public action. Their key-to-output interval includes that harness delay. Button-to-output time is recorded separately.

## Resized host, October 17, 2026

The owner resized EC2 after all benchmark processes were stopped. The host now exposes four Neoverse-N1 CPUs and 15,759 MiB RAM, compared with two CPUs and 7,801 MiB before. The new series is `results/2026-10-17-resized/`. It starts every primary opening, editing, fidelity and parser-stage cell again. No pre-resize timing is pooled with it. `environment.json` and each new raw performance record identify the hardware condition. The CPU affinity is unrestricted on all four CPUs.

Chromium, flags, viewport, settle time, fixtures, hashes, default settings, done predicates, the load-below-4 gate and the 2,560 MiB total-browser cap stay the same. All tools in the fresh comparison use the new host. Historical before-and-after rows label both hardware conditions. Their differences include hardware and host pressure, so the article does not attribute the entire difference to code changes. The earlier partial refresh and its unfavorable Tool Kumar typing result remain available as separate evidence.

### Same-hardware local code control

The owner requested a separate comparison of `19b7ac7`, `aee1ae3` and the latest measured production source on the resized host. This series is `results/2026-10-17-local-code/`. Each commit gets a detached scratch worktree under `/home/ubuntu/.cache/perf-tmp/tklb-local-code-2026-10-17/`, made with `git worktree add` from the article checkout. No source file is changed. We run `pnpm install --frozen-lockfile`, `pnpm build` and `pnpm start`. Builds and measurements hold heavy.lock and start below load 4. Each lock phase is bounded at 470 seconds. Disk space is recorded before every build.

The three local production builds use ports 3381, 3382 and 3383, with only one server active inside a measurement phase. There are three rounds of 1 MB, 10 MB and 50 MB file-path observations per source. Round 2 reverses the source order. Browser, viewport, flags, fixture hashes, settle time, completion predicates, precision observer and browser cap match the fresh public series. These are local production timings, not CDN timings. They remove the hardware and CDN difference from the code comparison, with shared-host variation retained in the ranges.

Each phase records remote main and Production deployment metadata before and after it, verifies the scratch HEAD and clean source status, and matches the served build token to `.next/BUILD_ID`. A changed phase is invalidated. The protected Vercel deployments are not opened or bypassed. Build logs, lockfile and guide hashes, source commits, run records and cleanup records remain after each scratch worktree is removed following its final round. Local outcomes are grouped by source commit, never pooled into the public production medians.

The prettified partner of the 10 MB fixture exceeds Tool Kumar's 16-million-character default editable threshold. Its editing attempt also uses the public Edit anyway control and is labeled, just like the 50 MB attempts. The size label refers to the minified data. Every format has separate actual bytes, characters and line counts.

An early resized-host 1 MB editing attempt reached formatted output while the input still showed its placeholder. The preparation click arrived before source presentation. No typing burst was sent. Its minified and prettified cases each use their one documented retry, waiting for the public input fixture marker before activation. Future primary readiness probes record the source wait separately. The opening done predicate and the per-key clock do not move. Earlier successful primary activation observations remain valid. This is a preparation correction, with the readiness gap preserved in the study and findings file.
