/*
 * A parse tree in flat arrays, so a worker can hand it to the page cheaply.
 *
 * Structured-cloning a JNode tree with its parent links costs the page about
 * a second per 10 MB of JSON. Packed, the tree is one transferable Int32Array
 * (no copy) plus a small string table; the page rebuilds the nodes in slices
 * (see `unpacker`), so no single task is long.
 *
 * Nodes are stored in document order, six numbers each:
 * [kind | key kind << 3 | value kind << 5, start, end, children, key, value].
 * A string value or number equal to its source text is stored as a slice of
 * it (the page slices the same text); anything else, and every property name,
 * goes in the string table (property names once each).
 */
import { ARR, JNode, NUM, OBJ, type Key, type Kind, type ParseResult } from './parser';

const W = 6;
const K_NONE = 0;
const K_NUM = 1;
const K_STR = 2;
const V_NULL = 0;
const V_TRUE = 1;
const V_FALSE = 2;
const V_SLICE = 3;
const V_STR = 4;

export interface PackedTree {
  /** Everything but the tree. */
  head: Omit<ParseResult, 'root'>;
  nodes: Int32Array;
  strs: string[];
  /** Parent indexes support caret navigation without rebuilding node objects. */
  parents: Int32Array<ArrayBuffer>;
}

/** Packs `res` (parsed from `src`). The node array's buffer can be transferred. */
export function packTree(res: ParseResult, src: string): PackedTree {
  const { root, ...head } = res;
  if (!root) return { head, nodes: new Int32Array(0), strs: [], parents: new Int32Array(0) };
  let out = new Int32Array(Math.max(16, res.nodes + 1) * W);
  let parents = new Int32Array(out.length / W);
  const open: number[] = [];
  const left: number[] = [];
  const strs: string[] = [];
  const keys = new Map<string, number>();
  const str = (s: string) => {
    strs.push(s);
    return strs.length - 1;
  };
  let n = 0;
  const stack: JNode[] = [root];
  while (stack.length) {
    const nd = stack.pop()!;
    let kk = K_NONE;
    let key = 0;
    if (typeof nd.key === 'number') {
      kk = K_NUM;
      key = nd.key;
    } else if (typeof nd.key === 'string') {
      kk = K_STR;
      let k = keys.get(nd.key);
      if (k === undefined) keys.set(nd.key, (k = str(nd.key)));
      key = k;
    }
    let vk = V_NULL;
    let val = 0;
    let kids = 0;
    const v = nd.v;
    if (nd.t >= ARR) kids = (v as JNode[]).length;
    else if (v === true) vk = V_TRUE;
    else if (v === false) vk = V_FALSE;
    else if (typeof v === 'string') {
      // Strings are quoted in the source; numbers are their own text.
      const q = nd.t === NUM ? 0 : 1;
      if (nd.e - nd.s - 2 * q === v.length && src.startsWith(v, nd.s + q)) vk = V_SLICE;
      else {
        vk = V_STR;
        val = str(v);
      }
    }
    if ((n + 1) * W > out.length) {
      const grown = new Int32Array(out.length * 2);
      grown.set(out);
      out = grown;
      const grownParents = new Int32Array(out.length / W);
      grownParents.set(parents);
      parents = grownParents;
    }
    parents[n] = open.length ? open[open.length - 1] : -1;
    if (left.length && --left[left.length - 1] === 0) { open.pop(); left.pop(); }
    if (kids) { open.push(n); left.push(kids); }
    const o = n++ * W;
    out[o] = nd.t | (kk << 3) | (vk << 5);
    out[o + 1] = nd.s;
    out[o + 2] = nd.e;
    out[o + 3] = kids;
    out[o + 4] = key;
    out[o + 5] = val;
    if (kids) {
      const list = v as JNode[];
      for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
    }
  }
  return { head, nodes: out.subarray(0, n * W), strs, parents: parents.subarray(0, n) };
}

/**
 * Rebuilds a packed tree over `src` in steps: call the returned function with
 * a deadline (performance.now() value) until it returns the ParseResult.
 */
export function unpacker(p: PackedTree, src: string): (until: number) => ParseResult | undefined {
  const a = p.nodes;
  const total = a.length / W;
  if (!total) {
    const done = { ...p.head, root: null } as ParseResult;
    return () => done;
  }
  let root: JNode | null = null;
  // Open containers and how many children each still expects.
  const open: JNode[] = [];
  const left: number[] = [];
  let i = 0;
  return (until) => {
    while (i < total) {
      const end = Math.min(total, i + 2048);
      for (; i < end; i++) {
        const o = i * W;
        const meta = a[o];
        const t = (meta & 7) as Kind;
        const kk = (meta >> 3) & 3;
        const vk = (meta >> 5) & 7;
        const s = a[o + 1];
        const e = a[o + 2];
        const kids = a[o + 3];
        const key: Key = kk === K_NUM ? a[o + 4] : kk === K_STR ? p.strs[a[o + 4]] : undefined;
        let v: JNode['v'];
        if (t >= ARR) v = [];
        else if (vk === V_TRUE) v = true;
        else if (vk === V_FALSE) v = false;
        else if (vk === V_SLICE) v = t === NUM ? src.slice(s, e) : src.slice(s + 1, e - 1);
        else if (vk === V_STR) v = p.strs[a[o + 5]];
        else v = null;
        const u = open.length ? open[open.length - 1] : null;
        const nd = new JNode(t, v, s, u ? u.d + 1 : 0, u, key);
        nd.e = e;
        if (u) {
          (u.v as JNode[]).push(nd);
          // Its last child closes a container (its own children, if any, come next).
          if (--left[left.length - 1] === 0) {
            open.pop();
            left.pop();
          }
        } else root = nd;
        if (t >= ARR && kids) {
          open.push(nd);
          left.push(kids);
        }
      }
      if (performance.now() >= until) break;
    }
    return i < total ? undefined : ({ ...p.head, root } as ParseResult);
  };
}

/** Caret path and nearest container, without allocating or walking the whole tree. */
export function packedPosition(tree: PackedTree, off: number, src: string) {
  const a = tree.nodes;
  const parents = tree.parents;
  const count = a.length / W;
  if (!count || off < a[1] || off > a[2]) return null;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (a[mid * W + 1] <= off) lo = mid;
    else hi = mid - 1;
  }
  const before = lo;
  let node = before;
  while (node >= 0 && off > a[node * W + 2]) node = parents[node];
  if (node < 0) return null;
  if ((a[node * W] & 7) === OBJ && off > a[node * W + 1] && before + 1 < count) {
    let next = before + 1;
    while (parents[next] >= 0 && parents[next] !== node) next = parents[next];
    if (parents[next] === node && off < a[next * W + 1]) {
      let prev = before;
      while (parents[prev] >= 0 && parents[prev] !== node) prev = parents[prev];
      const comma = prev === node ? -1 : src.indexOf(',', a[prev * W + 2]);
      if (comma < 0 || comma >= a[next * W + 1] || comma < off) node = next;
    }
  }
  const path: (string | number)[] = [];
  for (let i = node; parents[i] >= 0; i = parents[i]) {
    const meta = a[i * W];
    const key = a[i * W + 4];
    path.push(((meta >> 3) & 3) === K_NUM ? key : tree.strs[key]);
  }
  path.reverse();
  let container = node;
  while (container >= 0 && (a[container * W] & 7) < ARR) container = parents[container];
  return { path, start: container >= 0 ? a[container * W + 1] : -1, end: container >= 0 ? a[container * W + 2] : -1 };
}
