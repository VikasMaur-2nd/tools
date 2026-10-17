# Chart alt text

- `fidelity.svg`: Seven numeric cases by tool. Tool Kumar's latest small and worker-path observations are separate from the October 15 competitor observations. See the tables for current verdicts, duplicate-member checks and spelling notes. No optional Big Num mode is included.


- `local-code-opening.svg`: Three rounds of local production builds of the listed commits on the same four-CPU host and 2.5 GiB browser budget. Bars show median polled file opening at 1 MB, 10 MB and 50 MB, with successful-run counts. The adjacent table gives ranges and precise DOM and frame timing. These are separate from CDN results.

## editing-50mb-6g.svg

Earlier Tool Kumar-only 50 MB data after Edit anyway, 6 GiB browser budget and different restoration preparation. prettified: 3/3 complete profiles; Event Timing median 56.0 ms, p95 96.0 ms. minified: 3/3 complete profiles; Event Timing median 48.0 ms, p95 104.0 ms. These profiles are not pooled with the later six-tool comparison. Earlier 2.5 GiB cap failures remain historical evidence.

## Current six-tool comparison

- `opening-before-after.svg`: Original Tool Kumar at 19b7ac7 on two CPUs and a 2.5 GiB browser budget, next to 925fc3c on four CPUs with a 6 GiB budget. The table states all three sizes, ranges and run counts. The production difference combines host, budget and code changes. The local code-control chart retains one hardware and memory condition.
- `outcomes.svg`: Three scheduled attempts per tool and size with the same 6 GiB browser budget. Filled squares count successful formatted/tree views. Full-run cap stops are printed separately. An obstructed page has no successful median.
- `renderer-memory.svg`: Paired median renderer peaks to the view or stop and over the full run for all six tools, in MiB. Full-run cap counts refer to the total browser tree. Advertising and feature work contribute to the full window.
- `editing-latency.svg`: Median and p95 trusted keydown-to-next-rAF response, with minified and prettified copies of the same data. Solid and outlined circles distinguish formats. The scale is logarithmic. Incomplete cells show their actual complete/attempted profiles. Event Timing thresholds, output updates and freezes remain in the table.
