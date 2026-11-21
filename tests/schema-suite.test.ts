import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runSuite, type CaseResult } from './schema-suite';
import { DRAFT_NAME } from '../lib/schema/drafts';

/*
 * JSON Schema validator (lib/schema) against the official JSON-Schema-Test-Suite
 * (github.com/json-schema-org/JSON-Schema-Test-Suite, MIT; see tests/schema-suite/LICENSE).
 *
 * - tests/schema-suite/ is a curated subset of it (commit e2a68a1, 2026-11-16), always run.
 * - The whole suite runs too when it is on this machine: SCHEMA_SUITE=<its validation/tests folder>, or
 *   ~/.cache/schema-suite/suite/validation/tests. Without it, that test is skipped.
 *
 * Every failing case must be listed below with its reason; the run prints a pass rate per draft and kind.
 */

const id = (r: CaseResult) => `${DRAFT_NAME[r.draft]} ${r.file} :: ${r.case} :: ${r.test}`;

/** Cases this validator fails on purpose, with why. */
const KNOWN: Record<string, string> = {
  'draft-07 optional/content.json :: validation of string-encoded content based on media type :: an invalid JSON document': 'contentMediaType is an annotation here (draft-07 allows either)',
  'draft-07 optional/content.json :: validation of binary string-encoding :: an invalid base64 string (% is not a valid character)': 'contentEncoding is an annotation here (draft-07 allows either)',
  'draft-07 optional/content.json :: validation of binary-encoded media type documents :: a validly-encoded invalid JSON document': 'contentMediaType is an annotation here (draft-07 allows either)',
  'draft-07 optional/content.json :: validation of binary-encoded media type documents :: an invalid base64 string that is valid JSON': 'contentEncoding is an annotation here (draft-07 allows either)',
};

function summary(results: CaseResult[]) {
  const by = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const k = `${DRAFT_NAME[r.draft].padEnd(8)} ${r.kind.padEnd(8)}`;
    const e = by.get(k) ?? { pass: 0, total: 0 };
    e.total++;
    if (r.got === r.expected) e.pass++;
    by.set(k, e);
  }
  return [...by].map(([k, e]) => `${k} ${e.pass}/${e.total} (${((e.pass / e.total) * 100).toFixed(1)}%)`).join('\n');
}

function check(results: CaseResult[], full: boolean) {
  const failing = results.filter((r) => r.got !== r.expected).map(id);
  const unexpected = failing.filter((f) => !KNOWN[f]);
  assert.deepEqual(unexpected, [], 'unexpected failures (fix, or list them in KNOWN with the reason)');
  if (full) {
    const fixed = Object.keys(KNOWN).filter((k) => !failing.includes(k));
    assert.deepEqual(fixed, [], 'these listed failures pass now: take them out of KNOWN');
  }
}

test('JSON-Schema-Test-Suite: the curated subset in tests/schema-suite passes for every draft', () => {
  const results = runSuite(join(process.cwd(), 'tests/schema-suite'));
  assert.ok(results.length > 1500, `ran ${results.length} cases`);
  console.log(`\ncurated subset: ${results.length} cases\n${summary(results)}`);
  check(results, false);
});

const full = process.env.SCHEMA_SUITE ?? join(homedir(), '.cache/schema-suite/suite/validation/tests');

test('JSON-Schema-Test-Suite: the whole suite (when present)', { skip: !existsSync(full) && 'the suite is not on this machine (set SCHEMA_SUITE)' }, () => {
  const t0 = performance.now();
  const results = runSuite(full);
  const ms = performance.now() - t0;
  console.log(`\nfull suite: ${results.length} cases in ${ms.toFixed(0)} ms\n${summary(results)}`);
  const failing = results.filter((r) => r.got !== r.expected);
  if (failing.length) console.log(`failing (${failing.length}):\n${failing.map((r) => `  ${id(r)}: ${KNOWN[id(r)] ?? 'UNEXPECTED'}${r.error ? ` (${r.error})` : ''}`).join('\n')}`);
  if (process.env.SCHEMA_SUITE_REPORT) writeFileSync(process.env.SCHEMA_SUITE_REPORT, JSON.stringify(results, null, 1));
  check(results, true);
});
