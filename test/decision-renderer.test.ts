import { describe, expect, it } from "vitest";
import { decideStop } from "../src/classifier.ts";
import { type DecisionDetails, decisionText } from "../src/index.ts";
import { signals } from "./signals.ts";

const details: DecisionDetails = {
  user: "request-unique",
  activity: "context-unique",
  reply: `reply-unique ${"x".repeat(15_000)}`,
  threshold: 0.7,
  decision: decideStop(signals({ plannedAction: 0.2 })),
};

describe("decision rendering", () => {
  it("can reopen a session containing a decision recorded before signal review", () => {
    const recorded = {
      ...details,
      decision: { continueWork: false, probability: 0.2, reason: "old decision" },
    } as unknown as DecisionDetails;
    expect(() => decisionText(recorded, true)).not.toThrow();
  });
  it("keeps all input text in the expanded view but not the summary", () => {
    const expanded = decisionText(details, true);
    const collapsed = decisionText(details, false);
    for (const input of [details.user, details.activity, details.reply]) {
      expect(expanded).toContain(input);
      expect(collapsed).not.toContain(input);
    }
    expect(expanded).toContain(String(details.threshold));
    for (const probability of Object.values(details.decision.signals)) {
      expect(expanded).toContain(String(probability));
    }
    expect(expanded).toContain(details.decision.reason);
  });

  it("includes the actual continuation instruction only when present", () => {
    const instruction = "instruction-unique";
    const continued = {
      ...details,
      decision: decideStop(signals({ plannedAction: 0.9 })),
      instruction,
    };
    expect(decisionText(continued, true)).toContain(instruction);
    expect(decisionText(continued, false)).not.toContain(instruction);
    expect(decisionText(details, true)).not.toContain(instruction);
    expect(decisionText(continued, false)).not.toBe(decisionText(details, false));
    expect(decisionText({ ...continued, instruction: undefined }, false)).not.toBe(
      decisionText(continued, false),
    );
  });
});
