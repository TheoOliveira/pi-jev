import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  AgentOrchestrator,
  classifyTopologyFallback,
  determineTopology,
  buildWorkflowScript,
} from "../src/orchestrator.js";
import { JevClient } from "../src/jev.js";

function completionHarness(enabled = false, replies: any[] = []) {
  const bus = new EventEmitter();
  const messages: any[] = [];
  const mockPi: any = {
    events: {
      on: (event: string, listener: (payload: any) => void) => {
        bus.on(event, listener);
        return () => bus.off(event, listener);
      },
      emit: (event: string, payload: any) => bus.emit(event, payload),
    },
    sendMessage: (message: any) => messages.push(message),
  };
  bus.on("subagents:rpc:v1:request", (request) => {
    const reply = replies.shift();
    assert.ok(reply, "Unexpected spawn request");
    bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, reply);
  });

  const orchestrator = new AgentOrchestrator(mockPi, undefined, enabled);
  orchestrator.installCompletionNotice();
  const ctx: any = { ui: { notify: () => {} }, signal: undefined };
  const complete = (event: any) => bus.emit("subagent:async-complete", event);
  return { orchestrator, ctx, complete, messages };
}

for (const enabled of [false, true]) {
  test(`AgentOrchestrator ignores unrelated completions when enabled=${enabled}`, () => {
    const { complete, messages } = completionHarness(enabled);
    complete({ runId: "unrelated-run" });
    complete({});
    complete(null);
    complete({ runId: "" });
    assert.deepEqual(messages, []);
  });
}

for (const idField of ["runId", "id"]) {
  test(`AgentOrchestrator announces an explicitly dispatched ${idField} only once`, async () => {
    const { orchestrator, ctx, complete, messages } = completionHarness(false, [
      { success: true, data: { [idField]: "owned-run" } },
    ]);
    const result = await orchestrator.dispatch("Say hello", ctx);
    assert.equal(result.accepted, true);
    assert.equal(result.runId, "owned-run");

    complete({ runId: "unrelated-run" });
    complete({ runId: "owned-run" });
    complete({ runId: "owned-run" });
    assert.deepEqual(messages, [{
      customType: "jev-agents",
      display: true,
      content: "Agent orchestration completed: owned-run",
    }]);
  });
}

test("AgentOrchestrator tracks multiple runs even after automatic mode is disabled", async () => {
  const { orchestrator, ctx, complete, messages } = completionHarness(true, [
    { success: true, data: { runId: "first-run" } },
    { success: true, data: { runId: "second-run" } },
  ]);
  assert.equal((await orchestrator.dispatch("Say hello", ctx, true)).accepted, true);
  assert.equal((await orchestrator.dispatch("Say goodbye", ctx, true)).accepted, true);
  orchestrator.setEnabled(false);

  complete({ runId: "second-run" });
  complete({ runId: "first-run" });
  complete({ runId: "second-run" });
  assert.deepEqual(messages.map((message) => message.content), [
    "Agent orchestration completed: second-run",
    "Agent orchestration completed: first-run",
  ]);
});

test("AgentOrchestrator does not track rejected dispatches or missing run IDs", async () => {
  const { orchestrator, ctx, complete, messages } = completionHarness(true, [
    { success: false, data: { runId: "rejected-run" } },
    { success: true, data: {} },
  ]);
  assert.equal((await orchestrator.dispatch("Say hello", ctx)).accepted, false);
  assert.equal((await orchestrator.dispatch("Say goodbye", ctx)).accepted, true);

  complete({ runId: "rejected-run" });
  complete({ runId: "unrelated-run" });
  complete({});
  assert.deepEqual(messages, []);
});

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
  assert.match(emittedRequest.params.script, /runs\.run/);
  assert.match(emittedRequest.params.script, /scout/);
  assert.match(emittedRequest.params.script, /worker/);
  assert.match(emittedRequest.params.script, /reviewer/);
});
