/* Run final replies against the real multi-signal judge. Costs API calls, so it is not CI. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  BLOCK_THRESHOLD,
  createClassifierJudge,
  DEFAULT_THRESHOLD,
  decideStop,
  REVIEW_QUESTIONS,
  type StopVerdict,
} from "../src/classifier.ts";
import { type BenchCase, type BenchExpectation, CASES } from "./cases.ts";

const RESULTS_PATH = join(".tmp", "bench", "last.json");
const CONCURRENCY = 4;
const BORDERLINE_MARGIN = 0.1;

interface Options {
  repeat: number;
  threshold: number;
  groups?: Set<string>;
  ids?: Set<string>;
  model?: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { repeat: 1, threshold: DEFAULT_THRESHOLD };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--repeat":
        options.repeat = Math.max(1, Number(value));
        index += 1;
        break;
      case "--threshold":
        options.threshold = Number(value);
        index += 1;
        break;
      case "--model":
        options.model = value;
        index += 1;
        break;
      case "--group":
        options.groups = new Set((value ?? "").split(",").filter(Boolean));
        index += 1;
        break;
      case "--case":
        options.ids = new Set((value ?? "").split(",").filter(Boolean));
        index += 1;
        break;
      case "--help":
        console.log(
          "npm run bench -- [--repeat N] [--threshold 0.7] [--group promise,quiet,target] [--case id,...] [--model typesafe/jev-latest]",
        );
        process.exit(0);
        break;
    }
  }
  if (!Number.isFinite(options.repeat)) options.repeat = 1;
  return options;
}

interface Sample {
  verdict: StopVerdict;
  outcome: BenchExpectation;
  reason: string;
  latencyMs: number;
}

interface CaseResult {
  testCase: BenchCase;
  samples: Sample[];
  passed: boolean;
}

const options = parseArgs(process.argv.slice(2));
const selected = CASES.filter(
  (testCase) =>
    (options.groups === undefined || options.groups.has(testCase.group)) &&
    (options.ids === undefined || options.ids.has(testCase.id)),
);
if (selected.length === 0) {
  console.error("no cases selected");
  process.exit(1);
}
const runtime = await ModelRuntime.create();
const judge = createClassifierJudge(new ModelRegistry(runtime), options.model);

let cursor = 0;
const runCase = async (testCase: BenchCase): Promise<CaseResult> => {
  const samples: Sample[] = [];
  for (let attempt = 0; attempt < options.repeat; attempt += 1) {
    const started = Date.now();
    const verdict = await judge({ reply: testCase.reply });
    const decision = decideStop(verdict, options.threshold);
    samples.push({
      verdict,
      outcome: decision.continueWork ? "continue" : "quiet",
      reason: decision.reason,
      latencyMs: Date.now() - started,
    });
  }
  return {
    testCase,
    samples,
    passed: samples.every((sample) => sample.outcome === testCase.expect),
  };
};

const workers = Array.from({ length: Math.min(CONCURRENCY, selected.length) }, async () => {
  const results: CaseResult[] = [];
  while (cursor < selected.length) {
    const testCase = selected[cursor] as BenchCase;
    cursor += 1;
    results.push(await runCase(testCase));
  }
  return results;
});

let results: CaseResult[];
try {
  results = (await Promise.all(workers)).flat();
} catch (error) {
  console.error(`bench: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
results.sort((a, b) => selected.indexOf(a.testCase) - selected.indexOf(b.testCase));

const cell = (sample: Sample, expected: BenchExpectation): string =>
  `${sample.outcome === expected ? " " : "!"}${sample.outcome === "continue" ? "cont" : "quiet"}`;
const header = [
  "case".padEnd(26),
  "group".padEnd(6),
  "expect".padEnd(9),
  ...Array.from({ length: options.repeat }, (_, index) => `run${index + 1}`.padEnd(6)),
  ...Object.keys(REVIEW_QUESTIONS),
].join(" ");
console.log(`\n${header}`);
console.log("-".repeat(header.length));
for (const result of results) {
  console.log(
    [
      result.testCase.id.padEnd(26),
      result.testCase.group.padEnd(6),
      result.testCase.expect.padEnd(9),
      ...result.samples.map((sample) => cell(sample, result.testCase.expect).padEnd(6)),
      ...Object.values((result.samples[0] as Sample).verdict).map((value) => value.toFixed(2)),
    ].join(" "),
  );
}

const failures = results.filter((result) => !result.passed);
for (const failure of failures) {
  console.log(`\n  ${failure.testCase.id}: ${failure.testCase.why}`);
  console.log(
    `    expected ${failure.testCase.expect}, got ${failure.samples.map((sample) => sample.outcome).join("/")}`,
  );
}
console.log(
  `\n${results.length - failures.length}/${results.length} passed · ${results.length * options.repeat} jev calls · threshold ${options.threshold}`,
);
const unstable = results.filter(
  (result) => new Set(result.samples.map((sample) => sample.outcome)).size > 1,
);
if (unstable.length > 0)
  console.log(`unstable: ${unstable.map((result) => result.testCase.id).join(", ")}`);
const borderline = results.filter((result) =>
  result.samples.some((sample) =>
    Object.entries(sample.verdict).some(
      ([key, value]) =>
        Math.abs(
          value -
            (key === "plannedAction" || key === "unfinished" ? options.threshold : BLOCK_THRESHOLD),
        ) <= BORDERLINE_MARGIN,
    ),
  ),
);
if (borderline.length > 0)
  console.log(`borderline: ${borderline.map((result) => result.testCase.id).join(", ")}`);

mkdirSync(dirname(RESULTS_PATH), { recursive: true });
writeFileSync(
  RESULTS_PATH,
  `${JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      options: {
        repeat: options.repeat,
        threshold: options.threshold,
        groups: options.groups === undefined ? null : [...options.groups],
        cases: options.ids === undefined ? null : [...options.ids],
        model: options.model ?? null,
      },
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`results: ${RESULTS_PATH}`);
process.exitCode = failures.length > 0 ? 1 : 0;
