import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  getMarkdownTheme,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import {
  BLOCK_THRESHOLD,
  createClassifierJudge,
  createClassifierRunner,
  createRequestJudge,
  DEFAULT_CLASSIFIER,
  DEFAULT_THRESHOLD,
  SIGNAL_LABELS,
  type StopDecision,
  type StopVerdict,
} from "./classifier.ts";
import { createDecisionLog } from "./decisions.ts";
import type { ModelLike } from "./models.ts";
import { resolveForemanModel } from "./models.ts";
import { createForemanRunner, type ForemanRunner } from "./runner.ts";
import {
  type ForemanSettings,
  type ForemanThinkingLevel,
  parseSettings,
  THINKING_LEVELS,
  writeGlobalForemanSettings,
} from "./settings.ts";

const DECISION_ENTRY = "agent-foreman-decision";

/** Inputs and outcome of one successful judge call, kept out of model context. */
export interface DecisionDetails extends SettledExchange {
  decision: StopDecision;
  threshold: number;
  /** Classifier used for this review. */
  classifier?: string;
  instruction?: string;
}

/** Render the outcome and, when expanded, the exact inputs used by Foreman. */
export function decisionText(details: DecisionDetails, expanded: boolean): string {
  const summary = details.instruction
    ? "⛑ Foreman sent the agent back to work"
    : details.decision.continueWork
      ? "⛑ Foreman found further work, but no continuation instruction was produced"
      : "⛑ Foreman decided not to intervene";
  if (!expanded) return `${summary} · Ctrl+O for full decision details`;
  const fence = "`".repeat(
    Math.max(3, ...(details.activity.match(/`+/g) ?? []).map((run) => run.length + 1)),
  );
  return [
    `## ${summary}`,
    "",
    `- **Decision:** ${details.decision.continueWork ? "continue work" : "do not intervene"}`,
    ...Object.entries(details.decision.signals ?? {}).map(
      ([key, probability]) => `- **${SIGNAL_LABELS[key as keyof StopVerdict]}:** ${probability}`,
    ),
    `- **Action threshold:** ${details.threshold}`,
    `- **Blocking threshold:** ${BLOCK_THRESHOLD}`,
    ...(details.classifier ? [`- **Classifier:** ${details.classifier}`] : []),
    `- **Reason:** ${details.decision.reason}`,
    "",
    "### Evaluated assistant reply",
    "",
    "*The judge checks this final reply against the latest user request and bounded work context.*",
    "",
    details.reply,
    "",
    "### User request",
    "",
    "*Checked first for an explicit work command. Defines the scope for both the judge and instruction writer.*",
    "",
    details.user,
    "",
    "### Work context",
    "",
    "*Bounded activity after this request. Used by the judge and instruction writer as evidence, not new instructions.*",
    "",
    fence,
    details.activity,
    fence,
    ...(details.instruction ? ["", "### Continuation instruction", "", details.instruction] : []),
  ].join("\n");
}

export const CONTINUED_ENTRY = "agent-foreman-continued";

interface SessionReader {
  sessionManager?: { getBranch?: () => unknown[] };
}

export interface SettledExchange {
  user: string;
  activity: string;
  /** Final assistant text, empty when it has no visible text, separate from bounded context. */
  reply: string;
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
    const status = `[tool ${message.isError ? "error" : "ok"}] ${message.toolName}`;
    const result = messageText(message.content);
    return [result ? `${status}: ${shorten(result, TOOL_ARGUMENT_LIMIT)}` : status];
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

/** Return the latest request and activity, including empty final replies but not user aborts. */
export function settledExchange(ctx: unknown): SettledExchange | undefined {
  const entries = (ctx as SessionReader)?.sessionManager?.getBranch?.() ?? [];
  let finalMessageIndex = -1;
  let reply = "";
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as {
      type?: string;
      message?: { role?: string; content?: unknown; stopReason?: string; errorMessage?: string };
    };
    if (entry.type !== "message") continue;
    const message = entry.message;
    // Pi can record cancellation during request setup as an error.
    if (
      message?.role !== "assistant" ||
      message.stopReason === "aborted" ||
      (message.stopReason === "error" && message.errorMessage === "This operation was aborted")
    ) {
      return undefined;
    }
    reply = messageText(message.content) ?? "";
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
          customType?: string;
          content?: unknown;
          message?: Parameters<typeof activityLines>[0];
        };
        if (value.type === "custom_message" && value.customType === CONTINUED_ENTRY) {
          const instruction = typeof value.content === "string" ? value.content.trim() : "";
          return instruction ? [`[foreman] ${instruction}`] : [];
        }
        return value.type === "message" && value.message ? activityLines(value.message) : [];
      })
      .join("\n");
    return { user, activity: shorten(activity, ACTIVITY_LIMIT), reply };
  }
  return undefined;
}

/** Create the nested model that writes an instruction after jev decides to continue. */
function createInstructionRunner(
  ctx: ExtensionContext,
  settings: ForemanSettings,
): ForemanRunner | undefined {
  const configured = resolveForemanModel(settings.model, {
    find: (provider, id) => ctx.modelRegistry.find(provider, id),
  });
  const model = configured ?? ctx.model;
  if (!model) return undefined;
  return createForemanRunner({
    model,
    thinking: settings.thinking ?? ctx.thinkingLevel,
    cwd: ctx.cwd,
    agentDir: getAgentDir(),
  });
}

