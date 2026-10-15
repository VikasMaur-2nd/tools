// JS and HTML weight of pages served by `pnpm start`: every non-module script a page loads, gzipped.
// usage: node scripts/bundle-report.mjs [base-url] [path ...]
//   default base http://localhost:3000, default paths / /tools/json-validator /es /es/tools/json-validator
import { gzipSync } from 'node:zlib';

const [base = 'http://localhost:3000', ...rest] = process.argv.slice(2);
const paths = rest.length ? rest : ['/', '/tools/json-validator', '/es', '/es/tools/json-validator'];
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(2)} KB`;

const rows = [];
for (const path of paths) {
  const res = await fetch(base + path);
  if (!res.ok) {
    rows.push({ path, status: res.status });
    continue;
  }
  const html = Buffer.from(await res.arrayBuffer());
  const text = html.toString('utf8');
  // Scripts the page runs (async chunks); `noModule` polyfills only load in legacy browsers.
  const srcs = [...text.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)]
    .filter((m) => !/noModule/i.test(m[1] + m[3]))
    .map((m) => m[2]);
  let raw = 0;
  let zipped = 0;
  for (const src of new Set(srcs)) {
    const body = Buffer.from(await (await fetch(new URL(src, base))).arrayBuffer());
    raw += body.length;
    zipped += gz(body);
  }
  const flight = [...text.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)].reduce((n, m) => n + m[1].length, 0);
  rows.push({ path, status: res.status, scripts: new Set(srcs).size, js: raw, jsGz: zipped, html: html.length, htmlGz: gz(html), flight });
}

for (const r of rows) {
  if (!r.js) console.log(`${r.path.padEnd(28)} HTTP ${r.status}`);
  else
    console.log(
      `${r.path.padEnd(28)} ${String(r.scripts).padStart(2)} scripts  JS ${kb(r.js).padStart(10)} raw ${kb(r.jsGz).padStart(9)} gz   HTML ${kb(r.html).padStart(9)} raw ${kb(r.htmlGz).padStart(8)} gz  (inline RSC ${kb(r.flight)})`,
    );
}
if (process.env.JSON) console.log(JSON.stringify(rows));
