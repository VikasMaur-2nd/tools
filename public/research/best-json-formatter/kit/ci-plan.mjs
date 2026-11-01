// Expands ci-run.json into the GitHub Actions job matrix (formatter-study.yml) and sets the variables the repo's
// budget guard reads. Each job: { name, cmd, browsers, minutes }. `cmd` is the script and its arguments as one
// string, run as `node <cmd> --out <dir>` inside kit/; `minutes` is what the job is expected to bill and becomes its
// time limit (+50 %).
//
//   node ci-plan.mjs            prints the jobs
import { appendFileSync, readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const { jobs } = JSON.parse(readFileSync(new URL('ci-run.json', here), 'utf8'));
if (!Array.isArray(jobs) || !jobs.length) throw new Error('ci-run.json has no jobs');
const matrix = jobs.map((j) => {
  if (!j.name || !j.cmd || !j.minutes) throw new Error(`job needs name, cmd and minutes: ${JSON.stringify(j)}`);
  if (!/^[\w./ ,:=-]+$/.test(j.cmd)) throw new Error(`cmd may only hold plain words: ${j.cmd}`);
  return { name: j.name, cmd: j.cmd, browsers: j.browsers ?? 'chromium', minutes: j.minutes, timeout: Math.ceil(j.minutes * 1.5) + 5 };
});
const total = matrix.reduce((s, j) => s + Math.ceil(j.minutes + 2.5), 0);
console.log(matrix.map((j) => `${j.name.padEnd(28)} ${String(j.minutes).padStart(3)} min  node ${j.cmd}`).join('\n'));
console.log(`expected bill: about ${total} minutes (including about 2.5 min of setup per job)`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `jobs=${JSON.stringify(matrix)}\n`);
  // scripts/ci-usage.mjs --guard (level perf) estimates jobs × (setup + browsers + minutes) and stops the run if the
  // month's budget would be passed.
  appendFileSync(
    process.env.GITHUB_ENV,
    `CHECK_LEVEL=perf\nCHECK_ENGINES=chromium\nCHECK_SUITES=${matrix.map((j) => j.name).join(';')}\nCHECK_PERF_MINUTES=${Math.max(...matrix.map((j) => j.minutes))}\n`,
  );
}
