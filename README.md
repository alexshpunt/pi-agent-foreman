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

Your agent finished early.

The tests are still waiting. The implementation has a "small follow-up." The agent has helpfully explained what somebody should do next.

**Foreman sends it back to work.**

Pi Agent Foreman watches the final exchange after every settled Pi run. If the agent openly admits that it stopped before finishing required work, a small second model gives it one firm instruction: finish the job now.

The foreman sees the last user message and the agent activity that followed it, then either calls `veto` or stays quiet. The activity includes every assistant text, compact tool-call arguments, and success or error statuses. Private thinking and full tool results stay out. This keeps enough context for background updates without turning the review into tool-call archaeology.

## Install

```sh
pi install npm:pi-agent-foreman
```

## Set up the foreman

Run:

```text
/agent-foreman
```

The menu lets you:

- turn **Back to Work** on or off;
- choose a foreman from the models already available in Pi;
- choose its reasoning level;
- choose the **Judge**: `auto`, `model`, or `typesafe`.

Back to Work is on by default. Until you choose a dedicated foreman, it uses the current session model and reasoning level. Choosing a model automatically enables the mode.

The selection is stored globally in Pi's `settings.json`:

```json
{
  "agentForeman": {
    "enabled": true,
    "model": "openai-codex/gpt-5.6-luna",
    "thinking": "low"
  }
}
```

You do not need to edit this file yourself.

## The two judges

There are two ways to judge a settled run.

**The model judge** asks a nested model to call a `veto` tool. It writes the instruction it
sends back, in the language of the assistant message.

**The TypeSafe judge** asks a TypeSafe System One model for probabilities instead and decides
in code: one request, one answer per question, no tool call and no generated prose. The
instruction is built from the answer, so it does not name the unfinished work in detail; the
agent still has the turn in its context.

`agentForeman.judge` selects one:

| Value | Behaviour |
| --- | --- |
| `auto` | The TypeSafe judge when a key is configured, the model judge otherwise. This is the default. |
| `model` | Always the model judge. |
| `typesafe` | The TypeSafe judge, falling back to the model judge when TypeSafe cannot answer. |

The fallback is what keeps the feature safe to leave on: a missing key, a refused request, or
a service that is down all end with the model judge doing the review, and the session shows one
warning about it.

Give the TypeSafe judge a key in one of two places. Either the environment of the Pi process:

```sh
export TYPESAFE_API_KEY=...
```

Or Pi's own credential file, which is read through Pi's public helper:

```json
{
  "typesafe": { "type": "api_key", "key": "..." }
}
```

The environment wins. The `/agent-foreman` menu shows which of the two the judge is using.

```json
{
  "agentForeman": {
    "enabled": true,
    "judge": "auto",
    "threshold": 0.5
  }
}
```

One request asks about the settled exchange: whether required work is still unfinished, whether
the agent put it off, the four reasons a stop can be legitimate, what kind of work is left, and
which language the request is in. `threshold` is the minimum probability that required work is
unfinished. The instruction goes back in the language of the request.

Both judges follow the same policy, written once in `src/policy.ts`: the model judge reads it
as prose, the TypeSafe judge asks about it as typed questions, so the two cannot drift apart on
what counts as a legitimate stop.

Every TypeSafe decision is appended to `<agent dir>/agent-foreman/decisions.jsonl`, one JSON
line per settled run, with every answer, the decision and its reason, and the instruction when
one was sent. The instruction itself also lands in the session file; the numbers behind it only
exist in this log.

## Tuning the judge

`npm run bench` sends a set of invented exchanges to the real judge and compares each
decision with the intended behaviour in `bench/cases.ts`. The cases cover lazy stops, the
legitimate reasons to stop, and the cases that are already known to be hard. Every case is
written for that file: no case is taken from a real session, and none names a real
repository, commit, or log. A failing case is a tuning target, not a broken build.

```sh
npm run bench                              # all cases, one run each
npm run bench -- --repeat 3                # stability: three runs per case
npm run bench -- --group lazy,target       # only some groups
npm run bench -- --case todo-in-reply      # one case
npm run bench -- --threshold 0.7           # the tuning knobs
```

This costs real API calls and is not part of `npm test` or CI. Every run writes the full
result to `bench/.results/last.json` (ignored by git) and exits non-zero when a case fails.

## Custom prompt

Create either a project prompt:

```text
.pi/agent-foreman/prompt.md
.pi/agent-foreman/config.json
```

or a global prompt:

```text
~/.pi/agent/agent-foreman/prompt.md
~/.pi/agent/agent-foreman/config.json
```

A trusted project prompt takes precedence over the global prompt. The project file is ignored when the project is not trusted.

Without `config.json`, `prompt.md` completely replaces the built-in reviewer prompt. To append your instructions instead, add:

```json
{
  "mode": "append"
}
```

The supported modes are `override` and `append`. If the prompt or configuration cannot be read, Foreman shows a warning and uses its built-in prompt.

## What it looks like

When the foreman catches an unfinished answer:

```text
⛑ Foreman sent the agent back to work
```

The instruction itself is delivered as a normal user message. The main agent does not receive a foreman wrapper or hidden transcript.

Pressing Esc to abort a run never summons the foreman. Research answers, genuinely completed work, and agents waiting for background work or sub-agents they already started are left alone.

## Development

```sh
git clone https://github.com/alexshpunt/pi-agent-foreman.git
cd pi-agent-foreman
npm install
npm test
```

## License

MIT
