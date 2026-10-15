import { cloneElement, type ReactElement, type ReactNode } from 'react';

/**
 * A translated sentence with links: `<blog>Tool Kumar JSON blog</blog>` in the
 * string renders as `tags.blog` with that text as its children, so translators
 * can move links around inside the sentence. Unknown tags render as plain text.
 */
export function rich(text: string, tags: Record<string, ReactElement<{ children?: ReactNode }>>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(tags[m[1]] ? cloneElement(tags[m[1]], { key: m.index }, m[2]) : m[2]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
