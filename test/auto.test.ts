import test from "node:test";
import assert from "node:assert/strict";
import { AutoJev } from "../src/auto.js";
import { JevClient } from "../src/jev.js";

function makeFakeJevClient(answers: Record<string, number> = {}) {
  return {
    isConfigured: () => true,
    evaluate: async () => ({
      answers: Object.fromEntries(
        Object.entries(answers).map(([k, v]) => [k, { type: "noul", value: v }])
      ),
      model: "mock-jev",
      elapsedMs: 5,
    }),
  } as unknown as JevClient;
}

test("AutoJev stays off until enabled", async () => {
  const jevClient = makeFakeJevClient();
  const auto = new AutoJev(jevClient, { shortlist: () => [], activateTools: () => {} }, { findSkills: async () => ({ matched: [], evaluated: 0, candidates: [] }) });

  assert.equal(auto.enabled, false);
  const result = await auto.route("anything");
  assert.equal(result.ran, false);
  assert.equal(result.reason, "disabled");
});

test("AutoJev skips when Jev is unconfigured", async () => {
  const unconfiguredClient = { isConfigured: () => false } as unknown as JevClient;
  const auto = new AutoJev(
    unconfiguredClient,
    { shortlist: () => [], activateTools: () => {} },
    { findSkills: async () => ({ matched: [], evaluated: 0, candidates: [] }) },
    true
  );

  const result = await auto.route("anything");
  assert.equal(result.ran, false);
  assert.equal(result.reason, "unconfigured");
});

test("AutoJev routes tools and skills with one Jev request per prompt", async () => {
  let evaluatedRequests = 0;
  let sentQuestions: Record<string, unknown> = {};

  const fakeClient = {
    isConfigured: () => true,
    evaluate: async (req: { questions: Record<string, unknown> }) => {
      evaluatedRequests++;
      sentQuestions = req.questions;
      return {
        answers: {
          "tool:curl": { type: "noul", value: 0.9 },
          "tool:git": { type: "noul", value: 0.2 },
          "skill:docker": { type: "noul", value: 0.8 },
          "skill:python": { type: "noul", value: 0.1 },
        },
        model: "mock-jev",
        elapsedMs: 8,
      };
    },
  } as unknown as JevClient;

  const activated: string[][] = [];
  const fakeToolRouter = {
    shortlist: () => [
      { name: "curl", description: "Fetch URL", parameters: {} },
      { name: "git", description: "Git commands", parameters: {} },
    ],
    activateTools: (names: string[]) => {
      activated.push(names);
    },
  };

  const fakeSkillRouter = {
    shortlist: () => [
      { name: "docker", description: "Docker setup", path: "/skills/docker/SKILL.md" },
      { name: "python", description: "Python tools", path: "/skills/python/SKILL.md" },
    ],
  };

  const auto = new AutoJev(fakeClient, fakeToolRouter, fakeSkillRouter, true);
  const result = await auto.route("fetch this url and containerize it");

  assert.equal(result.ran, true);
  assert.equal(evaluatedRequests, 1, "Should combine tools and skills into a single Jev request");
  assert.ok("tool:curl" in sentQuestions);
  assert.ok("tool:git" in sentQuestions);
  assert.ok("skill:docker" in sentQuestions);
  assert.ok("skill:python" in sentQuestions);

  assert.deepEqual(result.activated, ["curl"]);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, "docker");
  assert.deepEqual(activated, [["curl"]]);
});

test("AutoJev ignores slash commands and concurrent prompts, and never throws", async () => {
  const fakeClient = {
    isConfigured: () => true,
    evaluate: async () => {
      throw new Error("network went down");
    },
  } as unknown as JevClient;

  const auto = new AutoJev(
    fakeClient,
    {
      shortlist: () => [{ name: "curl", description: "Fetch URL", parameters: {} }],
      activateTools: () => {},
    },
    { shortlist: () => [] },
    true
  );

  const commandResult = await auto.route("/help");
  assert.equal(commandResult.ran, false);
  assert.equal(commandResult.reason, "command");

  // Router handles underlying Jev errors gracefully without throwing
  const errorResult = await auto.route("run some code");
  assert.equal(errorResult.ran, false);
  assert.equal(errorResult.reason, "error");
});

test("AutoJev uses shared activation threshold for tools and skills", async () => {
  const fakeClient = {
    isConfigured: () => true,
    evaluate: async () => ({
      answers: {
        "tool:exact": { type: "noul", value: 0.65 },
        "tool:below": { type: "noul", value: 0.649 },
        "skill:exact": { type: "noul", value: 0.65 },
        "skill:below": { type: "noul", value: 0.649 },
      },
      model: "mock-jev",
      elapsedMs: 2,
    }),
  } as unknown as JevClient;

  const activated: string[][] = [];
  const fakeToolRouter = {
    shortlist: () => [
      { name: "exact", description: "On the edge", parameters: {} },
      { name: "below", description: "Just under", parameters: {} },
    ],
    activateTools: (names: string[]) => activated.push(names),
  };

  const fakeSkillRouter = {
    shortlist: () => [
      { name: "exact", description: "On the edge", path: "/skills/exact/SKILL.md" },
      { name: "below", description: "Just under", path: "/skills/below/SKILL.md" },
    ],
  };

  const auto = new AutoJev(fakeClient, fakeToolRouter, fakeSkillRouter, true);
  const result = await auto.route("test threshold");

  assert.deepEqual(result.activated, ["exact"]);
  assert.deepEqual(result.skills.map(s => s.name), ["exact"]);
});

test("a pending model question rides along in the single routing request", async () => {
  const seen: string[][] = [];
  const jevClient = {
    isConfigured: () => true,
    evaluate: async (req: any) => {
      seen.push(Object.keys(req.questions));
      return { answers: { "model:switch": { type: "noul", value: 0.9 }, "tool:bash": { type: "noul", value: 0.9 } }, model: "m", elapsedMs: 1 };
    },
  } as any;
  const pi: any = {
    getActiveTools: () => ["read"],
    getAllTools: () => [{ name: "bash" }, { name: "read" }, { name: "grep" }],
    setActiveTools: () => {},
    getAllSkills: () => [],
    getCommands: () => [],
  };
  const { ToolRouter } = await import("../src/router.js");
  const { SkillRouter } = await import("../src/skills.js");
  const auto = new AutoJev(jevClient, new ToolRouter(pi, jevClient), new SkillRouter(pi, jevClient), true);
  auto.pendingQuestions = [{ key: "model:switch", instructions: "Would switching help?" }];

  const ctx: any = { model: {}, modelRegistry: { getAvailable: () => [] }, getSystemPrompt: () => "", getContextUsage: () => undefined, ui: { setStatus: () => {} } };
  const result = await auto.route("debug this failing test", ctx);

  assert.equal(seen.length, 1, "exactly one Jev request");
  assert.ok(seen[0].includes("model:switch"), `batch should carry the model question, got ${seen[0]}`);
  assert.equal(result.modelConfidence, 0.9);
  assert.equal(auto.pendingQuestions.length, 0, "pending questions are consumed, not re-sent");
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
