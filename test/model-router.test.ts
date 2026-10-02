import test from "node:test";
import assert from "node:assert/strict";
import {
  AutoModelRouter,
  capabilityFit,
  classifyModelError,
  classifyModelNeed,
  evaluateModel,
  hasKnownCost,
  modelStayCostUsd,
  modelSwitchCostUsd,
  FIT_TOLERANCE,
  promptHasUrl,
  requiredConfidence,
  selectBestModel,
} from "../src/model-router.js";

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id, provider: "test", name: id, api: "test", baseUrl: "", reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 },
  contextWindow: 128000, maxTokens: 4096, ...extra,
}) as any;

/** A ctx whose registry offers `models`, with `current` already selected. */
function ctxFor(current: any, models: any[], tokens?: number) {
  return {
    model: current,
    modelRegistry: { getAvailable: () => models },
    getSystemPrompt: () => "",
    ...(tokens === undefined ? {} : { getContextUsage: () => ({ tokens, contextWindow: 1e6, percent: 0.1 }) }),
  } as any;
}

test("classifies model needs by task signals", () => {
  assert.equal(classifyModelNeed("plan a security decision").profile, "reasoning");
  assert.equal(classifyModelNeed("inspect this screenshot", 0, true).profile, "vision");
  assert.equal(classifyModelNeed("review this URL", 0, false, true).profile, "url");
  assert.equal(classifyModelNeed("summarize https://example.com").profile, "url");
  assert.equal(classifyModelNeed("open docs.example.com/path").profile, "url");
  assert.equal(classifyModelNeed("review the entire codebase").profile, "long-context");
  assert.equal(classifyModelNeed("hi, list files").profile, "fast");
});

test("detects URLs in prompt text", () => {
  assert.equal(promptHasUrl("summarize https://example.com"), true);
  assert.equal(promptHasUrl("summarize example.com/page"), true);
  assert.equal(promptHasUrl("summarize this page"), false);
});

test("classifies provider limit errors", () => {
  assert.equal(classifyModelError(new Error("429 rate limit")), "rate-limit");
  assert.equal(classifyModelError(new Error("context window exceeded")), "context-limit");
  assert.equal(classifyModelError(new Error("quota exceeded")), "quota");
});

// --- capability fit ---------------------------------------------------------

test("unused multimodality is not rewarded", () => {
  // Regression: the old scorer added image points in every profile, so a
  // multimodal model won text-only tasks. Same cost and context, no image needed.
  const textOnly = model("text-only", { reasoning: true });
  const multimodal = model("multimodal", { reasoning: true, input: ["text", "image"] });
  for (const profile of ["reasoning", "balanced", "long-context", "fast"] as const) {
    assert.equal(
      capabilityFit(multimodal, profile),
      capabilityFit(textOnly, profile),
      `${profile}: multimodal model should not out-fit an equivalent text model`
    );
  }
});

test("image capability is rewarded only for vision tasks", () => {
  const textOnly = model("text-only");
  const multimodal = model("multimodal", { input: ["text", "image"] });
  assert.ok(capabilityFit(multimodal, "vision") > capabilityFit(textOnly, "vision"));
  assert.equal(capabilityFit(multimodal, "reasoning"), capabilityFit(textOnly, "reasoning"));
});

test("url capability is rewarded only for url tasks", () => {
  const textOnly = model("text-only");
  const urlCapable = model("url-capable", { input: ["text", "url"] });
  assert.ok(capabilityFit(urlCapable, "url") > capabilityFit(textOnly, "url"));
  assert.equal(capabilityFit(urlCapable, "balanced"), capabilityFit(textOnly, "balanced"));
});

test("hard input requirements exclude incompatible models", () => {
  const textOnly = model("text-only");
  const multimodal = model("multimodal", { input: ["text", "image"] });
  assert.equal(capabilityFit(textOnly, "vision", { needsImages: true }), -100);
  assert.ok(capabilityFit(multimodal, "vision", { needsImages: true }) > 0);
  assert.equal(capabilityFit(textOnly, "url", { needsUrls: true }), -100);
});

// --- cache economics --------------------------------------------------------

test("switch cost is full input plus cache write; stay cost is cache read", () => {
  const m = model("m", { cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } });
  assert.ok(Math.abs(modelSwitchCostUsd(m, 100_000) - 0.675) < 1e-9);
  assert.ok(Math.abs(modelStayCostUsd(m, 100_000) - 0.03) < 1e-9);
});

