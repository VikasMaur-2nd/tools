/**
 * Documents arriving in an editor, for the `json_loaded` event. Lives next to
 * the engine (it reads the UI store), so pages without the tool don't load it.
 */
import type { InputSource, RawLoad } from './events';
import { collecting, emit } from './index';
import { store } from '../engine/store';

/** Per editor: the document on its way in, until it is reported (`stop` ends the wait for it). */
const pending: { [E in 1 | 2]?: { source: InputSource; file: string | null; stop: () => void } } = {};
let watching = false;

const SETTLED = new Set(['valid', 'fixable', 'error']);

const send = (raw: RawLoad) => emit('json_loaded', raw as unknown as Record<string, unknown>);

/** Facts about editor `editor`'s document as it is now; ./events.ts `loadedProps` turns them into ranges and categories before sending. */
function report(editor: 1 | 2) {
  const p = pending[editor];
  if (!p) return;
  delete pending[editor];
  p.stop();
  const s = store.get();
  if (editor === 2) return send({ source: p.source, editor, file: p.file, bytes: s.cmpText.length, status: 'unknown' });
  const st = s.status;
  send({
    source: p.source,
    editor,
    file: p.file,
    bytes: s.stats?.bytes ?? 0,
    status: st.kind,
    msg: 'msg' in st ? st.msg : undefined,
    count: st.kind === 'fixable' ? st.count : undefined,
    warnings: st.kind === 'valid' ? st.warnings : undefined,
    stats: s.stats ?? undefined,
    jsonl: st.kind === 'valid' && !!st.jsonl,
    jwt: st.kind === 'valid' && !!st.jwt,
    input: s.input.format,
  });
}

/**
 * A document is arriving in an editor (`source` says how). Call it just before
 * the document goes in: it is reported once that editor's next check settles,
 * with its size range, validity and the error category. Each editor waits on its
 * own (a comparison link loads both); a newer document in the same editor
 * replaces the one before, which is reported without the size and validity it
 * never had checked.
 */
export function noteLoad(source: InputSource, editor: 1 | 2 = 1, fileName?: string | null) {
  if (!collecting()) return;
  const old = pending[editor];
  if (old) {
    delete pending[editor];
    old.stop();
    send({ source: old.source, editor, file: old.file, status: 'unknown' });
  }
  const file = fileName ?? null;
  if (editor === 2) {
    // Compare's document has no status of its own; its size is published a moment after it changes.
    const t = window.setTimeout(() => report(2), 500);
    pending[2] = { source, file, stop: () => window.clearTimeout(t) };
    return;
  }
  const since = performance.now();
  const before = store.get().status;
  // Every check publishes a new status object; the one already shown belongs to the previous document.
  const check = () => {
    const st = store.get().status;
    if (st !== before && (SETTLED.has(st.kind) || performance.now() - since > 60_000)) report(1);
  };
  pending[1] = { source, file, stop: store.subscribe(check) };
}

/** Pastes straight into an editor (the most common way in), reported once the editor has checked them. Once per page. */
export function watchPastes() {
  if (watching || !collecting()) return;
  watching = true;
  addEventListener(
    'paste',
    (e) => {
      const pane = (e.target as Element | null)?.closest?.('.pane-ed, .pane-cmp');
      if (pane) noteLoad('paste', pane.classList.contains('pane-cmp') ? 2 : 1);
    },
    { capture: true, passive: true },
  );
}
