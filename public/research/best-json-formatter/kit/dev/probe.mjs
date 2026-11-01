// Used while writing adapters (not part of the measurement): for each adapter, paste a small valid document,
// press its format control, and list where the result appears (editors, text boxes, result blocks); then paste an
// invalid one and list visible elements that read like an error. Also lists the page's non-GET requests and saves
// full-page screenshots to <out>/probe/.
//
//   xvfb-run -a node dev/probe.mjs --tools static-app,curiousconcept --out out
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ADAPTERS } from '../adapters/index.mjs';
import { ERROR_CASES } from '../cases.mjs';
import { ERRORISH, launch, newContext, openTool, stage } from '../lib/harness.mjs';

const { values: o } = parseArgs({ options: { tools: { type: 'string' }, out: { type: 'string', default: 'out' }, wait: { type: 'string', default: '8000' } } });
const dir = join(o.out, 'probe');
mkdirSync(dir, { recursive: true });
const VALID = '{"alpha":1,"beta":[true,null,"x"],"gamma":{"d":2.5},"end":"FMTSTUDY-END-OF-DOCUMENT"}';

const outputs = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const desc = (e) => { const c = []; for (let x = e; x && x !== document.body && c.length < 5; x = x.parentElement) c.unshift(x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + (typeof x.className === 'string' && x.className.trim() ? '.' + x.className.trim().split(/\s+/).slice(0, 3).join('.') : '')); return c.join(' > '); };
  const res = [];
  document.querySelectorAll('.ace_editor').forEach((e) => res.push('ACE ' + desc(e) + ' :: ' + JSON.stringify((e.env?.editor?.getValue() || '').slice(0, 100))));
  document.querySelectorAll('.CodeMirror').forEach((e) => res.push('CM5 ' + desc(e) + ' :: ' + JSON.stringify((e.CodeMirror?.getValue() || '').slice(0, 100))));
  document.querySelectorAll('.cm-content').forEach((e) => res.push('CM6 ' + desc(e) + ' :: ' + JSON.stringify((e.cmTile?.view || e.cmView?.view)?.state.doc.toString().slice(0, 100))));
  document.querySelectorAll('.monaco-editor').forEach((e) => res.push('MONACO ' + desc(e) + ' global=' + !!window.monaco));
  document.querySelectorAll('textarea').forEach((e) => vis(e) && res.push('TEXTAREA ' + desc(e) + ' [aria-label=' + e.getAttribute('aria-label') + ' placeholder=' + e.placeholder + '] :: ' + JSON.stringify(e.value.slice(0, 100))));
  document.querySelectorAll('[contenteditable=true]').forEach((e) => vis(e) && res.push('EDITABLE ' + desc(e) + ' :: ' + JSON.stringify(e.textContent.slice(0, 100))));
  [...document.querySelectorAll('pre, code, [class*=output], [id*=output], [class*=result], [id*=result], [class*=formatted], [id*=formatted]')]
    .filter((e) => vis(e) && /alpha/.test(e.textContent) && e.textContent.length < 5000)
    .slice(0, 10)
    .forEach((e) => res.push('DOM ' + desc(e) + ' :: ' + JSON.stringify(e.textContent.slice(0, 100))));
  const buttons = [...document.querySelectorAll('button, [role=button], a.button')].filter(vis).map((b) => [(b.innerText || '').trim().slice(0, 30), b.getAttribute('aria-label'), b.title].filter(Boolean).join(' / ')).filter(Boolean);
  return { res, buttons: [...new Set(buttons)].slice(0, 60) };
};
const errors = (src) => {
  const re = new RegExp(src, 'i');
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
  const desc = (e) => { const c = []; for (let x = e; x && x !== document.body && c.length < 5; x = x.parentElement) c.unshift(x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + (typeof x.className === 'string' && x.className.trim() ? '.' + x.className.trim().split(/\s+/).slice(0, 3).join('.') : '')); return c.join(' > '); };
  return [...document.querySelectorAll('body *')].filter((e) => vis(e) && re.test(own(e)) && own(e).length < 300).map((e) => desc(e) + ' :: ' + e.innerText.replace(/\s+/g, ' ').slice(0, 160)).slice(0, 25);
};

const browser = await launch('chromium');
const report = {};
for (const id of o.tools.split(',')) {
  const a = ADAPTERS.find((x) => x.id === id);
  const context = await newContext(browser, 'chromium');
  const requests = [];
  context.on('requestfinished', async (r) => {
    if (r.method() === 'GET') return;
    const res = await r.response().catch(() => null);
    requests.push(`${r.method()} ${r.url().slice(0, 120)} → ${res?.status()} body ${(r.postData() || '').length} B${(r.postData() || '').includes('alpha') ? ' (holds the pasted JSON)' : ''}`);
  });
  const entry = (report[id] = {});
  try {
    const { page, interruptions } = await openTool(context, a);
    entry.interruptions = interruptions;
    for (const [name, doc] of [['valid', VALID], ['invalid', ERROR_CASES[0].text]]) {
      await stage(page, a, doc);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Control+V');
      await page.waitForTimeout(600);
      if (a.format) await (typeof a.format === 'function' ? await a.format(page) : page.locator(a.format).first()).click({ timeout: 10_000 }).catch((e) => (entry[`${name}Click`] = e.message.split('\n')[0]));
      await page.waitForTimeout(Number(o.wait));
      entry[name] = name === 'valid' ? await page.evaluate(outputs) : await page.evaluate(errors, ERRORISH.source);
      await page.screenshot({ path: join(dir, `${id}-${name}.jpg`), type: 'jpeg', quality: 55, fullPage: true });
    }
  } catch (e) {
    entry.failure = e.message.split('\n')[0];
  }
  entry.requests = requests.filter((r) => !/doubleclick|google|criteo|pubmatic|rubicon|amazon|adnxs|prebid|sync|pixel|collect|analytics|beacon|track/i.test(r)).slice(0, 20);
  await context.close();
}
await browser.close();
writeFileSync(join(dir, 'probe.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
