import test from "node:test";
import assert from "node:assert/strict";
import { classifyModelError, classifyModelNeed, AutoModelRouter } from "../src/model-router.js";

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id, provider: "test", name: id, api: "test", baseUrl: "", reasoning: false,
  input: ["text"], cost: { input: 1, output: 1 }, contextWindow: 128000, maxTokens: 4096, ...extra,
}) as any;

test("classifies model needs by task signals", () => {
  assert.equal(classifyModelNeed("plan a security decision").profile, "reasoning");
  assert.equal(classifyModelNeed("inspect this screenshot", 0, true).profile, "vision");
  assert.equal(classifyModelNeed("review this URL", 0, false, true).profile, "url");
  assert.equal(classifyModelNeed("review the entire codebase").profile, "long-context");
  assert.equal(classifyModelNeed("hi, list files").profile, "fast");
});

test("classifies provider limit errors", () => {
  assert.equal(classifyModelError(new Error("429 rate limit")), "rate-limit");
  assert.equal(classifyModelError(new Error("context window exceeded")), "context-limit");
  assert.equal(classifyModelError(new Error("quota exceeded")), "quota");
});

test("selects available model and skips unchanged selection", async () => {
  let selected = 0;
  const fast = model("fast");
  const reasoning = model("reasoning", { reasoning: true, contextWindow: 200000 });
  const pi: any = { setModel: async () => { selected++; } };
  const ctx: any = {
    model: fast,
    modelRegistry: { getAvailable: () => [fast, reasoning] },
    getSystemPrompt: () => "",
  };
  const router = new AutoModelRouter(pi, true);
  const result = await router.route("plan a safe migration", ctx);
  assert.equal(result.model?.id, "reasoning");
  assert.equal(selected, 1);
  ctx.model = reasoning;
  const unchanged = await router.route("plan a safe migration", ctx);
  assert.equal(unchanged.changed, false);
  assert.equal(selected, 1);
});

test("selects URL-capable model for URL input", async () => {
  const textOnly = model("text-only");
  const urlModel = model("opencode-zen", { input: ["text", "url"], contextWindow: 200000 });
  const pi: any = { setModel: async () => {} };
  const ctx: any = {
    model: textOnly,
    modelRegistry: { getAvailable: () => [textOnly, urlModel] },
    getSystemPrompt: () => "",
  };
  const router = new AutoModelRouter(pi, true);
  const result = await router.route("summarize this page", ctx, { hasUrls: true });
  assert.equal(result.model?.id, "opencode-zen");
});

test("blocks quota model for future fallback", () => {
  const current = model("quota-model");
  const router = new AutoModelRouter({ setModel: async () => {} } as any, true);
  assert.equal(router.recordProviderResponse(429, current), "rate-limit");
});
