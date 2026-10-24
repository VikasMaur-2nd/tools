/*
 * "View in Tool Kumar" and "Compare in Tool Kumar" buttons around a link (lib/link.ts), as
 * Markdown or HTML: what /integrate's builder makes (components/LinkBuilder.tsx) and what the
 * viewer's Share menu copies. The button images live in public/badges.
 */

/** The link alone, or a button around it. */
export type SnippetFormat = 'link' | 'markdown' | 'html';
/** A link that opens one document, or compares two. */
export type BadgeKind = 'view' | 'compare';
/** Auto follows the reader's light or dark mode (HTML only; Markdown gets black). */
export type BadgeColor = 'auto' | 'black' | 'white';

import { SITE } from './site';

export { SITE };

export const BADGES = {
  view: { label: 'View in Tool Kumar', width: 158 },
  compare: { label: 'Compare in Tool Kumar', width: 180 },
} as const;

const badgeUrl = (kind: BadgeKind, white: boolean, site = SITE) => `${site}/badges/${kind}-in-tool-kumar${white ? '-dark' : ''}.svg`;

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** `href` as `format`. `site`: where the button images are (the site the link opens). */
export function snippet(format: SnippetFormat, href: string, kind: BadgeKind, color: BadgeColor = 'auto', site = SITE) {
  if (format === 'link') return href;
  const { label, width } = BADGES[kind];
  if (format === 'markdown') return `[![${label}](${badgeUrl(kind, color === 'white', site)})](${href})`;
  const img = (white: boolean) => `<img src="${badgeUrl(kind, white, site)}" alt="${label}" width="${width}" height="28">`;
  const a = escapeAttr(href);
  return color === 'auto'
    ? `<a href="${a}"><picture><source media="(prefers-color-scheme: dark)" srcset="${badgeUrl(kind, true, site)}">${img(false)}</picture></a>`
    : `<a href="${a}">${img(color === 'white')}</a>`;
}
