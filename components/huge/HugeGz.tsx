'use client';

/*
 * A .gz file being decompressed (lib/huge/gz.ts): shown where the editor was, with how far it got and Cancel.
 * Small files then open in the editor, big ones in huge mode.
 */
import '@/app/huge.css';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { PRIVATE } from '@/lib/analytics';
import { useT } from '@/lib/i18n/react';
import type { GzState, GzStore } from '@/lib/huge/gz';

export default function HugeGz({ store, cancel }: { store: GzStore; cancel: () => void }) {
  const s: GzState = useSyncExternalStore(store.subscribe, store.get, store.get);
  const t = useT();
  useLayoutEffect(() => {
    document.documentElement.dataset.huge = '';
    return () => {
      delete document.documentElement.dataset.huge;
    };
  }, []);
  const pct = s.size ? Math.min(100, (s.read / s.size) * 100) : 0;
  return (
    <section className="pane hg" aria-label={t('Decompressing')}>
      <div className="hz" role="status" aria-live="polite">
        <i className="spin" />
        <b className={PRIVATE}>{t('Decompressing {name}', { name: s.name })}</b>
        <div className="hg-bar" role="progressbar" aria-label={t('Decompressing')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className={PRIVATE}>
          {t('{done} of {size} read', { done: t.bytes(s.read), size: t.bytes(s.size) })}
          {' · '}
          {t('{out} decompressed', { out: t.bytes(s.out) })}
          {s.eta !== null && s.eta >= 1 && ` ${t('· ~{time} left', { time: t.dur(Math.ceil(s.eta)) })}`}
        </p>
        <p className="muted sm">{s.big ? t('A large file: it is decompressed into your browser’s storage, then opened a window at a time.') : t('It opens in the editor once decompressed.')}</p>
        <button type="button" className="btn" onClick={cancel}>
          {t('Cancel')}
        </button>
      </div>
    </section>
  );
}
