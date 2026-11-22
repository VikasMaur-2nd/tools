// The official JSON Schema meta-schemas that come with the validator (lib/schema/meta/meta-schemas.json, see
// lib/schema/meta.ts), so a $ref to one resolves without the network: draft-04, draft-06, draft-07, and 2019-09 and
// 2020-12 with their vocabularies. Each is the file json-schema.org serves, minified (JSON.parse, then JSON.stringify:
// the same content, its key order kept). PINS are the SHA-256 of the files as served when they were copied, so a copy
// never changes unseen; tests/schema-meta.test.ts pins the minified texts.
//
// Source: https://json-schema.org, from github.com/json-schema-org/json-schema-spec. Copyright (c) 2022 JSON Schema
// Specification Authors, licensed under the BSD 3-Clause License or the Academic Free License v3.0
// (lib/schema/meta/LICENSE, both). They are used under the BSD 3-Clause License, whose notice the file carries.
//
// usage: node scripts/meta-schemas.mjs           fetch, check the pins, write the file
//        node scripts/meta-schemas.mjs --check   fetch, check the pins and that the file is theirs, write nothing
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'lib/schema/meta/meta-schemas.json');
const LICENSE = join(root, 'lib/schema/meta/LICENSE');

/** URL (as json-schema.org serves it, https, no fragment) → SHA-256 of the file as served. */
export const PINS = {
  'https://json-schema.org/draft-04/schema': 'e1489d0b4755f02793302591d3fcb8f07b6893a82a94f24895f8e4edf11b82e2',
  'https://json-schema.org/draft-06/schema': '0064e880ba214bff1cee511e678fbe48c9826dd359e91e2423fc36de67b2ebe1',
  'https://json-schema.org/draft-07/schema': '692e1d165e47afcb5f11b2ce1c639635ffa834035d6ecb6bcf3087481dae8404',
  'https://json-schema.org/draft/2019-09/schema': '7b761b3e121f0a0ca1ea2a0b8e2cc856bcf801604b8268d71bacaa202bc0c13b',
  'https://json-schema.org/draft/2019-09/meta/core': 'a6751523406d9ca767032ae97eb1c00c2de6d3cac9fc7d619babb460131cc1cb',
  'https://json-schema.org/draft/2019-09/meta/applicator': '6b5f4e2fbc326d63cef6f6a3fa53bbfd3da39323116bc2eee866d716afc0e52c',
  'https://json-schema.org/draft/2019-09/meta/validation': 'c83c5121d0afd313846002429cd16b08ab77be022f423c70f0cfb64adc1069b7',
  'https://json-schema.org/draft/2019-09/meta/meta-data': 'ebcce1cded976590c75b4e5ee18ac471ffd8d21575a41d3ba05f59946fcbb5ce',
  'https://json-schema.org/draft/2019-09/meta/format': 'a53cf235aab26c7639e70e94656136b20bcc364379c6a129cc06377982f91e96',
  'https://json-schema.org/draft/2019-09/meta/content': '9054737ada8e2ffbd9c9487ea406a86af8b57dcfd269543f04aba782936e3385',
  'https://json-schema.org/draft/2020-12/schema': '41da76f5afb7ce062d248f762463a92f7ca47e4e0f905b224ba6afeef91ded0f',
  'https://json-schema.org/draft/2020-12/meta/core': '21f79d143fab1f180245c331e5657057045b36794d41fe151e6e4fed65035299',
  'https://json-schema.org/draft/2020-12/meta/applicator': 'bf273b26f9f735b93ece78f2b61b36676e1d122ce78ab37ad5a2e45dfa1ca2b1',
  'https://json-schema.org/draft/2020-12/meta/unevaluated': 'fc99f32188da41689a9382af174dd42e8b255e4374965c157b8286556b4ab2bc',
  'https://json-schema.org/draft/2020-12/meta/validation': 'e921c5b79264d3689af01c1af1ffdf692e09f1c45df90a0f08eb7288c9acdeab',
  'https://json-schema.org/draft/2020-12/meta/meta-data': 'c664d438a84d58889c8edecd248ce2f945a4bc0e3b087323b11303dc136abfbe',
  'https://json-schema.org/draft/2020-12/meta/format-annotation': '5c79404f831dd905c0f40fefac7c6f3e51bf3729b4a876a5c2020178d97f3bcc',
  'https://json-schema.org/draft/2020-12/meta/content': 'a10456605b2b5bb12a1b4dcfc0300f02f54d3e8bb3646bed7724583866627682',
};

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function main() {
  const check = process.argv.includes('--check');
  const schemas = {};
  const got = {};
  for (const url of Object.keys(PINS)) {
    const res = await fetch(url, { headers: { Accept: 'application/schema+json' } });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const text = await res.text();
    got[url] = sha(text);
    if (got[url] !== PINS[url]) throw new Error(`${url}: the file changed (${got[url]}): check it, then pin the new hash`);
    schemas[url] = JSON.parse(text);
  }
  // (The BSD 3-Clause part of the dual licence: its copyright notice, conditions and disclaimer.)
  const bsd = readFileSync(LICENSE, 'utf8').split('\n---\n')[0].trim();
  if (!bsd.startsWith('Copyright (c)') || !bsd.includes('Redistribution and use in source and binary forms')) throw new Error('lib/schema/meta/LICENSE: the BSD 3-Clause notice comes first');
  const bundle = {
    $comment: 'The official JSON Schema meta-schemas as https://json-schema.org serves them (github.com/json-schema-org/json-schema-spec), minified by scripts/meta-schemas.mjs. Licensed under the BSD 3-Clause License or the Academic Free License v3.0; used here under the BSD 3-Clause License, whose notice follows.',
    license: bsd,
    schemas,
  };
  const text = JSON.stringify(bundle) + '\n';
  if (check) {
    if (readFileSync(OUT, 'utf8') !== text) throw new Error('lib/schema/meta/meta-schemas.json differs from the files served: run node scripts/meta-schemas.mjs');
    console.log(`${Object.keys(schemas).length} meta-schemas: as served, and bundled`);
    return;
  }
  writeFileSync(OUT, text);
  console.log(Object.entries(got).map(([u, h]) => `  '${u}': '${h}',`).join('\n'));
  console.log(`wrote ${OUT}: ${text.length} bytes`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
