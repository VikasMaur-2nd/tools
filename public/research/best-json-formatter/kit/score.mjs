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
import { NOT_COUNTED, countsAsUpload } from './lib/harness.mjs';
import { DATA_CASES, ERROR_CASES } from './cases.mjs';

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, gaps: { type: 'boolean' } } });
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

// excluded.json (in the results folder, optional) lists outage windows: failed runs inside them are left out, each window with its reason and evidence:
// [{ "tool": "…", "from": ISO time, "to": ISO time, "reason": "…", "evidence": "…" }] (protocol amendment 3).
let excluded = [];
try {
  excluded = JSON.parse(readFileSync(join(dir, 'excluded.json'), 'utf8'));
} catch {}
const before = records.length;
for (let i = records.length - 1; i >= 0; i--) {
  const r = records[i];
  // Only failures inside an outage window are left out; a run that succeeded while the site was briefly up stands.
  const failed = r.ok === false || !!r.failure || r.untested || ['no output', 'untested'].includes(r.grade) || (r.docs ?? []).some((d) => d.failure);
  if (failed && excluded.some((x) => x.tool === r.tool && r.at >= x.from && r.at <= x.to)) records.splice(i, 1);
}
if (before !== records.length) console.error(`left out ${before - records.length} runs listed in excluded.json`);
// Oldest first, so "the last record" of anything is its latest attempt (a run repeated later replaces the earlier one).
records.sort((a, b) => a.at.localeCompare(b.at));
// corrections.json (optional): documented corrections of a harness misreading, each applied to the tool's latest
// record of that suite, with its reason and evidence (protocol amendment 5).
let corrections = [];
try {
  corrections = JSON.parse(readFileSync(join(dir, 'corrections.json'), 'utf8'));
} catch {}
for (const c of corrections) {
  const r = records.filter((x) => x.suite === c.suite && x.tool === c.tool).at(-1);
  if (r) Object.assign(r, c.set, { corrected: c.reason });
}
// Runs that say nothing about the tool (the site was down, the harness's clipboard step stalled), and the speed runs
// the size ladder skipped only because of them, count neither way (amendment 3).
const notCounted = [];
for (let i = 0; i < records.length; i++) {
  const r = records[i];
  if (!['speed', 'webkit', 'phone', 'offline', 'keyboard'].includes(r.suite) || r.ok !== false) continue;
  let drop = NOT_COUNTED.test(r.failure ?? '');
  const m = /failed twice at (\w+)/.exec(r.failure ?? '');
  if (r.skipped && m) {
    const stop = records.slice(0, i).filter((x) => x.suite === 'speed' && x.engine === r.engine && x.tool === r.tool && x.size === m[1] && x.ok === false && !x.skipped).at(-1);
    drop = !!stop && NOT_COUNTED.test(stop.failure ?? '');
  }
  if (drop) notCounted.push(i);
}
for (const i of notCounted.reverse()) records.splice(i, 1);
console.error(`not counted: ${notCounted.length} runs (site down, clipboard step, or skipped because of those)`);

export const logScore = (x, good, bad) => (x <= good ? 1 : x >= bad ? 0 : (Math.log(bad) - Math.log(x)) / (Math.log(bad) - Math.log(good)));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** One value per repetition: the last attempt of each (a retry replaces the failed first try); failures are Infinity. */
/** Runs where the site itself was down are not results about the tool (protocol amendment 3). */
const unavailable = (r) => /^site unavailable/.test(r.failure ?? '') || (r.docs ?? []).some((d) => /^site unavailable/.test(d.failure ?? ''));

