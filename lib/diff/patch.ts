/**
 * RFC 6902 JSON Patch from a diff. Changes are already in application order
 * with sequentially valid pointers (`Change.at`), so each maps to one op.
 * Values are written from the source nodes, so numbers stay lossless.
 */

import { ARR, JNode, OBJ, STR } from '../json/parser';
import { stringify } from '../json/format';
import type { Change, Seg } from './diff';

export interface PatchOp {
  op: 'add' | 'remove' | 'replace';
  /** JSON Pointer (RFC 6901). */
  path: string;
  value?: JNode;
}

/** RFC 6901 JSON Pointer for path segments (`''` = the whole document). */
export function pointer(segs: readonly Seg[]): string {
  let s = '';
  for (const k of segs) {
    const t = String(k);
    s += '/' + (t.includes('~') || t.includes('/') ? t.replace(/~/g, '~0').replace(/\//g, '~1') : t);
  }
  return s;
}

/** Patch that turns the left document into the right one (key-order-only changes have no JSON Patch equivalent). */
export function toPatch(changes: readonly Change[]): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const c of changes) {
    if (c.order) continue;
    const path = pointer(c.at);
    if (c.kind === 'added') ops.push({ op: 'add', path, value: c.right });
    else if (c.kind === 'removed') ops.push({ op: 'remove', path });
    else ops.push({ op: 'replace', path, value: c.right });
  }
  return ops;
}

/** Serializes a patch as JSON (`indent` = '' for one line). */
export function patchText(ops: readonly PatchOp[], indent: string): string {
  const root = new JNode(ARR, [], 0, 0, null, undefined);
  const list = root.v as JNode[];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const o = new JNode(OBJ, [], 0, 1, root, i);
    const props = o.v as JNode[];
    props.push(new JNode(STR, op.op, 0, 2, o, 'op'), new JNode(STR, op.path, 0, 2, o, 'path'));
    const v = op.value;
    // a shallow alias under the key "value" (stringify only reads kinds, values and child keys)
    if (v) props.push(new JNode(v.t, v.v, v.s, 2, o, 'value'));
    list.push(o);
  }
  return stringify(root, indent);
}
