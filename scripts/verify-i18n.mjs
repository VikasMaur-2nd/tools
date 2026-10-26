// Verify every localized (and English) home, hub and tool page of a running build.
// usage: pnpm build && pnpm start, then: node scripts/verify-i18n.mjs [base-url]   (default http://localhost:3000)
// Checks per page: 200, <html lang>, localized title + description, self canonical, the complete
// reciprocal hreflang cluster with x-default, one <h1>, JSON-LD that parses with the right inLanguage,
// og:locale; then the sitemap (exact localized URL set, xhtml alternates), 404s and llms.txt links.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGLISH, LOCALES } from '../lib/i18n/locales.ts';
import { SITE } from '../lib/site.ts';
import { TOOL_PAGES } from '../lib/tool-pages.ts';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

// What should exist: the same rules as lib/i18n/server.ts.
const live = LOCALES.filter((l) => Object.keys(readJson(`lib/i18n/${l.id}/ui.json`)).length);
const pagesOf = (l) => {
  const tr = readJson(`lib/i18n/${l.id}/tool-pages.json`);
  return TOOL_PAGES.filter((p) => tr[p.slug] && (tr[p.slug].sections?.length ?? 0) === (p.sections?.length ?? 0)).map((p) => p.slug);
};
const slugs = Object.fromEntries(live.map((l) => [l.id, new Set(pagesOf(l))]));
const enUi = readJson('lib/i18n/en/ui.json');
const paths = ['/', '/tools', ...TOOL_PAGES.map((p) => `/tools/${p.slug}`)];
const has = (l, path) => l.id === 'en' || !path.startsWith('/tools/') || slugs[l.id].has(path.slice(7));
const at = (l, path) => (l.id === 'en' ? path : path === '/' ? `/${l.id}` : `/${l.id}${path}`);
const abs = (p) => (p === '/' ? SITE : SITE + p);
const cluster = (path) => {
  const out = {};
  for (const l of [ENGLISH, ...live]) if (has(l, path)) out[l.hreflang] = abs(at(l, path));
  out['x-default'] = abs(path);
  return out;
};

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag);
  return m ? decode(m[1]) : undefined;
};
const tags = (html, re) => [...html.matchAll(re)].map((m) => m[0]);
const englishTitle = {};

async function get(path) {
  const res = await fetch(base + path, { redirect: 'manual' });
  return { status: res.status, text: await res.text() };
}

let checked = 0;
for (const l of [ENGLISH, ...live]) {
  for (const path of paths) {
    if (!has(l, path)) continue;
    const url = at(l, path);
    const { status, text: html } = await get(url);
    checked++;
    if (status !== 200) {
      fail(url, `HTTP ${status}`);
      continue;
    }
    const head = html.slice(0, html.indexOf('</head>'));
    const htmlLang = /<html[^>]*\slang="([^"]+)"/i.exec(html)?.[1];
    if (htmlLang !== l.lang) fail(url, `<html lang="${htmlLang}">, want ${l.lang}`);
    if (!/<html[^>]*\sdir="ltr"/i.test(html)) fail(url, 'no dir="ltr"');
    const title = decode(/<title>([^<]*)<\/title>/i.exec(head)?.[1] ?? '');
    const desc = attr(tags(head, /<meta[^>]*name="description"[^>]*>/gi)[0] ?? '', 'content') ?? '';
    if (!title || !desc) fail(url, 'missing title or description');
    if (l.id === 'en') englishTitle[path] = { title, desc };
    else if (title === englishTitle[path]?.title || desc === englishTitle[path]?.desc) fail(url, 'title or description is the English one');
    const canonical = attr(tags(head, /<link[^>]*rel="canonical"[^>]*>/gi)[0] ?? '', 'href');
    if (canonical !== abs(url)) fail(url, `canonical ${canonical}, want ${abs(url)}`);
    const alts = {};
    for (const tag of tags(head, /<link[^>]*rel="alternate"[^>]*hreflang[^>]*>/gi)) alts[attr(tag, 'hreflang')] = attr(tag, 'href');
    const want = cluster(path);
    if (JSON.stringify(Object.entries(alts).sort()) !== JSON.stringify(Object.entries(want).sort()))
      fail(url, `hreflang cluster ${JSON.stringify(alts)} ≠ ${JSON.stringify(want)}`);
    const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
    if (h1 !== 1) fail(url, `${h1} <h1>`);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => m[1]);
    const nodes = [];
    for (const s of ld) {
      try {
        const v = JSON.parse(s);
        nodes.push(...(v['@graph'] ?? [v]));
      } catch {
        fail(url, 'JSON-LD does not parse');
      }
    }
    if (!nodes.length) fail(url, 'no JSON-LD');
    if (l.id !== 'en') {
      const own = nodes.filter((n) => n.inLanguage === l.lang);
      if (!own.length) fail(url, `no JSON-LD entity with inLanguage ${l.lang}`);
      if (nodes.some((n) => n.inLanguage && n.inLanguage !== l.lang && n['@type'] !== 'WebSite')) fail(url, 'JSON-LD entity in another language');
      const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList');
      if (crumbs?.itemListElement.some((i) => !String(i.item).startsWith(`${SITE}/${l.id}`))) fail(url, 'breadcrumb leaves the language');
      const og = attr(tags(head, /<meta[^>]*property="og:locale"[^>]*>/gi)[0] ?? '', 'content');
      if (og !== l.og) fail(url, `og:locale ${og}, want ${l.og}`);
      // Interface strings render translated in the server HTML.
      if (path === '/' && html.includes(`>${enUi['app.ready']}<`)) fail(url, 'status bar renders in English');
    }
  }
}

