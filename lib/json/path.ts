import { JNode, kids, isContainer, OBJ } from './parser';

export type Seg = string | number;

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** Digit segments become array indices; `01` stays a string so it can still name an object key. */
const INDEX = /^(?:0|[1-9]\d{0,14})$/;
const seg = (p: string): Seg => (INDEX.test(p) ? Number(p) : p);
/** What String.prototype.trim removes. */
const WS = /\s/;

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

/**
 * Parses `$.a.b[0]["c d"]`, `a.b[0]`, `.a.b` or `/a/b/0` (JSON Pointer). Returns null if malformed (a JSON
 * Pointer's ~ not ~0 or ~1 included), and for text that starts with `$` but not `$.`, `$[` or `$` alone:
 * `$type`, `$ref` are key names (searched as text), not a path below the root.
 *
 * Whitespace around a path (pasted text) is left out, but a JSON Pointer's tokens are read as they are: only
 * whitespace before its first `/` and line breaks after its end go, so `/a ` names the key "a ".
 */
export function parsePath(q: string): Seg[] | null {
  let p = 0;
  while (p < q.length && WS.test(q[p])) p++;
  if (q[p] === '/') {
    let e = q.length;
    while (e > p && (q.charCodeAt(e - 1) === 10 || q.charCodeAt(e - 1) === 13)) e--;
    const parts = q.slice(p + 1, e).split('/');
    // (RFC 6901: ~ only as ~0 or ~1.)
    if (parts.some((t) => /~(?![01])/.test(t))) return null;
    return parts.map((t) => seg(t.replace(/~1/g, '/').replace(/~0/g, '~')));
  }
  let s = q.trim();
  if (!s) return [];
  if (s[0] === '$') {
    if (s.length > 1 && s[1] !== '.' && s[1] !== '[') return null;
    s = s.slice(1);
  }
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
      // Of a duplicated key, the last member (JSON.parse semantics, as the Table and Compare read it).
      const key = String(k);
      let hit: JNode | null = null;
      for (let i = list.length - 1; i >= 0 && !hit; i--) if (list[i].key === key) hit = list[i];
      n = hit;
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
