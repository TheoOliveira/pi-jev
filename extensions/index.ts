import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JevClient } from "../src/jev.js";
import { ToolRouter } from "../src/router.js";
import { SkillRouter } from "../src/skills.js";
import { registerJevTools } from "../src/tools.js";
import { registerJevCommands } from "../src/commands.js";

export default function (pi: ExtensionAPI) {
  const jevClient = new JevClient();
  const router = new ToolRouter(pi, jevClient);
  const skillRouter = new SkillRouter(pi, jevClient);

  registerJevTools(pi, jevClient, router, skillRouter);
  registerJevCommands(pi, jevClient, router, skillRouter);

  pi.on("session_start", (_event, ctx) => {
    if (jevClient.isConfigured()) {
      ctx.ui.setStatus("jev", "jev: ready");
    } else {
      ctx.ui.setStatus("jev", "jev: unconfigured");
    }
  });
}
