// Share links and the handoff meeting the resumable parser (port of selftest/resumable/wk/links.mjs): deep
// share links (at and past the nesting limit), a small link into the Tree view, and a 10 MB handoff from another
// page into the Tree view.
import { deflateRawSync } from 'node:zlib';
import { defaults, test } from '../../lib/api.mjs';
import { slow } from './_helpers.mjs';

defaults({ engines: ['chromium', 'webkit'], timeout: 120_000 });

const enc = (t) => deflateRawSync(Buffer.from(t)).toString('base64url');
const deep = (n) => '['.repeat(n) + '"TKLB"' + ']'.repeat(n);
const deepObj = (n) => '{"k":'.repeat(n) + '"TKLB"' + '}'.repeat(n);

const state = (page) =>
  page.evaluate(() => ({
    st: (window.__vis('.statusbar .st')?.textContent || '').trim(),
    tree: /TKLB|customers/.test(document.querySelector('#view-tree')?.textContent || ''),
    toast: [...document.querySelectorAll('.toast, [role=status]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 200),
  }));

async function viaLink(t, text, extra = '&view=tree') {
  await t.open('/#a=' + enc(text) + extra);
  await t.app.waitStatus(t.page, /Valid JSON|deep|Ln \d/, { timeout: 30_000 * slow(t) }).catch(() => {});
  return state(t.page);
}

const CASES = [
  ['a link to arrays nested 100,000 deep opens valid', () => deep(100_000), /^Valid JSON/],
  ['a link to objects nested 100,000 deep opens valid', () => deepObj(100_000), /^Valid JSON/],
  ['a link to arrays nested 101,000 deep says the nesting is too deep', () => deep(101_000), /Nesting is too deep to parse/],
];
for (const [name, make, want] of CASES) {
  test(name, async (t) => {
    const s = await viaLink(t, make());
    t.check(want.test(s.st), 'status', s.st);
    t.check(/Loaded shared JSON/.test(s.toast), 'the link says it loaded', s.toast);
  });
}

test('a small link into the Tree view shows the document there', async (t) => {
  const s = await viaLink(t, JSON.stringify({ customers: [{ id: 1, name: 'TKLB' }] }));
  t.check(/^Valid JSON/.test(s.st), 'valid', s.st);
  t.check(s.tree, 'the Tree shows the document');
  t.check(/Loaded shared JSON/.test(s.toast), 'the link says it loaded', s.toast);
});

test('a 10 MB handoff into the Tree view shows progress, then the document', { tags: ['slow'] }, async (t) => {
  const { page } = t;
  await t.open('/');
  // The tool page opens /#handoff from a click and sends a 10 MB document when it is ready.
  await page.evaluate(() => {
    const doc = JSON.stringify(Array.from({ length: 150_000 }, (_, k) => ({ id: k, name: 'Zoë ' + k, tags: ['a', 'b'], ok: k % 3 === 0, x: null, m: 'TKLB' })));
    window.__len = doc.length;
    addEventListener('message', (e) => {
      if (e.data?.toolkumar === 'ready') e.source.postMessage({ toolkumar: 'open', a: doc, view: 'tree' }, '*');
      if (e.data?.toolkumar) (window.__replies ||= []).push(e.data.toolkumar);
    });
    const b = document.createElement('button');
    b.id = 'go';
    b.textContent = 'go';
    b.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;width:80px;height:40px';
    b.onclick = () => window.open(location.origin + '/#handoff', '_blank');
    document.body.append(b);
  });
  // Every status the new tab shows, from its first paint (so a quick "Parsing…" can't be missed between polls).
  await t.context.addInitScript(() => {
    if (location.hash !== '#handoff') return;
    window.__seen = [];
    new MutationObserver(() => {
      const s = document.querySelector('.statusbar .st')?.textContent.trim();
      if (s && window.__seen[window.__seen.length - 1] !== s) window.__seen.push(s);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const [popup] = await Promise.all([t.context.waitForEvent('page'), page.click('#go')]);
  const done = await popup
    .waitForFunction(() => /Valid JSON/.test(window.__vis?.('.statusbar .st')?.textContent || '') && /TKLB|customers/.test(document.querySelector('#view-tree')?.textContent || ''), null, { timeout: 90_000 * slow(t), polling: 25 })
    .then(() => true, () => false);
  const s = await state(popup);
  t.check(done, 'the handoff ends valid with the document in the Tree', s);
  const seen = await popup.evaluate(() => window.__seen || []);
  t.check(seen.some((x) => /^Parsing/.test(x)), 'progress shows while it parses', seen.slice(0, 6));
  const replies = await page.evaluate(() => window.__replies || []);
  t.check(replies.includes('ready') && replies.includes('opened'), 'the tool tab answers ready, then opened', replies);
  t.log(`document ${await page.evaluate(() => window.__len)} chars; toast: ${s.toast}`);
});
