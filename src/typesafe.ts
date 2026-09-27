import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { LEGITIMATE_STOP_REASONS, STOP_SIGNALS } from "./policy.ts";
import type { ForemanRunner } from "./runner.ts";

/**
 * TypeSafe-backed stop judge.
 *
 * The model judge asks a nested LLM to call a `veto` tool. This judge asks a TypeSafe System
 * One model for probabilities instead, and the decision lives in code: one request, one
 * answer per question, no generated prose and no tool call.
 *
 * The questions come from the shared policy, so the reasons a stop can be legitimate are
 * worded once for both judges.
 */

/** Independent questions about the settled exchange, answered in one request. */
export const STOP_QUESTIONS = {
  work_remains: {
    type: "noul" as const,
    instructions: STOP_SIGNALS.work_remains.question,
    criteria: { true: STOP_SIGNALS.work_remains.true, false: STOP_SIGNALS.work_remains.false },
  },
  defers_work: {
    type: "noul" as const,
    instructions: STOP_SIGNALS.defers_work.question,
    criteria: { true: STOP_SIGNALS.defers_work.true, false: STOP_SIGNALS.defers_work.false },
  },
  ...Object.fromEntries(
    LEGITIMATE_STOP_REASONS.map((reason) => [
      reason.id,
      {
        type: "noul" as const,
        instructions: reason.question,
        criteria: {
          true: reason.rule,
          false: reason.notCounted ?? "The message does not show this.",
        },
      },
    ]),
  ),
};

/** Probabilities from one judge request. */
export interface StopVerdict {
  workRemains: number;
  defersWork: number;
  /** Probability per legitimate reason, keyed by the id the shared policy gives it. */
  gates: Record<string, number>;
}

export interface StopThresholds {
  /** Minimum probability that required work is unfinished before the agent is sent back. */
  workRemains: number;
  /** At or above this, a gate signal cancels the continuation. */
  gate: number;
}

export const DEFAULT_THRESHOLDS: StopThresholds = { workRemains: 0.5, gate: 0.5 };

export interface StopDecision {
  continueWork: boolean;
  probability: number;
  reason: string;
}

/**
 * Combine the verdict into one decision.
 *
 * One signal decides and the shared policy lists what can cancel it. The cancelling signals
 * are the legitimate reasons to stop, so a probability that work remains is not enough on its
 * own while one of them holds.
 */
export function decideStop(
  verdict: StopVerdict,
  thresholds: StopThresholds = DEFAULT_THRESHOLDS,
): StopDecision {
  if (verdict.workRemains < thresholds.workRemains) {
    return {
      continueWork: false,
      probability: verdict.workRemains,
      reason: "the activity does not show unfinished required work",
    };
  }

  const closed = LEGITIMATE_STOP_REASONS.filter(
    (reason) => (verdict.gates[reason.id] ?? 0) >= thresholds.gate,
  );
  if (closed.length > 0) {
    return {
      continueWork: false,
      probability: verdict.workRemains,
      reason: closed
        .map((reason) => `${reason.id} (${(verdict.gates[reason.id] ?? 0).toFixed(2)})`)
        .join(", "),
    };
  }

  // The reason is read back from the decision log, so it names the number that decided and
  // keeps a deferral as a secondary note rather than the headline.
  const decided = `required work is still unfinished (${verdict.workRemains.toFixed(2)})`;
  return {
    continueWork: true,
    probability: verdict.workRemains,
    reason:
      verdict.defersWork >= thresholds.gate
        ? `${decided}, and the message puts it off to later (${verdict.defersWork.toFixed(2)})`
        : decided,
  };
}

/**
 * The state one judge request is asked about.
 *
 * A type alias rather than an interface: the SDK accepts an object with a string index
 * signature, and only type aliases pick that signature up automatically.
 */
export type StopReviewState = {
  request: string;
  activity: string;
};

export function buildReviewState(lastUserMessage: string, agentActivity: string): StopReviewState {
  return { request: lastUserMessage, activity: agentActivity };
}

/** Provider id the key is stored under in Pi's auth file. */
export const TYPESAFE_PROVIDER_ID = "typesafe";

