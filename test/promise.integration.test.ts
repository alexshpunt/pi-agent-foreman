import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assistantMessage,
  getProviderRequestLastMessageText,
  PiIntegrationTest,
  PiRun,
  testArtifactsDir,
  text,
} from "pi-coding-agent-test";
import { afterEach, expect, it } from "vitest";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspace() {
  const root = resolve(".tmp/workspaces");
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(`${root}/promise-`);
  workspaces.push(path);
  return path;
}

const extensions = [resolve("src/index.ts"), resolve("test/fixtures/promise-judge.ts")];

it.each([
  {
    name: "implicit-next-action",
    reply: "Already configured. Next — install dependencies.",
    verdict: { plannedAction: 0.7 },
    continues: true,
  },
  {
    name: "unfinished-without-promise",
    reply: "No. The cause is known, but the duplicate is not fixed.",
    verdict: { unfinished: 0.97 },
    continues: true,
  },
  {
    name: "permission-veto",
    reply: "Next — upgrade Node. Confirm before I begin.",
    verdict: { plannedAction: 0.9, permission: 0.97 },
    continues: false,
  },
  {
    name: "blocker-veto",
    reply: "Next — transfer sources. SSH is unavailable.",
    verdict: { plannedAction: 0.9, unfinished: 0.95, blocker: 0.97 },
    continues: false,
  },
  {
    name: "deferred-veto",
    reply: "I will transfer the sources next week.",
    verdict: { plannedAction: 0.9, deferred: 0.93 },
    continues: false,
  },
  {
    name: "stop-veto",
    reply: "I did not transfer the sources. I will not continue.",
    verdict: { unfinished: 0.96, explicitStop: 0.93 },
    continues: false,
  },
])(
  "handles $name through the real classifier runtime and continuation",
  async ({ name, reply, verdict, continues }) => {
    const cwd = await workspace();
    const instruction = "Carry out the identified work now.";
    const result = await new PiIntegrationTest({
      testName: name,
      artifactsDir: testArtifactsDir(import.meta.filename),
      cwd,
      extensions,
      rawMode: false,
      tools: [],
      isolateUserResources: true,
      environment: {
        TYPESAFE_API_KEY: "test-key",
        FOREMAN_TEST_SIGNALS: JSON.stringify(verdict),
        FOREMAN_TEST_INSTRUCTION: instruction,
      },
      conversation: [
        assistantMessage([text(reply)]),
        ...(continues ? [assistantMessage([text("The run is complete.")])] : []),
      ],
    }).run("Finish the requested work.");
    expect(result.providerRequests).toHaveLength(continues ? 2 : 1);
    const savedRun = await PiRun.open(result.artifacts.directory);
    if (!savedRun.session) throw new Error("Pi did not persist the session");
    const entries = savedRun.session
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const continuations = entries.filter(
      (entry) => entry.type === "custom_message" && entry.customType === "agent-foreman-continued",
    );
    expect(continuations).toHaveLength(continues ? 1 : 0);
    if (continues) {
      const continuation = result.providerRequests[1];
      if (!continuation) throw new Error("Pi did not request a continuation");
      expect(getProviderRequestLastMessageText(continuation)).toBe(instruction);
      expect(result.tuiRenderedOutput).toContain("Foreman sent the agent back to work");
    } else {
      await expect(readFile(resolve(cwd, "writer-inputs.jsonl"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(result.tuiRenderedOutput).toContain("Foreman decided not to intervene");
    }
  },
  60_000,
);

it("drops Foreman's stale instruction when another settled continuation starts", async () => {
  const cwd = await workspace();
  const result = await new PiIntegrationTest({
    testName: "competing-settled-continuation",
    artifactsDir: testArtifactsDir(import.meta.filename),
    cwd,
    extensions: [...extensions, resolve("test/fixtures/settled-continuation.ts")],
    rawMode: false,
    tools: [],
    isolateUserResources: true,
    environment: { TYPESAFE_API_KEY: "test-key" },
    conversation: [
      assistantMessage([text("Continuing the run.")]),
      assistantMessage([text("The run is complete.")]),
    ],
  }).run("Finish the existing run.");
  expect(result.providerRequests).toHaveLength(2);
  const continuation = result.providerRequests[1];
  if (!continuation) throw new Error("Pi did not resume the run");
  expect(getProviderRequestLastMessageText(continuation)).toBe("Resume the existing run.");
  expect(
    result.messages.some(
      (value) => (value as { customType?: string }).customType === "agent-foreman-continued",
    ),
  ).toBe(false);
  expect(result.tuiRenderedOutput).not.toContain("Agent is already processing a prompt");
  expect(result.tuiRenderedOutput).not.toContain("Foreman sent the agent back to work");
}, 60_000);

it("turns a final promise into a nested instruction and one real Pi continuation", async () => {
  const cwd = await workspace();
  const result = await new PiIntegrationTest({
    testName: "promise-continuation",
    artifactsDir: testArtifactsDir(import.meta.filename),
    cwd,
    extensions,
    rawMode: false,
    tools: [],
    isolateUserResources: true,
    environment: { TYPESAFE_API_KEY: "test-key" },
    conversation: [
      assistantMessage([text("Continuing the run.")]),
      assistantMessage([text("The run is complete.")]),
    ],
  }).run("Why did you disable retries?");
  const states = (await readFile(resolve(cwd, "judge-inputs.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(states).toEqual([{ reply: "Continuing the run." }, { reply: "The run is complete." }]);
  const requests = (await readFile(resolve(cwd, "judge-requests.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(requests[0]).toMatchObject({
    model: "jev-latest",
    questions: {
      plannedAction: { type: "noul" },
      unfinished: { type: "noul" },
      blocker: { type: "noul" },
      permission: { type: "noul" },
      deferred: { type: "noul" },
      explicitStop: { type: "noul" },
    },
  });
  const writerRequests = (await readFile(resolve(cwd, "writer-inputs.jsonl"), "utf8"))
    .trim()
    .split("\n");
  expect(writerRequests).toHaveLength(2);
  const continuation = result.providerRequests[1];
  if (!continuation) throw new Error("Pi did not request a continuation");
  expect(getProviderRequestLastMessageText(continuation)).toBe("Start the promised run now.");
  expect(result.providerRequests).toHaveLength(2);
  expect(result.tuiRenderedOutput).toContain("Foreman sent the agent back to work");
}, 60_000);

it("does not continue a completed answer without a next action", async () => {
  const cwd = await workspace();
  const reply = "All three files are updated. The checks passed.";
  const result = await new PiIntegrationTest({
    testName: "no-promise-no-continuation",
    artifactsDir: testArtifactsDir(import.meta.filename),
    cwd,
    extensions,
    rawMode: false,
    tools: [],
    isolateUserResources: true,
    environment: {
      OPENROUTER_API_KEY: "test-key",
      FOREMAN_TEST_CLASSIFIER: "openrouter/typesafe/jev-1.13",
    },
    conversation: [assistantMessage([text(reply)])],
  }).run("Update three files.");
  expect(result.providerRequests).toHaveLength(1);
  const request = JSON.parse((await readFile(resolve(cwd, "judge-requests.jsonl"), "utf8")).trim());
  expect(request).toMatchObject({
    model: "typesafe/jev-1.13",
    questions: {
      plannedAction: { type: "noul" },
      unfinished: { type: "noul" },
      blocker: { type: "noul" },
      permission: { type: "noul" },
      deferred: { type: "noul" },
      explicitStop: { type: "noul" },
    },
  });
  expect(result.tuiRenderedOutput).toContain("Foreman decided not to intervene");
  await expect(readFile(resolve(cwd, "writer-inputs.jsonl"), "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(JSON.parse((await readFile(resolve(cwd, "judge-inputs.jsonl"), "utf8")).trim())).toEqual({
    reply,
  });
  expect(
    result.messages.some(
      (value) => (value as { customType?: string }).customType === "agent-foreman-continued",
    ),
  ).toBe(false);
}, 60_000);
