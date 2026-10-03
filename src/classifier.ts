import type { ClassifierApi, ClassifierModel } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ForemanRunner } from "./runner.ts";

/** Jev classifies only the final reply, not task completion. */
export const PROMISE_QUESTIONS = {
  promise: {
    type: "bool" as const,
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

/** Default classifier; callers can select any classifier in the Pi catalog. */
export const DEFAULT_CLASSIFIER = "typesafe/jev-latest";

export type StopJudge = (state: StopReviewState, signal?: AbortSignal) => Promise<StopVerdict>;

/** Review a reply through Pi, using its catalog and request-time credentials. */
export function createClassifierJudge(
  registry: Pick<ModelRegistry, "classify"> & {
    findOfType(
      type: "classifier",
      provider: string,
      id: string,
    ): ClassifierModel<ClassifierApi> | undefined;
  },
  reference: string = DEFAULT_CLASSIFIER,
): StopJudge {
  return async (state, signal) => {
    const slash = reference.indexOf("/");
    const model = registry.findOfType(
      "classifier",
      reference.slice(0, slash),
      reference.slice(slash + 1),
    );
    if (slash < 1 || !model) throw new Error(`Classifier not found: ${reference}`);
    const result = await registry.classify(
      model,
      { state, questions: PROMISE_QUESTIONS },
      { signal },
    );
    if (result.stopReason !== "stop")
      throw new Error(result.errorMessage ?? `Classifier ${result.stopReason}`);
    const answer = result.answers.promise;
    if (
      answer?.type !== "bool" ||
      !Number.isFinite(answer.probability) ||
      answer.probability < 0 ||
      answer.probability > 1
    ) {
      throw new Error("Classifier returned an invalid promise probability");
    }
    return { promise: answer.probability };
  };
}

export interface ClassifierRunnerOptions {
  /** Classifies the last reply through Pi. */
  judge: StopJudge;
  threshold?: number;
  /** Writes an instruction only after jev detects an immediate promise. */
  instructionRunner?: ForemanRunner;
  /** Called once for each successful judgment. */
  onDecision?: (verdict: StopVerdict, decision: StopDecision, instruction?: string) => void;
  /** Called when jev is unavailable; no other judge takes over. */
  onUnavailable?: (error: Error) => void;
}

/** A foreman runner that stays quiet on uncertainty or a failed jev request. */
export function createClassifierRunner(options: ClassifierRunnerOptions): ForemanRunner {
  const judge = options.judge;

  return {
    async run(lastUserMessage, agentActivity, finalReply, signal) {
      if (signal?.aborted) return undefined;

      let verdict: StopVerdict;
      try {
        verdict = await judge({ reply: finalReply }, signal);
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
