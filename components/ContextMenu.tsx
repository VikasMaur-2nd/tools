'use client';

import { useCallback, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { withVia } from '@/lib/analytics';
import type { SnippetFormat } from '@/lib/badge';
import type { Engine } from '@/lib/engine/engine';
import { act, getEngine } from '@/lib/engine/instance';
import { store, useUI, type ContextMenu as Open, type DiffAction, type DiffMenu, type MenuArea } from '@/lib/engine/store';
import { useT } from '@/lib/i18n/react';
import { LEVELS, MCheck, MChoice, MItem, MSep, menuKeys, menuLetter } from './menu';

/*
 * The right-click menu of the editors and views. Browsers don't let a page add
 * to their own menu, so this one replaces it there: the area's actions first,
 * then the browser's editing items (Undo … Select all). Shift+right-click still
 * opens the browser's menu, and a long press on a touch screen the phone's
 * (Engine.onContextMenu). The menu key and Shift+F10 open it at the caret.
 */

const EDGE = 8;
const SUBS = [
  { v: 'changes', label: 'Changes' },
  { v: 'diff', label: 'Diff' },
];
const LAYOUTS = [
  { v: 'unified', label: 'Unified' },
  { v: 'split', label: 'Split' },
];
/** The share link, or a button around it (Engine.share). */
const SHARE_AS: { v: SnippetFormat; label: string }[] = [
  { v: 'link', label: 'Link' },
  { v: 'markdown', label: 'Markdown' },
  { v: 'html', label: 'HTML' },
];

/** The menu's name for screen readers: the area it is for (strings the areas use already). */
const NAMES: Record<MenuArea, string> = {
  input: 'JSON input',
  compare: 'Modified JSON',
  format: 'Formatted output',
  convert: 'Converted output',
  tree: 'JSON tree',
  table: 'Table',
  graph: 'Graph',
  diff: 'Differences',
};

/** The open menu `m` (in a portal of JsonTool's: react-dom isn't loaded with this module). */
/** A key in the menu: Esc, Tab or the menu keys close it; the arrows, Home, End and letters move in it. */
function menuKey(e: ReactKeyboardEvent<HTMLDivElement>, close: () => void) {
  if (e.key === 'Escape' || e.key === 'Tab' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault();
    e.stopPropagation();
    close();
  } else if (!menuKeys(e)) menuLetter(e);
}

export default function Popup({ m }: { m: Open }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const t = useT();

  /** `refocus`: back to the area it opened on (not when a press elsewhere takes focus itself). */
  const close = useCallback(
    (refocus = true) => {
      if (done.current) return;
      done.current = true;
      if (store.get().menu?.id === m.id) store.set({ menu: null });
      if (refocus) act((e) => e.menuFocus(m.area));
    },
    [m],
  );

  useLayoutEffect(() => {
    const el = ref.current!;
    // In the top layer, as tooltips are (lib/tooltips.ts): over a fullscreen graph too.
    if (typeof el.showPopover === 'function') el.showPopover();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    // Right of and below the point; mirrored where there is no room (from the keyboard: above the caret's row).
    const x = m.x + w > vw - EDGE ? (m.keyboard ? vw - EDGE - w : m.x - w) : m.x;
    const y = m.y + h > vh - EDGE ? m.top - h : m.y;
    el.style.left = `${Math.round(Math.max(EDGE, Math.min(x, vw - EDGE - w)))}px`;
    el.style.top = `${Math.round(Math.max(EDGE, Math.min(y, vh - EDGE - h)))}px`;
    // From the keyboard the first item has focus; from a pointer the menu does (the arrows then pick).
    (m.keyboard ? el.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)') : el)?.focus({ preventScroll: true });
    // Keys pressed while the menu loaded (it loads when the page is idle), as if pressed now: Enter or Space
    // presses the item they reach.
    for (const k of getEngine()?.takeKeys() ?? []) {
      if (done.current) break;
      const at = document.activeElement;
      if (k.key === 'Enter' || k.key === ' ') {
        if (at instanceof HTMLElement && at !== el && el.contains(at)) at.click();
        break;
      }
      // (Named, not spread: a held key is the browser's event, whose key and modifiers aren't its own properties.)
      const { key, ctrlKey, metaKey, altKey, shiftKey } = k;
      menuKey({ key, ctrlKey, metaKey, altKey, shiftKey, target: at, currentTarget: el, preventDefault() {}, stopPropagation() {} } as unknown as ReactKeyboardEvent<HTMLDivElement>, close);
    }

    const outside = (e: Event) => !(e.target instanceof Node && el.contains(e.target));
    const onDown = (e: PointerEvent) => outside(e) && close(false);
    const onWheel = (e: WheelEvent) => outside(e) && close();
    const onResize = () => close();
    const onBlur = () => close(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
      getEngine()?.releaseKeys();
    };
  }, [m, close]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => menuKey(e, close);

  return (
    <div
      ref={ref}
      className="menu ctx"
      role="menu"
      aria-label={t(NAMES[m.area])}
      tabIndex={-1}
      popover="manual"
      onKeyDown={onKey}
      // (No browser menu over this one.)
      onContextMenu={(e) => e.preventDefault()}
    >
      <Items m={m} close={close} />
      {!m.keyboard && (
        <div className="mi-foot" aria-hidden="true">
          {t('Shift+right-click: browser menu')}
        </div>
      )}
    </div>
  );
}

/** The menu's groups, separated; a group can be empty. */
function Items({ m, close }: { m: Open; close: () => void }) {
  const mac = useUI((s) => s.mac);
  const wrap = useUI((s) => s.settings.wrap);
  const a = m.area;
  const editor = a === 'input' || a === 'compare';
  const which = a === 'compare' ? 2 : 1;
  const node = m.node;
  // Item actions are reported as coming from this menu.
  const go = (fn: (e: Engine) => unknown) => () => act((e) => withVia('context_menu', () => fn(e)));
  const item = (label: string, fn: (e: Engine) => unknown, keys?: string, disabled?: boolean) => (
    <MItem key={label} label={label} keys={keys} onClick={go(fn)} close={close} disabled={disabled} />
  );

  const fold = m.fold && (
    <MItem
      key="fold"
      label={m.fold.folded ? 'Unfold' : 'Fold'}
      // (The editors fold at the caret by key, like VS Code; the output views by the gutter only.)
      keys={editor ? (mac ? 'Alt+mod+' : 'mod+Shift+') + (m.fold.folded ? ']' : '[') : undefined}
      onClick={go((e) => e.menuFold(a, m.fold!.line))}
      close={close}
    />
  );
  const folds = [
    item('Collapse all', (e) => (editor ? e.foldEditor(which, 1) : e.collapseAll())),
    item('Expand all', (e) => (editor ? e.foldEditor(which, 0) : e.expandAll())),
    <MChoice key="levels" label="Show levels" options={LEVELS} onPick={(l) => go((e) => (editor ? e.foldEditor(which, l) : e.expandTo(l)))()} close={close} />,
  ];
  const wrapItem = <MCheck key="wrap" label="Wrap lines" keys="Alt+Z" checked={wrap} onClick={go((e) => e.toggleWrap())} close={close} />;
  // Without a selection the copy key copies everything in the editors: so does this.
  const copy = item(m.sel ? 'Copy' : 'Copy all', (e) => e.menuCopy(a), m.sel || editor ? 'mod+C' : undefined, editor && m.blank);
  const nodeItems = node
    ? [
        item('Copy value', (e) => e.copyValue(), a === 'table' ? undefined : 'C'),
        item('Copy path', (e) => e.copyPath(), a === 'table' ? undefined : 'P'),
        a === 'tree' && node.open !== null && item(node.open ? 'Collapse' : 'Expand', (e) => e.menuToggle(), node.open ? '←' : '→'),
        a === 'tree' && node.str && item('Expand nested JSON string', (e) => e.expandNested()),
        a !== 'table' && item('Show in editor', (e) => e.menuShow(), 'Enter'),
      ]
    : [];

  let groups: ReactNode[][];
  switch (a) {
    case 'input':
    case 'compare':
      groups = [
        [fold, ...folds, wrapItem],
        a === 'input'
          ? [item('Format', (e) => e.format(), 'Shift+Alt+F', m.blank), item('Download input', (e) => e.download(), 'mod+S', m.blank)]
          : [item('Format', (e) => e.formatCompare(), 'mod+Enter', m.blank), item('Swap with original', (e) => e.swapCompare())],
        // (What is on screen: both documents in Compare. The toast says which was copied.)
        [<MChoice key="share" label="Share" options={SHARE_AS} onPick={(v) => go((e) => e.share(v))()} close={close} />],
        [item('Undo', (e) => e.menuUndo(a, false), 'mod+Z', !m.undo), item('Redo', (e) => e.menuUndo(a, true), 'mod+Shift+Z', !m.redo)],
        [
          item('Cut', (e) => e.menuCut(a), 'mod+X', !m.cut),
          copy,
          item('Paste', (e) => e.menuPaste(a), 'mod+V', !m.paste),
          item('Select all', (e) => e.menuSelectAll(a), 'mod+A', m.blank),
        ],
      ];
      break;
    case 'format':
      groups = [[fold, ...folds, wrapItem], [item('Use as input', (e) => e.useOutput(), 'mod+Enter'), item('Download', (e) => e.downloadOutput())], [copy]];
      break;
    case 'convert':
      groups = [[fold, ...folds, wrapItem], [item('Download', (e) => void e.downloadConvert())], [copy]];
      break;
    case 'tree':
      groups = [nodeItems, folds, [item('Download', (e) => e.downloadOutput())], [m.sel && copy]];
      break;
    case 'table':
      groups = [
        nodeItems,
        [item('Copy as CSV', (e) => e.copyCSV()), item('Download CSV', (e) => e.downloadCSV()), item('Download Excel (.xlsx)', (e) => void e.exportExcel())],
        [m.sel && copy],
      ];
      break;
    case 'graph':
      groups = [
        nodeItems,
        [item('Fit to screen', (e) => e.fitGraph(), '0'), item('Zoom in', (e) => e.zoomGraph(1.25), '+'), item('Zoom out', (e) => e.zoomGraph(0.8), '-'), ...folds],
        [item('Export image…', (e) => e.openGraphExport()), item('Copy image', (e) => e.copyGraphImage())],
      ];
      break;
    case 'diff': {
      // Compare's differences: the row's own items, then the panel's (components/CompareView.tsx).
      const d = m.diff!;
      const r = d.row;
      const changes = d.sub === 'changes';
      const run = (action: DiffAction, arg?: string) => go(() => d.run(action, arg));
      const check = (label: string, k: keyof DiffMenu['opts']) => <MCheck key={k} label={label} checked={d.opts[k]} onClick={run('opt', k)} close={close} />;
      groups = [
        r?.kind === 'change'
          ? [
              item('Copy path', () => d.run('copyPath')),
              r.left && item('Copy original value', () => d.run('copyLeft')),
              r.right && item('Copy modified value', () => d.run('copyRight')),
              item('Show in editors', () => d.run('show'), 'Enter'),
            ]
          : r?.kind === 'gap'
            ? [item('Show unchanged lines', () => d.run('expand'), 'Enter')]
            : [r && item('Show in editors', () => d.run('show'), 'Enter')],
        [
          <MChoice key="sub" label="View" value={d.sub} options={SUBS} onPick={(v) => run('sub', v)()} close={close} />,
          !changes && d.wide && <MChoice key="layout" label="Diff layout" value={d.layout} options={LAYOUTS} onPick={(v) => run('layout', v)()} close={close} />,
          item(changes ? 'Previous difference' : 'Previous change', () => d.run('prev'), undefined, !d.ok),
          item(changes ? 'Next difference' : 'Next change', () => d.run('next'), undefined, !d.ok),
        ],
        [check('Ignore key order', 'keyOrder'), changes && check('Ignore array order', 'arrayOrder'), changes && check('Ignore case', 'ci')],
        [item('Swap original and modified', (e) => e.swapCompare()), item('Copy JSON Patch', () => d.run('patch'), undefined, !d.patch)],
        [m.sel && copy],
      ];
    }
  }
  groups.push([item('All commands', (e) => e.openPalette(), 'mod+K')]);

  const out: ReactNode[] = [];
  for (const g of groups) {
    const shown = g.filter(Boolean);
    if (!shown.length) continue;
    if (out.length) out.push(<MSep key={`sep${out.length}`} />);
    out.push(...shown);
  }
  return out;
}
