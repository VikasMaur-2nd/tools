'use client';

/*
 * Huge mode's Convert view: whole-document commands streamed straight to a file (lib/huge/tasks.ts):
 * Pretty, Minify, JSON Lines, JSON array, CSV, Split and Extract, of the whole file or the selected value,
 * gzipped if asked, with progress, Stop, and the result. In Chromium the browser's save dialog (or a folder
 * for Split) takes the file as it is written; elsewhere it is written in the browser's storage, then downloaded.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { PRIVATE } from '@/lib/analytics';
import { useT } from '@/lib/i18n/react';
import type { HugeSession } from '@/lib/huge/session';
import { COMMAND_MESSAGES, filterOf, parseCondPath, type CommandKind, type CommandSpec, type CondUI, type FormUI } from '@/lib/huge/tasks';
import type { Op } from '@/lib/huge/stream/filter';
import { useTasks } from './HugeShape';

const OPS: { id: Op; label: string; value: boolean }[] = [
  { id: 'eq', label: 'is', value: true },
  { id: 'ne', label: 'is not', value: true },
  { id: 'contains', label: 'contains', value: true },
  { id: 'starts', label: 'starts with', value: true },
  { id: 'gt', label: '>', value: true },
  { id: 'ge', label: '≥', value: true },
  { id: 'lt', label: '<', value: true },
  { id: 'le', label: '≤', value: true },
  { id: 'exists', label: 'exists', value: false },
  { id: 'missing', label: 'is missing', value: false },
  { id: 'is', label: 'is a', value: true },
];
const TYPES = ['string', 'number', 'boolean', 'null', 'object', 'array'];

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string; tip?: string; off?: boolean }[]; onChange: (v: T) => void }) {
  const t = useT();
  return (
    <div className="seg seg-sm" role="radiogroup" aria-label={t(label)}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={o.off} data-tip={o.tip} onClick={() => onChange(o.id)}>
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="hc-row">
      <span className="hc-lbl">{t(label)}</span>
      <div className="hc-ctl">{children}</div>
    </div>
  );
}

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  const t = useT();
  return (
    <label className="pick hc-pick">
      <span className="sr-only">{t(label)}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {t(o.label)}
          </option>
        ))}
      </select>
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  );
}

function Cond({ c, i, set, remove, only }: { c: CondUI; i: number; set: (i: number, c: CondUI) => void; remove: (i: number) => void; only: boolean }) {
  const t = useT();
  const op = OPS.find((o) => o.id === c.op)!;
  const bad = c.path.trim() !== '' && !parseCondPath(c.path);
  return (
    <div className="hc-cond">
      <input
        className={`hc-in hc-path${bad ? ' bad' : ''}`}
        value={c.path}
        onChange={(e) => set(i, { ...c, path: e.target.value })}
        placeholder={t('field, such as email or address.city')}
        aria-label={t('Field')}
        aria-invalid={bad}
        spellCheck={false}
        autoComplete="off"
      />
      <Pick label="Condition" value={c.op} options={OPS.map((o) => ({ id: o.id, label: o.label }))} onChange={(v) => set(i, { ...c, op: v, value: v === 'is' && !TYPES.includes(c.value) ? 'string' : c.value })} />
      {op.value &&
        (c.op === 'is' ? (
          <Pick label="Type" value={c.value} options={TYPES.map((x) => ({ id: x, label: x }))} onChange={(v) => set(i, { ...c, value: v })} />
        ) : (
          <input className="hc-in hc-val" value={c.value} onChange={(e) => set(i, { ...c, value: e.target.value })} placeholder={t('value')} aria-label={t('Value')} spellCheck={false} autoComplete="off" />
        ))}
      {!only && (
        <button type="button" className="btn icon sm" aria-label={t('Remove condition')} onClick={() => remove(i)}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

const KINDS: { id: CommandKind; label: string; about: string }[] = [
  { id: 'pretty', label: 'Pretty', about: 'Indented and readable, as the Format view writes it.' },
  { id: 'minify', label: 'Minify', about: 'All on one line, every space between values gone.' },
  { id: 'jsonl', label: 'JSON Lines', about: 'Each item of the array on a line of its own (NDJSON).' },
  { id: 'json', label: 'JSON array', about: 'The records of a JSON Lines file as one JSON array.' },
  { id: 'csv', label: 'CSV', about: 'A row per record, nested fields as dotted columns, as the CSV converter makes it.' },
  { id: 'split', label: 'Split file', about: 'The records in parts of a size you choose, each a file of its own.' },
  { id: 'extract', label: 'Extract', about: 'Only the records that match, or the first ones, as JSON, JSON Lines or CSV.' },
];

/** The spec the form describes (null: not complete). */
function specOf(f: FormUI): CommandSpec | null {
  const spec: CommandSpec = { kind: f.kind, target: f.target, indent: f.indent, gzip: f.gzip, csv: { delimiter: f.csv.delimiter, flatten: f.csv.flatten, bom: f.csv.bom } };
  if (f.kind === 'split') {
    const n = Number(f.split.n.replace(/[\s,_]/g, ''));
    if (!(n >= 1)) return null;
    spec.split = { by: f.split.by, n, format: f.split.format };
  }
  if (f.kind === 'extract') {
    const limit = f.extract.limit.trim() ? Number(f.extract.limit.replace(/[\s,_]/g, '')) : undefined;
    if (limit !== undefined && !(limit >= 0)) return null;
    const filter = filterOf(f.extract);
    if (!filter && limit === undefined) return null;
    spec.extract = { filter, limit, format: f.extract.format };
  }
  return spec;
}

