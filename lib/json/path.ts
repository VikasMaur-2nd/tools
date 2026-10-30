import { JNode, kids, isContainer, OBJ } from './parser';

export type Seg = string | number;

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** Digit segments become array indices; `01` stays a string so it can still name an object key. */
const INDEX = /^(?:0|[1-9]\d{0,14})$/;
const seg = (p: string): Seg => (INDEX.test(p) ? Number(p) : p);

export function pathOf(node: JNode): Seg[] {
  const segs: Seg[] = [];
  for (let n: JNode | null = node; n && n.u; n = n.u) segs.push(n.key as Seg);
  return segs.reverse();
}

/** `$.users[0]["first name"]` */
export function formatPath(segs: Seg[]): string {
  let s = '$';
  for (const k of segs) {
    if (typeof k === 'number') s += `[${k}]`;
    else s += IDENT.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
  }
  return s;
}

/** Parses `$.a.b[0]["c d"]`, `a.b[0]`, `.a.b` or `/a/b/0` (JSON Pointer). Returns null if malformed (a JSON Pointer's ~ not ~0 or ~1 included). */
export function parsePath(q: string): Seg[] | null {
  let s = q.trim();
  if (s.startsWith('/') || s === '') {
    if (!s) return [];
    const parts = s.slice(1).split('/');
    // (RFC 6901: ~ only as ~0 or ~1.)
    if (parts.some((p) => /~(?![01])/.test(p))) return null;
    return parts.map((p) => seg(p.replace(/~1/g, '/').replace(/~0/g, '~')));
  }
  if (s[0] === '$') s = s.slice(1);
  const segs: Seg[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '.') {
      i++;
      let j = i;
      while (j < s.length && s[j] !== '.' && s[j] !== '[') j++;
      if (j === i) return null;
      segs.push(s.slice(i, j));
      i = j;
    } else if (c === '[') {
      let j = i + 1;
      while (s[j] === ' ') j++;
      const q = s[j];
      if (q === '"' || q === "'") {
        // quoted key: may itself contain `]`, quotes (escaped) or line separators
        let k = j + 1;
        while (k < s.length && s[k] !== q) k += s[k] === '\\' ? 2 : 1;
        if (k >= s.length) return null;
        try {
          segs.push(q === '"' ? JSON.parse(s.slice(j, k + 1)) : s.slice(j + 1, k).replace(/\\(['\\])/g, '$1'));
        } catch {
          return null;
        }
        j = k + 1;
        while (s[j] === ' ') j++;
        if (s[j] !== ']') return null;
      } else {
        const end = s.indexOf(']', j);
        if (end < 0) return null;
        const inner = s.slice(j, end).trim();
        if (!/^\d+$/.test(inner)) return null;
        segs.push(seg(inner));
        j = end;
      }
      i = j + 1;
    } else if (i === 0) {
      let j = i;
      while (j < s.length && s[j] !== '.' && s[j] !== '[') j++;
      segs.push(s.slice(i, j));
      i = j;
    } else return null;
  }
  return segs;
}

export function resolve(root: JNode | null, segs: Seg[]): JNode | null {
  let n = root;
  for (const k of segs) {
    if (!n || !isContainer(n)) return null;
    // (A container from a tape whose children aren't made: found there, without making them.)
    if (n.z && n._v === undefined) {
      n = n.z.child(n, k);
      continue;
    }
    const list = kids(n);
    if (n.t === OBJ) {
      const key = String(k);
      n = list.find((c) => c.key === key) ?? null;
    } else {
      n = typeof k === 'number' || /^\d+$/.test(k) ? (list[Number(k)] ?? null) : null;
    }
  }
  return n;
}

/**
 * Deepest node whose source range contains `off`. A caret on a property name
 * resolves to that property's value (key text sits between siblings).
 */
export function nodeAt(root: JNode | null, off: number, src: string): JNode | null {
  if (!root || off < root.s || off > root.e) return null;
  // (A tree from a tape: found there, making only that node and its ancestors.)
  if (root.z && !root.u) return root.z.nodeAtOffset(off);
  let n = root;
  for (;;) {
    if (!isContainer(n)) return n;
    const list = kids(n);
    let lo = 0;
    let hi = list.length - 1;
    let hit: JNode | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = list[mid];
      if (off < c.s) hi = mid - 1;
      else if (off > c.e) lo = mid + 1;
      else {
        hit = c;
        break;
      }
    }
    if (!hit && n.t === OBJ && lo < list.length && off > n.s) {
      // On the next property's key unless the caret is still before the comma
      // that ends the previous value (keys may contain commas themselves).
      const next = list[lo];
      const comma = lo ? src.indexOf(',', list[lo - 1].e) : -1;
      if (comma < 0 || comma >= next.s || comma < off) hit = next;
    }
    if (!hit) return n;
    n = hit;
  }
}
