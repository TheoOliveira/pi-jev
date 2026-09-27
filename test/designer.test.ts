import test from "node:test";
import assert from "node:assert/strict";
import { extractJson, validateDesign, MAX_DESIGNED_QUESTIONS } from "../src/designer.js";

test("extractJson reads raw, fenced, and prose-wrapped model output", () => {
  const body = '{"state":{"a":1},"questions":{}}';
  assert.deepEqual(extractJson(body), { state: { a: 1 }, questions: {} });
  assert.deepEqual(extractJson("```json\n" + body + "\n```"), { state: { a: 1 }, questions: {} });
  assert.deepEqual(extractJson(`Here you go:\n${body}\nDone.`), { state: { a: 1 }, questions: {} });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson("{broken"), null);
});

test("validateDesign accepts each question type", () => {
  const design = validateDesign({
    state: "parse error on line 3",
    questions: {
      is_bug: { type: "noul", instructions: "Is this a bug?" },
      kind: {
        type: "choice",
        instructions: "What kind?",
        criteria: { syntax: "syntax error", runtime: "runtime error" },
      },
      severity: { type: "score", instructions: "How severe?", criteria: ["high", "medium", "low"] },
    },
  });

  assert.ok(design);
  assert.equal(design.state, "parse error on line 3");
  assert.deepEqual(Object.keys(design.questions), ["is_bug", "kind", "severity"]);
  assert.equal(design.questions.kind.type, "choice");
  assert.deepEqual((design.questions.severity as any).criteria, ["high", "medium", "low"]);
});

test("validateDesign drops malformed questions and rejects unusable designs", () => {
  const design = validateDesign({
    state: { log: "x" },
    questions: {
      ok: { type: "noul", instructions: "Yes?" },
      bad_type: { type: "essay", instructions: "Why?" },
      no_criteria_choice: { type: "choice", instructions: "Which?" },
      empty_score: { type: "score", instructions: "How much?", criteria: [] },
      blank_instructions: { type: "noul", instructions: "  " },
    },
  });

  assert.ok(design);
  assert.deepEqual(Object.keys(design.questions), ["ok"]);

  assert.equal(validateDesign({ questions: {} }), null); // no state
  assert.equal(validateDesign({ state: "x", questions: {} }), null); // no questions
  assert.equal(validateDesign(null), null);
  assert.equal(validateDesign("nope"), null);
  assert.equal(validateDesign({ state: 42, questions: { a: { type: "noul", instructions: "x" } } }), null);
});

test("designed question bound stays within a bounded Jev request", () => {
  assert.ok(MAX_DESIGNED_QUESTIONS >= 1 && MAX_DESIGNED_QUESTIONS <= 10);
});
