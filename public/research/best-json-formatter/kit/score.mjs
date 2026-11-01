// Scores every tool from the raw results, exactly as protocol.md section 6 says, and checks the ranking under the
// pre-registered alternative weights.
//
//   node score.mjs <results dir> [--out scores.json]
//
// The results dir holds the JSON-lines files the CI jobs wrote (speed-chromium.jsonl, speed-firefox.jsonl,
// quality-chromium.jsonl, webkit-webkit.jsonl); any subfolders are read too.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ADAPTERS } from './adapters/index.mjs';
import { DATA_CASES, ERROR_CASES } from './cases.mjs';

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } });
const dir = positionals[0] ?? fail('usage: node score.mjs <results dir>');
function fail(m) {
  console.error(m);
  process.exit(2);
}

const records = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.jsonl')) for (const line of readFileSync(p, 'utf8').split('\n')) if (line.trim()) records.push(JSON.parse(line));
  }
})(dir);

export const logScore = (x, good, bad) => (x <= good ? 1 : x >= bad ? 0 : (Math.log(bad) - Math.log(x)) / (Math.log(bad) - Math.log(good)));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** One value per repetition: the last attempt of each (a retry replaces the failed first try); failures are Infinity. */
function perRep(tool, engine, size, field = 'ms') {
  const rs = records.filter((r) => r.suite === 'speed' && r.engine === engine && r.tool === tool && r.size === size && r.ok !== null);
  const byRep = new Map();
  for (const r of rs) if (!byRep.has(r.rep) || (r.attempt ?? 1) >= (byRep.get(r.rep).attempt ?? 1)) byRep.set(r.rep, r);
  return [...byRep.values()].map((r) => (r.ok ? r[field] / 1000 : Infinity));
}
const medianTime = (tool, engine, size, field) => {
  const v = perRep(tool, engine, size, field);
  return v.length ? median(v) : null;
};

const WEIGHTS = {
  Default: { data: 25, speed: 25, privacy: 20, ease: 20, page: 10 },
  Equal: { data: 20, speed: 20, privacy: 20, ease: 20, page: 20 },
  'Features first': { data: 15, speed: 15, privacy: 15, ease: 40, page: 15 },
  'Speed first': { data: 15, speed: 40, privacy: 15, ease: 15, page: 15 },
  'Privacy first': { data: 15, speed: 15, privacy: 40, ease: 15, page: 15 },
};
const GRADE = { pass: 1, spelling: 0.5, refused: 0.5 };

