import {
  type CreateAgentSessionOptions,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ModelLike } from "./models.ts";
import type { ForemanThinkingLevel } from "./settings.ts";

export const FOREMAN_SYSTEM_PROMPT = `You judge only whether a coding agent's activity openly shows that it stopped before finishing the user's work. You receive the last user message and all agent activity that followed it, clearly labelled. The activity contains assistant text, compact tool calls, and tool success or error statuses. Tool result contents and private thinking are omitted.

Call veto exactly once when the answer says or clearly implies that required work remains, that the agent stopped early, deferred work, only described what should be done, or asked the user to continue work the agent could have completed itself. The veto instruction must be direct and firm, name what the agent left unfinished, and use the same language as the assistant message. Never call veto to report that no action is needed.

If the user explicitly told the agent to stop, pause, wait, defer, or leave work unfinished, do not veto the agent for following that instruction. If the agent explicitly says that it cannot perform an action or complete part of the work, accept that as a legitimate outcome and do not veto it. Do not argue with the limitation or send the agent back to retry. Do not veto a legitimate completed answer, a research result, a request for a genuinely required product decision, or an answer that merely mentions future optional work. If the answer says the task is complete, do not contradict it. Waiting for a background command, watcher, build, reload, extension reload, or sub-agent that the main agent already started is a legitimate stopping phase; do not veto that wait. If the agent says it is reloading and the reload flow will continue the session automatically, let that flow continue without a veto. Judge the request against the whole supplied activity, not only its final assistant text. Earlier assistant text may show that the user request was already completed before later background updates. Do not infer missing work from anything outside the supplied user message and activity. You are not allowed to inspect the rest of the transcript, files, or full tool results.

Call veto only when you have a concrete, useful instruction that identifies genuinely unfinished required work. Never call veto with placeholder, dummy, example, generic, empty, or speculative arguments. If you have nothing specific to tell the agent, do not call veto.

Your prose response is discarded. If no veto is needed, call no tool and produce an empty response. Do not write "No actions needed", "Looks good", an acknowledgement, or any similar text.`;

export interface ForemanRunner {
  run(
    lastUserMessage: string,
    agentActivity: string,
    signal?: AbortSignal,
  ): Promise<string | undefined>;
}

interface ForemanSession {
  prompt(text: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}

export type SessionFactory = (
  opts: CreateAgentSessionOptions,
) => Promise<{ session: ForemanSession }>;

/** Create the activity-reviewing foreman. A fresh nested agent is used for every settle. */
export function createForemanRunner(options: {
  model: ModelLike;
  cwd: string;
  agentDir: string;
  thinking?: ForemanThinkingLevel;
  systemPrompt?: string;
  createSession?: SessionFactory;
}): ForemanRunner {
  return {
    async run(lastUserMessage, agentActivity, signal) {
      if (signal?.aborted) return undefined;
      let veto: string | undefined;
      const vetoTool = defineTool({
        name: "veto",
        label: "Veto",
        description: "Continue the main agent because its activity admits required work remains.",
        parameters: Type.Object({
          remainingWork: Type.String({
            description: "A concise description of the required work that is still unfinished.",
          }),
          instruction: Type.String({
            description:
              "A direct instruction in the same language as the assistant message telling the agent to finish that work.",
          }),
        }),
        async execute(_id, params) {
          const instruction = params.instruction.trim();
          if (instruction && veto === undefined) veto = instruction;
          return { content: [{ type: "text" as const, text: "Recorded." }], details: {} };
        },
      });

      const settingsManager = SettingsManager.inMemory(
        { compaction: { enabled: false } },
        { projectTrusted: false },
      );
      const resourceLoader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir: options.agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: options.systemPrompt ?? FOREMAN_SYSTEM_PROMPT,
        appendSystemPrompt: [],
      });
      await resourceLoader.reload();
      const factory = options.createSession ?? createAgentSession;
      const { session } = await factory({
        cwd: options.cwd,
        agentDir: options.agentDir,
        model: options.model as never,
        ...(options.thinking ? { thinkingLevel: options.thinking } : {}),
        sessionManager: SessionManager.inMemory(options.cwd),
        settingsManager,
        resourceLoader,
        tools: ["veto"],
        customTools: [vetoTool],
      });

      const abort = () => void session.abort().catch(() => {});
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      try {
        const review = `<last-user-message>\n${lastUserMessage}\n</last-user-message>\n\n<agent-activity>\n${agentActivity}\n</agent-activity>`;
        await session.prompt(review, { expandPromptTemplates: false });
      } finally {
        signal?.removeEventListener("abort", abort);
        session.dispose();
      }
      return signal?.aborted ? undefined : veto;
    },
  };
}
