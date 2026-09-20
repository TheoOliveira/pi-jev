import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";
import { isJevTool } from "./types.js";

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
    _ctx?: ExtensionContext,
    signal?: AbortSignal
  ): Promise<ToolCallCheckResult> {
    const startTime = Date.now();
    if (!this.enabled || !this.jevClient.isConfigured() || isJevTool(toolName)) {
      return { valid: true, elapsedMs: 0 };
    }

    try {
      const response = await this.jevClient.evaluate(
        {
          state: {
            tool: toolName,
            parameters: input,
          },
          questions: {
            is_hallucinated: {
              type: "noul",
              instructions: `Does this tool call to '${toolName}' contain hallucinated, fabricated, or nonsensical parameters/paths?`,
            },
          },
        },
        signal
      );

      const prob = Number(response.answers["is_hallucinated"]?.value ?? 0);
      const isHallucinated = prob >= 0.85;

      return {
        valid: !isHallucinated,
        blocked: isHallucinated,
        reason: isHallucinated
          ? `Jev tool-guard detected hallucinated parameters in ${toolName} call (P=${prob.toFixed(2)}). Check arguments against actual environment.`
          : undefined,
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
