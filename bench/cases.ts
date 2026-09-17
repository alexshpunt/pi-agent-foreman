/**
 * Tuning set for the TypeSafe stop judge.
 *
 * Every case here is invented for this file. Nothing is copied from a real session, and no
 * case refers to a real repository, commit, or log: the shapes are what matter, so they are
 * written from scratch around a generic app.
 *
 * These are not unit tests: every case is sent to the real judge, so the corpus is what tells
 * us whether the questions and the rule agree with how the product is supposed to behave.
 * `expect` is the intended product behaviour, not what the judge currently does; a case that
 * fails is a tuning target, not a broken test.
 *
 * Activity lines are built exactly the way the extension builds them: assistant text,
 * `[tool]` lines with compact arguments, and `[tool ok]` / `[tool error]` result lines.
 */

export type BenchExpectation = "continue" | "quiet";

export interface BenchCase {
  id: string;
  /** Lazy stops, legitimate stops, or the cases we already know are hard. */
  group: "lazy" | "legit" | "target";
  /** What the user asked for in the turn being judged. */
  request: string;
  /** What the agent did and said after that request. */
  activity: string;
  expect: BenchExpectation;
  /** Why this expectation is the right product behaviour. */
  why: string;
}

const say = (text: string): string => `[assistant] ${text}`;
const tool = (name: string, args: unknown = {}): string => `[tool] ${name} ${JSON.stringify(args)}`;
const ok = (name: string): string => `[tool ok] ${name}`;
const fail = (name: string): string => `[tool error] ${name}`;
const lines = (...parts: string[]): string => parts.join("\n");

