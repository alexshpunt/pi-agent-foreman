/** Final-reply tuning cases for the real jev promise judge, not CI tests. */
export type BenchExpectation = "continue" | "quiet";

export interface BenchCase {
  id: string;
  group: "promise" | "quiet" | "target";
  /** The entire final assistant reply, without user or tool context. */
  reply: string;
  expect: BenchExpectation;
  why: string;
}

export const CASES: BenchCase[] = [
  {
    id: "retry-fixed-promises-resume-ru",
    group: "target",
    reply:
      "Да, это моя ошибка: перепутал повтор задачи с повтором запроса при временном сбое API. Вернул API-retry — до 3 повторов. Oracle и повторные попытки задач остаются отключены. Продолжаю запуск.",
    expect: "continue",
    why: "a completed correction still ends with a commitment to continue now",
  },
  {
    id: "retry-fixed-promises-resume-en",
    group: "target",
    reply:
      "Yes, that was my mistake: I confused retrying a task with retrying a request after a temporary API failure. Restored API retries — up to 3 retries. Oracle and task retries remain disabled. Continuing the run.",
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
    group: "quiet",
    reply: "Only a.ts and b.ts are updated. c.ts is unchanged.",
    expect: "quiet",
    why: "unfinished work alone is outside this judge's scope",
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
    group: "quiet",
    reply: "The earlier reply said 'Continuing the run', but it did not start anything.",
    expect: "quiet",
    why: "reporting an earlier promise is not making one",
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

if (CASES.length === 0) throw new Error("no bench cases");
for (const value of CASES) {
  if (!value.id || !value.reply || !value.why)
    throw new Error(`bench case is incomplete: ${JSON.stringify(value)}`);
}
if (new Set(CASES.map((value) => value.id)).size !== CASES.length)
  throw new Error("bench case ids must be unique");
