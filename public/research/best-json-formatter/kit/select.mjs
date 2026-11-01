// The inclusion rule (protocol section 2): merges the ten search lists in ../serp/, drops ineligible results
// (../serp/eligibility.json says why for each), counts one entry per site, and orders the sites by the number of
// lists they appear in, then best position, then average position. Prints the table and writes ../serp/selection.json.
//
//   node select.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const serp = new URL('../serp/', import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, serp), 'utf8'));
const lists = [...load('google.json').lists, ...load('bing.json').lists];
const { ineligible, pages, take, publisher } = load('eligibility.json');

const site = (url) => new URL(url).hostname.replace(/^www\./, '');
const sites = new Map();
const dropped = new Map();
for (const list of lists) {
  const seen = new Set();
  for (const r of list.results.slice(0, 10)) {
    const host = site(r.url);
    if (ineligible[host]) {
      dropped.set(host, ineligible[host]);
      continue;
    }
    if (seen.has(host)) continue; // one entry per site and list: its best position
    seen.add(host);
    const s = sites.get(host) ?? { site: host, lists: [], positions: [] };
    s.lists.push(`${list.engine}: ${list.query}`);
    s.positions.push(r.position);
    sites.set(host, s);
  }
}
const ranked = [...sites.values()]
  .map((s) => ({ ...s, count: s.lists.length, best: Math.min(...s.positions), average: s.positions.reduce((a, b) => a + b, 0) / s.positions.length }))
  .sort((a, b) => b.count - a.count || a.best - b.best || a.average - b.average || a.site.localeCompare(b.site));
ranked.forEach((s, i) => (s.rank = i + 1));
const chosen = ranked.slice(0, take).map((s) => s.site);
if (!chosen.includes(publisher)) chosen.push(publisher);

console.log('rank  site                               lists  best   avg  page tested');
for (const s of ranked) console.log(`${String(s.rank).padStart(4)}  ${s.site.padEnd(34)} ${String(s.count).padStart(5)} ${String(s.best).padStart(5)} ${s.average.toFixed(1).padStart(5)}  ${s.rank <= take ? pages[s.site] ?? '(page to be confirmed)' : ''}`);
console.log(`\nineligible: ${[...dropped].map(([h, why]) => `${h} (${why})`).join('; ')}`);
console.log(`\ntested: ${chosen.join(', ')}`);
writeFileSync(new URL('selection.json', serp), JSON.stringify({ rule: 'protocol.md section 2', take, ranked, ineligible: Object.fromEntries(dropped), tested: chosen.map((s) => ({ site: s, page: pages[s] ?? null, publisher: s === publisher })) }, null, 1) + '\n');
