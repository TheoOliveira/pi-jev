import test from "node:test";
import assert from "node:assert/strict";
import { SkillRouter, type SkillMetadata } from "../src/skills.js";
import { JevClient } from "../src/jev.js";

test("SkillRouter shortlists skills based on query terms", () => {
  const mockSkills: SkillMetadata[] = [
    { name: "tdd", description: "Test-driven development and unit testing" },
    { name: "frontend-design", description: "Create distinctive production-grade UI interfaces" },
    { name: "resolving-merge-conflicts", description: "Resolve git rebase and merge conflicts" },
    { name: "accessibility", description: "Audit and improve WCAG accessibility" },
  ];

  const mockPi: any = {
    getCommands: () => [],
  };

  const jevClient = new JevClient();
  const router = new SkillRouter(mockPi, jevClient);

  const candidates = router.shortlist(mockSkills, "fix git rebase conflicts");
  assert.equal(candidates.length, 4);
  assert.equal(candidates[0].name, "resolving-merge-conflicts");
});

test("SkillRouter fallback returns matching keyword candidates with 0 probability", async () => {
  const mockSkills: SkillMetadata[] = [
    { name: "tdd", description: "Test-driven development" },
    { name: "accessibility", description: "Audit web accessibility" },
  ];

  const mockPi: any = {
    getCommands: () =>
      mockSkills.map((s) => ({
        name: s.name,
        description: s.description,
        source: "skill",
      })),
  };

  // Stub unconfigured client: local runs may have a real API key or secret file.
  const jevClient = { isConfigured: () => false } as unknown as JevClient;
  const router = new SkillRouter(mockPi, jevClient);

  const res = await router.findSkills("make web accessible");
  assert.equal(res.fallbackUsed, true);
  assert.equal(res.recommended.length, 1);
  assert.equal(res.recommended[0].name, "accessibility");
  assert.equal(res.recommended[0].probability, 0);
});

test("skill questions distinguish requested workflow and scope from topical relevance", async () => {
  const { skills, cases } = await import("./fixtures/skill-routing.js");
  const requests: import("../src/types.js").JevEvaluationRequest[] = [];
  const router = new SkillRouter({
    getCommands: () => skills.map((s) => ({
      name: `skill:${s.name}`, description: s.description, source: "skill",
      sourceInfo: { path: `/fixtures/${s.name}/SKILL.md`, source: "fixture", scope: "user", origin: "top-level" },
    })),
  }, {
    isConfigured: () => true,
    evaluate: async (request) => {
      requests.push(request);
      return { answers: {}, model: "fixture", elapsedMs: 0 };
    },
  });
  const query = cases[0].query;
  const result = await router.findSkills(query);
  const request = requests[0];
  assert.ok(request);
  const index = result.candidates.indexOf("skill:setup-pstack");
  assert.ok(index >= 0, "the skill remains a candidate; it is not blacklisted");
  assert.equal(request.questions["skill:setup-pstack"].instructions,
    `Does \`task\` request the activity described by \`available_skills[${index}]\`, in the product or framework that skill targets? A shared topic is insufficient. Do not assume a named product is in use when the task does not identify it. Reporting a defect is not a request to configure a different system. Mentioning a skill to investigate its recommendation does not request its workflow.`);
  for (const [i, name] of result.candidates.entries()) {
    assert.match(request.questions[name].instructions, new RegExp(`available_skills\\[${i}\\]`));
    assert.ok(!request.questions[name].instructions.includes(query), "task text stays in state, not instructions");
  }
  assert.equal(typeof request.state === "object" && request.state.task, query);
});

test("scope-aware skills retain multi-label recommendations and the existing cutoff", async () => {
  const router = new SkillRouter({
    getCommands: () => ["setup-pstack", "diagnosing-bugs", "other"].map((name) => ({
      name: `skill:${name}`, description: name, source: "skill",
      sourceInfo: { path: `/fixtures/${name}/SKILL.md`, source: "fixture", scope: "user", origin: "top-level" },
    })),
  }, {
    isConfigured: () => true,
    evaluate: async () => ({
      answers: {
        "skill:setup-pstack": { type: "noul", value: 0.95 },
        "skill:diagnosing-bugs": { type: "noul", value: 0.65 },
        "skill:other": { type: "noul", value: 0.64 },
      },
      model: "fixture", elapsedMs: 0,
    }),
  });
  const result = await router.findSkills("Configure pstack models and diagnose a bug");
  assert.deepEqual(result.recommended.map((s) => s.name), ["skill:setup-pstack", "skill:diagnosing-bugs"]);
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual((await router.findSkills("same task", 0.96)).recommended, []);
});
