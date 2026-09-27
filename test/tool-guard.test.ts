import test from "node:test";
import assert from "node:assert/strict";
import { ToolGuard } from "../src/tool-guard.js";
import { JevClient } from "../src/jev.js";

test("ToolGuard skips when disabled or unconfigured", async () => {
  const mockPi: any = { on: () => {} };
  const jevClient = new JevClient();
  const guard = new ToolGuard(mockPi, jevClient, false);

  const res = await guard.checkToolCall("bash", { command: "ls -la" });
  assert.equal(res.valid, true);
  assert.equal(res.blocked, undefined);
});

test("ToolGuard evaluates tool calls and flags hallucinations", async () => {
  const mockPi: any = { on: () => {} };
  const mockJev: any = {
    isConfigured: () => true,
    evaluate: async () => ({
      answers: {
        is_hallucinated: { type: "noul", value: 0.95 },
      },
      model: "jev-latest",
      elapsedMs: 15,
    }),
  };

  const guard = new ToolGuard(mockPi, mockJev, true);
  const res = await guard.checkToolCall("read", { path: "/non/existent/hallucinated/file.xyz" });

  assert.equal(res.valid, false);
  assert.equal(res.blocked, true);
  assert.match(res.reason ?? "", /hallucinated parameters/);
});

test("ToolGuard enhances error results with guidance", async () => {
  const mockPi: any = { on: () => {} };
  const mockJev: any = {
    isConfigured: () => true,
    evaluate: async () => ({
      answers: {
        error_category: { type: "choice", value: "missing_file" },
      },
      model: "jev-latest",
      elapsedMs: 12,
    }),
  };

  const guard = new ToolGuard(mockPi, mockJev, true);
  const hint = await guard.enhanceErrorResult(
    "read",
    { path: "fake.ts" },
    [{ type: "text", text: "ENOENT: no such file or directory" }]
  );

  assert.match(hint ?? "", /Path not found/);
});
