import { describe, expect, it, vi } from "vitest";
import { createClassifierRunner, decideStop } from "../src/classifier.ts";
import { signals } from "./signals.ts";

describe("final reply review", () => {
  it("judges only the final reply and gives the writer context after a positive decision", async () => {
    const reply = "Restored retries. Continuing the run.";
    const activity = `[tool ok] replace: restored retries\n[assistant] ${reply}`;
    const judge = vi.fn(async () => signals({ plannedAction: 0.94 }));
    const instructionRunner = { run: vi.fn(async () => "Start the run now.") };
    const runner = createClassifierRunner({ judge, instructionRunner });
    await expect(runner.run("Why disable retries?", activity, reply)).resolves.toBe(
      "Start the run now.",
    );
    expect(judge).toHaveBeenCalledWith({ reply }, undefined);
    expect(instructionRunner.run).toHaveBeenCalledWith(
      "Why disable retries?",
      activity,
      reply,
      undefined,
    );
  });

  it("does not use unfinished activity when the final reply has no positive signal", async () => {
    const instructionRunner = { run: vi.fn() };
    const runner = createClassifierRunner({ judge: async () => signals(), instructionRunner });
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
      judge: async () => {
        throw new Error("TypeSafe unavailable");
      },
      instructionRunner,
      onUnavailable,
    });
    await expect(runner.run("Status?", "Context.", "Here is the status.")).resolves.toBeUndefined();
    expect(instructionRunner.run).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith(expect.any(Error));
  });
});
