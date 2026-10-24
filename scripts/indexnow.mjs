import { SITE } from '../lib/site.ts';

const KEY = '8aed511326b3f7044318fed745c91048';
const SITEMAP_URL = `${SITE}/sitemap.xml`;
const KEY_LOCATION = `${SITE}/${KEY}.txt`;

const sitemapResponse = await fetch(SITEMAP_URL);
if (!sitemapResponse.ok) {
  throw new Error(`Could not read ${SITEMAP_URL}: HTTP ${sitemapResponse.status}`);
}

const sitemap = await sitemapResponse.text();
const urlList = [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1]);
if (urlList.length === 0) {
  throw new Error(`No URLs found in ${SITEMAP_URL}`);
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: new URL(SITE).host,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList,
  }),
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`IndexNow rejected ${urlList.length} URLs: HTTP ${response.status} ${body}`);
}

console.log(`Submitted ${urlList.length} URLs to IndexNow for ${new URL(SITE).host}.`);
