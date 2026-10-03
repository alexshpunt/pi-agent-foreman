import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assistantMessage,
  getProviderRequestLastMessageText,
  PiIntegrationTest,
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
    questions: { promise: { type: "noul" } },
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

it("does not continue an unfinished answer without a promise", async () => {
  const cwd = await workspace();
  const reply = "Only one file is updated. I am confident it is correct.";
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
    questions: { promise: { type: "noul" } },
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
