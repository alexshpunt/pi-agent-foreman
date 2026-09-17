# Changelog

Releases before 0.5.0 are described in the [GitHub releases](https://github.com/alexshpunt/pi-agent-foreman/releases).

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
