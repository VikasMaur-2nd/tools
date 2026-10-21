'use client';

import { useEffect, useId, useState } from 'react';
import { PRIVATE } from '@/lib/analytics';
import { TARGETS } from '@/lib/engine/targets';
import { MAX_LINK, linkHash, type LinkDoc } from '@/lib/link';
import type { View } from '@/lib/engine/store';

const SITE = 'https://tools.vikasmaur.com';
const BADGES = {
  view: { label: 'View in Tool Kumar', width: 158 },
  compare: { label: 'Compare in Tool Kumar', width: 180 },
} as const;
const VIEW_LABELS: [View, string][] = [
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

const badgeUrl = (kind: keyof typeof BADGES, white: boolean) => `${SITE}/badges/${kind}-in-tool-kumar${white ? '-dark' : ''}.svg`;
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function snippets(href: string, kind: keyof typeof BADGES, badge: Badge) {
  const { label, width } = BADGES[kind];
  const img = (white: boolean) => `<img src="${badgeUrl(kind, white)}" alt="${label}" width="${width}" height="28">`;
  const a = escapeAttr(href);
  const html =
    badge === 'auto'
      ? `<a href="${a}"><picture><source media="(prefers-color-scheme: dark)" srcset="${badgeUrl(kind, true)}">${img(false)}</picture></a>`
      : `<a href="${a}">${img(badge === 'white')}</a>`;
  const markdown = `[![${label}](${badgeUrl(kind, badge === 'white')})](${href})`;
  return { html, markdown };
}

/** One document's input: JSON text or a URL to fetch it from. */
function DocField({ label, kind, setKind, value, setValue }: { label: string; kind: Kind; setKind: (k: Kind) => void; value: string; setValue: (v: string) => void }) {
  const id = useId();
  return (
    <div className="lb-doc">
      <div className="lb-doc-head">
        <label htmlFor={id}>{label}</label>
        <div className="lb-seg" role="radiogroup" aria-label={`${label}: source`}>
          {(['json', 'url'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
              {k === 'json' ? 'JSON' : 'URL'}
            </button>
          ))}
        </div>
      </div>
      {kind === 'json' ? (
        <textarea id={id} className={PRIVATE} value={value} onChange={(e) => setValue(e.target.value)} rows={7} spellCheck={false} />
      ) : (
        <input id={id} className={PRIVATE} type="url" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://api.example.com/data.json" spellCheck={false} />
      )}
    </div>
  );
}

function Output({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <div className="lb-out">
      <div className="lb-doc-head">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className="lb-copy"
          disabled={!value}
          onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true), () => undefined)}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <textarea id={id} className={PRIVATE} readOnly value={value} rows={value.length > 300 ? 4 : 2} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

/**
 * Builds "View in Tool Kumar" and "Compare in Tool Kumar" links and buttons in
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
  const [href, setHref] = useState('');
  const [error, setError] = useState('');

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
          setError(url.length > MAX_LINK ? `This link is ${url.length.toLocaleString()} characters long. Chat apps and some browsers cut links this long: open big documents with toolkumar.js instead (see below).` : '');
        },
        () => live && setError('This browser cannot compress links. Try a current version of Chrome, Edge, Firefox or Safari.'),
      );
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [compare, kindA, kindB, a, b, urlA, urlB, view, to]);

  const kind = compare ? 'compare' : 'view';
  const { html, markdown } = href ? snippets(href, kind, badge) : { html: '', markdown: '' };
  const { label, width } = BADGES[kind];

  return (
    <div className="link-builder">
      <div className="lb-seg lb-mode" role="radiogroup" aria-label="What the link opens">
        <button type="button" role="radio" aria-checked={!compare} onClick={() => setCompare(false)}>
          One document
        </button>
        <button type="button" role="radio" aria-checked={compare} onClick={() => setCompare(true)}>
          Compare two
        </button>
      </div>

      <div className={compare ? 'lb-docs lb-two' : 'lb-docs'}>
        <DocField label={compare ? 'Original' : 'Document'} kind={kindA} setKind={setKindA} value={kindA === 'json' ? a : urlA} setValue={kindA === 'json' ? setA : setUrlA} />
        {compare && <DocField label="Modified" kind={kindB} setKind={setKindB} value={kindB === 'json' ? b : urlB} setValue={kindB === 'json' ? setB : setUrlB} />}
      </div>

      <div className="lb-options">
        {!compare && (
          <label>
            Opens in
            <select value={view} onChange={(e) => setView(e.target.value as View)}>
              {VIEW_LABELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        {!compare && view === 'convert' && (
          <label>
            Convert to
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {TARGETS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Button
          <select value={badge} onChange={(e) => setBadge(e.target.value as Badge)}>
            <option value="auto">Follows light and dark mode</option>
            <option value="black">Black, for light pages</option>
            <option value="white">White, for dark pages</option>
          </select>
        </label>
      </div>

      <div className="lb-preview" aria-live="polite">
        {href ? (
          <a href={href} target="_blank" rel="noopener" className={PRIVATE}>
            <picture>
              {badge === 'auto' && <source media="(prefers-color-scheme: dark)" srcSet={`/badges/${kind}-in-tool-kumar-dark.svg`} />}
              <img src={`/badges/${kind}-in-tool-kumar${badge === 'white' ? '-dark' : ''}.svg`} alt={label} width={width} height={28} />
            </picture>
          </a>
        ) : (
          <span className="lb-empty">Your button appears here.</span>
        )}
        {error && <p className="lb-error">{error}</p>}
      </div>

      <Output label="Link" value={href} />
      <Output label="Markdown (README, docs, issues)" value={markdown} />
      <Output label="HTML" value={html} />
    </div>
  );
}
