import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JevClient } from "../src/jev.js";
import { ToolRouter } from "../src/router.js";
import { SkillRouter } from "../src/skills.js";
import { AutoJev } from "../src/auto.js";
import { registerJevTools } from "../src/tools.js";
import { registerJevCommands } from "../src/commands.js";

function envAutoEnabled(): boolean {
  const raw = process.env.PI_JEV_AUTO?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export default function (pi: ExtensionAPI) {
  const jevClient = new JevClient();
  const router = new ToolRouter(pi, jevClient);
  const skillRouter = new SkillRouter(pi, jevClient);

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

  registerJevTools(pi, jevClient, router, skillRouter);
  registerJevCommands(pi, jevClient, router, skillRouter, auto);

  pi.on("session_start", (_event, ctx) => {
    if (!jevClient.isConfigured()) {
      ctx.ui.setStatus("jev", "jev: unconfigured");
      return;
    }
    ctx.ui.setStatus("jev", auto.enabled ? "jev: auto" : "jev: ready");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!auto.enabled) return;

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
