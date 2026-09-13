import { describe, expect, it, vi } from "vitest";
import { createForemanRunner, FOREMAN_SYSTEM_PROMPT } from "../src/runner.ts";

describe("foreman runner", () => {
  it("gives a fresh agent only the final answer and accepts only a veto call", async () => {
    let options: any;
    const prompt = vi.fn(async () => {
      const veto = options.customTools.find((tool: any) => tool.name === "veto");
      await veto.execute("id", { instruction: "Finish the tests now." });
    });
    const createSession = vi.fn(async (value: any) => {
      options = value;
      return { session: { prompt, abort: vi.fn(), dispose: vi.fn() } };
    });
    const runner = createForemanRunner({
      model: { provider: "p", id: "m" },
      cwd: "/tmp",
      agentDir: "/tmp",
      thinking: "high",
      createSession,
    });

    await expect(runner.run("I did not run the tests.")).resolves.toBe("Finish the tests now.");
    expect(prompt).toHaveBeenCalledWith("I did not run the tests.", {
      expandPromptTemplates: false,
    });
    expect(options.tools).toEqual(["veto"]);
    expect(options.thinkingLevel).toBe("high");
    expect(options.resourceLoader.getSystemPrompt()).toBe(FOREMAN_SYSTEM_PROMPT);
  });

  it("returns nothing when the model does not call veto", async () => {
    const createSession = vi.fn(async () => ({
      session: { prompt: vi.fn(), abort: vi.fn(), dispose: vi.fn() },
    }));
    const runner = createForemanRunner({
      model: { provider: "p", id: "m" },
      cwd: "/tmp",
      agentDir: "/tmp",
      createSession,
    });
    await expect(runner.run("Research complete.")).resolves.toBeUndefined();
  });
});
