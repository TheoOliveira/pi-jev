import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const RPC_REQUEST = "subagents:rpc:v1:request";
const RPC_REPLY = "subagents:rpc:v1:reply:";
const ASYNC_COMPLETE = "subagent:async-complete";

export interface OrchestrationResult {
  runId?: string;
  accepted: boolean;
  error?: string;
}

export class AgentOrchestrator {
  public enabled: boolean;
  private running = false;

  constructor(private pi: ExtensionAPI, enabled = false) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void { this.enabled = enabled; }

  public async dispatch(task: string, ctx: ExtensionContext, automatic = false): Promise<OrchestrationResult> {
    if (!this.enabled && automatic) return { accepted: false, error: "disabled" };
    if (this.running) return { accepted: false, error: "busy" };
    if (!task.trim()) return { accepted: false, error: "empty task" };

    this.running = true;
    try {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const replyEvent = `${RPC_REPLY}${requestId}`;
      const response = await new Promise<any>((resolve) => {
        let unsubscribe = () => {};
        const timer = setTimeout(() => {
          unsubscribe();
          resolve({ success: false, error: { message: "pi-subagents RPC timeout" } });
        }, 10_000);
        const onReply = (reply: any) => {
          clearTimeout(timer);
          unsubscribe();
          resolve(reply);
        };
        unsubscribe = this.pi.events.on(replyEvent, onReply);
        this.pi.events.emit(RPC_REQUEST, {
          version: 1,
          requestId,
          method: "spawn",
          source: { extension: "pi-jev" },
          params: {
            async: true,
            workflowScript: `return runs.run("delegate", { agent: "delegate", task: ${JSON.stringify(
              `Orchestrate this task using available agents. Select the smallest useful team, run independent work in parallel when safe, synthesize findings, and return a concise actionable result. Task:\n${task}`
            )} })`,
          },
        });
      });

      if (!response?.success) return { accepted: false, error: response?.error?.message ?? "pi-subagents unavailable" };
      const runId = response.data?.runId ?? response.data?.id;
      ctx.ui.notify(`Agent orchestration started${runId ? ` (${runId})` : ""}.`, "info");
      return { accepted: true, runId };
    } catch (error) {
      return { accepted: false, error: String((error as any)?.message ?? error) };
    } finally {
      this.running = false;
    }
  }

  public installCompletionNotice(): void {
    this.pi.events.on(ASYNC_COMPLETE, (event: any) => {
      if (event?.runId) this.pi.sendMessage({ customType: "jev-agents", display: true, content: `Agent orchestration completed: ${event.runId}` });
    });
  }
}
