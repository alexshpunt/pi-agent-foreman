# Requested-work criterion experiment

The revised criterion removed the false positive in all 15 checks of this incident. Adding context alone had not removed it.

## Setup

- Classifier: `opencode/jev-1.13-free`.
- Source revision: `6870b88`.
- Action and blocking thresholds: 0.5.
- Five calls per input variant for each criterion.
- Same exact incident inputs as the earlier experiment.
- Same question types and instructions. Only the true and false criteria for `unfinished` changed.
- The request gate had scored 0.89 in the earlier experiment. That result was reused.
- Calls ran through Pi's classifier API. No instruction writer or main-agent continuation ran.

The user asked for ten parallel trials and an assessment, not a fix. The assistant reported that all ten trials had finished, none passed, findings were saved, and no improvements had been applied.

The activity variant uses the existing 12,000-character head/tail context. It is not the full history and includes the final reply. Private input text remains in the active Pi session; it is not published in this report.

## Comparison

“Continue” counts decisions at the unchanged 0.5 threshold. Probability ranges cover the five samples.

| Input | Original continue | Revised continue | Original unfinished | Revised unfinished | Mean change |
| --- | --- | --- | --- | --- | --- |
| reply_only | 5/5 | 0/5 | 0.83–0.87 | 0.31–0.36 | 0.846 → 0.328 |
| reply_and_request | 5/5 | 0/5 | 0.81–0.85 | 0.12–0.13 | 0.824 → 0.124 |
| reply_request_activity | 5/5 | 0/5 | 0.72–0.75 | 0.10–0.11 | 0.732 → 0.106 |

All other signals stayed below 0.5 in both batches. The revised outcomes were quiet because neither positive signal crossed the threshold, not because a blocker vetoed continuation. All 15 new calls succeeded.

[results.json](results.json) contains all six probabilities for every original and revised call, raw classifier responses, per-signal ranges and means, and both complete question sets.

## Exact change

The question instruction stayed unchanged:

> Does the reply explicitly report that requested work or a concrete part of it has not yet been completed?

Original true criterion:

> The assistant explicitly says the task is not done, a fix is not applied, or concrete work remains incomplete. A next-step announcement alone is not an explicit report of incompletion.

Original false criterion:

> No explicit report of incomplete work. Completed-work reports or a next-step announcement without an explicit incompletion statement do not qualify.

Revised true criterion:

> The assistant explicitly reports that work explicitly requested by the user, or a concrete part of that requested work, has not been completed. Count an unapplied fix only if the user explicitly requested that fix. Do not infer that work is unfinished merely from a failed experiment or an unsuccessful result.

Revised false criterion:

> No explicit report that the user's explicitly requested work remains incomplete. A completed investigation, experiment, or test run is completed work even when its result is failure. Improvements, fixes, optional next steps, or other further actions that the user did not explicitly request do not count as unfinished requested work. If the user request is not available, do not infer that an improvement or further action was requested.

## What this shows

For this incident, narrowing the criterion changed the decision even without adding the user request. Adding the request then reduced the revised unfinished probability further. Activity added a smaller further reduction.

The result supports distinguishing unfinished requested work from unapplied improvements and failed experimental outcomes. It does not establish which sentence caused the original false positive; no reply-sentence ablation was run.

This is one incident, not evidence that the revised criterion works generally. No genuinely unfinished-work controls were tested. The baseline is the earlier batch, not a new simultaneous control. The new criteria contain several clarifications, so their individual effects are not separated.

The continuation writer was not evaluated in this experiment. Its earlier instruction to repeat completed work remains a separate issue.

Runtime source, installed Foreman, and settings were not changed. No prompt-wording regression tests were added.

## Follow-up: unchanged criteria

The user rejected treating this wording experiment as a general fix. A [separate context-only experiment](../2026-10-04-history-without-results/review.md) kept the original criteria, included every tool call and assistant text in the current turn, and omitted tool-result messages. The original incident still triggered continuation in all five repeats. Two simple synthetic completed/unfinished controls behaved as expected, but they did not test or validate the rewritten criterion. No general fix has been accepted or shipped.
