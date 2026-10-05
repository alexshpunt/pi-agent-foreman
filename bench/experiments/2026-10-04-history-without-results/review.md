# Original criteria with history without tool results

Removing tool-result messages did not remove the original false positive: all five incident checks still said to continue.

## Setup

- Same `opencode/jev-1.13-free`, six original questions and 0.5 thresholds.
- Five repeats per successful input variant.
- History starts after the original user request and ends at its final assistant reply. Earlier conversation was not sent.
- Retain all three visible assistant texts and all 24 tool calls, with full arguments.
- Omit all 24 tool-result messages. No total character clipping.
- The resulting activity is 19,237 characters and fits the endpoint.
- Keep the exact request and final reply in separate state fields; the final reply also remains in activity, matching the original layout.
- Original incident request gate reused: 0.89. Control gates passed at 0.94 and 0.95.
- No instruction writer or main-agent continuation ran.

The unabridged current turn had 152,686 characters. The endpoint rejected its single probe with HTTP 400 `max_tokens_exceeded`. Jev's catalog context window is 32,000 tokens. This was not the whole session and yielded no decision.

The reduced input was recovered from the exact current-turn activity captured before the source session underwent surgery. All 24 call arguments parsed as JSON, marker counts matched the source metadata, and the final assistant segment matched the incident reply. Private input remains in the active Pi session, not in Git.

## Original incident

| Input with original criteria | Continue | Unfinished probability |
| --- | --- | --- |
| Reply only, earlier batch | 5/5 | 0.83–0.87 |
| Reply and request, earlier batch | 5/5 | 0.81–0.85 |
| Reply, request and existing 12,000-character activity, earlier batch | 5/5 | 0.72–0.75 |
| Reply, request and all current-turn assistant text/tool calls, no results | 5/5 | 0.76–0.79 |
| Reply, request and unabridged current turn | No decision | Input exceeded token limit |

The new incident samples were 0.78, 0.79, 0.78, 0.76 and 0.78 for `unfinished`. Their mean was 0.778. Other signals remained below 0.5, so the unfinished signal alone caused continuation.

## Controls

The request, reply and expected decision come unchanged from the existing `completed-fix` and `unfinished-fix` cases in `bench/cases.ts`.

Both synthetic histories have the same two attempted operations: read a file and replace a repeated delivery call. Their final replies differ. A tool call alone cannot establish that an edit succeeded. These histories are minimal fixtures, not actual recorded executions.

| Control | Reply-only continue | No-result-history continue | Unfinished: reply only → with history |
| --- | --- | --- | --- |
| completed-fix, expected quiet | 0/5 | 0/5 | 0.02–0.03 → 0.02–0.03 |
| unfinished-fix, expected continue | 5/5 | 5/5 | 0.98 → 0.98 |

All 25 new classification calls succeeded. Both control variants kept the expected decision in all repeats.

[results.json](results.json) records all six probabilities, decisions, response metadata, control fixtures, request-gate responses, the failed full-turn probe and earlier original-criterion samples.

## Conclusion and limits

Keeping only assistant text and tool calls is a general way to reduce context, but it did not fix this incident with the original criteria. The two simple controls show that this representation did not make the classifier always stop or always continue; they do not establish broad correctness.

The earlier criterion rewrite is a case-specific experiment, not an accepted general fix. These controls used only the original criteria and do not validate the rewritten criteria.

The full-turn probe failed, so no claim can be made about what Jev would decide on that input. Earlier baselines were reused, not rerun simultaneously. Neither tool-call history nor an assistant's completed-work claim proves successful execution without results.

Runtime source, installed Foreman, tool descriptions, prompts and settings remain unchanged. Only experiment reports and data are recorded.
