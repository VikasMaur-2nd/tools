'use client';

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { PRIVATE } from '@/lib/analytics';
import { TARGETS } from '@/lib/engine/targets';
import { formatBytes } from '@/lib/json/format';
import { linkHash, linkReach, type LinkDoc } from '@/lib/link';
import type { View } from '@/lib/engine/store';

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
        <textarea id={id} className={PRIVATE} value={value} onChange={(e) => setValue(e.target.value)} rows={8} spellCheck={false} />
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
      linkHash({ a: da, b: db, view: compare ? 'compare' : view, to }).then(
        (hash) => {
          if (!live) return;
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
  }, [compare, kindA, kindB, a, b, urlA, urlB, view, to]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const kind = compare ? 'compare' : 'view';
  const { label, width } = BADGES[kind];
  const out = href ? snippet(format, href, kind, badge) : '';

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
          <textarea id={outId} className={PRIVATE} readOnly value={out} rows={5} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
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
