import test from "node:test";
import assert from "node:assert/strict";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
  AutoThinkingRouter,
  breaksCacheOnChange,
  classifyThinkingNeed,
  effectiveLevel,
  isLevelSupported,
} from "../src/thinking.js";

const model = (extra: Record<string, unknown> = {}) => ({
  id: "m",
  provider: "test",
  name: "m",
  api: "openai-completions",
  baseUrl: "",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 },
  contextWindow: 128000,
  maxTokens: 4096,
  ...extra,
}) as any;

test("escalates planning and review prompts", () => {
  assert.equal(classifyThinkingNeed("plan the migration").level, "high");
  assert.equal(classifyThinkingNeed("find the root cause of this crash").level, "xhigh");
  assert.equal(classifyThinkingNeed("security review this design").level, "xhigh");
  assert.equal(classifyThinkingNeed("debug this failing test").level, "high");
});

test("de-escalates short mechanical prompts", () => {
  assert.equal(classifyThinkingNeed("list files").level, "minimal");
  assert.equal(classifyThinkingNeed("hi").level, "minimal");
  assert.equal(classifyThinkingNeed("rename this variable").level, "minimal");
});

test("defaults to medium for general tasks", () => {
  assert.equal(classifyThinkingNeed("summarize the changelog entries for the last release").level, "medium");
});

test("respects thinkingLevelMap null as unsupported", () => {
  const m = model({ thinkingLevelMap: { high: null, xhigh: null, medium: "medium" } });
  assert.equal(isLevelSupported(m, "high"), false);
  assert.equal(isLevelSupported(m, "medium"), true);
});

test("matches pi's own capability rule, not a naive reading of the map", () => {
  // Pi treats an ABSENT key as supported for off..high, but as UNSUPPORTED for
  // xhigh/max. A non-reasoning model supports only "off". These are the exact
  // cases a naive `!(level in map)` check gets wrong.
  const cases = [
    model({}),
    model({ thinkingLevelMap: { off: null, minimal: null } }),
    model({ thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" } }),
    model({ reasoning: false }),
  ];
  for (const m of cases) {
    const supported = new Set(getSupportedThinkingLevels(m) as string[]);
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
      assert.equal(
        isLevelSupported(m, level),
        supported.has(level),
        `diverged from pi for ${level} on ${JSON.stringify(m.thinkingLevelMap)} (reasoning=${m.reasoning})`
      );
    }
  }
});

test("absent xhigh/max keys stay unsupported while lower levels do not", () => {
  const m = model({ thinkingLevelMap: { off: null } });
  assert.equal(isLevelSupported(m, "medium"), true);
  assert.equal(isLevelSupported(m, "xhigh"), false);
  assert.equal(isLevelSupported(m, "max"), false);
});

test("effectiveLevel clamps to what pi would apply", () => {
  const m = model({ thinkingLevelMap: { off: null, minimal: null } });
  assert.equal(effectiveLevel(m, "minimal"), "low");
  assert.equal(effectiveLevel(m, "medium"), "medium");
  assert.equal(effectiveLevel(model({ reasoning: false }), "high"), "off");
});

test("treats budget-based Anthropic thinking as cache-hostile", () => {
  const budget = model({ api: "anthropic-messages", compat: {} });
  const adaptive = model({ api: "anthropic-messages", compat: { forceAdaptiveThinking: true } });
  const openai = model({ api: "openai-completions" });
  assert.equal(breaksCacheOnChange(budget), true);
  assert.equal(breaksCacheOnChange(adaptive), false);
  assert.equal(breaksCacheOnChange(openai), false);
});

test("applies a level change via pi.setThinkingLevel", async () => {
  let set = 0;
  const pi: any = { setThinkingLevel: () => { set++; } };
  const ctx: any = { model: model(), thinkingLevel: "medium" };
  const router = new AutoThinkingRouter(pi, true);
  const result = await router.route("plan a safe migration", ctx);
  assert.equal(result.changed, true);
  assert.equal(result.level, "high");
  assert.equal(set, 1);
});

test("skips when level is unchanged", async () => {
  let set = 0;
  const pi: any = { setThinkingLevel: () => { set++; } };
  const ctx: any = { model: model(), thinkingLevel: "high" };
  const router = new AutoThinkingRouter(pi, true);
  const result = await router.route("plan a safe migration", ctx);
  assert.equal(result.changed, false);
  assert.equal(result.skipped, "unchanged");
  assert.equal(set, 0);
});

test("does not change level on budget-based Anthropic models", async () => {
  let set = 0;
  const pi: any = { setThinkingLevel: () => { set++; } };
  const ctx: any = { model: model({ api: "anthropic-messages", compat: {} }), thinkingLevel: "medium" };
  const router = new AutoThinkingRouter(pi, true);
  const result = await router.route("debug this failing test", ctx);
  assert.equal(result.changed, false);
  assert.equal(result.skipped, "cache-hostile");
  assert.equal(set, 0);
});

test("applies the clamped level, not the requested one", async () => {
  let applied: string | undefined;
  const pi: any = { setThinkingLevel: (l: string) => { applied = l; } };
  // Model cannot do "minimal" or "high"; pi clamps them.
  const m = model({ thinkingLevelMap: { off: null, minimal: null, high: null } });
  const ctx: any = { model: m, thinkingLevel: "medium" };
  const router = new AutoThinkingRouter(pi, true);
  const result = await router.route("list files", ctx); // asks for minimal
  assert.equal(result.changed, true);
  assert.equal(applied, "low");
});

test("is inert when disabled", async () => {
  let set = 0;
  const pi: any = { setThinkingLevel: () => { set++; } };
  const ctx: any = { model: model(), thinkingLevel: "medium" };
  const router = new AutoThinkingRouter(pi, false);
  const result = await router.route("plan a safe migration", ctx);
  assert.equal(result.skipped, "disabled");
  assert.equal(set, 0);
});

test("records externally observed level changes", () => {
  const router = new AutoThinkingRouter({ setThinkingLevel: () => {} } as any, true);
  router.observe("high", "medium");
  assert.equal(router.last?.level, "high");
  assert.equal(router.last?.previous, "medium");
});
