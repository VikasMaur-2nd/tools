/** Line offsets and fold pairs, shared by the worker and the code viewer. */
export interface CodeIndex {
  starts: Int32Array<ArrayBuffer>;
  close: Int32Array<ArrayBuffer>;
  depth: Int32Array<ArrayBuffer>;
  maxLen: number;
}

/** Build in bounded steps without allocating one string per output line. */
export function codeIndexer(text: string): (until: number) => CodeIndex | undefined {
  const capacity = Math.min(4096, Math.max(1, text.length >>> 5));
  let starts = new Int32Array(capacity);
  let close = new Int32Array(capacity).fill(-1);
  let depth = new Int32Array(capacity);
  const stack: number[] = [];
  let pos = 0;
  let count = 0;
  let maxLen = 0;
  let done = !text;
  return (until) => {
    while (!done) {
      if (count === starts.length) {
        const n = starts.length * 2;
        const a = new Int32Array(n); a.set(starts); starts = a;
        const b = new Int32Array(n).fill(-1); b.set(close); close = b;
        const c = new Int32Array(n); c.set(depth); depth = c;
      }
      const nl = text.indexOf('\n', pos);
      const end = nl < 0 ? text.length : nl;
      starts[count] = pos;
      maxLen = Math.max(maxLen, end - pos);
      let a = pos;
      while (a < end && (text.charCodeAt(a) === 32 || text.charCodeAt(a) === 9)) a++;
      const first = text.charCodeAt(a);
      if ((first === 125 || first === 93) && stack.length) {
        const open = stack.pop()!;
        if (count > open + 1) close[open] = count;
      }
      let b = end - 1;
      while (b >= pos && (text.charCodeAt(b) === 32 || text.charCodeAt(b) === 9)) b--;
      const last = text.charCodeAt(b);
      if ((last === 123 || last === 91) && !(b === a && (first === 125 || first === 93))) {
        depth[count] = stack.length;
        stack.push(count);
      }
      count++;
      pos = end + 1;
      done = nl < 0;
      if ((count & 1023) === 0 && performance.now() >= until) return;
    }
    return { starts: starts.subarray(0, count), close: close.subarray(0, count), depth: depth.subarray(0, count), maxLen };
  };
}

export interface CodeChange {
  prefix: number;
  suffix: number;
}

/** A scalar replacement cannot add output lines or change any fold pair. */
export function inlineCodeIndexer(index: CodeIndex, length: number, change: CodeChange, patch: string): (until: number) => CodeIndex | undefined {
  const starts = new Int32Array(index.starts.length);
  const delta = patch.length - (length - change.prefix - change.suffix);
  let i = 0;
  let maxLen = 0;
  return (until) => {
    for (; i < starts.length; i++) {
      starts[i] = index.starts[i] + (index.starts[i] > change.prefix ? delta : 0);
      if (i) maxLen = Math.max(maxLen, starts[i] - starts[i - 1] - 1);
      if ((i & 8191) === 8191 && performance.now() >= until) { i++; return; }
    }
    if (starts.length) maxLen = Math.max(maxLen, length + delta - starts[starts.length - 1]);
    return { starts, close: index.close, depth: index.depth, maxLen };
  };
}

/** Compared off-thread: unchanged lines can keep their measured wrapping. */
export function codeChange(old: string, text: string): CodeChange {
  return codeChanger(old, text)(Infinity)!;
}

/** codeChange in bounded steps (the page compares big outputs between input events). */
export function codeChanger(old: string, text: string): (until: number) => CodeChange | undefined {
  const max = Math.min(old.length, text.length);
  let prefix = 0;
  let suffix = 0;
  let end = false;
  return (until) => {
    if (!end) {
      while (prefix + 4096 <= max && old.slice(prefix, prefix + 4096) === text.slice(prefix, prefix + 4096)) {
        prefix += 4096;
        if ((prefix & 0x3ffff) === 0 && performance.now() >= until) return;
      }
      while (prefix < max && old.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
      end = true;
    }
    const left = max - prefix;
    while (suffix + 4096 <= left && old.slice(old.length - suffix - 4096, old.length - suffix) === text.slice(text.length - suffix - 4096, text.length - suffix)) {
      suffix += 4096;
      if ((suffix & 0x3ffff) === 0 && performance.now() >= until) return;
    }
    while (suffix < left && old.charCodeAt(old.length - suffix - 1) === text.charCodeAt(text.length - suffix - 1)) suffix++;
    return { prefix, suffix };
  };
}

/** Reconstruct a worker's small output patch against the version it compared. */
export function applyCodeChange(before: string, patch: string, change: CodeChange, slice = (a: number, b: number) => before.slice(a, b)): string {
  if (change.prefix === before.length && !patch && !change.suffix) return before;
  return slice(0, change.prefix) + patch + (change.suffix ? slice(before.length - change.suffix, before.length) : '');
}
