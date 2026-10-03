<p align="center">
  <img src="assets/foreman.webp" alt="Agent Foreman" width="720">
</p>

<h1 align="center">Pi Agent Foreman</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/pi-agent-foreman"><img src="https://img.shields.io/npm/v/pi-agent-foreman" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/pi-agent-foreman"><img src="https://img.shields.io/npm/dm/pi-agent-foreman" alt="npm downloads"></a>
  <a href="https://github.com/alexshpunt/pi-agent-foreman/actions/workflows/ci.yml"><img src="https://github.com/alexshpunt/pi-agent-foreman/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/pi-agent-foreman" alt="MIT license"></a>
</p>

Your agent says "Continuing the run" and ends its turn.

**Foreman sends it back to do the work it left unfinished.**

Pi Agent Foreman checks the **final assistant reply** for an announced next action or explicitly unfinished work. The default classifier is `typesafe/jev-latest`; you can choose another available classifier in Pi. Six questions share one classifier request. Blocking signals prevent intervention. Otherwise, a separate Pi agent writes a specific instruction to continue the identified work.

## Install

```sh
pi install npm:pi-agent-foreman
```

Requires Pi 1.0.0 or newer. Foreman uses the Node.js runtime bundled with your Pi
installation.

## Cost and privacy

When enabled, Foreman sends only the final assistant reply to the selected classifier after each settled
run. It does not send the user request, tool output, earlier replies, or private thinking
to the judge.

A separate Pi agent is called only when the signals allow continuation. That agent
receives the final reply, the last user request, and bounded activity after that request
to identify the concrete next or unfinished action. Activity includes assistant text, earlier Foreman
instructions, compact tool arguments, and excerpts of tool results. These can contain
private data; size limits do not redact secrets. Private thinking is not included.

Decisions are stored in `<agent dir>/agent-foreman/decisions.jsonl` with all six signal probabilities.

## Set up the foreman

Run:

```text
/agent-foreman
```

The menu lets you:

- turn **Back to Work** on or off;
- choose the model that writes instructions from those already available in Pi;
- choose its reasoning level;
- choose the classifier from providers configured in Pi.

Back to Work is on by default. Until you choose a dedicated foreman, it uses the current session model and reasoning level. Choosing a model automatically enables the mode.

The selection is stored globally in Pi's `settings.json`:

```json
{
  "agentForeman": {
    "enabled": true,
    "model": "openai-codex/gpt-5.6-luna",
    "classifier": "typesafe/jev-latest",
    "thinking": "low"
  }
}
```

You do not need to edit this file yourself.

## How it decides

Foreman requires Pi 1.0.0 or newer. Pi handles classifier discovery and credentials.
Choose an available classifier in `/agent-foreman`; the default is `typesafe/jev-latest`.
For this default, set `TYPESAFE_API_KEY` or configure the TypeSafe provider in Pi.
Other classifier providers use their normal Pi authentication.

If the selected classifier is missing, unavailable, or returns an invalid answer,
Foreman stays quiet and shows a warning. It does not silently switch providers.

Jev answers six questions about the full reply:
- Is there an announcement of the assistant's next action?
- Does an obstacle block further work?
- Is a new user decision or permission needed?
- Does the reply explicitly say work is unfinished?
- Is further action postponed?
- Does the assistant explicitly refuse or cancel further work?

An announced next action **or** explicit unfinished work can trigger continuation.
A blocker, permission requirement, postponement, or explicit stop vetoes it.
A completed-work report does not cancel a next action elsewhere in the reply.

The positive threshold is `0.5` by default. Set `agentForeman.threshold` between `0` and `1`
to change it. Each blocking signal vetoes at `0.5`, regardless of that setting.
Foreman does not combine the scores into a made-up probability.

The nested agent writes an instruction for the work identified in the final reply,
using bounded context to resolve its action and scope. It respects restrictions in that
context and stays quiet if it cannot identify a safe concrete action. It does not resume
unrelated older work.

Every successful classifier decision is appended to
`<agent dir>/agent-foreman/decisions.jsonl` with all six probabilities, the reason,
and the instruction when one was sent.

## Tuning the judge

`npm run bench` sends final replies to the real judge and compares its decisions with
`bench/cases.ts`. Cases cover next-action announcements, explicit unfinished work, completed reports, blockers, permission requests, postponement, and refusals. Examples use generic scenarios. A failing case is a tuning target, not a broken build.

```sh
npm run bench                              # all cases, one run each
npm run bench -- --repeat 3                # stability: three runs per case
npm run bench -- --group promise,target    # only some groups
npm run bench -- --case retry-fixed-promises-resume-ru # one case
npm run bench -- --threshold 0.9           # raise the positive-signal threshold
```

This costs real API calls and is not part of `npm test` or CI. Every run writes the full
result to `.tmp/bench/last.json` (ignored by git) and exits non-zero when a case fails.

## What it looks like

When Foreman finds further work without a blocking signal:

```text
⛑ Foreman sent the agent back to work
```

The instruction itself is delivered as a normal user message. The main agent does not receive a foreman wrapper or hidden transcript.

Pressing Esc to abort a run never summons Foreman. A status answer can resume work if it explicitly reports incompletion; a completed answer without an announced next action does not.

## Development

```sh
git clone https://github.com/alexshpunt/pi-agent-foreman.git
cd pi-agent-foreman
npm install
npm test
```

## License

MIT
