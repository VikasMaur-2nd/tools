/**
 * Server-side i18n: dictionaries, the page locale, localized tool pages and
 * hreflang clusters. Translations are imported statically (bundled, never read
 * at request time) and nothing here keeps per-request state: every function is
 * a pure lookup over build-time data, so many locales can prerender in one
 * process.
 */
import 'server-only';
import { SITE } from '@/lib/site';
import { TOOL_PAGES, TOOL_PAGE_BY_SLUG, type ToolPage } from '@/lib/tool-pages';
import { LOCALES, localeInfo, localePath, type Locale, type SiteLocale } from './locales';
import { fill, type Params, type UiDict } from './ui';
import { pageDict, type StringFiles } from './client-dict';
import FILES from './strings-files.json';
import en from './en/ui.json';
import esUi from './es/ui.json';
import ptUi from './pt/ui.json';
import deUi from './de/ui.json';
import frUi from './fr/ui.json';
import jaUi from './ja/ui.json';
import koUi from './ko/ui.json';
import zhUi from './zh/ui.json';
import ruUi from './ru/ui.json';
import esPages from './es/tool-pages.json';
import ptPages from './pt/tool-pages.json';
import dePages from './de/tool-pages.json';
import frPages from './fr/tool-pages.json';
import jaPages from './ja/tool-pages.json';
import koPages from './ko/tool-pages.json';
import zhPages from './zh/tool-pages.json';
import ruPages from './ru/tool-pages.json';

/** The translatable text of a tool page, as exported for translators (scripts/export-tool-pages.mjs). */
type PageText = Pick<ToolPage, 'title' | 'description' | 'heading' | 'query' | 'secondary' | 'intro' | 'modeLabel' | 'exampleLabel' | 'steps' | 'options' | 'faqs' | 'guides'> & {
  hash: string;
  sections?: { heading: string; paragraphs: string[] }[];
};
type Strings = Record<string, string>;

const CATALOG: Record<Locale, { ui: Strings; pages: Record<string, PageText> }> = {
  es: { ui: esUi, pages: esPages },
  pt: { ui: ptUi, pages: ptPages },
  de: { ui: deUi, pages: dePages },
  fr: { ui: frUi, pages: frPages },
  ja: { ui: jaUi, pages: jaPages },
  ko: { ui: koUi, pages: koPages },
  zh: { ui: zhUi, pages: zhPages },
  ru: { ui: ruUi, pages: ruPages },
};

export type UiKey = keyof typeof en;
const EN_UI: Strings = en;
const isNote = (k: string) => k.startsWith('_') || k.endsWith('._context');

// ── development switches (never set for a release build) ──────────────────
/** I18N_DRAFT=1 publishes every locale, with English for strings not translated yet. */
const DRAFT = process.env.I18N_DRAFT === '1';
/** I18N_PSEUDO=<locale> replaces that locale's text with pseudo-English (⟦Ŝŧŕîñĝ···⟧) to find strings that were never extracted. */
const PSEUDO = process.env.I18N_PSEUDO;