test("a model without cache rates pays full input on stay", () => {
  const m = model("m", { cost: { input: 2, output: 8 } });
  assert.equal(modelStayCostUsd(m, 1_000_000), 2);
});

test("with no current model, margin is the full cost of adopting the candidate", () => {
  const m = model("m");
  const fresh = evaluateModel(m, "reasoning", { prefixTokens: 100_000 });
  assert.equal(fresh.stayCostUsd, 0);
  assert.equal(fresh.marginUsd, fresh.switchCostUsd);
});

test("equal capability: the cheaper model wins", () => {
  const cheap = model("cheap", { cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 } });
  const pricey = model("pricey", { cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } });
  const from = model("from", { cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 } });
  const opts = { prefixTokens: 150_000, from };
  const ranked = [cheap, pricey].map((m) => ({ model: m, ...evaluateModel(m, "balanced", opts) }));
  assert.equal(selectBestModel(ranked)?.model.id, "cheap");
});

test("cost never downgrades a capability class, however long the conversation", () => {
  // Reasoning beats non-reasoning by ~30 fit points; price must not overturn that.
  const plainCheap = model("plain-cheap", { cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } });
  const smartPricey = model("smart-pricey", { reasoning: true, cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } });
  const from = model("from", { cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } });
  for (const prefixTokens of [50_000, 500_000, 2_000_000]) {
    const ranked = [plainCheap, smartPricey].map((m) => ({ model: m, ...evaluateModel(m, "reasoning", { prefixTokens, from }) }));
    assert.equal(selectBestModel(ranked)?.model.id, "smart-pricey", `reasoning lost at ${prefixTokens} tokens`);
  }
});

test("a small fit gap is decided by price", () => {
  // A larger context window is incidental, not a capability class, so cost breaks the tie.
  const cheapBig = model("cheap-big", { contextWindow: 400000, cost: { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0.625 } });
  const priceyBigger = model("pricey-bigger", { contextWindow: 1000000, cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } });
  const from = model("from", { cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 } });
  const opts = { prefixTokens: 200_000, from };
  const ranked = [cheapBig, priceyBigger].map((m) => ({ model: m, ...evaluateModel(m, "long-context", opts) }));
  assert.ok(ranked[1].fit - ranked[0].fit <= FIT_TOLERANCE, "test premise: gap must be within tolerance");
  assert.equal(selectBestModel(ranked)?.model.id, "cheap-big");
});

// --- end-to-end routing -----------------------------------------------------

test("selects available model and skips unchanged selection", async () => {
  let selected = 0;
  const fast = model("fast");
  const reasoning = model("reasoning", { reasoning: true, contextWindow: 200000 });
  const pi: any = { setModel: async () => { selected++; } };
  const ctx = ctxFor(fast, [fast, reasoning]);
  const router = new AutoModelRouter(pi, true);
  const result = await router.route("plan a safe migration", ctx);
  assert.equal(result.model?.id, "reasoning");
  assert.equal(selected, 1);
  ctx.model = reasoning;
  const unchanged = await router.route("plan a safe migration", ctx);
  assert.equal(unchanged.changed, false);
  assert.equal(selected, 1);
});

test("still re-decides per prompt (granularity unchanged)", async () => {
  // Granularity is unchanged: consecutive prompts may still switch.
  let selected = 0;
  const fast = model("fast");
  const reasoning = model("reasoning", { reasoning: true, contextWindow: 200000 });
  const pi: any = { setModel: async () => { selected++; } };
  const ctx = ctxFor(fast, [fast, reasoning]);
  const router = new AutoModelRouter(pi, true);
  await router.route("plan a safe migration", ctx);
  assert.equal(selected, 1);
  ctx.model = reasoning;
  const back = await router.route("hi, list files", ctx);
  assert.equal(back.changed, true);
  assert.equal(back.model?.id, "fast");
  assert.equal(selected, 2);
});

test("selects URL-capable model for URL input", async () => {
  const textOnly = model("text-only");
  const urlModel = model("opencode-zen", { input: ["text", "url"], contextWindow: 200000 });
  const ctx = ctxFor(textOnly, [textOnly, urlModel]);
  const result = await new AutoModelRouter({ setModel: async () => {} } as any, true).route("summarize https://example.com", ctx);
  assert.equal(result.model?.id, "opencode-zen");
});

