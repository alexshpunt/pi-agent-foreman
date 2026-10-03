import { describe, expect, it } from "vitest";
import { type DecisionDetails, decisionText } from "../src/index.ts";
import { decideStop } from "../src/typesafe.ts";

const details: DecisionDetails = {
  user: "request-unique",
  activity: "context-unique",
  reply: `reply-unique ${"x".repeat(15_000)}`,
  threshold: 0.7,
  decision: decideStop({ promise: 0.2 }),
};

describe("decision rendering", () => {
  it("keeps all input text in the expanded view but not the summary", () => {
    const expanded = decisionText(details, true);
    const collapsed = decisionText(details, false);
    for (const input of [details.user, details.activity, details.reply]) {
      expect(expanded).toContain(input);
      expect(collapsed).not.toContain(input);
    }
    expect(expanded).toContain(String(details.threshold));
    expect(expanded).toContain(String(details.decision.probability));
    expect(expanded).toContain(details.decision.reason);
  });

  it("includes the actual continuation instruction only when present", () => {
    const instruction = "instruction-unique";
    const continued = { ...details, decision: decideStop({ promise: 0.9 }), instruction };
    expect(decisionText(continued, true)).toContain(instruction);
    expect(decisionText(continued, false)).not.toContain(instruction);
    expect(decisionText(details, true)).not.toContain(instruction);
    expect(decisionText(continued, false)).not.toBe(decisionText(details, false));
    expect(decisionText({ ...continued, instruction: undefined }, false)).not.toBe(
      decisionText(continued, false),
    );
  });
});
