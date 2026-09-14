import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { FOREMAN_SYSTEM_PROMPT } from "./runner.ts";

export type ForemanPromptMode = "append" | "override";

export interface ResolvedForemanPrompt {
  prompt: string;
  source?: string;
  warning?: string;
}

function configuredDirectory(directory: string): boolean {
  return existsSync(join(directory, "prompt.md")) || existsSync(join(directory, "config.json"));
}

function readConfiguredPrompt(directory: string): ResolvedForemanPrompt {
  const promptPath = join(directory, "prompt.md");
  const configPath = join(directory, "config.json");
  try {
    if (!existsSync(promptPath)) throw new Error(`Missing ${promptPath}`);
    const customPrompt = readFileSync(promptPath, "utf8").trim();
    if (!customPrompt) throw new Error(`${promptPath} is empty`);

    let mode: ForemanPromptMode = "override";
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
      if (typeof config !== "object" || config === null || Array.isArray(config)) {
        throw new Error(`${configPath} must contain a JSON object`);
      }
      const configuredMode = (config as { mode?: unknown }).mode;
      if (
        configuredMode !== undefined &&
        configuredMode !== "append" &&
        configuredMode !== "override"
      ) {
        throw new Error(`${configPath} mode must be "append" or "override"`);
      }
      if (configuredMode) mode = configuredMode;
    }

    return {
      prompt: mode === "append" ? `${FOREMAN_SYSTEM_PROMPT}\n\n${customPrompt}` : customPrompt,
      source: promptPath,
    };
  } catch (error) {
    return {
      prompt: FOREMAN_SYSTEM_PROMPT,
      warning: `Agent Foreman ignored custom prompt (${promptPath}, ${configPath}): ${String(error)}`,
    };
  }
}

/** Resolve the project or global Foreman prompt. Trusted project configuration wins. */
export function resolveForemanPrompt(options: {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
}): ResolvedForemanPrompt {
  const projectDirectory = join(options.cwd, CONFIG_DIR_NAME, "agent-foreman");
  if (options.projectTrusted && configuredDirectory(projectDirectory)) {
    return readConfiguredPrompt(projectDirectory);
  }

  const globalDirectory = join(options.agentDir, "agent-foreman");
  if (configuredDirectory(globalDirectory)) return readConfiguredPrompt(globalDirectory);

  return { prompt: FOREMAN_SYSTEM_PROMPT };
}