test("an expensive multimodal model no longer wins a text reasoning task", async () => {
  // The counterexample: equal reasoning, but the old scorer picked the $15
  // vision model over the $3 text model for image capability the task never used.
  const text3 = model("text-3", { reasoning: true, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } });
  const vision15 = model("vision-15", {
    reasoning: true, input: ["text", "image"],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  });
  const ctx = ctxFor(text3, [text3, vision15], 20000);
  const result = await new AutoModelRouter({ setModel: async () => {} } as any, true).route("debug this failing test", ctx);
  // text-3 is already current and ties on fit, so it correctly stays put.
  assert.equal(result.model?.id, "text-3", "must not upgrade to the expensive multimodal model for a text task");
  assert.equal(result.changed, false);
});

test("blocks quota model for future fallback", () => {
  const current = model("quota-model");
  const router = new AutoModelRouter({ setModel: async () => {} } as any, true);
  assert.equal(router.recordProviderResponse(429, current), "rate-limit");
});

test("switch cost exceeds stay cost for a same-capability pricier model", () => {
  const from = model("fast");
  const to = model("reasoning", { reasoning: true, contextWindow: 200000 });
  const opts = { prefixTokens: 100_000, from };
  const a = evaluateModel(from, "reasoning", opts), b = evaluateModel(to, "reasoning", opts);
  assert.ok(b.switchCostUsd! > b.stayCostUsd!);
  assert.ok(a.marginUsd === 0, "the current model is not charged a miss for itself");
});

test("missing cost metadata does not make a model look free", async () => {
  // `cost` is optional in pi's config schema; unpriced must not look free.
  const from = model("from", { cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 } });
  const unpriced = model("unpriced", { reasoning: true });
  delete unpriced.cost;
  const priced = model("priced", { reasoning: true, cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 } });
  const opts = { prefixTokens: 200_000, from };
  assert.equal(hasKnownCost(unpriced), false);
  assert.equal(hasKnownCost(priced), true);
  // Equal fit; the unpriced model is charged a proxy so it cannot win on price.
  const ranked = [unpriced, priced].map((m) => ({ model: m, ...evaluateModel(m, "reasoning", opts) }));
  assert.equal(selectBestModel(ranked)?.model.id, "priced");
});

test("an explicitly free model is known and wins on price", async () => {
  const free = model("free", { reasoning: true, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  const paid = model("paid", { reasoning: true, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } });
  const from = model("from", { cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 } });
  assert.equal(hasKnownCost(free), true);
  assert.equal(modelSwitchCostUsd(free, 1_000_000), 0);
  const opts = { prefixTokens: 200_000, from };
  const ranked = [free, paid].map((m) => ({ model: m, ...evaluateModel(m, "reasoning", opts) }));
  assert.equal(selectBestModel(ranked)?.model.id, "free");
});

test("tiered pricing uses the rate for the tokens actually sent", () => {
  // Ignoring tiers underestimates flagship models 2x above ~272k tokens.
  const tiered = model("tiered", {
    cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0, tiers: [{ inputTokensAbove: 272_000, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: 0 }] },
  });
  const below = modelStayCostUsd(tiered, 100_000);
  const above = modelStayCostUsd(tiered, 500_000);
  assert.ok(Math.abs(below - 0.025) < 1e-9, `below tier: ${below}`);
  assert.ok(Math.abs(above - 0.25) < 1e-9, `above tier should use the 0.5 rate: ${above}`);
  assert.ok(above / 500_000 > below / 100_000, "higher tier must have a higher per-token rate");
});

test("a zero cacheWrite is honored rather than replaced by input price", () => {
  // Cache-write is explicitly 0 for proactive-caching providers (e.g. synthetic).
  const m = model("m", { cost: { input: 0.6, output: 1.2, cacheRead: 0.03, cacheWrite: 0 } });
  assert.ok(Math.abs(modelSwitchCostUsd(m, 100_000) - 0.06) < 1e-9);
  assert.ok(Math.abs(modelStayCostUsd(m, 100_000) - 0.003) < 1e-9);
});

test("partial cost fields fall back to the input rate", () => {
  const m = model("m", { cost: { input: 2 } as any });
  assert.ok(Math.abs(modelSwitchCostUsd(m, 100_000) - 0.4) < 1e-9);
  assert.ok(Math.abs(modelStayCostUsd(m, 100_000) - 0.2) < 1e-9);
});

