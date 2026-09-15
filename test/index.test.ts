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
              name: "linear_axi",
              arguments: { action: "issues", args: ["create", "--title", "Task"] },
            },
          ]),
          message("toolResult", [{ type: "text", text: "large private result" }], undefined, {
            toolName: "linear_axi",
            isError: false,
          }),
          message("assistant", [{ type: "text", text: "Added LPT-201." }]),
          message("assistant", [
            { type: "text", text: "A background benchmark is still running." },
          ]),
        ]),
      ),
    ).toEqual({
      user: "add the task",
      activity:
        '[tool] linear_axi {"action":"issues","args":["create","--title","Task"]}\n[tool ok] linear_axi\n[assistant] Added LPT-201.\n[assistant] A background benchmark is still running.',
    });
  });

  it("shortens large tool arguments without including tool results", () => {
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
        message("toolResult", [{ type: "text", text: "result that must stay hidden" }], undefined, {
          toolName: "write",
          isError: true,
        }),
        message("assistant", [{ type: "text", text: "I could not finish." }]),
      ]),
    );

    expect(exchange?.activity).toContain("[tool] write");
    expect(exchange?.activity).toContain("…");
    expect(exchange?.activity).toContain("[tool error] write");
    expect(exchange?.activity).not.toContain("result that must stay hidden");
    expect(exchange?.activity.length).toBeLessThan(1_500);
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
