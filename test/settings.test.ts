import { describe, expect, it } from "vitest";
import { parseSettings } from "../src/settings.ts";

describe("parseSettings", () => {
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
});
