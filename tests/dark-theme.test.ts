import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Dark mode is written twice in the stylesheets: once for the system preference
 * (`@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) … }`)
 * and once for the manual choice (`:root[data-theme='dark'] …`). light-dark()
 * would say it once, but lib/graph/theme.ts reads the raw custom properties for
 * the graph's canvas, so the two copies stay and this keeps them identical.
 */

const SYSTEM = ":root:not([data-theme='light'])";
const FORCED = ":root[data-theme='dark']";
const dir = join(process.cwd(), 'app');

/** The `selector { body }` rules at the top level of `css` (nested blocks are skipped whole). */
function rules(css: string) {
  const out: { selector: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let selector = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      if (depth === 0) {
        selector = css.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        out.push({ selector, body: css.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return out;
}

/** Declarations in order, whitespace-insensitive. */
const declarations = (body: string) => body.split(';').map((d) => d.replace(/\s+/g, ' ').trim()).filter(Boolean);

const sheets = readdirSync(dir).filter((f) => f.endsWith('.css'));

test('forced dark mode repeats the system dark mode exactly', () => {
  let pairs = 0;
  for (const file of sheets) {
    const top = rules(readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
    const forced = new Map(top.filter((r) => r.selector.startsWith(FORCED)).map((r) => [r.selector, r.body]));
    const system = top
      .filter((r) => r.selector === '@media (prefers-color-scheme: dark)')
      .flatMap((r) => rules(r.body))
      .filter((r) => r.selector.startsWith(SYSTEM));
    for (const { selector, body } of system) {
      const twin = FORCED + selector.slice(SYSTEM.length);
      assert.ok(forced.has(twin), `${file}: ${selector} has no ${twin}`);
      assert.deepEqual(declarations(forced.get(twin)!), declarations(body), `${file}: ${twin} differs from ${selector}`);
      forced.delete(twin);
      pairs++;
    }
    assert.deepEqual([...forced.keys()], [], `${file}: forced dark rules with no system twin`);
  }
  // The design tokens, the graph and the replay screenshots on /privacy.
  assert.ok(pairs >= 4, `only ${pairs} dark rule pairs found`);
});
