import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";

const RPC_REQUEST = "subagents:rpc:v1:request";
const RPC_REPLY = "subagents:rpc:v1:reply:";
const ASYNC_COMPLETE = "subagent:async-complete";

export type OrchestrationTopology = "implementation" | "research" | "review" | "general";

export interface OrchestrationResult {
  runId?: string;
  accepted: boolean;
  topology?: OrchestrationTopology;
  error?: string;
}

export function classifyTopologyFallback(task: string): OrchestrationTopology {
  const lower = task.toLowerCase();
  if (/\b(review|audit|security|check|verify|spec)\b/i.test(lower)) {
    return "review";
  }
  if (/\b(research|investigate|explore|how does|find|analyze|architecture)\b/i.test(lower)) {
    return "research";
  }
  if (/\b(fix|bug|implement|refactor|add|build|create|migrate|update|delete)\b/i.test(lower)) {
    return "implementation";
  }
  return "general";
}

export async function determineTopology(
  task: string,
  jevClient?: JevClient,
  signal?: AbortSignal
): Promise<OrchestrationTopology> {
  if (jevClient?.isConfigured()) {
    try {
      const response = await jevClient.evaluate(
        {
          state: task,
          questions: {
            topology: {
              type: "choice",
              instructions: "What type of workflow is best suited for this task?",
              criteria: {
                implementation: "Code change, bugfix, refactoring, feature implementation, or file modifications",
                research: "Investigating codebase, external research, architectural analysis, or exploration",
                review: "Code review, security audit, checking compliance or reviewing a pull request",
                general: "General question or task not requiring multi-stage implementation",
              },
            },
          },
        },
        signal
      );
      const choiceVal = response.answers["topology"]?.value as OrchestrationTopology;
      if (choiceVal && ["implementation", "research", "review", "general"].includes(choiceVal)) {
        return choiceVal;
      }
    } catch {
      // Fall back on local classifier
    }
  }

  return classifyTopologyFallback(task);
}

export function buildWorkflowScript(task: string, topology: OrchestrationTopology): string {
  const taskJson = JSON.stringify(task);

  switch (topology) {
    case "implementation":
      return `
const scout = await runs.run("scout", {
  agent: "scout",
  label: "Scout codebase context",
  task: "Find all relevant files, functions, and architecture context needed for: " + ${taskJson}
});

const worker = await runs.run("worker", {
  agent: "worker",
  label: "Implement changes",
  task: "Implement the requested task using scout findings.\\n\\nScout findings:\\n" + scout.output + "\\n\\nTask:\\n" + ${taskJson}
});

const reviewer = await runs.run("reviewer", {
  agent: "reviewer",
  label: "Review implementation",
  task: "Review the implementation against standards, bugs, and requirements.\\n\\nTask:\\n" + ${taskJson} + "\\n\\nWorker output:\\n" + worker.output
});

return { scout: scout.output, worker: worker.output, reviewer: reviewer.output };
`.trim();

    case "research":
      return `
const [scout, researcher] = await runs.all([
  {
    key: "scout",
    agent: "scout",
    label: "Scout repository evidence",
    task: "Inspect repository files, structure, and code relevant to: " + ${taskJson}
  },
  {
    key: "researcher",
    agent: "researcher",
    label: "Research external and technical context",
    task: "Research technical domain, best practices, and documentation for: " + ${taskJson}
  }
]);

const synthesizer = await runs.run("synthesizer", {
  agent: "worker",
  label: "Synthesize research report",
  task: "Synthesize local repository findings and external research into an actionable report.\\n\\nRepository findings:\\n" + scout.output + "\\n\\nExternal research:\\n" + researcher.output + "\\n\\nTask:\\n" + ${taskJson}
});

return { scout: scout.output, researcher: researcher.output, synthesis: synthesizer.output };
`.trim();

    case "review":
      return `
const [reviewer, auditor] = await runs.all([
  {
    key: "reviewer",
    agent: "reviewer",
    label: "Code review standards",
    task: "Perform a code review for quality, bugs, and specifications: " + ${taskJson}
  },
  {
    key: "auditor",
    agent: "evidence-auditor",
    label: "Security and evidence audit",
    task: "Audit security risks, verification evidence, and edge cases for: " + ${taskJson}
  }
]);

return { reviewer: reviewer.output, auditor: auditor.output };
`.trim();

    case "general":
    default:
      return `
const worker = await runs.run("worker", {
  agent: "worker",
  label: "Execute task",
  task: ${taskJson}
});

const reviewer = await runs.run("reviewer", {
  agent: "reviewer",
  label: "Verify output",
  task: "Verify that the work meets requirements.\\n\\nTask:\\n" + ${taskJson} + "\\n\\nWorker output:\\n" + worker.output
});

return { worker: worker.output, reviewer: reviewer.output };
`.trim();
  }
}

export class AgentOrchestrator {
  public enabled: boolean;
  private running = false;

  constructor(
    private pi: ExtensionAPI,
    private jevClient?: JevClient,
    enabled = false
  ) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public async dispatch(
    task: string,
    ctx: ExtensionContext,
    automatic = false
  ): Promise<OrchestrationResult> {
    if (!this.enabled && automatic) return { accepted: false, error: "disabled" };
    if (this.running) return { accepted: false, error: "busy" };
    if (!task.trim()) return { accepted: false, error: "empty task" };

    this.running = true;
    try {
      const topology = await determineTopology(task, this.jevClient, ctx.signal);
      const workflowScript = buildWorkflowScript(task, topology);

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
            workflowScript,
          },
        });
      });

      if (!response?.success) {
        return { accepted: false, error: response?.error?.message ?? "pi-subagents unavailable" };
      }

      const runId = response.data?.runId ?? response.data?.id;
      ctx.ui.notify(
        `Agent orchestration started (${topology} topology)${runId ? ` [${runId}]` : ""}.`,
        "info"
      );
      return { accepted: true, runId, topology };
    } catch (error) {
      return { accepted: false, error: String((error as any)?.message ?? error) };
    } finally {
      this.running = false;
    }
  }

  public installCompletionNotice(): void {
    this.pi.events.on(ASYNC_COMPLETE, (event: any) => {
      if (event?.runId) {
        this.pi.sendMessage({
          customType: "jev-agents",
          display: true,
          content: `Agent orchestration completed: ${event.runId}`,
        });
      }
    });
  }
}
