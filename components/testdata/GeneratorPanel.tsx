'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { FixtureSummary } from '@/lib/testdata/generate';
import type { GeneratorMessage } from '@/lib/testdata/protocol';
import { cacheTool } from './offline';
import { useReady } from './useReady';
import './panels.css';

type DiskWriter = { write: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> };
type SaveWindow = Window & { showSaveFilePicker: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<DiskWriter> }> };
const subscribe = () => () => {};
const diskAvailable = () => 'showSaveFilePicker' in window;
const serverDisk = () => false;
const PRESETS = [[100_000, '100 KB'], [1_000_000, '1 MB'], [10_000_000, '10 MB'], [50_000_000, '50 MB'], [100_000_000, '100 MB'], [200_000_000, '200 MB'], [400_000_000, '400 MB']] as const;
const number = (value: number) => value.toLocaleString('en-US');

export function GeneratorPanel() {
  const id = useId();
  const ready = useReady();
  const [size, setSize] = useState('1000000');
  const [custom, setCustom] = useState('500');
  const [unit, setUnit] = useState('1000000');
  const [pretty, setPretty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Choose a size, then generate a file.');
  const [percent, setPercent] = useState(0);
  const [result, setResult] = useState<(FixtureSummary & { match: string; disk: boolean; name: string }) | null>(null);
  const [url, setUrl] = useState('');
  const worker = useRef<Worker | null>(null);
  const writer = useRef<DiskWriter | null>(null);
  const run = useRef(0);
  const supportsDisk = useSyncExternalStore(subscribe, diskAvailable, serverDisk);

  useEffect(() => { const session = run; void cacheTool(); return () => { session.current++; worker.current?.terminate(); void writer.current?.abort().catch(() => {}); }; }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const cancel = () => {
    run.current++;
    worker.current?.terminate(); worker.current = null;
    void writer.current?.abort().catch(() => {}); writer.current = null;
    setBusy(false); setPercent(0); setStatus('Cancelled. You can generate another file.');
  };

  const generate = async (disk: boolean) => {
    const targetBytes = size === 'custom' ? Number(custom) * Number(unit) : Number(size);
    if (!Number.isSafeInteger(targetBytes) || targetBytes < 1000 || targetBytes > 1_000_000_000) {
      setStatus('Choose a whole byte size between 1 KB and 1 GB.'); return;
    }
    const token = ++run.current;
    const preset = PRESETS.find(([value]) => value === targetBytes);
    const label = preset ? preset[1].replace(' ', '').toLowerCase() : `${targetBytes}b`;
    const name = `bench-${label}${pretty ? '-pretty' : ''}.json`;
    setBusy(true); setResult(null); setUrl(''); setPercent(0); setStatus(disk ? 'Choose where to save the file.' : 'Starting generator…');
    const chunks: BlobPart[] = [];
    const fail = (message: string) => {
      if (run.current !== token) return;
      worker.current?.terminate(); worker.current = null;
      void writer.current?.abort().catch(() => {}); writer.current = null;
      chunks.length = 0;
      setBusy(false); setStatus(message); setPercent(0);
    };
    try {
      if (disk) {
        const handle = await (window as unknown as SaveWindow).showSaveFilePicker({ suggestedName: name, types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }] });
        if (run.current !== token) return;
        const stream = await handle.createWritable();
        if (run.current !== token) { await stream.abort(); return; }
        writer.current = stream;
      }
      if (run.current !== token) return;
      const current = new Worker(new URL('../../lib/testdata/generate.worker.ts', import.meta.url), { type: 'module' });
      worker.current = current;
      current.onerror = () => fail('The generator could not start. Reload while online, then try again.');
      current.onmessage = async ({ data }: MessageEvent<GeneratorMessage>) => {
        if (run.current !== token) return;
        try {
          if (data.type === 'progress') {
            const value = Math.round((data.progress.phase === 'counting' ? data.progress.fraction * 40 : 40 + data.progress.fraction * 60));
            setPercent(value); setStatus(`${data.progress.phase === 'counting' ? 'Counting records' : 'Writing and hashing'}… ${value}%`);
          } else if (data.type === 'chunk') {
            if (writer.current) await writer.current.write(data.chunk);
            else chunks.push(data.chunk);
            if (run.current === token) current.postMessage({ type: 'ack' });
          } else if (data.type === 'error') fail(data.message);
          else {
            if (data.match === 'mismatch') { fail('The file did not match the published fixture. Please try again.'); return; }
            if (writer.current) await writer.current.close();
            if (run.current !== token) return;
            writer.current = null;
            if (!disk) setUrl(URL.createObjectURL(new Blob(chunks, { type: 'application/json' })));
            chunks.length = 0;
            setResult({ ...data.summary, match: data.match, disk, name });
            setPercent(100); setStatus(disk ? 'File saved. SHA-256 verified below.' : 'File ready to download.'); setBusy(false);
            current.terminate(); worker.current = null;
            void cacheTool();
          }
        } catch (error) { fail(error instanceof Error ? error.message : 'Could not save the file.'); }
      };
      current.postMessage({ type: 'start', options: { targetBytes, pretty } });
    } catch (error) {
      fail(error instanceof DOMException && error.name === 'AbortError' ? 'Save cancelled. You can try again.' : error instanceof Error ? error.message : 'Generation failed.');
    }
  };

  return (
    <section className="testdata-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Create a test file</h2>
      <p className="testdata-note">Deterministic customer records, Unicode text and integers above JavaScript&apos;s safe limit. Everything runs on your device.</p>
      <form onSubmit={event => { event.preventDefault(); void generate(false); }}>
        <fieldset disabled={busy || !ready} className="testdata-fields">
          <legend className="sr-only">File options</legend>
          <label htmlFor={`${id}-size`}>Size of minified data
            <select id={`${id}-size`} value={size} onChange={event => setSize(event.target.value)} autoFocus>
              {PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="custom">Custom size</option>
            </select>
          </label>
          <label htmlFor={`${id}-format`}>File format
            <select id={`${id}-format`} value={pretty ? 'pretty' : 'minified'} onChange={event => setPretty(event.target.value === 'pretty')}>
              <option value="minified">Minified</option><option value="pretty">Prettified · 2 spaces</option>
            </select>
          </label>
          {size === 'custom' && <div className="testdata-custom">
            <label htmlFor={`${id}-custom`}>Custom size<input id={`${id}-custom`} type="number" min="0.001" step="any" required value={custom} onChange={event => setCustom(event.target.value)} /></label>
            <label htmlFor={`${id}-unit`}>Unit<select id={`${id}-unit`} value={unit} onChange={event => setUnit(event.target.value)}><option value="1000">KB</option><option value="1000000">MB</option><option value="1000000000">GB</option></select></label>
          </div>}
        </fieldset>
        <p className="testdata-note">1 KB = 1,000 bytes. 1 MB = 1,000,000 bytes. Whole records fill the target using the study&apos;s reserved space. Targets below the one-record minimum produce that minimum. Pretty files are larger because of whitespace.</p>
        <div className="testdata-actions">
          <button className="button" type="submit" disabled={busy || !ready}>Generate file</button>
          <button type="button" disabled={busy || !supportsDisk} title={supportsDisk ? undefined : 'Your browser does not support saving straight to disk.'} onClick={() => void generate(true)}>Generate straight to disk</button>
          {busy && <button type="button" onClick={cancel}>Cancel</button>}
        </div>
      </form>
      <div className="testdata-progress">
        <progress aria-label="File generation" max={100} value={percent} />
        <p role="status" aria-live="polite">{status}</p>
      </div>
      <div className="testdata-output">
        {result ? <>
          <dl className="testdata-stats"><div><dt>Bytes</dt><dd>{number(result.bytes)}</dd></div><div><dt>Records</dt><dd>{number(result.records)}</dd></div></dl>
          <p className="testdata-hash">SHA-256 <code>{result.sha256}</code></p>
          <p className={result.match === 'matched' ? 'testdata-match' : 'testdata-note'}>{result.match === 'matched' ? "Matches the study's published SHA-256, bytes and record count." : 'Custom size or format. The study has no published hash for this combination.'}</p>
          {url && <a className="button" href={url} download={result.name}>Download JSON</a>}
        </> : <p className="testdata-note">The byte count, record count and SHA-256 will appear here. For large files, save straight to disk when your browser offers it to keep memory use low.</p>}
      </div>
      <noscript>Enable JavaScript to generate a file locally.</noscript>
    </section>
  );
}
export default GeneratorPanel;
