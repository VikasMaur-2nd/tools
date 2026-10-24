'use client';

/*
 * Graph → Export image: file type, area, background, size and name, with a
 * size preview, suggestions when an export can't be made, Download and Copy
 * image. Code-split: it loads the first time the dialog opens.
 */
import { useEffect, useState } from 'react';
import { store, useUI } from '@/lib/engine/store';
import { act, getEngine } from '@/lib/engine/instance';
import { PRIVATE } from '@/lib/analytics';
import { useT } from '@/lib/i18n/react';
import type { ExportPreview, GraphExport } from '@/lib/graph/types';
import { exportOptions, loadExportPrefs, saveExportPrefs, type ExportPrefs } from '@/lib/graph/export-prefs';
import { radioKeys, tabStop } from '@/lib/radio';
import { Modal } from './dialogs';
import { Icon } from './icons';

/** Below this many image px per graph px, PNG and JPEG text gets hard to read. */
const SMALL_TEXT = 0.75;
const BACKGROUNDS = ['theme', 'white', 'transparent'] as const;

type Alternative = { label: string; patch: Partial<ExportPrefs> };

/**
 * Exports that would work where the chosen one can't (or would have tiny
 * text): checked with the same preview, so only options that fit are offered.
 */
function useAlternatives(opts: GraphExport, preview: ExportPreview | null, tiny: boolean): Alternative[] {
  // The alternatives found for a request (key): shown only while that request is current.
  const [found, setFound] = useState<{ key: string; alts: Alternative[] } | null>(null);
  const want = !!preview && (!!preview.error || tiny);
  const branch = !!preview?.branch;
  const key = `${JSON.stringify(opts)}|${tiny}|${branch}`;
  useEffect(() => {
    if (!want) return;
    const o = JSON.parse(key.split('|')[0]) as GraphExport;
    const raster = o.format !== 'svg';
    const options: (Alternative & { opts: GraphExport })[] = [];
    if (raster) options.push({ label: 'Use SVG', patch: { format: 'svg' }, opts: { ...o, format: 'svg' } });
    else options.push({ label: 'Use PNG', patch: { format: 'png' }, opts: { ...o, format: 'png' } });
    if (o.area !== 'branch' && branch) options.push({ label: 'Only the selected branch', patch: { area: 'branch' }, opts: { ...o, area: 'branch' } });
    if (o.area !== 'view') options.push({ label: 'Only the visible area', patch: { area: 'view' }, opts: { ...o, area: 'view' } });
    let live = true;
    void Promise.all(options.map((a) => getEngine()?.graphExportPreview(a.opts) ?? Promise.resolve(null))).then((results) => {
      if (!live) return;
      // Usable, and for small text, actually sharper (vector, or at least 100%).
      const alts = options.filter((a, i) => {
        const r = results[i];
        return r && !r.error && (!tiny || a.opts.format === 'svg' || r.scale >= 1);
      }).map(({ label, patch }) => ({ label, patch }));
      setFound({ key, alts });
    }, () => {});
    return () => {
      live = false;
    };
  }, [key, want, tiny, branch]);
  return want && found?.key === key ? found.alts : [];
}

