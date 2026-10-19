import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Match file-based metadata while keeping the public image URLs outside route groups. */
function image(name: 'opengraph-image' | 'twitter-image') {
  const bytes = readFileSync(join(process.cwd(), 'public', `${name}.png`));
  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return {
    url: `/${name}.png?${name}.${version}.png`,
    alt: readFileSync(join(process.cwd(), 'public', `${name}.alt.txt`), 'utf8').trim(),
    type: 'image/png',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

export const englishSocialImages = { openGraph: image('opengraph-image'), twitter: image('twitter-image') };

/** A page's own 1200×630 preview (public/og/<name>.png), versioned by its bytes like the site-wide one. */
export function pageSocialImage(name: string, alt: string) {
  const bytes = readFileSync(join(process.cwd(), 'public', 'og', `${name}.png`));
  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return { url: `/og/${name}.png?v=${version}`, alt, type: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
