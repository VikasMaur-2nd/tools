'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { PRIVATE } from '@/lib/analytics';
import type { Diagnostic, Editor } from '@/lib/engine/editor';
import { TARGETS } from '@/lib/engine/targets';
import { formatBytes } from '@/lib/json/format';
import { parser, type ParseResult } from '@/lib/json/parser';
import { linkHash, linkReach, type LinkDoc, type LinkRequest } from '@/lib/link';
import { partsHtml, snippetParts } from '@/lib/link-colors';
import type { View } from '@/lib/engine/store';
import MiniEditor from './MiniEditor';

const SITE = 'https://tools.vikasmaur.com';
const BADGES = {
  view: { label: 'View in Tool Kumar', width: 158 },
  compare: { label: 'Compare in Tool Kumar', width: 180 },
} as const;
const VIEWS: [View, string][] = [
  ['format', 'Format'],
  ['tree', 'Tree'],
  ['table', 'Table'],
  ['graph', 'Graph'],
  ['convert', 'Convert'],
];
const SAMPLE_A = '{\n  "id": 42,\n  "name": "Ada Lovelace",\n  "roles": ["author", "mathematician"],\n  "active": true\n}';
const SAMPLE_B = '{\n  "id": 42,\n  "name": "Ada King",\n  "roles": ["author", "mathematician", "translator"],\n  "active": true\n}';

type Kind = 'json' | 'url';

type Badge = 'auto' | 'black' | 'white';
type Format = 'markdown' | 'html' | 'link';

const badgeUrl = (kind: keyof typeof BADGES, white: boolean) => `${SITE}/badges/${kind}-in-tool-kumar${white ? '-dark' : ''}.svg`;
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function snippet(format: Format, href: string, kind: keyof typeof BADGES, badge: Badge) {
  if (format === 'link') return href;
  const { label, width } = BADGES[kind];
  if (format === 'markdown') return `[![${label}](${badgeUrl(kind, badge === 'white')})](${href})`;
  const img = (white: boolean) => `<img src="${badgeUrl(kind, white)}" alt="${label}" width="${width}" height="28">`;
  const a = escapeAttr(href);
  return badge === 'auto'
    ? `<a href="${a}"><picture><source media="(prefers-color-scheme: dark)" srcset="${badgeUrl(kind, true)}">${img(false)}</picture></a>`
    : `<a href="${a}">${img(badge === 'white')}</a>`;
}

/** Documents from this size are compressed in a worker (lib/link.worker.ts): on the page's thread it takes a second at 10 MB. */
const WORKER_TEXT = 500_000;

/**
 * Makes link fragments: small documents here, big ones in a worker (made when first needed).
 * The latest request wins: a new one stops the worker's previous one (its answer is null).
 */
function linkMaker() {
  let worker: Worker | null | undefined;
  const waiting = new Map<number, { r: LinkRequest; done: (hash: string | null) => void; fail: (e: unknown) => void }>();
  let seq = 0;
  const size = (d?: LinkDoc) => (d && 'text' in d ? d.text.length : 0);
  const stop = () => {
    worker?.terminate();
    worker = undefined;
    for (const job of waiting.values()) job.done(null);
    waiting.clear();
  };
  const start = (): Worker | null => {
    try {
      const w = new Worker(new URL('../lib/link.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; hash: string | null }>) => {
        const job = waiting.get(e.data.id);
        waiting.delete(e.data.id);
        if (e.data.hash === null) job?.fail(new Error('compression'));
        else job?.done(e.data.hash);
      };
      w.onerror = (e) => {
        // (It couldn't start or failed: this page's thread makes the link instead.)
        e.preventDefault();
        w.terminate();
        worker = null;
        for (const job of waiting.values()) linkHash(job.r).then(job.done, job.fail);
        waiting.clear();
      };
      return w;
    } catch {
      return null;
    }
  };
  return {
    make(r: LinkRequest): Promise<string | null> {
      if (size(r.a) + size(r.b) < WORKER_TEXT) return linkHash(r);
      if (waiting.size) stop();
      if (worker === undefined) worker = typeof Worker === 'undefined' ? null : start();
      if (!worker) return linkHash(r);
      const id = ++seq;
      const w = worker;
      return new Promise((done, fail) => {
        waiting.set(id, { r, done, fail });
        w.postMessage({ id, r });
      });
    },
    stop,
  };
}

/** A row of mutually exclusive buttons (radio group): arrow keys move the choice, like native radios. */
function Seg<T extends string>({ label, value, options, onChange, className }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; className?: string }) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = (options.findIndex(([v]) => v === value) + step + options.length) % options.length;
    onChange(options[i][0]);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className={`lb-seg${className ? ' ' + className : ''}`} role="radiogroup" aria-label={label} onKeyDown={move}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} tabIndex={value === v ? 0 : -1} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** What checking a document found: how far it got, valid (with issues the viewer fixes), or an error. */
