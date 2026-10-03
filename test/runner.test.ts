import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createForemanRunner } from "../src/runner.ts";

describe("foreman runner", () => {
  it("uses an instruction tool after jev decides to continue", async () => {
    const createSession = vi.fn(async (value: CreateAgentSessionOptions) => {
      return {
        session: {
          prompt: vi.fn(async () => {
            const instruct = value.customTools?.[0] as unknown as {
              execute(
                id: string,
                params: { action: string; instruction: string },
              ): Promise<unknown>;
            };
            await instruct.execute("id", {
              action: "Run tests now.",
              instruction: "Run the tests you left unfinished now.",
            });
          }),
          abort: vi.fn(),
          dispose: vi.fn(),
        },
      };
    });
    const runner = createForemanRunner({
      model: { provider: "p", id: "m" },
      cwd: "/tmp",
      agentDir: "/tmp",
      createSession,
    });
    await expect(
      runner.run("Test the change.", "[assistant] Running tests now.", "Running tests now."),
    ).resolves.toBe("Run the tests you left unfinished now.");
    expect(createSession.mock.calls[0]?.[0].tools).toEqual(["instruct"]);
  });

  it("returns nothing when the model does not call instruct", async () => {
    const createSession = vi.fn(async () => ({
      session: { prompt: vi.fn(), abort: vi.fn(), dispose: vi.fn() },
    }));
    const runner = createForemanRunner({
      model: { provider: "p", id: "m" },
      cwd: "/tmp",
      agentDir: "/tmp",
      createSession,
    });
    await expect(
      runner.run("Research this.", "Research complete.", "Research complete."),
    ).resolves.toBeUndefined();
  });
});
