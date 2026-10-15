/**
 * The translatable text of an English tool page and its freshness hash: the
 * contract between lib/tool-pages.ts and the translations in
 * lib/i18n/<locale>/tool-pages.json. Node only (scripts and tests); the app
 * never imports this.
 */
import { createHash } from 'node:crypto';
import type { ToolPage } from '../tool-pages';

/** Fields translators receive, in export order (the order is part of the hash). */
export function pageText(p: ToolPage) {
  return {
    title: p.title,
    description: p.description,
    heading: p.heading,
    query: p.query,
    secondary: p.secondary,
    intro: p.intro,
    modeLabel: p.modeLabel,
    exampleLabel: p.exampleLabel,
    steps: p.steps,
    options: p.options,
    faqs: p.faqs,
    ...(p.guides ? { guides: p.guides.map((g) => ({ slug: g.slug, text: g.text })) } : {}),
    ...(p.sections ? { sections: p.sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs })) } : {}),
  };
}

/** Hash of the English text a translation was made from (12 hex digits of SHA-256). */
export const pageHash = (p: ToolPage) => createHash('sha256').update(JSON.stringify(pageText(p))).digest('hex').slice(0, 12);

/** Short hash of one interface string's English text (UI freshness). */
export const textHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);
