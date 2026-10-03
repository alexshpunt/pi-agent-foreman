import type { StopVerdict } from "../src/classifier.ts";

/** Build a complete classifier verdict for behavior tests. */
export function signals(overrides: Partial<StopVerdict> = {}): StopVerdict {
  return {
    plannedAction: 0.05,
    blocker: 0.05,
    permission: 0.05,
    unfinished: 0.05,
    deferred: 0.05,
    explicitStop: 0.05,
    ...overrides,
  };
}
