import type { ClassifierModel } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { createClassifierJudge, createClassifierRunner, decideStop } from "../src/classifier.ts";

describe("decideStop", () => {
  it("keeps the agent quiet without a confident promise", () => {
    expect(decideStop({ promise: 0.17 }).continueWork).toBe(false);
  });

  it("continues above the confidence threshold", () => {
    expect(decideStop({ promise: 0.82 }).continueWork).toBe(true);
    expect(decideStop({ promise: 0.82 }, 0.9).continueWork).toBe(false);
  });
});

describe("createClassifierRunner", () => {
  it("records the promise verdict and generated instruction", async () => {
    const judge = vi.fn(async () => ({ promise: 0.94 }));
    const instructionRunner = { run: vi.fn(async () => "Run the tests now.") };
    const onDecision = vi.fn();
    const runner = createClassifierRunner({ judge, instructionRunner, onDecision });
    await expect(
      runner.run(
        "Run tests.",
        "[assistant] I will run the tests now.",
        "I will run the tests now.",
      ),
    ).resolves.toBe("Run the tests now.");
    expect(judge).toHaveBeenCalledWith(
      {
        reply: "I will run the tests now.",
      },
      undefined,
    );
    expect(onDecision).toHaveBeenCalledWith(
      { promise: 0.94 },
      expect.objectContaining({ continueWork: true }),
      "Run the tests now.",
    );
  });

  it("drops an instruction when the run is aborted during generation", async () => {
    const controller = new AbortController();
    const instructionRunner = {
      run: vi.fn(async () => {
        controller.abort();
        return "Run tests.";
      }),
    };
    const onDecision = vi.fn();
    const runner = createClassifierRunner({
      judge: async () => ({ promise: 0.96 }),
      instructionRunner,
      onDecision,
    });
    await expect(
      runner.run("Run tests.", "unfinished", "Running tests now.", controller.signal),
    ).resolves.toBeUndefined();
    expect(onDecision).not.toHaveBeenCalled();
  });

  it("stays quiet if the generator returns nothing", async () => {
    const runner = createClassifierRunner({
      judge: async () => ({ promise: 0.96 }),
      instructionRunner: { run: async () => undefined },
    });
    await expect(
      runner.run("Run tests.", "unfinished", "Running tests now."),
    ).resolves.toBeUndefined();
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

  it("uses the selected provider and preserves model ids containing slashes", async () => {
    const findOfType = vi.fn(() => model);
    const classify = vi.fn(async () => ({
      provider: "typesafe",
      model: "jev-latest",
      api: "typesafe-system-one" as const,
      timestamp: 0,
      stopReason: "stop" as const,
      answers: { promise: { type: "bool" as const, probability: 0.91 } },
    }));
    const signal = new AbortController().signal;
    const judge = createClassifierJudge({ findOfType, classify }, "openrouter/typesafe/jev-1.13");
    await expect(judge({ reply: "Continuing." }, signal)).resolves.toEqual({ promise: 0.91 });
    expect(findOfType).toHaveBeenCalledWith("classifier", "openrouter", "typesafe/jev-1.13");
    expect(classify).toHaveBeenCalledWith(
      model,
      expect.objectContaining({ state: { reply: "Continuing." } }),
      { signal },
    );
  });

  it("does not fall back when the selected model is missing", async () => {
    const classify = vi.fn();
    const judge = createClassifierJudge({ findOfType: () => undefined, classify }, "missing/model");
    await expect(judge({ reply: "Continue." })).rejects.toThrow("Classifier not found");
    expect(classify).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { promise: { type: "bool", probability: NaN } },
    { promise: { type: "bool", probability: 2 } },
    { promise: { type: "choice", choice: "yes" } },
  ])("rejects malformed answers instead of treating them as a quiet decision", async (answers) => {
    const classify = vi.fn(async () => ({
      provider: "typesafe",
      model: "jev-latest",
      stopReason: "stop" as const,
      answers,
    })) as unknown as Parameters<typeof createClassifierJudge>[0]["classify"];
    await expect(
      createClassifierJudge({ findOfType: () => model, classify })({ reply: "Continue." }),
    ).rejects.toThrow("invalid promise");
  });

  it("reports Pi provider errors without calling an alternative judge", async () => {
    const classify = vi.fn(async () => ({
      provider: "typesafe",
      model: "jev-latest",
      api: "typesafe-system-one" as const,
      timestamp: 0,
      stopReason: "error" as const,
      errorMessage: "Provider unavailable",
      answers: {},
    }));
    await expect(
      createClassifierJudge({ findOfType: () => model, classify })({ reply: "Continue." }),
    ).rejects.toThrow("Provider unavailable");
  });
});
