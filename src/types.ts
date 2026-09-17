export type QuestionType = "choice" | "noul" | "score";

/** Tools this extension owns. Never offered as router candidates and toggled together. */
export const JEV_TOOL_NAMES = ["jev_find_tools", "jev_find_skill", "jev_evaluate"] as const;

export function isJevTool(name: string): boolean {
  return (JEV_TOOL_NAMES as readonly string[]).includes(name);
}

export interface BaseQuestionConfig {
  instructions: string;
}

export interface ChoiceQuestionConfig extends BaseQuestionConfig {
  type: "choice";
  criteria: Record<string, string | null>;
}

export interface NoulQuestionConfig extends BaseQuestionConfig {
  type: "noul";
  criteria?: string;
}

export interface ScoreQuestionConfig extends BaseQuestionConfig {
  type: "score";
  criteria: string[];
}

export type QuestionConfig = ChoiceQuestionConfig | NoulQuestionConfig | ScoreQuestionConfig;

export interface JevEvaluationRequest {
  state: Record<string, unknown> | string;
  questions: Record<string, QuestionConfig>;
  model?: string;
}

export interface JevAnswerResult {
  type: QuestionType;
  value: string | number | boolean;
  confidence?: number;
  distribution?: Record<string, number>;
  raw?: unknown;
}

export interface JevEvaluationResponse {
  answers: Record<string, JevAnswerResult>;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  elapsedMs: number;
}

export interface JevSessionStats {
  requestsCount: number;
  totalTokens: number;
  lastElapsedMs?: number;
  lastError?: string;
}
