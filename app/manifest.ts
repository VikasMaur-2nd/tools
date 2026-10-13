import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest and linked from <head> automatically.
// Static (no request-time APIs), so it is prerendered at build time.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Tool Kumar · JSON Formatter & Viewer',
    short_name: 'Tool Kumar',
    description:
      'Fast, private JSON formatter and viewer. Format, validate, repair, convert and compare JSON, and explore it as a tree or table. Works offline, and your data never leaves your device.',
    lang: 'en',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#000000',
    theme_color: '#000000',
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
