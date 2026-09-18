import test from "node:test";
import assert from "node:assert/strict";
import { executeJevAgentTask, JevAgentHandler } from "../src/agent.js";
import { JevClient } from "../src/jev.js";

test("executeJevAgentTask runs noul check for simple prompt", async () => {
  const mockClient = new JevClient();
  mockClient.isConfigured = () => true;
  mockClient.evaluate = async (req) => {
    assert.ok(req.questions["judgment"]);
    assert.equal(req.questions["judgment"].type, "noul");
    return {
      answers: {
        judgment: {
          type: "noul",
          value: 0.88,
        },
      },
      model: "jev-latest",
      elapsedMs: 30,
    };
  };

  const res = await executeJevAgentTask(
    { task: "Is this pull request safe to deploy?", state: "git diff content" },
    mockClient
  );
  assert.equal(res.success, true);
  assert.equal(res.primaryValue, 0.88);
});

test("executeJevAgentTask runs choice check when specified", async () => {
  const mockClient = new JevClient();
  mockClient.isConfigured = () => true;
  mockClient.evaluate = async (req) => {
    assert.equal(req.questions["judgment"].type, "choice");
    return {
      answers: {
        judgment: {
          type: "choice",
          value: "bugfix",
        },
      },
      model: "jev-latest",
      elapsedMs: 25,
    };
  };

  const res = await executeJevAgentTask(
    {
      type: "choice",
      instructions: "Classify issue type",
      criteria: { bugfix: "Bug report", feature: "New feature request" },
      state: "Fix null pointer in auth handler",
    },
    mockClient
  );
  assert.equal(res.success, true);
  assert.equal(res.primaryValue, "bugfix");
});

test("JevAgentHandler intercepts RPC for agent 'jev'", async () => {
  const listeners: Record<string, Function[]> = {};
  const emitted: Record<string, any[]> = {};

  const mockPi: any = {
    events: {
      on: (event: string, fn: Function) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
        return () => {};
      },
      emit: (event: string, payload: any) => {
        emitted[event] = emitted[event] || [];
        emitted[event].push(payload);
      },
    },
  };

  const mockClient = new JevClient();
  mockClient.isConfigured = () => true;
  mockClient.evaluate = async () => ({
    answers: {
      judgment: {
        type: "choice",
        value: "approved",
      },
    },
    model: "jev-latest",
    elapsedMs: 20,
  });

  const handler = new JevAgentHandler(mockPi, mockClient);
  handler.install();

  const rpcHandler = listeners["subagents:rpc:v1:request"]?.[0];
  assert.ok(rpcHandler);

  await rpcHandler({
    version: 1,
    requestId: "req-123",
    params: {
      agent: "jev",
      type: "choice",
      criteria: { approved: "Pass", rejected: "Fail" },
      task: "Review changes",
    },
  });

  const reply = emitted["subagents:rpc:v1:reply:req-123"]?.[0];
  assert.ok(reply);
  assert.equal(reply.success, true);
  assert.equal(reply.data.result.primaryValue, "approved");
});