const ACCENT: Record<string, string> = Object.fromEntries(
  [...'abcdeghiklmnorstuwyzABCDEGHIKLNORSTUWYZ'].map((c, i) => [c, [...'àƀçđéĝĥîķļɱñöŕšŧûŵýžÀßÇĐÉĜĤÎĶĻÑÖŔŠŦÛŴÝŽ'][i]]),
);
/** Accented, bracketed and ~35% longer, with {placeholders}, <tags> and `code` untouched. */
function pseudo(s: string) {
  const out = s.replace(/(\{\w+\}|<\/?\w+>|`[^`]*`|https?:\S+)|./g, (m, keep) => keep ?? ACCENT[m] ?? m);
  return `⟦${out}${'·'.repeat(Math.ceil(s.length * 0.35))}⟧`;
}

/** A locale is published once its interface strings have arrived (draft builds publish all). */
const hasUi = (l: Locale) => Object.keys(CATALOG[l].ui).length > 0 || PSEUDO === l;
export const liveLocales = (): Locale[] => LOCALES.map((l) => l.id).filter((l) => DRAFT || hasUi(l));

const cache = new Map<string, unknown>();
/** Build-time data is pure, so derived values are memoized per locale. */
const memo = <V>(key: string, make: () => V): V => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as V;
};

/** Every interface string of a locale: its translation where there is one, English otherwise. */
function strings(locale: SiteLocale): Strings {
  return memo(`ui:${locale}`, () => {
    if (locale === 'en') return EN_UI;
    if (PSEUDO === locale) return Object.fromEntries(Object.entries(EN_UI).map(([k, v]) => [k, isNote(k) ? v : pseudo(v)]));
    return { ...EN_UI, ...CATALOG[locale].ui };
  });
}

/** Server-side translation by stable key. */
export function serverT(locale: SiteLocale) {
  const s = strings(locale);
  return (key: UiKey, p?: Params) => fill(s[key] ?? EN_UI[key] ?? key, p);
}

/**
 * The client dictionary of a localized page: English text → translation, for
 * the strings the app renders in the browser. Untranslated strings are left
 * out (the app shows them in English); English pages get none at all. Huge
 * mode's strings aren't in it: they come with huge mode (lib/i18n/client-dict.ts).
 */
export function clientUi(locale: SiteLocale): UiDict | undefined {
  if (locale === 'en') return undefined;
  return memo(`client:${locale}`, () => pageDict(EN_UI, PSEUDO === locale ? strings(locale) : CATALOG[locale].ui));
}

/**
 * The dictionaries a localized page loads later (huge mode's, the lazy features'): its own language's files only
 * (scripts/i18n-huge.mjs writes them and the list), handed to its translator. English pages have none.
 */
export function stringFiles(locale: SiteLocale): StringFiles | undefined {
  return locale === 'en' ? undefined : (FILES as Record<string, StringFiles>)[locale];
}

/** The error boundary's strings for a localized root layout. */
export function errorText(locale: SiteLocale) {
  const t = serverT(locale);
  return { title: t('err.title'), text: t('err.text'), unsaved: t('err.unsaved'), retry: t('err.retry'), reload: t('err.reload') };
}

// ── tool pages ────────────────────────────────────────────────────────────

/**
 * An English tool page with its translated text. Samples, presets, code and
 * outputs stay English. Null when the page's sections changed shape since it
 * was translated (code blocks would no longer line up with their text).
 */
function localize(page: ToolPage, t: PageText): ToolPage | null {
  if ((t.sections?.length ?? 0) !== (page.sections?.length ?? 0)) return null;
  return {
    ...page,
    title: t.title,
    description: t.description,
    heading: t.heading,
    query: t.query,
    secondary: t.secondary,
    intro: t.intro,
    modeLabel: t.modeLabel,
    exampleLabel: t.exampleLabel,
    steps: t.steps,
    options: t.options,
    faqs: t.faqs,
    // Guide links keep the English slugs (the guides are English); only their text is translated.
    guides: page.guides?.map((g) => ({ ...g, text: t.guides?.find((x) => x.slug === g.slug)?.text ?? g.text })),
    sections: page.sections?.map((s, i) => ({ ...s, heading: t.sections![i].heading, paragraphs: t.sections![i].paragraphs })),
  };
}

const pseudoPage = (page: ToolPage): PageText => ({
  hash: '',
  title: pseudo(page.title),
  description: pseudo(page.description),
  heading: pseudo(page.heading),
  query: page.query,
  secondary: page.secondary,
  intro: pseudo(page.intro),
  modeLabel: pseudo(page.modeLabel),
  exampleLabel: pseudo(page.exampleLabel),
  steps: page.steps.map(pseudo),
  options: page.options.map(pseudo),
  faqs: page.faqs.map((f) => ({ question: pseudo(f.question), answer: pseudo(f.answer) })),
  ...(page.guides && { guides: page.guides.map((g) => ({ slug: g.slug, text: pseudo(g.text) })) }),
  ...(page.sections && { sections: page.sections.map((s) => ({ heading: pseudo(s.heading), paragraphs: s.paragraphs.map(pseudo) })) }),
});

/** The tool pages published in a locale, in English order. */
export function toolPages(locale: SiteLocale): ToolPage[] {
  if (locale === 'en') return TOOL_PAGES;
  return memo(`pages:${locale}`, () => {
    if (!liveLocales().includes(locale)) return [];
    const texts = CATALOG[locale].pages;
    return TOOL_PAGES.flatMap((page) => {
      const t = PSEUDO === locale ? pseudoPage(page) : texts[page.slug];
      const out = t && localize(page, t);
      return out ? [out] : [];
    });
  });
}

export const toolPage = (locale: SiteLocale, slug: string) => toolPages(locale).find((p) => p.slug === slug);

/** The languages a path exists in, English first. `path` is the English path: '/', '/tools' or '/tools/<slug>'. */
export function pathLocales(path: string): SiteLocale[] {
  const slug = path.startsWith('/tools/') ? path.slice(7) : null;
  if (slug && !TOOL_PAGE_BY_SLUG.has(slug)) return [];
  return ['en', ...liveLocales().filter((l) => !slug || toolPage(l, slug))];
}

/**
 * Self canonical plus the full hreflang cluster: every language the path
 * exists in, and x-default → English. Relative URLs resolve against
 * metadataBase, exactly like the canonical.
 */
export function alternates(path: string, locale: SiteLocale) {
  const languages: Record<string, string> = {};
  for (const l of pathLocales(path)) languages[localeInfo(l).hreflang] = localePath(l, path);
  languages['x-default'] = path;
  return { canonical: localePath(locale, path), languages };
}

/** Absolute alternates for sitemap entries (same cluster as the page head). */
export function sitemapLanguages(path: string) {
  const abs = (p: string) => (p === '/' ? SITE : SITE + p);
  const languages: Record<string, string> = {};
  for (const l of pathLocales(path)) languages[localeInfo(l).hreflang] = abs(localePath(l, path));
  languages['x-default'] = abs(path);
  return languages;
}

/** og:locale plus og:locale:alternate for the other languages of a path. */
export function ogLocales(path: string, locale: SiteLocale) {
  return { locale: localeInfo(locale).og, alternateLocale: pathLocales(path).filter((l) => l !== locale).map((l) => localeInfo(l).og) };
}

