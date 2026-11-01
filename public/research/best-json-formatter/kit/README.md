# Replication kit: which online JSON formatter is best?

Everything used to measure and score the tools in the study. Read `../protocol.md` first: it says what is tested
and how it is scored, and it was committed before any measurement.

You need Node.js 22 or newer and pnpm. Browsers run headed (a real window), so on Linux without a display use
`xvfb-run`. Nothing large is downloaded: the test files are generated.

```sh
pnpm install --ignore-workspace          # one dependency: playwright-core 1.64.1
pnpm exec playwright-core install chromium firefox webkit
node generate.mjs                        # writes fixtures/100kb.json … 50mb.json and checks their SHA-256
node cases.mjs                           # writes cases/: the data-safety and error files, to paste by hand too
```

## Run one tool on your own computer

```sh
xvfb-run -a node run.mjs smoke --tools jsonformatter-org     # a few cases, two errors, 100 KB and 1 MB once
xvfb-run -a node run.mjs speed --tools tool-kumar --sizes 100kb,1mb --reps 3
xvfb-run -a node run.mjs quality --tools jsonlint --only data,errors
```

(On macOS or Windows leave out `xvfb-run -a`.) Results are JSON lines in `out/results/`, screenshots of failures in
`out/shots/`. `node score.mjs out/results` turns them into the scores of protocol section 6.

Your timings will differ from ours: they depend on your computer, browser version, network and the ads a site
shows that day. Compare tools within one run, not with our numbers.

## Run the whole study on GitHub Actions

1. Copy `kit/` into a repository of yours, and `github-workflow.yml` to `.github/workflows/formatter-study.yml`
   (change `KIT:` to where the kit is).
2. Put the jobs in `ci-run.json`. The study used:

   | Job | Command | Billed minutes |
   |---|---|---|
   | Chromium speed | `run.mjs speed --engine chromium --sizes 100kb,1mb,10mb,50mb --reps 5` | see the measurement log |
   | Firefox speed | `run.mjs speed --engine firefox --sizes 100kb,1mb,10mb,50mb --reps 3` | |
   | Quality | `run.mjs quality` | |
   | WebKit | `run.mjs webkit --engine webkit` | |

3. Push to a branch named `study-run/<anything>`. Each job uploads its `out/` folder as an artifact
   (`gh run download <run id>`). Put the artifacts in one folder and run `node score.mjs <folder>`.

Every tool's speed runs happen inside one job, so all tools of a browser share one machine: GitHub's runners do
not all have the same processor.

## What is in here

| File | What it does |
|---|---|
| `generate.mjs` | The speed files: seeded, exact sizes, minified; `fixtures.sha256.json` lists their hashes |
| `cases.mjs` | The data-safety and error cases (protocol 5.1 and 5.2) |
| `adapters/` | One file per tool: where to paste, what to press, where the result and errors appear, which controls give each feature. Nothing else differs between tools |
| `lib/harness.mjs` | Opening a tool, the timed paste-and-format, reading results and errors, the network record |
| `lib/inpage.mjs` | The code that runs inside each page: paste time, frame gaps, LCP and layout shift, editor reading |
| `lib/tokens.mjs` | The lossless JSON reader that grades data safety without `JSON.parse` |
| `lib/ad-domains.mjs` | The ad domains counted as ads |
| `run.mjs` | The tests |
| `score.mjs` | The scoring and the sensitivity check |
| `serp.mjs`, `select.mjs` | The search snapshot and the inclusion rule (protocol section 2) |
| `ci-plan.mjs`, `ci-run.json` | The GitHub Actions job list |

## If a tool changed

Websites change. If a tool's page no longer matches its adapter, the run reports "no complete result" or a missing
control; fix the selectors in `adapters/<tool>.mjs` (they are short) and run again. If you find that we measured a
tool wrongly, tell us at the address on the study page: we check, correct and note it under "Deviations".
