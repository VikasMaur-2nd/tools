// WebMCP tools (lib/webmcp) called the way an agent would, with huge or malformed arguments: every call
// answers with a clear text (no throw, no hang), within MAX_RESULT, and the page stays usable. Needs the
// full Chromium with WebMCP switched on (as platform/webmcp.mjs).
import { defaults, test } from '../../lib/api.mjs';
import { command } from '../../lib/app.mjs';
import { copied, golden, settled } from './_helpers.mjs';

const WEBMCP = { channel: 'chromium', args: ['--enable-features=WebMCPTesting', '--enable-blink-features=WebMCP'] };
defaults({ engines: ['chromium'], launch: WEBMCP, tags: ['breaker', 'webmcp'], timeout: 180_000 });

const MAX_RESULT = 50_000;

/** Waits (polling from Node: the tool list is async) until the page offers its 12 tools. */
async function waitTools(page, timeout = 20_000) {
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    if ((await page.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)) >= 12) return true;
  }
  return false;
}

/** Calls a tool as an agent's browser does; returns { text } or { threw }. */
const exec = (page, name, args = {}) =>
  page.evaluate(
    async ([name, args]) => {
      const t = (await document.modelContext.getTools()).find((x) => x.name === name);
      if (!t) return { threw: `no tool ${name}` };
      try {
        const r = await document.modelContext.executeTool(t, args);
        return { text: typeof r === 'string' ? r : JSON.stringify(r) };
      } catch (e) {
        return { threw: String(e).slice(0, 300) };
      }
    },
    [name, args],
  );

/** Text with long runs of digits and sizes kept, so golden values stay readable. */
const short = (r) => (r.text !== undefined ? { text: r.text.length > 600 ? `${r.text.slice(0, 600)}…[${r.text.length}]` : r.text } : r);

test('malformed arguments get exact error texts, never a throw', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await waitTools(page), 'the tools are registered');
  const calls = [
    ['open_json', {}],
    ['open_json', { text: 42 }],
    ['open_json', { text: null }],
    ['open_json', { text: ['a'] }],
    ['open_json', { text: '{"a":1}', view: 'compare' }],
    ['open_json', { text: '{"a":{"b":[1,2,{"c":"d"}]},"__proto__":{"x":1}}', name: '../../etc/passwd<img src=x onerror=window.__xss=1>' + 'x'.repeat(5000) }],
    ['get_json_value', { path: '$[' }],
    ['get_json_value', { path: '$..a' }],
    ['get_json_value', { path: '/a/~2' }],
    ['get_json_value', { path: '$.__proto__.x' }],
    ['get_json_value', { path: "$['a']['b'][2].c" }],
    ['get_json_value', { path: '/a/b/9' }],
    ['get_json_value', { path: '$' + '.a'.repeat(50_000) }],
    ['get_json_value', { path: 12 }],
    ['format_json', { style: 'weird' }],
    ['format_json', { indent: '8' }],
    ['convert_json', {}],
    ['convert_json', { to: 'cobol' }],
    ['convert_json', { to: 'typescript', root_name: '<script>' + 'R'.repeat(10_000) }],
    ['import_to_json', { from: 'ini' }],
    ['compare_json', {}],
    ['compare_json', { modified: '{"a":{"b":[1,2,{"c":"e"}]}' }],
    ['decode_jwt', {}],
    ['download_file', { what: 'passwords' }],
    ['show_view', { view: 'compare' }],
    ['show_view', { view: 'tree' }],
    ['share_link', { as: 'pdf' }],
  ];
  const out = [];
  for (const [name, args] of calls) {
    const r = await exec(page, name, args);
    t.check(!r.threw, `${name} ${JSON.stringify(args).slice(0, 60)}: answers without throwing`, r.threw);
    const known = name === 'get_json_value' && (r.text ?? '').length > MAX_RESULT ? 'bug: an error answer echoes a huge path uncapped (BREAKER-REPORT, WebMCP caps)' : undefined;
    t.check((r.text ?? '').length <= MAX_RESULT + 400, `${name}: answer within MAX_RESULT`, r.text?.length, { known });
    out.push([name, JSON.stringify(args).slice(0, 80), short(r)]);
  }
  golden(t, 'webmcp/malformed', out, 'every answer matches the golden file');
  t.check((await page.evaluate(() => window.__xss ?? 0)) === 0, 'no markup from a file name ran');
});

test('a 30 MB document through open_json: the answer is capped, the page holds it all, and Undo brings the old one back', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await waitTools(page), 'the tools are registered');
  const small = '{"before":true}';
  await exec(page, 'open_json', { text: small, name: 'before.json' });
  // 30 MB of records made in the page (sending them through the protocol would double the memory).
  const r = await page.evaluate(async () => {
    const recs = [];
    let size = 2;
    for (let i = 0; size < 30_000_000; i++) {
      const s = JSON.stringify({ id: i, name: `user ${i}`, tags: ['a', 'b'], score: i / 7 });
      recs.push(s);
      size += s.length + 1;
    }
    window.__big = '[' + recs.join(',') + ']';
    const t = (await document.modelContext.getTools()).find((x) => x.name === 'open_json');
    const t0 = performance.now();
    const text = await document.modelContext.executeTool(t, { text: window.__big, name: 'big.json' });
    return { text, ms: performance.now() - t0, len: window.__big.length };
  });
  t.log('open_json took', Math.round(r.ms), 'ms for', r.len);
  t.check(typeof r.text === 'string' && /valid JSON/i.test(r.text) && r.text.length <= MAX_RESULT + 400, 'open_json answers that it is valid, briefly', r.text?.slice(0, 300));
  t.check(await settled(page, { raw: r.len, timeout: 120_000 }), 'the page shows the 30 MB document');
  const fmt = await exec(page, 'format_json', { style: 'pretty' });
  t.check(!fmt.threw && fmt.text.length <= MAX_RESULT + 400 && /Cut at/.test(fmt.text), 'format_json answers with a cut output and says where the rest is', fmt.text?.slice(-200));
  const v = await exec(page, 'get_json_value', { path: '$[123456]' });
  t.check(v.text?.includes('"name": "user 123456"'), 'get_json_value reads deep inside it', v.text?.slice(0, 200));
  const cmp = await exec(page, 'compare_json', { modified: '[]' });
  t.check(!cmp.threw && /^100,000 differences at least: 100,000 removed\./.test(cmp.text ?? ''), 'compare_json with everything removed counts the differences', cmp.text?.slice(0, 200));
  t.check((cmp.text ?? '').length <= MAX_RESULT + 400, 'compare_json answers within the cap', cmp.text?.length, { known: 'bug: compare_json adds a capped patch to 200 listed changes, past MAX_RESULT (BREAKER-REPORT, WebMCP caps)' });
  await command(page, 'Format view (formatted output)');
  await command(page, 'Undo');
  const back = await copied(page, 'Copy input to clipboard', { timeout: 60_000 });
  t.check(back === small, 'Undo brings the earlier document back', back?.slice(0, 80));
});
