# Huge-file mode: streamed passes and commands

Whole-document work over a huge file, in a worker of its own (`lib/huge/stream/stream.worker.ts`), apart from
the index's worker so browsing stays quick: the Shape panel's pass, the Convert view's commands, the Shape
panel's "Next" / "Count" scans, and .gz decompression. Page side: `lib/huge/tasks.ts` (one per session,
`session.tasks`), `lib/huge/gz.ts`; UI: `components/huge/HugeShape.tsx`, `HugeCommands.tsx`, `HugeGz.tsx`.
Everything is reached through the huge chunk's dynamic import; no page's first load changes.

## How a pass works

- `walk.ts` `Walker`: reads bytes a chunk at a time, in order, and tells a `Visitor` each token with its byte
  offset (`open`/`close`, `key`, `str`, `num`, `lit`). It keeps the open containers' kinds (a byte a level)
  and the one token a chunk's end cuts: a string up to `keep` (64 MiB) is joined, a longer one comes in
  parts (`part`, the reformatter) or cut (`LONG`, the rest). Several top-level values (`multi`) are one
  virtual array (`open(ARR, -1)`), separated by whitespace, `,` or `;`. It checks the grammar its work needs
  and throws `WalkError(at)`; the index stays the authority for errors (commands run once it is done and
  valid; the Shape pass may run while indexing).
- `pass.ts`: reads `[start, end)` of a `Source` (a Blob: `slice().arrayBuffer()`, 16 MiB, two in flight),
  feeds the walker, hands the visitor's output (`out.ts` `Bytes`, 1 MiB blocks) to its sink between chunks
  and when the visitor pauses the walker, yields a task every 30 ms (a Stop is seen), throws `Stopped`.
- A scope is a byte range of the document after its byte order mark: the whole file (`multi` for a list of
  values) or a value (`HugeNode.start/end`).

## Visitors

| File | What | Exact against |
|---|---|---|
| `reformat.ts` | Pretty (an indent), Minify, JSON Lines (`toJSONL`) | `formatDoc`, `toJSONL` (strings re-quoted as `quote(JSON.parse(token))`, escapes JSON.stringify writes alike kept, invalid UTF-8 as U+FFFD, numbers as written, duplicates kept) |
| `shape.ts` | Every path (`[*]` items): kinds and counts, presence and first object missing it, null %, numbers' range / mean / integers, string lengths and formats, array lengths, members per object, distinct values (exact ≤ 64 with counts, then HyperLogLog 2^11, ~2.3 %), examples, first byte of each kind | a tree-based oracle (tests/huge-shape.test.ts) |
| `csv.ts` | `CsvColumns` (pass 1 from tokens) / `CsvScan` (pass 1 from records) → `CsvPlan`; `Trees` + `CsvRows` (pass 2, a record at a time with xlsx.ts's own cell rules) | `toCsv(records(root))`, every branch |
| `filter.ts` | Field conditions on records (`exists`, `missing`, `eq`, `ne`, `contains`, `starts`, `lt`…`ge`, `is`), paths with `*`, all / any | hand cases |
| `seek.ts` | The next value of a kind at a shape path, the next object lacking a member, or a count | hand cases |
| `jobs.ts` | `runJob(src, job, outs, hooks)`: `format`, `lines`, `csv` (optionally filtered), `extract`, `split`, `shape`, `seek` | extract / split / lines vs formatDoc / toJSONL |

Bounds: Shape 5,000 paths and 300 names per object path (more: one "other names" path); CSV 20,000
columns, 300,000 dotted key / value names, 32 MiB per record (CSV, filters); strings past 64 MiB are cut in
Shape and CSV, written whole by Pretty / Minify / JSON Lines / Split.

## Sinks (`sinks.ts`)

- Chromium: `showSaveFilePicker` (Split: `showDirectoryPicker`), the handle posted to the worker, which writes
  through `createWritable()` (committed on close; aborted on failure or Stop).
- Elsewhere: an OPFS file in `tk-huge/` through `createSyncAccessHandle()` (every engine's workers), handed
  back as a disk-backed `File` and downloaded with `<a download>`; Split writes one stored ZIP64 archive
  (local headers patched in place, no data descriptors). Space is checked first (`navigator.storage.estimate()`).
- gzip on the way: `CompressionStream('gzip')` around any sink.
- OPFS files: named per command, held with a Web Lock while used (another tab's `sweep()` leaves them),
  replaced by the next output, deleted a minute after the file closes, swept after 10 minutes otherwise.

## Protocol (`protocol.ts`, `client.ts`, `serve.ts`)

`StreamClient.run(file, bom, job, out, { progress, shape })` → `{ done, stop }`; `gunzip(file, name, limit)`
(memory up to `limit`, else OPFS). Errors are fixed messages (`KNOWN_ERRORS`; anything else
'Command failed'), with the byte for 'Invalid JSON'.

## .gz input

`Engine.loadFile` sends every `.gz` to huge mode's chunk: `gzSize` (gzip's ISIZE trailer, raised past 4 GiB
where it must have wrapped) decides editor (≤ the editor's threshold: decompressed in memory, opened as if
the file had been plain) or huge mode (space checked, decompressed into OPFS, opened from there, deleted
when the session closes). `localStorage['tk:hugeMin'] = '0'` sends every .gz to huge mode (tests).