const tools = ADAPTERS.map((a) => {
  const id = a.id;
  const mine = (suite) => records.filter((r) => r.suite === suite && r.tool === id);
  const notes = [];

  // Data safety (5.1)
  const data = DATA_CASES.map((c) => mine('data').filter((r) => r.case === c.id && r.engine === 'chromium').at(-1));
  const dataTested = data.every((r) => r && r.grade !== 'untested');
  const dataPts = dataTested ? (25 * data.reduce((s, r) => s + (GRADE[r.grade] ?? 0), 0)) / DATA_CASES.length : null;

  // Speed (5.3), Chromium medians, failures infinitely slow
  const t = Object.fromEntries(['100kb', '1mb', '10mb', '50mb'].map((s) => [s, medianTime(id, 'chromium', s)]));
  const fr = Object.fromEntries(['1mb', '10mb'].map((s) => [s, medianTime(id, 'chromium', s, 'freezeMs')]));
  const speedTested = t['100kb'] !== null;
  const speedParts = speedTested && {
    '100kb': 5 * logScore(t['100kb'], 0.2, 3),
    '1mb': 5 * logScore(t['1mb'] ?? Infinity, 0.5, 5),
    '10mb': 5 * logScore(t['10mb'] ?? Infinity, 2, 120),
    '50mb': 5 * logScore(t['50mb'] ?? Infinity, 5, 120),
    freeze1mb: 2.5 * logScore(fr['1mb'] ?? Infinity, 0.1, 3),
    freeze10mb: 2.5 * logScore(fr['10mb'] ?? Infinity, 0.1, 3),
  };
  const speedPts = speedTested ? Object.values(speedParts).reduce((s, x) => s + x, 0) : null;

  // Privacy (5.4)
  const all = records.filter((r) => r.tool === id && Array.isArray(r.uploads));
  const uploadRuns = all.filter((r) => r.uploads.length);
  const sends = uploadRuns.length > 0;
  // A blocked tool has no successful runs: its one recorded visit still shows what the page sends and loads.
  const pageRuns = records.filter((r) => r.suite === 'speed' && r.engine === 'chromium' && r.tool === id && r.size === '1mb' && r.rep <= 3 && r.net && (r.ok || a.blocked));
  const third = median(pageRuns.map((r) => r.net.thirdPartyDomains.length));
  const offline = mine('offline').at(-1);
  const privacyTested = all.length > 0 && pageRuns.length > 0;
  const privacyParts = privacyTested && { staysLocal: sends ? 0 : 12, thirdParties: 5 * Math.max(0, 1 - Math.log(1 + third) / Math.log(31)), offline: offline?.ok ? 3 : 0 };
  const privacyPts = privacyTested ? Object.values(privacyParts).reduce((s, x) => s + x, 0) : null;

  // Ease of use (5.2, 5.6, 5.7, 5.9)
  const errs = ERROR_CASES.map((c) => mine('errors').filter((r) => r.case === c.id).at(-1));
  const errTested = errs.every((r) => r && !r.untested);
  const errorPts = errTested ? (10 * errs.reduce((s, r) => s + (r.detected ? 0.5 : 0) + (r.rightLine ? 0.5 : 0), 0)) / ERROR_CASES.length : null;
  const feats = mine('features').filter((r) => r.feature !== '*');
  const featureList = Object.fromEntries(feats.map((r) => [r.feature, r.found]));
  const featurePts = feats.length ? 0.5 * feats.filter((r) => r.found).length : null;
  const phone = mine('phone');
  const majority = (xs) => xs.filter(Boolean).length * 2 > xs.length;
  const phoneWorks = phone.length ? majority(phone.map((r) => r.ok)) : null;
  const phoneFits = phone.length ? majority(phone.map((r) => r.fits?.noSideScroll && r.fits?.controlInView)) : null;
  const ff = ['100kb', '1mb'].map((s) => medianTime(id, 'firefox', s));
  const firefoxWorks = ff.every((x) => x !== null) ? ff.every((x) => Number.isFinite(x)) : null;
  const wk = mine('webkit').at(-1);
  // WebKit works: the 100 KB file formats correctly and the two cases grade as they do in Chromium (amendment 1).
  const wkSame = ['big-integer', 'unicode'].every((c) => mine('webkit-data').filter((r) => r.case === c).at(-1)?.grade === data[DATA_CASES.findIndex((d) => d.id === c)]?.grade);
  const webkitWorks = wk ? Boolean(wk.ok && wkSame) : null;
  const easeParts = { errors: errorPts, features: featurePts, phoneWorks: phoneWorks === null ? null : +phoneWorks, phoneFits: phoneFits === null ? null : +phoneFits, firefox: firefoxWorks === null ? null : +firefoxWorks, webkit: webkitWorks === null ? null : +webkitWorks };
  const easeTested = Object.values(easeParts).every((x) => x !== null);
  const easePts = easeTested ? Object.values(easeParts).reduce((s, x) => s + x, 0) : null;

  // Page and accessibility (5.5, 5.8)
  const lcp = median(pageRuns.map((r) => r.lcpMs).filter((x) => x != null)) / 1000;
  const mb = median(pageRuns.map((r) => r.net.bytes)) / 1e6;
  const cls = median(pageRuns.map((r) => r.cls ?? 0));
  const ads = pageRuns.some((r) => r.net.adRequests > 0);
  const interrupted = records.filter((r) => r.tool === id && ((r.interruptions?.length ?? 0) > 0 || (r.net?.popups ?? 0) > 0));
  const kb = mine('keyboard').at(-1);
  const pageTested = pageRuns.length > 0 && !!kb;
  const pageParts = pageTested && {
    lcp: 3 * logScore(lcp || Infinity, 1, 6),
    weight: 2 * logScore(mb, 0.5, 10),
    noAds: ads ? 0 : 1,
    noInterruptions: interrupted.length ? 0 : 1,
    cls: cls <= 0.1 ? 1 : cls <= 0.25 ? 0.5 : 0,
    inputNamed: kb.inputName ? 0.5 : 0,
    controlNamed: kb.controlName ? 0.5 : 0,
    keyboard: kb.keyboardFormat ? 1 : 0,
  };
  const pagePts = pageTested ? Object.values(pageParts).reduce((s, x) => s + x, 0) : null;

  const cats = a.blocked ? { data: null, speed: null, privacy: null, ease: null, page: null } : { data: dataPts, speed: speedPts, privacy: privacyPts, ease: easePts, page: pagePts };
  const complete = Object.values(cats).every((x) => x !== null);
  if (a.blocked) notes.push(`not ranked: ${a.blocked}`);
  else if (!complete) notes.push(`not ranked: ${Object.entries(cats).filter(([, v]) => v === null).map(([k]) => k).join(', ')} could not be measured`);
  const fractions = Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, v === null ? null : v / WEIGHTS.Default[k]]));
  const totals = complete ? Object.fromEntries(Object.entries(WEIGHTS).map(([name, w]) => [name, round(Object.entries(w).reduce((s, [k, wt]) => s + fractions[k] * wt, 0), 1)])) : null;
  return {
    id,
    name: a.name,
    url: a.url,
    publisher: !!a.publisher,
    blocked: a.blocked ?? null,
    total: totals?.Default ?? null,
    totals,
    categories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, round(v, 2)])),
    details: {
      data: Object.fromEntries(DATA_CASES.map((c, i) => [c.id, data[i]?.grade ?? null])),
      speedSeconds: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v === Infinity ? 'failed' : round(v, 3)])),
      freezeSeconds: Object.fromEntries(Object.entries(fr).map(([k, v]) => [k, v === Infinity ? 'failed' : round(v, 3)])),
      firefoxSeconds: Object.fromEntries(['100kb', '1mb', '10mb', '50mb'].map((s) => { const v = medianTime(id, 'firefox', s); return [s, v === Infinity ? 'failed' : round(v, 3)]; })),
      speedParts: speedParts && Object.fromEntries(Object.entries(speedParts).map(([k, v]) => [k, round(v)])),
      sendsJson: sends,
      uploadEvidence: uploadRuns.slice(0, 3).map((r) => ({ suite: r.suite, size: r.size, hits: r.uploads.slice(0, 2) })),
      thirdPartyDomains: third,
      offline: offline ? !!offline.ok : null,
      privacyParts: privacyParts && Object.fromEntries(Object.entries(privacyParts).map(([k, v]) => [k, round(v)])),
      errors: Object.fromEntries(ERROR_CASES.map((c, i) => [c.id, errs[i] ? { detected: !!errs[i].detected, rightLine: !!errs[i].rightLine, message: errs[i].message ?? null } : null])),
      features: featureList,
      easeParts,
      lcpSeconds: round(lcp, 2),
      pageMB: round(mb, 2),
      cls: round(cls, 3),
      ads,
      interruptions: [...new Set(interrupted.flatMap((r) => [...(r.interruptions ?? []), ...((r.net?.popups ?? 0) > 0 ? ['pop-up window'] : [])]))],
      keyboard: kb ? { inputName: kb.inputName, controlName: kb.controlName, keyboardFormat: kb.keyboardFormat, tabsToInput: kb.tabsToInput } : null,
      pageParts: pageParts && Object.fromEntries(Object.entries(pageParts).map(([k, v]) => [k, round(v)])),
    },
    notes,
  };
});