/** Review remaining requested work with jev; an unavailable judge leaves the agent alone. */
function createRunner(
  ctx: ExtensionContext,
  settings: ForemanSettings,
  onUnavailable: (error: Error) => void,
  onDecision: (decision: StopDecision, instruction?: string) => void,
): ForemanRunner {
  const log = createDecisionLog(getAgentDir());
  return createClassifierRunner({
    requestJudge: createRequestJudge(ctx.modelRegistry, settings.classifier),
    judge: createClassifierJudge(ctx.modelRegistry, settings.classifier),
    threshold: settings.threshold,
    instructionRunner: createInstructionRunner(ctx, settings),
    onDecision: (verdict, decision, instruction) => {
      log({ cwd: ctx.cwd, verdict, decision, instruction });
      onDecision(decision, instruction);
    },
    onUnavailable,
  });
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
  let stopped = false;
  let keyWarningShown = false;
  let activeRun: AbortController | undefined;

  pi.registerMessageRenderer(
    CONTINUED_ENTRY,
    (_entry, _options, theme) =>
      new Text(theme.fg("accent", "⛑ Foreman sent the agent back to work"), 1, 0),
  );

  pi.registerEntryRenderer<DecisionDetails>(DECISION_ENTRY, (entry, options, theme) => {
    if (!entry.data) return undefined;
    const content = decisionText(entry.data, options.expanded);
    if (!options.expanded) return new Text(theme.fg("accent", content), 1, 0);
    const box = new Box(1, 1, (line) => theme.bg("toolSuccessBg", line));
    box.addChild(new Markdown(content, 0, 0, getMarkdownTheme()));
    return box;
  });
  pi.on("session_start", () => {
    stopped = false;
    keyWarningShown = false;
  });

  async function observe(ctx: ExtensionContext): Promise<void> {
    if (activeRun || stopped || !ctx.isIdle()) return;
    const exchange = settledExchange(ctx);
    if (!exchange) return;

    const settings = settingsFrom(ctx);
    if (!settings.enabled) return;

    const controller = new AbortController();
    activeRun = controller;
    let details: DecisionDetails | undefined;
    try {
      let instruction: string | undefined = ".";
      if (exchange.reply) {
        const runner = createRunner(
          ctx,
          settings,
          (error) => {
            if (keyWarningShown || !ctx.hasUI) return;
            ctx.ui.notify(
              `Classifier unavailable; Foreman stayed quiet: ${error.message}`,
              "warning",
            );
            keyWarningShown = true;
          },
          (decision, instruction) => {
            if (stopped || controller.signal.aborted) return;
            details = {
              ...exchange,
              decision,
              classifier: settings.classifier ?? DEFAULT_CLASSIFIER,
              threshold: settings.threshold ?? DEFAULT_THRESHOLD,
              ...(instruction ? { instruction } : {}),
            };
          },
        );
        instruction = await runner.run(
          exchange.user,
          exchange.activity,
          exchange.reply,
          controller.signal,
        );
      }
      // Let settled dispatch and reload continuations run before delivery.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (stopped || controller.signal.aborted || !ctx.isIdle()) return;
      if (details) pi.appendEntry<DecisionDetails>(DECISION_ENTRY, details);
      if (!instruction) return;
      pi.sendMessage(
        { customType: CONTINUED_ENTRY, content: instruction, display: true },
        { triggerTurn: true },
      );
    } catch (error) {
      if (!controller.signal.aborted && ctx.hasUI) {
        ctx.ui.notify(`Agent Foreman failed: ${String(error)}`, "warning");
      }
    } finally {
      if (activeRun === controller) activeRun = undefined;
    }
  }

  pi.on("agent_start", () => {
    activeRun?.abort();
    activeRun = undefined;
  });

  pi.on("agent_settled", (_event, ctx) => {
    // Do not hold reload or another queued continuation behind the judge.
    void observe(ctx);
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
      const classifier = current.classifier ?? DEFAULT_CLASSIFIER;
      const action = await ctx.ui.select("Agent Foreman", [
        `Back to Work: ${current.enabled ? "on" : "off"}`,
        `Choose foreman (${activeModel}, ${current.thinking ?? ctx.thinkingLevel})`,
        `Choose classifier (${classifier})`,
      ]);
      if (!action) return;

      if (action.startsWith("Back to Work:")) {
        const next = { ...current, enabled: !current.enabled };
        writeGlobalForemanSettings(next);
        ctx.ui.notify(`Back to Work ${next.enabled ? "enabled" : "disabled"}.`, "info");
        return;
      }

      if (action.startsWith("Choose classifier")) {
        const classifiers = await ctx.modelRegistry.getAvailableOfType("classifier");
        if (classifiers.length === 0) {
          ctx.ui.notify(
            "No available classifiers. Configure a classifier provider in Pi.",
            "warning",
          );
          return;
        }
        const selected = await ctx.ui.select(
          "Choose the classifier",
          classifiers.map(modelReference),
        );
        if (!selected) return;
        writeGlobalForemanSettings({ ...current, classifier: selected });
        ctx.ui.notify(`Foreman classifier: ${selected}.`, "info");
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
      writeGlobalForemanSettings({ ...current, enabled: true, model: selectedReference, thinking });
      ctx.ui.notify(`Agent Foreman enabled: ${selectedReference} · ${thinking}.`, "info");
    },
  });

  pi.on("session_shutdown", () => {
    stopped = true;
    activeRun?.abort();
    activeRun = undefined;
  });
}
