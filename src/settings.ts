import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ForemanThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Which judge reviews a settled run.
 *
 * auto: the TypeSafe judge when a key is configured, the model judge otherwise.
 * model: always the nested model. typesafe: TypeSafe, falling back to the model if it fails.
 */
export const JUDGES = ["auto", "model", "typesafe"] as const;
export type ForemanJudge = (typeof JUDGES)[number];

export interface ForemanSettings {
  enabled: boolean;
  model?: string;
  thinking?: ForemanThinkingLevel;
  judge?: ForemanJudge;
  /** Minimum probability that required work is unfinished, used by the TypeSafe judge. */
  threshold?: number;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** Parse the complete public settings surface for Agent Foreman. */
export function parseSettings(raw: unknown): ForemanSettings {
  const value =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const thinking = THINKING_LEVELS.find((level) => level === value.thinking);
  const judge = JUDGES.find((candidate) => candidate === value.judge);
  const threshold =
    typeof value.threshold === "number" &&
    Number.isFinite(value.threshold) &&
    value.threshold >= 0 &&
    value.threshold <= 1
      ? value.threshold
      : undefined;
  return {
    enabled: booleanOr(value.enabled, true),
    model: model || undefined,
    thinking,
    judge,
    threshold,
  };
}

/** Persist Agent Foreman settings globally while preserving every unrelated Pi setting. */
export function writeGlobalForemanSettings(settings: ForemanSettings): void {
  const path = join(getAgentDir(), "settings.json");
  const root = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  root.agentForeman = settings;
  const temporary = `${path}.agent-foreman-${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
