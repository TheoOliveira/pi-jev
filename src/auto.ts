import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";
import type { ToolRouter } from "./router.js";
import type { SkillRouter } from "./skills.js";
import { JEV_THRESHOLD } from "./skills.js";

export type AutoSkipReason =
  | "disabled"
  | "unconfigured"
  | "busy"
  | "empty-prompt"
  | "error";

export interface AutoRouteResult {
  ran: boolean;
  reason?: AutoSkipReason;
  activated: string[];
  skills: Array<{ name: string; probability: number }>;
  elapsedMs: number;
}

export { JEV_THRESHOLD };

/**
 * Automatic Jev usage: runs one routing pass per user prompt before the agent starts.
 * Only active when explicitly enabled, and only when Jev is configured.
 */
export class AutoJev {
  public enabled: boolean;
  private running = false;

  constructor(
    private jevClient: JevClient,
    private router: ToolRouter,
    private skillRouter: SkillRouter,
    enabled = false
  ) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Never throws: automatic routing must not break the agent turn. */
  public async route(
    prompt: string,
    ctx?: ExtensionContext,
    signal?: AbortSignal
  ): Promise<AutoRouteResult> {
    const startTime = Date.now();
    const skip = (reason: AutoSkipReason): AutoRouteResult => ({
      ran: false,
      reason,
      activated: [],
      skills: [],
      elapsedMs: Date.now() - startTime,
    });

    if (!this.enabled) return skip("disabled");
    if (this.running) return skip("busy");
    if (!prompt || !prompt.trim() || prompt.trim().startsWith("/")) {
      return skip("empty-prompt");
    }
    if (!this.jevClient.isConfigured()) return skip("unconfigured");

    this.running = true;
    try {
      const [tools, skills] = await Promise.all([
        this.router.findAndActivate(prompt, JEV_THRESHOLD, signal),
        this.skillRouter.findSkills(prompt, JEV_THRESHOLD, ctx, signal),
      ]);

      return {
        ran: true,
        activated: tools.activated,
        skills: skills.recommended.map((s) => ({
          name: s.name,
          probability: s.probability,
        })),
        elapsedMs: Date.now() - startTime,
      };
    } catch {
      return skip("error");
    } finally {
      this.running = false;
    }
  }
}
