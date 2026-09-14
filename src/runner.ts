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

export const FOREMAN_SYSTEM_PROMPT = `You judge only whether a coding agent's final answer openly shows that it stopped before finishing the user's work. You receive the last user message and the final assistant message, clearly labelled.

Call veto exactly once when the answer says or clearly implies that required work remains, that the agent stopped early, deferred work, only described what should be done, or asked the user to continue work the agent could have completed itself. The veto instruction must be direct and firm: tell the agent to finish the remaining work now and name what it left unfinished.

If the user explicitly told the agent to stop, pause, wait, defer, or leave work unfinished, do not veto the agent for following that instruction. Do not veto a legitimate completed answer, a research result, a request for a genuinely required product decision, or an answer that merely mentions future optional work. If the answer says the task is complete, do not contradict it. Waiting for a background command, watcher, build, or sub-agent that the main agent already started is a legitimate stopping phase; do not veto that wait. Do not infer missing work from anything outside the two supplied messages. You are not allowed to inspect the rest of the transcript, files, or tool calls.

Your prose response is discarded. If no veto is needed, call no tool and return nothing.`;

export interface ForemanRunner {
  run(
    lastUserMessage: string,
    lastAssistantMessage: string,
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

/** Create the single final-answer foreman. A fresh nested agent is used for every settle. */
export function createForemanRunner(options: {
  model: ModelLike;
  cwd: string;
  agentDir: string;
  thinking?: ForemanThinkingLevel;
  systemPrompt?: string;
  createSession?: SessionFactory;
}): ForemanRunner {
  return {
    async run(lastUserMessage, lastAssistantMessage, signal) {
      if (signal?.aborted) return undefined;
      let veto: string | undefined;
      const vetoTool = defineTool({
        name: "veto",
        label: "Veto",
        description:
          "Continue the main agent because its own final answer admits required work remains.",
        parameters: Type.Object({
          instruction: Type.String({
            description:
              "A direct instruction telling the agent to finish the work it left undone.",
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
        const review = `<last-user-message>\n${lastUserMessage}\n</last-user-message>\n\n<last-assistant-message>\n${lastAssistantMessage}\n</last-assistant-message>`;
        await session.prompt(review, { expandPromptTemplates: false });
      } finally {
        signal?.removeEventListener("abort", abort);
        session.dispose();
      }
      return signal?.aborted ? undefined : veto;
    },
  };
}
