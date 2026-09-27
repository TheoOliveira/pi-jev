import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { JevClient } from "./jev.js";

export type ModelProfile = "fast" | "balanced" | "reasoning" | "long-context" | "vision" | "url";
export type ModelErrorKind = "quota" | "rate-limit" | "context-limit" | "unavailable" | "timeout" | "auth" | "unknown";

export interface ModelRouteResult {
  changed: boolean;
  profile: ModelProfile;
  model?: Model<any>;
  reason: string;
  skipped?: "disabled" | "busy" | "no-model" | "low-confidence" | "error";
  fit?: number;
  /** Probability the switch helps, from Jev. Undefined when unjudged. */
  confidence?: number;
}

const PROFILE_HINTS: Record<ModelProfile, RegExp> = {
  fast: /^(hi|hello|list|rename|format|small|simple|quick|what is|how do i)/i,
  reasoning: /\b(plan|planning|architect|architecture|debug|diagnos|compare|trade-?off|design|review|security|why|analy[sz]|complex|refactor)\b/i,
  "long-context": /\b(full repo|entire repo|large diff|long document|all files|context|migration|codebase|many files)\b/i,
  vision: /\b(image|screenshot|photo|diagram|visual|picture|ui mockup|wireframe)\b/i,
  url: /\b(url|link|webpage|website|page|article)\b/i,
  balanced: /.*/,
};

export function classifyModelNeed(prompt: string, contextChars = 0, hasImages = false, hasUrls = false): { profile: ModelProfile; confidence: number; reason: string } {
  if (hasImages || PROFILE_HINTS.vision.test(prompt)) return { profile: "vision", confidence: 0.95, reason: "image input or visual task" };
  if (hasUrls || PROFILE_HINTS.url.test(prompt)) return { profile: "url", confidence: 0.9, reason: "URL input or web task" };
  if (contextChars > 120_000 || PROFILE_HINTS["long-context"].test(prompt)) return { profile: "long-context", confidence: 0.9, reason: "large context task" };
  if (PROFILE_HINTS.reasoning.test(prompt)) return { profile: "reasoning", confidence: 0.82, reason: "planning or deep reasoning task" };
  if (PROFILE_HINTS.fast.test(prompt) && prompt.length < 240) return { profile: "fast", confidence: 0.78, reason: "short simple task" };
  return { profile: "balanced", confidence: 0.55, reason: "general task" };
}

export function classifyModelError(error: unknown): ModelErrorKind {
  const text = String((error as any)?.message ?? error).toLowerCase();
  if (/context|too many tokens|token limit|maximum.*token|prompt too long/.test(text)) return "context-limit";
  if (/quota|credit|billing|insufficient.*fund|resource_exhausted/.test(text)) return "quota";
  if (/rate.?limit|too many requests|429/.test(text)) return "rate-limit";
  if (/timeout|timed out|deadline/.test(text)) return "timeout";
  if (/auth|unauthorized|forbidden|api key|401|403/.test(text)) return "auth";
  if (/model.*(not found|unavailable)|not available|503|502/.test(text)) return "unavailable";
  return "unknown";
}

/** Fit in points; only what the profile needs is credited. */
export function capabilityFit(model: Model<any>, profile: ModelProfile, opts: { needsImages?: boolean; needsUrls?: boolean } = {}): number {
  const input = model.input as readonly string[] | undefined;
  const hasImage = input?.includes("image") ?? false;
  const hasUrl = input?.includes("url") ?? false;
  const reasoning = model.reasoning ? 3 : 0;
  const context = Math.min(model.contextWindow / 100_000, 5);

  if (opts.needsImages && !hasImage) return -100;
  if (opts.needsUrls && !hasUrl) return -100;

  const image = profile === "vision" && hasImage ? 4 : 0;
  const url = profile === "url" && hasUrl ? 4 : 0;
  const reasoningFit = profile === "reasoning" || profile === "long-context" || profile === "vision" || profile === "url" ? reasoning : 0;

  if (profile === "vision") return image * 10 + reasoningFit;
  if (profile === "url") return url * 10 + context + reasoningFit;
  if (profile === "long-context") return context * 10 + reasoningFit;
  if (profile === "reasoning") return reasoning * 10 + context;
  if (profile === "fast") return model.reasoning ? 0 : 3;
  return reasoning + context * 0.5;
}

