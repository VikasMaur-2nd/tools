// Code that runs inside every tested page (added before the page's own scripts, top frame only). The same code
// runs on every site. It:
//   - notes the time of the paste key press (the start of the timed period),
//   - keeps a requestAnimationFrame loop to find the longest gap between painted frames (a frozen tab),
//   - records Largest Contentful Paint and layout shifts where the browser supports them,
//   - reads inputs and outputs of the common editor kinds without changing them.
//
// Editor kinds (an adapter names one with a CSS selector): 'ace', 'cm5' (CodeMirror 5), 'cm6' (CodeMirror 6),
// 'monaco', 'textarea' (any element with .value), 'text' (an element's textContent).
export const INPAGE = `(() => {
  if (window.top !== window || window.__fmt) return;
  const S = { pasteAt: null, clickAt: null, halt: false, frames: { armed: false, last: 0, maxGap: 0, from: 0 }, lcp: 0, cls: 0, shifts: [] };
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && S.pasteAt === null) S.pasteAt = e.timeStamp;
  }, true);
  // The format click: its timeStamp is when the click happened, even if a busy page handles it later.
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) addEventListener(type, (e) => {
    if (e.isTrusted && S.frames.armed && S.pasteAt !== null && S.clickAt === null) S.clickAt = e.timeStamp;
  }, true);
  const loop = (t) => {
    const f = S.frames;
    if (f.armed && f.last) f.maxGap = Math.max(f.maxGap, t - f.last);
    f.last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lcp = Math.max(S.lcp, e.renderTime || e.loadTime || e.startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  try {
    // Session windows as in web-vitals: shifts less than 1 s apart and within 5 s form one window; CLS is the worst.
    let win = 0, first = 0, prev = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        if (win && e.startTime - prev < 1000 && e.startTime - first < 5000) win += e.value;
        else { win = e.value; first = e.startTime; }
        prev = e.startTime;
        S.cls = Math.max(S.cls, win);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}

  const q = (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no element ' + sel);
    return el;
  };
  const ace = (sel) => { const el = q(sel); return el.env?.editor || window.ace?.edit(el); };
  const cm5 = (sel) => { const el = q(sel); return (el.CodeMirror || el.closest('.CodeMirror')?.CodeMirror || el.querySelector('.CodeMirror')?.CodeMirror); };
  const cm6 = (sel) => {
    const el = q(sel);
    const content = el.matches('.cm-content') ? el : el.querySelector('.cm-content');
    return content?.cmView?.view || content?.cmTile?.view || content?.cmView?.rootView?.view;
  };
  const monaco = (sel) => {
    const el = q(sel);
    const eds = window.monaco?.editor?.getEditors?.() || [];
    const ed = eds.find((e) => el.contains(e.getDomNode()) || e.getDomNode()?.contains(el));
    if (ed) return ed.getModel();
    // A bundled Monaco has no global API: read the editor object React keeps for this element (read only).
    for (let x = el; x && x !== document.body; x = x.parentElement) {
      const key = Object.keys(x).find((k) => k.startsWith('__reactFiber$'));
      if (!key) continue;
      for (let f = x[key], i = 0; f && i < 60; f = f.return, i++) {
        for (let h = f.memoizedState, j = 0; h && typeof h === 'object' && j < 60; h = h.next, j++) {
          const v = h.memoizedState;
          for (const c of [v, v && v.current]) if (c && typeof c.getModel === 'function' && c.getModel()) return c.getModel();
        }
      }
      break;
    }
    return undefined;
  };
  // Every kind: value(), lines(), line(n) (1-based), markers() → 1-based lines marked as errors.
  const kinds = {
    ace: (sel) => { const e = ace(sel), s = e.session; return {
      value: () => e.getValue(), lines: () => s.getLength(), line: (n) => s.getLine(n - 1),
      markers: () => (s.getAnnotations() || []).filter((a) => a.type === 'error' || a.type === 'warning').map((a) => a.row + 1) }; },
    cm5: (sel) => { const e = cm5(sel); return {
      value: () => e.getValue(), lines: () => e.lineCount(), line: (n) => e.getLine(n - 1),
      markers: () => { const out = []; e.eachLine((h) => { const info = e.lineInfo(h); if (info.gutterMarkers?.['CodeMirror-lint-markers'] || /error/i.test(info.bgClass || '') || /error/i.test(info.textClass || '') || /error/i.test(info.wrapClass || '')) out.push(info.line + 1); }); return out; } }; },
    cm6: (sel) => { const v = cm6(sel), d = () => v.state.doc; return {
      value: () => d().toString(), lines: () => d().lines, line: (n) => d().line(n).text,
      markers: () => [...v.dom.querySelectorAll('.cm-content .cm-lintRange-error, .cm-content .cm-lintRange-warning')].map((m) => { try { return d().lineAt(v.posAtDOM(m)).number; } catch { return null; } }).filter(Boolean) }; },
    monaco: (sel) => { const m = monaco(sel); return {
      value: () => m.getValue(), lines: () => m.getLineCount(), line: (n) => m.getLineContent(n),
      markers: () => (window.monaco ? window.monaco.editor.getModelMarkers({ resource: m.uri }).filter((k) => k.severity >= 4).map((k) => k.startLineNumber) : []) }; },
    textarea: (sel) => { const el = q(sel); return {
      value: () => el.value, lines: () => { let n = 1, i = -1; const v = el.value; while ((i = v.indexOf('\\n', i + 1)) !== -1) n++; return n; },
      line: (n) => el.value.split('\\n')[n - 1], markers: () => [] }; },
    text: (sel) => { const el = q(sel); return {
      value: () => el.textContent, lines: () => el.textContent.split('\\n').length, line: (n) => el.textContent.split('\\n')[n - 1], markers: () => [] }; },
  };
  const io = (kind, sel) => {
    if (!kinds[kind]) throw new Error('unknown kind ' + kind);
    return kinds[kind](sel);
  };

  window.__fmt = {
    state: S,
    io,
    arm() { S.pasteAt = null; S.clickAt = null; S.halt = false; S.frames.armed = true; S.frames.maxGap = 0; S.frames.last = 0; S.frames.from = performance.now(); },
    // The last lines of a document, without building the whole text.
    tail(kind, sel, count) {
      const d = io(kind, sel), n = d.lines(), out = [];
      for (let k = Math.max(1, n - count + 1); k <= n; k++) out.push(d.line(k));
      return { lines: n, text: out.join('\\n') };
    },
    // Resolves with performance.now() at the first frame after check() is true, then one more frame painted.
    waitFor(check, timeoutMs) {
      return new Promise((resolve) => {
        const start = performance.now();
        const tick = () => {
          let ok = false, err = null;
          try { ok = check(); } catch (e) { err = String(e && e.message || e); }
          const now = performance.now();
          if (ok) return requestAnimationFrame(() => requestAnimationFrame(() => resolve({ done: true, at: performance.now(), checkedAt: now })));
          if (now - start > timeoutMs) return resolve({ done: false, at: now, error: err });
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
    disarm() { S.frames.armed = false; return { pasteAt: S.pasteAt, clickAt: S.clickAt, maxGap: S.frames.maxGap }; },
    // SHA-256 of the output minified again (JSON.parse + JSON.stringify): equals the speed file's hash when the
    // output holds exactly the same data. Run after the timed period.
    async verify(kind, sel) {
      let text;
      try { text = io(kind, sel).value(); } catch (e) { return { ok: false, why: 'could not read the output: ' + e.message }; }
      let min;
      try { min = JSON.stringify(JSON.parse(text)); } catch (e) { return { ok: false, why: 'output is not valid JSON', length: text.length }; }
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(min));
      return { ok: true, length: text.length, sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('') };
    },
    // A rough check that the input is not covered by something else (a dialog, a banner).
    covered(sel) {
      const el = document.querySelector(sel);
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return 'hidden';
      const x = Math.min(innerWidth - 2, Math.max(1, r.left + Math.min(r.width / 2, 200)));
      const y = Math.min(innerHeight - 2, Math.max(1, r.top + Math.min(r.height / 2, 120)));
      const top = document.elementFromPoint(x, y);
      if (!top || el.contains(top) || top.contains(el)) return null;
      const box = el.closest('[class*=editor], [class*=Editor], [id*=editor], [class*=input], [id*=input]') || el.parentElement;
      return box && box.contains(top) ? null : (top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''));
    },
  };
})();`;
