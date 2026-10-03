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

**Foreman sends it back to do what it promised.**

Pi Agent Foreman uses Pi’s classifier runtime to check whether the **final assistant reply** promises an
immediate action. The default classifier is `typesafe/jev-latest`; you can choose another available classifier in Pi. A confident promise triggers a separate Pi agent that writes a specific
instruction. No promise means no intervention, even if earlier work is unfinished.

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

A separate Pi agent is called only after a confident promise is detected. That agent
receives the final reply, the last user request, and bounded activity after that request
to identify the promised action. Activity includes assistant text, earlier Foreman
instructions, compact tool arguments, and excerpts of tool results. These can contain
private data; size limits do not redact secrets. Private thinking is not included.

Decisions are stored in `<agent dir>/agent-foreman/decisions.jsonl` with a `promise` probability.

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

Jev answers one question: does the final reply promise a concrete action **now or next**?
"Continuing the run" counts. Confidence, completed-work reports, optional ideas, later
or conditional promises, and automatic continuation do not.

The code compares the promise probability with a threshold, `0.7` by default.
You can set `agentForeman.threshold` between `0` and `1`. Below the threshold,
Foreman does nothing. At or above it, a nested Pi agent writes an instruction for the promised
action, not for unrelated unfinished work. If it cannot identify the action, Foreman
stays quiet rather than sending a generic instruction.

Every successful jev decision is appended to `<agent dir>/agent-foreman/decisions.jsonl`
with its probability, reason, and instruction when one was sent.

## Tuning the judge

`npm run bench` sends final replies to the real judge and compares its decisions with
`bench/cases.ts`. Cases cover immediate promises, confidence without a promise, and
exceptions such as negation and automatic reload. The RU/EN retry pair comes from a
user-provided example with generic names. A failing case is a tuning target, not a broken build.

```sh
npm run bench                              # all cases, one run each
npm run bench -- --repeat 3                # stability: three runs per case
npm run bench -- --group promise,target    # only some groups
npm run bench -- --case retry-fixed-promises-resume-ru # one case
npm run bench -- --threshold 0.9           # raise the confidence threshold
```

This costs real API calls and is not part of `npm test` or CI. Every run writes the full
result to `.tmp/bench/last.json` (ignored by git) and exits non-zero when a case fails.

## What it looks like

When Foreman detects an immediate promise:

```text
⛑ Foreman sent the agent back to work
```

The instruction itself is delivered as a normal user message. The main agent does not receive a foreman wrapper or hidden transcript.

Pressing Esc to abort a run never summons Foreman. A status answer without an immediate promise does not resume earlier work.

## Development

```sh
git clone https://github.com/alexshpunt/pi-agent-foreman.git
cd pi-agent-foreman
npm install
npm test
```

## License

MIT
