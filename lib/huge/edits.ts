/*
 * Editing in huge mode, the views' side (the core's: docs/huge-files/API.md "Editing", "Saving", "Sessions").
 *
 * An edit is asked by path, not by node: nodes go stale with every edit (positions move), so each one is resolved
 * afresh when it runs, one edit at a time. After it, the views read again: what moved is told as an `Effect` (an
 * array's items after an insert shift by one, a renamed member's subtree has a new path), so the tree re-opens
 * what was open and the selection lands on what the edit made. What is typed is checked here first and says why
 * it isn't right; nothing is sent then.
 */
import { BOOL, NUL, NUM, STR, parse } from '../json/parser';
import { rt } from '../i18n/ui';
import { track } from '../analytics';
import type { Events } from '../analytics/events';
import type { HugeNode, HugeSource, Seg } from './source';

/** What a value is typed as in the edit box. */
export type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'json';

export const kindOf = (t: number): ValueKind => (t === STR ? 'string' : t === NUM ? 'number' : t === BOOL ? 'boolean' : t === NUL ? 'null' : 'json');

/** A JSON number, as the grammar has it. */
const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** The JSON of what was typed as `kind`, or why it can't be (nothing is sent then). */
export function valueJson(kind: ValueKind, text: string): { json: string } | { error: string } {
  const t = text.trim();
  switch (kind) {
    case 'string':
      return { json: JSON.stringify(text) };
    case 'number':
      if (NUMBER.test(t)) return { json: t };
      return { error: t ? rt('Not a number: write it like 12, -3.5 or 1e9') : rt('Type a number') };
    case 'boolean':
      return t === 'true' || t === 'false' ? { json: t } : { error: rt('Choose true or false') };
    case 'null':
      return { json: 'null' };
    case 'json': {
      if (!t) return { error: rt('Type a JSON value') };
      const r = parse(text);
      // (The strict verdict: the first construct a strict parser refuses.)
      const bad = r.error ?? r.issues[0];
      if (bad) return { error: rt('{msg} (at character {n})', { msg: rt.msg(bad.m), n: rt.num(bad.p + 1) }) };
      return { json: text };
    }
  }
}

/** The text a value's edit box starts with: a string's own text (unquoted), else its JSON. */
export function boxText(n: Pick<HugeNode, 't' | 'text'>, json: string | null): string {
  if (n.t === STR) return json !== null ? (JSON.parse(json) as string) : n.text;
  return json ?? n.text;
}

/**
 * A value's text as written, without the indent of where it is: its lines after the first all start with the
 * last line's indent (a container's closing bracket), which comes off them. (Applied, it's indented for where it
 * goes again.)
 */
export function dedent(text: string): string {
  const lines = text.split('\n');
  if (lines.length < 2) return text;
  const pad = /^[ \t]*/.exec(lines[lines.length - 1])![0];
  if (!pad || !lines.slice(1).every((l) => l.startsWith(pad) || !l.trim())) return text;
  return [lines[0], ...lines.slice(1).map((l) => l.slice(pad.length))].join('\n');
}

/**
 * Which member a path means, where names repeat (`{"a": 1, "a": 2}`: a path names the first): `i`, the member's
 * index in its container (the selected node's), or `at`, every segment's (-1: by name). Without them, by name.
 */
type Which = { i?: number; at?: number[] };

/** An edit, by path (each is one undo step). */
export type EditOp =
  | ({ op: 'set'; path: Seg[]; json: string } & Which)
  | ({ op: 'rename'; path: Seg[]; name: string } & Which)
  | ({ op: 'remove'; path: Seg[] } & Which)
  /** (`parentAt`: the container's index path, where names repeat.) */
  | { op: 'insert'; parent: Seg[]; parentAt?: number[]; index: number; json: string; name: string | null }
  | ({ op: 'duplicate'; path: Seg[] } & Which)
  /** A value's new text: JSON (written as the document is), or anything else as typed (then the status says where it's wrong). */
  | ({ op: 'text'; path: Seg[]; text: string } & Which)
  | { op: 'undo' }
  | { op: 'redo' }
  | { op: 'restore' };

