import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  INSTRUCTION_LANGUAGES,
  type InstructionLanguage,
  LEGITIMATE_STOP_REASONS,
  STOP_SIGNALS,
} from "./policy.ts";
import type { ForemanRunner } from "./runner.ts";

/**
 * TypeSafe-backed stop judge.
 *
 * The model judge asks a nested LLM to call a `veto` tool. This judge asks a TypeSafe System
 * One model for probabilities instead, and the decision lives in code: one request, one
 * answer per question, no generated prose and no tool call.
 *
 * The questions come from the shared policy, so the four reasons a stop can be legitimate are
 * worded once for both judges.
 */

/** The kind question and the language question are the two the policy does not define. */
const EXTRA_QUESTIONS = {
  remaining_kind: {
    type: "choice" as const,
    instructions:
      "Which kind of work is still unfinished? Choose 'none' when nothing required is left.",
    criteria: {
      implementation: "Writing or changing the code itself.",
      tests: "Writing tests that were asked for.",
      verification: "Running checks that show the change works.",
      documentation: "Writing or updating the requested documentation.",
      cleanup: "Removing, reverting, or tidying something that was left behind.",
      other: "Work that fits none of the other options.",
      none: "Nothing required is unfinished.",
    },
  },
  answer_language: {
    type: "choice" as const,
    instructions:
      "Which language is the request written in? Answer for the human request, not for code or tool output.",
    criteria: {
      en: "English.",
      ru: "Russian.",
      other: "Some other language, or the request mixes languages without one clear one.",
    },
  },
};

/**
 * Questions for one settled exchange. Every question asks about something visible in the
 * supplied activity, and each one is independent, so a single request answers all of them.
 */
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
  ...EXTRA_QUESTIONS,
};

/** The probabilities and the labels from one judge request. */
export interface StopVerdict {
  workRemains: number;
  defersWork: number;
  /** Probability per legitimate reason, keyed by the id the shared policy gives it. */
  gates: Record<string, number>;
  remainingKind: string;
  /** Language of the request, as the judge read it. */
  language: string;
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

/** Phrase used for each kind of unfinished work, in the language of the request. */
const KIND_PHRASES: Record<InstructionLanguage, Record<string, string>> = {
  en: {
    implementation: "finish the implementation",
    tests: "write the tests that were asked for",
    verification: "run the checks that prove the work is done",
    documentation: "finish the documentation",
    cleanup: "finish the cleanup that was left open",
    other: "finish the work that is still open",
    none: "finish the work that is still open",
  },
  ru: {
    implementation: "доделай реализацию",
    tests: "напиши тесты, которые просили",
    verification: "прогони проверки, которые доказывают, что работа сделана",
    documentation: "доделай документацию",
    cleanup: "доделай уборку, которую оставил незакрытой",
    other: "доделай работу, которая осталась открытой",
    none: "доделай работу, которая осталась открытой",
  },
};

const INSTRUCTION_TAILS: Record<InstructionLanguage, string> = {
  en: "Do not describe what should happen next, do not hand the work back to the user, and do not report it as something to do later. Do the work and report the result.",
  ru: "Не описывай, что должно быть дальше, не передавай работу пользователю и не сообщай об этом как о чём-то на потом. Сделай работу и доложи результат.",
};

/** Instruction sent back to the agent when its stop is not accepted. */
export function buildInstruction(verdict: StopVerdict): string {
  const language: InstructionLanguage = INSTRUCTION_LANGUAGES.includes(
    verdict.language as InstructionLanguage,
  )
    ? (verdict.language as InstructionLanguage)
    : "en";
  const phrase = KIND_PHRASES[language][verdict.remainingKind] ?? KIND_PHRASES[language].other;
  const head =
    language === "ru"
      ? `Продолжи этот ход и ${phrase} сейчас.`
      : `Continue this turn and ${phrase} now.`;
  return `${head} ${INSTRUCTION_TAILS[language]}`;
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
    const answers = result.answers as Record<string, { noul?: number; choice?: string }>;
    return {
      workRemains: answers.work_remains?.noul ?? 0,
      defersWork: answers.defers_work?.noul ?? 0,
      gates: Object.fromEntries(
        LEGITIMATE_STOP_REASONS.map((reason) => [reason.id, answers[reason.id]?.noul ?? 0]),
      ),
      remainingKind: answers.remaining_kind?.choice ?? "other",
      language: answers.answer_language?.choice ?? "en",
    };
  };
}

export interface TypeSafeRunnerOptions {
  /** Replaced in tests; the default talks to TypeSafe. */
  judge?: StopJudge;
  thresholds?: Partial<StopThresholds>;
  /** TypeSafe model override, for example jev-latest. */
  model?: string;
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
      const instruction = decision.continueWork ? buildInstruction(verdict) : undefined;
      options.onDecision?.(verdict, decision, instruction);
      return instruction;
    },
  };
}
