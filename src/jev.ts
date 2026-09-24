import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  JevEvaluationRequest,
  JevEvaluationResponse,
  JevAnswerResult,
  JevSessionStats,
  QuestionConfig,
} from "./types.js";

export type ApiKeySource = "env" | "file";

export function resolveBaseURL(): string | null {
  return process.env.PI_JEV_BASE_URL?.trim() || process.env.TYPESAFE_BASE_URL?.trim() || null;
}

/** Resolve the API key together with where it came from, for status reporting. */
export function resolveApiKeySource(): { key: string; source: ApiKeySource; origin: string } | null {
  const envKey = process.env.TYPESAFE_API_KEY?.trim();
  if (envKey) return { key: envKey, source: "env", origin: "$TYPESAFE_API_KEY" };

  const defaultSecretPath = path.join(
    os.homedir(),
    ".pi",
    "agent",
    "secrets",
    "typesafe_api_key"
  );
  if (fs.existsSync(defaultSecretPath)) {
    try {
      const content = fs.readFileSync(defaultSecretPath, "utf8").trim();
      if (content) {
        return { key: content, source: "file", origin: "~/.pi/agent/secrets/typesafe_api_key" };
      }
    } catch {
      // Ignore read errors
    }
  }

  return null;
}

function resolveApiKey(): string | null {
  return resolveApiKeySource()?.key ?? null;
}

export class JevClient {
  private client: TypeSafeClient | null = null;
  private apiKey: string | null = null;
  private apiKeySetInSession = false;
  private baseURL: string | null = null;
  public stats: JevSessionStats = {
    requestsCount: 0,
    totalTokens: 0,
  };

  constructor() {
    this.apiKey = resolveApiKey();
    this.baseURL = resolveBaseURL();
  }

  public isConfigured(): boolean {
    return Boolean(resolveApiKeySource() || this.apiKey || this.getBaseURL());
  }

  /** Human-readable description of where the API key came from, or null when unconfigured. */
  public getKeyOrigin(): string | null {
    if (this.apiKeySetInSession) return "set in-session";
    return resolveApiKeySource()?.origin ?? null;
  }

  public getBaseURL(): string | null {
    return resolveBaseURL() || this.baseURL;
  }

  public setApiKey(key: string): void {
    this.apiKey = key;
    this.apiKeySetInSession = true;
    this.client = null;
  }

  private getClient(): TypeSafeClient {
    const key = resolveApiKey() || this.apiKey;
    const baseURL = this.getBaseURL();
    if (!key && !baseURL) {
      throw new Error("Missing TYPESAFE_API_KEY. Set it in environment, ~/.pi/agent/secrets/typesafe_api_key, or set PI_JEV_BASE_URL for a compatible local endpoint.");
    }
    if (!this.client) {
      this.client = new TypeSafeClient({ apiKey: key ?? "", ...(baseURL ? { baseURL } : {}) });
    }
    return this.client;
  }

  public async evaluate(
    request: JevEvaluationRequest,
    signal?: AbortSignal
  ): Promise<JevEvaluationResponse> {
    const startTime = Date.now();
    const client = this.getClient();

    const formattedQuestions: Record<string, any> = {};
    for (const [id, q] of Object.entries(request.questions)) {
      if (q.type === "choice") {
        formattedQuestions[id] = choice(q.instructions, q.criteria);
      } else if (q.type === "noul") {
        formattedQuestions[id] = noul(q.instructions);
      } else if (q.type === "score") {
        formattedQuestions[id] = score(q.instructions, q.criteria as any);
      }
    }

    const statePayload: any =
      typeof request.state === "string" ? { text: request.state } : request.state;

    try {
      const response: any = await client.systemOne({
        state: statePayload,
        questions: formattedQuestions,
        model: request.model,
      }, { signal });

      const elapsedMs = Date.now() - startTime;
      this.stats.requestsCount += 1;
      const usage = response.usage;
      this.stats.totalTokens += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
      this.stats.lastElapsedMs = elapsedMs;

      const answers: Record<string, JevAnswerResult> = {};
      for (const [id, rawAns] of Object.entries(response.answers || {})) {
        const qConfig = request.questions[id];
        if (!qConfig) continue;

        if (qConfig.type === "choice") {
          const c = (rawAns as any).choice ?? (rawAns as any).value;
          answers[id] = {
            type: "choice",
            value: c,
            confidence: (rawAns as any).confidence,
            distribution: (rawAns as any).distribution,
            raw: rawAns,
          };
        } else if (qConfig.type === "noul") {
          const prob = (rawAns as any).noul ?? (rawAns as any).probability ?? (rawAns as any).value ?? 0;
          answers[id] = {
            type: "noul",
            value: prob,
            raw: rawAns,
          };
        } else if (qConfig.type === "score") {
          const s = (rawAns as any).score ?? (rawAns as any).value ?? 0;
          answers[id] = {
            type: "score",
            value: s,
            confidence: (rawAns as any).confidence,
            raw: rawAns,
          };
        }
      }

      return {
        answers,
        model: response.model || "jev-latest",
        usage: response.usage,
        elapsedMs,
      };
    } catch (err: any) {
      this.stats.lastError = err?.message || String(err);
      throw err;
    }
  }
}