export default function CommandsView({ s }: { s: HugeSession }) {
  const tasks = s.tasks;
  const f = useTasks(tasks.ui, (u) => u.form);
  const cmd = useTasks(tasks.ui, (u) => u.cmd);
  const ready = useTasks(tasks.ui, (u) => u.ready);
  const picker = useTasks(tasks.ui, (u) => u.picker);
  const folder = useTasks(tasks.ui, (u) => u.folder);
  const index = useSyncExternalStore(s.ui.subscribe, () => s.ui.get().index, () => s.ui.get().index);
  const size = useSyncExternalStore(s.ui.subscribe, () => s.ui.get().size, () => 0);
  const sel = useSyncExternalStore(s.ui.subscribe, () => s.ui.get().sel, () => null);
  const t = useT();
  if (!tasks.supported) {
    return (
      <div id="hg-convert" className="hg-notyet" tabIndex={-1}>
        <b>{t('Converting needs the file itself')}</b>
      </div>
    );
  }
  const set = (patch: Partial<FormUI>) => tasks.ui.form(patch);
  const multi = index.multi;
  // (JSON array: the records of a JSON Lines file; an array is one already.)
  const kinds = KINDS.filter((k) => k.id !== 'json' || multi);
  const about = KINDS.find((k) => k.id === f.kind)!.about;
  const running = cmd.state === 'running';
  const spec = specOf(f);
  const selOk = !!sel && sel.bytes >= 0;
  const conds = f.extract.conds;
  const setCond = (i: number, c: CondUI) => set({ extract: { ...f.extract, conds: conds.map((x, k) => (k === i ? c : x)) } });
  const removeCond = (i: number) => set({ extract: { ...f.extract, conds: conds.filter((_, k) => k !== i) } });
  const pctRead = cmd.total ? Math.min(100, (cmd.read / cmd.total) * 100) : 0;
  const go = picker && f.kind !== 'split' ? t('Save as…') : f.kind === 'split' && folder ? t('Choose a folder…') : t('Download');
  const where =
    f.kind === 'split'
      ? folder
        ? t('Each part is written into the folder you choose.')
        : t('The parts are written into one zip, then downloaded.')
      : picker
        ? t('Written straight into the file you choose: nothing is held in memory.')
        : t('Written in your browser’s storage, then downloaded.');
  return (
    <div id="hg-convert" className="hc" tabIndex={-1}>
      <div className="hc-card">
        <h2 className="hc-title">{t('Convert, straight to a file')}</h2>
        <div className="hc-kinds" role="radiogroup" aria-label={t('Command')}>
          {kinds.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={f.kind === k.id} className="hc-kind" onClick={() => set({ kind: k.id })}>
              {t(k.label)}
            </button>
          ))}
        </div>
        <p className="hc-about">{t(about)}</p>
        <Row label="Of">
          <Seg
            label="Of"
            value={f.target}
            onChange={(v) => set({ target: v })}
            options={[
              { id: 'file', label: 'Whole file' },
              { id: 'value', label: 'Selected value', off: !selOk, tip: selOk ? undefined : t('Select a value in the tree first') },
            ]}
          />
          <span className={`muted sm ${PRIVATE}`}>{f.target === 'value' && sel ? (sel.path.length > 80 ? sel.path.slice(0, 80) + '…' : sel.path) : t.bytes(size)}</span>
        </Row>
        {(f.kind === 'pretty' || (f.kind === 'split' && f.split.format === 'json') || (f.kind === 'extract' && f.extract.format === 'json')) && (
          <Row label="Indent">
            <Seg
              label="Indent"
              value={f.indent === '\t' ? 'tab' : f.indent === '' ? 'none' : String(f.indent.length)}
              onChange={(v) => set({ indent: v === 'tab' ? '\t' : v === 'none' ? '' : ' '.repeat(Number(v)) })}
              options={[
                { id: '2', label: '2 spaces' },
                { id: '4', label: '4 spaces' },
                { id: 'tab', label: 'Tab' },
                ...(f.kind !== 'pretty' ? [{ id: 'none', label: 'Minified' }] : []),
              ]}
            />
          </Row>
        )}
        {(f.kind === 'csv' || (f.kind === 'extract' && f.extract.format === 'csv')) && (
          <>
            <Row label="Delimiter">
              <Seg
                label="Delimiter"
                value={f.csv.delimiter === '\t' ? 'tab' : f.csv.delimiter}
                onChange={(v) => set({ csv: { ...f.csv, delimiter: v === 'tab' ? '\t' : (v as ',' | ';') } })}
                options={[
                  { id: ',', label: 'Comma' },
                  { id: ';', label: 'Semicolon' },
                  { id: 'tab', label: 'Tab' },
                ]}
              />
            </Row>
            <Row label="Nested objects">
              <Seg
                label="Nested objects"
                value={f.csv.flatten}
                onChange={(v) => set({ csv: { ...f.csv, flatten: v } })}
                options={[
                  { id: 'dot', label: 'Dotted columns' },
                  { id: 'json', label: 'JSON in a cell' },
                ]}
              />
              <label className="hc-check">
                <input type="checkbox" checked={f.csv.bom} onChange={(e) => set({ csv: { ...f.csv, bom: e.target.checked } })} />
                {t('Byte order mark (Excel)')}
              </label>
            </Row>
          </>
        )}
        {f.kind === 'split' && (
          <>
            <Row label="Parts">
              <input
                className="hc-in hc-num"
                inputMode="numeric"
                value={f.split.n}
                onChange={(e) => set({ split: { ...f.split, n: e.target.value } })}
                aria-label={t('How many')}
                aria-invalid={!spec}
              />
              <Pick
                label="Split by"
                value={f.split.by}
                onChange={(v) => set({ split: { ...f.split, by: v } })}
                options={[
                  { id: 'records', label: 'records per part' },
                  { id: 'mb', label: 'MB per part' },
                  { id: 'parts', label: 'parts in all' },
                ]}
              />
            </Row>
            <Row label="Each part">
              <Seg
                label="Each part"
                value={f.split.format}
                onChange={(v) => set({ split: { ...f.split, format: v } })}
                options={[
                  { id: 'jsonl', label: 'JSON Lines' },
                  { id: 'json', label: 'JSON array' },
                ]}
              />
            </Row>
          </>
        )}
        {f.kind === 'extract' && (
          <>
            <Row label="Records where">
              <div className="hc-conds">
                {conds.map((c, i) => (
                  <Cond key={i} c={c} i={i} set={setCond} remove={removeCond} only={conds.length === 1} />
                ))}
                <div className="hc-condbar">
                  <button type="button" className="btn sm" onClick={() => set({ extract: { ...f.extract, conds: [...conds, { path: '', op: 'eq', value: '' }] } })}>
                    {t('Add condition')}
                  </button>
                  {conds.length > 1 && (
                    <Seg
                      label="Match"
                      value={f.extract.any ? 'any' : 'all'}
                      onChange={(v) => set({ extract: { ...f.extract, any: v === 'any' } })}
                      options={[
                        { id: 'all', label: 'All of them' },
                        { id: 'any', label: 'Any of them' },
                      ]}
                    />
                  )}
                </div>
              </div>
            </Row>
            <Row label="At most">
              <input
                className="hc-in hc-num"
                inputMode="numeric"
                value={f.extract.limit}
                onChange={(e) => set({ extract: { ...f.extract, limit: e.target.value } })}
                placeholder={t('all')}
                aria-label={t('At most this many records')}
              />
              <span className="muted sm">{t('records (the first ones)')}</span>
            </Row>
            <Row label="As">
              <Seg
                label="As"
                value={f.extract.format}
                onChange={(v) => set({ extract: { ...f.extract, format: v } })}
                options={[
                  { id: 'jsonl', label: 'JSON Lines' },
                  { id: 'json', label: 'JSON array' },
                  { id: 'csv', label: 'CSV' },
                ]}
              />
            </Row>
          </>
        )}
        <Row label="Compress">
          <label className="hc-check">
            <input type="checkbox" checked={f.gzip} onChange={(e) => set({ gzip: e.target.checked })} />
            {t('gzip (.gz), often a tenth of the size')}
          </label>
        </Row>
        <div className="hc-go">
          <button type="button" className="btn primary" disabled={!ready || running || !spec || (f.target === 'value' && !selOk)} onClick={() => spec && void tasks.run(spec)}>
            {go}
          </button>
          <span className="muted sm">{!ready ? (index.error ? t('The file has an error: fix it first (see the status bar)') : t('Ready once the file is indexed ({percent})', { percent: Math.floor((index.bytes / Math.max(1, size)) * 100) + '%' })) : where}</span>
        </div>
        <div className={`hc-run ${PRIVATE}`} aria-live="polite" data-seq={cmd.seq} data-state={cmd.state}>
          {running && (
            <>
              <div className="hc-prog">
                <span>
                  <i className="spin" /> {t('Writing {name}', { name: cmd.name })}
                </span>
                <span className="muted">
                  {t('{done} of {size} read', { done: t.bytes(cmd.read), size: t.bytes(cmd.total) })}
                  {cmd.rate > 0 && ` · ${t('{rate}/s', { rate: t.bytes(cmd.rate) })}`}
                  {cmd.eta !== null && cmd.eta >= 1 && ` ${t('· ~{time} left', { time: t.dur(Math.ceil(cmd.eta)) })}`}
                </span>
                <button type="button" className="btn sm" onClick={() => tasks.stopCommand()}>
                  {t('Stop')}
                </button>
              </div>
              <div className="hg-bar" role="progressbar" aria-label={t('Writing')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pctRead)}>
                <i style={{ width: `${pctRead}%` }} />
              </div>
            </>
          )}
          {cmd.state === 'done' && cmd.result && (
            <div className="hc-done">
              <span className="ok">
                {cmd.result.picked ? t('Saved {name}', { name: cmd.result.name }) : t('Downloaded {name}', { name: cmd.result.name })}
              </span>
              <span className="muted">
                {t.bytes(cmd.result.bytes)}
                {cmd.result.parts > 1 && ` · ${t.n(cmd.result.parts, '{n} part', '{n} parts')}`}
                {cmd.result.records > 0 && ` · ${t.n(cmd.result.records, '{n} record', '{n} records')}`}
                {' · '}
                {t('in {time}', { time: t.dur(Math.max(1, Math.round(cmd.ms / 1000))) })}
              </span>
              {cmd.result.file && (
                <button type="button" className="btn sm" onClick={() => tasks.download(cmd.result!.file!, cmd.result!.name)}>
                  {t('Download again')}
                </button>
              )}
            </div>
          )}
          {cmd.state === 'stopped' && (
            <div className="hc-done warn">
              {cmd.kept
                ? t.n(cmd.kept.parts, 'Stopped: {n} part written to {folder}, the unfinished part {next} removed', 'Stopped: {n} parts written to {folder}, the unfinished part {next} removed', { folder: cmd.kept.folder, next: t.num(cmd.kept.parts + 1) })
                : t('Stopped: nothing was saved')}
            </div>
          )}
          {cmd.state === 'error' && (
            <div className="hc-done err">
              {t(COMMAND_MESSAGES[cmd.error ?? ''] ?? cmd.error ?? 'Something went wrong writing the result')}
              {cmd.kept && <span> {t.n(cmd.kept.parts, '{n} finished part kept in {folder}.', '{n} finished parts kept in {folder}.', { folder: cmd.kept.folder })}</span>}
              {cmd.error === 'Invalid JSON' && (
                <button type="button" className="btn sm" onClick={() => void s.gotoError()}>
                  {t('Go to error')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