export interface ResolvedTypeSafeKey {
  key: string;
  /** Where the key came from, for the settings menu and warnings. */
  source: "environment" | "auth.json";
}

/**
 * Find the TypeSafe API key.
 *
 * The environment wins, then Pi's own credential store. The store is read through Pi's
 * public helper, so an entry under the provider id `typesafe` in the auth file is picked up
 * without any extra configuration here. TypeSafe is not a chat provider, so `/login` has no
 * entry for it; the key is written into the auth file once, in the same shape as any other
 * API key.
 */
export function resolveTypeSafeKey(authPath?: string): ResolvedTypeSafeKey | undefined {
  const fromEnvironment = process.env.TYPESAFE_API_KEY?.trim();
  if (fromEnvironment) return { key: fromEnvironment, source: "environment" };

  const stored = readStoredCredential(TYPESAFE_PROVIDER_ID, authPath) as
    | { type?: unknown; key?: unknown }
    | undefined;
  const key = stored?.type === "api_key" && typeof stored.key === "string" ? stored.key.trim() : "";
  return key ? { key, source: "auth.json" } : undefined;
}

/** Thrown when the TypeSafe judge is selected but no API key is available. */
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
  /** Key lookup, so a test can run the judge without a real credential. */
  resolveKey?: () => ResolvedTypeSafeKey | undefined;
}

/** The real judge: one TypeSafe request, every question at once, no tool calls. */
export function createTypeSafeJudge(options: TypeSafeJudgeOptions = {}): StopJudge {
  const resolveKey = options.resolveKey ?? resolveTypeSafeKey;
  return async (state) => {
    const resolved = resolveKey();
    if (!resolved) throw new TypeSafeNotConfiguredError();
    const client = new TypeSafeClient({ apiKey: resolved.key });
    const result = await client.systemOne({
      state,
      questions: STOP_QUESTIONS,
      ...(options.model ? { model: options.model } : {}),
    });
    const answers = result.answers as Record<string, { noul?: number }>;
    return {
      workRemains: answers.work_remains?.noul ?? 0,
      defersWork: answers.defers_work?.noul ?? 0,
      gates: Object.fromEntries(
        LEGITIMATE_STOP_REASONS.map((reason) => [reason.id, answers[reason.id]?.noul ?? 0]),
      ),
    };
  };
}

export interface TypeSafeRunnerOptions {
  /** Replaced in tests; the default talks to TypeSafe. */
  judge?: StopJudge;
  thresholds?: Partial<StopThresholds>;
  /** TypeSafe model override, for example jev-latest. */
  model?: string;
  /** Generates a specific instruction only after TypeSafe decides to continue. */
  instructionRunner?: ForemanRunner;
  /** Called once per decision, with the instruction the agent will receive if there is one. */
  onDecision?: (verdict: StopVerdict, decision: StopDecision, instruction?: string) => void;
  /** Used when the judge cannot answer at all, so a missing service does not disable review. */
  fallback?: ForemanRunner;
  /** Called when the judge failed and the fallback took over. */
  onFallback?: (error: Error) => void;
}

/** A foreman runner that decides with TypeSafe instead of a nested agent. */
export function createTypeSafeRunner(options: TypeSafeRunnerOptions = {}): ForemanRunner {
  const thresholds: StopThresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const judge =
    options.judge ??
    createTypeSafeJudge(options.model === undefined ? {} : { model: options.model });

  return {
    async run(lastUserMessage, agentActivity, signal) {
      if (signal?.aborted) return undefined;

      let verdict: StopVerdict;
      try {
        verdict = await judge(buildReviewState(lastUserMessage, agentActivity));
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (!options.fallback) throw failure;
        options.onFallback?.(failure);
        return options.fallback.run(lastUserMessage, agentActivity, signal);
      }

      if (signal?.aborted) return undefined;
      const decision = decideStop(verdict, thresholds);
      let instruction: string | undefined;
      if (decision.continueWork && options.instructionRunner) {
        try {
          instruction = await options.instructionRunner.run(lastUserMessage, agentActivity, signal);
        } catch {
          // A failed generator does not override TypeSafe or send a generic instruction.
        }
      }
      if (signal?.aborted) return undefined;
      options.onDecision?.(verdict, decision, instruction);
      return instruction;
    },
  };
}
