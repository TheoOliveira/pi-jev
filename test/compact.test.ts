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

test("JevCompactor excludes kept entries at/after firstKeptEntryId and takes most recent pre-cut entries", async () => {
  const { client } = fakeClient(0.9);
  const preCutEntries = Array.from({ length: 30 }, (_, i) => ({
    id: `pre-${i}`,
    type: "tool_result",
    text: `tool output ${i}`,
  }));
  const keptEntries = [
    { id: "cut-entry", type: "user", text: "must-not-summarize-kept-entry" },
    { id: "after-cut", type: "tool_result", text: "after-cut-output" },
  ];

  const result = await new JevCompactor(client, true).compact({
    preparation: {
      firstKeptEntryId: "cut-entry",
      previousSummary: "Earlier summary context",
    },
    branchEntries: [...preCutEntries, ...keptEntries],
  }, {} as any);

  assert.equal(result.considered, 24);
  assert.doesNotMatch(result.summary, /tool output 0\b/);
  assert.match(result.summary, /tool output 29\b/);
  assert.doesNotMatch(result.summary, /must-not-summarize-kept-entry/);
  assert.match(result.summary, /Previous summary: Earlier summary context/);
});

test("JevCompactor.compactTree summarizes entriesToSummarize and skips when userWantsSummary is false", async () => {
  const { client, calls } = fakeClient(0.9);
  const compactor = new JevCompactor(client, true);

  const skipped = await compactor.compactTree({
    preparation: { userWantsSummary: false, entriesToSummarize: [{ type: "tool_result", text: "x" }] },
  }, {} as any);
  assert.equal(skipped.skipped, "empty");
  assert.equal(calls.length, 0);

  const res = await compactor.compactTree({
    preparation: {
      userWantsSummary: true,
      customInstructions: "Focus on API migration",
      entriesToSummarize: [
        { type: "user", text: "Explore v2 endpoints" },
        { type: "tool_result", text: "Found /v2/users endpoint in api.ts" },
      ],
    },
  }, {} as any);
  assert.equal(calls.length, 1);
  assert.equal(res.kept, 2);
  assert.match(res.summary, /\/v2\/users/);
});