/** Whether the model's price is known. `cost` is optional in pi's config schema. */
export function hasKnownCost(model: Model<any>): boolean {
  const cost = model.cost;
  return Boolean(cost) && typeof cost.input === "number" && Number.isFinite(cost.input);
}

/** Rates for the tokens sent, applying pi's tier rule (highest threshold below the input size). */
function ratesFor(model: Model<any>, prefixTokens: number): { input: number; cacheRead: number; cacheWrite: number } | undefined {
  if (!hasKnownCost(model)) return undefined;
  const cost = model.cost;
  let rates: any = cost;
  let matched = -1;
  for (const tier of cost.tiers ?? []) {
    if (prefixTokens > tier.inputTokensAbove && tier.inputTokensAbove > matched) {
      rates = tier;
      matched = tier.inputTokensAbove;
    }
  }
  return {
    input: rates.input ?? 0,
    cacheRead: rates.cacheRead ?? rates.input ?? 0,
    cacheWrite: rates.cacheWrite ?? rates.input ?? 0,
  };
}

export function modelSwitchCostUsd(model: Model<any>, prefixTokens: number): number {
  const rates = ratesFor(model, prefixTokens);
  return rates ? (prefixTokens / 1_000_000) * (rates.input + rates.cacheWrite) : Number.POSITIVE_INFINITY;
}

export function modelStayCostUsd(model: Model<any>, prefixTokens: number): number {
  const rates = ratesFor(model, prefixTokens);
  return rates ? (prefixTokens / 1_000_000) * rates.cacheRead : Number.POSITIVE_INFINITY;
}

/** Fit in points and the $ cost of adopting the model. Cost is not folded into
 * `fit`: price breaks ties but never downgrades a capability class. Unpriced
 * models are charged the current model's rates -- missing metadata is not free. */
export function evaluateModel(
  model: Model<any>,
  profile: ModelProfile,
  opts: { prefixTokens: number; from?: Model<any>; needsImages?: boolean; needsUrls?: boolean }
): { fit: number; switchCostUsd?: number; stayCostUsd?: number; marginUsd: number; costKnown: boolean } {
  const fit = capabilityFit(model, profile, { needsImages: opts.needsImages, needsUrls: opts.needsUrls });
  const costKnown = hasKnownCost(model);
  const isCurrent = opts.from !== undefined && opts.from.provider === model.provider && opts.from.id === model.id;

  if (isCurrent) return { fit, switchCostUsd: modelSwitchCostUsd(model, opts.prefixTokens), stayCostUsd: modelStayCostUsd(model, opts.prefixTokens), marginUsd: 0, costKnown };

  if (!costKnown) {
    const proxy = opts.from && hasKnownCost(opts.from) ? modelSwitchCostUsd(opts.from, opts.prefixTokens) : 0;
    return { fit, marginUsd: Number.isFinite(proxy) ? proxy : 0, costKnown };
  }

  const switchCostUsd = modelSwitchCostUsd(model, opts.prefixTokens);
  const stayCostUsd = opts.from ? modelStayCostUsd(opts.from, opts.prefixTokens) : 0;
  const marginUsd = Number.isFinite(stayCostUsd) ? Math.max(0, switchCostUsd - stayCostUsd) : switchCostUsd;
  return { fit, switchCostUsd, stayCostUsd: Number.isFinite(stayCostUsd) ? stayCostUsd : undefined, marginUsd, costKnown };
}

