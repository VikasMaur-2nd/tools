export const TESTDATA_PAGES = [
  {
    slug: 'json-test-file-generator',
    heading: 'JSON test file generator',
    description: 'Generate reproducible JSON test files from 100 KB to 400 MB, or choose a custom size up to 1 GB. Download locally with a SHA-256 checksum.',
    intro: 'Create the same JSON files used in our large-file browser benchmark. Each file uses the same seed, customer records and final search probe, so you can repeat the tests on your own device.',
  },
  {
    slug: 'json-precision-checker',
    heading: 'JSON number precision checker',
    description: "Check whether a JSON tool changed large integers, decimals, duplicate keys or strings. Compare exact number literals locally with the study's reference document.",
    intro: 'A formatter can produce valid JSON while changing an account number or rounding away cents. Compare its output with the original to see which values changed and which numbers only have a different spelling.',
  },
] as const;
