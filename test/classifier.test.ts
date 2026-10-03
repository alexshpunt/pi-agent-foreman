import type { ClassifierModel } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
  createClassifierJudge,
  createClassifierRunner,
  createRequestJudge,
  decideStop,
} from "../src/classifier.ts";
import { signals } from "./signals.ts";

describe("decideStop", () => {
  it("continues on either an announced next action or explicit unfinished work", () => {
    expect(decideStop(signals({ plannedAction: 0.5 })).continueWork).toBe(true);
    expect(decideStop(signals({ unfinished: 0.5 })).continueWork).toBe(true);
    expect(decideStop(signals({ plannedAction: 0.49, unfinished: 0.49 })).continueWork).toBe(false);
  });

  it.each(["blocker", "permission", "deferred", "explicitStop"] as const)(
    "%s vetoes both positive signals at the blocking threshold",
    (key) => {
      expect(
        decideStop(signals({ plannedAction: 0.95, unfinished: 0.95, [key]: 0.5 })).continueWork,
      ).toBe(false);
      expect(decideStop(signals({ plannedAction: 0.95, [key]: 0.49 })).continueWork).toBe(true);
    },
  );

  it("uses the configured threshold only for positive signals", () => {
    expect(decideStop(signals({ plannedAction: 0.82 }), 0.9).continueWork).toBe(false);
    expect(decideStop(signals({ unfinished: 0.9 }), 0.9).continueWork).toBe(true);
    expect(decideStop(signals({ plannedAction: 0.96, permission: 0.6 }), 0.9).continueWork).toBe(
      false,
    );
  });

  it("keeps every signal in the decision, including vetoed reviews", () => {
    const verdict = signals({ plannedAction: 0.9, blocker: 0.7, permission: 0.8 });
    expect(decideStop(verdict).signals).toEqual(verdict);
  });
});

describe("createClassifierRunner", () => {
  it("judges only the final reply and calls the writer after an unfinished-work decision", async () => {
    const verdict = signals({ unfinished: 0.97 });
    const judge = vi.fn(async () => verdict);
    const instructionRunner = { run: vi.fn(async () => "Fix the duplicate delivery now.") };
    const onDecision = vi.fn();
    const runner = createClassifierRunner({
      requestJudge: async () => 0.99,
      judge,
      instructionRunner,
      onDecision,
    });
    const reply = "The cause is known, but the duplicate is not fixed.";
    await expect(runner.run("Fix it.", "Checked the delivery path.", reply)).resolves.toBe(
      "Fix the duplicate delivery now.",
    );
    expect(judge).toHaveBeenCalledWith({ reply }, undefined);
    expect(instructionRunner.run).toHaveBeenCalledWith(
      "Fix it.",
      "Checked the delivery path.",
      reply,
      undefined,
    );
    expect(onDecision).toHaveBeenCalledWith(
      verdict,
      expect.objectContaining({ continueWork: true }),
      "Fix the duplicate delivery now.",
    );
  });

  it.each(["blocker", "permission", "deferred", "explicitStop"] as const)(
    "does not call the writer when %s vetoes continuation",
    async (key) => {
      const instructionRunner = { run: vi.fn() };
      const runner = createClassifierRunner({
        requestJudge: async () => 0.99,
        judge: async () => signals({ plannedAction: 0.95, unfinished: 0.95, [key]: 0.9 }),
        instructionRunner,
      });
      await expect(runner.run("Continue.", "Context.", "Reply.")).resolves.toBeUndefined();
      expect(instructionRunner.run).not.toHaveBeenCalled();
    },
  );

  it("drops an instruction when aborted during generation", async () => {
    const controller = new AbortController();
    const onDecision = vi.fn();
    const runner = createClassifierRunner({
      requestJudge: async () => 0.99,
      judge: async () => signals({ plannedAction: 0.96 }),
      instructionRunner: {
        run: async () => {
          controller.abort();
          return "Run tests.";
        },
      },
      onDecision,
    });
    await expect(
      runner.run("Run tests.", "Context.", "Running tests.", controller.signal),
    ).resolves.toBeUndefined();
    expect(onDecision).not.toHaveBeenCalled();
  });

  it("stays quiet if the generator returns nothing", async () => {
    const runner = createClassifierRunner({
      requestJudge: async () => 0.99,
      judge: async () => signals({ plannedAction: 0.96 }),
      instructionRunner: { run: async () => undefined },
    });
    await expect(runner.run("Run tests.", "Context.", "Running tests.")).resolves.toBeUndefined();
  });
});

