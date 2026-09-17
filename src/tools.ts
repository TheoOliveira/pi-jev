import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { JevClient } from "./jev.js";
import type { ToolRouter } from "./router.js";
import type { QuestionConfig } from "./types.js";

export function registerJevTools(
  pi: ExtensionAPI,
  jevClient: JevClient,
  router: ToolRouter
): void {
  // 1. Tool router tool: jev_find_tools
  pi.registerTool({
    name: "jev_find_tools",
    label: "Jev Tool Finder",
    description:
      "Find and additively activate registered Pi tools needed for a task using TypeSafe Jev semantic evaluation.",
    promptSnippet: "Search and dynamically activate specialized tools for current task",
    promptGuidelines: [
      "Use jev_find_tools when current active tools cannot accomplish the user request.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "The action, capability, or user task you need tools for.",
      }),
      threshold: Type.Optional(
        Type.Number({
          description: "Activation confidence threshold between 0.0 and 1.0 (default 0.65).",
        })
      ),
    }),
    async execute(_toolCallId, params: any, signal, onUpdate) {
      onUpdate?.({
        content: [{ type: "text", text: `Evaluating candidate tools for: "${params.query}"...` }],
        details: {},
      });

      const result = await router.findAndActivate(
        params.query,
        params.threshold ?? 0.65,
        signal
      );

      let summaryText = "";
      if (result.activated.length > 0) {
        summaryText = `Activated tools: ${result.activated.join(", ")}`;
      } else if (result.candidates.length > 0) {
        summaryText = `No tools met the activation threshold among candidates: ${result.candidates.join(", ")}`;
      } else {
        summaryText = `No matching inactive tools found.`;
      }

      if (result.fallbackUsed) {
        summaryText += " (Note: local heuristic shortlist used due to Jev unconfigured/offline)";
      }

      return {
        content: [{ type: "text", text: summaryText }],
        details: result,
      };
    },
  });

  // 2. Typed evaluation tool: jev_evaluate
  pi.registerTool({
    name: "jev_evaluate",
    label: "Jev Evaluate",
    description:
      "Ask TypeSafe Jev System One typed questions (choice, noul, score) about structured state. Returns calibrated probabilities.",
    promptSnippet: "Perform fast calibrated structured decisions and classifications over state",
    promptGuidelines: [
      "Use jev_evaluate when you need structured probability, categorical choice, or scored rubric decisions rather than text generation.",
    ],
    parameters: Type.Object({
      state: Type.Any({ description: "Target context, text, or structured JSON to evaluate" }),
      questions: Type.Record(
        Type.String(),
        Type.Object({
          type: Type.Union([
            Type.Literal("choice"),
            Type.Literal("noul"),
            Type.Literal("score"),
          ]),
          instructions: Type.String({ description: "The judgment instruction/question" }),
          criteria: Type.Optional(Type.Any({ description: "Options, yes/no criterion, or rubric levels" })),
        })
      ),
      model: Type.Optional(Type.String({ description: "Jev model identifier (default: jev-latest)" })),
    }),
    async execute(_toolCallId, params: any, signal, onUpdate) {
      if (!jevClient.isConfigured()) {
        throw new Error(
          "TypeSafe Jev API key is not configured. Set TYPESAFE_API_KEY environment variable or run /jev login."
        );
      }

      onUpdate?.({
        content: [{ type: "text", text: "Querying TypeSafe Jev model..." }],
        details: {},
      });

      const questions: Record<string, QuestionConfig> = {};
      for (const [id, q] of Object.entries(params.questions as Record<string, any>)) {
        questions[id] = {
          type: q.type,
          instructions: q.instructions,
          criteria: q.criteria,
        };
      }

      const response = await jevClient.evaluate(
        {
          state: params.state,
          questions,
          model: params.model,
        },
        signal
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.answers, null, 2),
          },
        ],
        details: response,
      };
    },
  });
}
