/**
 * Run the tuning set against the real TypeSafe judge.
 *
 * This is a tuning tool, not a test suite: it costs API calls, so it is not part of `npm test`.
 * Every case sends one request to TypeSafe and compares the decision with the intended product
 * behaviour in bench/cases.ts. A failing case is a tuning target; the summary says how many.
 *
 * Usage:
 *   npm run bench                          all cases, one run each
 *   npm run bench -- --repeat 3            three runs per case, to see how stable it is
 *   npm run bench -- --group lazy,target   only some groups
 *   npm run bench -- --case intent-only-ru --repeat 5
 *   npm run bench -- --threshold 0.4       move the work-remains threshold
 *   npm run bench -- --gate 0.6            move the gate threshold
 *   npm run bench -- --model jev-latest    pin the TypeSafe model
 *
 * The full run is written to bench/.results/last.json. Exit code is 1 when any case fails.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LEGITIMATE_STOP_REASONS } from "../src/policy.ts";
import {
  createTypeSafeJudge,
  DEFAULT_THRESHOLDS,
  decideStop,
  type StopThresholds,
  type StopVerdict,
  TypeSafeNotConfiguredError,
} from "../src/typesafe.ts";
import { type BenchCase, type BenchExpectation, CASES } from "./cases.ts";

const RESULTS_PATH = join("bench", ".results", "last.json");
/** Short column label for a gate id: the initials of its words. */
const gateLabel = (id: string): string =>
  id
    .split("_")
    .map((word) => word[0] ?? "")
    .join("")
    .padEnd(4);
const CONCURRENCY = 4;
/** A decision this close to a threshold is worth looking at again. */
const BORDERLINE_MARGIN = 0.1;

interface Options {
  repeat: number;
  thresholds: StopThresholds;
  groups?: Set<string>;
  ids?: Set<string>;
  model?: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { repeat: 1, thresholds: { ...DEFAULT_THRESHOLDS } };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--repeat":
        options.repeat = Math.max(1, Number(value));
        index += 1;
        break;
      case "--threshold":
        options.thresholds.workRemains = Number(value);
        index += 1;
        break;
      case "--gate":
        options.thresholds.gate = Number(value);
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
          [
            "npm run bench -- [options]",
            "",
            "  --repeat N          runs per case, for stability",
            "  --group a,b         lazy, legit, target",
            "  --case id,...       selected cases only",
            "  --threshold 0.5     minimum probability that required work is unfinished",
            "  --gate 0.5          threshold for the four signals that keep a stop",
            "  --model jev-latest  TypeSafe model",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
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
const judge = createTypeSafeJudge(options.model === undefined ? {} : { model: options.model });

let cursor = 0;
const runCase = async (testCase: BenchCase): Promise<CaseResult> => {
  const samples: Sample[] = [];
  for (let attempt = 0; attempt < options.repeat; attempt += 1) {
    const started = Date.now();
    const verdict = await judge({ request: testCase.request, activity: testCase.activity });
    const decision = decideStop(verdict, options.thresholds);
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
  if (error instanceof TypeSafeNotConfiguredError) {
    console.error(`bench: ${error.message}`);
    process.exit(2);
  }
  throw error;
}
results.sort((a, b) => selected.indexOf(a.testCase) - selected.indexOf(b.testCase));

/** Compact cell for one sample. */
const cell = (sample: Sample, expect: BenchExpectation): string =>
  `${sample.outcome === expect ? " " : "!"}${sample.outcome === "continue" ? "cont" : "quiet"}`;

const header = [
  "case".padEnd(26),
  "group".padEnd(6),
  "expect".padEnd(9),
  ...Array.from({ length: options.repeat }, (_, index) => `run${index + 1}`.padEnd(6)),
  "remains",
  "defers",
  ...LEGITIMATE_STOP_REASONS.map((reason) => gateLabel(reason.id)),
  "kind".padEnd(14),
  "lang",
].join(" ");
console.log(`\n${header}`);
console.log("-".repeat(header.length));

for (const result of results) {
  const first = result.samples[0] as Sample;
  const verdict = first.verdict;
  console.log(
    [
      result.testCase.id.padEnd(26),
      result.testCase.group.padEnd(6),
      result.testCase.expect.padEnd(9),
      ...result.samples.map((sample) => cell(sample, result.testCase.expect).padEnd(6)),
      verdict.workRemains.toFixed(2).padEnd(7),
      verdict.defersWork.toFixed(2).padEnd(6),
      ...LEGITIMATE_STOP_REASONS.map((reason) =>
        (verdict.gates[reason.id] ?? 0).toFixed(2).padEnd(4),
      ),
      verdict.remainingKind.padEnd(14),
      verdict.language,
    ].join(" "),
  );
}

const failures = results.filter((result) => !result.passed);
if (failures.length > 0) {
  console.log("\nMismatches:");
  for (const failure of failures) {
    const sample = failure.samples[0] as Sample;
    console.log(`\n  ${failure.testCase.id} (${failure.testCase.group})`);
    console.log(
      `    expected ${failure.testCase.expect}, got ${failure.samples.map((value) => value.outcome).join("/")}`,
    );
    console.log(`    why it should be ${failure.testCase.expect}: ${failure.testCase.why}`);
    console.log(`    rule said: ${sample.reason}`);
    console.log(
      `    numbers: remains ${sample.verdict.workRemains.toFixed(2)} · defers ${sample.verdict.defersWork.toFixed(2)} · ${LEGITIMATE_STOP_REASONS.map((reason) => `${reason.id} ${(sample.verdict.gates[reason.id] ?? 0).toFixed(2)}`).join(" · ")} · language ${sample.verdict.language}`,
    );
  }
}

const groups = [...new Set(results.map((result) => result.testCase.group))];
console.log("\nSummary:");
for (const group of groups) {
  const inGroup = results.filter((result) => result.testCase.group === group);
  const passed = inGroup.filter((result) => result.passed).length;
  console.log(`  ${group.padEnd(7)} ${passed}/${inGroup.length} passed`);
}
console.log(
  `  total   ${results.length - failures.length}/${results.length} passed · ${results.length * options.repeat} judge calls · thresholds remains>=${options.thresholds.workRemains}, gate>=${options.thresholds.gate}`,
);
const unstable = results.filter(
  (result) => new Set(result.samples.map((sample) => sample.outcome)).size > 1,
);
if (unstable.length > 0) {
  console.log(`  unstable across runs: ${unstable.map((result) => result.testCase.id).join(", ")}`);
}

/** Cases whose deciding number sits close to a threshold, so a small change can flip them. */
const borderline = results.filter((result) =>
  result.samples.some((sample) => {
    const verdict = sample.verdict;
    const nearRemains =
      Math.abs(verdict.workRemains - options.thresholds.workRemains) <= BORDERLINE_MARGIN;
    const gates = LEGITIMATE_STOP_REASONS.map((reason) => verdict.gates[reason.id] ?? 0);
    return (
      nearRemains ||
      gates.some((value) => Math.abs(value - options.thresholds.gate) <= BORDERLINE_MARGIN)
    );
  }),
);
if (borderline.length > 0) {
  console.log(
    `  borderline (within ${BORDERLINE_MARGIN} of a threshold): ${borderline.map((result) => result.testCase.id).join(", ")}`,
  );
}

mkdirSync(dirname(RESULTS_PATH), { recursive: true });
writeFileSync(
  RESULTS_PATH,
  `${JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      options: {
        repeat: options.repeat,
        thresholds: options.thresholds,
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
console.log(`  results: ${RESULTS_PATH}`);
process.exitCode = failures.length > 0 ? 1 : 0;
