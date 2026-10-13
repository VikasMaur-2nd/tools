'use client';

import { keyLabel } from '@/lib/engine/commands';
import { useUI } from '@/lib/engine/store';

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
