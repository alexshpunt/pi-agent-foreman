import type { ClassifierApi, ClassifierModel } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ForemanRunner } from "./runner.ts";

/** Review the complete final reply with separate signals in one classifier request. */
export const REVIEW_QUESTIONS = {
  plannedAction: {
    type: "bool",
    instructions: "Is there a next-action announcement anywhere in the reply?",
    criteria: {
      true: "The assistant names a concrete action or work item as its next step. The announcement may be a short sentence naming the next work, without saying 'I will'. It still counts when the rest of the reply reports completed work.",
      false:
        "There is no announcement of the assistant's own next action. Facts, status reports, optional suggestions, quoted past announcements, a refusal to act, or next steps assigned to the user do not count.",
    },
  },
  blocker: {
    type: "bool",
    instructions:
      "Does the reply report an obstacle that prevents the assistant from carrying out its intended further action?",
    criteria: {
      true: "The assistant cannot proceed with its intended further action because a needed resource, access, information, dependency, or external result is missing or unavailable.",
      false:
        "No blocking obstacle is reported. Unfinished work or a discovered cause alone is not a blocker. Completed steps, and statements that an already resolved step needs no changes, do not block another intended action. A permission request alone belongs to the separate permission question.",
    },
  },
  permission: {
    type: "bool",
    instructions:
      "Does the reply say that the assistant's further action requires a new user decision, confirmation, or permission before proceeding?",
    criteria: {
      true: "The assistant asks for or waits for user approval, a choice, or confirmation before its further action, including an offer conditional on the user's agreement.",
      false:
        "No new user decision or permission is requested or awaited. Referring to an action already chosen or approved by the user is not a new permission requirement.",
    },
  },
  unfinished: {
    type: "bool",
    instructions:
      "Does the reply explicitly report that requested work or a concrete part of it has not yet been completed?",
    criteria: {
      true: "The assistant explicitly says the task is not done, a fix is not applied, or concrete work remains incomplete. A next-step announcement alone is not an explicit report of incompletion.",
      false:
        "No explicit report of incomplete work. Completed-work reports or a next-step announcement without an explicit incompletion statement do not qualify.",
    },
  },
  deferred: {
    type: "bool",
    instructions:
      "Does the reply explicitly state that the assistant will do its announced action at a later time or only after a condition is met?",
    criteria: {
      true: "An explicit future time, waiting condition, or prerequisite postpones the announced action. The reply says when or under what condition the assistant will act instead of proceeding next.",
      false:
        "No explicit postponement of the announced action. Naming a next step is not postponement. Reporting that earlier work has not been done is not postponement. Do not infer a delay merely because the action is still to be performed.",
    },
  },
  explicitStop: {
    type: "bool",
    instructions:
      "Does the assistant explicitly state that it will not perform or continue the further work?",
    criteria: {
      true: "The assistant expressly refuses, cancels, or rules out further action, or says it will respect an instruction to stop. This is a negative intent to act, not merely a report of incomplete work.",
      false:
        "No explicit refusal or cancellation of further work. Reporting that work is not yet done, that an earlier attempt stopped, or that a completed step needs no changes does not itself mean the assistant will not continue.",
    },
  },
} as const;

/** Probabilities returned by the final-reply classifier. */
export type StopVerdict = Record<keyof typeof REVIEW_QUESTIONS, number>;

/** Plain labels for decision details and reasons. */
export const SIGNAL_LABELS: Record<keyof StopVerdict, string> = {
  plannedAction: "Next action",
  blocker: "Blocker",
  permission: "Permission needed",
  unfinished: "Unfinished work",
  deferred: "Postponed action",
  explicitStop: "Explicit stop",
};

/** Minimum probability for an announced next action or explicit unfinished work. */
export const DEFAULT_THRESHOLD = 0.5;
/** Blocking signals always veto at this probability, independent of the positive threshold. */
export const BLOCK_THRESHOLD = 0.5;

const BLOCKING_SIGNALS = ["blocker", "permission", "deferred", "explicitStop"] as const;

/** Outcome of a review, with the original signals rather than a combined probability. */
export interface StopDecision {
  continueWork: boolean;
  signals: StopVerdict;
  reason: string;
}

/** Continue on a positive signal only when none of the blocking signals veto it. */
export function decideStop(
  verdict: StopVerdict,
  threshold: number = DEFAULT_THRESHOLD,
): StopDecision {
  const blocking = BLOCKING_SIGNALS.filter((key) => verdict[key] >= BLOCK_THRESHOLD);
  const positive = (["plannedAction", "unfinished"] as const).filter(
    (key) => verdict[key] >= threshold,
  );
  const describe = (key: keyof StopVerdict) => `${SIGNAL_LABELS[key]} (${verdict[key].toFixed(2)})`;
  return {
    continueWork: blocking.length === 0 && positive.length > 0,
    signals: verdict,
    reason:
      blocking.length > 0
        ? `blocked by ${blocking.map(describe).join(", ")}`
        : positive.length > 0
          ? `continue for ${positive.map(describe).join(", ")}`
          : "no confident next action or explicit unfinished work",
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
      { state, questions: REVIEW_QUESTIONS },
      { signal },
    );
    if (result.stopReason !== "stop")
      throw new Error(result.errorMessage ?? `Classifier ${result.stopReason}`);
    const verdict = {} as StopVerdict;
    for (const key of Object.keys(REVIEW_QUESTIONS) as (keyof StopVerdict)[]) {
      const answer = result.answers[key];
      if (
        answer?.type !== "bool" ||
        !Number.isFinite(answer.probability) ||
        answer.probability < 0 ||
        answer.probability > 1
      ) {
        throw new Error(`Classifier returned an invalid ${key} probability`);
      }
      verdict[key] = answer.probability;
    }
    return verdict;
  };
}

export interface ClassifierRunnerOptions {
  /** Classifies the last reply through Pi. */
  judge: StopJudge;
  threshold?: number;
  /** Writes an instruction only after the signals allow continuation. */
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
          // A failed instruction cannot turn a quiet outcome into a continuation.
        }
      }
      if (signal?.aborted) return undefined;
      options.onDecision?.(verdict, decision, instruction);
      return instruction;
    },
  };
}
