/*
 * Where huge mode's Save writes (HugeSession.save), decided apart from the browser so every way can be tested.
 *
 * Chromium's save picker may empty an existing file the moment it is picked, before anything is written (UI-NOTES 17,
 * CORE-REPORT Round 5). Picking the opened file there would lose the user's file, and with it the document's source
 * (the core reads its unchanged parts from it). So:
 * - With the opened file's handle (huge mode's Open file, a drop on it), Save writes into it.
 * - Without one (Chromium), Save asks: "Overwrite big.json…" picks it with the open picker (which never empties a
 *   file) and checks it is the opened file, as it was opened, before anything is written; "Save as a new file…" uses
 *   the save picker with another name suggested (big (edited).json).
 * - After any save-picker pick, the opened file must still read as it was before anything is written.
 * - Browsers without these pickers download.
 */

/** Where Save goes before anything is picked. */
export type SaveRoute = 'in_place' | 'ask' | 'overwrite' | 'new' | 'download';
/** The answer to "Save changes to big.json". */
export type SaveChoice = 'overwrite' | 'new' | 'cancel';

/** Where Save goes: `as` (Save as), whether the opened file's handle is known, which pickers the browser has. */
export function saveRoute(o: { as: boolean; handle: boolean; openPicker: boolean; savePicker: boolean }): SaveRoute {
  if (!o.as && o.handle) return 'in_place';
  if (o.as || !o.openPicker) return o.savePicker ? 'new' : 'download';
  return 'ask';
}

/** What tells a file from another without reading it. */
export interface FileFacts {
  name: string;
  size: number;
  lastModified: number;
}

/** Is `a` the file `b` was (the same name, size and last change)? */
export const sameFile = (a: FileFacts, b: FileFacts) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** A new file's suggested name: "big.json" → "big (edited).json" (never the opened file's own). */
export function editedName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (edited)${name.slice(dot)}` : `${name} (edited)`;
}

/**
 * Can `file` (the opened file) still be read? Its first and last bytes are read: in Chromium a file changed or
 * emptied since it was opened can't be (NotReadableError); one that got shorter ends before its old end.
 */
export async function readable(file: Blob): Promise<boolean> {
  try {
    const n = Math.min(64, file.size);
    const head = await file.slice(0, n).arrayBuffer();
    const tail = await file.slice(file.size - n).arrayBuffer();
    return head.byteLength === n && tail.byteLength === n;
  } catch {
    return false;
  }
}

/** What a save needs of the page and the browser (HugeSession: the pickers, its dialog, the opened file). */
export interface SaveEnv<H> {
  /** Save as (always a new file). */
  as: boolean;
  /** The opened file's handle. */
  handle: H | null;
  openPicker: boolean;
  savePicker: boolean;
  /** Write permission on `h` (asked of the user if not given yet). */
  writable(h: H): Promise<boolean>;
  /** "Save changes to big.json": overwrite, a new file, or not. */
  ask(): Promise<SaveChoice>;
  /** The open picker (null: closed). */
  pickExisting(): Promise<H | null>;
  /** The save picker with `name` suggested (null: closed). */
  pickSave(name: string): Promise<H | null>;
  /** `h` is the opened file, as it was opened (or last saved). */
  isOpened(h: H): Promise<boolean>;
  /** The opened file still reads as it was. */
  intact(): Promise<boolean>;
  /** The opened file's name. */
  name: string;
}

/**
 * Where to write (`how`, as the huge_save event says it: into `handle` in place or as another file, or downloaded),
 * or why nothing is: closed or cancelled (`cancel`), the file picked to overwrite isn't the opened one as it was
 * (`not_opened`), writing to it wasn't allowed (`not_allowed`), the opened file changed after a save-picker pick
 * (`changed`), the opened file itself picked in the save picker (`is_opened`: Overwrite, or Save, is the way to it).
 */
export type SavePlan<H> = { how: 'in_place' | 'save_as'; handle: H } | { how: 'download'; handle: null } | { stop: 'cancel' | 'not_opened' | 'not_allowed' | 'changed' | 'is_opened' };

export async function planSave<H>(env: SaveEnv<H>): Promise<SavePlan<H>> {
  let route = saveRoute({ ...env, handle: env.handle !== null });
  // (Writing into it not allowed: asked, as without its handle.)
  if (route === 'in_place' && !(await env.writable(env.handle!))) route = env.openPicker ? 'ask' : 'new';
  if (route === 'ask') {
    const a = await env.ask();
    if (a === 'cancel') return { stop: 'cancel' };
    route = a;
  }
  switch (route) {
    case 'in_place':
      return { how: 'in_place', handle: env.handle! };
    case 'overwrite': {
      const h = await env.pickExisting();
      if (!h) return { stop: 'cancel' };
      // (Another file, or this one changed since it was opened: nothing written.)
      if (!(await env.isOpened(h))) return { stop: 'not_opened' };
      if (!(await env.writable(h))) return { stop: 'not_allowed' };
      return { how: 'in_place', handle: h };
    }
    case 'new': {
      if (!env.savePicker) return { how: 'download', handle: null };
      const h = await env.pickSave(editedName(env.name));
      if (!h) return { stop: 'cancel' };
      // The save picker may have emptied what was picked (the opened file, picked anyway): saving reads the opened
      // file's unchanged parts, so it must still be as it was, or nothing is written over anything.
      if (!(await env.intact())) return { stop: 'changed' };
      // The opened file itself, not emptied this time: nothing written; Overwrite (or Save) is the way to it, the save
      // window being the one that may empty it.
      if (await env.isOpened(h)) return { stop: 'is_opened' };
      return { how: 'save_as', handle: h };
    }
    default:
      return { how: 'download', handle: null };
  }
}
