import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";
import type { NoulQuestionConfig, QuestionConfig } from "./types.js";

/** Single activation cutoff for Jev probabilities. Raise to reduce noise, lower for recall. */
export const JEV_THRESHOLD = 0.65;

export interface SkillMetadata {
  name: string;
  description: string;
  location?: string;
}

export interface SkillRouterResult {
  query: string;
  candidates: string[];
  recommended: Array<{
    name: string;
    description: string;
    location?: string;
    probability: number;
  }>;
  fallbackUsed: boolean;
  elapsedMs: number;
}

/** Shared by explicit lookup and batched auto routing. State must contain task and available_skills. */
export function skillApplicabilityQuestion(index: number): NoulQuestionConfig {
  return {
    type: "noul",
    // Judge requested activity and scope, not whether related advice could help.
    // Keep task and skill text in state as evidence.
    instructions: `Does \`task\` request the activity described by \`available_skills[${index}]\`, in the product or framework that skill targets? A shared topic is insufficient. Do not assume a named product is in use when the task does not identify it. Reporting a defect is not a request to configure a different system. Mentioning a skill to investigate its recommendation does not request its workflow.`,
  };
}

export class SkillRouter {
  private pi: Pick<ExtensionAPI, "getCommands">;
  private jevClient: Pick<JevClient, "isConfigured" | "evaluate">;

  constructor(pi: Pick<ExtensionAPI, "getCommands">, jevClient: Pick<JevClient, "isConfigured" | "evaluate">) {
    this.pi = pi;
    this.jevClient = jevClient;
  }

  public getAvailableSkills(ctx?: ExtensionContext | ExtensionCommandContext): SkillMetadata[] {
    const skillsMap = new Map<string, SkillMetadata>();

    // 1. Check systemPromptOptions if available in command context
    if (ctx && "getSystemPromptOptions" in ctx) {
      try {
        const opts = (ctx as ExtensionCommandContext).getSystemPromptOptions();
        if (opts.skills && Array.isArray(opts.skills)) {
          for (const s of opts.skills as any[]) {
            if (s.name && s.description) {
              skillsMap.set(s.name, {
                name: s.name,
                description: s.description,
                location: s.location || s.path,
              });
            }
          }
        }
      } catch {
        // Fall back to commands/prompts inspection
      }
    }

    // 2. Discover from pi.getCommands() which lists skills as source: "skill"
    const commands = this.pi.getCommands();
    for (const cmd of commands) {
      if (cmd.source === "skill" && !skillsMap.has(cmd.name)) {
        skillsMap.set(cmd.name, {
          name: cmd.name,
          description: cmd.description || `Skill for ${cmd.name}`,
          location: cmd.sourceInfo?.path,
        });
      }
    }

    return Array.from(skillsMap.values());
  }

  public shortlist(
    skills: SkillMetadata[],
    query: string,
    limit = 10
  ): SkillMetadata[] {
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (terms.length === 0) {
      return skills.slice(0, limit);
    }

    const scored = skills.map((skill) => {
      const text = `${skill.name} ${skill.description}`.toLowerCase();
      let matchCount = 0;
      for (const term of terms) {
        if (text.includes(term)) matchCount += 1;
      }
      return { skill, score: matchCount };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.skill);
  }

  public async findSkills(
    query: string,
    threshold = JEV_THRESHOLD,
    ctx?: ExtensionContext,
    signal?: AbortSignal
  ): Promise<SkillRouterResult> {
    const startTime = Date.now();
    const allSkills = this.getAvailableSkills(ctx);
    const candidates = this.shortlist(allSkills, query, 12);
    const candidateNames = candidates.map((c) => c.name);

    if (candidates.length === 0) {
      return {
        query,
        candidates: [],
        recommended: [],
        fallbackUsed: false,
        elapsedMs: Date.now() - startTime,
      };
    }

    const recommended: Array<{
      name: string;
      description: string;
      location?: string;
      probability: number;
    }> = [];
    let fallbackUsed = false;

    if (this.jevClient.isConfigured()) {
      try {
        const questions: Record<string, QuestionConfig> = {};
        for (const [index, s] of candidates.entries()) {
          questions[s.name] = skillApplicabilityQuestion(index);
        }

        const res = await this.jevClient.evaluate(
          {
            state: { task: query, available_skills: candidates },
            questions,
          },
          signal
        );

        for (const s of candidates) {
          const ans = res.answers[s.name];
          const prob = typeof ans?.value === "number" ? ans.value : 0;
          if (prob >= threshold) {
            recommended.push({
              name: s.name,
              description: s.description,
              location: s.location,
              probability: prob,
            });
          }
        }
        recommended.sort((a, b) => b.probability - a.probability);
      } catch {
        fallbackUsed = true;
      }
    } else {
      fallbackUsed = true;
    }

    if (fallbackUsed) {
      // Fallback only includes candidates with matching terms, with 0 probability
      const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      for (const c of candidates) {
        const text = `${c.name} ${c.description}`.toLowerCase();
        const matches = terms.some((t) => text.includes(t));
        if (matches) {
          recommended.push({
            name: c.name,
            description: c.description,
            location: c.location,
            probability: 0,
          });
        }
      }
    }

    return {
      query,
      candidates: candidateNames,
      recommended,
      fallbackUsed,
      elapsedMs: Date.now() - startTime,
    };
  }
}
