import { describe, expect, it, vi } from "vitest";
import { resolveForemanModel } from "../src/models.ts";

describe("resolveForemanModel", () => {
  it("resolves only the exact configured provider/model", () => {
    const model = { provider: "p", id: "m" };
    const find = vi.fn(() => model);
    expect(resolveForemanModel("p/m", { find })).toBe(model);
    expect(find).toHaveBeenCalledWith("p", "m");
  });

  it("does not fall back for missing or malformed settings", () => {
    const find = vi.fn();
    expect(resolveForemanModel(undefined, { find })).toBeUndefined();
    expect(resolveForemanModel("model-only", { find })).toBeUndefined();
    expect(find).not.toHaveBeenCalled();
  });
});