test("an unpriced current model charges candidates their full switch cost", async () => {
  const current = model("current", { reasoning: true });
  delete current.cost;
  const priced = model("priced", { reasoning: true, cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 } });
  const evaluated = evaluateModel(priced, "reasoning", { prefixTokens: 100_000, from: current });
  assert.equal(evaluated.marginUsd, evaluated.switchCostUsd);
});

// --- confidence gate --------------------------------------------------------

test("required confidence rises with the cost of the switch", () => {
  const cheap = requiredConfidence(0.1), mid = requiredConfidence(3), dear = requiredConfidence(30);
  assert.ok(cheap < mid && mid < dear, `${cheap} < ${mid} < ${dear}`);
  assert.ok(cheap >= 0.5, "a cheap miss is worth roughly a coin-flip");
  assert.ok(dear > 0.9, "an expensive miss needs near-certainty");
});

function jevStub(probability: number, configured = true) {
  return {
    isConfigured: () => configured,
    evaluate: async () => ({ answers: { "model:switch": { type: "noul", value: probability } } }),
  } as any;
}

/** A failing or malformed Jev client, to check the fallback paths. */
const failingJev = { isConfigured: () => true, evaluate: async () => { throw new Error("upstream down"); } } as any;
const malformedJev = { isConfigured: () => true, evaluate: async () => ({ answers: { "model:switch": { type: "noul", value: "yes" } } }) } as any;

function fixture(tokens: number) {
  const from = model("from", { cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 } });
  const to = model("to", { reasoning: true, contextWindow: 200000, cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } });
  const pi: any = { setModel: async () => {} };
  return { from, to, pi, ctx: ctxFor(from, [from, to], tokens) };
}

async function routeWithJev(probability: number, configured = true, tokens = 20_000) {
  const { pi, ctx } = fixture(tokens);
  return new AutoModelRouter(pi, true, jevStub(probability, configured)).route("debug this failing test", ctx, { prefixTokens: tokens });
}

test("a confident Jev judgment switches", async () => {
  const result = await routeWithJev(0.95, true, 1_000);
  assert.equal(result.changed, true);
  assert.equal(result.model?.id, "to");
  assert.equal(result.confidence, 0.95);
});

test("a low-confidence Jev judgment holds instead of switching", async () => {
  const result = await routeWithJev(0.2, true, 1_000);
  assert.equal(result.changed, false);
  assert.equal(result.model?.id, "from");
  assert.equal(result.confidence, 0.2);
  assert.ok(result.reason.includes("held"), result.reason);
});

test("an expensive switch needs more confidence than a cheap one", async () => {
  // Same judgment, different prefix sizes -> different gates.
  const cheapPrefix = await routeWithJev(0.75, true, 1_000);
  const dearPrefix = await routeWithJev(0.75, true, 500_000);
  assert.equal(cheapPrefix.changed, true, "should switch when the miss is cheap");
  assert.equal(dearPrefix.changed, false, "should hold when the miss is expensive");
});

test("a borderline judgment flips with the cost of the miss", async () => {
  // 0.9 clears the gate at a small prefix but not at a large one.
  assert.equal((await routeWithJev(0.9, true, 1_000)).changed, true);
  assert.equal((await routeWithJev(0.9, true, 500_000)).changed, false);
});

test("without a Jev judgment cost only breaks ties, and no confidence is claimed", async () => {
  const result = await routeWithJev(0.95, false, 500_000);
  assert.equal(result.confidence, undefined, "must not invent a probability");
  assert.equal(result.changed, true, "unjudged switches still follow capability");
});

test("a Jev failure does not block the switch or invent a probability", async () => {
  const { pi, ctx } = fixture(1000);
  const result = await new AutoModelRouter(pi, true, failingJev).route("debug this failing test", ctx, { prefixTokens: 1000 });
  assert.equal(result.changed, true);
  assert.equal(result.confidence, undefined);
});

test("a malformed Jev answer is ignored rather than trusted", async () => {
  const { pi, ctx } = fixture(1000);
  const result = await new AutoModelRouter(pi, true, malformedJev).route("debug this failing test", ctx, { prefixTokens: 1000 });
  assert.equal(result.confidence, undefined);
  assert.equal(result.changed, true);
});
