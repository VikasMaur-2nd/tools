/**
 * Editing a huge document, on top of HugeDoc.edit (byte ranges replaced, the index read again around them):
 *
 * - An undo history: each step keeps the pieces its changes took out (pieces.ts: references to the file or to
 *   edits' bytes, so a step costs its own bytes only); undoing puts them back, redoing puts the step's in again.
 *   Bounded (HISTORY_BYTES of edits' bytes): the oldest steps go first. A node edit is one step.
 * - Node edits that write JSON the way the document around them is written: a container's children keep their
 *   separator (`,\n    `, `, `, `,`), their indent and how a name meets its value (`": "`), values are re-indented
 *   for where they go (or minified in a minified document); JSON Lines values stay a line each.
 * - A node's text for the normal editor (bounded), and that text put back.
 */
import { parse } from '../json/tape-parser';
import { writeTape } from '../json/pretty';
import { lengthOf, piecesOf, type Piece } from './pieces';
import type { EditOp, HugeDoc } from './doc';
import { ARR, LIST, OBJ, type HugeNode } from './types';

/** Edits' bytes the history may hold before its oldest steps go. */
export const HISTORY_BYTES = 256 << 20;
/** The most a node's text for the normal editor may be. */
export const NODE_TEXT = 64 << 20;
/** Typing: changes this close together (ms) that go on from each other are one step. */
const TYPING_MS = 1000;

const enc = new TextEncoder();
const dec = new TextDecoder();

interface Step {
  ops: EditOp[];
  /** Per op, what it took out. */
  removed: Piece[][];
  bytes: number;
  time: number;
  typing: boolean;
}

/** What an edit did: whether the document is all read again (else it goes on in steps: HugeDoc.step). */
export interface EditDone {
  done: boolean;
}

const editBytes = (ps: readonly Piece[]) => {
  let n = 0;
  for (const p of ps) if (p.buf) n += p.len;
  return n;
};

export class HugeEditor {
  private steps: Step[] = [];
  /** Steps applied: undo takes steps[at - 1], redo steps[at]. */
  private at = 0;
  private held = 0;
  /** Applied steps the history let go of (its oldest, past its bytes): still in the document, no longer undoable. */
  private dropped = 0;

  constructor(
    readonly doc: HugeDoc,
    private readonly cap = HISTORY_BYTES,
  ) {
    // (How the document was written, from the start: edits may leave nothing to tell it by, `{}`.)
    if (doc.done) this.unit();
  }

  get canUndo(): boolean {
    return this.at > 0;
  }

  get canRedo(): boolean {
    return this.at < this.steps.length;
  }

  /**
   * Changes applied since the file was opened (or saved in place), as undo counts them: a typing run joined into one
   * step is one; undo takes one off, redo puts it back; steps the history let go of still count (`dropped`).
   */
  get applied(): number {
    return this.dropped + this.at;
  }

  /** Applied steps the history let go of (kept with a session, so its count stays right). */
  get droppedSteps(): number {
    return this.dropped;
  }

  /** Bytes of edits the history holds. */
  get historyBytes(): number {
    return this.held;
  }

  /** The history's steps (their changes and what each took out) for a session to keep: steps[0, applied) are applied. */
  get history(): { steps: readonly { ops: readonly EditOp[]; removed: readonly Piece[][] }[]; applied: number } {
    return { steps: this.steps, applied: this.at };
  }

  /** A kept session's history back (its document is the one now: put back with doc.edit). */
  restoreHistory(steps: readonly { ops: EditOp[]; removed: Piece[][] }[], applied: number, dropped = 0) {
    this.steps = steps.map((s) => ({ ops: s.ops, removed: s.removed, bytes: s.ops.reduce((n, o, i) => n + editBytes(o.put) + editBytes(s.removed[i] ?? []), 0), time: 0, typing: false }));
    this.at = Math.min(applied, this.steps.length);
    this.held = this.steps.reduce((n, s) => n + s.bytes, 0);
    this.dropped = dropped;
  }

