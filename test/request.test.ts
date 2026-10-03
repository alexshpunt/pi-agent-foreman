import { describe, expect, it, vi } from "vitest";
import { createClassifierRunner } from "../src/classifier.ts";
import { signals } from "./signals.ts";

describe("user request gate", () => {
  it.each(["What is left?", "Can you fix the bug?", "Что осталось?", "Можешь исправить баг?"])(
    "does not review the reply or write an instruction for %s",
    async (request) => {
      const requestJudge = vi.fn(async () => 0.05);
      const judge = vi.fn(async () => signals({ unfinished: 0.99, plannedAction: 0.99 }));
      const instructionRunner = { run: vi.fn(async () => "Fix the bug now.") };
      const onDecision = vi.fn();
      const runner = createClassifierRunner({ requestJudge, judge, instructionRunner, onDecision });

      await expect(
        runner.run(request, "Checked the bug.", "The bug is not fixed."),
      ).resolves.toBeUndefined();
      expect(requestJudge).toHaveBeenCalledWith({ request }, undefined);
      expect(judge).not.toHaveBeenCalled();
      expect(instructionRunner.run).not.toHaveBeenCalled();
      expect(onDecision).not.toHaveBeenCalled();
    },
  );

  it.each(["Fix the bug.", "Why does it fail? Find the cause and fix it."])(
    "checks %s before reviewing the reply",
    async (request) => {
      const calls: string[] = [];
      const requestJudge = vi.fn(async () => {
        calls.push("request");
        return 0.99;
      });
      const judge = vi.fn(async () => {
        calls.push("reply");
        return signals({ unfinished: 0.99 });
      });
      const instructionRunner = {
        run: vi.fn(async () => {
          calls.push("writer");
          return "Fix the bug now.";
        }),
      };
      const signal = new AbortController().signal;
      const runner = createClassifierRunner({ requestJudge, judge, instructionRunner });

      await expect(runner.run(request, "Context.", "The bug is not fixed.", signal)).resolves.toBe(
        "Fix the bug now.",
      );
      expect(calls).toEqual(["request", "reply", "writer"]);
      expect(requestJudge).toHaveBeenCalledWith({ request }, signal);
      expect(judge).toHaveBeenCalledWith({ reply: "The bug is not fixed." }, signal);
      expect(instructionRunner.run).toHaveBeenCalledWith(
        request,
        "Context.",
        "The bug is not fixed.",
        signal,
      );
    },
  );

  it("does not let a lower reply threshold bypass an uncertain request", async () => {
    const judge = vi.fn(async () => signals({ unfinished: 0.99 }));
    const runner = createClassifierRunner({ requestJudge: async () => 0.49, judge, threshold: 0 });
    await expect(
      runner.run("Maybe do something.", "Context.", "Work remains."),
    ).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it("stays quiet when the request classifier fails", async () => {
    const error = new Error("Request classifier unavailable");
    const judge = vi.fn();
    const onUnavailable = vi.fn();
    const runner = createClassifierRunner({
      requestJudge: async () => {
        throw error;
      },
      judge,
      onUnavailable,
    });
    await expect(runner.run("Fix it.", "Context.", "Work remains.")).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith(error);
  });

  it("drops an aborted request review before judging the reply", async () => {
    const controller = new AbortController();
    const judge = vi.fn();
    const requestJudge = vi.fn(async () => {
      controller.abort();
      return 0.99;
    });
    const runner = createClassifierRunner({ requestJudge, judge });
    await expect(
      runner.run("Fix it.", "Context.", "Work remains.", controller.signal),
    ).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });
});
