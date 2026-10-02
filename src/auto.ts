import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";
import type { ToolRouter } from "./router.js";
import type { SkillRouter } from "./skills.js";
import { JEV_THRESHOLD, skillApplicabilityQuestion } from "./skills.js";
import type { QuestionConfig } from "./types.js";

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
    private jevClient: Pick<JevClient, "isConfigured" | "evaluate">,
    private router: Pick<ToolRouter, "shortlist" | "activateTools">,
    private skillRouter: Pick<SkillRouter, "getAvailableSkills" | "shortlist">,
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
      const toolCandidates = this.router.shortlist(prompt, 10);
      const skillCandidates = this.skillRouter.shortlist(
        this.skillRouter.getAvailableSkills(ctx),
        prompt,
        12
      );
      const questions: Record<string, QuestionConfig> = {};

      for (const c of toolCandidates) {
        questions[`tool:${c.name}`] = {
          type: "noul",
          instructions: `Does the tool '${c.name}' (${c.description || "no description"}) directly help accomplish this task: "${prompt}"?`,
        };
      }
      for (const [index, s] of skillCandidates.entries()) {
        questions[`skill:${s.name}`] = skillApplicabilityQuestion(index);
      }

      const answers = Object.keys(questions).length === 0
        ? {}
        : (await this.jevClient.evaluate(
            {
              state: { task: prompt, tools: toolCandidates, available_skills: skillCandidates },
              questions,
            },
            signal
          )).answers;

      const activated = toolCandidates
        .filter((c) => {
          const value = answers[`tool:${c.name}`]?.value;
          return typeof value === "number" && value >= JEV_THRESHOLD;
        })
        .map((c) => c.name);
      this.router.activateTools(activated);

      const skills = skillCandidates
        .map((s) => ({
          name: s.name,
          probability: answers[`skill:${s.name}`]?.value,
        }))
        .filter((s): s is { name: string; probability: number } =>
          typeof s.probability === "number" && s.probability >= JEV_THRESHOLD
        )
        .sort((a, b) => b.probability - a.probability);

      return {
        ran: true,
        activated,
        skills,
        elapsedMs: Date.now() - startTime,
      };
    } catch {
      return skip("error");
    } finally {
      this.running = false;
    }
  }
}