  /**
   * Applies `ops` (in order, each at the document as the one before leaves it) as one step. `typing`: one that
   * goes on from the step before (a change at its end, soon after) joins it.
   */
  apply(ops: EditOp[], until = Infinity, typing = false): EditDone {
    const { removed, done } = this.doc.edit(ops, until);
    // Redo past here is gone.
    for (const s of this.steps.splice(this.at)) this.held -= s.bytes;
    const bytes = ops.reduce((n, o, i) => n + editBytes(o.put) + editBytes(removed[i]), 0);
    const last = this.steps[this.at - 1];
    const now = Date.now();
    if (typing && last && last.typing && now - last.time < TYPING_MS && last.ops.length === 1 && ops.length === 1 && ops[0].a === last.ops[0].a + lengthOf(last.ops[0].put) && ops[0].b === ops[0].a && removed[0].length === 0) {
      // (Typed on: the same insert, longer.)
      last.ops[0] = { a: last.ops[0].a, b: last.ops[0].b, put: [...last.ops[0].put, ...ops[0].put] };
      last.bytes += bytes;
      last.time = now;
    } else {
      this.steps.push({ ops: ops.map((o) => ({ ...o, put: [...o.put] })), removed, bytes, time: now, typing });
      this.at++;
    }
    this.held += bytes;
    // (Bounded: the oldest go.)
    while (this.held > this.cap && this.at > 1) {
      const s = this.steps.shift()!;
      this.held -= s.bytes;
      this.at--;
      this.dropped++;
    }
    return { done };
  }

  /** Undoes the last step (false: none). */
  undo(until = Infinity): EditDone | false {
    if (!this.at) return false;
    const s = this.steps[this.at - 1];
    // Each change undone at the document it left, last first.
    const back: EditOp[] = [];
    for (let i = s.ops.length - 1; i >= 0; i--) {
      const o = s.ops[i];
      back.push({ a: o.a, b: o.a + lengthOf(o.put), put: s.removed[i] });
    }
    const { done } = this.doc.edit(back, until);
    this.at--;
    s.typing = false;
    return { done };
  }

  /** Redoes the step undone last (false: none). */
  redo(until = Infinity): EditDone | false {
    if (this.at >= this.steps.length) return false;
    const s = this.steps[this.at];
    const { removed, done } = this.doc.edit(s.ops, until);
    s.removed = removed;
    this.at++;
    return { done };
  }

  /** Forgets every step (after a save: the file is the document then). */
  clear() {
    this.steps = [];
    this.at = 0;
    this.held = 0;
    this.dropped = 0;
  }

  // ── Node edits ──────────────────────────────────────────────────────

  /** Replaces the value of `node` with JSON `json` (re-indented for where it is). */
  setValue(node: HugeNode, json: string, until = Infinity): EditDone {
    this.ready();
    const value = this.format(json, this.indentAt(node.start), this.styleOf(this.parentOf(node)));
    return this.apply([{ a: node.start, b: node.end, put: piecesOf(enc.encode(value)) }], until);
  }

  /** Renames child `i` of object `parent` to `name`. */
  rename(parent: HugeNode, i: number, name: string, until = Infinity): EditDone {
    this.ready();
    if (parent.kind !== OBJ) throw new Error('Not allowed');
    const m = this.member(parent, i);
    return this.apply([{ a: m.start, b: m.keyEnd, put: piecesOf(enc.encode(JSON.stringify(name))) }], until);
  }

  /** Removes child `i` of `parent` (a container or the LIST of JSON Lines values), with its separator. */
  remove(parent: HugeNode, i: number, until = Infinity): EditDone {
    this.ready();
    const count = parent.count ?? 0;
    const m = this.member(parent, i);
    if (count <= 1) {
      // (The only child: an empty container, or (the LIST's only value) an empty document.)
      if (parent.kind === LIST) return this.apply([{ a: m.start, b: m.end, put: [] }], until);
      return this.apply([{ a: parent.start + 1, b: parent.end - 1, put: [] }], until);
    }
    // Up to the next one (its indent stays), or the last: from the one before's end.
    if (i < count - 1) return this.apply([{ a: m.start, b: this.member(parent, i + 1).start, put: [] }], until);
    return this.apply([{ a: this.member(parent, i - 1).end, b: m.end, put: [] }], until);
  }

