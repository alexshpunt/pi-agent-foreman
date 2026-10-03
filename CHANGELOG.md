# Changelog

## 0.5.5 — 2026-10-03

### Changed

- Use Pi's classifier runtime instead of the TypeSafe SDK. Requires Pi 1.0.0 or newer.
- Choose any available Pi classifier in `/agent-foreman`, independently of the instruction writer.
- Show the selected classifier in expanded decision details.

Releases before 0.5.0 are described in the [GitHub releases](https://github.com/alexshpunt/pi-agent-foreman/releases).

## 0.5.4 — 2026-10-03

### Added

- Show every Foreman decision, including decisions not to intervene.
- Expand with Ctrl+O to see the score, threshold, reason, full evaluated reply, user request, work context, and continuation instruction when present.
- Separate judge input from instruction-writing context with Markdown sections and a tool-style background.

### Changed

- Check only the final assistant reply for a promise of immediate action. No promise means no intervention, even when work is unfinished.
- Give the separate instruction agent the promised action and bounded context, without asking it to judge task completion again.
- Add RU/EN promise cases and real-Pi continuation tests.

## 0.5.3 — 2026-09-27

### Fixed

- Stop sending the agent back after it answers a request for a cause, even if it mentions deeper investigation the user did not ask for.
- Keep completed plan-only requests from being treated as unfinished implementation work.

### Changed

- When TypeSafe decides that work remains, a nested model now writes a specific instruction instead of using the same stock message. If it cannot write one, the agent is not sent back.

## 0.5.2

### Changed

- Added search terms for agent monitoring, control, and task completion.

## 0.5.1

### Changed

- Expanded package metadata so Foreman is easier to find in npm and Pi Packages.
- Documented review cost, inspected context, compatibility, and fallback behaviour.
- Updated the package author name.

## 0.5.0

### Added

- **TypeSafe judge.** A second way to review a settled run: instead of asking a nested model to
  call `veto`, it asks a TypeSafe System One model for probabilities and decides in code. One
  request per run, no tool call, no generated prose.
- **Automatic choice of judge.** `agentForeman.judge` accepts `auto`, `model`, or `typesafe`.
  The default, `auto`, uses the TypeSafe judge when a key is configured and the model judge
  otherwise.
- **Fallback to the model judge.** When TypeSafe cannot answer — a missing key, a refused
  request, or the service being down — the model judge reviews the run instead, with one warning
  in the session. The feature is safe to leave enabled.
- **Shared stop policy.** Both judges follow the rules written once in `src/policy.ts`, so they
  cannot drift apart on what counts as a legitimate stop.
- **Instruction language.** The TypeSafe judge reports the language of the request and the
  instruction is written in it.
- **Decision log.** Every TypeSafe decision is appended to
  `<agent dir>/agent-foreman/decisions.jsonl` with all answers, the decision, its reason, and the
  instruction when one was sent.
- **Tuning bench.** `npm run bench` runs an invented corpus against the real judge and prints
  what each case expected and got. Not part of `npm test` or CI, because it costs API calls.

### Changed

- The `/agent-foreman` menu cycles the judge through `auto`, `model`, and `typesafe`, and shows
  where the TypeSafe key comes from.
