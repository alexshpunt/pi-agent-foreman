import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LEGITIMATE_STOP_REASONS } from "../src/policy.ts";
import {
  createTypeSafeJudge,
  createTypeSafeRunner,
  decideStop,
  resolveTypeSafeKey,
  type StopVerdict,
  TypeSafeNotConfiguredError,
} from "../src/typesafe.ts";

const gates = (overrides: Record<string, number> = {}): Record<string, number> =>
  Object.fromEntries(
    LEGITIMATE_STOP_REASONS.map((reason) => [reason.id, overrides[reason.id] ?? 0.05]),
  );

const verdict = (overrides: Partial<StopVerdict> = {}): StopVerdict => ({
  workRemains: 0.9,
  defersWork: 0.8,
  gates: gates({ waiting_on_background: 0.1 }),
  ...overrides,
});

describe("decideStop", () => {
  it("sends the agent back when required work is unfinished", () => {
    expect(decideStop(verdict())).toMatchObject({ continueWork: true, probability: 0.9 });
  });

  it("stays quiet when the activity leaves nothing required unfinished", () => {
    expect(decideStop(verdict({ workRemains: 0.4 }))).toMatchObject({ continueWork: false });
  });

  it("honours a raised threshold", () => {
    expect(
      decideStop(verdict({ workRemains: 0.6 }), { workRemains: 0.8, gate: 0.5 }).continueWork,
    ).toBe(false);
  });

  it.each(LEGITIMATE_STOP_REASONS.map((reason) => [reason.id]))(
    "keeps a stop when %s is high",
    (id) => {
      const decision = decideStop(verdict({ gates: gates({ [id]: 0.9 }) }));
      expect(decision.continueWork).toBe(false);
      expect(decision.reason).toContain(id);
    },
  );

  it("keeps a completed diagnosis despite an optional deeper investigation", () => {
    const decision = decideStop(
      verdict({
        workRemains: 0.81,
        defersWork: 0.69,
        gates: gates({ answered_diagnosis: 0.9 }),
      }),
    );
    expect(decision.continueWork).toBe(false);
    expect(decision.reason).toContain("answered_diagnosis");
  });

  it("keeps a stop when a gate sits just above the gate threshold", () => {
    expect(decideStop(verdict({ gates: gates({ user_asked_to_stop: 0.5 }) })).continueWork).toBe(
      false,
    );
    expect(decideStop(verdict({ gates: gates({ user_asked_to_stop: 0.49 }) })).continueWork).toBe(
      true,
    );
  });

  it("reports the deferral as the reason when the agent put work off", () => {
    const decision = decideStop(verdict({ defersWork: 0.9 }));
    expect(decision.continueWork).toBe(true);
    expect(decision.reason).toContain("later");
  });

  it("names the number that decided, because the reason is read back from the log", () => {
    const decision = decideStop(verdict({ workRemains: 0.52, defersWork: 0.82 }));
    expect(decision.reason).toContain("0.52");
    expect(decision.reason).toContain("0.82");
  });
});