/** How paths moved with an edit (for what the views had open). */
export interface Effect {
  /** A value gone (removed): paths in it are gone. */
  removed?: Seg[];
  /** An array's items from `index` on moved by `delta`. */
  shift?: { parent: Seg[]; index: number; delta: number };
  /** A member renamed: paths in it now start with `to`. */
  moved?: { from: Seg[]; to: Seg[] };
}

const startsWith = (p: readonly Seg[], q: readonly Seg[]) => p.length >= q.length && q.every((s, i) => s === p[i]);

/** Path `p` after an edit that did `fx` (null: it is gone). */
export function adjustPath(p: Seg[], fx: Effect): Seg[] | null {
  if (fx.removed && startsWith(p, fx.removed)) return null;
  if (fx.moved && startsWith(p, fx.moved.from)) return [...fx.moved.to, ...p.slice(fx.moved.from.length)];
  const s = fx.shift;
  if (s && p.length > s.parent.length && startsWith(p, s.parent)) {
    const k = s.parent.length;
    const i = p[k];
    if (typeof i === 'number' && i >= s.index) return [...p.slice(0, k), i + s.delta, ...p.slice(k + 1)];
  }
  return p;
}

/** The core's fixed words, as the UI says them. */
const WORDS: Record<string, string> = {
  'Not ready': 'The file is still being read: try again once it is',
  'Invalid JSON': "That isn't valid JSON",
  'Not allowed': "That can't be done here",
  'Out of range': 'That value is no longer there',
  'Too big': 'Too big to edit as text (over 64 MB): edit the values inside it',
  'Save failed': "Couldn't save the file",
  Cancelled: 'Saving stopped: the file is as it was',
};

/** What an error from the core says to the user (null: not one of its words, a failure to report). */
export const editError = (e: unknown): string | null => {
  const m = e instanceof Error ? e.message : String(e);
  return m in WORDS ? WORDS[m] : null;
};

/** What editing asks of the session. */
export interface EditHost {
  readonly src: HugeSource;
  /** The selection's path now (undo and redo keep it where it can be), and its index path where known. */
  selPath(): Seg[] | null;
  selAt?(): number[] | null;
  /**
   * After an edit: the views read again (`fx`: how paths moved), `select` selected (null: as it was); `selectAt`:
   * its index path, where known (which member, where names repeat: REVIEW-3 B3).
   */
  changed(fx: Effect, select: Seg[] | null, selectAt?: number[] | null): Promise<void>;
  /** An edit couldn't be made: why. */
  refused(msg: string): void;
  failed(e: unknown): void;
}

type EditKind = Events['huge_edit']['op'];

