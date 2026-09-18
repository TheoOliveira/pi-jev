import test from "node:test";
import assert from "node:assert/strict";
import { JevCompactor } from "../src/compact.js";
import type { JevClient } from "../src/jev.js";

function fakeClient(answer = 0.9) {
  const calls: unknown[] = [];
  return {
    client: { isConfigured: () => true, evaluate: async (request: unknown) => { calls.push(request); return { answers: Object.fromEntries(Object.keys((request as any).questions).map((id) => [id, { value: answer }])) }; } } as unknown as JevClient,
    calls,
  };
}

test("JevCompactor keeps important entries in custom summary", async () => {
  const { client, calls } = fakeClient();
  const result = await new JevCompactor(client, true).compact({
    customInstructions: "Fix auth bug",
    branchEntries: [
      { type: "user", text: "Fix auth bug" },
      { type: "tool_result", toolCallId: "x", text: "token compare failed at auth.ts:12" },
    ],
    signal: undefined,
  }, {} as any);

  assert.equal(calls.length, 1);
  assert.equal(result.kept, 2);
  assert.match(result.summary, /auth.ts:12/);
});

test("JevCompactor fails open when Jev is unavailable", async () => {
  const client = { isConfigured: () => false } as unknown as JevClient;
  const result = await new JevCompactor(client, true).compact({ branchEntries: [{ type: "tool_result" }] }, {} as any);
  assert.equal(result.skipped, "unconfigured");
  assert.equal(result.summary, "");
});

test("JevCompactor does nothing while disabled", async () => {
  const client = { isConfigured: () => true } as unknown as JevClient;
  const result = await new JevCompactor(client, false).compact({ branchEntries: [{ type: "tool_result" }] }, {} as any);
  assert.equal(result.skipped, "disabled");
});