describe("createClassifierJudge", () => {
  const model: ClassifierModel<"typesafe-system-one"> = {
    type: "classifier",
    provider: "typesafe",
    id: "jev-latest",
    name: "Test classifier",
    api: "typesafe-system-one",
    baseUrl: "https://example.test",
    input: ["text"],
    contextWindow: 32000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const response = (answers: unknown) => ({
    provider: "typesafe",
    model: "jev-latest",
    api: "typesafe-system-one" as const,
    timestamp: 0,
    stopReason: "stop" as const,
    answers,
  });
  const answers = () =>
    Object.fromEntries(
      Object.entries(signals({ plannedAction: 0.91 })).map(([key, probability]) => [
        key,
        { type: "bool", probability },
      ]),
    );

  it("sends only the latest request to the request gate using the selected classifier", async () => {
    const findOfType = vi.fn(() => model);
    const classify = vi.fn(async () =>
      response({ explicitCommand: { type: "bool", probability: 0.92 } }),
    ) as unknown as Parameters<typeof createRequestJudge>[0]["classify"];
    const signal = new AbortController().signal;
    const judge = createRequestJudge({ findOfType, classify }, "openrouter/typesafe/jev-1.13");

    await expect(judge({ request: "Fix it." }, signal)).resolves.toBe(0.92);
    expect(findOfType).toHaveBeenCalledWith("classifier", "openrouter", "typesafe/jev-1.13");
    expect(classify).toHaveBeenCalledOnce();
    expect(classify).toHaveBeenCalledWith(
      model,
      {
        state: { request: "Fix it." },
        questions: { explicitCommand: expect.objectContaining({ type: "bool" }) },
      },
      { signal },
    );
  });

  it.each([undefined, NaN, Infinity, -0.1, 1.1, "0.9"])(
    "rejects an invalid request probability: %s",
    async (probability) => {
      const classify = vi.fn(async () =>
        response({
          explicitCommand: { type: "bool", probability },
        }),
      ) as unknown as Parameters<typeof createRequestJudge>[0]["classify"];
      await expect(
        createRequestJudge({ findOfType: () => model, classify })({ request: "Fix it." }),
      ).rejects.toThrow("invalid explicitCommand");
    },
  );

  it("makes one request for all six signals using the selected provider", async () => {
    const findOfType = vi.fn(() => model);
    const classify = vi.fn(async () => response(answers())) as unknown as Parameters<
      typeof createClassifierJudge
    >[0]["classify"];
    const signal = new AbortController().signal;
    const judge = createClassifierJudge({ findOfType, classify }, "openrouter/typesafe/jev-1.13");
    await expect(judge({ reply: "Continuing." }, signal)).resolves.toEqual(
      signals({ plannedAction: 0.91 }),
    );
    expect(findOfType).toHaveBeenCalledWith("classifier", "openrouter", "typesafe/jev-1.13");
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith(
      model,
      {
        state: { reply: "Continuing." },
        questions: expect.objectContaining(
          Object.fromEntries(
            Object.keys(signals()).map((key) => [key, expect.objectContaining({ type: "bool" })]),
          ),
        ),
      },
      { signal },
    );
  });

  it.each(Object.keys(signals()))(
    "rejects a missing %s answer instead of assuming no blocker",
    async (key) => {
      const values = answers();
      delete values[key];
      const classify = vi.fn(async () => response(values)) as unknown as Parameters<
        typeof createClassifierJudge
      >[0]["classify"];
      await expect(
        createClassifierJudge({ findOfType: () => model, classify })({ reply: "Continue." }),
      ).rejects.toThrow("invalid");
    },
  );

  it.each([NaN, Infinity, -0.1, 1.1, "0.9"])(
    "rejects invalid probabilities: %s",
    async (probability) => {
      const classify = vi.fn(async () =>
        response({ ...answers(), permission: { type: "bool", probability } }),
      ) as unknown as Parameters<typeof createClassifierJudge>[0]["classify"];
      await expect(
        createClassifierJudge({ findOfType: () => model, classify })({ reply: "Continue." }),
      ).rejects.toThrow("invalid");
    },
  );

  it("rejects the wrong answer type", async () => {
    const classify = vi.fn(async () =>
      response({ ...answers(), blocker: { type: "choice", choice: "no" } }),
    ) as unknown as Parameters<typeof createClassifierJudge>[0]["classify"];
    await expect(
      createClassifierJudge({ findOfType: () => model, classify })({ reply: "Continue." }),
    ).rejects.toThrow("invalid");
  });

  it("does not fall back when the selected model is missing", async () => {
    const classify = vi.fn();
    await expect(
      createClassifierJudge(
        { findOfType: () => undefined, classify },
        "missing/model",
      )({ reply: "Continue." }),
    ).rejects.toThrow("Classifier not found");
    expect(classify).not.toHaveBeenCalled();
  });

  it("reports provider errors without an alternative judge", async () => {
    const classify = vi.fn(async () => ({
      ...response({}),
      stopReason: "error" as const,
      errorMessage: "Provider unavailable",
    })) as unknown as Parameters<typeof createClassifierJudge>[0]["classify"];
    await expect(
      createClassifierJudge({ findOfType: () => model, classify })({ reply: "Continue." }),
    ).rejects.toThrow("Provider unavailable");
  });
});
