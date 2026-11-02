// Which speed runs to repeat (protocol amendment 3): every repetition whose last attempt did not start (the file never
// reached the tool: the clipboard step, opening the page, the input never appearing, a site outage), and every run
// the size ladder skipped only because of such a failure. Failures after the paste (no result in time, a frozen page)
// are results and are not repeated, nor are the runs the ladder skipped after them.
//
//   node dev/repeat-list.mjs <results folder> [--engine chromium]     prints tool:size:rep,… for run.mjs --runs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DID_NOT_START } from '../lib/harness.mjs';

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { engine: { type: 'string', default: 'chromium' } } });
const SIZES = ['100kb', '1mb', '10mb', '50mb'];

const records = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.jsonl')) for (const l of readFileSync(p, 'utf8').split('\n')) if (l.trim()) records.push(JSON.parse(l));
  }
})(positionals[0]);
const speed = records.filter((r) => r.suite === 'speed' && r.engine === o.engine).sort((a, b) => a.at.localeCompare(b.at));

const repeat = [];
const why = {};
for (const tool of [...new Set(speed.map((r) => r.tool))]) {
  const reps = [...new Set(speed.filter((r) => r.tool === tool).map((r) => r.rep))].sort((a, b) => a - b);
  for (const rep of reps) {
    for (const size of SIZES) {
      const tries = speed.filter((r) => r.tool === tool && r.rep === rep && r.size === size);
      const last = tries.at(-1);
      if (!last || last.ok !== false) continue;
      let reason = null;
      if (last.skipped) {
        // Skipped by the ladder: repeat only if the failure that stopped it did not start.
        const m = /failed twice at (\w+)/.exec(last.failure ?? '');
        if (m) {
          const stop = speed.filter((r) => r.tool === tool && r.size === m[1] && !r.skipped && r.ok === false && r.at <= last.at).at(-1);
          if (stop && DID_NOT_START.test(stop.failure ?? '')) reason = `skipped after ${m[1]} did not start`;
        }
      } else if (DID_NOT_START.test(last.failure ?? '') || (last.pasteSeen && last.landedSeen === false)) {
        reason = last.failure;
      }
      if (reason) {
        repeat.push(`${tool}:${size}:${rep}`);
        why[`${tool}:${size}:${rep}`] = reason;
      }
    }
  }
}
for (const [k, v] of Object.entries(why)) console.error(`${k.padEnd(28)} ${String(v).slice(0, 90)}`);
console.error(`${repeat.length} runs`);
console.log(repeat.join(','));
