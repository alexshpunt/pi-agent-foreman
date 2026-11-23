import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const manual = "Run node .githooks/format-staged.mjs from your pre-commit hook.";

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function install() {
  // In particular, don't install into an unrelated parent checkout.
  if (!existsSync(".git") || process.env.NODE_ENV === "production") return;

  const configuredPath = git("config", "--get", "core.hooksPath");
  if (configuredPath.status === 0) {
    console.warn(`Custom core.hooksPath set. ${manual}`);
    return;
  }
  if (configuredPath.status !== 1) throw new Error(configuredPath.stderr.trimEnd());

  const result = git("rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-commit");
  if (result.status !== 0) throw new Error(result.stderr.trimEnd());

  const destination = result.stdout.slice(0, -1);
  // A shell hook needs LF even when the checkout uses core.autocrlf.
  const hook = Buffer.from(
    readFileSync(new URL("./pre-commit", import.meta.url), "utf8").replaceAll("\r\n", "\n"),
  );
  mkdirSync(dirname(destination), { recursive: true });
  try {
    writeFileSync(destination, hook, { flag: "wx", mode: 0o755 });
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  if (!lstatSync(destination).isFile() || !readFileSync(destination).equals(hook)) {
    console.warn(`Existing pre-commit hook left unchanged. ${manual}`);
  }
}

install();
