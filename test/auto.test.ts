import test from "node:test";
import assert from "node:assert/strict";
import { AutoJev } from "../src/auto.js";
import { JEV_THRESHOLD } from "../src/skills.js";
import type { JevClient } from "../src/jev.js";
import type { ToolRouter } from "../src/router.js";
import type { SkillRouter } from "../src/skills.js";

function stubs(configured = true) {
  const calls: { tools: number; skills: number } = { tools: 0, skills: 0 };
  const jevClient = { isConfigured: () => configured } as unknown as JevClient;
  const router = {
    findAndActivate: async (query: string, threshold?: number) => {
      calls.tools += 1;
      return {
        query,
        candidates: ["docker_logs"],
        activated: ["docker_logs"],
        probabilities: { docker_logs: 0.9 },
        fallbackUsed: false,
        elapsedMs: 1,
      };
    },
  } as unknown as ToolRouter;
  const skillRouter = {
    findSkills: async (query: string) => {
      calls.skills += 1;
      return {
        query,
        candidates: ["tdd"],
        recommended: [{ name: "tdd", description: "Test driven", probability: 0.8 }],
        fallbackUsed: false,
        elapsedMs: 1,
      };
    },
  } as unknown as SkillRouter;
  return { jevClient, router, skillRouter, calls };
}

test("AutoJev stays off until enabled", async () => {
  const { jevClient, router, skillRouter, calls } = stubs();
  const auto = new AutoJev(jevClient, router, skillRouter, false);

  const result = await auto.route("inspect docker logs");
  assert.equal(result.ran, false);
  assert.equal(result.reason, "disabled");
  assert.equal(calls.tools, 0);
  assert.equal(calls.skills, 0);
});

test("AutoJev skips when Jev is unconfigured", async () => {
  const { jevClient, router, skillRouter, calls } = stubs(false);
  const auto = new AutoJev(jevClient, router, skillRouter, true);

  const result = await auto.route("inspect docker logs");
  assert.equal(result.ran, false);
  assert.equal(result.reason, "unconfigured");
  assert.equal(calls.tools + calls.skills, 0);
});

test("AutoJev routes tools and skills for one prompt", async () => {
  const { jevClient, router, skillRouter, calls } = stubs();
  const auto = new AutoJev(jevClient, router, skillRouter, true);

  const result = await auto.route("write tests for docker logs");
  assert.equal(result.ran, true);
  assert.deepEqual(result.activated, ["docker_logs"]);
  assert.deepEqual(result.skills, [{ name: "tdd", probability: 0.8 }]);
  assert.equal(calls.tools, 1);
  assert.equal(calls.skills, 1);
});

test("AutoJev ignores slash commands and concurrent prompts, and never throws", async () => {
  const { jevClient, router, skillRouter } = stubs();
  const auto = new AutoJev(jevClient, router, skillRouter, true);

  assert.equal((await auto.route("/jev status")).reason, "empty-prompt");
  assert.equal((await auto.route("   ")).reason, "empty-prompt");

  const failing = new AutoJev(
    jevClient,
    { findAndActivate: async () => { throw new Error("boom"); } } as unknown as ToolRouter,
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
    jevClient,
    { findAndActivate: async () => { await gate; return { activated: [] }; } } as unknown as ToolRouter,
    { findSkills: async () => ({ recommended: [] }) } as unknown as SkillRouter,
    true
  );
  const first = slow.route("first");
  const second = await slow.route("second");
  assert.equal(second.reason, "busy");
  release();
  assert.equal((await first).ran, true);
});

test("every Jev path shares one activation threshold", async () => {
  // Auto mode must use the same cutoff as the router and command defaults.
  const recorded: number[] = [];
  const jevClient = { isConfigured: () => true } as unknown as JevClient;

  const spyRouter = {
    findAndActivate: async (_q: string, threshold?: number) => {
      recorded.push(threshold ?? -1);
      return { query: _q, candidates: [], activated: [], probabilities: {}, fallbackUsed: false, elapsedMs: 1 };
    },
  } as unknown as ToolRouter;
  const spySkills = {
    findSkills: async (_q: string, threshold?: number) => {
      recorded.push(threshold ?? -1);
      return { query: _q, candidates: [], recommended: [], fallbackUsed: false, elapsedMs: 1 };
    },
  } as unknown as SkillRouter;

  await new AutoJev(jevClient, spyRouter, spySkills, true).route("anything");
  assert.deepEqual(recorded, [JEV_THRESHOLD, JEV_THRESHOLD]);
});
