'use client';

import { useEffect, useState } from 'react';

/** Copies fixed text (published code, never a document) and says so for a moment. */
export default function CopyButton({ text, label = 'Copy', name, className }: { text: string; label?: string; name?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button type="button" className={className} aria-label={name} onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}>
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}
