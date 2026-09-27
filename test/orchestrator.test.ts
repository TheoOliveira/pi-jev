import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentOrchestrator,
  classifyTopologyFallback,
  determineTopology,
  buildWorkflowScript,
} from "../src/orchestrator.js";
import { JevClient } from "../src/jev.js";

test("classifyTopologyFallback categorizes tasks correctly", () => {
  assert.equal(classifyTopologyFallback("Fix broken authentication token handler"), "implementation");
  assert.equal(classifyTopologyFallback("Research best WebSockets libraries in Node"), "research");
  assert.equal(classifyTopologyFallback("Review security and code standards of this PR"), "review");
  assert.equal(classifyTopologyFallback("Say hello"), "general");
});

test("determineTopology uses JevClient evaluation when configured", async () => {
  const mockClient = new JevClient();
  mockClient.isConfigured = () => true;
  mockClient.evaluate = async () => ({
    answers: {
      topology: {
        type: "choice",
        value: "research",
      },
    },
    model: "jev-latest",
    elapsedMs: 20,
  });

  const topology = await determineTopology("Examine architecture tradeoffs", mockClient);
  assert.equal(topology, "research");
});

test("buildWorkflowScript outputs workflows delegating to builtin agents", () => {
  const implScript = buildWorkflowScript("Fix race condition in store", "implementation");
  assert.match(implScript, /runs\.run\("scout"/);
  assert.match(implScript, /runs\.run\("worker"/);
  assert.match(implScript, /runs\.run\("reviewer"/);

  const researchScript = buildWorkflowScript("Research vector DBs", "research");
  assert.match(researchScript, /runs\.all\(\[/);
  assert.match(researchScript, /agent:\s*"scout"/);
  assert.match(researchScript, /agent:\s*"researcher"/);
  assert.match(researchScript, /agent:\s*"worker"/);

  const reviewScript = buildWorkflowScript("Review PR changes", "review");
  assert.match(reviewScript, /agent:\s*"reviewer"/);
  assert.match(reviewScript, /agent:\s*"evidence-auditor"/);
});

test("AgentOrchestrator dispatches workflowScript through pi-subagents RPC", async () => {
  const listeners: Record<string, Function[]> = {};
  let emittedRequest: any = null;

  const mockPi: any = {
    events: {
      on: (event: string, fn: Function) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
        return () => {};
      },
      emit: (event: string, payload: any) => {
        if (event === "subagents:rpc:v1:request") {
          emittedRequest = payload;
          const replyEvent = `subagents:rpc:v1:reply:${payload.requestId}`;
          setTimeout(() => {
            const replyFn = listeners[replyEvent]?.[0];
            replyFn?.({ success: true, data: { runId: "run-abc-123" } });
          }, 5);
        }
      },
    },
  };

  const orchestrator = new AgentOrchestrator(mockPi, undefined, true);
  const ctx: any = { ui: { notify: () => {} }, signal: undefined };

  const result = await orchestrator.dispatch("Fix typo in README", ctx);
  assert.equal(result.accepted, true);
  assert.equal(result.runId, "run-abc-123");
  assert.ok(emittedRequest);
  assert.equal(emittedRequest.params.async, true);
  assert.match(emittedRequest.params.workflowScript, /runs\.run/);
  assert.match(emittedRequest.params.workflowScript, /scout/);
  assert.match(emittedRequest.params.workflowScript, /worker/);
  assert.match(emittedRequest.params.workflowScript, /reviewer/);
});
