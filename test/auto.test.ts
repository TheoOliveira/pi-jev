import test from "node:test";
import assert from "node:assert/strict";
import { AutoJev } from "../src/auto.js";
import { JEV_THRESHOLD } from "../src/skills.js";
import type { JevClient } from "../src/jev.js";
import type { ToolRouter } from "../src/router.js";
import type { SkillRouter } from "../src/skills.js";

function stubs(configured = true) {
  const calls: { evaluate: number; activate: number } = { evaluate: 0, activate: 0 };
  const jevClient = {
    isConfigured: () => configured,
    evaluate: async (request: any) => {
      calls.evaluate += 1;
      assert.ok(request.questions["tool:docker_logs"]);
      assert.ok(request.questions["skill:tdd"]);
      return {
        answers: {
          "tool:docker_logs": { type: "noul", value: 0.9 },
          "skill:tdd": { type: "noul", value: 0.8 },
        },
        model: "test",
        elapsedMs: 1,
      };
    },
  } as unknown as JevClient;
  const router = {
    shortlist: () => [{ name: "docker_logs", description: "Docker logs" }],
    activateTools: (tools: string[]) => {
      calls.activate += 1;
      assert.deepEqual(tools, ["docker_logs"]);
    },
  } as unknown as ToolRouter;
  const skillRouter = {
    getAvailableSkills: () => [{ name: "tdd", description: "Test driven" }],
    shortlist: (skills: any[]) => skills,
  } as unknown as SkillRouter;
  return { jevClient, router, skillRouter, calls };
}

test("AutoJev stays off until enabled", async () => {
  const { jevClient, router, skillRouter, calls } = stubs();
  const auto = new AutoJev(jevClient, router, skillRouter, false);

  const result = await auto.route("inspect docker logs");
  assert.equal(result.ran, false);
  assert.equal(result.reason, "disabled");
  assert.equal(calls.evaluate, 0);
});

test("AutoJev skips when Jev is unconfigured", async () => {
  const { jevClient, router, skillRouter, calls } = stubs(false);
  const auto = new AutoJev(jevClient, router, skillRouter, true);

  const result = await auto.route("inspect docker logs");
  assert.equal(result.ran, false);
  assert.equal(result.reason, "unconfigured");
  assert.equal(calls.evaluate, 0);
});

test("AutoJev routes tools and skills with one Jev request per prompt", async () => {
  const { jevClient, router, skillRouter, calls } = stubs();
  const auto = new AutoJev(jevClient, router, skillRouter, true);

  const result = await auto.route("write tests for docker logs");
  assert.equal(result.ran, true);
  assert.deepEqual(result.activated, ["docker_logs"]);
  assert.deepEqual(result.skills, [{ name: "tdd", probability: 0.8 }]);
  assert.equal(calls.evaluate, 1);
  assert.equal(calls.activate, 1);
});

test("AutoJev ignores slash commands and concurrent prompts, and never throws", async () => {
  const { jevClient, router, skillRouter } = stubs();
  const auto = new AutoJev(jevClient, router, skillRouter, true);

  assert.equal((await auto.route("/jev status")).reason, "empty-prompt");
  assert.equal((await auto.route("   ")).reason, "empty-prompt");

  const failing = new AutoJev(
    { isConfigured: () => true, evaluate: async () => { throw new Error("boom"); } } as unknown as JevClient,
    router,
    skillRouter,
    true
  );
  const failed = await failing.route("anything");
  assert.equal(failed.ran, false);
  assert.equal(failed.reason, "error");

  // A run in flight makes the next prompt skip instead of queueing.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const slow = new AutoJev(
    {
      isConfigured: () => true,
      evaluate: async () => {
        await gate;
        return { answers: {}, model: "test", elapsedMs: 1 };
      },
    } as unknown as JevClient,
    { shortlist: () => [{ name: "slow_tool", description: "Slow" }], activateTools: () => {} } as unknown as ToolRouter,
    { getAvailableSkills: () => [], shortlist: () => [] } as unknown as SkillRouter,
    true
  );
  const first = slow.route("first");
  const second = await slow.route("second");
  assert.equal(second.reason, "busy");
  release();
  assert.equal((await first).ran, true);
});

test("AutoJev uses shared activation threshold for tools and skills", async () => {
  const jevClient = {
    isConfigured: () => true,
    evaluate: async () => ({
      answers: {
        "tool:at_cutoff": { type: "noul", value: JEV_THRESHOLD },
        "tool:below_cutoff": { type: "noul", value: JEV_THRESHOLD - 0.01 },
        "skill:at_cutoff": { type: "noul", value: JEV_THRESHOLD },
        "skill:below_cutoff": { type: "noul", value: JEV_THRESHOLD - 0.01 },
      },
      model: "test",
      elapsedMs: 1,
    }),
  } as unknown as JevClient;

  const activated: string[][] = [];
  const router = {
    shortlist: () => [
      { name: "at_cutoff", description: "At cutoff" },
      { name: "below_cutoff", description: "Below cutoff" },
    ],
    activateTools: (tools: string[]) => activated.push(tools),
  } as unknown as ToolRouter;
  const skillRouter = {
    getAvailableSkills: () => [
      { name: "at_cutoff", description: "At cutoff" },
      { name: "below_cutoff", description: "Below cutoff" },
    ],
    shortlist: (skills: any[]) => skills,
  } as unknown as SkillRouter;

  const result = await new AutoJev(jevClient, router, skillRouter, true).route("anything");
  assert.deepEqual(result.activated, ["at_cutoff"]);
  assert.deepEqual(result.skills, [{ name: "at_cutoff", probability: JEV_THRESHOLD }]);
  assert.deepEqual(activated, [["at_cutoff"]]);
});

test("batched auto and explicit lookup use the same scope-aware skill question", async () => {
  const { SkillRouter } = await import("../src/skills.js");
  const { skills, cases } = await import("./fixtures/skill-routing.js");
  const requests: import("../src/types.js").JevEvaluationRequest[] = [];
  const jevClient: Pick<JevClient, "isConfigured" | "evaluate"> = {
    isConfigured: () => true,
    evaluate: async (request) => {
      requests.push(request);
      return { answers: {}, model: "fixture", elapsedMs: 0 };
    },
  };
  const skillRouter = new SkillRouter({
    getCommands: () => skills.map((s) => ({
      name: `skill:${s.name}`, description: s.description, source: "skill",
      sourceInfo: { path: `/fixtures/${s.name}/SKILL.md`, source: "fixture", scope: "user", origin: "top-level" },
    })),
  }, jevClient);
  const query = cases[0].query;
  const explicit = await skillRouter.findSkills(query);
  const auto = new AutoJev(jevClient, {
    shortlist: () => [{ name: "read", description: "Read files", parameters: {} }],
    activateTools: () => {},
  }, skillRouter, true);
  const result = await auto.route(query);
  assert.equal(result.ran, true);
  assert.equal(requests.length, 2, "one request per route, even with both tools and skills");
  const [directRequest, autoRequest] = requests;
  assert.ok(autoRequest.questions["tool:read"]);
  for (const name of explicit.candidates) {
    assert.deepEqual(autoRequest.questions[`skill:${name}`], directRequest.questions[name]);
    assert.match(autoRequest.questions[`skill:${name}`].instructions, /A shared topic is insufficient/);
  }
  assert.deepEqual(typeof directRequest.state === "object" && directRequest.state.available_skills,
    typeof autoRequest.state === "object" && autoRequest.state.available_skills);
});
