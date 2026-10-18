# JSON benchmark tools verification

The generator and precision checker run entirely on the client. The panels can be imported into the research article from `components/testdata/GeneratorPanel.tsx` and `components/testdata/PrecisionPanel.tsx`.

## Fixture verification

Verified all published variants by streaming `lib/testdata/generate.ts` directly through Node 24 type stripping and checking its incremental SHA-256 against `node:crypto`. No generated fixture files were written to disk. The largest emitted chunk was 68,713 bytes.

Sources were the original `generate-fixtures.mjs`, `editing-fixtures.sha256.json` and `extra-fixtures.sha256.jsonl` under `/home/ubuntu/seo-ops/research/large-file-benchmark/results/2026-10-17-competitors-6g/`. The JSONL manifest repeats the three large minified entries; this table lists each once. The editing manifest's last-record email gives the expected record count, which is identical for both formats.

Targets are decimal bytes: tiny = 4,000; 100kb = 100,000; each MB = 1,000,000. Pretty variants use the record count selected for the minified target. The original conservative reservation for a seven-digit wrapper and probe is preserved exactly.

| Fixture | Bytes | Records | SHA-256 | Result |
| --- | ---: | ---: | --- | --- |
| tiny | 3,854 | 5 | `ca4acff52a21a16bd9b785048beefd977a08260aa8f19e5184d6ed25d3b7fdb4` | Match |
| tiny-pretty | 6,772 | 5 | `1be4541839a79e623440cb68f82c0bb0cb6258e8a59e92b50746036a188ecf48` | Match |
| 100kb | 99,638 | 117 | `6dd2438f91bf60e11617fe2464e8d49af823d45dc21dc31e15cb9624554d48e9` | Match |
| 100kb-pretty | 186,427 | 117 | `f6ea1a3f66fe1dc9eeac68447b0ab5f0043f80f9c91646b5efcf0a8fa31b8e08` | Match |
| 1mb | 999,554 | 1,204 | `eb614d34851b87cc1fe0eee6e8610b32ed63d750db51891469f1ecd34fce63ed` | Match |
| 1mb-pretty | 1,863,123 | 1,204 | `9bec4b74b12e2ce115890456adfb1aa5cf9955e75b065da2e5ba275ae3de5764` | Match |
| 5mb | 4,999,348 | 5,993 | `d3dc126ca6d60f70a843fabd40900789d20e58c55ff34c161b9d02eaa37375fc` | Match |
| 5mb-pretty | 9,309,034 | 5,993 | `b2c04c0b7715c9a027c11940a22a0e4e0bfcdda838fae561511618d449e3967d` | Match |
| 10mb | 9,999,719 | 12,025 | `1fc37b1b236e28c4c3aa850ffd9100f2fc08f58f9c7a7d1e7006d034ee73a76d` | Match |
| 10mb-pretty | 18,592,911 | 12,025 | `7c58a423f0f7bbd22159b6519acd16faea3377fe6501a796b70c652deed1e6d9` | Match |
| 25mb | 24,999,379 | 30,014 | `7feeafcfc0c900f18c0b1c2d84a3ec72d1fad0e1f419a5ef71b2d7b470db9a63` | Match |
| 25mb-pretty | 46,429,175 | 30,014 | `f38edc3bae2df05ab719ad795331b9feee0d45e922b6d3a4d5b5e6ed274ef0eb` | Match |
| 50mb | 49,998,859 | 60,051 | `c3e4ee5212c3500aaaf24c8a518c446ca4004ab6a3ed98b0b5037bdbec4ceb23` | Match |
| 50mb-pretty | 92,806,317 | 60,051 | `2a3c261871b43b8bebc51742df5e4f38500d9893e4e0dde3f71dc744a38fbc55` | Match |
| 100mb | 99,999,788 | 119,935 | `dda41c73526f8cf82b328bcc79600f168327a48de0ee29b8d6fc65154ae11d69` | Match |
| 200mb | 199,999,972 | 239,230 | `fe13bc1b68958f453dcfa23dd74c35ae6c49b4d28332c121aacca5f05bd851b3` | Match |
| 400mb | 399,999,594 | 478,192 | `933968cfcf23684702ec5df6bceb9ddecd4683eb6d1975cf49157ed5afeb3f16` | Match |

Re-run the full table without generating files:

```sh
TMPDIR=/home/ubuntu/.cache/perf-tmp pnpm exec node scripts/verify-testdata.mjs
```

## Implementation choices

