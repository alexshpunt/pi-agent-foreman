import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ModelLike } from "./models.ts";
import { resolveForemanModel } from "./models.ts";
import { resolveForemanPrompt } from "./prompt.ts";
import { createForemanRunner } from "./runner.ts";
import {
  type ForemanSettings,
  type ForemanThinkingLevel,
  parseSettings,
  THINKING_LEVELS,
  writeGlobalForemanSettings,
} from "./settings.ts";

export const CONTINUED_ENTRY = "agent-foreman-continued";

interface SessionReader {
  sessionManager?: { getBranch?: () => unknown[] };
}

export interface SettledExchange {
  user: string;
  activity: string;
}

function messageText(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part): part is { type: "text"; text: string } => {
      if (typeof part !== "object" || part === null) return false;
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string";
    })
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || undefined;
}

const TOOL_ARGUMENT_LIMIT = 1_000;
const ACTIVITY_LIMIT = 12_000;

function shorten(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const head = Math.ceil((limit - 1) / 2);
  const tail = Math.floor((limit - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function activityLines(message: {
  role?: string;
  content?: unknown;
  toolName?: unknown;
  isError?: unknown;
}): string[] {
  if (message.role === "toolResult") {
    if (typeof message.toolName !== "string") return [];
    return [`[tool ${message.isError ? "error" : "ok"}] ${message.toolName}`];
  }
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];

  const lines: string[] = [];
  for (const part of message.content) {
    if (typeof part !== "object" || part === null) continue;
    const block = part as {
      type?: unknown;
      text?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      lines.push(`[assistant] ${block.text.trim()}`);
    }
    if (block.type === "toolCall" && typeof block.name === "string") {
      let args: string;
      try {
        args = JSON.stringify(block.arguments ?? {}) ?? "undefined";
      } catch {
        args = "[unserializable arguments]";
      }
      lines.push(`[tool] ${block.name} ${shorten(args, TOOL_ARGUMENT_LIMIT)}`);
    }
  }
  return lines;
}

/** Return the latest user request and the agent activity that followed it. */
export function settledExchange(ctx: unknown): SettledExchange | undefined {
  const entries = (ctx as SessionReader)?.sessionManager?.getBranch?.() ?? [];
  let finalMessageIndex = -1;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as {
      type?: string;
      message?: { role?: string; content?: unknown; stopReason?: string };
    };
    if (entry.type !== "message") continue;
    if (entry.message?.role !== "assistant" || entry.message.stopReason === "aborted") {
      return undefined;
    }
    if (!messageText(entry.message.content)) return undefined;
    finalMessageIndex = index;
    break;
  }
  if (finalMessageIndex < 0) return undefined;

  for (let index = finalMessageIndex - 1; index >= 0; index--) {
    const entry = entries[index] as {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const user = messageText(entry.message.content);
    if (!user) return undefined;
    const activity = entries
      .slice(index + 1, finalMessageIndex + 1)
      .flatMap((candidate) => {
        const value = candidate as {
          type?: string;
          message?: Parameters<typeof activityLines>[0];
        };
        return value.type === "message" && value.message ? activityLines(value.message) : [];
      })
      .join("\n");
    return activity ? { user, activity: shorten(activity, ACTIVITY_LIMIT) } : undefined;
  }
  return undefined;
}

function settingsFrom(ctx: ExtensionContext): ForemanSettings {
  const manager = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: false });
  const root = manager.getGlobalSettings() as unknown as Record<string, unknown>;
  return parseSettings(root.agentForeman);
}

function modelReference(model: ModelLike): string {
  return `${model.provider}/${model.id}`;
}

function availableModels(ctx: ExtensionContext): ModelLike[] {
  const scoped = ctx.scopedModels.map((entry) => entry.model);
  return scoped.length > 0 ? scoped : ctx.modelRegistry.getAvailable();
}

