/**
 * The stop policy both judges share.
 *
 * The model judge reads it as prose, the TypeSafe judge reads it as typed questions. Keeping
 * the four reasons in one place is the point: a rule changed here changes both, so the two
 * judges cannot drift apart on what counts as a legitimate stop.
 */

/** What counts as required work that is still open. Shared by the prompt and the questions. */
export const UNFINISHED_WORK =
  "Required work is unfinished when the request is not carried out: the agent only described what should be done, deferred it, asked the user to continue it, or stopped while the request still stood.";

export interface StopReason {
  /** Question id used by the TypeSafe judge. */
  id: string;
  /** The judgment, phrased for a typed question. */
  question: string;
  /** The rule, phrased for both the question criteria and the prompt. */
  rule: string;
  /** What the rule does not cover, where that is easy to get wrong. */
  notCounted?: string;
}

/** The four judgments that make a stop legitimate. High probability on any one keeps it. */
export const LEGITIMATE_STOP_REASONS: StopReason[] = [
  {
    id: "waiting_on_background",
    question:
      "Is the agent currently waiting for something it already started, such as a build, a test run, a reload, a watcher, or a sub-agent?",
    rule: "The agent started work whose result is still pending, and that result arrives on its own.",
    notCounted: "A promise to do something later is not a wait.",
  },
  {
    id: "user_asked_to_stop",
    question:
      "Did the request ask the agent to stop, pause, wait, defer, or leave the work unfinished?",
    rule: "The user asked for the work to stop, to wait, or to be left as it is.",
  },
  {
    id: "presented_choice",
    question:
      "Does the final assistant message spell out two or more concrete alternatives and ask the user to pick one of them?",
    rule: "The message lists options and asks the user to choose between them before the work can continue.",
    notCounted:
      "Asking whether to continue, or asking for permission to carry on with the request, is not a choice between alternatives.",
  },
  {
    id: "blocked_by_limitation",
    question:
      "Does the final assistant message say that the work the user asked for cannot be done because of something the agent cannot change itself, such as a missing permission, credential, or access?",
    rule: "The requested work is reported as impossible without something the agent cannot obtain on its own.",
    notCounted:
      "A failed attempt, an error from one try, a decision to do it later, or a limit on some check other than the requested work is not a blocking limitation.",
  },
];

/** The two judgments that decide whether the agent is sent back to work. */
export const STOP_SIGNALS = {
  work_remains: {
    question:
      "Does the activity say or clearly imply that required work from the request is still unfinished?",
    true: "Some required part of the request was not done when the turn ended.",
    false: "The request was carried out, or the remaining work is optional and was not asked for.",
  },
  defers_work: {
    question:
      "Does the final assistant message put remaining work off to later, or hand that work back to the user?",
    true: "It promises the work later, lists it as a next step, or asks the user to do it or to say when to continue.",
    false:
      "It claims the work is done, or it reports a legitimate outcome that leaves no work behind.",
  },
} as const;

/** Language the instruction should be written in, as reported by the judge. */
export const INSTRUCTION_LANGUAGES = ["en", "ru"] as const;
export type InstructionLanguage = (typeof INSTRUCTION_LANGUAGES)[number];

const shouldBeChecked = new Set([
  ...LEGITIMATE_STOP_REASONS.map((reason) => reason.id),
  ...Object.keys(STOP_SIGNALS),
]);
if (shouldBeChecked.size !== LEGITIMATE_STOP_REASONS.length + Object.keys(STOP_SIGNALS).length) {
  throw new Error("stop policy ids must be unique");
}