// Sitemap: localized URLs exactly as expected, each with its cluster.
const sitemap = (await get('/sitemap.xml')).text;
if (!sitemap.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"')) fail('sitemap', 'no xhtml namespace');
const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
  loc: /<loc>([^<]*)<\/loc>/.exec(m[1])[1],
  alts: Object.fromEntries([...m[1].matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((a) => [a[1], decode(a[2])])),
}));
const locs = new Set(entries.map((e) => e.loc));
const expected = new Set();
for (const path of paths) for (const url of Object.values(cluster(path))) expected.add(url);
for (const url of expected) if (!locs.has(url)) fail('sitemap', `missing ${url}`);
const localized = new RegExp(`^${SITE}/(${LOCALES.map((l) => l.id).join('|')})(/|$)`);
for (const e of entries) {
  if (localized.test(e.loc) && !expected.has(e.loc)) fail('sitemap', `unexpected ${e.loc}`);
  if (!expected.has(e.loc)) continue;
  const path = paths.find((p) => Object.values(cluster(p)).includes(e.loc));
  if (JSON.stringify(Object.entries(e.alts).sort()) !== JSON.stringify(Object.entries(cluster(path)).sort())) fail('sitemap', `${e.loc} alternates differ`);
}

// Not found: unknown language, unknown tool, and pages that exist in English only.
const missing = ['/xx', '/xx/tools', `/${live[0]?.id ?? 'es'}/tools/not-a-tool`, `/${live[0]?.id ?? 'es'}/blogs`, `/${live[0]?.id ?? 'es'}/about`];
for (const l of live) for (const p of TOOL_PAGES) if (!slugs[l.id].has(p.slug)) missing.push(`/${l.id}/tools/${p.slug}`);
for (const path of missing) {
  const { status, text } = await get(path);
  if (status !== 404) fail(path, `HTTP ${status}, want 404`);
  else if (!/<meta name="robots" content="noindex"/i.test(text)) fail(path, '404 without noindex');
}

// llms.txt points at pages that exist.
const llms = (await get('/llms.txt')).text;
for (const m of llms.matchAll(new RegExp(`${SITE}(/[^)\\s]*)?\\)`, 'g'))) {
  const path = m[1] || '/';
  if (localized.test(SITE + path) && (await get(path)).status !== 200) fail('llms.txt', `${path} is not live`);
}

console.log(`${checked} pages in ${live.length + 1} languages (${live.map((l) => l.id).join(', ')}), ${entries.length} sitemap entries, ${missing.length} not-found checks`);
for (const e of errors) console.log(`FAIL ${e}`);
console.log(errors.length ? `${errors.length} failures` : 'all checks passed');
process.exit(errors.length ? 1 : 0);
