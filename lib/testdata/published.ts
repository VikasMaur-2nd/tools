// Published benchmark fixtures, 2026-10-17. Sizes refer to minified source bytes.
export const PUBLISHED_FIXTURES = [
  {
    "key": "tiny",
    "targetBytes": 4000,
    "pretty": false,
    "bytes": 3854,
    "records": 5,
    "sha256": "ca4acff52a21a16bd9b785048beefd977a08260aa8f19e5184d6ed25d3b7fdb4"
  },
  {
    "key": "tiny-pretty",
    "targetBytes": 4000,
    "pretty": true,
    "bytes": 6772,
    "records": 5,
    "sha256": "1be4541839a79e623440cb68f82c0bb0cb6258e8a59e92b50746036a188ecf48"
  },
  {
    "key": "100kb",
    "targetBytes": 100000,
    "pretty": false,
    "bytes": 99638,
    "records": 117,
    "sha256": "6dd2438f91bf60e11617fe2464e8d49af823d45dc21dc31e15cb9624554d48e9"
  },
  {
    "key": "100kb-pretty",
    "targetBytes": 100000,
    "pretty": true,
    "bytes": 186427,
    "records": 117,
    "sha256": "f6ea1a3f66fe1dc9eeac68447b0ab5f0043f80f9c91646b5efcf0a8fa31b8e08"
  },
  {
    "key": "1mb",
    "targetBytes": 1000000,
    "pretty": false,
    "bytes": 999554,
    "records": 1204,
    "sha256": "eb614d34851b87cc1fe0eee6e8610b32ed63d750db51891469f1ecd34fce63ed"
  },
  {
    "key": "1mb-pretty",
    "targetBytes": 1000000,
    "pretty": true,
    "bytes": 1863123,
    "records": 1204,
    "sha256": "9bec4b74b12e2ce115890456adfb1aa5cf9955e75b065da2e5ba275ae3de5764"
  },
  {
    "key": "5mb",
    "targetBytes": 5000000,
    "pretty": false,
    "bytes": 4999348,
    "records": 5993,
    "sha256": "d3dc126ca6d60f70a843fabd40900789d20e58c55ff34c161b9d02eaa37375fc"
  },
  {
    "key": "5mb-pretty",
    "targetBytes": 5000000,
    "pretty": true,
    "bytes": 9309034,
    "records": 5993,
    "sha256": "b2c04c0b7715c9a027c11940a22a0e4e0bfcdda838fae561511618d449e3967d"
  },
  {
    "key": "10mb",
    "targetBytes": 10000000,
    "pretty": false,
    "bytes": 9999719,
    "records": 12025,
    "sha256": "1fc37b1b236e28c4c3aa850ffd9100f2fc08f58f9c7a7d1e7006d034ee73a76d"
  },
  {
    "key": "10mb-pretty",
    "targetBytes": 10000000,
    "pretty": true,
    "bytes": 18592911,
    "records": 12025,
    "sha256": "7c58a423f0f7bbd22159b6519acd16faea3377fe6501a796b70c652deed1e6d9"
  },
  {
    "key": "25mb",
    "targetBytes": 25000000,
    "pretty": false,
    "bytes": 24999379,
    "records": 30014,
    "sha256": "7feeafcfc0c900f18c0b1c2d84a3ec72d1fad0e1f419a5ef71b2d7b470db9a63"
  },
  {
    "key": "25mb-pretty",
    "targetBytes": 25000000,
    "pretty": true,
    "bytes": 46429175,
    "records": 30014,
    "sha256": "f38edc3bae2df05ab719ad795331b9feee0d45e922b6d3a4d5b5e6ed274ef0eb"
  },
  {
    "key": "50mb",
    "targetBytes": 50000000,
    "pretty": false,
    "bytes": 49998859,
    "records": 60051,
    "sha256": "c3e4ee5212c3500aaaf24c8a518c446ca4004ab6a3ed98b0b5037bdbec4ceb23"
  },
  {
    "key": "50mb-pretty",
    "targetBytes": 50000000,
    "pretty": true,
    "bytes": 92806317,
    "records": 60051,
    "sha256": "2a3c261871b43b8bebc51742df5e4f38500d9893e4e0dde3f71dc744a38fbc55"
  },
  {
    "key": "100mb",
    "targetBytes": 100000000,
    "pretty": false,
    "bytes": 99999788,
    "records": 119935,
    "sha256": "dda41c73526f8cf82b328bcc79600f168327a48de0ee29b8d6fc65154ae11d69"
  },
  {
    "key": "200mb",
    "targetBytes": 200000000,
    "pretty": false,
    "bytes": 199999972,
    "records": 239230,
    "sha256": "fe13bc1b68958f453dcfa23dd74c35ae6c49b4d28332c121aacca5f05bd851b3"
  },
  {
    "key": "400mb",
    "targetBytes": 400000000,
    "pretty": false,
    "bytes": 399999594,
    "records": 478192,
    "sha256": "933968cfcf23684702ec5df6bceb9ddecd4683eb6d1975cf49157ed5afeb3f16"
  }
] as const;
