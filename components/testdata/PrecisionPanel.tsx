'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { FIDELITY, FIDELITY_MINIFIED } from '@/lib/testdata/reference';
import type { PrecisionResult } from '@/lib/testdata/precision';
import { cacheTool } from './offline';
import { useReady } from './useReady';
import './panels.css';

export function PrecisionPanel() {
  const id = useId();
  const ready = useReady();
  const [original, setOriginal] = useState(FIDELITY);
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState("Paste a tool's JSON output to compare it with the reference.");
  const [result, setResult] = useState<PrecisionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  useEffect(() => { void cacheTool(); return () => { worker.current?.terminate(); }; }, []);

  const invalidate = () => {
    generation.current++;
    worker.current?.terminate(); worker.current = null;
    setBusy(false); setResult(null);
    setStatus('Input changed. Check again to update the results.');
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setStatus('Reference copied. Paste it into the JSON tool you want to test.'); }
    catch { setStatus('Copy is unavailable. Select the reference text and copy it with your keyboard.'); }
  };
  const check = () => {
    worker.current?.terminate();
    const token = ++generation.current;
    setBusy(true); setResult(null); setStatus('Checking every number and object member…');
    try {
      const current = new Worker(new URL('../../lib/testdata/precision.worker.ts', import.meta.url), { type: 'module' });
      worker.current = current;
      const finish = (message: string) => { setStatus(message); setBusy(false); current.terminate(); worker.current = null; void cacheTool(); };
      current.onerror = () => { if (generation.current === token) finish('The checker could not start. Reload while online and try again.'); };
      current.onmessage = ({ data }: MessageEvent<{ result?: PrecisionResult; error?: string }>) => {
        if (generation.current !== token) return;
        if (!data.result) { finish(data.error ?? 'Could not compare these documents.'); return; }
        const value = data.result;
        setResult(value);
        const changed = value.differences.filter(d => d.kind !== 'same value, different spelling').length;
        const spellings = value.differences.length - changed;
        finish(!value.valid ? value.error! : value.differences.length === 0 ? `No differences. ${value.numbers} number literals checked; values, spellings and duplicate members are preserved.` : `${changed} value or structure differences. ${spellings} spelling-only differences. ${value.numbers} number literals compared.`);
      };
      current.postMessage({ original, output });
    } catch { setBusy(false); setStatus('The checker could not start. Reload while online and try again.'); }
  };
  return (
    <section className="testdata-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Check a tool&apos;s output</h2>
      <p className="testdata-note">Copy this 425-byte reference, format it in another tool, then paste its exported JSON below. All comparisons stay in your browser.</p>
      <div className="testdata-reference"><pre tabIndex={0} aria-label="Study reference JSON"><code>{FIDELITY}</code></pre></div>
      <div className="testdata-actions"><button type="button" disabled={!ready} onClick={() => void copy(FIDELITY)}>Copy reference</button><button type="button" disabled={!ready} onClick={() => void copy(FIDELITY_MINIFIED)}>Copy minified twin</button></div>
      <details className="testdata-details"><summary>What each reference case tests</summary>
        <dl className="testdata-cases">
          <dt>v_unsafe_odd</dt><dd>An odd integer, 9007199254756831, that JavaScript rounds upward.</dd>
          <dt>v_above_safe</dt><dd>9007199254740993, just above the safe integer limit.</dd>
          <dt>v_id19</dt><dd>A 19-digit identifier whose final digits must survive.</dd>
          <dt>v_negative</dt><dd>A negative integer below the safe range.</dd>
          <dt>v_long_decimal</dt><dd>A long decimal fraction that binary floating point shortens.</dd>
          <dt>v_money</dt><dd>A large monetary amount whose cents can be lost.</dd>
          <dt>v_overflow</dt><dd>1e400 is valid JSON. JavaScript converts it to Infinity, which JSON.stringify writes as null.</dd>
          <dt>v_duplicates</dt><dd>Two members named a. A normal JavaScript object keeps only the last one.</dd>
          <dt>r_one, r_one_half, r_exponent, r_exponent_upper, r_negative_zero</dt><dd>Spelling controls. 1.0 and 1, 1.50 and 1.5, 1e2 and 100, 1E+2 and 100, and -0 and 0 have the same decimal value for this comparison.</dd>
          <dt>r_unicode</dt><dd>The string é checks that text survives too.</dd>
        </dl>
      </details>
      <form onSubmit={event => { event.preventDefault(); if (ready && !busy) check(); }} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.requestSubmit(); } }}>
        <details className="testdata-details"><summary>Use your own original JSON</summary>
          <label htmlFor={`${id}-original`}>Original JSON</label><textarea disabled={!ready} id={`${id}-original`} value={original} onChange={event => { invalidate(); setOriginal(event.target.value); }} spellCheck={false} rows={12} />
        </details>
        <label htmlFor={`${id}-output`}>JSON produced by the tool</label><textarea disabled={!ready} id={`${id}-output`} value={output} onChange={event => { invalidate(); setOutput(event.target.value); }} placeholder="Paste the tool's exported JSON here…" spellCheck={false} rows={12} required />
        <p className="testdata-note">Press Ctrl+Enter or ⌘+Enter to check.</p>
        <div className="testdata-actions"><button className="button" type="submit" disabled={busy || !ready}>Check precision</button>{busy && <button type="button" onClick={() => { invalidate(); setStatus('Check cancelled. Your input is unchanged.'); }}>Cancel</button>}</div>
      </form>
      <div className="testdata-results" aria-busy={busy}>
        <p role="status" aria-live="polite">{status}</p>
        {result?.valid && result.differences.length > 0 && <>
          <p className="testdata-note">Paths identify each value. Repeated keys include a member number. When members disappear, preserved values are paired first, then the last unmatched members. Spelling-only differences preserve the decimal value.</p>
          <ol className="testdata-differences">{result.differences.slice(0, 200).map((difference, index) => <li key={index} className={difference.kind === 'same value, different spelling' ? 'testdata-spelling' : ''}>
            <strong>{difference.kind}</strong><code>{difference.path}</code>
            {difference.before !== undefined && <span>Original: <code>{difference.before}</code></span>}
            {difference.after !== undefined && <span>Output: <code>{difference.after}</code></span>}
          </li>)}</ol>
          {result.differences.length > 200 && <p>Showing the first 200 of {result.differences.length.toLocaleString('en-US')} differences. Use a smaller excerpt to inspect the rest.</p>}
        </>}
      </div>
      <noscript>Enable JavaScript to compare JSON locally.</noscript>
    </section>
  );
}
export default PrecisionPanel;
