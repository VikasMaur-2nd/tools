# Documented harness retries

## Worker fidelity run 3

The first attempt on October 16 at 18:17 UTC waited for the large input textarea before clicking the input. The page deliberately keeps a large input dormant until the first interaction. The source view and output were visible and responsive. This is a preparation error, not evidence of a numeric-value failure or a frozen editor. Its raw JSON and screenshot are preserved. One retry uses a normal page load, clicks the public input, and then sends the edit. The later worker observation uses that corrected preparation from its first attempt. No challenge or ad was bypassed.

## Tool Kumar 100 KB typing adapter pilot

The first attempt at 18:18 UTC read innerText on every output mutation. That read can force synchronous layout during a typing event. The output observer now reads textContent until the final marker appears, then checks visibility once. It also records the observer's cumulative execution time. The pilot's high latency is preserved and excluded from the final comparison, with one corrected normal-navigation retry under the same fixture, caret positions and input rate. All other tools start with the corrected observer. This is an instrumentation correction, not a Tool Kumar code change.

## Code Beautify 100 KB typing adapter observation

The first run at 18:33 UTC opened in 7.384 seconds, then input acknowledgments timed out. An unbounded later page read allowed it to continue until a 65.4-second frame gap was captured and the browser hit 2,564 MiB against the 2,560 MiB cap. The observation and cap stop remain raw evidence and will be reported as a diagnostic result. The final editing runner bounds page reads at five seconds after the existing 15-second CDP input-acknowledgment budget. One corrected retry supplies the standard-budget run 1. This prevents one tool from receiving a different waiting period. The saved failure is not replaced or deleted.

## JSON Beautifier 100 KB source restoration

The initial file workflow rewrote both Ace panes to pretty JSON. The minified-source caret request was clamped before any typing burst. One corrected normal-navigation retry restores the exact chosen source via trusted Input.insertText before the common warm-up. The failed adapter attempt is retained and excluded. JSON Viewer Stack's covered tab in the same batch is an ad obstruction, not a harness defect, and receives no retry for that reason. No ad was clicked or dismissed.

## JSON Formatter Online 100 KB caret preparation

The first attempt at 20:32 UTC could not open a public Go to line dialog. No measured typing was sent. One corrected retry uses the site's working Find panel, searches the unique record email, closes Find and presses Right to put the caret after the email inside its quote. The source value and position are the same as the other tools. JSONLint's covered input in the same batch remains an obstruction, with no retry for that reason.

## JSONLint 100 KB focus target correction

The saved editing screenshot shows a visible Monaco editor with no ad covering it. The initial click target was its clipped view-lines layer, whose offscreen bounds put the helper’s point just outside the editor. No typing burst was sent. One corrected retry targets the visible monaco-editor panel. This supersedes the earlier tentative interpretation of a covered input. The original raw failure and both screenshots remain intact. Stack’s full-page ad observation remains an obstruction and is not retried.

## Tool Kumar prettified 100 KB preparation

The first attempt at 20:51 UTC opened in 491 ms, then timed out during a whole-document Input.insertText source restoration before a typing burst. The corrected preparation writes the chosen fixture to the fresh browser’s clipboard and uses trusted Ctrl+V, preserving normal paste handling. One retry is permitted for this case. The earlier preparation freeze remains recorded. JSONLint’s already-retried minified 100 KB case receives no second retry; its source-restoration freeze remains a preparation outcome. Future attempts use the clipboard path for every tool.
