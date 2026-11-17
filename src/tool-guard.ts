import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";
import { isJevTool } from "./types.js";

const DESTRUCTIVE_BASH_PATTERN =
  /\b(rm\s+-[a-z]*(?:r[a-z]*f|f[a-z]*r)|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|git\s+push\s+(?:--force|-f)\b|mkfs|dd\s+if=|drop\s+(?:table|database)|truncate\s+table)\b/i;

export interface ToolCallCheckResult {
  valid: boolean;
  blocked?: boolean;
  reason?: string;
  probability?: number;
  elapsedMs: number;
}

export class ToolGuard {
  public enabled: boolean;

  constructor(
    private pi: ExtensionAPI,
    private jevClient: JevClient,
    enabled = false
  ) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public install(): void {
    this.pi.on("tool_call", async (event, ctx) => {
      if (!this.enabled || !this.jevClient.isConfigured()) return;
      if (isJevTool(event.toolName)) return;

      const check = await this.checkToolCall(event.toolName, event.input, ctx, ctx.signal);
      if (check.blocked) {
        ctx.ui.setStatus("jev", `jev: blocked hallucinated ${event.toolName}`);
        return {
          block: true,
          reason: check.reason ?? "Blocked by Jev tool-guard: hallucinated or invalid tool arguments detected.",
        };
      }
    });

    this.pi.on("tool_result", async (event, ctx) => {
      if (!this.enabled || !this.jevClient.isConfigured()) return;
      if (isJevTool(event.toolName)) return;
      if (!event.isError) return;

      const enhancement = await this.enhanceErrorResult(event.toolName, event.input, event.content, ctx, ctx.signal);
      if (enhancement) {
        return {
          content: [
            ...event.content,
            { type: "text" as const, text: `\n[Jev Anti-Hallucination Guidance]: ${enhancement}` },
          ],
        };
      }
    });
  }

  public async checkToolCall(
    toolName: string,
    input: unknown,
    ctx?: ExtensionContext,
    signal?: AbortSignal
  ): Promise<ToolCallCheckResult> {
    const startTime = Date.now();
    if (!this.enabled || !this.jevClient.isConfigured() || isJevTool(toolName)) {
      return { valid: true, elapsedMs: 0 };
    }

    try {
      const command =
        toolName === "bash" && input && typeof input === "object" && typeof (input as any).command === "string"
          ? (input as any).command
          : undefined;
      const checkDestructive = Boolean(command && DESTRUCTIVE_BASH_PATTERN.test(command));

      const questions: Record<string, { type: "noul"; instructions: string }> = {
        is_hallucinated: {
          type: "noul",
          instructions: `Does this tool call to '${toolName}' contain hallucinated, fabricated, or nonsensical parameters/paths?`,
        },
      };
      if (checkDestructive) {
        questions.is_destructive = {
          type: "noul",
          instructions:
            "Does this bash command perform an irreversible or destructive action (such as deleting files, overwriting git history, or dropping data)?",
        };
      }

      const response = await this.jevClient.evaluate(
        {
          state: {
            tool: toolName,
            parameters: input,
          },
          questions,
        },
        signal
      );

      const prob = Number(response.answers["is_hallucinated"]?.value ?? 0);
      const isHallucinated = prob >= 0.85;
      if (isHallucinated) {
        return {
          valid: false,
          blocked: true,
          reason: `Jev tool-guard detected hallucinated parameters in ${toolName} call (P=${prob.toFixed(2)}). Check arguments against actual environment.`,
          probability: prob,
          elapsedMs: Date.now() - startTime,
        };
      }

      if (checkDestructive) {
        const destructProb = Number(response.answers["is_destructive"]?.value ?? 0);
        if (destructProb >= 0.8) {
          if (ctx?.hasUI && typeof ctx?.ui?.confirm === "function") {
            const confirmed = await ctx.ui.confirm(
              "Jev Tool Guard",
              `Allow potentially destructive command (P=${destructProb.toFixed(2)}): ${command}?`
            );
            if (confirmed) {
              return {
                valid: true,
                probability: prob,
                elapsedMs: Date.now() - startTime,
              };
            }
          }
          return {
            valid: false,
            blocked: true,
            reason: `Jev tool-guard blocked destructive command in ${toolName} (P=${destructProb.toFixed(2)}).`,
            probability: destructProb,
            elapsedMs: Date.now() - startTime,
          };
        }
      }

      return {
        valid: true,
        probability: prob,
        elapsedMs: Date.now() - startTime,
      };
    } catch {
      // Fail open on evaluation error
      return { valid: true, elapsedMs: Date.now() - startTime };
    }
  }

  public async enhanceErrorResult(
    toolName: string,
    input: unknown,
    content: unknown[],
    _ctx?: ExtensionContext,
    signal?: AbortSignal
  ): Promise<string | null> {
    if (!this.enabled || !this.jevClient.isConfigured()) return null;

    try {
      const errorText = JSON.stringify(content);
      const response = await this.jevClient.evaluate(
        {
          state: {
            tool: toolName,
            input,
            error: errorText,
          },
          questions: {
            error_category: {
              type: "choice",
              instructions: "What is the primary root cause of this tool execution failure?",
              criteria: {
                missing_file: "File or directory path does not exist (potential hallucinated path)",
                syntax_flag: "Invalid command syntax, unknown flags, or bad parameter structure",
                permission_env: "Permission denied or missing environment dependency",
                runtime_other: "Expected runtime logic failure or test failure",
              },
            },
          },
        },
        signal
      );

      const cause = String(response.answers["error_category"]?.value ?? "");
      if (cause === "missing_file") {
        return "Path not found. Verify actual workspace files with ls/find before guessing paths.";
      }
      if (cause === "syntax_flag") {
        return "Invalid syntax or flag options. Check command/tool specification before retrying.";
      }
      return null;
    } catch {
      return null;
    }
  }
}
