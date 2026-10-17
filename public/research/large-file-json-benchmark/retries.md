# Harness notes for 925fc3c

No retries have been used in this series. Earlier attempts and corrections remain in their original dated directories. A fresh version is a new experiment, not a replacement of an earlier failure.

The worker-fidelity probe now requires a packed-tree reply observed after the real CDP edit. It cannot accept the tree received during opening as evidence for the edited path.

Every timed command uses flock --close. No server starts in the measurement lock.

Before any run in this series, source restoration was changed to stage the fixture once with a browser-local file read. Trusted Ctrl+V still performs every restoration. This avoids sending a whole 50 MB or larger prettified source inside each CDP Runtime.evaluate command. Staging and restoration stay outside the typing clock. This is a planned preparation change, not a retry or a new input-latency result.

Per-key acceptance also requires the inserted marker in the source or a confirmed visible output. Trusted key delivery alone does not prove an edit. The same rule grades the retained comparator observations. Before navigation, each current fixture is checked against its fixed format-specific SHA-256 manifest.

## 50 MB profile 1 minified

The first attempt opened in 10.719 s, then hit the 2.5 GiB total-browser cap while restoring source and preparing Tree-based caret navigation. No typing burst completed. The raw cap outcome is retained. It does not establish ordinary per-key latency. One corrected harness retry will use the rendered input rows' source offsets, a trusted click, and native passage selection to place the same unique email caret. This avoids materializing a full Tree solely for caret placement. It does not change the input, typing clock, rate, fixture, cap or caret position. All later 50 MB profiles use the corrected preparation.

## 50 MB profile 1 prettified

The partner source also opened, in 12.817 s, then hit the total-browser cap during source restoration after Tree-based warm-up. No burst was sent. This case receives its single corrected input-row caret retry too. The two first cap outcomes stay in the main outcome count, not only an exclusion log. A row can therefore have four attempts with three complete profiles if its one retry and later scheduled profiles complete. Conditional per-key summaries still require at least three complete matched profiles.

## Later 50 MB profiles

The minified profile 1 retry still hit the browser cap during whole-document source restoration. That profile receives no further retry. Its first attempt and retry remain in the outcomes. Later scheduled 50 MB profiles restore the independent burst and key edits with trusted Undo, then verify the exact source SHA-256 after the profile. They do not stage or paste another whole source solely for caret preparation. This lowers preparation memory and avoids accumulating whole-document undo snapshots. It does not change the timed burst, rate, matched positions, output clock or cap. Those profiles identify the restoration method. No successful attempt is silently substituted. If fewer than three matched profiles complete, combined typing quantiles remain unmeasured.

## Scheduled 50 MB profile 2

After the preparation change, minified profile 2 reached `start-dispatched` before the browser cap stopped the process at 2,788 MiB total. No complete probe snapshot survived. The prettified profile 2 stopped at 2,576 MiB during preparation. These are cap outcomes, not natural browser crashes. No per-key median is assigned and neither case receives a retry. The original 2.5 GiB cap stays unchanged. The remaining scheduled profile 3 will remain in the outcome count.

Later profiles add a public-output-search diagnostic only after an unconfirmed output interval has ended and the observer has stopped. Finding the marker then confirms eventual output content, not its update time. The earlier unconfirmed intervals stay unconfirmed. No normal per-key or output clock is extended by that diagnostic.
