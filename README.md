# tools.vikasmaur.com — JSON Formatter & Viewer

A fast, private, offline-capable JSON formatter, validator and viewer. Everything runs in the browser — nothing is uploaded.

**Live:** https://tools.vikasmaur.com

## Features

- **Format / minify / sort keys** with 2, 4 or tab indentation — all undoable.
- **Validate** with exact line & column errors and in-editor squiggles.
- **Repair** loose JSON: comments, trailing commas, single quotes, unquoted keys, Python `True/None`, `NaN`, NDJSON, JSONP, code fences, truncated input…
- **Lossless**: big integers and long decimals are never rounded; duplicate keys are kept and flagged.
- **Tree view** (virtualized, millions of nodes) with search, JSONPath / JSON Pointer navigation, copy value/path, colour & timestamp previews.
- **Table view** of any array/object with sorting, drill-down and CSV export.
- **Convert** to TypeScript, Zod, JSON Schema, C#, Dart, Java, Python, Go, Kotlin, Swift, PHP, Rust, CSV, Excel, YAML, XML and TOML.
- **Compare** two JSON documents (structural diff, JSON Patch).
- Editor ↔ tree sync, bracket matching, auto-indent, command palette (`Ctrl/⌘ K`), keyboard shortcuts (`?`).
- Huge files (tens of MB) open instantly in a virtualized read-only view.
- Open / drop files, paste, load from URL (`?url=`), compressed share links (data stays in the URL hash).
- Light & dark themes (follows the system, no flash), installable PWA, works offline.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, statically prerendered) + TypeScript
- Zero runtime dependencies beyond React/Next — the parser, editor, tree, table, converters and diff are hand-written.
- Hand-written CSS with design tokens (`app/globals.css`), hand-written service worker (`public/sw.js`).
- [Vercel Web Analytics](https://vercel.com/docs/analytics) (page views only; share-link data in the URL hash is stripped).

## Develop

```bash
pnpm install
pnpm dev         # http://localhost:3000
pnpm test        # parser, converter, diff and interchange test suites
pnpm lint
pnpm build && pnpm start
```

## Layout

```
app/                 layout (metadata, theme bootstrap), page, CSS, manifest, robots, sitemap, icons
components/          React UI (toolbars, status bar, dialogs)
lib/json/            lossless tolerant parser, serializer, paths, smart value helpers
lib/engine/          editor, tree, table and code views + the engine that ties them together
lib/convert/         type/code generators, data formats, importers, XLSX writer (lazy-loaded)
lib/diff/            structural JSON diff + JSON Patch
public/sw.js         offline service worker
tests/               node:test suites
```

See [AGENTS.md](AGENTS.md) for the two rules every change must follow.
