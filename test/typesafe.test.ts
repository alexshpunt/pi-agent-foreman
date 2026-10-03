import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createTypeSafeJudge,
  createTypeSafeRunner,
  decideStop,
  resolveTypeSafeKey,
  TypeSafeNotConfiguredError,
} from "../src/typesafe.ts";

describe("decideStop", () => {
  it("keeps the agent quiet without a confident promise", () => {
    expect(decideStop({ promise: 0.17 }).continueWork).toBe(false);
  });

  it("continues above the confidence threshold", () => {
    expect(decideStop({ promise: 0.82 }).continueWork).toBe(true);
    expect(decideStop({ promise: 0.82 }, 0.9).continueWork).toBe(false);
  });
});

describe("createTypeSafeRunner", () => {
  it("records the promise verdict and generated instruction", async () => {
    const judge = vi.fn(async () => ({ promise: 0.94 }));
    const instructionRunner = { run: vi.fn(async () => "Run the tests now.") };
    const onDecision = vi.fn();
    const runner = createTypeSafeRunner({ judge, instructionRunner, onDecision });
    await expect(
      runner.run(
        "Run tests.",
        "[assistant] I will run the tests now.",
        "I will run the tests now.",
      ),
    ).resolves.toBe("Run the tests now.");
    expect(judge).toHaveBeenCalledWith({
      reply: "I will run the tests now.",
    });
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
    const runner = createTypeSafeRunner({
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
    const runner = createTypeSafeRunner({
      judge: async () => ({ promise: 0.96 }),
      instructionRunner: { run: async () => undefined },
    });
    await expect(
      runner.run("Run tests.", "unfinished", "Running tests now."),
    ).resolves.toBeUndefined();
  });
});

describe("createTypeSafeJudge", () => {
  it("fails with a clear error when no key can be resolved", async () => {
    const judge = createTypeSafeJudge({ resolveKey: () => undefined });
    await expect(judge({ reply: "Starting now." })).rejects.toThrow(TypeSafeNotConfiguredError);
  });
});

describe("resolveTypeSafeKey", () => {
  const withTempAuth = (contents: unknown, run: (path: string) => void): void => {
    const path = join(
      tmpdir(),
      `foreman-auth-${process.pid}-${Math.random().toString(16).slice(2)}.json`,
    );
    writeFileSync(path, JSON.stringify(contents));
    try {
      run(path);
    } finally {
      rmSync(path, { force: true });
    }
  };

  const withoutEnvironmentKey = (run: () => void): void => {
    const previous = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      run();
    } finally {
      if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = previous;
    }
  };

  it("reads an api key credential stored under the typesafe provider", () => {
    withoutEnvironmentKey(() =>
      withTempAuth({ typesafe: { type: "api_key", key: " stored-key " } }, (path) => {
        expect(resolveTypeSafeKey(path)).toEqual({ key: "stored-key", source: "auth.json" });
      }),
    );
  });

  it("prefers the environment over the auth file", () => {
    const previous = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "env-key";
    try {
      withTempAuth({ typesafe: { type: "api_key", key: "stored-key" } }, (path) => {
        expect(resolveTypeSafeKey(path)).toEqual({ key: "env-key", source: "environment" });
      });
    } finally {
      if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = previous;
    }
  });

  it("ignores a credential that is not an api key and a missing file", () => {
    withoutEnvironmentKey(() => {
      withTempAuth({ typesafe: { type: "oauth", access: "token" } }, (path) => {
        expect(resolveTypeSafeKey(path)).toBeUndefined();
      });
      expect(resolveTypeSafeKey(join(tmpdir(), "foreman-auth-missing.json"))).toBeUndefined();
    });
  });
});
