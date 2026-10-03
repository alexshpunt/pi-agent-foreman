import { describe, expect, it } from "vitest";
import { settledExchange } from "../src/index.ts";

const ctx = (messages: unknown[]) => ({ sessionManager: { getBranch: () => messages } });
const message = (
  role: string,
  content: unknown,
  stopReason?: string,
  extra: Record<string, unknown> = {},
) => ({
  type: "message",
  message: { role, content, stopReason, ...extra },
});

describe("settledExchange", () => {
  it("keeps the final reply exact even when activity is shortened", () => {
    const reply = `Result: ${"x".repeat(15_000)}. Continuing the run.`;
    const exchange = settledExchange(
      ctx([
        message("user", "Check the change."),
        message("assistant", [{ type: "text", text: "An earlier promise." }]),
        message("assistant", [
          { type: "thinking", thinking: "private" },
          { type: "text", text: reply },
        ]),
      ]),
    );
    expect(exchange?.reply).toBe(reply);
    expect(exchange?.activity.length).toBeLessThanOrEqual(12_000);
    expect(exchange?.reply).not.toContain("private");
  });
  it("returns all agent activity after the latest user message", () => {
    expect(
      settledExchange(
        ctx([
          message("user", "add the task"),
          message("assistant", [
            { type: "thinking", thinking: "secret" },
            {
              type: "toolCall",
              id: "call-1",
              name: "issue_tracker",
              arguments: { action: "issues", args: ["create", "--title", "Task"] },
            },
          ]),
          message("toolResult", [{ type: "text", text: "large private result" }], undefined, {
            toolName: "issue_tracker",
            isError: false,
          }),
          message("assistant", [{ type: "text", text: "Added TICKET-201." }]),
          message("assistant", [{ type: "text", text: "A background build is still running." }]),
        ]),
      ),
    ).toEqual({
      user: "add the task",
      reply: "A background build is still running.",
      activity:
        '[tool] issue_tracker {"action":"issues","args":["create","--title","Task"]}\n[tool ok] issue_tracker: large private result\n[assistant] Added TICKET-201.\n[assistant] A background build is still running.',
    });
  });

  it("shortens large tool arguments and results", () => {
    const exchange = settledExchange(
      ctx([
        message("user", "request"),
        message("assistant", [
          {
            type: "toolCall",
            id: "call-1",
            name: "write",
            arguments: { content: "x".repeat(2_000) },
          },
        ]),
        message("toolResult", [{ type: "text", text: "validation failed" }], undefined, {
          toolName: "write",
          isError: true,
        }),
        message("assistant", [{ type: "text", text: "I could not finish." }]),
      ]),
    );

    expect(exchange?.activity).toContain("[tool] write");
    expect(exchange?.activity).toContain("…");
    expect(exchange?.activity).toContain("[tool error] write");
    expect(exchange?.activity).toContain("validation failed");
    expect(exchange?.activity.length).toBeLessThan(1_500);
  });

  it("includes bounded tool evidence from the last request without leaking older work", () => {
    const exchange = settledExchange(
      ctx([
        message("user", "Implement this."),
        message("assistant", [{ type: "text", text: "Earlier work is unfinished." }]),
        message("user", "What did you decide?"),
        message("assistant", [{ type: "toolCall", name: "read", arguments: { path: "note.txt" } }]),
        message(
          "toolResult",
          [{ type: "text", text: `evidence:${"x".repeat(2_000)}` }],
          undefined,
          {
            toolName: "read",
            isError: false,
          },
        ),
        message("assistant", [{ type: "text", text: "I decided to use line insertion." }]),
      ]),
    );
    expect(exchange?.user).toBe("What did you decide?");
    expect(exchange?.activity).toContain("evidence:");
    expect(exchange?.activity).toContain("I decided to use line insertion.");
    expect(exchange?.activity).not.toContain("Earlier work is unfinished.");
    expect(exchange?.activity.length).toBeLessThan(1_500);
  });
  it("shows earlier Foreman instructions beside the agent's replies in the same request", () => {
    const exchange = settledExchange(
      ctx([
        message("user", "Try to restart the graphics driver."),
        message("assistant", [
          { type: "text", text: "The command hung. Please press the shortcut yourself." },
        ]),
        { type: "custom", customType: "agent-foreman-continued", data: {} },
        {
          type: "custom_message",
          customType: "agent-foreman-continued",
          content: "Try once more, then report the result.",
        },
        message("assistant", [{ type: "text", text: "The retry timed out. Press it manually." }]),
        {
          type: "custom_message",
          customType: "other-extension",
          content: "Unrelated extension data",
        },
        { type: "custom_message", customType: "agent-foreman-continued", content: "Ask again." },
        message("assistant", [
          { type: "text", text: "I cannot send the shortcut. Press it manually." },
        ]),
      ]),
    );
    expect(exchange).toEqual({
      user: "Try to restart the graphics driver.",
      reply: "I cannot send the shortcut. Press it manually.",
      activity:
        "[assistant] The command hung. Please press the shortcut yourself.\n[foreman] Try once more, then report the result.\n[assistant] The retry timed out. Press it manually.\n[foreman] Ask again.\n[assistant] I cannot send the shortcut. Press it manually.",
    });
  });

  it("does not include a Foreman instruction from before the latest user request", () => {
    const exchange = settledExchange(
      ctx([
        message("user", "Implement the change."),
        message("assistant", [{ type: "text", text: "Not yet." }]),
        {
          type: "custom_message",
          customType: "agent-foreman-continued",
          content: "Finish the implementation.",
        },
        message("user", "Just explain your decision."),
        message("assistant", [{ type: "text", text: "I chose the smaller change." }]),
      ]),
    );
    expect(exchange).toEqual({
      user: "Just explain your decision.",
      reply: "I chose the smaller change.",
      activity: "[assistant] I chose the smaller change.",
    });
  });
  it("does not observe a user-aborted answer", () => {
    expect(
      settledExchange(ctx([message("assistant", [{ type: "text", text: "partial" }], "aborted")])),
    ).toBeUndefined();
  });

  it("does not reuse an older answer after a non-assistant entry", () => {
    expect(
      settledExchange(
        ctx([message("assistant", [{ type: "text", text: "old" }]), message("user", "new")]),
      ),
    ).toBeUndefined();
  });
});
