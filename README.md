# Tool Kumar (JSON Formatter & Viewer)

A fast, private, offline-capable JSON formatter, validator and viewer. Everything runs in the browser; nothing is uploaded.

**Live:** https://tools.vikasmaur.com

## JSON resources

These server-rendered pages can be linked from documentation, tutorials and developer reading lists:

- [JSON syntax reference](https://tools.vikasmaur.com/resources/json-reference), based on RFC 8259 and ECMA-404.
- [JSON examples for APIs, configuration and tests](https://tools.vikasmaur.com/resources/json-examples), with downloadable fictional-data fixtures.
- [How to format and validate JSON](https://tools.vikasmaur.com/blogs/json-formatting-guide).
- [The origin of JSON](https://tools.vikasmaur.com/blogs/origin-of-json).

Browse the [resource library](https://tools.vikasmaur.com/resources) or [open the private JSON viewer](https://tools.vikasmaur.com).

## Features

- **Format / minify / sort keys** with 2, 4 or tab indentation, all undoable.
- **Validate** with exact line & column errors and in-editor squiggles.
- **Repair** loose JSON: comments, trailing commas, single quotes, unquoted keys, Python `True/None`, `NaN`, NDJSON, JSONP, code fences, truncated input…
- **Lossless**: big integers and long decimals are never rounded; duplicate keys are kept and flagged.
- **Tree view** (virtualized, millions of nodes) with search, JSONPath / JSON Pointer navigation, copy value/path, colour & timestamp previews.
- **[Graph view](https://tools.vikasmaur.com/tools/json-visualizer)** with connected object and array cards, pan, zoom, minimap, branch collapse, editor sync, search, keyboard navigation and local PNG/JPEG/SVG export. Export the whole graph, visible area or selected branch with a theme, white, transparent or custom background at 1×, 2× or 3× resolution. The canvas paints only the visible part for large documents.
- **Table view** of any array/object with sorting, drill-down and CSV export.
- **Convert** to TypeScript, Zod, JSON Schema, C#, Dart, Java, Python, Go, Kotlin, Swift, PHP, Rust, CSV, Excel, YAML, XML and TOML.
- **Compare** two JSON documents (structural diff, JSON Patch).
- Editor ↔ tree sync, bracket matching, auto-indent, command palette (`Ctrl/⌘ K`), keyboard shortcuts (`?`).
- Huge files (tens of MB) open instantly in a virtualized read-only view.
- Open / drop files, paste, load from URL, compressed share links (data stays in the URL hash).
- "View in Tool Kumar" links for other sites: `/#a=<doc>&b=<doc>&view=tree` (format in `lib/link.ts`; docs and copy-paste functions at `/integrate`, from `app/(en)/integrate/snippets.ts`).
- Light & dark themes (follows the system, no flash), installable PWA, works offline.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, statically prerendered) + TypeScript
- Zero runtime dependencies beyond React/Next: the parser, editor, tree, table, graph, converters and diff are hand-written.
- Hand-written CSS with design tokens (`app/globals.css`), hand-written service worker (`public/sw.js`).
- [Vercel Web Analytics](https://vercel.com/docs/analytics) (page views only; share-link data in the URL hash is stripped).
- [PostHog](https://posthog.com) (feature analytics, masked session replay and sanitized browser Error Tracking; see `/privacy`).

## PostHog setup

Copy `.env.example` to `.env.local`, or add its two public variables to Vercel's Production environment and redeploy. Get the project token from PostHog's project settings and use the US or EU ingestion host for the project's region. Enable **Discard client IP data** in PostHog's project settings so the privacy page's IP statement is accurate. Session Replay must be enabled in the project if you want recordings.

Application errors are sent to PostHog Error Tracking through `captureException()`. Early browser listeners catch uncaught errors and unhandled rejections; the existing React error boundaries and selected conversion/worker handlers call `reportError()`. SDK exception autocapture stays off to prevent duplicate listeners and console capture. Reports retain standard error categories, known application script coordinates and anonymous session links. They discard original messages, arbitrary properties, source snippets, local variables and breadcrumbs. Privacy mode and browser opt-outs also stop error reporting. Reports are limited to 10 per minute per page, with duplicate Error objects ignored.

For readable production stacks, set the optional secret `POSTHOG_API_KEY` and numeric `POSTHOG_PROJECT_ID` from `.env.example` in the build environment. The PostHog Next.js plugin uploads application source maps and deletes them from the deployment. Without these credentials, errors still arrive with minified script locations. This integration reports browser application failures, not server/build logs or expected input validation failures. The project is statically rendered and document processing runs in the browser.

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
app/blogs/           blog index and posts; add a post to posts.ts plus a page in its own folder
app/resources/       citable JSON reference and reusable example pages
components/          React UI (toolbars, status bar, dialogs)
lib/json/            lossless tolerant parser, serializer, paths, smart value helpers
lib/engine/          editor, tree, table and code views + the engine that ties them together
lib/convert/         type/code generators, data formats, importers, XLSX writer (lazy-loaded)
lib/diff/            structural JSON diff + JSON Patch
public/sw.js         offline service worker
public/examples/     downloadable JSON fixtures used by resource pages
public/llms.txt      concise crawler and AI-reader index of the public pages
tests/               node:test suites
```

See [AGENTS.md](AGENTS.md) for the two rules every change must follow.
