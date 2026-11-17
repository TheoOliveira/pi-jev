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

test("ToolGuard blocks destructive bash commands in headless mode or when user declines, and allows when confirmed", async () => {
  const mockPi: any = { on: () => {} };
  const mockJev: any = {
    isConfigured: () => true,
    evaluate: async (req: any) => {
      assert.ok(req.questions.is_hallucinated);
      assert.ok(req.questions.is_destructive);
      return {
        answers: {
          is_hallucinated: { type: "noul", value: 0.05 },
          is_destructive: { type: "noul", value: 0.92 },
        },
        model: "jev-latest",
        elapsedMs: 10,
      };
    },
  };

  const guard = new ToolGuard(mockPi, mockJev, true);

  // Headless (no UI) blocks
  const headless = await guard.checkToolCall("bash", { command: "rm -rf /tmp/foo" }, { hasUI: false } as any);
  assert.equal(headless.valid, false);
  assert.equal(headless.blocked, true);
  assert.match(headless.reason ?? "", /destructive command/);

  // Interactive UI declined blocks
  const declined = await guard.checkToolCall("bash", { command: "rm -rf /tmp/foo" }, {
    hasUI: true,
    ui: { confirm: async () => false },
  } as any);
  assert.equal(declined.valid, false);
  assert.equal(declined.blocked, true);

  // Interactive UI confirmed allows
  const confirmed = await guard.checkToolCall("bash", { command: "rm -rf /tmp/foo" }, {
    hasUI: true,
    ui: { confirm: async () => true },
  } as any);
  assert.equal(confirmed.valid, true);
  assert.equal(confirmed.blocked, undefined);
});
