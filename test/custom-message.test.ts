import test from "node:test";
import assert from "node:assert/strict";
import extension from "../extensions/index.js";

function setup(enabled: boolean | "thinking" = false) {
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  const levels: string[] = [];
  extension({
    registerFlag() {},
    getFlag(name: string) { return enabled === "thinking" ? name === "jev-thinking" : enabled; },
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: (event: any, ctx: any) => any) { handlers.set(name, handler); },
    events: { on() {} },
    setThinkingLevel(level: string) { levels.push(level); },
  } as any);
  return { beforeStart: handlers.get("before_agent_start")!, levels };
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