/** A row of mutually exclusive choices (the toolbar's segmented look), with the keys of native radios (lib/radio.ts). */
function Choice<V extends string | number>({ label, value, options, onPick }: { label: string; value: V; options: { v: V; label: string; disabled?: boolean }[]; onPick: (v: V) => void }) {
  const t = useT();
  const stop = tabStop(options.map((o) => ({ checked: o.v === value, disabled: o.disabled })));
  return (
    <div className="gx-row">
      <span className="gx-label">{t(label)}</span>
      <div className="seg seg-sm" role="radiogroup" aria-label={t(label)} onKeyDown={(e) => radioKeys(e, (i) => onPick(options[i].v))}>
        {options.map((o, i) => (
          <button key={o.v} type="button" role="radio" aria-checked={value === o.v} tabIndex={i === stop ? 0 : -1} disabled={o.disabled} onClick={() => onPick(o.v)}>
            {t(o.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function GraphExportDialog() {
  const open = useUI((s) => s.graphExport);
  const t = useT();
  return (
    <Modal open={open} onClose={() => store.set({ graphExport: false })} className="sheet gx" label={t('Export image')}>
      <ExportForm />
    </Modal>
  );
}

function ExportForm() {
  const t = useT();
  const fileName = useUI((s) => s.fileName);
  const [p, setP] = useState<ExportPrefs>(loadExportPrefs);
  const [name, setName] = useState(() => (fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '') || 'graph');
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const set = (patch: Partial<ExportPrefs>) => setP((old) => ({ ...old, ...patch }));
  // JPEG has no transparency: it falls back to the theme's colour.
  const bg = p.format === 'jpeg' && p.bg === 'transparent' ? 'theme' : p.bg;
  // (A custom colour is its own field, after the group.)
  const bgStop = tabStop(BACKGROUNDS.map((v) => ({ checked: bg === v, disabled: v === 'transparent' && p.format === 'jpeg' })));
  const opts: GraphExport = { ...exportOptions(p), area: p.area === 'branch' && preview && !preview.branch ? 'all' : p.area };
  const key = JSON.stringify(opts);
  useEffect(() => saveExportPrefs(p), [p]);
  useEffect(() => {
    let live = true;
    void getEngine()?.graphExportPreview(JSON.parse(key) as GraphExport).then((r) => live && setPreview(r), () => {});
    return () => {
      live = false;
    };
  }, [key]);
  // Text this small (vs the graph at 100%) is hard to read: worth suggesting something sharper.
  const tiny = !!preview && !preview.error && p.format !== 'svg' && preview.scale < SMALL_TEXT;
  const alts = useAlternatives(opts, preview, tiny);
  const close = () => store.set({ graphExport: false });
  const ext = p.format === 'jpeg' ? 'jpg' : p.format;
  const download = () => {
    act((e) => e.downloadGraph(opts, name));
    close();
  };
  return (
    <form
      className="gx-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!preview?.error) download();
      }}
    >
      <header>
        <h2>
          <Icon name="download" size={18} /> {t('Export image')}
        </h2>
        <button type="button" className="btn icon" aria-label={t('Close')} onClick={close}>
          <Icon name="x" />
        </button>
      </header>
      <div className="gx-body">
        <Choice label="File type" value={p.format} onPick={(format) => set({ format })} options={[{ v: 'png', label: 'PNG' }, { v: 'jpeg', label: 'JPEG' }, { v: 'svg', label: 'SVG' }]} />
        <Choice
          label="Area"
          value={opts.area}
          onPick={(area) => set({ area })}
          options={[{ v: 'all', label: 'Whole graph' }, { v: 'view', label: 'Visible area' }, { v: 'branch', label: 'Selected branch', disabled: !preview?.branch }]}
        />
        <div className="gx-row">
          <span className="gx-label">{t('Background')}</span>
          <div className="seg seg-sm" role="radiogroup" aria-label={t('Background')} onKeyDown={(e) => radioKeys(e, (i) => set({ bg: BACKGROUNDS[i] }))}>
            {BACKGROUNDS.map((v, i) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={bg === v}
                tabIndex={i === bgStop ? 0 : -1}
                disabled={v === 'transparent' && p.format === 'jpeg'}
                onClick={() => set({ bg: v })}
              >
                {t(v === 'theme' ? 'Theme' : v === 'white' ? 'White' : 'Transparent')}
              </button>
            ))}
            <label className={`gx-color${bg === 'custom' ? ' on' : ''}`} data-tip={t('Any colour')}>
              <input type="color" value={p.color} aria-label={t('Any colour')} onChange={(e) => set({ bg: 'custom', color: e.target.value })} onClick={() => set({ bg: 'custom' })} />
            </label>
          </div>
        </div>
        <Choice label="Size" value={p.scale} onPick={(scale) => set({ scale })} options={[1, 2, 3].map((v) => ({ v, label: `${v}×`, disabled: p.format === 'svg' }))} />
        <label className="gx-row">
          <span className="gx-label">{t('File name')}</span>
          <span className="gx-name">
            <input className={`mi-input ${PRIVATE}`} value={name} onChange={(e) => setName(e.target.value.replace(/[\\/:*?"<>|]/g, ''))} spellCheck={false} autoComplete="off" />
            <span className="muted">.{ext}</span>
          </span>
        </label>
        {/* The image's size and card count describe the document. */}
        <p className={`gx-info${preview?.error ? ' err' : ''} ${PRIVATE}`} aria-live="polite">
          {preview?.error
            ? preview.limit === 'cards'
              ? t('Too many cards for SVG: {n} (up to {max}).', { n: t.num(preview.cards), max: t.num(preview.maxCards ?? 0) })
              : preview.limit === 'size'
                ? t('Too large for an image: {width} × {height} px at 100%.', { width: t.num(preview.width), height: t.num(preview.height) })
                : t.msg(preview.error)
            : preview
              ? `${t('{width} × {height} px', { width: t.num(preview.width), height: t.num(preview.height) })}${t(' · ')}${t.n(preview.cards, '{n} card', '{n} cards')}${preview.reduced ? t(' · ') + t('reduced to fit') : ''}`
              : ''}
        </p>
        {(preview?.error || tiny) && (
          <div className="gx-help">
            <p>{t(preview?.error ? 'Try one of these instead:' : 'Text will be small at this size. For sharp text:')}</p>
            {alts.length > 0 && (
              <div className="gx-alts">
                {alts.map((a) => (
                  <button key={a.label} type="button" className="btn sm" onClick={() => set(a.patch)}>
                    {t(a.label)}
                  </button>
                ))}
              </div>
            )}
            <p className="muted">{t("Or collapse branches you don't need in the graph, then export again.")}</p>
          </div>
        )}
      </div>
      <footer className="gx-foot">
        <button type="button" className="btn" disabled={!!preview?.error} onClick={() => {
          act((e) => e.copyGraphImage(opts));
          close();
        }}>
          <Icon name="copy" size={15} /> {t('Copy image')}
        </button>
        <button type="submit" className="btn primary" disabled={!!preview?.error} autoFocus>
          <Icon name="download" size={15} /> {t('Download')}
        </button>
      </footer>
    </form>
  );
}
