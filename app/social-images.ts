import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Match file-based metadata while keeping the public image URL outside route groups. */
function image(name: 'opengraph-image') {
  const bytes = readFileSync(join(process.cwd(), 'public', `${name}.png`));
  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return { url: `/${name}.png?${name}.${version}.png`, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The site-wide preview, versioned by its bytes; pages describe it in their language (app/page-metadata.ts). */
export const siteSocialImage = image('opengraph-image');

/** A page's own 1200×630 preview (public/og/<name>.png), versioned by its bytes like the site-wide one. */
export function pageSocialImage(name: string, alt: string) {
  const bytes = readFileSync(join(process.cwd(), 'public', 'og', `${name}.png`));
  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return { url: `/og/${name}.png?v=${version}`, alt, type: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
