import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { JevEvaluationRequest, QuestionConfig } from "./types.js";

/** Upper bound on questions sent to Jev per designed evaluation. */
export const MAX_DESIGNED_QUESTIONS = 6;

export const DESIGN_SYSTEM_PROMPT = [
  "You design System One evaluations for the TypeSafe Jev model.",
  "Given a user's request, reply with ONLY a JSON object (no prose, no code fence):",
  '{"state": <string or object holding the material to judge>, "questions": {"<snake_case_id>": {"type": "noul"|"choice"|"score", "instructions": "<the judgment>", "criteria": <type-specific>}}}',
  "Rules:",
  `- Use 1 to ${MAX_DESIGNED_QUESTIONS} questions, each independent and answerable from "state" alone.`,
  '- "noul" is a yes/no probability question and must NOT include "criteria".',
  '- "choice" requires "criteria" as an object mapping option keys to descriptions.',
  '- "score" requires "criteria" as an array of rubric levels, highest first.',
  '- "state" must contain concrete, self-contained content: never reference external context.',
].join("\n");

/** Pull the first JSON object out of model text that may include fences or prose. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Validate untrusted model output into a Jev request. Returns null when unusable. */
export function validateDesign(raw: unknown): JevEvaluationRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { state?: unknown; questions?: unknown };

  if (candidate.state === undefined || candidate.state === null) return null;
  const state =
    typeof candidate.state === "string" || typeof candidate.state === "object"
      ? (candidate.state as Record<string, unknown> | string)
      : null;
  if (state === null) return null;

  if (!candidate.questions || typeof candidate.questions !== "object") return null;

  const questions: Record<string, QuestionConfig> = {};
  for (const [id, value] of Object.entries(candidate.questions as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const q = value as { type?: unknown; instructions?: unknown; criteria?: unknown };
    if (typeof q.instructions !== "string" || !q.instructions.trim()) continue;
    if (q.type !== "noul" && q.type !== "choice" && q.type !== "score") continue;

    if (q.type === "noul") {
      questions[id] = { type: "noul", instructions: q.instructions };
      continue;
    }

    if (q.type === "choice") {
      if (!q.criteria || typeof q.criteria !== "object" || Array.isArray(q.criteria)) continue;
      if (Object.keys(q.criteria as object).length === 0) continue;
      questions[id] = {
        type: "choice",
        instructions: q.instructions,
        criteria: q.criteria as Record<string, string | null>,
      };
      continue;
    }

    if (!Array.isArray(q.criteria) || q.criteria.length === 0) continue;
    questions[id] = {
      type: "score",
      instructions: q.instructions,
      criteria: q.criteria as string[],
    };
  }

  if (Object.keys(questions).length === 0) return null;
  return { state, questions };
}

/**
 * Ask the session's active model to design a Jev evaluation for a free-form prompt.
 * Throws with a user-facing message when no model, auth, or usable design is available.
 */
export async function designEvaluation(
  ctx: ExtensionCommandContext,
  prompt: string,
  signal?: AbortSignal
): Promise<JevEvaluationRequest> {
  const model = ctx.model;
  if (!model) throw new Error("No active model available to design the evaluation.");
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`No authentication configured for ${model.provider}/${model.id}.`);
  }

  const response = await ctx.modelRegistry.complete(
    model,
    {
      systemPrompt: DESIGN_SYSTEM_PROMPT,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: prompt }],
          timestamp: Date.now(),
        },
      ],
    },
    { signal, cacheRetention: "none" }
  );

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const designed = validateDesign(extractJson(text));
  if (!designed) {
    throw new Error("Model did not return a usable Jev question schema. Try rephrasing the prompt.");
  }
  return designed;
}
