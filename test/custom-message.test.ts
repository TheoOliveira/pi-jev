import test from "node:test";
import assert from "node:assert/strict";
import extension from "../extensions/index.js";

function setup(enabled: boolean | "thinking" = false, flagOverrides?: Record<string, boolean>) {
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  const levels: string[] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const flags: Record<string, boolean> = flagOverrides ?? {};
  extension({
    registerFlag(name: string, opts: any) {
      if (!(name in flags)) {
        flags[name] = Boolean(opts?.default);
      }
    },
    getFlag(name: string) {
      if (flagOverrides) return flags[name];
      return enabled === "thinking" ? name === "jev-thinking" : enabled;
    },
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (event: any, ctx: any) => any) { handlers.set(name, handler); },
    events: { on() {} },
    setThinkingLevel(level: string) { levels.push(level); },
  } as any);
  return {
    beforeStart: handlers.get("before_agent_start")!,
    sessionStart: handlers.get("session_start")!,
    levels,
    statuses,
    flags,
  };
}

for (const enabled of [false, true]) {
  test(`custom-message continuations skip prompt routing when enabled=${enabled}`, async () => {
    const { beforeStart, levels } = setup(enabled);
    const result = await beforeStart({
      type: "before_agent_start",
      messageType: "custom",
      message: { customType: "completion", content: "Worker finished", display: true },
    }, {});
    assert.equal(result, undefined);
    assert.deepEqual(levels, []);
  });
}

for (const messageType of ["user", undefined]) {
  test(`user prompts still run thinking routing with messageType=${messageType}`, async () => {
    const { beforeStart, levels } = setup("thinking");
    await beforeStart({ type: "before_agent_start", messageType, prompt: "review this code" }, {
      model: { api: "openai-completions", reasoning: true },
      thinkingLevel: "minimal",
      ui: { setStatus() {} },
    });
    assert.deepEqual(levels, ["high"]);
  });
}

test("slash commands skip before_agent_start routing including thinking and model routing", async () => {
  const { beforeStart, levels } = setup("thinking");
  const result = await beforeStart({ type: "before_agent_start", messageType: "user", prompt: "/jev status" }, {
    model: { api: "openai-completions", reasoning: true },
    thinkingLevel: "minimal",
    ui: { setStatus() {} },
  });
  assert.equal(result, undefined);
  assert.deepEqual(levels, []);
});

test("session_start syncs CLI flags populated after extension factory runs", async () => {
  const flags: Record<string, boolean> = { "jev-thinking": false };
  const { beforeStart, sessionStart, levels } = setup(false, flags);

  // Simulate Pi populating CLI flag values before session_start
  flags["jev-thinking"] = true;
  await sessionStart({ type: "session_start", reason: "startup" }, {
    ui: { setStatus() {} },
  });

  await beforeStart({ type: "before_agent_start", messageType: "user", prompt: "review this code" }, {
    model: { api: "openai-completions", reasoning: true },
    thinkingLevel: "minimal",
    ui: { setStatus() {} },
  });
  assert.deepEqual(levels, ["high"]);
});
