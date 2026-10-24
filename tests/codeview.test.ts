import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installDom } from './dom';
import { CodeView } from '../lib/engine/codeview';
import { codeRows, highlightCode } from '../lib/convert/highlight';

installDom();

const tick = () => new Promise((r) => setTimeout(r, 0));

function view(width = 800) {
  const el = new FakeElement();
  for (const c of ['cv-sizer', 'cv-rows']) el.appendChild(new FakeElement()).className = c;
  el.clientWidth = width;
  el.clientHeight = 600;
  const code = new CodeView(el as unknown as HTMLElement);
  const rows = el.querySelector('.cv-rows')!;
  return { code, rows };
}

/** The text of each drawn row's code, with its spans' classes: `[class]text` per token. */
const drawn = (html: string) =>
  [...html.matchAll(/<span class="cv-c">(.*?)<\/span><\/div>/g)].map((m) =>
    m[1].replace(/<span class="(t\w)">(.*?)<\/span>/g, '[$1]$2').replace(/<[^>]+>/g, ''),
  );

test('the output view colours a YAML block scalar as text, as the whole document does', async () => {
  const { code, rows } = view();
  const yaml = 'greeting: |\n  hello\n  world: yes\nnext: 1\n';
  const { hl, scanner } = codeRows('yaml');
  code.setText(yaml, hl, false, scanner);
  for (let k = 0; k < 20 && !rows.innerHTML; k++) await tick();
  const got = drawn(rows.innerHTML);
  assert.equal(got[2], '  [ts]world: yes', 'not a key');
  assert.deepEqual(got.slice(0, 4), highlightCode(yaml, 'yaml').split('\n').slice(0, 4).map((l) => l.replace(/<span class="(t\w)">(.*?)<\/span>/g, '[$1]$2')));
});

test('a TOML multi-line string stays a string on wrapped rows', async () => {
  // Narrow: the long line wraps onto several rows.
  const { code, rows } = view(400);
  const toml = 'title = """\n' + 'key = "not a key" '.repeat(8) + '\n"""\nnext = 1\n';
  const { hl, scanner } = codeRows('toml');
  code.setText(toml, hl, false, scanner);
  for (let k = 0; k < 20 && !rows.innerHTML; k++) await tick();
  const got = drawn(rows.innerHTML);
  assert.ok(got.length > 5, `wrapped (${got.length} rows)`);
  for (const row of got.slice(1, -3)) assert.match(row, /^\[ts\][^[]*$/, row);
  assert.equal(got.at(-2), '[tk]next [tp]= [tn]1');
});