describe("createTypeSafeRunner", () => {
  it("asks about the settled request and returns the generated instruction", async () => {
    const judge = vi.fn(async () => verdict());
    const instructionRunner = { run: vi.fn(async () => "Run the unfinished test suite now.") };
    const runner = createTypeSafeRunner({ judge, instructionRunner });

    await expect(
      runner.run("Finish the task.", "[assistant] I did not run the tests."),
    ).resolves.toBe("Run the unfinished test suite now.");
    expect(judge).toHaveBeenCalledWith({
      request: "Finish the task.",
      activity: "[assistant] I did not run the tests.",
    });
    expect(instructionRunner.run).toHaveBeenCalledWith(
      "Finish the task.",
      "[assistant] I did not run the tests.",
      undefined,
    );
  });

  it("does not generate when TypeSafe declines continuation", async () => {
    const instructionRunner = { run: vi.fn(async () => "do it") };
    const runner = createTypeSafeRunner({
      judge: async () => verdict({ workRemains: 0.1 }),
      instructionRunner,
    });
    await expect(runner.run("Task.", "Done.")).resolves.toBeUndefined();
    expect(instructionRunner.run).not.toHaveBeenCalled();
  });

  it.each(["empty", "error"])("does not continue on %s generation", async (failure) => {
    const instructionRunner = {
      run: vi.fn(async () => {
        if (failure === "error") throw new Error("provider down");
        return undefined;
      }),
    };
    const fallback = { run: vi.fn(async () => "fallback") };
    const runner = createTypeSafeRunner({
      judge: async () => verdict(),
      instructionRunner,
      fallback,
    });
    await expect(runner.run("Task.", "unfinished")).resolves.toBeUndefined();
    expect(fallback.run).not.toHaveBeenCalled();
  });

  it("returns nothing when a gate keeps the stop", async () => {
    const runner = createTypeSafeRunner({
      judge: async () => verdict({ gates: gates({ presented_choice: 0.8 }) }),
    });
    await expect(runner.run("Pick one.", "[assistant] Which option?")).resolves.toBeUndefined();
  });

  it("stops after answering a plan-only request but continues when implementation was requested", async () => {
    const activity =
      "[assistant] Plan: build a snapshot, load it in app.mjs, and publish it in the workflow.";
    const instructionRunner = { run: vi.fn(async () => "Implement the snapshot now.") };
    const judge = vi
      .fn()
      .mockResolvedValueOnce(verdict({ gates: gates({ requested_plan: 0.9 }) }))
      .mockResolvedValueOnce(verdict({ gates: gates({ requested_plan: 0.1 }) }));
    const runner = createTypeSafeRunner({ judge, instructionRunner });

    await expect(
      runner.run("What is the plan, and where will changes be needed?", activity),
    ).resolves.toBeUndefined();
    expect(instructionRunner.run).not.toHaveBeenCalled();

    await expect(
      runner.run("Start implementing the snapshot now and outline the plan.", activity),
    ).resolves.toBe("Implement the snapshot now.");
    expect(instructionRunner.run).toHaveBeenCalledTimes(1);
    expect(judge).toHaveBeenCalledTimes(2);
  });
  it("does not call the judge when the run was already aborted", async () => {
    const judge = vi.fn(async () => verdict());
    const runner = createTypeSafeRunner({ judge });
    await expect(runner.run("Task.", "activity", AbortSignal.abort())).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it("drops the instruction when the run is aborted while judging", async () => {
    const controller = new AbortController();
    const runner = createTypeSafeRunner({
      judge: async () => {
        controller.abort();
        return verdict();
      },
    });
    await expect(runner.run("Task.", "activity", controller.signal)).resolves.toBeUndefined();
  });

  it("drops a generated instruction when the run is aborted during generation", async () => {
    const controller = new AbortController();
    const instructionRunner = {
      run: vi.fn(async () => {
        controller.abort();
        return "Run the tests now.";
      }),
    };
    const onDecision = vi.fn();
    const runner = createTypeSafeRunner({
      judge: async () => verdict(),
      instructionRunner,
      onDecision,
    });
    await expect(runner.run("Task.", "unfinished", controller.signal)).resolves.toBeUndefined();
    expect(onDecision).not.toHaveBeenCalled();
  });
  it("hands the run to the fallback when the judge fails", async () => {
    const fallback = { run: vi.fn(async () => "from the fallback") };
    const onFallback = vi.fn();
    const onDecision = vi.fn();
    const runner = createTypeSafeRunner({
      judge: async () => {
        throw new Error("service unavailable");
      },
      fallback,
      onFallback,
      onDecision,
    });

    await expect(runner.run("Task.", "activity")).resolves.toBe("from the fallback");
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(fallback.run).toHaveBeenCalledWith("Task.", "activity", undefined);
    expect(onDecision).not.toHaveBeenCalled();
  });

  it("rethrows when the judge fails and there is nothing to fall back to", async () => {
    const runner = createTypeSafeRunner({
      judge: async () => {
        throw new Error("service unavailable");
      },
    });
    await expect(runner.run("Task.", "activity")).rejects.toThrow("service unavailable");
  });

  it("reports the verdict and the decision for every run", async () => {
    const onDecision = vi.fn();
    const instructionRunner = { run: vi.fn(async () => "Finish the pending work.") };
    const runner = createTypeSafeRunner({
      judge: async () => verdict(),
      instructionRunner,
      onDecision,
    });
    const instruction = await runner.run("Finish the task.", "[assistant] Starting now.");
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith(
      verdict(),
      expect.objectContaining({ continueWork: true }),
      instruction,
    );
  });

  it("reports a quiet decision without an instruction", async () => {
    const onDecision = vi.fn();
    const runner = createTypeSafeRunner({
      judge: async () => verdict({ gates: gates({ waiting_on_background: 0.9 }) }),
      onDecision,
    });
    await runner.run("Task.", "activity");
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ gates: gates({ waiting_on_background: 0.9 }) }),
      expect.objectContaining({ continueWork: false }),
      undefined,
    );
  });
});

describe("createTypeSafeJudge", () => {
  it("fails with a clear error when no key can be resolved", async () => {
    const judge = createTypeSafeJudge({ resolveKey: () => undefined });
    await expect(judge({ request: "Task.", activity: "activity" })).rejects.toThrow(
      TypeSafeNotConfiguredError,
    );
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