function perRep(tool, engine, size, field = 'ms') {
  const rs = records.filter((r) => r.suite === 'speed' && r.engine === engine && r.tool === tool && r.size === size && r.ok !== null && !unavailable(r));
  // Each repetition's value is its latest attempt: a retry replaces a failed try, and a run repeated later (after an
  // outage or a run that could not start, amendment 3) replaces the earlier one.
  const byRep = new Map();
  for (const r of [...rs].sort((a, b) => a.at.localeCompare(b.at))) byRep.set(r.rep, r);
  return [...byRep.values()].map((r) => (r.ok ? r[field] / 1000 : Infinity));
}
const medianTime = (tool, engine, size, field) => {
  const v = perRep(tool, engine, size, field);
  return v.length ? median(v) : null;
};
const runCount = (tool, engine, size) => perRep(tool, engine, size).length;

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
  // A case that ended in a harness error (an exception in our code, recorded as `failure`) is unmeasured, not a tool
  // failure; a tool that showed nothing at all has no `failure` and keeps its "no output" grade (amendment 5).
  const harnessError = (r) => !r || r.grade === 'untested' || (r.docs ?? []).some((d) => d.failure);
  const data = DATA_CASES.map((c) => mine('data').filter((r) => r.case === c.id && r.engine === 'chromium' && !harnessError(r)).at(-1));
  const dataTested = data.every((r) => r);
  const dataPts = dataTested ? (25 * data.reduce((s, r) => s + (GRADE[r.grade] ?? 0), 0)) / DATA_CASES.length : null;

  // Speed (5.3), Chromium medians, failures infinitely slow
  const t = Object.fromEntries(['100kb', '1mb', '10mb', '50mb'].map((s) => [s, medianTime(id, 'chromium', s)]));
  const fr = Object.fromEntries(['1mb', '10mb'].map((s) => [s, medianTime(id, 'chromium', s, 'freezeMs')]));
  // A size with no counted run (every attempt was not counted, amendment 3) is not measured: the category is then
  // incomplete and the tool unranked, rather than scored as if it had failed.
  const speedTested = ['100kb', '1mb', '10mb', '50mb'].every((s) => t[s] !== null);
  const speedParts = speedTested && {
    '100kb': 5 * logScore(t['100kb'], 0.2, 3),
    '1mb': 5 * logScore(t['1mb'], 0.5, 5),
    '10mb': 5 * logScore(t['10mb'], 2, 120),
    '50mb': 5 * logScore(t['50mb'], 5, 120),
    freeze1mb: 2.5 * logScore(fr['1mb'] ?? Infinity, 0.1, 3),
    freeze10mb: 2.5 * logScore(fr['10mb'] ?? Infinity, 0.1, 3),
  };
  const speedPts = speedTested ? Object.values(speedParts).reduce((s, x) => s + x, 0) : null;

  // Privacy (5.4)
  const all = records.filter((r) => r.tool === id && Array.isArray(r.uploads));
  const uploadRuns = all.filter((r) => r.uploads.some(countsAsUpload));
  const sends = uploadRuns.length > 0;
  // A blocked tool has no successful runs: its one recorded visit still shows what the page sends and loads.
  const pageRuns = records.filter((r) => r.suite === 'speed' && r.engine === 'chromium' && r.tool === id && r.size === '1mb' && r.rep <= 3 && r.net && (r.ok || a.blocked));
  const third = median(pageRuns.map((r) => r.net.thirdPartyDomains.length));
  const offline = mine('offline').at(-1);
  const privacyTested = all.length > 0 && pageRuns.length > 0;
  const privacyParts = privacyTested && { staysLocal: sends ? 0 : 12, thirdParties: 5 * Math.max(0, 1 - Math.log(1 + third) / Math.log(31)), offline: offline?.ok ? 3 : 0 };
  const privacyPts = privacyTested ? Object.values(privacyParts).reduce((s, x) => s + x, 0) : null;

  // Ease of use (5.2, 5.6, 5.7, 5.9)
  const errs = ERROR_CASES.map((c) => mine('errors').filter((r) => r.case === c.id && !r.untested && !r.failure).at(-1));
  const errTested = errs.every((r) => r);
  const errorPts = errTested ? (10 * errs.reduce((s, r) => s + (r.detected ? 0.5 : 0) + (r.rightLine ? 0.5 : 0), 0)) / ERROR_CASES.length : null;
  const feats = mine('features').filter((r) => r.feature !== '*');
  const featureList = Object.fromEntries(feats.map((r) => [r.feature, r.found]));
  const featurePts = feats.length ? 0.5 * feats.filter((r) => r.found).length : null;
  // The latest run of each phone repetition (a repeated run replaces an earlier one).
  const phone = [...new Map(mine('phone').map((r) => [r.rep, r])).values()];
  const majority = (xs) => xs.filter(Boolean).length * 2 > xs.length;
  const phoneWorks = phone.length ? majority(phone.map((r) => r.ok)) : null;
  const phoneFits = phone.length ? majority(phone.map((r) => r.fits?.noSideScroll && r.fits?.controlInView)) : null;
  const ff = ['100kb', '1mb'].map((s) => medianTime(id, 'firefox', s));
  const firefoxWorks = ff.every((x) => x !== null) ? ff.every((x) => Number.isFinite(x)) : null;
  const wk = mine('webkit').at(-1);
  // WebKit works: the 100 KB file formats correctly and the two cases grade as they do in Chromium (amendment 1).
  const wkData = (c) => mine('webkit-data').filter((r) => r.case === c && !harnessError(r)).at(-1);
  const wkSame = ['big-integer', 'unicode'].every((c) => wkData(c)?.grade === data[DATA_CASES.findIndex((d) => d.id === c)]?.grade);
  const webkitWorks = wk ? Boolean(wk.ok && wkSame) : null;
  const easeParts = { errors: errorPts, features: featurePts, phoneWorks: phoneWorks === null ? null : +phoneWorks, phoneFits: phoneFits === null ? null : +phoneFits, firefox: firefoxWorks === null ? null : +firefoxWorks, webkit: webkitWorks === null ? null : +webkitWorks };
  const easeTested = Object.values(easeParts).every((x) => x !== null);
  const easePts = easeTested ? Object.values(easeParts).reduce((s, x) => s + x, 0) : null;

  // Page and accessibility (5.5, 5.8)
  const lcp = median(pageRuns.map((r) => r.lcpMs).filter((x) => x != null)) / 1000;
  const mb = median(pageRuns.map((r) => r.net.bytes)) / 1e6;
  const cls = median(pageRuns.map((r) => r.cls ?? 0));
  const ads = pageRuns.some((r) => r.net.adRequests > 0);
  // "input covered by …" is not used: the check misfired for inputs below the fold (amendment 5).
  const realInterruptions = (r) => (r.interruptions ?? []).filter((x) => !x.startsWith('input covered'));
  const interrupted = records.filter((r) => r.tool === id && (realInterruptions(r).length > 0 || (r.net?.popups ?? 0) > 0));
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
    // (A name that could not be read is listed in details.keyboard.nameErrors; it scores like a missing name.)
    keyboard: kb.keyboardFormat ? 1 : 0,
  };
  const pagePts = pageTested ? Object.values(pageParts).reduce((s, x) => s + x, 0) : null;

  // For a tool with parts that could not be measured: its total with every missing part at zero and at full marks
  // (amendment 5). Nothing is guessed; the true score lies in this range.
  const sizePts = { '100kb': [0.2, 3], '1mb': [0.5, 5], '10mb': [2, 120], '50mb': [5, 120] };
  const known = (v) => [v, v];
  const speedRange = Object.entries(sizePts).reduce(([lo, hi], [k, [g, b]]) => (t[k] === null ? [lo, hi + 5] : [lo + 5 * logScore(t[k], g, b), hi + 5 * logScore(t[k], g, b)]), [0, 0]);
  for (const k of ['1mb', '10mb']) {
    if (t[k] === null) speedRange[1] += 2.5;
    else {
      const v = 2.5 * logScore(fr[k] ?? Infinity, 0.1, 3);
      speedRange[0] += v;
      speedRange[1] += v;
    }
  }
  const easeMax = { errors: 10, features: 6, phoneWorks: 1, phoneFits: 1, firefox: 1, webkit: 1 };
  const easeRange = Object.entries(easeParts).reduce(([lo, hi], [k, v]) => (v === null ? [lo, hi + easeMax[k]] : [lo + v, hi + v]), [0, 0]);
  // Per case: measured cases keep their points, missing ones span zero to full marks.
  const perCase = (list, each, pts) => list.reduce(([lo, hi], r) => (r ? [lo + pts(r), hi + pts(r)] : [lo, hi + each]), [0, 0]);
  const dataRange = perCase(data, 25 / DATA_CASES.length, (r) => (25 * (GRADE[r.grade] ?? 0)) / DATA_CASES.length);
  if (easeParts.errors === null) {
    const er = perCase(errs, 10 / ERROR_CASES.length, (r) => (10 * ((r.detected ? 0.5 : 0) + (r.rightLine ? 0.5 : 0))) / ERROR_CASES.length);
    easeRange[0] += er[0];
    easeRange[1] += er[1] - easeMax.errors;
  }
  const ranges = {
    data: dataRange,
    speed: speedRange,
    privacy: privacyPts === null ? [0, 20] : known(privacyPts),
    ease: easeRange,
    page: pagePts === null ? [0, 10] : known(pagePts),
  };
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
    range: !complete && !a.blocked ? { min: round(Object.values(ranges).reduce((x, [lo]) => x + lo, 0), 1), max: round(Object.values(ranges).reduce((x, [, hi]) => x + hi, 0), 1), missing: Object.entries(cats).filter(([, v]) => v === null).map(([k]) => k) } : null,
    details: {
      data: Object.fromEntries(DATA_CASES.map((c, i) => [c.id, data[i]?.grade ?? null])),
      speedSeconds: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v === Infinity ? 'failed' : round(v, 3)])),
      freezeSeconds: Object.fromEntries(Object.entries(fr).map(([k, v]) => [k, v === Infinity ? 'failed' : round(v, 3)])),
      speedRuns: Object.fromEntries(['100kb', '1mb', '10mb', '50mb'].map((s) => [s, runCount(id, 'chromium', s)])),
      // Firefox: only 100 KB and 1 MB are reported (protocol amendment 2).
      firefoxSeconds: Object.fromEntries(['100kb', '1mb'].map((s) => { const v = medianTime(id, 'firefox', s); return [s, v === Infinity ? 'failed' : round(v, 3)]; })),
      speedParts: speedParts && Object.fromEntries(Object.entries(speedParts).map(([k, v]) => [k, round(v)])),
      sendsJson: sends,
      uploadEvidence: uploadRuns.slice(0, 3).map((r) => ({ suite: r.suite, size: r.size, hits: r.uploads.filter(countsAsUpload).slice(0, 2) })),
      notCounted: all.flatMap((r) => r.uploads.filter((h) => !countsAsUpload(h)).map((h) => ({ suite: r.suite, size: r.size, url: h.url.slice(0, 80), why: h.why }))).slice(0, 5),
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
      interruptions: [...new Set(interrupted.flatMap((r) => [...realInterruptions(r), ...((r.net?.popups ?? 0) > 0 ? ['pop-up window'] : [])]))],
      keyboard: kb ? { inputName: kb.inputName, controlName: kb.controlName, keyboardFormat: kb.keyboardFormat, tabsToInput: kb.tabsToInput, nameErrors: kb.nameErrors ?? [] } : null,
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
// Where an unranked tool would place at the low and the high end of its range (default weights).
for (const x of tools.filter((t) => t.range)) {
  const totals = tools.filter((t) => t.totals).map((t) => t.totals.Default);
  x.range.rankBest = totals.filter((v) => v > x.range.max).length + 1;
  x.range.rankWorst = totals.filter((v) => v >= x.range.min).length + 1;
}
tools.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));