/** The edits of one document: one at a time, each resolving its nodes afresh (the core counts them: `steps`). */
export class HugeEditing {
  busy = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly host: EditHost) {}

  /** Resolves once the edits asked so far are made (or refused), the views read again after them. */
  settled(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  /** Runs `op` after the edits before it; resolves to whether it was made. */
  run(op: EditOp, from: Events['huge_edit']['from']): Promise<boolean> {
    const next = this.queue.then(() => this.exec(op, from));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async exec(op: EditOp, from: Events['huge_edit']['from']): Promise<boolean> {
    const ed = this.host.src.edits;
    if (!ed) return false;
    this.busy = true;
    try {
      const r = await this.apply(op);
      if (!r) return false;
      track('huge_edit', { op: op.op as EditKind, from });
      await this.host.changed(r.fx, r.select, r.selectAt ?? null);
      return true;
    } catch (e) {
      const msg = editError(e);
      if (msg) this.host.refused(rt(msg));
      else this.host.failed(e);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /**
   * The node at `path`, its container and its index path (null: not there); `w`: which member, where names repeat.
   */
  private async at(path: Seg[], w: Which = {}): Promise<{ node: HugeNode; parent: HugeNode | null; idx: number[] } | null> {
    const at = w.at && w.at.length === path.length ? w.at : w.i !== undefined && w.i >= 0 && path.length ? [...path.slice(0, -1).map(() => -1), w.i] : undefined;
    const chain = await this.host.src.resolve(path, undefined, at);
    if (!chain?.length) return null;
    return { node: chain[chain.length - 1], parent: chain.length > 1 ? chain[chain.length - 2] : null, idx: chain.slice(1).map((n) => n.i) };
  }

  private async apply(op: EditOp): Promise<{ fx: Effect; select: Seg[] | null; selectAt?: number[] | null } | null> {
    const ed = this.host.src.edits!;
    const gone = () => {
      throw new Error('Out of range');
    };
    switch (op.op) {
      case 'set':
      case 'text': {
        const x = (await this.at(op.path, op)) ?? gone();
        if (op.op === 'set') await ed.setValue(x.node, op.json);
        else await ed.replaceNode(x.node, op.text);
        return { fx: {}, select: op.path, selectAt: x.idx };
      }
      case 'rename': {
        const x = (await this.at(op.path, op)) ?? gone();
        if (!x.parent) throw new Error('Not allowed');
        await ed.rename(x.parent, x.node.i, op.name);
        const to = [...op.path.slice(0, -1), op.name];
        return { fx: { moved: { from: op.path, to } }, select: to, selectAt: x.idx };
      }
      case 'remove': {
        const x = (await this.at(op.path, op)) ?? gone();
        if (!x.parent) throw new Error('Not allowed');
        const i = x.node.i;
        const count = x.parent.count;
        await ed.remove(x.parent, i);
        const parentPath = op.path.slice(0, -1);
        const parentAt = x.idx.slice(0, -1);
        const fx: Effect = { removed: op.path, ...(typeof op.path[op.path.length - 1] === 'number' && { shift: { parent: parentPath, index: i + 1, delta: -1 } }) };
        // The one after it now (or the one before, at the end); none left: the container.
        if (count <= 1) return { fx, select: parentPath, selectAt: parentAt };
        const k = Math.min(i, count - 2);
        return { fx, select: await this.childPath(parentPath, k, parentAt), selectAt: [...parentAt, k] };
      }
      case 'insert': {
        const x = op.parent.length ? ((await this.at(op.parent, { at: op.parentAt })) ?? gone()) : { node: await this.host.src.root(), idx: [] };
        await ed.insert(x.node, op.index, op.json, op.name);
        const select = [...op.parent, op.name ?? op.index];
        return { fx: op.name === null ? { shift: { parent: op.parent, index: op.index, delta: 1 } } : {}, select, selectAt: [...x.idx, op.index] };
      }
      case 'duplicate': {
        const x = (await this.at(op.path, op)) ?? gone();
        if (!x.parent) throw new Error('Not allowed');
        const i = x.node.i;
        await ed.duplicate(x.parent, i);
        const parentPath = op.path.slice(0, -1);
        const parentAt = x.idx.slice(0, -1);
        const arr = typeof op.path[op.path.length - 1] === 'number';
        return { fx: arr ? { shift: { parent: parentPath, index: i + 1, delta: 1 } } : {}, select: await this.childPath(parentPath, i + 1, parentAt), selectAt: [...parentAt, i + 1] };
      }
      case 'undo':
      case 'redo':
        await (op.op === 'undo' ? ed.undo() : ed.redo());
        return { fx: {}, select: this.host.selPath(), selectAt: this.host.selAt?.() ?? null };
      case 'restore':
        await ed.restoreSession();
        return { fx: {}, select: this.host.selPath(), selectAt: this.host.selAt?.() ?? null };
    }
  }

  /** The path of child `i` of the container at `parent` (`parentAt`: its index path), as the document is now. */
  private async childPath(parent: Seg[], i: number, parentAt?: number[]): Promise<Seg[]> {
    const chain = await this.host.src.resolve(parent, undefined, parentAt && parentAt.length === parent.length ? parentAt : undefined);
    const p = chain?.[chain.length - 1];
    if (!p) return parent;
    const [kid] = await this.host.src.children(p, i, 1);
    return kid ? [...parent, kid.key ?? i] : parent;
  }
}
