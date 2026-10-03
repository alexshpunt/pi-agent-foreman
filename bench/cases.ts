/** Request-gate and final-reply cases for the real classifier, not CI tests. */
export type BenchExpectation = "continue" | "quiet";

export interface BenchCase {
  id: string;
  group: "promise" | "quiet" | "target";
  /** Latest user message, checked before the reply. */
  request: string;
  /** The entire final assistant reply, without user or tool context. */
  reply: string;
  expect: BenchExpectation;
  why: string;
}

const REPLY_CASES: Omit<BenchCase, "request">[] = [
  {
    id: "configured-next-install",
    group: "target",
    reply:
      "Already configured: I checked over SSH, and the test account has this rule:\n\n```text\n(ALL) NOPASSWD: ALL\n```\n\n`sudo -n true` succeeds without a password. **No changes are needed.** The `sudo` command is still required, but it no longer asks for a password, including during automated connections.\n\nNext — install the dependencies and upgrade the system Node.js to version 24, as you selected.",
    expect: "continue",
    why: "an implicit next action at the end of a completed setup report",
  },
  {
    id: "installed-next-transfer",
    group: "target",
    reply:
      "Installed and checked on the test machine:\n\n- Node.js 24 and npm 11;\n- Clang and clangd 18;\n- Bubblewrap 0.9.\n\nIsolation works without root: Node runs, and a small C++17 project builds and executes. Package integrity checks passed; both coding tools start.\n\nNo heavy runs were performed, and the laptop was not put under load. Next — transfer the working sources and run the benchmark checks on the test machine.",
    expect: "continue",
    why: "a long completed-work report still announces further work",
  },
  {
    id: "cause-found-not-fixed",
    group: "target",
    reply:
      "No. I found the cause, but have not fixed the duplicate yet. The latest commit changes context and rendering, not repeated delivery.",
    expect: "continue",
    why: "explicit unfinished work without an announced next action",
  },
  {
    id: "completed-fix",
    group: "quiet",
    reply: "Fixed the duplicate. Repeated delivery no longer occurs. The check passed.",
    expect: "quiet",
    why: "completed work with no announced next action",
  },
  {
    id: "unfinished-fix",
    group: "promise",
    reply: "I found the cause, but have not fixed the duplicate yet.",
    expect: "continue",
    why: "explicit unfinished work is a positive signal",
  },
  {
    id: "next-action-needs-permission",
    group: "quiet",
    reply:
      "Next — upgrade the system Node.js. Confirm whether I may change the system installation; I will not start before confirmation.",
    expect: "quiet",
    why: "the next action requires a new permission",
  },
  {
    id: "next-action-blocked",
    group: "quiet",
    reply: "Next — transfer the sources. But SSH is unavailable, so I cannot transfer them now.",
    expect: "quiet",
    why: "an access blocker prevents the announced action",
  },
  {
    id: "next-action-delayed",
    group: "quiet",
    reply: "I will transfer the sources next week.",
    expect: "quiet",
    why: "the action is explicitly postponed",
  },
  {
    id: "user-next-action",
    group: "quiet",
    reply: "Everything is configured. Next you need to transfer the sources to the test machine.",
    expect: "quiet",
    why: "the next action belongs to the user, not the assistant",
  },
  {
    id: "unfinished-but-refused",
    group: "quiet",
    reply:
      "Earlier I wrote 'Next — transfer the sources', but did not transfer anything. I will not continue now.",
    expect: "quiet",
    why: "an explicit refusal vetoes unfinished work",
  },
  {
    id: "optional-next-action",
    group: "quiet",
    reply: "Everything is configured. We could also transfer the sources if you want.",
    expect: "quiet",
    why: "an optional offer is not permission to proceed",
  },
  {
    id: "unfinished-with-next-action",
    group: "promise",
    reply:
      "I found the cause, but have not fixed the duplicate yet. I will fix repeated delivery now and check the result.",
    expect: "continue",
    why: "unfinished work and an explicit next action",
  },
  {
    id: "retry-fixed-promises-resume-ru",
    group: "target",
    reply:
      "Исправил настройку повторов: запрос при временном сбое API повторяется до 3 раз, сама задача повторно не запускается. Дополнительные проверки остаются отключены. Продолжаю запуск.",
    expect: "continue",
    why: "a completed correction still ends with a commitment to continue now",
  },
  {
    id: "retry-fixed-promises-resume-en",
    group: "target",
    reply:
      "Fixed the retry setting: a request after a temporary API failure is retried up to 3 times, but the task itself is not restarted. Additional checks remain disabled. Continuing the run.",
    expect: "continue",
    why: "the English version makes the same immediate commitment",
  },
  {
    id: "starting-now",
    group: "promise",
    reply: "I will write the script now.",
    expect: "continue",
    why: "the assistant promises immediate work",
  },
  {
    id: "next-check",
    group: "promise",
    reply: "The change is in. Next I will run the tests.",
    expect: "continue",
    why: "verification is explicitly the next step",
  },
  {
    id: "russian-next-check",
    group: "promise",
    reply: "Исправил. Сейчас проверю тестами.",
    expect: "continue",
    why: "the same next-step promise in Russian",
  },
  {
    id: "confident-en",
    group: "quiet",
    reply: "I am confident this fixes the problem. The tests pass.",
    expect: "quiet",
    why: "confidence is not a promise",
  },
  {
    id: "confident-ru",
    group: "quiet",
    reply: "Уверен, что это исправляет проблему. Тесты прошли.",
    expect: "quiet",
    why: "Russian confidence is not a promise",
  },
  {
    id: "unfinished-no-promise",
    group: "promise",
    reply: "Only a.ts and b.ts are updated. c.ts is unchanged.",
    expect: "continue",
    why: "explicit unfinished work is now a continuation signal",
  },
  {
    id: "later",
    group: "quiet",
    reply: "I will run the tests next week.",
    expect: "quiet",
    why: "a later promise is not immediate",
  },
  {
    id: "status-while-coding",
    group: "quiet",
    reply:
      "I chose linewise insertion. The earlier implementation still needs tests; I will run them after fixing the current failures.",
    expect: "quiet",
    why: "future work depends on a later event",
  },
  {
    id: "waiting-build",
    group: "quiet",
    reply: "The build is already running. Its completion will automatically resume this session.",
    expect: "quiet",
    why: "no new assistant action is promised",
  },
  {
    id: "reload-continue",
    group: "quiet",
    reply:
      "Reloading now; after the reload the session continues automatically with the live check.",
    expect: "quiet",
    why: "automatic continuation is not a new action promise",
  },
  {
    id: "optional-extra",
    group: "quiet",
    reply: "Fixed. We could sweep the other documents later if you want.",
    expect: "quiet",
    why: "a conditional suggestion is not a commitment",
  },
  {
    id: "quoted-promise",
    group: "promise",
    reply: "The earlier reply said 'Continuing the run', but it did not start anything.",
    expect: "continue",
    why: "reporting an unperformed action is explicit unfinished work",
  },
  {
    id: "negated-promise",
    group: "quiet",
    reply: "I will not continue the run. You asked me to stop.",
    expect: "quiet",
    why: "a refusal to act is not a promise to act",
  },
  {
    id: "pure-question-answered",
    group: "quiet",
    reply: "TOCTOU means time-of-check to time-of-use.",
    expect: "quiet",
    why: "an explanation has no next-action promise",
  },
];