// --gaps: what is still missing, by the rules above: Chromium speed repetitions 1-5 without a counted run (as
// tool:size:rep for run.mjs --runs), and the checks of each part that could not be measured.
if (o.gaps) {
  const missing = [];
  for (const a of ADAPTERS.filter((x) => !x.blocked)) {
    for (const size of ['100kb', '1mb', '10mb', '50mb']) {
      for (let rep = 1; rep <= 5; rep++) {
        const has = records.some((r) => r.suite === 'speed' && r.engine === 'chromium' && r.tool === a.id && r.size === size && r.rep === rep && r.ok !== null);
        if (!has) missing.push(`${a.id}:${size}:${rep}`);
      }
    }
    const t = tools.find((x) => x.id === a.id);
    const parts = [...Object.entries(t.details.easeParts).filter(([, v]) => v === null).map(([k]) => `ease.${k}`), ...(t.categories.page === null ? ['page'] : []), ...(t.categories.data === null ? ['data'] : [])];
    if (parts.length) console.error(`${a.id}: missing ${parts.join(', ')}`);
  }
  console.error(`speed runs without a counted result: ${missing.length}`);
  console.log(missing.join(','));
  process.exit(0);
}

const pad = (s, n) => String(s ?? '—').padEnd(n);
console.log(`${pad('rank', 5)}${pad('tool', 46)}${pad('total', 7)}${pad('data', 7)}${pad('speed', 7)}${pad('privacy', 8)}${pad('ease', 7)}${pad('page', 6)} ranks under ${Object.keys(WEIGHTS).slice(1).join(' / ')}`);
for (const x of tools) {
  const c = x.categories;
  console.log(`${pad(x.ranks?.Default, 5)}${pad(x.name + (x.publisher ? ' (publisher)' : ''), 46)}${pad(x.total, 7)}${pad(c.data, 7)}${pad(c.speed, 7)}${pad(c.privacy, 8)}${pad(c.ease, 7)}${pad(c.page, 6)} ${x.ranks ? Object.keys(WEIGHTS).slice(1).map((k) => x.ranks[k]).join(' / ') : x.notes.join('; ')}${x.range ? ` · between ${x.range.min} and ${x.range.max} points, rank ${x.range.rankBest}–${x.range.rankWorst}` : ''}`);
}
if (o.out) writeFileSync(o.out, JSON.stringify({ scoredAt: new Date().toISOString(), protocol: 'protocol.md section 6', weights: WEIGHTS, records: records.length, excluded, corrections, tools }, null, 1) + '\n');
