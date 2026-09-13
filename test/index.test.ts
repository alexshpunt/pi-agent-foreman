import { describe, expect, it } from "vitest";
import { settledAssistantText } from "../src/index.ts";

const ctx = (messages: unknown[]) => ({ sessionManager: { getBranch: () => messages } });
const message = (role: string, content: unknown, stopReason?: string) => ({
  type: "message",
  message: { role, content, stopReason },
});

describe("settledAssistantText", () => {
  it("returns only text from the final assistant answer", () => {
    expect(
      settledAssistantText(
        ctx([
          message("user", "request"),
          message("assistant", [
            { type: "thinking", thinking: "secret" },
            { type: "text", text: "final" },
          ]),
        ]),
      ),
    ).toBe("final");
  });

  it("does not observe a user-aborted answer", () => {
    expect(
      settledAssistantText(
        ctx([message("assistant", [{ type: "text", text: "partial" }], "aborted")]),
      ),
    ).toBeUndefined();
  });

  it("does not reuse an older answer after a non-assistant entry", () => {
    expect(
      settledAssistantText(
        ctx([message("assistant", [{ type: "text", text: "old" }]), message("user", "new")]),
      ),
    ).toBeUndefined();
  });
});
