import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JevClient } from "../src/jev.js";
import { ToolRouter } from "../src/router.js";
import { SkillRouter, formatSkillCommand } from "../src/skills.js";
import { AutoJev } from "../src/auto.js";
import { registerJevTools } from "../src/tools.js";
import { registerJevCommands } from "../src/commands.js";
import { AutoModelRouter, promptHasUrl } from "../src/model-router.js";
import { JevCompactor } from "../src/compact.js";
import {
  AgentOrchestrator,
  classifyTopologyFallback,
  topologyQuestion,
  type OrchestrationTopology,
} from "../src/orchestrator.js";
import { JevAgentHandler } from "../src/agent.js";
import { ToolGuard } from "../src/tool-guard.js";
import { AutoThinkingRouter } from "../src/thinking.js";

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

  pi.registerFlag("jev-tool-guard", {
    description: "Validate tool calls with Jev System One to prevent hallucinations",
    type: "boolean",
    default: envAutoEnabledFor("PI_JEV_TOOL_GUARD"),
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

  pi.registerFlag("jev-thinking", {
    description:
      "Classify each prompt and set the reasoning level (escalate for planning/debugging, de-escalate for short mechanical tasks) without changing the model",
    type: "boolean",
    default: envAutoEnabledFor("PI_JEV_THINKING"),
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
  const autoModel = new AutoModelRouter(pi, Boolean(pi.getFlag("jev-auto-model")), jevClient);
  const autoThinking = new AutoThinkingRouter(pi, Boolean(pi.getFlag("jev-thinking")));
  const compactor = new JevCompactor(jevClient, Boolean(pi.getFlag("jev-compact")));
  const agents = new AgentOrchestrator(pi, jevClient, Boolean(pi.getFlag("jev-agents")));
  agents.installCompletionNotice();

  const toolGuard = new ToolGuard(pi, jevClient, Boolean(pi.getFlag("jev-tool-guard")));
  toolGuard.install();

  const agentHandler = new JevAgentHandler(pi, jevClient);
  agentHandler.install();

  registerJevTools(pi, jevClient, router, skillRouter);
  registerJevCommands(pi, jevClient, router, skillRouter, auto, autoModel, compactor, agents, toolGuard, autoThinking);

  pi.on("session_start", (event, ctx) => {
    if (!event?.reason || event.reason === "startup" || event.reason === "reload") {
      if (pi.getFlag("jev-auto") !== undefined) auto.setEnabled(Boolean(pi.getFlag("jev-auto")));
      if (pi.getFlag("jev-auto-model") !== undefined) autoModel.setEnabled(Boolean(pi.getFlag("jev-auto-model")));
      if (pi.getFlag("jev-thinking") !== undefined) autoThinking.setEnabled(Boolean(pi.getFlag("jev-thinking")));
      if (pi.getFlag("jev-compact") !== undefined) compactor.setEnabled(Boolean(pi.getFlag("jev-compact")));
      if (pi.getFlag("jev-agents") !== undefined) agents.setEnabled(Boolean(pi.getFlag("jev-agents")));
      if (pi.getFlag("jev-tool-guard") !== undefined) toolGuard.setEnabled(Boolean(pi.getFlag("jev-tool-guard")));
    }
    if (!jevClient.isConfigured()) {
      ctx.ui.setStatus("jev", "jev: unconfigured");
      return;
    }
    ctx.ui.setStatus(
      "jev",
      autoModel.enabled ? "jev: auto-model" : auto.enabled ? "jev: auto" : "jev: ready"
    );
  });

  pi.on("session_before_tree", async (event, ctx) => {
    const result = await compactor.compactTree(event, ctx);
    if (!result.summary) return;
    ctx.ui.setStatus("jev", `jev: branch compact kept ${result.kept}/${result.considered}`);
    return {
      summary: {
        summary: result.summary,
      },
    };
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

  pi.on("thinking_level_select", (event) => {
    autoThinking.observe(event.level, event.previousLevel);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // Custom-message continuations and slash commands have no user prompt to classify.
    if (!("prompt" in event)) return;
    if (typeof event.prompt !== "string" || !event.prompt.trim() || event.prompt.trim().startsWith("/")) return;

    const shouldOrchestrate =
      agents.enabled &&
      /\b(architecture|refactor|security review|entire repo|parallel|multiple agents|complex migration)\b/i.test(event.prompt);

    const routeOptions = { hasImages: Boolean(event.images?.length), hasUrls: promptHasUrl(event.prompt) || Boolean((event as any).urls?.length) };
    const modelPlan = autoModel.plan(event.prompt, ctx, routeOptions);

    // With auto-routing on, fold model-switch and topology questions into the same Jev
    // request so the prompt costs one round-trip instead of two.
    if (!auto.enabled) {
      if (shouldOrchestrate) {
        await agents.dispatch(event.prompt, ctx, true);
      }

      const modelResult = modelPlan.plan
        ? await autoModel.applyDecision(modelPlan.plan, await autoModel.judge(event.prompt, modelPlan.plan, ctx.signal))
        : modelPlan.result;
      if (modelResult.changed) ctx.ui.setStatus("jev", `jev: ${modelResult.profile} → ${modelResult.model?.id ?? "model"}`);

      const thinkingResult = await autoThinking.route(event.prompt, ctx);
      if (thinkingResult.changed) {
        ctx.ui.setStatus("jev", `jev: thinking ${thinkingResult.previous ?? "?"} → ${thinkingResult.level}`);
      }
      return;
    }

    if (modelPlan.plan) auto.pendingQuestions.push({ key: modelPlan.plan.questionKey, instructions: modelPlan.plan.instructions });
    if (shouldOrchestrate) auto.pendingQuestions.push({ key: "agent:topology", question: topologyQuestion() });
    const result = await auto.route(event.prompt, ctx, ctx.signal);

    if (shouldOrchestrate) {
      const rawTopo = result.extraAnswers?.["agent:topology"]?.value;
      const validTopos: OrchestrationTopology[] = ["implementation", "research", "review", "general"];
      const resolvedTopo =
        typeof rawTopo === "string" && validTopos.includes(rawTopo as OrchestrationTopology)
          ? (rawTopo as OrchestrationTopology)
          : classifyTopologyFallback(event.prompt);
      await agents.dispatch(event.prompt, ctx, true, resolvedTopo);
    }

    const modelResult = modelPlan.plan
      ? await autoModel.applyDecision(modelPlan.plan, result.modelConfidence)
      : modelPlan.result;
    if (modelResult.changed) ctx.ui.setStatus("jev", `jev: ${modelResult.profile} → ${modelResult.model?.id ?? "model"}`);

    const thinkingResult = await autoThinking.route(event.prompt, ctx);
    if (thinkingResult.changed) {
      ctx.ui.setStatus("jev", `jev: thinking ${thinkingResult.previous ?? "?"} → ${thinkingResult.level}`);
    }

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
            .map((s) => `• ${formatSkillCommand(s.name)} (P=${s.probability.toFixed(2)})`)
            .join("\n"),
      },
    };
  });
}