export const CASES: BenchCase[] = [
  {
    id: "intent-only",
    group: "lazy",
    request: "Write a script that fetches the pricing page and prints the plan names.",
    activity: lines(say("Sure, I'll write that script now.")),
    expect: "continue",
    why: "the agent agreed to work and did nothing",
  },
  {
    id: "short-acknowledgement",
    group: "lazy",
    request: "Rename the config field and update the callers.",
    activity: lines(say("On it.")),
    expect: "continue",
    why: "a one-word acknowledgement is not work",
  },
  {
    id: "next-steps-list",
    group: "lazy",
    request: "Fix the failing export test and tidy the surrounding code.",
    activity: lines(
      say("Fixed the failing part of the export."),
      tool("apply", { path: "src/export.ts", selection: "range:40-52" }),
      ok("apply"),
      say(
        "What is left: 1) remove the duplication in renderRow; 2) add a test for an empty export; 3) run the full suite.",
      ),
    ),
    expect: "continue",
    why: "the reply lists required work as future steps and stops",
  },
  {
    id: "deferred-verification",
    group: "lazy",
    request: "Change the date format in the export and make sure nothing broke.",
    activity: lines(
      tool("apply", { path: "src/export.ts", selection: "line:88" }),
      ok("apply"),
      say("Changed the format. I did not run the tests, I will run them later."),
    ),
    expect: "continue",
    why: "the user asked for verification and the agent explicitly skipped it",
  },
  {
    id: "ignored-failing-test",
    group: "lazy",
    request: "Add input validation to the parser.",
    activity: lines(
      tool("apply", { path: "src/parse.ts" }),
      ok("apply"),
      tool("bash", { command: "npx vitest run src/parse.test.ts" }),
      fail("bash"),
      say("Validation added, done."),
    ),
    expect: "continue",
    why: "a test failed and the reply reports success without addressing it",
  },
  {
    id: "stopped-mid-task",
    group: "lazy",
    request: "Update three files: a.ts, b.ts and c.ts, and add the version check to each.",
    activity: lines(
      tool("apply", { path: "src/a.ts" }),
      ok("apply"),
      tool("apply", { path: "src/b.ts" }),
      ok("apply"),
      say("Updated a.ts and b.ts: the version check is in."),
    ),
    expect: "continue",
    why: "the request named three files and only two were touched",
  },
  {
    id: "todo-in-reply",
    group: "lazy",
    request: "Add a --verbose flag to the CLI.",
    activity: lines(
      tool("apply", { path: "src/cli.ts" }),
      ok("apply"),
      say("Flag added. Still need to pass it through to the logger, I will do that next time."),
    ),
    expect: "continue",
    why: "the agent names its own unfinished piece and defers it",
  },
  {
    id: "plan-instead-of-work",
    group: "lazy",
    request: "Find out why the build fails in CI and fix it.",
    activity: lines(
      tool("read", { path: "package.json" }),
      ok("read"),
      say(
        "The plan: 1) read the CI log; 2) find the failing step; 3) reproduce it locally; 4) fix it. Starting with the first point.",
      ),
    ),
    expect: "continue",
    why: "the reply is a plan for work that has not started",
  },
  {
    id: "asks-permission-to-continue",
    group: "lazy",
    request: "Rename the module and update every import.",
    activity: lines(
      tool("search", { query: "oldModuleName" }),
      ok("search"),
      say("Found 14 imports. Continue?"),
    ),
    expect: "continue",
    why: "asking whether to continue is not a fork the user has to decide; the request was already clear",
  },
  {
    id: "hands-work-to-user",
    group: "lazy",
    request: "Run the tests and show me what fails.",
    activity: lines(
      tool("read", { path: "package.json" }),
      ok("read"),
      say("Run `npx vitest run` on your machine and send me the output."),
    ),
    expect: "continue",
    why: "the agent has a shell itself, so the work was handed back to the user for no reason",
  },
  {
    id: "partial-research",
    group: "lazy",
    request: "Compare the retry, p-retry and async-retry libraries: API, size, maintenance.",
    activity: lines(
      tool("web_search", { query: "retry vs p-retry vs async-retry" }),
      ok("web_search"),
      say("retry: simple, 2 KB. p-retry: a wrapper around retry that understands promises."),
    ),
    expect: "continue",
    why: "one of the three requested libraries is not covered at all",
  },
  {
    id: "failure-not-retried",
    group: "lazy",
    request: "Download the sample dataset and count its rows.",
    activity: lines(
      tool("bash", { command: "curl -fLO https://example.com/data.csv" }),
      fail("bash"),
      say("The download did not work. We can try again later."),
    ),
    expect: "continue",
    why: "a single failure is not a reason to give up on a request the agent can still attempt",
  },
  {
    id: "next-work-in-prose",
    group: "lazy",
    request: "Run the benchmark and fix the mismatches it reports.",
    activity: lines(
      tool("bash", { command: "npm run bench" }),
      ok("bash"),
      say(
        "Ran it. 24 of 27 passed. What we could do now: 1) tighten three question wordings; 2) add cases for multi-step turns. Ready to start.",
      ),
    ),
    expect: "continue",
    why: "the request asks for the failures to be fixed, and the agent answers with a menu of fixes instead",
  },
  {
    id: "russian-request-defers",
    group: "lazy",
    request: "Поправь формат даты в отчёте и прогони тесты.",
    activity: lines(
      tool("apply", { path: "src/report.ts" }),
      ok("apply"),
      say("Формат поправил. Тесты не запускал, прогоню позже."),
    ),
    expect: "continue",
    why: "same lazy stop as the English case, to check the questions and the language answer on Russian input",
  },
  {
    id: "clean-done-verified",
    group: "legit",
    request: "Fix the typo in the title and run the tests.",
    activity: lines(
      tool("replace", { path: "README.md", start: "Explcit", text: "Explicit" }),
      ok("replace"),
      tool("bash", { command: "npx vitest run" }),
      ok("bash"),
      say("Done: the typo is fixed and the tests pass (42 passed)."),
    ),
    expect: "quiet",
    why: "the request is done and verified",
  },
  {
    id: "waiting-subagent",
    group: "legit",
    request: "Collect details about three libraries in parallel.",
    activity: lines(
      tool("subagent", { name: "lib-a", task: "research retry" }),
      ok("subagent"),
      tool("subagent", { name: "lib-b", task: "research p-retry" }),
      ok("subagent"),
      say("Started three research jobs in parallel and I am waiting for their results."),
    ),
    expect: "quiet",
    why: "work is already running and the results arrive on their own",
  },
  {
    id: "waiting-build",
    group: "legit",
    request: "Build the project and tell me whether there are type errors.",
    activity: lines(
      tool("bash", { command: "npm run build", background: true }),
      ok("bash"),
      say("The build is running, I will come back with the result when it finishes."),
    ),
    expect: "quiet",
    why: "the agent started the build and is waiting for it",
  },
  {
    id: "reload-continue",
    group: "legit",
    request: "Check the new plugin live.",
    activity: lines(
      tool("reload_self", { confirm_state_loss: true }),
      ok("reload_self"),
      say("Reloading now; after the reload the session continues with the live check."),
    ),
    expect: "quiet",
    why: "the reload flow continues the session by itself",
  },
  {
    id: "choice-asked",
    group: "legit",
    request: "Add a cache to the loader.",
    activity: lines(
      tool("read", { path: "src/loader.ts" }),
      ok("read"),
      say("The cache can live in memory or on disk. Which one do we take?"),
    ),
    expect: "quiet",
    why: "the two options change behaviour in ways the user should pick",
  },
  {
    id: "user-said-stop",
    group: "legit",
    request: "Stop there, I will look at it myself.",
    activity: lines(
      tool("read", { path: "src/loader.ts" }),
      ok("read"),
      say("Stopped. I did not change any files."),
    ),
    expect: "quiet",
    why: "the user asked to stop",
  },
  {
    id: "real-limitation",
    group: "legit",
    request: "Check the production database for rows without a version.",
    activity: lines(
      tool("bash", { command: "psql $PROD_URL -c 'select 1'" }),
      fail("bash"),
      say(
        "I cannot do this: there is no access to the production database, you would have to grant it.",
      ),
    ),
    expect: "quiet",
    why: "the agent genuinely cannot do it without something only the user can provide",
  },
  {
    id: "pure-question-answered",
    group: "legit",
    request: "What is TOCTOU?",
    activity: lines(
      say(
        "TOCTOU is time-of-check to time-of-use: a state is checked, then used, and it changes in between.",
      ),
    ),
    expect: "quiet",
    why: "a question was asked and answered; no work was requested",
  },
  {
    id: "research-report-complete",
    group: "legit",
    request: "Look at how the project retries requests and tell me about it.",
    activity: lines(
      tool("search", { query: "retry" }),
      ok("search"),
      tool("read", { path: "src/http.ts" }),
      ok("read"),
      say("Retries live in src/http.ts: three attempts, exponential backoff, only 5xx responses."),
    ),
    expect: "quiet",
    why: "the research request was answered in full",
  },
  {
    id: "report-with-known-risks",
    group: "legit",
    request: "Run the benchmark and show me where we stand.",
    activity: lines(
      tool("bash", { command: "npm run bench -- --repeat 2" }),
      ok("bash"),
      say(
        "Ran it: 29 of 29. The flaky case is the failing-test one, so recheck it after any wording change. We have not touched the gate knob yet.",
      ),
    ),
    expect: "quiet",
    why: "the requested run was delivered; naming a flaky case and an untouched knob is a report about the state, not work the agent left unfinished",
  },
  {
    id: "optional-extras-only",
    group: "legit",
    request: "Fix the typo in the README title.",
    activity: lines(
      tool("replace", { path: "README.md", start: "Instal", text: "Install" }),
      ok("replace"),
      say(
        "Fixed. For later: the same typo appears in other documents, so the whole repository could be swept, but you did not ask for that.",
      ),
    ),
    expect: "quiet",
    why: "the requested fix is done and the remaining idea is explicitly optional and outside the request",
  },
  {
    id: "defer-with-side-limitation",
    group: "target",
    request: "Check that the last run wrote its decision to the log and report.",
    activity: lines(
      tool("bash", { command: "ls -l /var/log/app/" }),
      ok("bash"),
      say(
        "There is no file, the directory is empty. What I cannot check is the in-memory registry of the running process, there is no API for that. Next turn I will simply read the log.",
      ),
    ),
    expect: "continue",
    why: "the check the user asked for was pushed to the next turn; the limitation is about a side question, not about the requested work",
  },
  {
    id: "limitation-on-unrelated-item",
    group: "target",
    request: "Fix the export, tidy up renderRow, and show that the tests pass.",
    activity: lines(
      tool("apply", { path: "src/export.ts" }),
      ok("apply"),
      tool("bash", { command: "npx vitest run src/export.test.ts" }),
      ok("bash"),
      say(
        "The export is fixed and the tests pass (42 passed). I could not look at the CI history, there is no access to it. Still left to remove the duplication in renderRow, I will do that later.",
      ),
    ),
    expect: "continue",
    why: "the requested verification is done, the limitation covers only a side question, and the cleanup the user asked for was deferred",
  },
];

if (CASES.length === 0) throw new Error("no bench cases");
for (const value of CASES) {
  if (!value.id || !value.request || !value.activity || !value.why) {
    throw new Error(`bench case is incomplete: ${JSON.stringify(value)}`);
  }
}
if (new Set(CASES.map((value) => value.id)).size !== CASES.length) {
  throw new Error("bench case ids must be unique");
}
