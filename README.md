<p align="center">
  <img src="assets/foreman.png" alt="Agent Foreman" width="720">
</p>

# Pi Agent Foreman

Your agent finished early.

The tests are still waiting. The implementation has a "small follow-up." The agent has helpfully explained what somebody should do next.

**Foreman sends it back to work.**

Pi Agent Foreman watches the final answer after every settled Pi run. If the agent openly admits that it stopped before finishing required work, a small second model gives it one firm instruction: finish the job now.

No transcript review. No tool-call archaeology. No custom prompts. The foreman sees only the last answer and either calls `veto` or stays quiet.

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

## What it looks like

When the foreman catches an unfinished answer:

```text
⛑ Foreman sent the agent back to work
```

The instruction itself is delivered as a normal user message. The main agent does not receive a foreman wrapper or hidden transcript.

Pressing Esc to abort a run never summons the foreman. Research answers and genuinely completed work are left alone.

## Development

```sh
git clone https://github.com/alexshpunt/pi-agent-foreman.git
cd pi-agent-foreman
npm install
npm test
```

## License

MIT
