import { describe, expect, it } from "vitest";
import { settledExchange } from "../src/index.ts";

const ctx = (messages: unknown[]) => ({ sessionManager: { getBranch: () => messages } });
const message = (role: string, content: unknown, stopReason?: string) => ({
  type: "message",
  message: { role, content, stopReason },
});

describe("settledExchange", () => {
  it("returns only the latest user message and final assistant answer", () => {
    expect(
      settledExchange(
        ctx([
          message("user", "request"),
          message("assistant", [
            { type: "thinking", thinking: "secret" },
            { type: "text", text: "final" },
          ]),
        ]),
      ),
    ).toEqual({ user: "request", assistant: "final" });
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
