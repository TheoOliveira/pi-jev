import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JevClient } from "../src/jev.js";
import { ToolRouter } from "../src/router.js";
import { SkillRouter } from "../src/skills.js";
import { AutoJev } from "../src/auto.js";
import { registerJevTools } from "../src/tools.js";
import { registerJevCommands } from "../src/commands.js";
import { AutoModelRouter } from "../src/model-router.js";
import { JevCompactor } from "../src/compact.js";
import { AgentOrchestrator } from "../src/orchestrator.js";

function envAutoEnabledFor(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envAutoEnabled(): boolean {
  return envAutoEnabledFor("PI_JEV_AUTO");
}

export default function (pi: ExtensionAPI) {
  const jevClient = new JevClient();
  const router = new ToolRouter(pi, jevClient);
  const skillRouter = new SkillRouter(pi, jevClient);

  pi.registerFlag("jev-agents", {
    description: "Enable explicit and automatic orchestration of available agents",
    type: "boolean",
    default: envAutoEnabledFor("PI_JEV_AGENTS"),
  });

  pi.registerFlag("jev-compact", {
    description: "Use Jev to preserve important tool history during /compact",
    type: "boolean",
    default: envAutoEnabledFor("PI_JEV_COMPACT"),
  });

  pi.registerFlag("jev-auto-model", {
    description: "Automatically choose a model for each prompt based on task needs",
    type: "boolean",
    default: envAutoEnabledFor("PI_JEV_AUTO_MODEL"),
  });

  pi.registerFlag("jev-auto", {
    description:
      "Automatically route Pi tools and suggest skills with Jev on every prompt (also via PI_JEV_AUTO=1)",
    type: "boolean",
    default: envAutoEnabled(),
  });

  const auto = new AutoJev(
    jevClient,
    router,
    skillRouter,
    Boolean(pi.getFlag("jev-auto"))
  );
  const autoModel = new AutoModelRouter(pi, Boolean(pi.getFlag("jev-auto-model")));
  const compactor = new JevCompactor(jevClient, Boolean(pi.getFlag("jev-compact")));
  const agents = new AgentOrchestrator(pi, Boolean(pi.getFlag("jev-agents")));
  agents.installCompletionNotice();

  registerJevTools(pi, jevClient, router, skillRouter);
  registerJevCommands(pi, jevClient, router, skillRouter, auto, autoModel, compactor, agents);

  pi.on("session_start", (_event, ctx) => {
    if (!jevClient.isConfigured()) {
      ctx.ui.setStatus("jev", "jev: unconfigured");
      return;
    }
    ctx.ui.setStatus(
      "jev",
      autoModel.enabled ? "jev: auto-model" : auto.enabled ? "jev: auto" : "jev: ready"
    );
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const result = await compactor.compact(event, ctx);
    if (!result.summary) return;
    ctx.ui.setStatus("jev", `jev: compact kept ${result.kept}/${result.considered}`);
    return {
      compaction: {
        summary: result.summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      },
    };
  });

  pi.on("after_provider_response", (event, ctx) => {
    const kind = autoModel.recordProviderResponse(event.status, ctx.model);
    if (kind) ctx.ui.setStatus("jev", `jev: ${kind} → fallback next prompt`);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!auto.enabled) return;

    if (agents.enabled && /\b(architecture|refactor|security review|entire repo|parallel|multiple agents|complex migration)\b/i.test(event.prompt)) {
      await agents.dispatch(event.prompt, ctx, true);
    }

    const modelResult = await autoModel.route(event.prompt, ctx, { hasImages: Boolean(event.images?.length) });
    if (modelResult.changed) {
      ctx.ui.setStatus("jev", `jev: ${modelResult.profile} → ${modelResult.model?.id ?? "model"}`);
    }

    const result = await auto.route(event.prompt, ctx, ctx.signal);
    if (!result.ran) return;

    if (result.activated.length > 0) {
      ctx.ui.setStatus("jev", `jev: auto (+${result.activated.length} tools)`);
    }

    if (result.skills.length === 0) return;

    return {
      message: {
        customType: "jev-auto",
        display: true,
        content:
          "Jev auto-matched skill(s) for this task. Load the matching SKILL.md before proceeding:\n" +
          result.skills
            .map((s) => `• /skill:${s.name} (P=${s.probability.toFixed(2)})`)
            .join("\n"),
      },
    };
  });
}