export default function agentForeman(pi: ExtensionAPI) {
  let running = false;
  let stopped = false;
  let activeRun: AbortController | undefined;

  pi.registerEntryRenderer(
    CONTINUED_ENTRY,
    (_entry, _options, theme) =>
      new Text(theme.fg("accent", "⛑ Foreman sent the agent back to work"), 1, 0),
  );

  pi.on("session_start", () => {
    stopped = false;
  });

  async function observe(ctx: ExtensionContext): Promise<void> {
    if (running || stopped) return;
    const exchange = settledExchange(ctx);
    if (!exchange) return;

    const settings = settingsFrom(ctx);
    if (!settings.enabled) return;
    const configured = resolveForemanModel(settings.model, {
      find: (provider, id) => ctx.modelRegistry.find(provider, id),
    });
    const model = configured ?? ctx.model;
    if (!model) return;

    running = true;
    const controller = new AbortController();
    activeRun = controller;
    try {
      const prompt = resolveForemanPrompt({
        cwd: ctx.cwd,
        agentDir: getAgentDir(),
        projectTrusted: ctx.isProjectTrusted(),
      });
      if (prompt.warning && ctx.hasUI) ctx.ui.notify(prompt.warning, "warning");
      const runner = createForemanRunner({
        model,
        thinking: settings.thinking ?? ctx.thinkingLevel,
        cwd: ctx.cwd,
        agentDir: getAgentDir(),
        systemPrompt: prompt.prompt,
      });
      const instruction = await runner.run(exchange.user, exchange.activity, controller.signal);
      if (!instruction || stopped || controller.signal.aborted) return;
      pi.appendEntry(CONTINUED_ENTRY, {});
      pi.sendMessage(
        {
          customType: CONTINUED_ENTRY,
          content: instruction,
          display: true,
        },
        { triggerTurn: true },
      );
    } catch (error) {
      if (!controller.signal.aborted && ctx.hasUI) {
        ctx.ui.notify(`Agent Foreman failed: ${String(error)}`, "warning");
      }
    } finally {
      if (activeRun === controller) activeRun = undefined;
      running = false;
    }
  }

  pi.on("agent_settled", async (_event, ctx) => {
    await observe(ctx);
  });

  pi.registerCommand("agent-foreman", {
    description: "Configure Agent Foreman",
    getArgumentCompletions(prefix) {
      return prefix ? null : [];
    },
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const current = settingsFrom(ctx);
      const activeModel = current.model ?? (ctx.model ? modelReference(ctx.model) : "none");
      const action = await ctx.ui.select("Agent Foreman", [
        `Back to Work: ${current.enabled ? "on" : "off"}`,
        `Choose foreman (${activeModel}, ${current.thinking ?? ctx.thinkingLevel})`,
      ]);
      if (!action) return;

      if (action.startsWith("Back to Work:")) {
        const next = { ...current, enabled: !current.enabled };
        writeGlobalForemanSettings(next);
        ctx.ui.notify(`Back to Work ${next.enabled ? "enabled" : "disabled"}.`, "info");
        return;
      }

      const models = availableModels(ctx);
      const references = models.map(modelReference);
      const selectedReference = await ctx.ui.select("Choose the foreman model", references);
      if (!selectedReference) return;
      const selectedModel = models[references.indexOf(selectedReference)];
      if (!selectedModel) return;
      const levels: ForemanThinkingLevel[] = selectedModel.reasoning
        ? [...THINKING_LEVELS]
        : ["off"];
      const choice = await ctx.ui.select("Choose foreman reasoning", levels);
      const thinking = THINKING_LEVELS.find((level) => level === choice);
      if (!thinking) return;
      writeGlobalForemanSettings({ enabled: true, model: selectedReference, thinking });
      ctx.ui.notify(`Agent Foreman enabled: ${selectedReference} · ${thinking}.`, "info");
    },
  });

  pi.on("session_shutdown", () => {
    stopped = true;
    activeRun?.abort();
    activeRun = undefined;
  });
}
