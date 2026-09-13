import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ModelLike } from "./models.ts";
import { resolveForemanModel } from "./models.ts";
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

/** Return the final assistant text, unless the settle followed a user abort. */
export function settledAssistantText(ctx: unknown): string | undefined {
  const entries = (ctx as SessionReader)?.sessionManager?.getBranch?.() ?? [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as {
      type?: string;
      message?: { role?: string; content?: unknown; stopReason?: string };
    };
    if (entry.type !== "message") continue;
    if (entry.message?.role !== "assistant") return undefined;
    if (entry.message.stopReason === "aborted") return undefined;
    if (!Array.isArray(entry.message.content)) return undefined;
    const text = entry.message.content
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
    const answer = settledAssistantText(ctx);
    if (!answer) return;

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
      const runner = createForemanRunner({
        model,
        thinking: settings.thinking ?? ctx.thinkingLevel,
        cwd: ctx.cwd,
        agentDir: getAgentDir(),
      });
      const instruction = await runner.run(answer, controller.signal);
      if (!instruction || stopped || controller.signal.aborted) return;
      pi.appendEntry(CONTINUED_ENTRY, {});
      pi.sendUserMessage(instruction);
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
