# AGENTS.md

Everything in this repository must be two things:

## 1. BEST IN CLASS

Every feature, interaction, pixel and line of code must beat every competing tool.

- **Fastest possible.** Instant first paint, instant interaction, smooth with multi‑MB inputs. Measure; never regress.
- **Lightest possible.** No third‑party UI/JSON/utility libraries: we build everything ourselves. Every byte shipped must earn its place.
- **pnpm only.** Use `pnpm` for everything (`pnpm install`, `pnpm dev`, `pnpm test`, `pnpm build`), never npm or yarn.
- **Easiest possible.** Zero learning curve: autofocus, sensible defaults, clear errors, undo for everything, keyboard shortcuts for power users.
- **Best looking.** Clean, modern, calm UI that is flawless in both light and dark mode (system default, no flash), on desktop and mobile.
- **Private & reliable.** 100% client‑side, works offline after the first visit, accessible (keyboard + screen readers).

## 2. BEST SEO

Every change must help us rank #1 for the queries our tools serve.

- Semantic, crawlable HTML rendered on the server; correct titles, descriptions, canonical URLs, Open Graph, structured data (JSON‑LD), sitemap and robots.
- Perfect Core Web Vitals (LCP, INP, CLS) and Lighthouse scores of 100.
- Helpful, people‑first content that answers what users search for, never keyword stuffing.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
