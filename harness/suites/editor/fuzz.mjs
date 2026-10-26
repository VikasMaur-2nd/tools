// Random edits on big documents, checked against the repo's own formatter (port of selftest/fuzz/fuzz.mjs).
//
// Every 6 edits: the model matches the predicted edit; drawn rows show the model at their offsets and follow each
// other; the Format output equals an independent format of the model (valid JSON) or the status shows the error;
// the status stats match. At the end: undo all restores the original, redo all restores the result, and a fresh
// load of the result shows the same output and status.
//
// The seeds and edit counts are the old jobs', so a failure reproduces: the same seed makes the same choices as
// long as the same rows are drawn (same document, 1280×800 window).
import { defaults, test } from '../../lib/api.mjs';
import { EXOTIC, SAFE } from '../../lib/fixtures.mjs';
import * as H from './_helpers.mjs';

defaults({ page: false, timeout: 300_000 });

// [document, mode, seed, edits, engines]: the old batch's jobs.
const JOBS = [
  ['deep', 'valid', 31, 18, ['chromium']],
  ['lines', 'chaos', 31, 18, ['chromium', 'firefox']],
  ['mid-mix', 'valid', 51, 24, ['webkit']],
  ['mix-3mb', 'chaos', 21, 18, ['chromium']],
  ['broken', 'chaos', 31, 18, ['webkit']],
  ['mix-3mb', 'valid', 7, 18, ['firefox']],
];

/** Inside-string map: 1 for a string's content character, 2 for one in an escape sequence. */
function strings(t) {
  const m = new Uint8Array(t.length);
  let inS = false;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (!inS) {
      if (c === 34) inS = true;
      continue;
    }
    if (c === 92) {
      const n = t[i + 1] === 'u' ? 6 : 2;
      for (let k = 0; k < n && i + k < t.length; k++) m[i + k] = 2;
      i += n - 1;
      continue;
    }
    if (c === 34) {
      inS = false;
      continue;
    }
    m[i] = 1;
  }
  return m;
}
const ascii = (c) => c >= 32 && c < 127;
/** Right-to-left text and bidi controls: near them, a character's left edge isn't its start (the test clicks elsewhere). */
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿‎‏‪-‮⁦-⁩؜]/;
const ltr = (t, o) => !RTL.test(t.slice(Math.max(0, o - 64), o + 64));
/** Visible model offsets where `ok(offset)` holds. */
function candidates(t, rs, ok) {
  const out = [];
  for (const row of rs) if (row.visible) for (let k = 0; k < row.text.length; k++) if (ok(row.o + k) && ltr(t, row.o + k)) out.push(row.o + k);
  return out;
}
const norm = (x) => x.replace(/·\s*/g, '').replace(/\s+/g, ' ').trim();

/** One frame after the last input (the status bar's caret follows selectionchange, which is async). */
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

