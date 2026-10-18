/** Cache this page and the assets it has used with the site's existing service worker. */
export async function cacheTool() {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    const urls = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => url.startsWith(location.origin + '/') && !url.includes('/_vercel/'));
    registration.active?.postMessage({ type: 'cache', urls: [...new Set([location.href, ...urls])] });
  } catch { /* Offline caching must never interrupt a local operation. */ }
}
