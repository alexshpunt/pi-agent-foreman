import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDecisionLog, DECISIONS_DIRECTORY, DECISIONS_FILE } from "../src/decisions.ts";
import { LEGITIMATE_STOP_REASONS } from "../src/policy.ts";
import type { StopDecision, StopVerdict } from "../src/typesafe.ts";

const verdict: StopVerdict = {
  workRemains: 0.9,
  defersWork: 0.8,
  gates: Object.fromEntries(LEGITIMATE_STOP_REASONS.map((reason) => [reason.id, 0.05])),
  remainingKind: "tests",
  language: "en",
};
const decision: StopDecision = { continueWork: true, probability: 0.9, reason: "unfinished" };

const directories: string[] = [];
const tempDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "foreman-log-"));
  directories.push(directory);
  return directory;
};
const linesOf = (agentDir: string): unknown[] =>
  readFileSync(join(agentDir, DECISIONS_DIRECTORY, DECISIONS_FILE), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("createDecisionLog", () => {
  it("writes one parseable line per decision, including the instruction", () => {
    const agentDir = tempDirectory();
    const log = createDecisionLog(agentDir);

    log({ cwd: "/repo", verdict, decision, instruction: "Do the work." });
    log({ cwd: "/repo", verdict, decision });

    const lines = linesOf(agentDir) as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      cwd: "/repo",
      verdict,
      decision,
      instruction: "Do the work.",
    });
    expect(typeof lines[0]?.timestamp).toBe("string");
    expect(lines[1]).not.toHaveProperty("instruction");
  });

  it("keeps working when the log cannot be written", () => {
    const notADirectory = join(tempDirectory(), "file");
    writeFileSync(notADirectory, "occupied");

    expect(() =>
      createDecisionLog(notADirectory)({ cwd: "/repo", verdict, decision }),
    ).not.toThrow();
  });
});
