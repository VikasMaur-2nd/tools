/**
 * Documents arriving in an editor, for the `json_loaded` event. Lives next to
 * the engine (it reads the UI store), so pages without the tool don't load it.
 */
import type { InputSource, RawLoad } from './events';
import { collecting, emit } from './index';
import { store } from '../engine/store';

let pending: { source: InputSource; editor: 1 | 2; file: string | null; unsub: () => void } | null = null;
let watching = false;

const SETTLED = new Set(['valid', 'fixable', 'error']);

/** Facts about the document as it is now; ./events.ts `loadedProps` turns them into ranges and categories before sending. */
function report() {
  if (!pending) return;
  const { source, editor, file, unsub } = pending;
  pending = null;
  unsub();
  const s = store.get();
  const st = s.status;
  const raw: RawLoad = {
    source,
    editor,
    file,
    bytes: s.stats?.bytes ?? 0,
    status: st.kind,
    msg: 'msg' in st ? st.msg : undefined,
    count: st.kind === 'fixable' ? st.count : undefined,
    warnings: st.kind === 'valid' ? st.warnings : undefined,
    stats: s.stats ?? undefined,
    jsonl: st.kind === 'valid' && !!st.jsonl,
    jwt: st.kind === 'valid' && !!st.jwt,
  };
  emit('json_loaded', raw as unknown as Record<string, unknown>);
}

/**
 * A document arrived in an editor (`source` says how). Reported once its first
 * check settles, with its size range, validity and the error category. Call it
 * right after the document was put in the editor; `next` waits for the next
 * check instead (a paste the editor hasn't analysed yet).
 */
export function noteLoad(source: InputSource, editor: 1 | 2 = 1, fileName?: string | null, next = false) {
  if (!collecting()) return;
  if (pending) report();
  if (editor === 2) {
    // Compare's document has no status of its own; its size is published a moment after it changes.
    window.setTimeout(() => {
      const raw: RawLoad = { source, editor, file: fileName ?? null, bytes: store.get().cmpText.length, status: 'unknown' };
      emit('json_loaded', raw as unknown as Record<string, unknown>);
    }, 500);
    return;
  }
  const since = performance.now();
  let first = store.get().status;
  const check = () => {
    const st = store.get().status;
    if (next && st === first) return;
    if (SETTLED.has(st.kind) || performance.now() - since > 60_000) report();
    first = st;
  };
  pending = { source, editor, file: fileName ?? null, unsub: store.subscribe(check) };
  if (!next) check();
}

/** Pastes straight into an editor (the most common way in), reported once the editor has checked them. Once per page. */
export function watchPastes() {
  if (watching || !collecting()) return;
  watching = true;
  addEventListener(
    'paste',
    (e) => {
      const pane = (e.target as Element | null)?.closest?.('.pane-ed, .pane-cmp');
      if (pane) noteLoad('paste', pane.classList.contains('pane-cmp') ? 2 : 1, null, true);
    },
    { capture: true, passive: true },
  );
}
