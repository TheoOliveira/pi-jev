import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";

/**
 * Reasoning-level control — per prompt, without changing the model.
 *
 * Pi's `ThinkingLevel` is a request parameter (`reasoning_effort`,
 * `output_config.effort`, or `thinking.budget_tokens`), not part of the cached
 * token prefix. Changing it therefore keeps the model — and the prompt-cache
 * identity — fixed, unlike a model switch, which forces a full-price prefix
 * miss in both directions.
 *
 * That property holds for Anthropic *adaptive* thinking, where effort is a
 * param. It does **not** hold for Anthropic *budget-based* thinking (models
 * without `compat.forceAdaptiveThinking`): there Pi derives `budget_tokens`
 * from `max_tokens`, which is itself derived from the level, and Anthropic
 * keys the message cache on `budget_tokens`. Pi's own `isReplayable()` returns
 * false in that case and the cache warmer stops entirely. This module treats
 * such models as "do not change the level mid-conversation" by default.
 *
 * (That budget_tokens claim is a comment in Pi's source, not something
 * verified against Anthropic's public documentation.)
 */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ThinkingNeed {
  level: ThinkingLevel;
  confidence: number;
  reason: string;
}

/**
 * Intent vocabulary is deliberately the same as `PROFILE_HINTS.reasoning` in
 * `model-router.ts` so the extension has one classifier vocabulary, not two.
 */
const ESCALATE = /\b(plan|planning|architect|architecture|debug|diagnos|compare|trade-?off|design|review|security|why|analy[sz]|complex|refactor|migrat|root cause|investigat|prove|reason|optimi[sz]|benchmark|audit)\b/i;
const DEESCALATE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|y|n|list|rename|format|show|print|cat|ls|pwd|git status|status|what is|who is|define)\b/i;

/** Short, mechanical prompts stay cheap; long ones get the default. */
const SHORT_PROMPT_CHARS = 240;

export function classifyThinkingNeed(prompt: string): ThinkingNeed {
  const text = prompt.trim();
  if (!text) return { level: "minimal", confidence: 0.5, reason: "empty prompt" };

  if (ESCALATE.test(text)) {
    const deep = /\b(root cause|prove|security|architect|migrat|trade-?off|optimi[sz])\b/i.test(text);
    return {
      level: deep ? "xhigh" : "high",
      confidence: deep ? 0.85 : 0.8,
      reason: deep ? "deep planning, security, or root-cause task" : "planning or review task",
    };
  }

  if (DEESCALATE.test(text) && text.length < SHORT_PROMPT_CHARS) {
    return { level: "minimal", confidence: 0.75, reason: "short mechanical task" };
  }

  return { level: "medium", confidence: 0.55, reason: "general task" };
}

/**
 * Model capability check.
 *
 * Delegates to Pi's own `getSupportedThinkingLevels` rather than re-deriving
 * the rule. Pi's semantics are not what a naive reading of `thinkingLevelMap`
 * suggests, and the catalogs use all three shapes:
 *
 * - a `null` value marks the level unsupported;
 * - for `xhigh`/`max`, an **absent** key also means unsupported;
 * - for every other level, an absent key means identity-mapped and supported;
 * - a non-reasoning model supports only `off`.
 *
 * Reimplementing this produced 15 divergences against Pi in a spot check, so
 * the check is delegated instead of duplicated.
 */
export function isLevelSupported(model: Model<any> | undefined, level: ThinkingLevel): boolean {
  if (!model) return false;
  return (getSupportedThinkingLevels(model) as string[]).includes(level);
}

/** The level Pi would actually apply, after clamping to model capability. */
export function effectiveLevel(model: Model<any> | undefined, level: ThinkingLevel): ThinkingLevel {
  if (!model) return "off";
  return clampThinkingLevel(model, level) as ThinkingLevel;
}

/**
 * Budget-based Anthropic thinking makes the level part of the cache key, so
 * changing it mid-conversation is a cache miss. Adaptive thinking does not.
 */
export function breaksCacheOnChange(model: Model<any> | undefined): boolean {
  if (!model) return false;
  if (model.api !== "anthropic-messages") return false;
  const compat = model.compat as { forceAdaptiveThinking?: boolean } | undefined;
  return compat?.forceAdaptiveThinking !== true;
}

export interface ThinkingRouteResult {
  changed: boolean;
  level: ThinkingLevel;
  previous?: ThinkingLevel;
  need: ThinkingNeed;
  skipped?: "disabled" | "busy" | "unsupported" | "cache-hostile" | "unchanged" | "error";
  reason: string;
}

export class AutoThinkingRouter {
  public enabled: boolean;
  private running = false;
  public last?: ThinkingRouteResult;

  constructor(private pi: ExtensionAPI, enabled = false) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public async route(prompt: string, ctx: ExtensionContext): Promise<ThinkingRouteResult> {
    const need = classifyThinkingNeed(prompt);
    const base: ThinkingRouteResult = { changed: false, level: need.level, need, reason: need.reason };
    if (!this.enabled) return { ...base, skipped: "disabled" };
    if (this.running) return { ...base, skipped: "busy" };

    this.running = true;
    try {
      const model = ctx.model;
      const previous = ctx.thinkingLevel;

      // Ask for what the model can actually do. `setThinkingLevel` clamps too,
      // but clamping here keeps the reported level and the cache-hostility check
      // honest about what will really be applied.
      const level = effectiveLevel(model, need.level);
      if (!isLevelSupported(model, level)) {
        return { ...base, previous, skipped: "unsupported", reason: `model does not support thinking level "${need.level}"` };
      }
      if (breaksCacheOnChange(model) && previous && previous !== level) {
        return { ...base, previous, level, skipped: "cache-hostile", reason: "budget-based Anthropic thinking makes the level part of the cache key" };
      }
      if (previous === level) return { ...base, previous, level, skipped: "unchanged" };

      try {
        this.pi.setThinkingLevel(level);
        return { ...base, level, changed: true, previous };
      } catch (error) {
        return { ...base, previous, level, skipped: "error", reason: `thinking level change failed: ${(error as any)?.message ?? error}` };
      }
    } finally {
      this.running = false;
    }
  }

  public observe(level: ThinkingLevel, previousLevel: ThinkingLevel): void {
    this.last = {
      changed: true,
      level,
      previous: previousLevel,
      need: { level, confidence: 1, reason: "external change" },
      reason: "level changed outside the router",
    };
  }
}
