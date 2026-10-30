'use client';

import { useUI } from '@/lib/engine/store';

/** Formats a shortcut for display. */
export function keyLabel(keys: string, mac: boolean): string[] {
  return (keys.startsWith('+') ? [keys] : keys.split('+')).map((k) => {
    if (k === 'mod') return mac ? '⌘' : 'Ctrl';
    if (k === 'Shift') return mac ? '⇧' : 'Shift';
    if (k === 'Alt') return mac ? '⌥' : 'Alt';
    if (k === 'Enter') return '↵';
    return k;
  });
}

export function Kbd({ k }: { k: string }) {
  const mac = useUI((s) => s.mac);
  return (
    <span className="kbd">
      {keyLabel(k, mac).map((p, i) => (
        <kbd key={i}>{p}</kbd>
      ))}
    </span>
  );
}
