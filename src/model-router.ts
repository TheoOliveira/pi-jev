import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

export type ModelProfile = "fast" | "balanced" | "reasoning" | "long-context" | "vision";
export type ModelErrorKind = "quota" | "rate-limit" | "context-limit" | "unavailable" | "timeout" | "auth" | "unknown";

export interface ModelRouteResult {
  changed: boolean;
  profile: ModelProfile;
  model?: Model<any>;
  reason: string;
  skipped?: "disabled" | "busy" | "no-model" | "low-confidence" | "error";
}

const PROFILE_HINTS: Record<ModelProfile, RegExp> = {
  fast: /^(hi|hello|list|rename|format|small|simple|quick|what is|how do i)/i,
  reasoning: /\b(plan|planning|architect|architecture|debug|diagnos|compare|trade-?off|design|review|security|why|analy[sz]|complex|refactor)\b/i,
  "long-context": /\b(full repo|entire repo|large diff|long document|all files|context|migration|codebase|many files)\b/i,
  vision: /\b(image|screenshot|photo|diagram|visual|picture|ui mockup|wireframe)\b/i,
  balanced: /.*/,
};

export function classifyModelNeed(prompt: string, contextChars = 0, hasImages = false): { profile: ModelProfile; confidence: number; reason: string } {
  if (hasImages || PROFILE_HINTS.vision.test(prompt)) return { profile: "vision", confidence: 0.95, reason: "image input or visual task" };
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

function modelScore(model: Model<any>, profile: ModelProfile, contextChars: number, hasImages: boolean): number {
  const image = model.input?.includes("image") ? 4 : 0;
  const reasoning = model.reasoning ? 3 : 0;
  const context = Math.min(model.contextWindow / 100_000, 5);
  if (hasImages && !model.input?.includes("image")) return -100;
  if (profile === "vision") return image * 10 + reasoning;
  if (profile === "long-context") return context * 10 + image + reasoning;
  if (profile === "reasoning") return reasoning * 10 + context + image;
  if (profile === "fast") return (model.reasoning ? 0 : 3) + (model.cost?.input ?? 0) * -0.01;
  return reasoning + context + image;
}

export class AutoModelRouter {
  public enabled: boolean;
  private running = false;
  private blocked = new Map<string, number>();
  public last?: ModelRouteResult;

  constructor(private pi: ExtensionAPI, enabled = false) {
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

  public async route(prompt: string, ctx: ExtensionContext, options: { hasImages?: boolean } = {}): Promise<ModelRouteResult> {
    const current = ctx.model;
    const fallback: ModelRouteResult = { changed: false, profile: "balanced", reason: "model selection skipped" };
    if (!this.enabled) return { ...fallback, skipped: "disabled" };
    if (this.running) return { ...fallback, skipped: "busy" };
    if (!prompt.trim()) return { ...fallback, skipped: "low-confidence" };

    this.running = true;
    try {
      const contextChars = (ctx.getSystemPrompt?.() ?? "").length;
      const need = classifyModelNeed(prompt, contextChars, Boolean(options.hasImages));
      if (need.confidence < 0.6) return { ...fallback, profile: need.profile, reason: need.reason, skipped: "low-confidence" };

      const models = (ctx.scopedModels?.length ? ctx.scopedModels.map((x) => x.model) : ctx.modelRegistry.getAvailable())
        .filter((model) => !this.blocked.get(`${model.provider}/${model.id}`) || (this.blocked.get(`${model.provider}/${model.id}`) ?? 0) < Date.now());
      const target = models.sort((a, b) => modelScore(b, need.profile, contextChars, Boolean(options.hasImages)) - modelScore(a, need.profile, contextChars, Boolean(options.hasImages)))[0];
      if (!target) return { ...fallback, profile: need.profile, reason: "no compatible model", skipped: "no-model" };
      if (current?.provider === target.provider && current?.id === target.id) return { changed: false, profile: need.profile, model: target, reason: need.reason };

      try {
        await this.pi.setModel(target);
        return { changed: true, profile: need.profile, model: target, reason: need.reason };
      } catch (error) {
        const kind = classifyModelError(error);
        this.blocked.set(`${target.provider}/${target.id}`, Date.now() + (kind === "rate-limit" || kind === "quota" ? 600_000 : 60_000));
        return { changed: false, profile: need.profile, model: current, reason: `model switch failed: ${kind}`, skipped: "error" };
      }
    } catch {
      return { ...fallback, skipped: "error" };
    } finally {
      this.running = false;
    }
  }
}
