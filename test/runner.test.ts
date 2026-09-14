import { describe, expect, it, vi } from "vitest";
import { createForemanRunner } from "../src/runner.ts";

describe("foreman runner", () => {
  it("gives a fresh agent only the final answer and accepts only a veto call", async () => {
    let options: any;
    const prompt = vi.fn(async () => {
      const veto = options.customTools.find((tool: any) => tool.name === "veto");
      await veto.execute("id", {
        remainingWork: "The tests were not run.",
        instruction: "Finish the remaining work now: run the tests.",
      });
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
      systemPrompt: "custom foreman prompt",
      createSession,
    });

    await expect(runner.run("Finish the task.", "I did not run the tests.")).resolves.toBe(
      "Finish the remaining work now: run the tests.",
    );
    expect(prompt).toHaveBeenCalledWith(
      "<last-user-message>\nFinish the task.\n</last-user-message>\n\n<last-assistant-message>\nI did not run the tests.\n</last-assistant-message>",
      { expandPromptTemplates: false },
    );
    expect(options.tools).toEqual(["veto"]);
    expect(options.thinkingLevel).toBe("high");
    expect(options.resourceLoader.getSystemPrompt()).toBe("custom foreman prompt");
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
    await expect(runner.run("Research this.", "Research complete.")).resolves.toBeUndefined();
  });
});
