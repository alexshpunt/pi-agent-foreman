import { describe, expect, it, vi } from "vitest";
import { createClassifierRunner, decideStop } from "../src/classifier.ts";

describe("promise review", () => {
  it("judges only the final reply and gives the writer context after a positive decision", async () => {
    const reply = "Restored retries. Continuing the run.";
    const activity = `[tool ok] replace: restored retries\n[assistant] ${reply}`;
    const judge = vi.fn(async () => ({ promise: 0.94 }));
    const instructionRunner = { run: vi.fn(async () => "Start the promised run now.") };
    const runner = createClassifierRunner({ judge, instructionRunner });
    await expect(runner.run("Why disable retries?", activity, reply)).resolves.toBe(
      "Start the promised run now.",
    );
    expect(judge).toHaveBeenCalledWith({ reply }, undefined);
    expect(instructionRunner.run).toHaveBeenCalledWith(
      "Why disable retries?",
      activity,
      reply,
      undefined,
    );
  });

  it("does not call the writer without a confident promise, even when work is unfinished", async () => {
    const instructionRunner = { run: vi.fn(async () => "Keep implementing.") };
    const runner = createClassifierRunner({
      judge: async () => ({ promise: 0.1 }),
      instructionRunner,
    });
    await expect(
      runner.run("Implement this.", "[assistant] Only one file is done.", "Only one file is done."),
    ).resolves.toBeUndefined();
    expect(instructionRunner.run).not.toHaveBeenCalled();
  });

  it("stays quiet on an uncertain promise", () => {
    expect(decideStop({ promise: 0.69 }).continueWork).toBe(false);
  });

  it("does not replace an unavailable jev with a different judge", async () => {
    const instructionRunner = { run: vi.fn(async () => "Keep working.") };
    const runner = createClassifierRunner({
      judge: async () => {
        throw new Error("TypeSafe unavailable");
      },
      instructionRunner,
    });
    await expect(
      runner.run("Status?", "[assistant] Here is the status.", "Here is the status."),
    ).resolves.toBeUndefined();
    expect(instructionRunner.run).not.toHaveBeenCalled();
  });
});
