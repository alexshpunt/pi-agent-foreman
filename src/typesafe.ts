import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { ForemanRunner } from "./runner.ts";

/** Jev classifies only the final reply, not task completion. */
export const PROMISE_QUESTIONS = {
  promise: {
    type: "noul" as const,
    instructions:
      "Does the reply make an affirmative commitment to a new action by the assistant NOW or NEXT? Read the meaning, not keywords. 'I will not continue' is a refusal, not a commitment. A session continuing automatically after reload is not a new action by the assistant. First exclude negated or quoted promises, conditional or later work, and reports of automatic continuation. Then check for an affirmative immediate action. 'Continuing the run' and 'Продолжаю запуск' are affirmative commitments. Confidence and unfinished tasks alone do not count.",
    criteria: {
      true: "The assistant commits to its own immediate next action: continuing a run, starting work now, checking something next, or doing another concrete step. A completed correction followed by 'Continuing the run' still contains a promise.",
      false:
        "No affirmative immediate promise. A negation ('I will not continue'), an earlier quoted promise, a later or conditional promise, and automatic reload continuation are FALSE. Completed-work reports, confidence, unfinished-work descriptions, optional suggestions, and waiting for a running job are also FALSE.",
    },
  },
};

/** Probability that the final reply promises an immediate action. */
export interface StopVerdict {
  promise: number;
}

/** Minimum confidence needed to act on a promise. */
export const DEFAULT_THRESHOLD = 0.7;

export interface StopDecision {
  continueWork: boolean;
  probability: number;
  reason: string;
}

/** Deterministic branch after jev classifies the reply. */
export function decideStop(
  verdict: StopVerdict,
  threshold: number = DEFAULT_THRESHOLD,
): StopDecision {
  const continueWork = verdict.promise >= threshold;
  return {
    continueWork,
    probability: verdict.promise,
    reason: continueWork
      ? `final reply promises immediate action (${verdict.promise.toFixed(2)})`
      : `no confident immediate promise (${verdict.promise.toFixed(2)})`,
  };
}

/** The only input sent to jev. Context is reserved for the instruction writer. */
export type StopReviewState = {
  reply: string;
};

/** Provider id the key is stored under in Pi's auth file. */
export const TYPESAFE_PROVIDER_ID = "typesafe";

export interface ResolvedTypeSafeKey {
  key: string;
  /** Where the key came from, for the settings menu and warnings. */
  source: "environment" | "auth.json";
}

/** Find the TypeSafe key in the environment or Pi's credential store. */
export function resolveTypeSafeKey(authPath?: string): ResolvedTypeSafeKey | undefined {
  const fromEnvironment = process.env.TYPESAFE_API_KEY?.trim();
  if (fromEnvironment) return { key: fromEnvironment, source: "environment" };

  const stored = readStoredCredential(TYPESAFE_PROVIDER_ID, authPath) as
    | { type?: unknown; key?: unknown }
    | undefined;
  const key = stored?.type === "api_key" && typeof stored.key === "string" ? stored.key.trim() : "";
  return key ? { key, source: "auth.json" } : undefined;
}

/** Thrown when the judge has no TypeSafe key. */
export class TypeSafeNotConfiguredError extends Error {
  constructor() {
    super(
      'Set TYPESAFE_API_KEY, or store the key in Pi\'s auth file under "typesafe" as { "type": "api_key", "key": "..." }.',
    );
    this.name = "TypeSafeNotConfiguredError";
  }
}

export type StopJudge = (state: StopReviewState) => Promise<StopVerdict>;

export interface TypeSafeJudgeOptions {
  /** TypeSafe model override, for example jev-latest. */
  model?: string;
  /** Key lookup, so tests can run without a real credential. */
  resolveKey?: () => ResolvedTypeSafeKey | undefined;
}

/** Ask jev whether the final reply promises an immediate action. */
export function createTypeSafeJudge(options: TypeSafeJudgeOptions = {}): StopJudge {
  const resolveKey = options.resolveKey ?? resolveTypeSafeKey;
  return async (state) => {
    const resolved = resolveKey();
    if (!resolved) throw new TypeSafeNotConfiguredError();
    const client = new TypeSafeClient({ apiKey: resolved.key });
    const result = await client.systemOne({
      state,
      questions: PROMISE_QUESTIONS,
      ...(options.model ? { model: options.model } : {}),
    });
    const answers = result.answers as Record<string, { noul?: number }>;
    return { promise: answers.promise?.noul ?? 0 };
  };
}

export interface TypeSafeRunnerOptions {
  /** Replaced in tests; the default talks to TypeSafe. */
  judge?: StopJudge;
  threshold?: number;
  /** TypeSafe model override, for example jev-latest. */
  model?: string;
  /** Writes an instruction only after jev detects an immediate promise. */
  instructionRunner?: ForemanRunner;
  /** Called once for each successful judgment. */
  onDecision?: (verdict: StopVerdict, decision: StopDecision, instruction?: string) => void;
  /** Called when jev is unavailable; no other judge takes over. */
  onUnavailable?: (error: Error) => void;
}

/** A foreman runner that stays quiet on uncertainty or a failed jev request. */
export function createTypeSafeRunner(options: TypeSafeRunnerOptions = {}): ForemanRunner {
  const judge =
    options.judge ??
    createTypeSafeJudge(options.model === undefined ? {} : { model: options.model });

  return {
    async run(lastUserMessage, agentActivity, finalReply, signal) {
      if (signal?.aborted) return undefined;

      let verdict: StopVerdict;
      try {
        verdict = await judge({ reply: finalReply });
      } catch (error) {
        if (!signal?.aborted) {
          options.onUnavailable?.(error instanceof Error ? error : new Error(String(error)));
        }
        return undefined;
      }

      if (signal?.aborted) return undefined;
      const decision = decideStop(verdict, options.threshold);
      let instruction: string | undefined;
      if (decision.continueWork && options.instructionRunner) {
        try {
          instruction = await options.instructionRunner.run(
            lastUserMessage,
            agentActivity,
            finalReply,
            signal,
          );
        } catch {
          // A failed instruction cannot turn an uncertain or quiet outcome into a continuation.
        }
      }
      if (signal?.aborted) return undefined;
      options.onDecision?.(verdict, decision, instruction);
      return instruction;
    },
  };
}