type Check = { kind: 'checking'; percent: number } | { kind: 'valid'; fixed: number; first: number } | { kind: 'error'; p: number; m: string; line: number; col: number };

const NONE: Diagnostic[] = [];

/** Line and column (1-based) of offset `p`. */
function lineCol(text: string, p: number) {
  let line = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < p; i = text.indexOf('\n', i + 1)) line++;
  return { line, col: p - text.lastIndexOf('\n', p - 1) };
}

/** Marks for the editor, as the viewer makes them (lib/engine/engine.ts analyze). */
function marks(res: ParseResult): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (let i = 0; i < res.issues.length && i < 300; i++) out.push({ p: res.issues[i].p, cls: 'me' });
  if (res.error) out.push({ p: res.error.p, cls: 'me' });
  for (let i = 0; i < res.warnings.length && i < 300; i++) out.push({ p: res.warnings[i].p, cls: 'mw' });
  return out;
}

/**
 * JSON in the viewer's editor, checked as the viewer will read it. A big document is read
 * and checked when typing pauses, in steps (the page keeps responding).
 */
function JsonField({ id, value, setValue }: { id: string; value: string; setValue: (v: string) => void }) {
  // The last check's result (kept while the next one runs: no flicker as you type).
  const [found, setFound] = useState<{ check: Check | null; diags: Diagnostic[] }>({ check: null, diags: NONE });
  const ed = useRef<Editor | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // (Reading a big edited document builds its text: wait for a pause.)
  const changed = (e: Editor) => {
    window.clearTimeout(timer.current);
    const n = e.length;
    timer.current = window.setTimeout(() => setValue(e.text), n < 100_000 ? 60 : n < 2_000_000 ? 250 : 600);
  };

  useEffect(() => {
    if (!value.trim()) return;
    let live = true;
    let t = 0;
    const p = parser(value);
    let shown = -1;
    const run = () => {
      if (!live) return;
      const res = p.step(performance.now() + 12);
      if (!res) {
        const percent = Math.floor((100 * p.at()) / value.length);
        if (percent !== shown) setFound((f) => ({ check: { kind: 'checking', percent: (shown = percent) }, diags: f.diags }));
        t = window.setTimeout(run, 0);
        return;
      }
      setFound({
        check: res.error ? { kind: 'error', p: res.error.p, m: res.error.m, ...lineCol(value, res.error.p) } : { kind: 'valid', fixed: res.issues.length, first: res.issues[0]?.p ?? 0 },
        diags: marks(res),
      });
    };
    run();
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [value]);

  const empty = !value.trim();
  const check = empty ? null : found.check;
  const go = (p: number) => {
    ed.current?.focus();
    ed.current?.select(p, p);
  };

  return (
    <>
      <MiniEditor
        id={id}
        defaultValue={value}
        diagnostics={empty ? NONE : found.diags}
        onChange={changed}
        onEditor={(e) => (ed.current = e)}
        className="lb-ed"
      />
      <p className="lb-check" aria-live="polite">
        {check?.kind === 'checking' && <span className="muted">Checking… {check.percent}%</span>}
        {check?.kind === 'valid' &&
          (check.fixed ? (
            <button type="button" className="lb-check-warn" onClick={() => go(check.first)}>
              Opens after Tool Kumar fixes {check.fixed === 1 ? '1 issue' : `${check.fixed} issues`} (show)
            </button>
          ) : (
            <span className="lb-check-ok">Valid JSON</span>
          ))}
        {check?.kind === 'error' && (
          <button type="button" className="lb-check-err" onClick={() => go(check.p)}>
            Ln {check.line}, Col {check.col}: {check.m}
          </button>
        )}
      </p>
    </>
  );
}

/** One document: JSON text or a URL to fetch it from. */
function DocField({ label, kind, setKind, value, setValue }: { label: string; kind: Kind; setKind: (k: Kind) => void; value: string; setValue: (v: string) => void }) {
  const id = useId();
  return (
    <div className="lb-field">
      <div className="lb-head">
        <label htmlFor={id}>{label}</label>
        <Seg label={`${label}: source`} value={kind} options={[['json', 'JSON'], ['url', 'URL']]} onChange={setKind} />
      </div>
      {kind === 'json' ? (
        <JsonField id={id} value={value} setValue={setValue} />
      ) : (
        <input id={id} className={PRIVATE} type="url" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://api.example.com/data.json" spellCheck={false} />
      )}
    </div>
  );
}

/**
 * Builds "View in Tool Kumar" and "Compare in Tool Kumar" buttons and links in
 * the browser, with the same code the viewer reads them with (lib/link.ts).
 */
export default function LinkBuilder() {
  const [compare, setCompare] = useState(false);
  const [kindA, setKindA] = useState<Kind>('json');
  const [kindB, setKindB] = useState<Kind>('json');
  const [a, setA] = useState(SAMPLE_A);
  const [b, setB] = useState(SAMPLE_B);
  const [urlA, setUrlA] = useState('');
  const [urlB, setUrlB] = useState('');
  const [view, setView] = useState<View>('tree');
  const [to, setTo] = useState('typescript');
  const [badge, setBadge] = useState<Badge>('auto');
  const [format, setFormat] = useState<Format>('markdown');
  const [href, setHref] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const viewId = useId();
  const toId = useId();
  const outId = useId();
  const [maker] = useState(linkMaker);
  useEffect(() => () => maker.stop(), [maker]);

  useEffect(() => {
    let live = true;
    const doc = (kind: Kind, v: string): LinkDoc | null => {
      if (kind === 'json') return v.trim() ? { text: v } : null;
      return /^https?:\/\/\S+$/i.test(v.trim()) ? { url: v.trim() } : null;
    };
    const da = doc(kindA, kindA === 'json' ? a : urlA);
    const db = compare ? doc(kindB, kindB === 'json' ? b : urlB) : undefined;
    const t = window.setTimeout(() => {
      if (!da || db === null) {
        setHref('');
        setError((da ? kindB : kindA) === 'url' ? 'Enter an http(s) URL.' : 'Paste a document.');
        return;
      }
      maker.make({ a: da, b: db, view: compare ? 'compare' : view, to }).then(
        (hash) => {
          if (!live || hash === null) return;
          const url = `${SITE}/${hash}`;
          setHref(url);
          setError('');
        },
        () => live && setError('This browser cannot compress links. Try a current Chrome, Edge, Firefox or Safari.'),
      );
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [maker, compare, kindA, kindB, a, b, urlA, urlB, view, to]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const kind = compare ? 'compare' : 'view';
  const { label, width } = BADGES[kind];
  const out = href ? snippet(format, href, kind, badge) : '';
  // The code box colours the link's parts (lib/link-colors.ts), as the code on the page does.
  const colors = useMemo(() => {
    const parts = snippetParts(out);
    return (text: string, a: number, b: number, at: number) => partsHtml(parts, text, a, b, at);
  }, [out]);

  return (
    <div className="link-builder">
      <div className="lb-input">
        <Seg
          label="What the link opens"
          className="lb-mode"
          value={compare ? 'compare' : 'one'}
          options={[['one', 'One document'], ['compare', 'Compare two']]}
          onChange={(v) => setCompare(v === 'compare')}
        />
        <DocField label={compare ? 'Original' : 'Document'} kind={kindA} setKind={setKindA} value={kindA === 'json' ? a : urlA} setValue={kindA === 'json' ? setA : setUrlA} />
        {compare ? (
          <DocField label="Modified" kind={kindB} setKind={setKindB} value={kindB === 'json' ? b : urlB} setValue={kindB === 'json' ? setB : setUrlB} />
        ) : (
          <div className="lb-row">
            <div className="lb-field">
              <label htmlFor={viewId}>Opens in</label>
              <select id={viewId} value={view} onChange={(e) => setView(e.target.value as View)}>
                {VIEWS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {view === 'convert' && (
              <div className="lb-field">
                <label htmlFor={toId}>Convert to</label>
                <select id={toId} value={to} onChange={(e) => setTo(e.target.value)}>
                  {TARGETS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="lb-result">
        <div className={`lb-preview lb-on-${badge}`} aria-live="polite">
          {href ? (
            <a href={href} target="_blank" rel="noopener" className={PRIVATE} aria-label={`${label} (opens the link in a new tab)`}>
              <picture>
                {badge === 'auto' && <source media="(prefers-color-scheme: dark)" srcSet={`/badges/${kind}-in-tool-kumar-dark.svg`} />}
                <img src={`/badges/${kind}-in-tool-kumar${badge === 'white' ? '-dark' : ''}.svg`} alt="" width={width} height={28} />
              </picture>
            </a>
          ) : (
            <span className="lb-empty">Your button appears here</span>
          )}
        </div>
        <div className="lb-inline">
          <span aria-hidden="true">Color</span>
          <Seg label="Button color" value={badge} options={[['auto', 'Auto'], ['black', 'Black'], ['white', 'White']]} onChange={setBadge} className="lb-small" />
        </div>
        {error && <p className="lb-error">{error}</p>}

        <div className="lb-out">
          <div className="lb-head">
            <Seg label="Code to copy" value={format} options={[['markdown', 'Markdown'], ['html', 'HTML'], ['link', 'Link']]} onChange={setFormat} />
            <button
              type="button"
              className="lb-copy"
              disabled={!out}
              onClick={() => navigator.clipboard.writeText(out).then(() => setCopied(true), () => undefined)}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <label htmlFor={outId} className="sr-only">
            {format === 'link' ? 'Link' : format === 'html' ? 'HTML' : 'Markdown'} to copy
          </label>
          <MiniEditor id={outId} value={out} readOnly wrap colors={colors} className="lb-ed lb-ed-out" />
          <p className="lb-hint">
            {format === 'markdown' ? 'For READMEs, docs and issues on GitHub or GitLab.' : format === 'html' ? 'For web pages. Auto follows the reader’s light or dark mode.' : 'For chats, emails and your own buttons.'}
          </p>
          {href && linkReach(href.length) === 'not-firefox' && (
            <p className="lb-warn" role="status">
              At {formatBytes(href.length)}, this link opens in Chrome, Edge and Safari, but not Firefox, which stops at about 1 MB.
            </p>
          )}
          {href && linkReach(href.length) === 'none' && (
            <p className="lb-error" role="status">
              At {formatBytes(href.length)}, no browser can open this link: they stop at about 2 MB. Link to where the JSON is hosted (choose URL
              above), or use the handoff below from your web app.
            </p>
          )}
          {href && (
            <p className="lb-hint">
              The link is {formatBytes(href.length)} long. Browsers open links up to roughly 1 MB (Firefox) to 2 MB (Chrome, Safari). Chat apps
              allow much less per message: there, link to where the JSON is hosted (choose URL above). From your own web app, the handoff below
              opens JSON of any size.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
