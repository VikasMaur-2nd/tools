/*
 * The opened file's handle (File System Access, Chromium), so Save writes into the file itself. Huge mode's own
 * "Open file" (showOpenFilePicker) and a file dropped while huge mode is open give one. The engine's file input,
 * and the drop that first opens a big file, don't: asking for it there would add to every page's first load. A
 * file opened here still goes through Engine.loadFile like any other; its handle waits here until the session
 * for that file opens (open-rest.ts).
 */

/** A handle on its way, and the file it is for. */
let pending: { file: File; handle: Promise<FileSystemFileHandle | null> } | null = null;

const same = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** The handle kept for `file` (null: none), taken: the next file has none unless it brings its own. */
export async function takeHandle(file: File): Promise<FileSystemFileHandle | null> {
  const p = pending;
  if (!p || !same(p.file, file)) return null;
  pending = null;
  return p.handle;
}

const TYPES = [{ description: 'JSON', accept: { 'application/json': ['.json', '.jsonl', '.ndjson', '.geojson'], 'text/plain': ['.txt', '.log'] } }];

/** Opens a file with the system's picker, keeping its handle; false where there is none (use the file input). */
export async function pickFile(load: (f: File) => void): Promise<boolean> {
  const w = window as unknown as { showOpenFilePicker?(o: object): Promise<FileSystemFileHandle[]> };
  if (!w.showOpenFilePicker) return false;
  let handle: FileSystemFileHandle;
  try {
    [handle] = await w.showOpenFilePicker({ types: TYPES, excludeAcceptAllOption: false });
  } catch {
    // (Closed without a file: nothing to open.)
    return true;
  }
  const file = await handle.getFile();
  pending = { file, handle: Promise.resolve(handle) };
  load(file);
  return true;
}

/** While huge mode is open: a file dropped keeps its handle (it can only be asked for during the drop). */
export function watchDrops(): () => void {
  const on = (e: DragEvent) => {
    const item = e.dataTransfer?.items?.[0] as (DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> }) | undefined;
    const file = e.dataTransfer?.files?.[0];
    if (!item?.getAsFileSystemHandle || !file) return;
    const handle = item.getAsFileSystemHandle().then(
      (h) => (h && h.kind === 'file' ? (h as FileSystemFileHandle) : null),
      () => null,
    );
    pending = { file, handle };
  };
  window.addEventListener('drop', on, true);
  return () => window.removeEventListener('drop', on, true);
}

/** Read and write permission on `h` (asked of the user if not given yet: a dropped file's starts read-only). */
export async function writable(h: FileSystemFileHandle): Promise<boolean> {
  const p = h as unknown as { queryPermission?(o: object): Promise<string>; requestPermission?(o: object): Promise<string> };
  const o = { mode: 'readwrite' };
  try {
    if ((await p.queryPermission?.(o)) === 'granted') return true;
    return (await p.requestPermission?.(o)) === 'granted';
  } catch {
    return false;
  }
}

/** Which pickers this browser has (Chromium: both; the others: none, Save downloads). */
export const pickers = () => ({ openPicker: 'showOpenFilePicker' in window, savePicker: 'showSaveFilePicker' in window });

/**
 * A file to write into, picked with the open picker: unlike the save picker, picking never empties it (UI-NOTES 17).
 * Null if the user closed it.
 */
export async function pickExisting(): Promise<FileSystemFileHandle | null> {
  const w = window as unknown as { showOpenFilePicker(o: object): Promise<FileSystemFileHandle[]> };
  try {
    const [handle] = await w.showOpenFilePicker({ types: TYPES, excludeAcceptAllOption: false });
    return handle ?? null;
  } catch {
    return null;
  }
}

/**
 * The save picker (Chromium): a handle, null if the user closed it, undefined where there is none (download).
 * Picking an existing file may empty it at once (Chromium), before anything is written: `name` is never the opened
 * file's own (save-plan.ts editedName), and the opened file is checked after (HugeSession.save).
 */
export async function pickSave(name: string): Promise<FileSystemFileHandle | null | undefined> {
  const w = window as unknown as { showSaveFilePicker?(o: object): Promise<FileSystemFileHandle> };
  if (!w.showSaveFilePicker) return undefined;
  try {
    return await w.showSaveFilePicker({ suggestedName: name, types: TYPES });
  } catch {
    return null;
  }
}
