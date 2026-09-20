import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";
import type { ToolRouter } from "./router.js";
import type { SkillRouter } from "./skills.js";
import type { AutoJev } from "./auto.js";
import type { AutoModelRouter } from "./model-router.js";
import type { JevCompactor } from "./compact.js";
import type { AgentOrchestrator } from "./orchestrator.js";
import type { ToolGuard } from "./tool-guard.js";
import { designEvaluation } from "./designer.js";
import type { JevEvaluationRequest } from "./types.js";
import { JEV_TOOL_NAMES, isJevTool } from "./types.js";
import { JEV_THRESHOLD } from "./skills.js";

export function registerJevCommands(
  pi: ExtensionAPI,
  jevClient: JevClient,
  router: ToolRouter,
  skillRouter: SkillRouter,
  auto: AutoJev,
  autoModel?: AutoModelRouter,
  compactor?: JevCompactor,
  agents?: AgentOrchestrator,
  toolGuard?: ToolGuard
): void {
  const agentMode = agents ?? { enabled: false, setEnabled: () => {}, dispatch: async () => ({ accepted: false, error: "disabled" }) };
  const compactMode = compactor ?? { enabled: false, setEnabled: () => {} };
  const modelMode = autoModel ?? { enabled: false, setEnabled: () => {} };
  const guardMode = toolGuard ?? { enabled: false, setEnabled: () => {} };
  pi.registerCommand("jev", {
    description: "Manage TypeSafe Jev integration (status, enable, disable, auto, test, skills)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const sub = (tokens[0] ?? "").toLowerCase();
      const rest = tokens.slice(1).join(" ");
      const usage =
        "Available options: /jev status, /jev skills [query], /jev test [prompt], /jev enable, /jev disable, /jev auto [on|off], /jev auto-model [on|off], /jev compact [on|off], /jev auto-agents [on|off], /jev tool-guard [on|off], /jev agents [task]";

      if (sub === "status" || sub === "") {
        const origin = jevClient.getKeyOrigin();
        const activeTools = pi.getActiveTools();
        const allTools = pi.getAllTools();
        const activeSet = new Set(activeTools);
        const routable = allTools.filter(
          (t: any) => !activeSet.has(t.name) && !isJevTool(t.name)
        ).length;

        ctx.ui.notify(
          `Jev Status:\n` +
            `• Configured: ${origin ? `Yes (from ${origin})` : "No"}\n` +
            `• Requests in session: ${jevClient.stats.requestsCount}\n` +
            `• Total tokens used: ${jevClient.stats.totalTokens}\n` +
            `• Auto mode: ${auto.enabled ? "on" : "off"}${auto.enabled && !origin ? " (inactive: Jev unconfigured)" : ""}\n` +
            `• Auto-model: ${modelMode.enabled ? "on" : "off"}\n` +
            `• Tool guard: ${guardMode.enabled ? "on" : "off"}\n` +
            `• Jev compaction: ${compactMode.enabled ? "on" : "off"}\n` +
            `• Agent orchestration: ${agentMode.enabled ? "on" : "off"}\n` +
            `• Active tools: ${activeTools.length} / Available: ${allTools.length} (${routable} routable)\n` +
            (jevClient.stats.lastError ? `• Last error: ${jevClient.stats.lastError}` : ""),
          "info"
        );
        return;
      }

      if (sub === "help") {
        ctx.ui.notify(`Jev commands:\n${usage}`, "info");
        return;
      }

      if (sub === "test" || sub === "eval" || sub === "evaluate") {
        if (!jevClient.isConfigured()) {
          ctx.ui.notify(
            "Cannot run evaluation: no TypeSafe API key. Set TYPESAFE_API_KEY or write ~/.pi/agent/secrets/typesafe_api_key.",
            "error"
          );
          return;
        }

        // With a prompt: the active model designs the evaluation. Without one: fixed smoke test.
        let request: JevEvaluationRequest;
        if (rest) {
          ctx.ui.notify(`Designing a Jev evaluation for: "${rest}"...`, "info");
          try {
            request = await designEvaluation(ctx, rest, ctx.signal);
          } catch (err: any) {
            ctx.ui.notify(`Could not design evaluation: ${err?.message || err}`, "error");
            return;
          }
          ctx.ui.notify(
            `Designed ${Object.keys(request.questions).length} question(s): ${Object.keys(request.questions).join(", ")}\nSending to TypeSafe Jev...`,
            "info"
          );
        } else {
          ctx.ui.notify("Sending test evaluation request to TypeSafe Jev...", "info");
          request = {
            state: { message: "Payment processing failed due to credit card expiration." },
            questions: {
              is_billing: {
                type: "noul" as const,
                instructions: "Is this message related to a billing issue?",
              },
              category: {
                type: "choice" as const,
                instructions: "Which category does this issue fall into?",
                criteria: {
                  billing: "Billing, invoices, card issues",
                  bug: "Software bug or crash",
                  other: "General questions",
                },
              },
            },
          };
        }

        try {
          const res = await jevClient.evaluate(request);

          ctx.ui.notify(
            (rest ? `Jev Evaluation (${res.elapsedMs}ms):\n` : `Jev Test Successful (${res.elapsedMs}ms):\n`) +
              Object.entries(res.answers)
                .map(([id, ans]) => {
                  const value =
                    ans.type === "noul"
                      ? `${ans.value}${typeof ans.value === "number" ? ` (${(ans.value * 100).toFixed(0)}% yes)` : ""}`
                      : `${ans.value}${ans.confidence !== undefined ? ` (confidence: ${ans.confidence})` : ""}`;
                  return `• ${id}: ${value}`;
                })
                .join("\n"),
            "info"
          );
        } catch (err: any) {
          ctx.ui.notify(`Jev Evaluation Failed: ${err?.message || err}`, "error");
        }
        return;
      }

      if (sub === "skills" || sub === "skill") {
        const query = rest;
        if (!query) {
          const available = skillRouter.getAvailableSkills(ctx);
          ctx.ui.notify(
            `Available skills (${available.length}):\n` +
              available.map((s) => `• ${s.name}: ${s.description.slice(0, 80)}...`).join("\n"),
            "info"
          );
          return;
        }

        ctx.ui.notify(`Searching skills for: "${query}"...`, "info");
        const res = await skillRouter.findSkills(query, JEV_THRESHOLD, ctx);
        if (res.recommended.length === 0) {
          ctx.ui.notify(`No skills matched "${query}".`, "info");
          return;
        }

        ctx.ui.notify(
          `Matching skills for "${query}":\n` +
            res.recommended
              .map((r) => `• /skill:${r.name} (P=${r.probability.toFixed(2)}) - ${r.description}`)
              .join("\n") +
            (res.fallbackUsed
              ? "\n(Note: Jev unconfigured/offline — local keyword shortlist, probabilities are not Jev judgments)"
              : ""),
          res.fallbackUsed ? "warning" : "info"
        );
        return;
      }

      if (sub === "agents" || sub === "orchestrate") {
        if (!rest) {
          ctx.ui.notify("Usage: /jev agents <task>", "warning");
          return;
        }
        const result = await agentMode.dispatch(rest, ctx);
        if (!result.accepted) ctx.ui.notify(`Agent orchestration unavailable: ${result.error ?? "unknown error"}`, "warning");
        return;
      }

      if (sub === "tool-guard" || sub === "toolguard" || sub === "guard") {
        const arg = rest.toLowerCase();
        if (arg !== "" && arg !== "on" && arg !== "off") {
          ctx.ui.notify(`Unknown /jev tool-guard argument "${rest}". ${usage}`, "warning");
          return;
        }
        const enabled = arg === "on" ? true : arg === "off" ? false : !guardMode.enabled;
        guardMode.setEnabled(enabled);
        ctx.ui.notify(`Jev tool guard ${enabled ? "enabled" : "disabled"}.`, "info");
        return;
      }

      if (sub === "compact") {
        const arg = rest.toLowerCase();
        if (arg !== "" && arg !== "on" && arg !== "off") {
          ctx.ui.notify(`Unknown /jev compact argument "${rest}". ${usage}`, "warning");
          return;
        }
        const enabled = arg === "on" ? true : arg === "off" ? false : !compactMode.enabled;
        compactMode.setEnabled(enabled);
        ctx.ui.notify(`Jev compaction ${enabled ? "enabled" : "disabled"}. Use /compact to run it.`, "info");
        return;
      }

      if (sub === "auto-agents" || sub === "autoagents") {
        const arg = rest.toLowerCase();
        if (arg !== "" && arg !== "on" && arg !== "off") {
          ctx.ui.notify(`Unknown /jev auto-agents argument "${rest}". ${usage}`, "warning");
          return;
        }
        const enabled = arg === "on" ? true : arg === "off" ? false : !agentMode.enabled;
        agentMode.setEnabled(enabled);
        ctx.ui.notify(`Automatic agent orchestration ${enabled ? "enabled" : "disabled"}.`, "info");
        return;
      }

      if (sub === "auto-model" || sub === "automodel") {
        const arg = rest.toLowerCase();
        if (arg !== "" && arg !== "on" && arg !== "off") {
          ctx.ui.notify(`Unknown /jev auto-model argument "${rest}". ${usage}`, "warning");
          return;
        }
        const enabled = arg === "on" ? true : arg === "off" ? false : !modelMode.enabled;
        modelMode.setEnabled(enabled);
        ctx.ui.notify(`Jev auto-model mode ${enabled ? "enabled" : "disabled"}.`, "info");
        return;
      }

      if (sub === "auto") {
        const arg = rest.toLowerCase();
        if (arg !== "" && arg !== "on" && arg !== "off") {
          ctx.ui.notify(`Unknown /jev auto argument "${rest}". ${usage}`, "warning");
          return;
        }
        const enabled = arg === "on" ? true : arg === "off" ? false : !auto.enabled;
        auto.setEnabled(enabled);
        ctx.ui.notify(
          enabled
            ? "Jev auto mode enabled: each prompt routes tools and suggests skills. Costs one Jev request per prompt."
            : "Jev auto mode disabled.",
          "info"
        );
        return;
      }

      if (sub === "enable") {
        pi.setActiveTools([...new Set([...pi.getActiveTools(), ...JEV_TOOL_NAMES])]);
        ctx.ui.notify(`Jev tools (${JEV_TOOL_NAMES.join(", ")}) enabled for this session.`, "info");
        return;
      }

      if (sub === "disable") {
        pi.setActiveTools(pi.getActiveTools().filter((t) => !isJevTool(t)));
        ctx.ui.notify("Jev tools disabled for this session.", "info");
        return;
      }

      ctx.ui.notify(`Unknown command /jev ${sub}.\n${usage}`, "warning");
    },
  });
}