- Generation uses two passes so the opening metadata contains the correct record count without retaining the record stream. The second pass emits roughly 64 KB chunks. The worker transfers each buffer and awaits acknowledgement before emitting the next chunk, including when a disk write takes longer.
- The site's `reindent` normalizes some string escapes. Generated strings already use canonical escapes, so it agrees on these fixtures. The generator instead uses a streaming source indenter that preserves every token verbatim, including escapes, number spellings and duplicate members.
- Custom targets range from 1 KB to 1 GB. Like the original script, targets smaller than the mandatory final probe produce the 1,172-byte one-record minimum even if it exceeds the target. The page explains this.
- The precision checker also uses an on-demand worker. Decimal coefficients and exponents are compared without floating point conversion. Duplicate-count changes are explicit; preserved values are paired first so retaining either the first or last duplicate does not create a false value-change report. The UI renders at most 200 differences and states the total when more exist.
- The existing service worker caches these pages and assets after use. Workers load only when an operation starts. A worker that has never been loaded is unavailable on a first offline attempt; run each tool once online before offline reuse.
- The requested article link points to `/blogs/large-file-json-benchmark`. That article is absent from `origin/main` at this branch's base and remains part of the separate content work.

## Validation

- `pnpm lint`: passed with no warnings.
- `pnpm exec tsc --noEmit -p .`: passed.
- `pnpm test`: 422 tests passed, 46 suites. The parser timing test passed; no timing retry was needed.
- `pnpm build`: passed. Both new routes are statically prerendered.
- `git diff --check`: passed.
- Production Chromium checks passed at 1440 × 1000 and 390 × 844 in both light and dark mode. Verified canonical URLs, JSON-LD, one h1 and no horizontal overflow on both pages. No uncaught exceptions or hydration errors.
- The 50 MB preset displayed `c3e4ee5212c3500aaaf24c8a518c446ca4004ab6a3ed98b0b5037bdbec4ceb23`, 49,998,859 bytes and 60,051 records.
- Verified the 100 KB pretty hash and Blob download filename; deleted the temporary download. Verified cancellation. A delayed test writer exercised the File System Access write protocol with 99,638 bytes, close, and at most one concurrent write. The operating system file picker itself was not automated.
- Verified all seven changed number values, five spelling differences, duplicate loss, invalid JavaScript display forms, exact clipboard contents and custom original text with Ctrl+Enter.
- Both pages reloaded and ran successfully with the browser network disabled after prior online use.
- Worker creation was deferred until interaction. The test server was stopped after verification.

Browser automation followed the requested Playwright workflow and used the supplied Chromium headless executable. The T3 collaborative preview also opened both pages. Screenshot files are local review artifacts, not shipped application assets.

The production browser generated the 50 MB minified file in 7.553 seconds on this shared host. This is a functional timing observation, not a controlled comparative benchmark.

A separate 500 MB custom-size run produced 499,999,990 bytes and 597,698 records, with SHA-256 `bffe1c8846b3ba8948e6f9781919ef31ea5c278383f6a3b1ddb6600b6b323776`. Its largest chunk was 67,675 bytes and the incremental hash matched `node:crypto`. No fixture file was written. `/usr/bin/time -v` reported a maximum resident set of 250,596 KB and 75.87 seconds on the shared host.

## Screenshots

- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/generator-50mb-verified.png`
- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/json-precision-checker-dark-1440.png`
- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/json-precision-checker-dark-390.png`
- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/json-precision-checker-light-1440.png`
- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/json-precision-checker-light-390.png`
- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/json-test-file-generator-dark-1440.png`
- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/json-test-file-generator-dark-390.png`
- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/json-test-file-generator-light-1440.png`
- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/json-test-file-generator-light-390.png`
- `/home/ubuntu/.cache/perf-tmp/json-testdata-screenshots/precision-reference-results.png`

## Files

- `app/(en)/tools/json-precision-checker/page.tsx`
- `app/(en)/tools/json-test-file-generator/page.tsx`
- `app/(en)/tools/page.tsx`
- `app/(en)/tools/testdata-page.tsx`
- `app/sitemap.ts`
- `components/testdata/GeneratorPanel.tsx`
- `components/testdata/PrecisionPanel.tsx`
- `components/testdata/offline.ts`
- `components/testdata/panels.css`
- `components/testdata/useReady.ts`
- `docs/json-testdata-verification.md`
- `lib/testdata/generate.ts`
- `lib/testdata/generate.worker.ts`
- `lib/testdata/pages.ts`
- `lib/testdata/precision.ts`
- `lib/testdata/precision.worker.ts`
- `lib/testdata/protocol.ts`
- `lib/testdata/published.ts`
- `lib/testdata/reference.ts`
- `lib/testdata/sha256.ts`
- `scripts/test.mjs`
- `scripts/verify-testdata.mjs`
- `tests/fixtures/testdata/fidelity-minified.json`
- `tests/fixtures/testdata/fidelity.json`
- `tests/testdata.test.ts`
- `tsconfig.json`
