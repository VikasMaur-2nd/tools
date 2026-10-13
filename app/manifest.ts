import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest and linked from <head> automatically.
// Static (no request-time APIs), so it is prerendered at build time.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'JSON Viewer & Formatter',
    short_name: 'JSON Viewer',
    description:
      'Fast, private JSON viewer, formatter, validator and repair tool. Explore JSON as a tree or table. Works offline — your data never leaves your device.',
    lang: 'en',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0C0D10',
    theme_color: '#0C0D10',
    categories: ['developer', 'productivity', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Installed app becomes an OS handler for .json files (delivered via window.launchQueue).
    file_handlers: [{ action: '/', accept: { 'application/json': ['.json'] } }],
    launch_handler: { client_mode: ['focus-existing', 'auto'] },
    prefer_related_applications: false,
  };
}
