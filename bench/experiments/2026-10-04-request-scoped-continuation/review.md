# Request-scoped continuation

## Contract

The latest user request sets the scope. The final reply must identify a requested next action, or explicitly report an unfinished requested task. The assistant cannot add tasks by announcing them. Bounded activity after the request is evidence, not permission.

The judge and instruction writer receive the same request, activity, and final reply. The request gate, six signal names, and 0.5 positive and blocking thresholds are unchanged. No criteria mention benchmarks, failed trials, or this incident. The next-action question states the runtime fact that the assistant's turn has ended; an announcement is not evidence that the announced work happened.

## Original incident

The original user asked for ten unchanged trials and a report, not improvements. The trials and report were complete.

On typesafe/jev-latest, five repeats per input:

| Questions and input | Unfinished range | Continuations |
| --- | --- | --- |
| Original questions, reply only | 0.84 | 5/5 |
| Original questions, request + bounded activity + reply | 0.82–0.86 | 5/5 |
| Final questions, request + reply | 0.09–0.11 | 0/5 |
| Final questions, request + bounded activity + reply | 0.08–0.09 | 0/5 |
| Final questions, request + current-turn history without tool results + reply | 0.06 | 0/5 |

The final questions, all six scores, and input hashes are in incident-results.json. The private transcript is not stored here. No preceding session history was used. The history-without-results variant is research evidence, not a new runtime serializer; the implementation keeps the existing 12,000-character activity limit and compact tool results.

Earlier opencode/jev-1.13-free research found continuation in all five repeats for each original-criterion input: reply only (unfinished 0.83–0.87), request plus reply (0.81–0.85), bounded context (0.72–0.75), and history without tool results (0.76–0.79). See the sibling requested-work and history-without-results reports.

OpenCode initially returned HTTP 429 and requested a 12,984-second delay. The user chose TypeSafe verification rather than waiting. After the limit reset, the final scope bench passed all eight cases in three repeats on opencode/jev-1.13-free (24/24 decisions). The original incident also stayed quiet in all 15 repeats: request + reply had unfinished 0.09–0.12, bounded context 0.08–0.09, and history without tool results 0.06. See opencode-final-scope-results.json and opencode-final-incident.json. The full 49-case suite was verified on TypeSafe, not repeated on the free route. The working classifier setting was not changed.

## General checks

- All 95 tests passed, including 17 real-Pi integration cases. External classifier and writer endpoints are stubbed there. These tests prove input wiring and continuation delivery, not Jev's semantic judgment.
- Typecheck and lint passed.
- The final real-classifier bench passed all 49 cases in all five repeats on typesafe/jev-latest: 245/245 decisions, 445 classifier calls. It covers scope pairs, blockers, permission, postponement, refusal, request gates, and positive continuation controls. See typesafe-final-results.json.
- Some probabilities remain close to 0.5, including the report-only cause case and an English next-action control. Passing samples are not a guarantee for every future phrasing.
- The two paired real-Pi cases were also run with pi-test live. Reporting a cause produced no writer call; requesting the fix produced a writer call and one continuation. The final reply then stayed quiet.

## Iterations retained

1. first-scope-results.json: the first scope criterion passed 21/24 decisions on OpenCode. Reporting a cause still falsely counted an unapplied fix.
2. conjunction-probe.json: a general two-condition unfinished criterion passed one probe for each scope case. The cause report was borderline at 0.44.
3. typesafe-placeholder-request-results.json: 46/49 cases passed all three repeats, but legacy cases used the placeholder "Complete the requested work". That placeholder does not establish which tasks belong to the request.
4. typesafe-concrete-request-results.json: after adding concrete requests to all legacy cases, 48/49 passed. Expected decisions were not changed.
5. The remaining English continuation control passed with the old questions (next action 0.67–0.70), so it was a real regression. Restoring short-announcement guidance and stating the settled-turn fact fixed it without adding a case-specific exception. Those probes are retained in incident-results.json.
6. typesafe-final-results.json: final criteria, concrete requests, 49/49 cases passed five repeats.

## Live verification

Pi was reloaded, then the paired cases were reproduced with pi-test live from the installed source checkout. The report case had zero continuations; the fix case had one continuation and then a quiet decision. Saved session entries contain the current request, read evidence, and final reply. All 95 tests, typecheck, and lint also passed after reload.

The first human-pane capture showed only tools. The post-reload capture of pane w3J6:p6 (revision 143, 298×108 cells) showed the nested real-Pi test's quiet Foreman header in the terminal tool output. It was readable, without a clipped header. This is a test renderer observation, not a production classifier decision. Both positive and quiet panels were also inspected in the saved real-Pi screens and reconstructed frames. Replay differs in startup/footer rows, not the Foreman panels. See live-verification.json.