/** Points within which two models count as equally capable, so cost may choose
 * between them. Above incidental fit steps (a context step is ~10), below real
 * capability gaps (reasoning +30, image +40). */
export const FIT_TOLERANCE = 15;

export function selectBestModel<T extends { fit: number; marginUsd: number; costKnown: boolean }>(ranked: T[]): T | undefined {
  if (ranked.length === 0) return undefined;
  const bestFit = Math.max(...ranked.map((r) => r.fit));
  return ranked
    .filter((r) => bestFit - r.fit <= FIT_TOLERANCE)
    .sort((a, b) => a.marginUsd - b.marginUsd || Number(b.costKnown) - Number(a.costKnown))[0];
}

export interface ModelSwitchPlan {
  questionKey: "model:switch";
  instructions: string;
  model: Model<any>;
  current?: Model<any>;
  profile: ModelProfile;
  marginUsd: number;
  fit: number;
  costKnown: boolean;
}

export interface ModelPlanResult {
  result: ModelRouteResult;
  plan?: ModelSwitchPlan;
}

/** Confidence a switch must reach to be worth `costUsd`: `P > cost/value`,
 * without naming the dollar value of a correct answer. */
export function requiredConfidence(costUsd: number, min = 0.5, max = 0.99, scale = 5): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return min;
  return min + (max - min) * (1 - Math.exp(-costUsd / scale));
}

export class AutoModelRouter {
  public enabled: boolean;
  private running = false;
  private blocked = new Map<string, number>();
  public last?: ModelRouteResult;

  constructor(private pi: ExtensionAPI, enabled = false, private jevClient?: JevClient) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void { this.enabled = enabled; }

  public recordProviderResponse(status: number, model?: Model<any>): ModelErrorKind | undefined {
    if (!model || status < 400) return undefined;
    const kind: ModelErrorKind = status === 408 || status === 504 ? "timeout" : status === 401 || status === 403 ? "auth" : status === 413 ? "context-limit" : status === 429 ? "rate-limit" : status === 402 ? "quota" : status >= 500 ? "unavailable" : "unknown";
    if (["quota", "rate-limit", "context-limit", "unavailable", "timeout"].includes(kind)) {
      this.blocked.set(`${model.provider}/${model.id}`, Date.now() + (kind === "quota" || kind === "rate-limit" ? 600_000 : 60_000));
    }
    return kind;
  }

  /** Choose locally whether a switch is worth considering. Makes no network call. */
  public plan(prompt: string, ctx: ExtensionContext, options: { hasImages?: boolean; hasUrls?: boolean; prefixTokens?: number } = {}): ModelPlanResult {
    const current = ctx.model;
    const fallback: ModelRouteResult = { changed: false, profile: "balanced", reason: "model selection skipped" };
    if (!this.enabled) return { result: { ...fallback, skipped: "disabled" } };
    if (this.running) return { result: { ...fallback, skipped: "busy" } };
    if (!prompt.trim()) return { result: { ...fallback, skipped: "low-confidence" } };

    try {
      const contextChars = (ctx.getSystemPrompt?.() ?? "").length;
      const hasImages = Boolean(options.hasImages);
      const hasUrls = Boolean(options.hasUrls);
      const need = classifyModelNeed(prompt, contextChars, hasImages, hasUrls);
      if (need.confidence < 0.6 && !this.jevClient?.isConfigured()) return { result: { ...fallback, profile: need.profile, reason: need.reason, skipped: "low-confidence" } };

      const prefixTokens = options.prefixTokens ?? ctx.getContextUsage?.()?.tokens ?? Math.round(contextChars / 4);
      const needs = { needsImages: hasImages, needsUrls: hasUrls };

      const models = (ctx.scopedModels?.length ? ctx.scopedModels.map((x) => x.model) : ctx.modelRegistry.getAvailable())
        .filter((model) => {
          const until = this.blocked.get(`${model.provider}/${model.id}`);
          return until === undefined || until < Date.now();
        })
        .filter((model) => capabilityFit(model, need.profile, needs) >= 0);

      const ranked = models
        .map((model) => ({ model, ...evaluateModel(model, need.profile, { prefixTokens, from: current, ...needs }) }))
        .sort((a, b) => b.fit - a.fit);
      const best = selectBestModel(ranked);
      if (!best) return { result: { ...fallback, profile: need.profile, reason: "no compatible model", skipped: "no-model" } };

      const target = best.model;
      if (current?.provider === target.provider && current?.id === target.id) {
        const unchanged: ModelRouteResult = {
          changed: false, profile: need.profile, model: target, reason: need.reason, fit: best.fit,
        };
        this.last = unchanged;
        return { result: unchanged };
      }

      const plan: ModelSwitchPlan = {
        questionKey: "model:switch",
        instructions: `Would switching from model "${current?.id ?? "none"}" to model "${target.id}" meaningfully improve the answer to this task: "${prompt}"?`,
        model: target,
        current,
        profile: need.profile,
        marginUsd: best.marginUsd,
        fit: best.fit,
        costKnown: best.costKnown,
      };
      const pending: ModelRouteResult = {
        changed: false, profile: need.profile, model: current, reason: need.reason,
        fit: best.fit, skipped: "low-confidence",
      };
      return { result: pending, plan };
    } catch {
      return { result: { ...fallback, skipped: "error" } };
    }
  }

