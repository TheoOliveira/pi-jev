import test from "node:test";
import assert from "node:assert/strict";
import { registerJevCommands } from "../src/commands.js";
import type { JevClient } from "../src/jev.js";
import type { ToolRouter } from "../src/router.js";
import type { SkillRouter } from "../src/skills.js";
import type { AutoJev } from "../src/auto.js";

function harness(designed: unknown, answers: Record<string, any> = {}) {
  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  let activeTools = ["read"];
  const allTools = [
    { name: "read" },
    { name: "bash" },
    { name: "jev_find_tools" },
    { name: "jev_find_skill" },
    { name: "jev_evaluate" },
  ];
  const pi: any = {
    registerCommand: (_name: string, options: any) => {
      handler = options.handler;
    },
    getActiveTools: () => [...activeTools],
    getAllTools: () => allTools,
    setActiveTools: (names: string[]) => {
      activeTools = [...names];
    },
  };

  const jevClient = {
    isConfigured: () => true,
    getKeyOrigin: () => "~/.pi/agent/secrets/typesafe_api_key",
    stats: { requestsCount: 0, totalTokens: 0 },
    evaluate: async (request: any) => ({
      answers,
      model: "jev-latest",
      elapsedMs: 7,
      _requested: Object.keys(request.questions),
    }),
  } as unknown as JevClient;

  const auto = {
    enabled: false,
    setEnabled(value: boolean) {
      this.enabled = value;
    },
  };

  registerJevCommands(
    pi,
    jevClient,
    {} as ToolRouter,
    {} as SkillRouter,
    auto as unknown as AutoJev
  );

  const notify = (message: string, level?: string) => {
    calls.push({ message, level });
  };
  const calls: Array<{ message: string; level?: string }> = [];

  const ctx: any = {
    ui: { notify },
    model: { provider: "openai", id: "gpt-x" },
    modelRegistry: {
      hasConfiguredAuth: () => true,
      complete: async () => ({
        content: [{ type: "text", text: typeof designed === "string" ? designed : JSON.stringify(designed) }],
      }),
    },
    signal: undefined,
  };

  return {
    run: (args: string) => handler!(args, ctx),
    calls,
    active: () => [...activeTools],
    auto,
  };
}

test("/jev test <prompt> designs the evaluation with the model, then runs it on Jev", async () => {
  const { run, calls } = harness(
    {
      state: "diff removes a null check before the token compare",
      questions: {
        is_risky: { type: "noul", instructions: "Is this risky?" },
        verdict: { type: "choice", instructions: "Merge?", criteria: { yes: "", no: "" } },
      },
    },
    { is_risky: { type: "noul", value: 0.81 }, verdict: { type: "choice", value: "no" } }
  );

  await run("test removed null check in auth");

  const messages = calls.map((c) => c.message).join("\n");
  assert.match(messages, /Designing a Jev evaluation for: "removed null check in auth"/);
  assert.match(messages, /Designed 2 question\(s\): is_risky, verdict/);
  assert.match(messages, /is_risky: 0.81 \(81% yes\)/);
  assert.match(messages, /verdict: no/);
  assert.equal(calls.at(-1)?.level, "info");
});

test("/jev test without a prompt keeps the fixed smoke test and skips the model", async () => {
  const { run, calls } = harness({}, {
    is_billing: { type: "noul", value: 0.9 },
    category: { type: "choice", value: "billing" },
  });

  await run("test");
  const messages = calls.map((c) => c.message).join("\n");
  assert.match(messages, /Jev Test Successful/);
  assert.match(messages, /is_billing: 0.9 \(90% yes\)/);
  assert.doesNotMatch(messages, /Designing a Jev evaluation/);
});

test("/jev test <prompt> reports design failures without calling Jev", async () => {
  const { run, calls } = harness("I refuse to answer in JSON.");
  await run("test something vague");

  const messages = calls.map((c) => c.message).join("\n");
  assert.match(messages, /Could not design evaluation:/);
  assert.equal(calls.at(-1)?.level, "error");
});

test("/jev eval and /jev evaluate are accepted aliases", async () => {
  const { run, calls } = harness({
    state: "x",
    questions: { ok: { type: "noul", instructions: "Fine?" } },
  }, { ok: { type: "noul", value: 1 } });

  await run("eval is this fine");
  assert.match(calls.map((c) => c.message).join("\n"), /Designed 1 question\(s\): ok/);

  calls.length = 0;
  await run("evaluate is this fine");
  assert.match(calls.map((c) => c.message).join("\n"), /Designed 1 question\(s\): ok/);
});

test("subcommands match exactly, so lookalike words are rejected", async () => {
  const { run, calls } = harness({});

  await run("autofoo on");
  assert.match(calls.at(-1)!.message, /Unknown command \/jev autofoo/);
  assert.equal(calls.at(-1)!.level, "warning");

  calls.length = 0;
  await run("skillsfoo react");
  assert.match(calls.at(-1)!.message, /Unknown command \/jev skillsfoo/);

  calls.length = 0;
  await run("auto maybe");
  assert.match(calls.at(-1)!.message, /Unknown \/jev auto argument "maybe"/);
  assert.equal(calls.at(-1)!.level, "warning");
});

test("/jev auto toggles only when no argument is given", async () => {
  const { run, calls, auto } = harness({});

  await run("auto");
  assert.match(calls.at(-1)!.message, /auto mode enabled/);
  assert.equal(auto.enabled, true);

  await run("auto");
  assert.match(calls.at(-1)!.message, /auto mode disabled/);
  assert.equal(auto.enabled, false);

  await run("auto off");
  assert.match(calls.at(-1)!.message, /auto mode disabled/);
  assert.equal(auto.enabled, false);
});

test("/jev status reports config origin and excludes own tools from the routable count", async () => {
  const { run, calls } = harness({});
  await run("status");

  const status = calls.at(-1)!.message;
  assert.match(status, /Configured: Yes \(from ~\/\.pi\/agent\/secrets\/typesafe_api_key\)/);
  // active: read. bash is routable; the three jev tools are ours and must not count.
  assert.match(status, /Active tools: 1 \/ Available: 5 \(1 routable\)/);
});

test("/jev enable and /jev disable only touch this extension's tools", async () => {
  const { run, calls, active } = harness({});

  await run("enable");
  assert.deepEqual(active().sort(), ["jev_evaluate", "jev_find_skill", "jev_find_tools", "read"]);
  assert.match(calls.at(-1)!.message, /Jev tools \(jev_find_tools, jev_find_skill, jev_evaluate\) enabled/);

  await run("disable");
  assert.deepEqual(active(), ["read"]);
});

test("/jev help lists usage at info level instead of warning", async () => {
  const { run, calls } = harness({});
  await run("help");

  assert.match(calls.at(-1)!.message, /\/jev auto \[on\|off\]/);
  assert.equal(calls.at(-1)!.level, "info");
});
