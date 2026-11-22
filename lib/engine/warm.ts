/**
 * What a page hands the service worker once it has warmed up (Engine.registerSW): its pages and the app's files it
 * loaded, never what it fetched for the visitor (a document or a schema by URL, by fetch or XHR): the worker would
 * fetch that again, with cookies, and keep it.
 */
export function warmUrls(entries: { name: string; initiatorType: string }[], origin: string, pathname: string): string[] {
  const home = /^\/[a-z]{2}(?=\/|$)/.exec(pathname)?.[0] || '/';
  // (The app's own files, named by their content, whatever loaded them: chunks, workers' wasm, dictionaries.)
  const app = (u: string) => /^\/(?:_next\/static\/|i18n\/[a-z]+-strings\.)/.test(new URL(u).pathname);
  const files = entries
    .filter((e) => e.name.startsWith(origin + '/') && !e.name.includes('/_vercel/') && (app(e.name) || !/^(?:fetch|xmlhttprequest|beacon)$/.test(e.initiatorType)))
    .map((e) => e.name);
  return [...new Set([origin + '/', origin + home, origin + pathname, ...files])];
}
