import { describe, expect, it, vi } from "vitest";
import { createForemanRunner, FOREMAN_SYSTEM_PROMPT } from "../src/runner.ts";

describe("foreman runner", () => {
  it("treats completion and active background waits as legitimate", () => {
    expect(FOREMAN_SYSTEM_PROMPT).toContain("If the answer says the task is complete");
    expect(FOREMAN_SYSTEM_PROMPT).toContain(
      "Waiting for a background command, watcher, build, or sub-agent",
    );
  });
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
      systemPrompt: "custom foreman prompt",
      createSession,
    });

    await expect(runner.run("I did not run the tests.")).resolves.toBe("Finish the tests now.");
    expect(prompt).toHaveBeenCalledWith("I did not run the tests.", {
      expandPromptTemplates: false,
    });
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
    await expect(runner.run("Research complete.")).resolves.toBeUndefined();
  });
});
