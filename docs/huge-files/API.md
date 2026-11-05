# Huge-file mode: the core API

What the views get for a JSON / JSON Lines document of any size (bigger than memory), 100% in the browser.
Types: `lib/huge/types.ts`. Page side: `lib/huge/client.ts` (and `lib/huge/page.ts` for JNodes). Worker:
`lib/huge/huge.worker.ts`. Everything under `lib/huge/` is reached only through a dynamic import once a huge
file is opened; nothing is on any page's first load.

## Model

- The file is read once by the **indexer** (a worker, through `huge.wasm`: a SIMD skeleton parser that writes no
  nodes). It keeps a **checkpoint** (the parser's state: open containers, counts, line numbers) after a value
  about every 1 MiB, and right after every big value, plus a **directory** of every value of at least 256 KiB
  (span, children count, depth, pretty lines). For 10 GB that is ~10k checkpoints: a few MB.
- Every query starts from the nearest checkpoint and parses at most about 1 MiB forward (in full, with the
  normal path's own parsers: `tape.wasm`, or `tape-parser.ts`), so its answer is what the normal path would
  give for that part of the document.
- Queries work while indexing (on what's read so far: `summary().done` is false, counts are partial) and after.
  **Nothing past the front** (where indexing has got to, or the error) is ever read by a query: a container still
  being read is `partial` (its `count` is so far); in a page, the child being read is a partial stub, the page's
  last. Indexing can be stopped (`stop()`): the front stays where it is.
- **Positions are byte offsets** (`Bytes`, JS numbers, beyond 2^31) in the document after a UTF-8 byte order
  mark (`summary.bom` is 3 when the file has one). Lines and columns are as the normal path's status bar
  shows them: 1-based, columns in UTF-16 units, `\r\n` / `\r` / `\n` each end a line.
- **Several top-level values** (JSON Lines, NDJSON, concatenated JSON), and any `.jsonl` / `.ndjson` file, are one
  `LIST` node whose children are the records, viewed as the normal path views them (an array; `summary.multi`).
  `summary.jsonl` tells real JSON Lines (one record per line) from other multi-value documents (rules.ts
  `jsonLines`). While indexing, a document read so far as one value turns `multi` when a second appears: views
  then ask again (the root becomes the `LIST`, pretty lines shift by the `[` line).
- Reads, per engine (RESEARCH-REPORT.md §4f, 5 GiB reads): Chromium and WebKit read with `slice().arrayBuffer()`,
  16 MiB chunks two in flight for indexing and 1 MiB blocks for queries (a 24-block cache; FileReaderSync's
  garbage keeps growing in Chromium); Firefox reads with FileReaderSync (flat there). Every async read is watched
  for a stall (20 s, 3 tries, then the error "Read failed"). A query needing blocks not read yet waits for them
  in the worker and runs again: callers see only latency.

## Opening

```ts
const { openHuge } = await import('@/lib/huge/client');
const doc = openHuge(file, { name: file.name }, (p) => progress(p.bytes / p.size));
const first = await doc.summary();   // counts so far: show the first rows at once
const s = await doc.ready;           // the whole file read (or stopped): s.error is the first problem, if any
await doc.stop();                    // indexing ends where it is (ready resolves, s.stopped); queries go on
await doc.close();                   // keeps edits not kept yet (a session), then lets the worker go
```

`HugeOptions`: `name` (`.jsonl`/`.ndjson` read as JSON Lines exactly as the normal path), `every` (checkpoint
spacing, default 1 MiB), `big` (directory threshold, default 256 KiB), `dups` (duplicate-name check, default on).

`HugeProgress` (streamed while indexing): `bytes`, `size`, `nodes`, `records`, `lines`, `ms`.

`HugeSummary`: `size`, `bom`, `done`, `stopped`, `root` (the only value, or the `LIST`; null if none: nothing read
yet), `records`, `multi`, `jsonl`, `nodes`, `depth`, `lines` (raw), `prettyLines`, `error`, `status`, `warnings`
(first 500 duplicate names), `moreWarnings`, `unchecked` (names the bounded duplicate check skipped), `ms`,
`indexBytes`. The root is there from the first summary (a container from its first byte, `partial` while read),
also when the document breaks inside it.

`status: HugeStatus | null` (null until all is read): **what the normal path's status bar says**
(Engine.statusOf / linesStatus): `{ kind: 'valid'|'fixable'|'error', msg, line, col, pos, warnings, more, jsonl }`.
Several top-level values in a file not named `.jsonl` that aren't JSON Lines (one record a line, whitespace
between) say "Multiple top-level values (wrapped in an array)" at the second value, fixable (or 'error' when an
error follows), as the normal path; still browsed as a LIST. `.jsonl` files: valid JSON Lines, or their error.

`error: HugeError | null`: `{ msg, line, col, pos, kind }`. **The message, line and column are the normal
path's** for the same document (its status bar's first problem: tape-parser.ts with `repair`, re-run from the
checkpoint before the failure; differential tests check it). `kind` is 'error' or 'fixable' as far as the
re-parsed part shows (the normal path, which reads everything, may say 'error' where a later part is broken).
The document is valid up to the error: views show that part.

## Nodes and pages (tree, table, graph)

`HugeNode` is a value without its subtree: `kind` (NUL…OBJ as tape.ts, or `LIST`), `start`/`end` bytes,
`depth`, `key` (name or index; null for a root), `count` (children), `partial` (still being read: `count` so far,
`end` -1), `pretty` / `prettyLines` (its lines in the pretty form), `big` (paged on its own), `preview` (a big
child in a page: its row's text: a container's first children as format.ts `preview` writes them, a string's
decoded start, at most 1,024 characters then `…`).

```ts
const page = await doc.children(node, from, 1000);   // HugePage
const view = new PageNodes(page);                     // lib/huge/page.ts
view.children        // JNode[]: the children, real keys (items numbered from `from`), small subtrees whole
view.stub(jnode)     // HugeNode for a child too big to be in the page (an empty {} / [] / "" stands for it)
view.span(jnode)     // [start, end) bytes of any JNode of the page
```

- `children(node, from, count)`: children `[from, from + count)` of a big container (or the `LIST`), parsed in
  full: a page is a tape (`tape.ts`) over the page's own text, so lazy.ts / Filler / pretty.ts work on it
  unchanged. A page stops at `count` children or about 4 MiB of text: **it may hold fewer than asked**
  (`page.count`; `more` says more follow; the next page starts at `from + page.count`). Children of at least
  256 KiB are **stubs** (page them with their own `children()`; their `count` is known): they don't count
  against the 4 MiB.
- Tree: page big containers by 1,000 (`from` = k × 1000; "Go to index…" is `children(node, i, …)`). Expanding
  a small container inside a page needs no request.
- Table: rows are a container's children: `children()` pages; columns from `view.tape` (Filler.columns).
- Graph: root/selected node and a few levels from pages; "+N more" pages with `children(node, shown, n)`.

## Lines (Format view)

```ts
const lines = await doc.prettyLines(from, 200, '  ');   // the pretty form, as the Format view writes it
const raw = await doc.rawLines(from, 200);              // the text as stored
```

`HugeLines`: `text[]` (each cut at `max`, default 64 KiB: `cut[k]` = 1 and `length[k]` is the full length),
`pos[]` (pretty: the byte where the line's node starts; raw: the line's first byte), `total` lines, and for the
pretty form `depth[]`, `kind[]` (0 value, 1 opens a container, 2 closes one) and `close[]` (an opening line's
closing line, or -1: ask `prettyClose(line)`). Line counts: `summary.lines` (raw), `summary.prettyLines`
(pretty, the same for any indent). A one-line minified file should open in the pretty form.

Raw lines read nothing past the front (indexing, stopped, or the error): a line that goes on past it ends there,
`cut[k]` = 2 and `length[k]` its length so far, and no line after it is given (ask again as indexing goes on). A
long line in a document all read answers its start without reading it all (from the last checkpoint on it).

The pretty form is format.ts `stringify(root, indent)` read a line at a time (pretty.ts PrettyText): every
value a line, every container with items one more for its close. Several top-level values are written as the
normal path writes them: as one array. Nesting so deep the indentation exceeds format.ts `MAX_INDENT` has no
pretty form (as on the normal path).

## Going to things

- `locate(pos)`: the value at byte `pos` (the deepest whose text holds it, as the editor's caret selects) with
  its `path`, its `parent` and `index` there, its **`chain`** (every container above it, root first, each with
  its own index and count: open them all in one go), and `line` / `col`. null only for bytes not read yet.
- `resolve(path)`: `$.records[5000000].name`, `/records/5000000/name` or segments (path.ts syntax). An index
  into a big array is a checkpoint seek (≤ ~1 MiB parsed). A **name** in a big object is found by scanning that
  object until the first member with that name (as path.ts `resolve`): pages of it, parsed.
- Pretty line ↔ node: `prettyLines(k, 1).pos[0]` is the node's byte; a node's `pretty` is its line.

## Find

```ts
const stop = doc.find('needle', { from: caretByte, caseSensitive: false, limit: 1000 }, (b) => {
  b.matches   // Float64Array of byte offsets (search order), each b.length bytes long
  b.done      // last batch
});
```

Searches the bytes as stored for the UTF-8 bytes of the query (ASCII letters either case unless
`caseSensitive`), from `from` forward (or `backward`), wrapping around at the end, streaming batches. Next /
previous from a place: `limit: 1` with `from` and `backward`. A match inside an escaped string matches its
escaped form (`\n`, `é`): the text as stored. `locate(match)` turns a match into a node / path.

## Speed (this host: arm64, 4 cores, loaded; see the core report for method and the browser numbers)

On 3 M records (250 MB), each query from a cold region: page of 1,000 children 5–28 ms, seek to child k ~6 ms,
`resolve` ~30 ms, `locate` ~26 ms, 100 pretty lines ~21 ms, 100 raw lines ~7 ms. Regions stay parsed (64 MiB
LRU), so scrolling the Format view through a region is a lookup.

## Reading values

- `text(start, end, max)`: the text of `[start, end)`, at most `max` bytes (`cut` if more): a node's JSON, a
  preview of a long string. With invalid UTF-8 in it, `bad` (see Bounds: map offsets with utf8.ts).
- `blob(start, end)`: the bytes as a `Blob` sliced from the File (nothing read): "Save value as file", copy. Only
  while the document isn't edited (it throws 'Edited' then).
- `slice(start, end)` (async): the document's bytes as a `Blob` of the file's slices and the edits' bytes
  (nothing copied), edited or not.

## Editing

Once the document is read (`summary.done`, valid or not), it can be edited. Positions are always the document's
as it is when the edit is asked (after the edits before it). Each call is one undo step; each answers
`HugeEdited { version, done, canUndo, canRedo, steps, summary }`. `replace`, `undo` and `redo` are taken while an
edit is still being read again (typing never waits for it); node edits wait until it's all read ('Not ready').
`steps`: the changes applied since the file was opened or saved in place, as undo counts them (+1 an edit or redo,
-1 an undo; a typing run joined into one step is one; steps the history let go of still count; 0 after saving in
place): the file bar's "N changes".

- `replace([{ a, b, text }], typing)`: bytes `[a, b)` replaced by `text` (UTF-8); several in one step, in
  order, each at the document the one before leaves. `typing`: joins the last step if it goes on from it (an
  insert right after the last one's, within a second): typing is one undo step per pause. A keystroke
  (`typing`) answers within about 8 ms of worker time (node edits: 50): what isn't read again by then goes on in
  steps (`done: false`, the summary later through `onSummary`), and the next keystroke may come meanwhile.
- **Free text (the Format view, "as written")**: a window's changes go in as `replace(…, true)` at document
  bytes (the window's start plus `utf8Bytes` of the text before the change: lib/huge/utf8.ts, the rule the core
  uses). The document may be invalid between keys: its error is the normal path's, placed from a few KiB before
  it. Near an edit the index keeps checkpoints 1/64 as far apart (16 KiB), so the next keystroke there reads
  a few KiB again, not a megabyte.
- Node edits, written as the document around them is (the children's separator `,\n    ` / `, ` / `,`, their
  indent, `": "` or `":"`; a value re-indented for where it goes, minified in a minified document, a line of its
  own in JSON Lines):
  - `setValue(node, json)`, `rename(parent, index, name)`, `remove(parent, index)` (with its separator; the only
    child leaves `[]` / `{}`), `insert(parent, index, json, name)` (`index` 0..count; an object's needs `name`;
    `parent` null: an empty document's value), `duplicate(parent, index)` (right after it; an object member
    named `"<name> (copy)"`; any size: the copy is the same bytes, nothing is read).
  - `nodeText(node, max = 64 MiB)` (async; 'Too big' past `max`) for the normal editor, and
    `replaceNode(node, text)` to put its text back: re-indented for where it goes if it's strict JSON (one value,
    nothing the normal path only tolerates: no comments, trailing commas, `nul`, single quotes, …), else **as
    typed, never repaired**: the document then says where it's wrong (the normal path's message), and fixing it
    there, or undo, makes it valid again.
  - JSON given to the other node edits must be strict JSON, one value ('Invalid JSON' otherwise: nothing is
    repaired); a node edit where it can't be: 'Not allowed'.
- `undo()`, `redo()`: the history holds edits' bytes up to 256 MiB (the oldest steps go first).
- After an edit the document is read again from the checkpoint before it until its index is the old one again
  (re-synced): typing and most edits are all read again when they answer (`done`, `summary` there). An edit that
  changes the structure past where it can re-sync (an unbalanced bracket, a string opened) reads on in steps:
  queries meanwhile see the part read (as while opening: a front, partial nodes), progress comes through
  `onProgress`, and the summary through `HugeClient.onSummary` once all is read. A broken document is read up to
  its error (the normal path's message and place); fixing it re-syncs with the rest.
- `summary` then has `edited` (the document differs from the file), `version`, `canUndo`, `canRedo`, `steps`,
  `editBytes` (edits' bytes held: the document's and the history's).
- Speed (this host, Node, worker time a keystroke, 1 GiB of records; 10 GiB in the core report): typing at a
  cursor p50 0.7 ms / p95 8 (the first key at a place reads its checkpoint's stretch: ~8 ms); keys that leave
  the document invalid p50 2.7 / p95 7; an unbalanced bracket ≤ ~11 (then read on in steps); undo of a typing
  run 0.6; set / remove / insert ~22 ms p50, ≤ 52 ms.

## Saving

- `save(handle, inPlace, onSaved)` → `{ done, stop }`:
  - With a File System Access `FileSystemFileHandle` (Chromium: from `showOpenFilePicker`, or from a drop:
    `DataTransferItem.getAsFileSystemHandle()`; `showSaveFilePicker` for save as): the worker writes the document
    to `handle.createWritable()` (64 MiB at a time, progress through `onSaved`), and `close()` swaps it in at the
    end: a stopped or failed save leaves the file as it was. Ask for permission on the page first
    (`handle.requestPermission({ mode: 'readwrite' })`; a dropped file's handle starts read-only), then pass the
    handle (it can be posted to the worker).
  - `inPlace` (the handle is the opened file's): the document then reads the saved file, nothing edited, no
    history (the old file is gone); the index stays as it is. Save as (another file): the document keeps reading
    the opened file, edits and history kept.
  - No handle (other browsers): the last answer has `blob`: the document as a `Blob` of the file's slices and the
    edits' bytes (nothing copied): download it (`URL.createObjectURL`).
  - Edits wait for a save (they answer 'Not ready' meanwhile). A kept session is cleared by a save.

## Sessions (edits kept between visits)

- Edits are kept in IndexedDB a second after the last one, and at `close()` (async: it keeps what isn't kept yet,
  then ends the worker; at most 10 s), keyed by the file's name, size and last modified: the
  document's pieces (references to the file and the edits' bytes) and its history (256 MiB of edits' bytes at most;
  the history goes first if it doesn't fit, then nothing is kept).
- Reopening the same file: `summary.session` is `undefined` while the kept session is looked for, then `null`
  (none) or `{ steps, bytes, time }` (`steps`: the changes it puts back, as `HugeEdited.steps` counts them). The
  look ends soon after opening: if it ends after `ready`, a summary saying what it found comes through
  `HugeClient.onSummary` (nothing needs to ask again). `restoreSession()` puts it back (the edits, then undo goes
  on where it was; `steps` from there); `dropSession()` drops it (closing without keeping the edits).

## Bounds (what is capped, and how)

- Memory: the indexer keeps one window (1 MiB), the open containers (48 bytes per level; nesting is limited to
  parser.ts `MAX_DEPTH` = 100,000, as the normal path's worker), the index (~100 bytes per checkpoint plus 80 per
  directory record), and the duplicate check below. Queries keep a cache of parsed regions under a fixed budget.
- Duplicate property names: each object remembers its first 4,096 names (later names are still checked against
  them, not remembered); 262,144 names across all open objects; a name over 64 KiB with escapes, or one cut by a
  window edge and over 4 KiB, isn't checked. `summary.unchecked` counts what was skipped. Hash matches are
  confirmed by reading both names, so a reported duplicate is real.
- Strings longer than a window are read across windows without being kept. In a page or the pretty form, a
  string of at least 256 KiB is cut (a preview), with its full span in its `HugeNode`.
- An array index past 2^31 - 1 in a page is not representable in a tape's key (Int32): such items keep their
  page-local index in `PageNodes` (documents with over 2 billion items in one array).
- Invalid UTF-8 is read as the normal path reads it (TextDecoder: one U+FFFD per maximal invalid subsequence, no
  error), and every position stays the bytes': nodes, pages, lines, locate, edits. Text that goes out with invalid
  bytes in it says which U+FFFD units they are (`bad`: [unit offset, bytes] pairs, on `text()` and raw
  `HugeLines`). Map its offsets to bytes with lib/huge/utf8.ts `utf8Bytes(text, from, to, bad)` and back with
  `utf16Of(text, bytes, bad)`; after typing in such a text, `badAfterEdit` moves `bad`. A U+FFFD counts 3 bytes
  only where it is the character itself. A column after an invalid byte on a line that starts before a checkpoint
  may still differ from the normal path's (the index's counts take an invalid byte by its kind).
- UTF-16 files (with a UTF-16 byte order mark) aren't read in huge mode.
- Loose JSON (comments, trailing commas, single quotes…): the first problem is the error; views show the part
  before it. A streamed repair is phase 5.
- Edits: once the document is all read (while opening they answer 'Not ready'). Duplicate names after an edit:
  an object of at most 1 MiB that the edit is in is read again whole, and nothing re-syncs before it closes, so
  its names are checked as when opening; in a bigger object, a name the edit makes is checked against the names
  in the stretch read again (and old duplicates stay as found), not against all of the object's.
- A broken document's pretty lines run to the last place a whole value ends before the error (where that is
  depends on where the checkpoints are: an edited and a fresh document may show a few lines more or fewer there).
