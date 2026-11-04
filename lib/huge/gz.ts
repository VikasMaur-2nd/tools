/*
 * A .json.gz / .jsonl.gz file (Engine.loadFile sends every .gz here): decompressed in the stream worker
 * (DecompressionStream), in memory when it is small enough for the editor (then opened there, as if the file
 * had been plain), else into a file in the origin's private storage (OPFS, after checking there is room),
 * which then opens in huge mode and is deleted when it closes. Progress and Cancel show where the editor was.
 */
import { createElement } from 'react';
import { reportError, track } from '../analytics';
import type { Events, InputSource } from '../analytics/events';
import { store } from '../engine/store';
import { rt } from '../i18n/ui';
import HugeGz from '@/components/huge/HugeGz';
import { hugeSize, type HugeHost } from './session';
import { StreamClient, StreamError, freeSpace, gzSize, hold, removeTemp, tempName } from './stream/client';

export interface GzState {
  name: string;
  /** Compressed bytes, read so far, decompressed so far. */
  size: number;
  read: number;
  out: number;
  eta: number | null;
  /** Goes to OPFS (huge mode), not to the editor. */
  big: boolean;
}

export class GzStore {
  private s: GzState;
  private ls = new Set<() => void>();
  constructor(s: GzState) {
    this.s = s;
  }
  get = () => this.s;
  subscribe = (f: () => void) => {
    this.ls.add(f);
    return () => void this.ls.delete(f);
  };
  set(patch: Partial<GzState>) {
    this.s = { ...this.s, ...patch };
    for (const f of this.ls) f();
  }
}

/** What opening the decompressed big file needs: opens it in huge mode; `closed` runs when that session closes. */
export type OpenBig = (file: File, closed: () => void) => Promise<unknown>;

/** Opens .gz file `file`: in the editor (decompressed size up to `limit`), or in huge mode through `big`. */
export async function openGz(host: HugeHost, file: File, source: InputSource, signal: AbortSignal, limit: number, big: OpenBig): Promise<void> {
  const began = performance.now();
  const plain = file.name.replace(/\.gz$/i, '') || 'data.json';
  const report = (outcome: Events['huge_gz']['outcome']) => track('huge_gz', { outcome, size: hugeSize(file.size), ms: Math.round(performance.now() - began) });
  const est = await gzSize(file);
  if (signal.aborted) return;
  if (est === null) {
    report('error');
    host.toast(`Couldn't open ${file.name}: it isn't a gzip file`, 'err');
    return;
  }
  const toDisk = est > limit;
  if (toDisk) {
    const free = await freeSpace();
    if (free !== null && free < est) {
      report('space');
      host.toast(`Not enough free disk space to decompress ${file.name}: it needs about ${rt.bytes(est)}, ${rt.bytes(free)} is free`, 'err', undefined, 10_000);
      return;
    }
  }
  const ui = new GzStore({ name: file.name, size: file.size, read: 0, out: 0, eta: null, big: toDisk });
  const client = new StreamClient();
  const name = tempName(plain, 'tmp');
  const release = hold(name);
  const samples: [number, number][] = [];
  const run = client.gunzip(file, name, limit, (read, total, out) => {
    const now = performance.now();
    samples.push([now, read]);
    while (samples.length > 2 && now - samples[0][0] > 3000) samples.shift();
    const rate = now > samples[0][0] + 300 ? ((read - samples[0][1]) / (now - samples[0][0])) * 1000 : 0;
    ui.set({ read, size: total, out, big: ui.get().big || out > limit, eta: rate > 0 ? (total - read) / rate : null });
  });
  const viewer = () => createElement(HugeGz, { store: ui, cancel: () => run.stop() });
  store.set({ huge: viewer });
  const stop = () => run.stop();
  signal.addEventListener('abort', stop, { once: true });
  const leave = () => {
    if (store.get().huge === viewer) store.set({ huge: null });
  };
  try {
    const r = await run.done;
    signal.removeEventListener('abort', stop);
    client.close();
    if (signal.aborted) {
      release();
      if (r.file) void removeTemp(name);
      leave();
      return;
    }
    if (r.blob) {
      release();
      leave();
      report('editor');
      await host.loadFile(new File([r.blob], plain, { type: 'application/json' }), source, false);
      return;
    }
    report('huge');
    // (The decompressed file lives as long as its huge session; a Blob of it reads the disk, no copy.)
    await big(new File([r.file!], plain), () => {
      release();
      void removeTemp(name);
    });
    leave();
  } catch (e) {
    signal.removeEventListener('abort', stop);
    client.close();
    release();
    void removeTemp(name);
    leave();
    const msg = e instanceof StreamError ? e.message : '';
    if (msg === 'Stopped') {
      report('stopped');
      host.focusEditor();
      return;
    }
    if (msg === 'Not enough storage space') {
      report('space');
      host.toast(`Not enough free disk space to decompress ${file.name}`, 'err', undefined, 10_000);
      return;
    }
    report('error');
    if (msg !== 'Not a gzip file') reportError(e, 'huge');
    host.toast(`Couldn't decompress ${file.name}: it isn't valid gzip`, 'err');
  }
}
