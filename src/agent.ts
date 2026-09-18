import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";
import type { QuestionConfig, JevEvaluationResponse } from "./types.js";

const RPC_REQUEST = "subagents:rpc:v1:request";
const RPC_REPLY = "subagents:rpc:v1:reply:";

export interface JevAgentTaskParams {
  task?: string;
  state?: string | Record<string, unknown>;
  type?: "choice" | "noul" | "score";
  instructions?: string;
  criteria?: any;
  questions?: Record<string, QuestionConfig>;
  model?: string;
}

export interface JevAgentResult {
  success: boolean;
  model: string;
  answers: Record<string, any>;
  primaryValue?: any;
  elapsedMs: number;
  usage?: any;
  error?: string;
}

export async function executeJevAgentTask(
  params: JevAgentTaskParams,
  client: JevClient,
  signal?: AbortSignal
): Promise<JevAgentResult> {
  if (!client.isConfigured()) {
    throw new Error("TypeSafe Jev API key unconfigured. Set TYPESAFE_API_KEY.");
  }

  let questions: Record<string, QuestionConfig> = {};
  const state = params.state ?? params.task ?? "No state provided";

  if (params.questions && Object.keys(params.questions).length > 0) {
    questions = params.questions;
  } else if (params.type === "choice") {
    questions["judgment"] = {
      type: "choice",
      instructions: params.instructions || params.task || "Categorize state",
      criteria: params.criteria || { yes: null, no: null },
    };
  } else if (params.type === "score") {
    questions["judgment"] = {
      type: "score",
      instructions: params.instructions || params.task || "Score state",
      criteria: Array.isArray(params.criteria) ? params.criteria : ["poor", "acceptable", "good"],
    };
  } else {
    // Default to noul (probability / binary check)
    questions["judgment"] = {
      type: "noul",
      instructions: params.instructions || params.task || "Evaluate state",
      criteria: typeof params.criteria === "string" ? params.criteria : undefined,
    };
  }

  const response: JevEvaluationResponse = await client.evaluate(
    {
      state,
      questions,
      model: params.model,
    },
    signal
  );

  const primaryAnswer = response.answers["judgment"] ?? Object.values(response.answers)[0];

  return {
    success: true,
    model: response.model,
    answers: response.answers,
    primaryValue: primaryAnswer?.value,
    elapsedMs: response.elapsedMs,
    usage: response.usage,
  };
}

export class JevAgentHandler {
  constructor(private pi: ExtensionAPI, private jevClient: JevClient) {}

  public install(): void {
    // Listen for subagent RPC calls directed at agent 'jev' or 'typesafe-jev'
    this.pi.events.on(RPC_REQUEST, async (req: any) => {
      if (!req || req.version !== 1) return;
      const targetAgent = req.params?.agent || req.params?.agentType;
      if (targetAgent !== "jev" && targetAgent !== "typesafe-jev") return;

      const requestId = req.requestId;
      const replyEvent = `${RPC_REPLY}${requestId}`;

      try {
        const taskParams: JevAgentTaskParams = {
          task: req.params?.task,
          state: req.params?.state ?? req.params?.args?.state,
          type: req.params?.type ?? req.params?.args?.type,
          instructions: req.params?.instructions ?? req.params?.args?.instructions,
          criteria: req.params?.criteria ?? req.params?.args?.criteria,
          questions: req.params?.questions ?? req.params?.args?.questions,
          model: req.params?.model ?? req.params?.args?.model,
        };

        const result = await executeJevAgentTask(taskParams, this.jevClient);
        this.pi.events.emit(replyEvent, {
          success: true,
          data: {
            id: `jev-${Date.now()}`,
            output: JSON.stringify(result, null, 2),
            result,
          },
        });
      } catch (err: any) {
        this.pi.events.emit(replyEvent, {
          success: false,
          error: { message: err?.message || String(err) },
        });
      }
    });
  }
}
