import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveForemanPrompt } from "../src/prompt.ts";
import { FOREMAN_SYSTEM_PROMPT } from "../src/runner.ts";

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), "agent-foreman-"));
  roots.push(path);
  return path;
}

function writePrompt(directory: string, prompt: string, config?: unknown): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "prompt.md"), prompt);
  if (config !== undefined) {
    writeFileSync(join(directory, "config.json"), JSON.stringify(config));
  }
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("resolveForemanPrompt", () => {
  it("uses the trusted project prompt instead of the global prompt", () => {
    const base = root();
    const cwd = join(base, "project");
    const agentDir = join(base, "agent");
    writePrompt(join(agentDir, "agent-foreman"), "global");
    writePrompt(join(cwd, ".pi", "agent-foreman"), "project");

    expect(resolveForemanPrompt({ cwd, agentDir, projectTrusted: true })).toEqual({
      prompt: "project",
      source: join(cwd, ".pi", "agent-foreman", "prompt.md"),
    });
  });

  it("ignores an untrusted project prompt and appends the global prompt", () => {
    const base = root();
    const cwd = join(base, "project");
    const agentDir = join(base, "agent");
    writePrompt(join(cwd, ".pi", "agent-foreman"), "project");
    writePrompt(join(agentDir, "agent-foreman"), "global", { mode: "append" });

    expect(resolveForemanPrompt({ cwd, agentDir, projectTrusted: false })).toEqual({
      prompt: `${FOREMAN_SYSTEM_PROMPT}\n\nglobal`,
      source: join(agentDir, "agent-foreman", "prompt.md"),
    });
  });

  it("defaults a custom prompt to override mode", () => {
    const base = root();
    const agentDir = join(base, "agent");
    writePrompt(join(agentDir, "agent-foreman"), "custom");

    expect(resolveForemanPrompt({ cwd: base, agentDir, projectTrusted: false }).prompt).toBe(
      "custom",
    );
  });

  it("warns and falls back to the built-in prompt for invalid config", () => {
    const base = root();
    const directory = join(base, "agent", "agent-foreman");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "prompt.md"), "custom");
    writeFileSync(join(directory, "config.json"), "not json");

    const result = resolveForemanPrompt({
      cwd: base,
      agentDir: join(base, "agent"),
      projectTrusted: false,
    });
    expect(result.prompt).toBe(FOREMAN_SYSTEM_PROMPT);
    expect(result.warning).toContain("config.json");
  });
});
