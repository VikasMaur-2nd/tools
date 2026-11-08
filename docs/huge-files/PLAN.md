# Huge-file mode: JSON bigger than memory

Branch `feat/huge-files` (integration branch, owned by the lead). Sub-branches `huge/<topic>` are cut from it and
merged back by the lead. Reports and scratch: `~/.cache/huge-work/` (never in the repo).

## Goal

Open, validate, browse, search, edit and save JSON / JSONL files of any size (10 GB, 50 GB: bigger than the
device's memory), 100% client-side, in Chromium, Firefox and WebKit. Best in class against every competitor
(online viewers and desktop tools) on size, speed, memory, features and UX. Today files over
`MAX_DOCUMENT` (300 MiB, `lib/link.ts`) are refused in `Engine.loadFile` (`lib/engine/engine.ts`).

## Non-negotiable: no regressions

- Documents up to the huge threshold behave **exactly** as on `main`: same code path, same speed, same memory.
- `lib/json/tape.wasm` stays byte-identical unless a change is proven neutral or better by an interleaved,
  order-rotated A/B in real browsers. Huge-mode Wasm goes in a **separate module** (e.g. a cargo feature or a
  second crate target: `huge.wasm`), loaded only in huge mode.
- First-load JS/CSS of every page: no growth (harness `budgets.json`). All huge-mode code is a dynamic import
  reached only when a huge file is opened (or a tiny threshold check inline in `loadFile`).
- `pnpm test`, `pnpm lint`, `pnpm typecheck` pass; existing harness checks pass.
- Every claimed improvement is measured (numbers + method in the report), never asserted.

## Architecture (agreed)

- `lib/huge/` lazily loaded chunk.
- **HugeSource**: the `File` + a piece table of edits (UTF-8 bytes). Implements `ByteSource`
  (`lib/json/tape-wasm.ts`). Positions in huge mode are **byte offsets** (JS numbers, beyond 2^31).
- **Indexer worker**: streams the source through Wasm in a *skeleton* mode (no nodes written: stack, counts,
  depth) and saves a **checkpoint** about every 1 MB at a token boundary: byte offset, line, pretty-line, node
  ordinal, open stack (per frame: kind, start byte, key, child count so far). ~10k checkpoints for 10 GB.
  Checkpoints are the index: "child N of container C" = binary search for a checkpoint with C on its stack and
  child count ≤ N, then parse ≤ ~1 MB forward; same for path-at-offset, line → offset, pretty line → offset.
  Big containers (≥ many children or ≥ 1 MB) are recorded with start/end/count so the tree shows counts.
- **Window parse**: from a checkpoint, parse a bounded region in full tape mode → local `Tape` + local text →
  `lazy.ts` `Filler` JNodes with a base offset. LRU window cache under a fixed budget.
- **Exact errors**: Wasm reports the failing byte; the JS tape parser re-parses from the previous checkpoint with
  that checkpoint's stack to produce the same message/line/column as the normal path.
- **JSONL / NDJSON** (many top-level values) supported natively (virtual root list). Loose JSON (comments,
  trailing commas): reported as errors with a streamed Repair later.
- **Long values**: a string longer than the window must not grow the window without bound: skeleton mode skips
  strings across windows; views show a clipped preview and "Save value as file".
- **Views read asynchronously** (the page can't read a File synchronously): placeholders + prefetch.
  Tree pages big containers (1,000 children per page, "Go to index…"); Format view uses a sparse async
  `LineModel` (raw or pretty; a one-line minified file opens Pretty); Table pages rows; Find streams in a worker.
- **Edit**: piece-table undo/redo; node edits + "edit node as text" in the existing editor first, free text
  editing over a window second; incremental revalidation from the checkpoint before an edit until the stack
  re-syncs; save in place in Chromium (`createWritable`, atomic swap) or download `Blob([file slices…, edits…])`.
  Session (edits) restored from IndexedDB when the same file (name, size, lastModified) is reopened.
- **Graph** of the explored part (root/selected node, a few levels, "+N more" cards that page).
- **Streamed whole-document commands** (Format, Minify, Convert to CSV/JSONL/YAML, Repair, Sort keys with
  external merge sort) to the save picker (Chromium) or an OPFS file then downloaded.
- Entry: `loadFile` routes `f.size > HUGE_MIN` (300 MiB; lower when `navigator.deviceMemory` is small) to huge mode.
  A debug override (e.g. `localStorage['tk:hugeMin']`) forces huge mode for small files so it can be tested fast.
  A `HugeSession` owns what the views get; `engine.ts` doesn't grow `if (huge)` everywhere. Unsupported features
  (Compare…) say so clearly.

## Phases (each shippable)

0. Measure: File read throughput in a worker (FileReaderSync vs `slice().arrayBuffer()` vs `stream()`) in 3
   engines; skeleton parse throughput; checkpoint interval. Competitor survey sets the bar.
1. Validate any size: skeleton Wasm, checkpoints, exact errors, JSONL, long strings, progress UI.
2. Browse: tree paging, Format view (raw/pretty), go to path/line/index, streamed Find, Table paging, copy/save node.
3. Edit: piece table, node edits, subtree editor, revalidation, undo/redo, save, session restore; then free text.
4. Graph of the explored part.
5. Streamed whole-document commands; URL load streamed to OPFS.

## Targets (provisional; the competitor survey refines them)

- Any size opens; tab memory stays under ~400 MB above idle for a 10 GB file.
- First tree rows < 300 ms after choosing the file (browse while indexing); indexing ≥ 1 GB/s on desktop Chromium.
- Seek (index / line / path) < 150 ms once indexed; scrolling stays at 60 fps.
- Error position identical to the normal parser on every document both can open (differential tests).

## Rules for everyone working on this

- Read `AGENTS.md` (privacy: `PRIVATE` class on anything showing document facts, fixed-list analytics events
  documented on /privacy, `reportError` only; SEO; pnpm only) and the Next.js docs note there.
- Load: the host has 4 cores / 15 GB shared with other agents. Unit tests freely. Browser checks: one at a time,
  `-j 1`, under `flock ~/.cache/mem-work/heavy.lock`. Heavy runs (multi-GB files, multi-engine, perf A/Bs) only
  19:30–00:30 UTC. Never `pkill -f`; stop your own PIDs. Disk: ~30 GB free: files over 2 GB on disk only
  briefly, delete after; prefer synthetic `ByteSource`s generating content on the fly for Node tests.
- CI: only ~91 billed minutes left this month: **do not dispatch CI runs**; the lead reserves them for the final
  3-engine verification.
- Measurements: interleave variants, rotate order per round, include an A/A control (see
  `~/.claude-cliproxy/projects/-home-ubuntu-tools/memory/v8-string-perf-findings.md`, `harness-perf-ab.md`).
- Commit in small, explained steps on your own branch; don't push; don't merge into `feat/huge-files` yourself.
