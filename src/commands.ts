import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { JevClient } from "./jev.js";
import type { ToolRouter } from "./router.js";
import type { SkillRouter } from "./skills.js";

export function registerJevCommands(
  pi: ExtensionAPI,
  jevClient: JevClient,
  router: ToolRouter,
  skillRouter: SkillRouter
): void {
  pi.registerCommand("jev", {
    description: "Manage TypeSafe Jev integration (status, enable, disable, test)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const sub = args.trim().toLowerCase();

      if (sub === "status" || sub === "") {
        const configured = jevClient.isConfigured();
        const activeTools = pi.getActiveTools();
        const allTools = pi.getAllTools();
        const inactiveCount = allTools.length - activeTools.length;

        ctx.ui.notify(
          `Jev Status:\n` +
            `• Configured: ${configured ? "Yes (TYPESAFE_API_KEY detected)" : "No"}\n` +
            `• Requests in session: ${jevClient.stats.requestsCount}\n` +
            `• Total tokens used: ${jevClient.stats.totalTokens}\n` +
            `• Active tools: ${activeTools.length} / Available: ${allTools.length} (${inactiveCount} inactive/routable)\n` +
            (jevClient.stats.lastError ? `• Last error: ${jevClient.stats.lastError}` : ""),
          "info"
        );
        return;
      }

      if (sub === "test") {
        if (!jevClient.isConfigured()) {
          ctx.ui.notify("Cannot run test: TYPESAFE_API_KEY is not set.", "error");
          return;
        }

        ctx.ui.notify("Sending test evaluation request to TypeSafe Jev...", "info");
        try {
          const res = await jevClient.evaluate({
            state: { message: "Payment processing failed due to credit card expiration." },
            questions: {
              is_billing: {
                type: "noul",
                instructions: "Is this message related to a billing issue?",
              },
              category: {
                type: "choice",
                instructions: "Which category does this issue fall into?",
                criteria: {
                  billing: "Billing, invoices, card issues",
                  bug: "Software bug or crash",
                  other: "General questions",
                },
              },
            },
          });

          ctx.ui.notify(
            `Jev Test Successful (${res.elapsedMs}ms):\n` +
              `• is_billing: ${res.answers.is_billing?.value}\n` +
              `• category: ${res.answers.category?.value} (confidence: ${res.answers.category?.confidence})`,
            "info"
          );
        } catch (err: any) {
          ctx.ui.notify(`Jev Test Failed: ${err?.message || err}`, "error");
        }
        return;
      }

      if (sub.startsWith("skills") || sub.startsWith("skill")) {
        const query = sub.replace(/^skills?/, "").trim();
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
        const res = await skillRouter.findSkills(query, 0.6, ctx);
        if (res.recommended.length === 0) {
          ctx.ui.notify(`No skills matched "${query}".`, "info");
          return;
        }

        ctx.ui.notify(
          `Matching skills for "${query}":\n` +
            res.recommended
              .map((r) => `• /skill:${r.name} (P=${r.probability.toFixed(2)}) - ${r.description}`)
              .join("\n"),
          "info"
        );
        return;
      }

      if (sub === "enable") {
        pi.setActiveTools([
          ...new Set([...pi.getActiveTools(), "jev_find_tools", "jev_find_skill", "jev_evaluate"]),
        ]);
        ctx.ui.notify("Jev tools (jev_find_tools, jev_find_skill, jev_evaluate) enabled for this session.", "info");
        return;
      }

      if (sub === "disable") {
        const filtered = pi.getActiveTools().filter(
          (t) => t !== "jev_find_tools" && t !== "jev_find_skill" && t !== "jev_evaluate"
        );
        pi.setActiveTools(filtered);
        ctx.ui.notify("Jev tools disabled for this session.", "info");
        return;
      }

      ctx.ui.notify(
        `Unknown command /jev ${sub}.\nAvailable options: /jev status, /jev skills [query], /jev test, /jev enable, /jev disable`,
        "warning"
      );
    },
  });
}
