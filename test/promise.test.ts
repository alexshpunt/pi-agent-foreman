import { describe, expect, it, vi } from "vitest";
import { createClassifierRunner, decideStop } from "../src/classifier.ts";
import { signals } from "./signals.ts";

describe("final reply review", () => {
  it("shares the current request and activity with the judge and writer", async () => {
    const reply = "Restored retries. Continuing the run.";
    const activity = `[tool ok] replace: restored retries\n[assistant] ${reply}`;
    const judge = vi.fn(async () => signals({ plannedAction: 0.94 }));
    const instructionRunner = { run: vi.fn(async () => "Start the run now.") };
    const runner = createClassifierRunner({
      requestJudge: async () => 0.99,
      judge,
      instructionRunner,
    });
    await expect(
      runner.run("Restore retries and continue the run.", activity, reply),
    ).resolves.toBe("Start the run now.");
    expect(judge).toHaveBeenCalledWith(
      { request: "Restore retries and continue the run.", activity, reply },
      undefined,
    );
    expect(instructionRunner.run).toHaveBeenCalledWith(
      "Restore retries and continue the run.",
      activity,
      reply,
      undefined,
    );
  });

  it("does not use unfinished activity when the final reply has no positive signal", async () => {
    const instructionRunner = { run: vi.fn() };
    const runner = createClassifierRunner({
      requestJudge: async () => 0.99,
      judge: async () => signals(),
      instructionRunner,
    });
    await expect(
      runner.run(
        "Implement this.",
        "[assistant] Earlier work is unfinished.",
        "The requested work is complete.",
      ),
    ).resolves.toBeUndefined();
    expect(instructionRunner.run).not.toHaveBeenCalled();
  });

  it("stays quiet when both positive signals are below the threshold", () => {
    expect(decideStop(signals({ plannedAction: 0.49, unfinished: 0.49 })).continueWork).toBe(false);
  });

  it("does not replace an unavailable classifier with another judge", async () => {
    const onUnavailable = vi.fn();
    const instructionRunner = { run: vi.fn() };
    const runner = createClassifierRunner({
      requestJudge: async () => 0.99,
      judge: async () => {
        throw new Error("TypeSafe unavailable");
      },
      instructionRunner,
      onUnavailable,
    });
    await expect(
      runner.run("Do the work.", "Context.", "Here is the status."),
    ).resolves.toBeUndefined();
    expect(instructionRunner.run).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith(expect.any(Error));
  });
});
