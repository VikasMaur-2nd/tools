# Raw results

Every measured run of the study, as JSON lines (one object per run or case), in the folder of the GitHub Actions run
and job that produced it. `runner.txt` records each job's machine (CPU model, memory, start and end time) and
`run.log` what it printed. Score them with `node ../kit/score.mjs .` (from this folder) to get `../scores.json`.

| Folder | What it holds | Used for |
|---|---|---|
| `run-41339388831/speed-firefox/` | Firefox speed runs, 3 repetitions (2026-11-01) | Only whether 100 KB and 1 MB format correctly in Firefox (amendment 2) |
| `run-41379112074/speed-chromium-1/`, `speed-chromium-2/` | Chromium speed runs, repetitions 1–3 and 4–5 (2026-11-02) | Speed, page load, page weight, third parties, ads, uploads |
| `run-41379112074/quality/` | Data safety, error help, features, keyboard, offline, phone | Those checks |
| `run-41379112074/webkit/` | The WebKit check | WebKit works |
| `run-41429253183/repeat-*` | Runs repeated after site outages and runs that could not start (amendment 3); `repeat-A` is recovered from the job log (amendment 4) | Replace the runs they repeat |
| `run-41454555943/final-*` | The final gap-filling job (amendment 4) | Replace the runs they repeat |
| `excluded.json` | The site-outage windows: failed runs inside them are left out | |
| `screenshots/` | The screenshots cited as evidence for the site outages | |

How runs combine (protocol amendments 3 and 4): each repetition's value is its latest attempt, so a run repeated later
replaces the earlier one. A run where the site was down or the harness's own clipboard step stalled counts neither
way, nor do the runs the size ladder skipped only because of it. The pilot and trial runs are not here: none of their
numbers is used.

Each speed record has the time from the paste to the complete result (`ms`, the scored time), the same including the
untimed pause before a click (`totalMs`), the longest gap between painted frames (`freezeMs`), whether the output was
checked to hold exactly the input's data (`verified`), the network summary (`net`: requests, bytes, third-party
domains, ad requests) and any request that carried the test file's marker (`uploads`).
