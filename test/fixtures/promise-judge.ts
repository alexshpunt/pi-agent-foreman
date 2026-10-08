import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { signals } from "../signals.ts";

/** Stub the external endpoints while Pi's loader, nested writer and continuation stay real. */
export default function promiseJudge(pi: ExtensionAPI) {
  const originalFetch = globalThis.fetch;
  let writerCalls = 0;
  const provider = {
    baseUrl: "http://foreman-writer.test/v1",
    api: "openai-completions" as const,
    apiKey: "test-key",
    models: [
      {
        id: "writer",
        name: "Test writer",
        reasoning: false,
        input: ["text" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  };
  pi.registerProvider("writer", provider);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/v1/systemone")) {
      const body = JSON.parse(String(init?.body)) as {
        state: { reply?: string; request?: string; activity?: string };
        questions: Record<string, unknown>;
      };
      if (body.questions.explicitCommand !== undefined) {
        appendFileSync(
          join(process.cwd(), "request-inputs.jsonl"),
          `${JSON.stringify(body.state)}\n`,
        );
        appendFileSync(join(process.cwd(), "request-requests.jsonl"), `${JSON.stringify(body)}\n`);
        return new Response(
          JSON.stringify({
            answers: {
              explicitCommand: {
                type: "noul",
                noul: Number(process.env.FOREMAN_TEST_REQUEST_PROBABILITY ?? "0.99"),
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      appendFileSync(join(process.cwd(), "judge-inputs.jsonl"), `${JSON.stringify(body.state)}\n`);
      appendFileSync(join(process.cwd(), "judge-requests.jsonl"), `${JSON.stringify(body)}\n`);
      const verdict =
        body.state.reply === "The run is complete."
          ? signals()
          : process.env.FOREMAN_TEST_SCOPE_VERDICTS
            ? signals(
                JSON.parse(process.env.FOREMAN_TEST_SCOPE_VERDICTS)[body.state.request ?? ""] ?? {
                  unfinished: 0.95,
                },
              )
            : process.env.FOREMAN_TEST_SIGNALS
              ? signals(JSON.parse(process.env.FOREMAN_TEST_SIGNALS))
              : signals({
                  plannedAction: body.state.reply === "Continuing the run." ? 0.95 : 0.05,
                });
      return new Response(
        JSON.stringify({
          answers: Object.fromEntries(
            Object.entries(verdict).map(([key, noul]) => [key, { type: "noul", noul }]),
          ),
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (url.startsWith(provider.baseUrl)) {
      appendFileSync(join(process.cwd(), "writer-inputs.jsonl"), `${String(init?.body)}\n`);
      const first = writerCalls++ === 0;
      const delta = first
        ? {
            tool_calls: [
              {
                index: 0,
                id: "instruct-run",
                type: "function",
                function: {
                  name: "instruct",
                  arguments: JSON.stringify({
                    action: "Carry out the identified work.",
                    instruction:
                      process.env.FOREMAN_TEST_INSTRUCTION ?? "Start the promised run now.",
                  }),
                },
              },
            ],
          }
        : { content: "Instruction recorded." };
      const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
      return new Response(
        chunk({ id: "writer-response", choices: [{ index: 0, delta, finish_reason: null }] }) +
          chunk({
            id: "writer-response",
            choices: [{ index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }],
          }) +
          "data: [DONE]\n\n",
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    }
    return originalFetch(input, init);
  };
  pi.on("message_end", (event) => {
    const errorMessage = process.env.FOREMAN_TEST_REPLY_ERROR;
    if (errorMessage && event.message.role === "assistant") {
      return { message: { ...event.message, stopReason: "error", errorMessage } };
    }
  });
  pi.on("session_start", () => {
    const path = join(getAgentDir(), "settings.json");
    const root = JSON.parse(readFileSync(path, "utf8"));
    root.agentForeman = {
      enabled: true,
      threshold: 0.5,
      model: "writer/writer",
      thinking: "off",
      classifier: process.env.FOREMAN_TEST_CLASSIFIER ?? "typesafe/jev-latest",
    };
    writeFileSync(path, JSON.stringify(root));
    writeFileSync(
      join(getAgentDir(), "models.json"),
      JSON.stringify({ providers: { writer: provider } }),
    );
  });
  pi.on("session_shutdown", () => {
    globalThis.fetch = originalFetch;
  });
}
