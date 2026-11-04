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
- **Positions are byte offsets** (`Bytes`, JS numbers, beyond 2^31) in the document after a UTF-8 byte order
  mark (`summary.bom` is 3 when the file has one). Lines and columns are as the normal path's status bar
  shows them: 1-based, columns in UTF-16 units, `\r\n` / `\r` / `\n` each end a line.
- **Several top-level values** (JSON Lines, NDJSON, concatenated JSON), and any `.jsonl` / `.ndjson` file, are one
  `LIST` node whose children are the records, viewed as the normal path views them (an array; `summary.multi`).
  `summary.jsonl` tells real JSON Lines (one record per line) from other multi-value documents (rules.ts
  `jsonLines`). While indexing, a document read so far as one value turns `multi` when a second appears: views
  then ask again (the root becomes the `LIST`, pretty lines shift by the `[` line).
- Reads: the indexing pass reads the File in 16 MiB chunks, two in flight (`slice().arrayBuffer()`: ~960 MB/s in
  Chromium per the phase-0 research, against ~250 MB/s for one 1 MiB read at a time); queries read 1 MiB slices
  (`FileReaderSync`, ~4 ms each) through a 16 MiB cache.

## Opening

```ts
const { openHuge } = await import('@/lib/huge/client');
const doc = openHuge(file, { name: file.name }, (p) => progress(p.bytes / p.size));
const first = await doc.summary();   // counts so far: show the first rows at once
const s = await doc.ready;           // the whole file read: s.error is the first problem, if any
doc.close();                         // lets the worker (and the document) go
```

`HugeOptions`: `name` (`.jsonl`/`.ndjson` read as JSON Lines exactly as the normal path), `every` (checkpoint
spacing, default 1 MiB), `big` (directory threshold, default 256 KiB), `dups` (duplicate-name check, default on).

`HugeProgress` (streamed while indexing): `bytes`, `size`, `nodes`, `records`, `lines`, `ms`.

`HugeSummary`: `size`, `bom`, `done`, `root` (the only value, or the `LIST`; null if none), `records`, `multi`,
`jsonl`, `nodes`, `depth`, `lines` (raw), `prettyLines`, `error`, `warnings` (first 500 duplicate names),
`moreWarnings`, `unchecked` (names the bounded duplicate check skipped), `ms`, `indexBytes`.

`error: HugeError | null`: `{ msg, line, col, pos, kind }`. **The message, line and column are the normal
path's** for the same document (its status bar's first problem: tape-parser.ts with `repair`, re-run from the
checkpoint before the failure; differential tests check it). `kind` is 'error' or 'fixable' as far as the
re-parsed part shows (the normal path, which reads everything, may say 'error' where a later part is broken).
The document is valid up to the error: views show that part.

## Nodes and pages (tree, table, graph)

`HugeNode` is a value without its subtree: `kind` (NUL…OBJ as tape.ts, or `LIST`), `start`/`end` bytes,
`depth`, `key` (name or index; null for a root), `count` (children; null while not known), `pretty` /
`prettyLines` (its lines in the pretty form), `big` (paged on its own).

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

The pretty form is format.ts `stringify(root, indent)` read a line at a time (pretty.ts PrettyText): every
value a line, every container with items one more for its close. Several top-level values are written as the
normal path writes them: as one array. Nesting so deep the indentation exceeds format.ts `MAX_INDENT` has no
pretty form (as on the normal path).

## Going to things

- `locate(pos)`: the value at byte `pos` (the deepest whose text holds it, as the editor's caret selects) with
  its `path`, its `parent` and `index` there (to page the tree to it), and `line` / `col`.
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
  preview of a long string.
- `blob(start, end)`: the bytes as a `Blob` sliced from the File (nothing read): "Save value as file", copy.

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
- Invalid UTF-8 is read as the normal path reads it (U+FFFD, no error); columns after it on the same line may
  differ from the normal path's (it counts the replacement's UTF-16 units; huge mode counts the bytes' kinds).
- UTF-16 files (with a UTF-16 byte order mark) aren't read in huge mode.
- Loose JSON (comments, trailing commas, single quotes…): the first problem is the error; views show the part
  before it. A streamed repair is phase 5.
