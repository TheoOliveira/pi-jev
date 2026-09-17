import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";
import { JEV_TOOL_NAMES, isJevTool } from "./types.js";
import { JEV_THRESHOLD } from "./skills.js";

export interface ToolMetadata {
  name: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export interface RouterResult {
  query: string;
  candidates: string[];
  activated: string[];
  probabilities: Record<string, number>;
  fallbackUsed: boolean;
  elapsedMs: number;
}

export class ToolRouter {
  private pi: ExtensionAPI;
  private jevClient: JevClient;
  private managedTools = new Set<string>();

  constructor(pi: ExtensionAPI, jevClient: JevClient) {
    this.pi = pi;
    this.jevClient = jevClient;
  }

  public getAvailableTools(): ToolMetadata[] {
    const all = this.pi.getAllTools();
    return all.map((t: any) => ({
      name: t.name,
      description: t.description,
      promptSnippet: t.promptSnippet,
      promptGuidelines: t.promptGuidelines,
    }));
  }

  public shortlist(query: string, limit = 8): ToolMetadata[] {
    const active = new Set(this.pi.getActiveTools());
    const all = this.getAvailableTools();

    const inactive = all.filter((t) => !active.has(t.name) && !isJevTool(t.name));
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

    if (terms.length === 0) {
      return inactive.slice(0, limit);
    }

    const scored = inactive.map((tool) => {
      const text = `${tool.name} ${tool.description || ""} ${tool.promptSnippet || ""}`.toLowerCase();
      let matchCount = 0;
      for (const term of terms) {
        if (text.includes(term)) matchCount += 1;
      }
      return { tool, score: matchCount };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.tool);
  }

  public async findAndActivate(
    query: string,
    threshold = JEV_THRESHOLD,
    signal?: AbortSignal
  ): Promise<RouterResult> {
    const startTime = Date.now();
    const candidates = this.shortlist(query, 10);
    const candidateNames = candidates.map((c) => c.name);

    if (candidates.length === 0) {
      return {
        query,
        candidates: [],
        activated: [],
        probabilities: {},
        fallbackUsed: false,
        elapsedMs: Date.now() - startTime,
      };
    }

    const probabilities: Record<string, number> = {};
    const activated: string[] = [];
    let fallbackUsed = false;

    if (this.jevClient.isConfigured()) {
      try {
        const questions: Record<string, any> = {};
        for (const c of candidates) {
          questions[c.name] = {
            type: "noul",
            instructions: `Does the tool '${c.name}' (${c.description || "no description"}) directly help accomplish this task: "${query}"?`,
          };
        }

        const res = await this.jevClient.evaluate(
          {
            state: { task: query, tools: candidates },
            questions,
          },
          signal
        );

        for (const [toolName, ans] of Object.entries(res.answers)) {
          const prob = typeof ans.value === "number" ? ans.value : 0;
          probabilities[toolName] = prob;
          if (prob >= threshold) {
            activated.push(toolName);
          }
        }
      } catch (err) {
        fallbackUsed = true;
      }
    } else {
      fallbackUsed = true;
    }

    if (fallbackUsed) {
      for (const c of candidates.slice(0, 3)) {
        activated.push(c.name);
        probabilities[c.name] = 1.0;
      }
    }

    if (activated.length > 0) {
      const currentActive = this.pi.getActiveTools();
      const updated = Array.from(new Set([...currentActive, ...activated]));
      this.pi.setActiveTools(updated);
    }

    return {
      query,
      candidates: candidateNames,
      activated,
      probabilities,
      fallbackUsed,
      elapsedMs: Date.now() - startTime,
    };
  }
}
