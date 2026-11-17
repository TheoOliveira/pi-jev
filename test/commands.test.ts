import test from "node:test";
import assert from "node:assert/strict";
import { registerJevCommands } from "../src/commands.js";
import type { JevClient } from "../src/jev.js";
import type { ToolRouter } from "../src/router.js";
import type { SkillRouter } from "../src/skills.js";
import type { AutoJev } from "../src/auto.js";

function harness(designed: unknown, answers: Record<string, any> = {}) {
  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  let getArgumentCompletions: ((prefix: string) => any) | undefined;
  let activeTools = ["read"];
  let currentModel: string | null = null;
  let currentBaseURL: string | null = "http://localhost:8000";
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
      getArgumentCompletions = options.getArgumentCompletions;
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
    getBaseURL: () => currentBaseURL,
    setBaseURL: (url?: string | null) => {
      currentBaseURL = url?.trim() || null;
    },
    getModel: () => currentModel,
    setModel: (model?: string | null) => {
      currentModel = model?.trim() || null;
    },
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
    complete: (prefix: string) => getArgumentCompletions?.(prefix),
    calls,
    active: () => [...activeTools],
    auto,
    jevClient,
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
  assert.match(status, /Endpoint: http:\/\/localhost:8000/);
  assert.match(status, /Model: jev-latest/);
  // active: read. bash is routable; the three jev tools are ours and must not count.
  assert.match(status, /Active tools: 1 \/ Available: 5 \(1 routable\)/);
});

test("/jev status displays custom model from getModel", async () => {
  const { run, calls, jevClient } = harness({});
  (jevClient as any).getModel = () => "tev1:0.8b";
  await run("status");

  const status = calls.at(-1)!.message;
  assert.match(status, /• Model: tev1:0\.8b/);
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

test("/jev model and /jev endpoint inspect, set, and reset runtime config", async () => {
  const { run, calls, jevClient } = harness({});

  await run("model");
  assert.match(calls.at(-1)!.message, /Current Jev model: jev-latest/);

  await run("model tev1:0.8b");
  assert.equal(jevClient.getModel(), "tev1:0.8b");
  assert.match(calls.at(-1)!.message, /Jev model set to "tev1:0.8b"/);

  await run("model default");
  assert.equal(jevClient.getModel(), null);
  assert.match(calls.at(-1)!.message, /Jev model reset to default/);

  await run("endpoint");
  assert.match(calls.at(-1)!.message, /Current Jev endpoint: http:\/\/localhost:8000/);

  await run("endpoint http://localhost:9000");
  assert.equal(jevClient.getBaseURL(), "http://localhost:9000");
  assert.match(calls.at(-1)!.message, /Jev endpoint set to "http:\/\/localhost:9000"/);

  await run("endpoint default");
  assert.equal(jevClient.getBaseURL(), null);
  assert.match(calls.at(-1)!.message, /Jev endpoint reset to default/);
});

test("/jev argument completions suggest subcommands and toggle values", () => {
  const { complete } = harness({});

  const top = complete("auto");
  assert.deepEqual(top.map((i: any) => i.value), ["auto", "auto-model", "auto-agents"]);

  const sub = complete("auto o");
  assert.deepEqual(sub, [
    { value: "auto on", label: "on" },
    { value: "auto off", label: "off" },
  ]);

  const modelOpts = complete("model d");
  assert.deepEqual(modelOpts, [{ value: "model default", label: "default" }]);
});
