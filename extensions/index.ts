import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JevClient } from "../src/jev.js";
import { ToolRouter } from "../src/router.js";
import { registerJevTools } from "../src/tools.js";
import { registerJevCommands } from "../src/commands.js";

export default function (pi: ExtensionAPI) {
  const jevClient = new JevClient();
  const router = new ToolRouter(pi, jevClient);

  registerJevTools(pi, jevClient, router);
  registerJevCommands(pi, jevClient, router);

  pi.on("session_start", (_event, ctx) => {
    if (jevClient.isConfigured()) {
      ctx.ui.setStatus("jev", "jev: ready");
    } else {
      ctx.ui.setStatus("jev", "jev: unconfigured");
    }
  });
}
