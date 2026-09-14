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

No transcript review. No tool-call archaeology. The foreman sees only the last user message and the last assistant answer, then either calls `veto` or stays quiet. This lets it respect an explicit request to stop, pause, or leave the remaining work alone.

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
- choose its reasoning level.

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
