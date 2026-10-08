import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), enabled: true }));
vi.mock("../src/classifier.ts", async (original) => ({
  ...(await original<typeof import("../src/classifier.ts")>()),
  createClassifierJudge: vi.fn(),
  createClassifierRunner: () => ({ run: mocks.run }),
}));
vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-coding-agent")>()),
  SettingsManager: {
    create: () => ({ getGlobalSettings: () => ({ agentForeman: { enabled: mocks.enabled } }) }),
  },
}));

import agentForeman from "../src/index.ts";

function harness(
  content: unknown = [{ type: "text", text: "I will do it now" }],
  stopReason = "stop",
  errorMessage?: string,
) {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const sendMessage = vi.fn();
  let idle = true;
  const ctx = {
    isIdle: () => idle,
    cwd: process.cwd(),
    modelRegistry: { find: () => undefined },
    sessionManager: {
      getBranch: () => [
        { type: "message", message: { role: "user", content: "Do the work" } },
        {
          type: "message",
          message: { role: "assistant", content, stopReason, errorMessage },
        },
      ],
    },
  } as unknown as ExtensionContext;
  agentForeman({
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
      handlers.set(name, handler),
    registerEntryRenderer: vi.fn(),
    registerMessageRenderer: vi.fn(),
    registerCommand: vi.fn(),
    sendMessage,
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI);
  return {
    sendMessage,
    busy: () => {
      idle = false;
    },
    emit: (name: string) => handlers.get(name)?.({}, ctx),
  };
}

it.each([
  { content: [], stopReason: "stop" },
  { content: [{ type: "text", text: " \n\t" }], stopReason: "stop" },
  { content: [{ type: "thinking", thinking: "private" }], stopReason: "stop" },
  { content: [], stopReason: "error" },
])("continues an empty $stopReason reply without the judge", async ({ content, stopReason }) => {
  const app = harness(content, stopReason);
  app.emit("agent_settled");
  app.emit("agent_settled");
  await vi.runAllTimersAsync();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(app.sendMessage).toHaveBeenCalledOnce();
  expect(app.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ content: ".", display: true }),
    { triggerTurn: true },
  );
});

it.each(["agent_start", "session_shutdown"])(
  "discards an empty reply continuation after %s",
  async (event) => {
    const app = harness([]);
    app.emit("agent_settled");
    app.emit(event);
    await vi.runAllTimersAsync();
    expect(app.sendMessage).not.toHaveBeenCalled();
  },
);

it.each([{ content: [] }, { content: [{ type: "text", text: "Continuing the run." }] }])(
  "does not judge or continue a cancellation recorded as an error: $content",
  async ({ content }) => {
    const app = harness(content, "error", "This operation was aborted");
    app.emit("agent_settled");
    await vi.runAllTimersAsync();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(app.sendMessage).not.toHaveBeenCalled();
  },
);

it("still continues an empty provider error", async () => {
  const app = harness([], "error", "Service unavailable");
  app.emit("agent_settled");
  await vi.runAllTimersAsync();
  expect(app.sendMessage).toHaveBeenCalledOnce();
});

it("does not continue an empty aborted reply", async () => {
  const app = harness([], "aborted");
  app.emit("agent_settled");
  await vi.runAllTimersAsync();
  expect(app.sendMessage).not.toHaveBeenCalled();
});

it("does not continue an empty reply while disabled", async () => {
  mocks.enabled = false;
  const app = harness([]);
  app.emit("agent_settled");
  await vi.runAllTimersAsync();
  expect(app.sendMessage).not.toHaveBeenCalled();
});

it("does not continue an empty reply when another run is busy", async () => {
  const app = harness([]);
  app.emit("agent_settled");
  app.busy();
  await vi.runAllTimersAsync();
  expect(app.sendMessage).not.toHaveBeenCalled();
});
beforeEach(() => {
  vi.useFakeTimers();
  mocks.enabled = true;
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.run.mockReset();
});

it("does not hold settled dispatch open while judging", async () => {
  mocks.run.mockReturnValue(new Promise(() => {}));
  const app = harness();
  expect(app.emit("agent_settled")).toBeUndefined();
  app.emit("session_shutdown");
});

it.each(["agent_start", "session_shutdown"])("discards the instruction after %s", async (event) => {
  let finish!: (value: string) => void;
  mocks.run.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const app = harness();
  app.emit("agent_settled");
  app.emit(event);
  finish("Continue work");
  await vi.runAllTimersAsync();
  expect(app.sendMessage).not.toHaveBeenCalled();
});

it("discards the instruction when the session is no longer idle", async () => {
  let finish!: (value: string) => void;
  mocks.run.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const app = harness();
  app.emit("agent_settled");
  app.busy();
  finish("Continue work");
  await vi.runAllTimersAsync();
  expect(app.sendMessage).not.toHaveBeenCalled();
});

it("can review the new run while the cancelled judge is still finishing", async () => {
  let finishOld!: (value: string) => void;
  mocks.run.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finishOld = resolve;
    }),
  );
  mocks.run.mockResolvedValueOnce("Review the new run");
  const app = harness();
  app.emit("agent_settled");
  app.emit("agent_start");
  app.emit("agent_settled");
  finishOld("Stale instruction");
  await vi.runAllTimersAsync();
  expect(app.sendMessage).toHaveBeenCalledOnce();
  expect(app.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ content: "Review the new run" }),
    { triggerTurn: true },
  );
});

it("delivers the instruction when no continuation started", async () => {
  mocks.run.mockResolvedValue("Continue work");
  const app = harness();
  app.emit("agent_settled");
  await vi.runAllTimersAsync();
  expect(app.sendMessage).toHaveBeenCalledOnce();
  expect(app.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ content: "Continue work" }),
    { triggerTurn: true },
  );
});
