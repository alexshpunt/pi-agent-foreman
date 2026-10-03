import { describe, expect, it } from "vitest";
import { parseSettings } from "../src/settings.ts";

describe("parseSettings", () => {
  it("keeps classifier selection separate from the instruction model", () => {
    expect(
      parseSettings({ classifier: " openrouter/typesafe/jev-1.13 ", model: "p/writer" }),
    ).toMatchObject({
      classifier: "openrouter/typesafe/jev-1.13",
      model: "p/writer",
    });
    expect(parseSettings({ classifier: 42 }).classifier).toBeUndefined();
  });
  it("keeps only the enable toggle, selected model, and thinking level", () => {
    expect(
      parseSettings({
        enabled: false,
        model: " openai/gpt-5-mini ",
        thinking: "medium",
        vetoBudget: 9,
      }),
    ).toEqual({
      enabled: false,
      model: "openai/gpt-5-mini",
      thinking: "medium",
    });
  });

  it("defaults to enabled without choosing a model or thinking level", () => {
    expect(parseSettings(undefined)).toEqual({
      enabled: true,
      model: undefined,
      thinking: undefined,
    });
  });

  it("ignores an invalid thinking level", () => {
    expect(parseSettings({ thinking: "extreme" }).thinking).toBeUndefined();
  });

  it("keeps a threshold inside zero and one and drops anything else", () => {
    expect(parseSettings({ threshold: 0.7 }).threshold).toBe(0.7);
    expect(parseSettings({ threshold: 1.2 }).threshold).toBeUndefined();
    expect(parseSettings({ threshold: -0.2 }).threshold).toBeUndefined();
    expect(parseSettings({ threshold: "0.7" }).threshold).toBeUndefined();
  });
});