  /**
   * Inserts JSON `json` as child `index` of `parent` (0..count; an object's child named `name`), written as its
   * children are: their separator, indent, and name/value spacing.
   */
  insert(parent: HugeNode | null, index: number, json: string, name: string | null = null, until = Infinity): EditDone {
    this.ready();
    // (null: the top level of an empty document.)
    if (!parent) {
      if (this.doc.summary().root || index !== 0 || name !== null) throw new Error('Not allowed');
      return this.apply([{ a: 0, b: this.doc.src.size, put: piecesOf(enc.encode(this.format(json, '', this.styleOf(null)))) }], until);
    }
    if (parent.kind < ARR) throw new Error('Not allowed');
    if ((parent.kind === OBJ) !== (name !== null)) throw new Error('Not allowed');
    const count = parent.count ?? 0;
    if (index < 0 || index > count) throw new RangeError('Out of range');
    const style = this.styleOf(parent);
    const value = this.format(json, style.indent, style);
    return this.insertText(parent, index, enc.encode((name !== null ? JSON.stringify(name) + style.colon : '') + value), style, until);
  }

  /** Copies child `i` of `parent` right after it (an object member: named "<name> (copy)"). Its bytes aren't read: the copy is the same pieces. */
  duplicate(parent: HugeNode, i: number, until = Infinity): EditDone {
    this.ready();
    const m = this.member(parent, i);
    const style = this.styleOf(parent);
    const src = this.doc.src;
    let head: Piece[] = [];
    let from = m.start;
    if (parent.kind === OBJ) {
      const name = JSON.parse(dec.decode(src.read(m.start, m.keyEnd - m.start))) as string;
      head = piecesOf(enc.encode(JSON.stringify(name + ' (copy)')));
      from = m.keyEnd;
    }
    const body = [...head, ...src.slice(from, m.end)];
    return this.insertPieces(parent, i + 1, body, style, until);
  }

  /** The text of `node` for the normal editor (at most `max` bytes: 'Too big' past that). */
  nodeText(node: HugeNode, max = NODE_TEXT): string {
    if (node.end < 0) throw new Error('Not ready');
    if (node.end - node.start > max) throw new Error('Too big');
    return dec.decode(this.doc.src.read(node.start, node.end - node.start));
  }

  /**
   * Puts `text` (from the normal editor) in place of `node`: re-indented for where it is if it's strict JSON (one
   * value, nothing the normal path only tolerates), else as typed, never repaired: the document then says where
   * it's wrong (the normal path's message), and fixing it there, or undo, makes it valid again.
   */
  replaceNode(node: HugeNode, text: string, until = Infinity): EditDone {
    this.ready();
    let value = text;
    try {
      value = this.format(text, this.indentAt(node.start), this.styleOf(this.parentOf(node)));
    } catch {
      // (Not JSON, or JSON it can't write again (nested too deep): as typed.)
    }
    return this.apply([{ a: node.start, b: node.end, put: piecesOf(enc.encode(value)) }], until);
  }

  // ── How the document is written ─────────────────────────────────────

  private ready() {
    if (!this.doc.done || !this.doc.editable) throw new Error('Not ready');
  }

  private member(parent: HugeNode, i: number) {
    const m = this.doc.memberOf(parent, i);
    if (!m) throw new RangeError('Out of range');
    return m;
  }

  /** The container `node` is in (null: the top level). */
  private parentOf(node: HugeNode): HugeNode | null {
    const loc = this.doc.locate(node.start);
    return loc ? loc.parent : null;
  }

  /** The indent of the line byte `pos` is on (its leading spaces and tabs). */
  private indentAt(pos: number): string {
    const src = this.doc.src;
    const from = Math.max(0, pos - (1 << 16));
    const b = src.read(from, pos - from);
    const i = b.lastIndexOf(10);
    if (i < 0 && from > 0) return '';
    let j = i + 1;
    while (j < b.length && (b[j] === 32 || b[j] === 9)) j++;
    return dec.decode(b.subarray(i + 1, j));
  }

