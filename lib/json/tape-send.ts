/*
 * Making and sending tapes (worker side; the page only receives them: tape.ts `receiver`).
 */
import { ARR, NUM, STR, type JNode, type ParseResult } from './parser';
import { emptyTape, KEY_INDEX, KEY_NAME, KEY_NONE, SIZE_BIG, VALUE_EXTRA, VALUE_FALSE, VALUE_NONE, VALUE_NULL, VALUE_RAW, VALUE_SLICE, VALUE_TRUE, W, type SentTape, type Tape } from './tape';

/** `t` ready to post, and what to transfer with it. The tape's own buffer is transferred: don't use `t` after. */
export function sendable(t: Tape): { sent: SentTape; transfer: ArrayBuffer[] } {
  const extra = t.extra ? [...t.extra] : [];
  const strs = extra.length ? t.keys.concat(extra.map((x) => x[1])) : t.keys;
  let length = 0;
  for (const s of strs) length += s.length;
  const text = new Uint16Array(length);
  const offsets = new Int32Array(strs.length + 1);
  let at = 0;
  for (let k = 0; k < strs.length; k++) {
    offsets[k] = at;
    const s = strs[k];
    for (let j = 0; j < s.length; j++) text[at++] = s.charCodeAt(j);
  }
  offsets[strs.length] = at;
  const extraAt = new Int32Array(extra.map((x) => x[0]));
  const nodes = t.nodes.length > t.count * W * 1.25 ? t.nodes.slice(0, t.count * W) : t.nodes;
  const sent: SentTape = { nodes, count: t.count, text, offsets, keyCount: t.keys.length, extraAt, big: t.big ? [...t.big] : [], head: t.head };
  return { sent, transfer: [nodes.buffer, text.buffer, offsets.buffer, extraAt.buffer] };
}

// ── From a JNode tree (the old parser's result; tests compare the two) ─────────

/** The tape of `res` (parsed from `src`). */
export function tapeOf(res: ParseResult, src: string): Tape {
  const { root, ...head } = res;
  if (!root) return emptyTape(head);
  let nodes = new Int32Array(Math.max(1, res.nodes) * W + W);
  const keys: string[] = [];
  const keyIndex = new Map<string, number>();
  let extra: Map<number, string> | null = null;
  let big: Map<number, number> | null = null;
  let count = 0;
  // Iterative pre-order; each container's size is set when its subtree is done.
  const stack: { n: JNode; parent: number; at: number; next: number }[] = [];
  const emit = (n: JNode, parent: number): number => {
    const i = count++;
    const o = i * W;
    if (o + W > nodes.length) {
      const grown = new Int32Array(nodes.length * 2);
      grown.set(nodes);
      nodes = grown;
    }
    let kk = KEY_NONE;
    let key = 0;
    if (typeof n.key === 'number') {
      kk = KEY_INDEX;
      key = n.key;
    } else if (typeof n.key === 'string') {
      kk = KEY_NAME;
      let k = keyIndex.get(n.key);
      if (k === undefined) {
        k = keys.length;
        keys.push(n.key);
        keyIndex.set(n.key, k);
      }
      key = k;
    }
    let vk: number;
    const v = n.v;
    if (n.t >= ARR) vk = VALUE_NONE;
    else if (v === true) vk = VALUE_TRUE;
    else if (v === false) vk = VALUE_FALSE;
    else if (v === null) vk = VALUE_NULL;
    else {
      const s = v as string;
      if (n.t === NUM ? n.e - n.s === s.length && src.startsWith(s, n.s) : n.t === STR && src.charCodeAt(n.s) === 34 && n.e - n.s - 2 === s.length && src.startsWith(s, n.s + 1)) vk = VALUE_SLICE;
      else if (n.t === STR && n.e - n.s === s.length && src.startsWith(s, n.s)) vk = VALUE_RAW;
      else {
        vk = VALUE_EXTRA;
        (extra ??= new Map()).set(i, s);
      }
    }
    nodes[o] = n.t | (kk << 3) | (vk << 5) | (1 << 8);
    nodes[o + 1] = n.s;
    nodes[o + 2] = n.e;
    nodes[o + 3] = parent;
    nodes[o + 4] = key;
    return i;
  };
  const setSize = (i: number) => {
    const size = count - i;
    const o = i * W;
    if (size >= SIZE_BIG) {
      (big ??= new Map()).set(i, size);
      nodes[o] = (nodes[o] & 0xff) | (SIZE_BIG << 8);
    } else nodes[o] = (nodes[o] & 0xff) | (size << 8);
  };
  const first = emit(root, -1);
  if (root.t >= ARR) stack.push({ n: root, parent: -1, at: first, next: 0 });
  while (stack.length) {
    const top = stack[stack.length - 1];
    const list = top.n.v as JNode[];
    if (top.next === list.length) {
      setSize(top.at);
      stack.pop();
      continue;
    }
    const child = list[top.next++];
    const at = emit(child, top.at);
    if (child.t >= ARR) stack.push({ n: child, parent: top.at, at, next: 0 });
  }
  return { nodes, count, keys, big, extra, head };
}

