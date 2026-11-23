import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Match the path scope of npm run lint. The staged biome.json controls exclusions.
const scope = ["src/", "test/", "bench/"];
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function git(args, options = {}) {
  const result = spawnSync("git", ["--no-optional-locks", "-c", "core.quotePath=true", ...args], {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.toString().trimEnd() || `git ${args[0]} failed`);
  }
  return result.stdout;
}

function records(output) {
  return decoder.decode(output).split("\0").slice(0, -1);
}

function stagedFiles() {
  // Treat renames as additions and deletions; only format regular files.
  const entries = records(
    git(["diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=AMT", "--", ...scope]),
  );
  return entries.filter(
    (_, index) => index % 2 === 1 && /^:\d+ 100(?:644|755) /.test(entries[index - 1]),
  );
}

function matchesWorktree(file, snapshot) {
  try {
    return lstatSync(file).isFile() && readFileSync(file).equals(readFileSync(join(snapshot, file)));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function format(snapshot, files) {
  const biome = fileURLToPath(import.meta.resolve("@biomejs/biome/bin/biome"));
  const dirs = scope.filter((dir) => files.some((file) => file.startsWith(dir)));
  const result = spawnSync(
    process.execPath,
    [
      biome,
      "format",
      "--write",
      "--no-errors-on-unmatched",
      "--files-ignore-unknown=true",
      "--config-path=.",
      ...dirs,
    ],
    { cwd: snapshot, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Biome could not format the staged snapshot");
}

function formattingPatch(snapshot, index) {
  return git(
    [
      `--work-tree=${snapshot}`,
      "-c",
      "core.filemode=false",
      "diff",
      "--diff-filter=M",
      "--binary",
      "--full-index",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-relative",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--",
      ...scope,
    ],
    { env: { ...process.env, GIT_INDEX_FILE: index } },
  );
}

function main() {
  const files = stagedFiles();
  if (files.length === 0) return;

  const config = records(git(["ls-files", "--stage", "-z", "--", "biome.json"]));
  if (config.length !== 1 || !/^100(?:644|755) [0-9a-f]+ 0\tbiome\.json$/.test(config[0])) {
    throw new Error("Expected a regular biome.json in the index");
  }

  // git commit -a can set a relative path to its temporary index.
  const index = git(["rev-parse", "--path-format=absolute", "--git-path", "index"])
    .toString()
    .slice(0, -1);
  const snapshot = mkdtempSync(join(tmpdir(), "foreman-format-staged-"));
  try {
    git(["checkout-index", `--prefix=${snapshot}/`, "--stdin", "-z"], {
      input: `${[...files, "biome.json"].join("\0")}\0`,
    });
    const unstaged = files.filter((file) => !matchesWorktree(file, snapshot));
    format(snapshot, files);

    const patch = formattingPatch(snapshot, index);
    if (patch.length === 0) return;

    // Never write formatting back to a partially staged working copy.
    for (const file of unstaged) rmSync(join(snapshot, file));
    const worktreePatch = unstaged.length === 0 ? patch : formattingPatch(snapshot, index);
    const apply = ["-c", "apply.ignoreWhitespace=no", "apply", "--whitespace=nowarn"];
    git([...apply, "--cached", "-"], { input: patch });
    if (worktreePatch.length > 0) {
      try {
        git([...apply, "-"], { input: worktreePatch });
      } catch (error) {
        console.warn(`Formatting staged; could not update working copies: ${error.message}`);
      }
    }
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`Could not format staged files: ${error.message}`);
  process.exitCode = 1;
}