const REQUEST_CASES: BenchCase[] = [
  {
    id: "status-request-en",
    group: "target",
    request: "What is left?",
    reply: "The bug is not fixed. I will fix it now.",
    expect: "quiet",
    why: "a status question does not authorize unfinished work",
  },
  {
    id: "status-request-ru",
    group: "target",
    request: "Что осталось?",
    reply: "Осталась LPT-392. Сейчас начну работу над ней.",
    expect: "quiet",
    why: "a Russian status question does not authorize the remaining task",
  },
  {
    id: "question-request-en",
    group: "target",
    request: "Can you fix the bug?",
    reply: "The bug is not fixed. I will fix it now.",
    expect: "quiet",
    why: "a question-shaped request is not a direct command",
  },
  {
    id: "question-request-ru",
    group: "target",
    request: "Можешь исправить баг?",
    reply: "Осталась LPT-392. Сейчас начну работу над ней.",
    expect: "quiet",
    why: "a Russian question-shaped request is not a direct command",
  },
  {
    id: "command-request-en",
    group: "target",
    request: "Fix the bug.",
    reply: "The bug is not fixed. I will fix it now.",
    expect: "continue",
    why: "the same reply can continue after a direct command",
  },
  {
    id: "command-request-ru",
    group: "target",
    request: "Сделай LPT-392.",
    reply: "Осталась LPT-392. Сейчас начну работу над ней.",
    expect: "continue",
    why: "the same Russian reply can continue after a direct command",
  },
  {
    id: "mixed-request-en",
    group: "target",
    request: "Why does it fail? Find the cause and fix it.",
    reply: "The bug is not fixed. I will fix it now.",
    expect: "continue",
    why: "a question does not cancel a separate work command",
  },
  {
    id: "mixed-request-ru",
    group: "target",
    request: "Почему падает? Найди причину и исправь.",
    reply: "Причину нашёл, исправление не внесено. Сейчас исправлю.",
    expect: "continue",
    why: "a Russian mixed request includes a direct work command",
  },
  {
    id: "plan-request",
    group: "target",
    request: "Write a plan for fixing the bug. Do not implement it.",
    reply: "The bug is not fixed. I will fix it now.",
    expect: "quiet",
    why: "a plan-only request does not authorize implementation",
  },
  {
    id: "explanation-request",
    group: "target",
    request: "Explain why the bug occurs.",
    reply: "The bug is not fixed. I will fix it now.",
    expect: "quiet",
    why: "an explanation does not authorize the described fix",
  },
  {
    id: "short-command-ru",
    group: "target",
    request: "делай",
    reply: "Осталась LPT-392. Сейчас начну работу над ней.",
    expect: "continue",
    why: "a short direct command still authorizes work",
  },
  {
    id: "quoted-command",
    group: "target",
    request: 'What does the message "Fix the bug now" mean?',
    reply: "The bug is not fixed. I will fix it now.",
    expect: "quiet",
    why: "a quoted command is not a user instruction",
  },
  {
    id: "unclear-request",
    group: "target",
    request: "Maybe we could fix the bug sometime.",
    reply: "The bug is not fixed. I will fix it now.",
    expect: "quiet",
    why: "a suggestion is not a direct work command",
  },
];

export const CASES: BenchCase[] = [
  ...REPLY_CASES.map((testCase) => ({ ...testCase, request: "Complete the requested work." })),
  ...REQUEST_CASES,
];

if (CASES.length === 0) throw new Error("no bench cases");
for (const value of CASES) {
  if (!value.id || !value.request || !value.reply || !value.why)
    throw new Error(`bench case is incomplete: ${JSON.stringify(value)}`);
}
if (new Set(CASES.map((value) => value.id)).size !== CASES.length)
  throw new Error("bench case ids must be unique");
