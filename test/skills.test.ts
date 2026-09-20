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