  /**
   * How `parent`'s children are written: what separates them (`,` and the whitespace after it), the indent of
   * their lines, the unit of indent for values that span lines (none: minified), how a name meets its value.
   */
  private styleOf(parent: HugeNode | null): Style {
    const doc = this.doc;
    const src = doc.src;
    const text = (a: number, b: number) => dec.decode(src.read(a, Math.max(0, b - a)));
    // (Top-level values: JSON Lines' are a line each.)
    if (!parent || parent.kind === LIST) return { sep: '\n', indent: '', unit: parent && doc.summary().jsonl ? '' : this.unit(), colon: ': ', lines: true, open: '', close: '' };
    const count = parent.count ?? 0;
    const own = this.indentAt(parent.start);
    let sep = ',';
    let lead = '';
    let colon = ': ';
    if (count >= 2) {
      const a = this.member(parent, 0);
      const b = this.member(parent, 1);
      sep = text(a.end, b.start);
      if (parent.kind === OBJ) colon = text(a.keyEnd, a.value);
    } else if (count === 1) {
      const a = this.member(parent, 0);
      lead = text(parent.start + 1, a.start);
      if (parent.kind === OBJ) colon = text(a.keyEnd, a.value);
      // (No separator to copy: the whitespace after the bracket; on one line, a space if names meet values with one.)
      sep = lead ? ',' + lead : parent.kind === OBJ && colon.endsWith(' ') ? ', ' : ',';
    }
    const pretty = sep.includes('\n') || (count === 0 && this.unit() !== '');
    const indent = sep.includes('\n') ? sep.slice(sep.lastIndexOf('\n') + 1) : pretty ? own + this.unit() : '';
    const unit = pretty ? (indent.startsWith(own) && indent.length > own.length ? indent.slice(own.length) : this.unit() || '  ') : '';
    if (count === 0 && pretty) sep = ',\n' + indent;
    // (No child to copy how a name meets its value from: as the document is written.)
    if (count === 0) colon = pretty ? ': ' : ':';
    return { sep, indent, unit, colon, lines: false, open: pretty ? '\n' + indent : '', close: pretty ? '\n' + own : '' };
  }

  private unitOf: string | null = null;

  /** The document's unit of indent: the first indented line's (none in a minified document). */
  private unit(): string {
    if (this.unitOf !== null) return this.unitOf;
    const b = this.doc.src.read(0, Math.min(this.doc.src.size, 1 << 16));
    let u = '';
    for (let i = b.indexOf(10); i >= 0 && i + 1 < b.length; i = b.indexOf(10, i + 1)) {
      let j = i + 1;
      while (j < b.length && (b[j] === 32 || b[j] === 9)) j++;
      if (j > i + 1 && j < b.length && b[j] !== 10 && b[j] !== 13) {
        u = dec.decode(b.subarray(i + 1, j));
        break;
      }
    }
    this.unitOf = u;
    return u;
  }

  /** JSON `json` written for a place whose line is indented `indent`: with the style's unit, or minified. */
  /** `json` written as `style` says, indented at `indent`; 'Invalid JSON' unless it's strict JSON, one value (the parser's tolerated constructs would be repaired by writing it). */
  private format(json: string, indent: string, style: Style): string {
    const t = parse(json);
    if (t.head.error || t.head.issues.length || t.head.multi || !t.count) throw new Error('Invalid JSON');
    const out = writeTape(t, json, 0, style.unit);
    return style.unit ? out.replace(/\n/g, '\n' + indent) : out;
  }

  /** Inserts the bytes of a member at child `index` of `parent`. */
  private insertText(parent: HugeNode, index: number, member: Uint8Array, style: Style, until: number): EditDone {
    return this.insertPieces(parent, index, piecesOf(member), style, until);
  }

  private insertPieces(parent: HugeNode, index: number, member: Piece[], style: Style, until: number): EditDone {
    const count = parent.count ?? 0;
    const put = (a: number, before: string, after: string): EditDone => this.apply([{ a, b: a, put: [...piecesOf(enc.encode(before)), ...member, ...piecesOf(enc.encode(after))] }], until);
    if (parent.kind === LIST) {
      // JSON Lines: a line of its own.
      if (!count) return put(0, '', '');
      if (index < count) return put(this.member(parent, index).start, '', '\n');
      return put(this.member(parent, count - 1).end, '\n', '');
    }
    if (!count) return this.apply([{ a: parent.start + 1, b: parent.end - 1, put: [...piecesOf(enc.encode(style.open)), ...member, ...piecesOf(enc.encode(style.close))] }], until);
    if (index < count) return put(this.member(parent, index).start, '', style.sep);
    return put(this.member(parent, count - 1).end, style.sep, '');
  }
}

interface Style {
  sep: string;
  indent: string;
  unit: string;
  colon: string;
  lines: boolean;
  /** Inside an empty container: before the first child and after it. */
  open: string;
  close: string;
}
