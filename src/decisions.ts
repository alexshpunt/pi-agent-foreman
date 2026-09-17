import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { StopDecision, StopVerdict } from "./typesafe.ts";

/**
 * One line per judge decision, so a decision can be read back later instead of replayed.
 *
 * The verdict and the decision are the parts that would otherwise be lost: the instruction
 * that reaches the agent is already in the session file, but the numbers behind it are not.
 */
export interface DecisionRecord {
  timestamp: string;
  cwd: string;
  verdict: StopVerdict;
  decision: StopDecision;
  /** Instruction produced for the agent, absent when the judge stayed quiet. */
  instruction?: string;
}

/** Directory the log lives in, relative to Pi's agent directory. */
export const DECISIONS_DIRECTORY = "agent-foreman";
export const DECISIONS_FILE = "decisions.jsonl";

export interface DecisionLogInput {
  cwd: string;
  verdict: StopVerdict;
  decision: StopDecision;
  instruction?: string;
}

export type DecisionLog = (input: DecisionLogInput) => void;

/**
 * Append decisions to `<agentDir>/agent-foreman/decisions.jsonl`.
 *
 * Logging is best effort: a failure here must never stop the judge or the agent, so the
 * error is swallowed. The log is plain JSON lines, one decision per line.
 */
export function createDecisionLog(agentDir: string): DecisionLog {
  const directory = join(agentDir, DECISIONS_DIRECTORY);
  const file = join(directory, DECISIONS_FILE);

  return (input) => {
    const record: DecisionRecord = {
      timestamp: new Date().toISOString(),
      cwd: input.cwd,
      verdict: input.verdict,
      decision: input.decision,
      ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
    };
    try {
      mkdirSync(directory, { recursive: true });
      appendFileSync(file, `${JSON.stringify(record)}\n`);
    } catch {
      // A missing or read-only log file is not worth interrupting the agent for.
    }
  };
}
