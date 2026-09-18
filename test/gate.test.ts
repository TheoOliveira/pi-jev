import test from "node:test";
import assert from "node:assert/strict";
import { parseGateArgs, resolveGateState, evaluateGate } from "../src/gate.js";
import { JevClient } from "../src/jev.js";

test("parseGateArgs parses flags and criteria correctly", () => {
  const args = ["--criteria", "All tests pass", "-p", "0.85", "--diff", "--json", "--fail-open"];
  const opts = parseGateArgs(args);
  assert.equal(opts.criteria, "All tests pass");
  assert.equal(opts.threshold, 0.85);
  assert.equal(opts.diff, true);
  assert.equal(opts.json, true);
  assert.equal(opts.failOpen, true);
});

test("parseGateArgs handles positional criteria", () => {
  const args = ["Code is clean and modular", "-p", "0.9"];
  const opts = parseGateArgs(args);
  assert.equal(opts.criteria, "Code is clean and modular");
  assert.equal(opts.threshold, 0.9);
});

test("resolveGateState returns provided state string or diff fallback", () => {
  const state = resolveGateState({ criteria: "test", state: "function foo() { return 42; }" });
  assert.equal(state, "function foo() { return 42; }");
});

test("evaluateGate fails open when unconfigured if failOpen is true", async () => {
  const mockClient = new JevClient();
  mockClient.isConfigured = () => false;

  const result = await evaluateGate(
    { criteria: "Must not break build", failOpen: true },
    mockClient
  );
  assert.equal(result.passed, true);
  assert.equal(result.probability, 1.0);
});

test("evaluateGate evaluates gate condition with JevClient", async () => {
  const mockClient = new JevClient();
  mockClient.isConfigured = () => true;
  mockClient.evaluate = async () => ({
    answers: {
      gate_passed: {
        type: "noul",
        value: 0.92,
        confidence: 0.95,
      },
    },
    model: "jev-latest",
    elapsedMs: 45,
  });

  const passResult = await evaluateGate(
    { criteria: "Clean TypeScript with no any", threshold: 0.8, state: "const x: number = 1;" },
    mockClient
  );
  assert.equal(passResult.passed, true);
  assert.equal(passResult.probability, 0.92);

  const failResult = await evaluateGate(
    { criteria: "Clean TypeScript with no any", threshold: 0.95, state: "const x: number = 1;" },
    mockClient
  );
  assert.equal(failResult.passed, false);
});