async function fuzz(t, docName, mode, seed0, opsN) {
  const { parse, stringify } = H.json();
  const k = H.slow(t);
  const original = H.asLoaded(t.fixtureText(docName));
  const big = original.length > 2_000_000;
  let seed = seed0 >>> 0;
  let pointerSeed = (seed0 ^ 0x9e3779b9) >>> 0;
  const pointerRandom = () => ((pointerSeed = (Math.imul(pointerSeed, 1664525) + 1013904223) >>> 0), pointerSeed / 4294967296);
  const r = (n) => ((seed = (seed * 1103515245 + 12345) >>> 0), Math.floor((seed / 4294967296) * n));
  let curOp = 'setup';
  // WebKit clicks in the big-document editor land late on main (broken seed 31: 63 characters after the
  // pointer); PR #26's editor fixes make the same run pass (checked 2026-10-25 with --ref).
  const fail = (what, detail) => t.check(false, `[${curOp}] ${what}`, detail);
  const ok = (cond, what, detail) => t.check(cond, `[${curOp}] ${what}`, cond ? undefined : detail);

  const { page } = await H.isolatedPage(t, { width: 1280, height: 800 });
  const kb = page.keyboard;
  await t.app.open(page, t.base, '/');
  await t.app.openFile(page, docName);
  await t.app.waitParsed(page, { timeout: 60_000 * k });
  await H.focusEditor(page);
  if (original.length >= 250_000) ok(await H.waitSurface(page, { timeout: 15_000 * k }), 'big-document editor active');

  const model = () => H.model(page);
  const clip = (type, text = '') => page.evaluate(([a, b]) => window.__ed.clip(a, b), [type, text]);

  /** Clicks so the caret lands before (or after) the character at model offset `off`; true if the caret is there. */
  async function clickAt(text, off, after = false) {
    // A separate caret-placement gesture must not become the tail of a preceding double/triple click.
    // The editor counts nearby presses for 500 ms; wait for that actual pointer sequence to expire.
    await page.waitForFunction(([o, after]) => {
      const pt = window.__ed.point(o, after);
      const press = window.__edPress;
      return !pt || !press || Math.abs(pt.x - press.x) >= 5 || Math.abs(pt.y - press.y) >= 5 || performance.now() - press.at >= 500;
    }, [off, after], { timeout: t.budget(2000), polling: 25 });
    const pt = await page.evaluate(([o, a]) => window.__ed.point(o, a), [off, after]);
    if (!pt) return false;
    await page.mouse.click(pt.x, pt.y);
    await frame(page);
    const want = H.lineCol(text, after ? off + 1 : off);
    const got = await H.waitCursor(page, want, { timeout: 2000 * k });
    const landed = !!got && got[0] === want[0] && got[1] === want[1];
    if (!landed) fail('click lands on the character', { off, after, want, got, point: pt, layout: await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const ta = window.__ed.ta();
      const b = ta.getBoundingClientRect();
      return { measured: window.__edPoint, press: window.__edPress, fonts: document.fonts.status, hit: el?.tagName + '.' + el?.className, row: el?.closest('[data-o]')?.dataset.o, passage: [ta.selectionStart, ta.selectionEnd, ta.value.length], textarea: [b.left, b.top, b.width, b.height] };
    }, [pt.x, pt.y]) });
    return landed;
  }

  /** Selects model range [a, b): a click before a, then Shift+click before b. True if the selection is exactly it. */
  async function selectRange(text, a, b) {
    if (!(await clickAt(text, a))) return false;
    const pt = await page.evaluate((o) => window.__ed.point(o, false), b);
    if (!pt) return false;
    await kb.down('Shift');
    await page.mouse.click(pt.x, pt.y);
    await kb.up('Shift');
    const want = text.slice(a, b);
    const selected = await page.waitForFunction((text) => window.__ed.clip('copy') === text, want, { timeout: 2000 * k, polling: 25 }).then(() => true, () => false);
    const copied = selected ? want : await clip('copy');
    if (copied !== want) {
      fail('shift+click selects the range', { a, b, ...H.firstDiff(copied, want) });
      return false;
    }
    return true;
  }

  /** All the invariants for the current state; returns the model. */
  async function check(label, predicted) {
    let text;
    if (predicted !== null) {
      // (A big paste reaches the editor after its output is drawn: wait for it, up to 15 s.)
      const w = await H.waitModel(page, predicted, { timeout: 15_000 * k });
      text = w.ok ? predicted : await model();
      t.check(w.ok, `${label}: model matches the predicted edit`, w.ok ? undefined : H.firstDiff(text, predicted));
    } else text = await model();
    const rs = await H.stableRows(page, text);
    const wrong = rs.filter((row) => text.slice(row.o, row.o + row.text.length) !== row.text);
    t.check(!wrong.length, `${label}: drawn rows show the model`, wrong.slice(0, 2).map((row) => ({ o: row.o, row: JSON.stringify(row.text.slice(0, 60)), model: JSON.stringify(text.slice(row.o, row.o + 60)) })));
    const gaps = [];
    for (let i = 0; i + 1 < rs.length; i++) {
      const row = rs[i];
      const next = rs[i + 1];
      const end = row.o + row.text.length;
      if (!row.fold && next.o !== end && !(text[end] === '\n' && next.o === end + 1)) gaps.push({ o: row.o, len: row.text.length, next: next.o, at: JSON.stringify(text.slice(end, end + 3)) });
    }
    t.check(!gaps.length, `${label}: rows follow each other`, gaps.slice(0, 2));
    const ref = parse(text);
    if (H.strictOf(ref)) {
      const want = stringify(ref.root, '  ', false);
      const st = await page
        .waitForFunction(([n, d]) => {
          const s = window.__ed.left();
          const m = s.match(/([\d,]+) nodes? · depth (\d+)/);
          return /^Valid JSON/.test(s) && m && +m[1].replace(/,/g, '') === n && +m[2] === d && s;
        }, [ref.nodes, ref.depth], { timeout: 30_000 * k, polling: 25 })
        .then((h) => h.jsonValue(), () => null);
      const now = st ?? (await H.leftText(page));
      t.check(/^Valid JSON/.test(now), `${label}: status says valid`, now.slice(0, 120));
      const stats = H.statsOf(now);
      t.check(stats?.nodes === ref.nodes && stats?.depth === ref.depth, `${label}: status stats`, { status: stats, want: [ref.nodes, ref.depth] });
      // (A huge output can take a while to update: is it late, or stuck?)
      const out = await H.waitOutput(page, H.hashText(want), { timeout: (big || want.length > 10e6 ? 60_000 : 30_000) * k });
      if (out.ok && out.ms > 5000) t.log(`LATE [${curOp}] output caught up after ${(out.ms / 1000).toFixed(1)} s (output ${want.length} chars)`);
      if (!out.ok) {
        const got = (await H.outputText(page)) ?? '';
        fail(`${label}: Format output equals an independent format`, H.firstDiff(got, want, 30));
      } else t.check(true, `${label}: Format output equals an independent format`);
    } else {
      const st = await H.waitSettled(page, { quiet: 1000, timeout: 60_000 * k, empty: !text }).catch(() => H.leftText(page));
      if (ref.error) t.check(!/Valid JSON/.test(st), `${label}: invalid JSON not shown as valid`, ref.error);
    }
    const m = await H.edMode(page);
    const over = (await H.rows(page)).filter((x) => x.visible && x.over).length;
    t.check(!(over && m.wrap), `${label}: visible rows don't overflow while wrapping`, over);
    return text;
  }

  let text = await check('start', original);
  let predicted = text;
  const kinds =
    mode === 'valid'
      ? ['insert', 'insert', 'type', 'backspace', 'replace', 'paste', 'enter', 'undo', 'redo', 'nav', 'sel-type', 'sel-cutpaste', 'sel-move', 'rapid', 'rapid-keys', 'selcombo-cutpaste']
      : ['insert', 'type', 'backspace', 'replace', 'paste', 'enter', 'undo', 'redo', 'nav', 'delete', 'wordback', 'cut', 'wrap', 'exotic', 'sel-type', 'sel-cutpaste', 'sel-move', 'sel-delete', 'rapid', 'rapid-keys', 'selcombo', 'selcombo-cutpaste', 'drag', 'dbl', 'triple'];
  const done = {};
  for (let op = 0; op < opsN; op++) {
    const kind = kinds[r(kinds.length)];
    done[kind] = (done[kind] || 0) + 1;
    curOp = `op ${op} ${kind}`;
    // (Undo before any edit would undo opening the file, which the end checks can't restore past.)
    if (kind === 'undo' && op === 0) continue;
    // Positions are chosen in the current text: fetch it after edits the test can't predict.
    if (predicted === null) predicted = text = await model();
    else text = predicted;
    const t0 = text;
    const rs = await H.stableRows(page, t0);
    const m = strings(t0);
    const inner = (o) => o > 0 && m[o] === 1 && m[o - 1] === 1 && ascii(t0.charCodeAt(o)) && ascii(t0.charCodeAt(o - 1));
    const snippet = () => (mode === 'valid' ? SAFE : EXOTIC)[r(mode === 'valid' ? SAFE.length : EXOTIC.length)];
    try {
      if (kind === 'insert' || kind === 'exotic' || kind === 'paste' || kind === 'type') {
        const c = candidates(t0, rs, mode === 'valid' ? inner : (o) => ascii(t0.charCodeAt(o)) && (o === 0 || ascii(t0.charCodeAt(o - 1))));
        if (!c.length) continue;
        const at = c[r(c.length)];
        if (!(await clickAt(t0, at))) {
          predicted = null;
          continue;
        }
        const ins = kind === 'type' ? 'abc xyz'.slice(0, 1 + r(7)) : kind === 'paste' ? Array.from({ length: 1 + r(3) }, snippet).join('') : snippet();
        if (kind === 'type') await kb.type(ins);
        else if (kind === 'paste') await clip('paste', ins);
        else await kb.insertText(ins);
        if (predicted !== null) predicted = predicted.slice(0, at) + ins + predicted.slice(at);
      } else if (kind === 'backspace') {
        const n = 1 + r(3);
        const c = candidates(t0, rs, (o) => {
          for (let j = 0; j <= n; j++) if (!inner(o - j)) return false;
          return true;
        });
        if (!c.length) continue;
        const at = c[r(c.length)];
        if (!(await clickAt(t0, at))) {
          predicted = null;
          continue;
        }
        for (let j = 0; j < n; j++) await kb.press('Backspace');
        if (predicted !== null) predicted = predicted.slice(0, at - n) + predicted.slice(at);
      } else if (kind === 'replace') {
        const n = 1 + r(4);
        const c = candidates(t0, rs, (o) => {
          for (let j = 0; j <= n; j++) if (!inner(o + j)) return false;
          return true;
        });
        if (!c.length) continue;
        const at = c[r(c.length)];
        if (!(await clickAt(t0, at))) {
          predicted = null;
          continue;
        }
        for (let j = 0; j < n; j++) await kb.press('Shift+ArrowRight');
        const ins = snippet();
        await kb.insertText(ins);
        if (predicted !== null) predicted = predicted.slice(0, at) + ins + predicted.slice(at + n);
      } else if (kind === 'enter') {
        // Between values (after a comma outside strings): stays valid JSON.
        const c = candidates(t0, rs, (o) => t0[o] === ',' && m[o] === 0);
        if (!c.length) continue;
        if (!(await clickAt(t0, c[r(c.length)], true))) {
          predicted = null;
          continue;
        }
        await kb.press('Enter');
        predicted = null;
      } else if (kind.startsWith('sel-')) {
        // A known range [a, b): both ends visible, ASCII on both sides (no cluster is split); valid mode keeps it inside one string.
        const okAt = mode === 'valid' ? inner : (o) => o > 0 && ascii(t0.charCodeAt(o)) && ascii(t0.charCodeAt(o - 1));
        const c = candidates(t0, rs, okAt);
        if (c.length < 2) continue;
        let a = c[r(c.length)];
        let b = c[r(c.length)];
        if (a > b) [a, b] = [b, a];
        if (a === b) continue;
        if (mode === 'valid') {
          let same = true;
          for (let i = a; i < b; i++)
            if (m[i] === 0) {
              same = false;
              break;
            }
          if (!same) continue;
        }
        if (!(await selectRange(t0, a, b))) {
          predicted = null;
          continue;
        }
        const piece = t0.slice(a, b);
        if (kind === 'sel-type') {
          const ins = snippet();
          await kb.insertText(ins);
          predicted = t0.slice(0, a) + ins + t0.slice(b);
        } else if (kind === 'sel-delete') {
          await kb.press(r(2) ? 'Backspace' : 'Delete');
          predicted = t0.slice(0, a) + t0.slice(b);
        } else if (kind === 'sel-cutpaste') {
          const cut = await clip('cut');
          ok(cut === piece, 'cut puts the selection on the clipboard', { a, b, got: cut.length, want: piece.length });
          const w = await H.waitModel(page, t0.slice(0, a) + t0.slice(b), { timeout: 5000 * k });
          const mid = w.ok ? t0.slice(0, a) + t0.slice(b) : await model();
          ok(w.ok, 'cut removes the selection', { a, b, len: [mid.length, t0.length - piece.length] });
          await H.stableRows(page, mid);
          await clickAt(mid, a);
          await clip('paste', cut);
          predicted = t0;
        } else if (kind === 'sel-move') {
          // Copy, paste somewhere else (before the range: its offsets stand).
          const copy = await clip('copy');
          const before = candidates(t0, rs, (o) => okAt(o) && o <= a);
          if (!before.length) {
            await kb.press('ArrowLeft');
            predicted = t0;
            continue;
          }
          const at = before[r(before.length)];
          if (!(await clickAt(t0, at))) {
            predicted = null;
            continue;
          }
          await clip('paste', copy);
          predicted = t0.slice(0, at) + copy + t0.slice(at);
        }
      } else if (kind === 'rapid' || kind === 'rapid-keys') {
        // Select all, cut, paste, over and over, as fast as possible: the document must come back unchanged.
        const n = 2 + r(4);
        for (let j = 0; j < n; j++) {
          await kb.press('Control+a');
          if (kind === 'rapid') {
            const cut = await clip('cut');
            await clip('paste', cut);
          } else {
            await kb.press('Control+x');
            await kb.press('Control+v');
          }
        }
        predicted = kind === 'rapid' ? t0 : null;
        if (kind === 'rapid-keys') {
          // Real shortcuts go through the browser's clipboard (this test's own browser): check the document came back.
          const w = await H.waitModel(page, t0, { timeout: 15_000 * k });
          const back = w.ok ? t0 : await model();
          if (!w.ok) {
            const d = H.firstDiff(back, t0);
            fail('select all, Ctrl+X, Ctrl+V (repeated) gives the document back', { len: d.len, at: d.at, got: [...back.slice(d.at, d.at + 6)].map((ch) => ch.codePointAt(0).toString(16)), want: [...t0.slice(d.at, d.at + 6)].map((ch) => ch.codePointAt(0).toString(16)) });
          } else t.check(true, `[${curOp}] select all, Ctrl+X, Ctrl+V (repeated) gives the document back`);
          predicted = back;
        }
      } else if (kind === 'selcombo' || kind === 'selcombo-cutpaste') {
        // Keyboard selections of every kind, then an action over them.
        const c = candidates(t0, rs, (o) => ascii(t0.charCodeAt(o)) && (o === 0 || ascii(t0.charCodeAt(o - 1))));
        if (!c.length) continue;
        if (!(await clickAt(t0, c[r(c.length)]))) {
          predicted = null;
          continue;
        }
        const how = ['Shift+ArrowRight', 'Shift+ArrowLeft', 'Shift+Control+ArrowRight', 'Shift+Control+ArrowLeft', 'Shift+End', 'Shift+Home', 'Shift+PageDown', 'Shift+ArrowDown', 'Shift+ArrowUp'];
        for (let j = 0, n = 1 + r(5); j < n; j++) await kb.press(how[r(how.length)]);
        if (kind === 'selcombo-cutpaste') {
          // Cut and paste back in place: unchanged.
          const cut = await clip('cut');
          await clip('paste', cut);
          predicted = t0;
        } else {
          const act = r(5);
          if (act === 0) await kb.insertText(snippet());
          else if (act === 1) await kb.press('Backspace');
          else if (act === 2) await clip('cut');
          else if (act === 3) await clip('paste', snippet() + snippet());
          else await kb.type('Q');
          predicted = null;
        }
      } else if (kind === 'drag' || kind === 'dbl' || kind === 'triple') {
        const vis = rs.filter((x) => x.visible && x.text.length > 3);
        if (!vis.length) continue;
        const pick = async () =>
          page.evaluate(([o, fraction]) => {
            const row = [...document.querySelectorAll('.ed-hl [data-o]')].find((x) => +x.dataset.o === o);
            const b = row?.getBoundingClientRect();
            return b ? { x: b.left + 5 + fraction * Math.max(1, b.width - 10), y: b.top + b.height / 2 } : null;
          }, [vis[r(vis.length)].o, pointerRandom()]);
        const p1 = await pick();
        if (!p1) continue;
        if (kind === 'drag') {
          const p2 = await pick();
          if (!p2) continue;
          await page.mouse.move(p1.x, p1.y);
          await page.mouse.down();
          await page.mouse.move(p2.x, p2.y, { steps: 6 });
          await page.mouse.up();
        } else await page.mouse.click(p1.x, p1.y, { clickCount: kind === 'dbl' ? 2 : 3 });
        await frame(page);
        const act = r(4);
        if (act === 0) await kb.insertText(snippet());
        else if (act === 1) {
          const cut = await clip('cut');
          await clip('paste', cut);
        } else if (act === 2) await kb.press('Delete');
        // (act 3: just the selection, checked by the next action.)
        predicted = act === 1 || act === 3 ? predicted : null;
      } else if (kind === 'undo') {
        await kb.press('Control+z');
        predicted = null;
      } else if (kind === 'redo') {
        await kb.press('Control+Shift+z');
        predicted = null;
      } else if (kind === 'nav') await kb.press(['PageDown', 'PageUp', 'Control+End', 'Control+Home', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'Shift+ArrowDown'][r(9)]);
      else if (kind === 'delete') {
        await kb.press('Delete');
        predicted = null;
      } else if (kind === 'wordback') {
        await kb.press('Control+Backspace');
        predicted = null;
      } else if (kind === 'wrap') await kb.press('Alt+z');
      else if (kind === 'cut') {
        for (let j = 0, n = 1 + r(20); j < n; j++) await kb.press('Shift+ArrowRight');
        // A bare cut event (no browser default action after it), as the old check sent it.
        await page.evaluate(() => {
          const d = new DataTransfer();
          const ce = new ClipboardEvent('cut', { bubbles: true, cancelable: true });
          Object.defineProperty(ce, 'clipboardData', { value: d });
          window.__ed.ta().dispatchEvent(ce);
        });
        predicted = null;
      }
    } catch (e) {
      fail(`op ${op} ${kind} threw`, String(e).slice(0, 300));
      predicted = null;
    }
    await frame(page);
    if (op % 6 === 5 || op === opsN - 1) {
      text = await check(`after op ${op} (${kind})`, predicted);
      predicted = text;
    }
  }
  t.log('edits', JSON.stringify(done));

  curOp = 'end';
  const final = text;
  // Undo everything, one step at a time, to the original (opening the file is an undoable step too: stop there).
  const origH = H.hashText(original);
  let undos = 0;
  let back = await H.modelHash(page);
  while (back !== origH && undos < opsN * 4) {
    await kb.press('Control+z');
    undos++;
    back = await H.modelHash(page);
  }
  t.log(`undos ${undos}`);
  // (The history keeps at most 60M characters: whole-document cuts and pastes of a big one can pass that.)
  const capped = original.length * 2 * ((done.rapid || 0) * 4 + (done['rapid-keys'] || 0) * 4 + 2) > 60_000_000;
  if (!capped) {
    if (back !== origH) fail('undo all restores the original', { ...H.firstDiff(await model(), original), undos });
    else t.check(true, 'undo all restores the original');
  }
  for (let j = 0; j < undos; j++) await kb.press('Control+Shift+z');
  const redo = await H.waitModel(page, final, { timeout: 15_000 * k });
  ok(redo.ok, 'redo all restores the result', redo.ok ? undefined : H.firstDiff(await model(), final));

  const fref = parse(final);
  const fstrict = H.strictOf(fref);
  const fwant = fstrict ? H.hashText(stringify(fref.root, '  ', false)) : null;
  let incOut = null;
  if (fstrict) {
    // (A huge output can still be on its way after the last redo.)
    const w = await H.waitOutput(page, fwant, { timeout: 40_000 * k });
    ok(w.ok, 'after undo all and redo all, the Format output equals an independent format', { got: w.got, want: fwant });
    incOut = w.got;
  }
  const incStatus = await H.waitSettled(page, { quiet: 1000, timeout: 60_000 * k, empty: !final }).catch(() => H.leftText(page));

  // A fresh load of the result.
  await H.withTmp(async (tmp) => {
    const f = await t.newPage({ width: 1280, height: 800 });
    await H.installHelpers(f.page);
    await t.app.open(f.page, t.base, '/');
    await t.app.openFile(f.page, tmp(final, `final.${docName === 'lines' ? 'jsonl' : 'json'}`));
    if (final.length) await t.app.waitParsed(f.page, { timeout: 60_000 * k });
    let freshOut = null;
    if (fstrict) freshOut = (await H.waitOutput(f.page, fwant, { timeout: 40_000 * k })).got;
    const freshStatus = await H.waitSettled(f.page, { quiet: 1000, timeout: 60_000 * k, empty: !final }).catch(() => H.leftText(f.page));
    ok(norm(freshStatus) === norm(incStatus), 'fresh load shows the same status', { incremental: incStatus.slice(0, 160), fresh: freshStatus.slice(0, 160) });
    // (Broken JSON keeps the last good output on screen while it is fixed: a fresh load of it has none.)
    if (fstrict) ok(freshOut === incOut, 'fresh load shows the same output', { incremental: incOut, fresh: freshOut });
  });
}

const groups = new Map();
for (const [doc, mode, seed, ops, engines] of JOBS) {
  const key = `${doc} ${mode} ${seed} ${ops}`;
  if (groups.has(key)) groups.get(key).engines.push(...engines);
  else groups.set(key, { doc, mode, seed, ops, engines: [...engines] });
}
for (const { doc, mode, seed, ops, engines } of groups.values()) {
  test(`fuzz ${doc}, ${mode} edits, seed ${seed} × ${ops}`, { engines, ...(doc === 'deep' ? { tags: ['slow'], slots: 'all' } : {}) }, (t) => fuzz(t, doc, mode, seed, ops));
}