  public async applyDecision(plan: ModelSwitchPlan, confidence: number | undefined): Promise<ModelRouteResult> {
    const fallback: ModelRouteResult = { changed: false, profile: plan.profile, reason: "model selection skipped", skipped: "error" };
    if (confidence !== undefined) {
      const required = requiredConfidence(plan.marginUsd);
      if (confidence < required) {
        const held: ModelRouteResult = {
          changed: false, model: plan.current, fit: plan.fit, confidence,
          profile: plan.profile,
          reason: `${plan.profile}; held (P=${confidence.toFixed(2)} < ${required.toFixed(2)} needed for ~$${plan.marginUsd.toFixed(4)})`,
        };
        this.last = held;
        return held;
      }
    }

    this.running = true;
    try {
      await this.pi.setModel(plan.model);
      const price = plan.costKnown ? `, miss ~$${plan.marginUsd.toFixed(4)}` : ", price unknown";
      const judged = confidence !== undefined ? `, P=${confidence.toFixed(2)}` : "";
      const result: ModelRouteResult = {
        changed: true, profile: plan.profile, model: plan.model,
        reason: `${plan.profile} (fit ${plan.fit.toFixed(1)}${price}${judged})`,
        fit: plan.fit, confidence,
      };
      this.last = result;
      return result;
    } catch (error) {
      const kind = classifyModelError(error);
      this.blocked.set(`${plan.model.provider}/${plan.model.id}`, Date.now() + (kind === "rate-limit" || kind === "quota" ? 600_000 : 60_000));
      return { ...fallback, model: plan.current, reason: `model switch failed: ${kind}` };
    } finally {
      this.running = false;
    }
  }

  public async route(prompt: string, ctx: ExtensionContext, options: { hasImages?: boolean; hasUrls?: boolean; prefixTokens?: number } = {}): Promise<ModelRouteResult> {
    const { result, plan } = this.plan(prompt, ctx, options);
    return plan ? this.applyDecision(plan, await this.judge(prompt, plan)) : result;
  }

  public async judge(prompt: string, plan: ModelSwitchPlan): Promise<number | undefined> {
    if (!this.jevClient?.isConfigured()) return undefined;
    try {
      const res = await this.jevClient.evaluate({
        state: { task: prompt },
        questions: { [plan.questionKey]: { type: "noul", instructions: plan.instructions } },
      });
      const value = res.answers[plan.questionKey]?.value;
      return typeof value === "number" ? value : undefined;
    } catch {
      return undefined;
    }
  }
}
