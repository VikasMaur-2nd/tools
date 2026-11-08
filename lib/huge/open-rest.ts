/*
 * The rest of huge mode's entry (./open.ts starts the core's worker first, then loads this): checks the file is
 * JSON text, makes its source and opens a session on it, with its viewer.
 */
import { looksBinary, binaryFile } from '../engine/asks';
import type { InputSource } from '../analytics/events';
import { reportError } from '../analytics';
import { createElement, type ReactNode } from 'react';
import { kit } from './kit';
import { HUGE_MIN } from './min';
import { CoreSource } from './core-source';
import type { HugeClient } from './client';
import type { HugeProgress } from './types';
import HugeTool from '@/components/huge/HugeTool';
import { SmallSource, type SmallOptions } from './small-source';
import { HugeSession, type HugeHook, type HugeHost } from './session';
import { takeHandle } from './handles';

type Kit = typeof kit;

/** Files opened: each one's viewer is a new one (its React key). */
let opened = 0;

/** The core's client started by ./open.ts, and how to take its progress (what came before included). */
export interface Started {
  client: HugeClient;
  take(onProgress: (p: HugeProgress) => void): void;
}

/** See ./open.ts `openHuge`. `started`: the core's worker, already on its way (null: the simulated index). */
export async function openRest(host: HugeHost, file: File, source: InputSource, signal: AbortSignal, asText: boolean, Scroll: Kit['Scroll'], started: Started | null, sim: SmallOptions | null, closed?: () => void): Promise<HugeHook | null> {
  try {
    kit.Scroll = Scroll;
    kit.Editor ??= Object.getPrototypeOf(host.ed).constructor as typeof kit.Editor;
    let forced = false;
    try {
      // (Opened by the debug override, not by its size: said so in the huge_opened event.)
      forced = !!localStorage.getItem('tk:hugeMin') && file.size <= HUGE_MIN;
    } catch {
      /* storage refused */
    }
    return await open(host, file, source, signal, forced, asText, started, sim, closed);
  } catch (e) {
    started?.client.close();
    reportError(e, 'huge');
    if (!signal.aborted) host.toast(`Couldn't read ${file.name}`, 'err');
    return null;
  }
}

/** The open session's hook for the engine (null: nothing opened). `closed`: told when the session closes. */
async function open(host: HugeHost, file: File, source: InputSource, signal: AbortSignal, forced: boolean, asText: boolean, started: Started | null, sim: SmallOptions | null, closed?: () => void): Promise<HugeHook | null> {
  const src = started ? new CoreSource(file, file.name, (onProgress) => (started.take(onProgress), started.client)) : null;
  // (Its first 64 KB tell whether it is text at all.)
  const head = asText ? '' : await file.slice(0, 65_536).text();
  if (signal.aborted || looksBinary(head)) {
    src?.destroy();
    if (!signal.aborted) host.toast(...binaryFile(file.name, () => void host.loadFile(file, source, true)));
    return null;
  }
  const source_ = src ?? new SmallSource(await file.text(), file.name, sim!);
  if (signal.aborted) {
    source_.destroy();
    return null;
  }
  const key = String(++opened);
  // (`closed`: a .gz file's decompressed copy, removed when the session closes: not a file of the user's to overwrite.)
  const meta = { name: file.name, source, forced, size: file.size, lastModified: file.lastModified, handle: await takeHandle(file), file, copy: !!closed };
  const session: HugeSession = new HugeSession(host, source_, meta, (portal): ReactNode => createElement(HugeTool, { key, portal }));
  if (closed) session.onClose(closed);
  signal.addEventListener('abort', () => session.close(), { once: true });
  // (Shown at once; its root comes as the index reads it.)
  void session.start();
  return session.hook;
}