// Ranks: by total; tools within 1.0 point of the tool above share its rank.
function rank(list, key) {
  const ranked = list.filter((x) => x.totals).sort((a, b) => b.totals[key] - a.totals[key]);
  let shown = 0;
  ranked.forEach((x, i) => {
    if (i === 0 || ranked[i - 1].totals[key] - x.totals[key] > 1.0) shown = i + 1;
    x.ranks ??= {};
    x.ranks[key] = shown;
  });
}
for (const key of Object.keys(WEIGHTS)) rank(tools, key);
tools.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));

const pad = (s, n) => String(s ?? '—').padEnd(n);
console.log(`${pad('rank', 5)}${pad('tool', 46)}${pad('total', 7)}${pad('data', 7)}${pad('speed', 7)}${pad('privacy', 8)}${pad('ease', 7)}${pad('page', 6)} ranks under ${Object.keys(WEIGHTS).slice(1).join(' / ')}`);
for (const x of tools) {
  const c = x.categories;
  console.log(`${pad(x.ranks?.Default, 5)}${pad(x.name + (x.publisher ? ' (publisher)' : ''), 46)}${pad(x.total, 7)}${pad(c.data, 7)}${pad(c.speed, 7)}${pad(c.privacy, 8)}${pad(c.ease, 7)}${pad(c.page, 6)} ${x.ranks ? Object.keys(WEIGHTS).slice(1).map((k) => x.ranks[k]).join(' / ') : x.notes.join('; ')}`);
}
if (o.out) writeFileSync(o.out, JSON.stringify({ scoredAt: new Date().toISOString(), protocol: 'protocol.md section 6', weights: WEIGHTS, records: records.length, tools }, null, 1) + '\n');
