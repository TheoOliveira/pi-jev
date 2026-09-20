import test from "node:test";
import assert from "node:assert/strict";
import { ToolRouter } from "../src/router.js";
import { JEV_THRESHOLD } from "../src/skills.js";
import { JevClient } from "../src/jev.js";

test("ToolRouter shortlists inactive tools correctly using local keywords", () => {
  const mockTools = [
    { name: "read", description: "Read files from disk" },
    { name: "bash", description: "Execute shell commands" },
    { name: "docker_logs", description: "View container docker logs and inspect status" },
    { name: "git_push", description: "Push commits to remote git repository" },
  ];

  let activeTools = ["read", "bash"];

  const mockPi: any = {
    getAllTools: () => mockTools,
    getActiveTools: () => activeTools,
    setActiveTools: (tools: string[]) => {
      activeTools = tools;
    },
  };

  const jevClient = new JevClient();
  const router = new ToolRouter(mockPi, jevClient);

  const candidates = router.shortlist("docker container logs");
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].name, "docker_logs");
});

test("ToolRouter findAndActivate fallback when unconfigured does not activate unjudged tools", async () => {
  const mockTools = [
    { name: "read", description: "Read files" },
    { name: "sqlite_query", description: "Query sqlite database" },
    { name: "postgres_query", description: "Query postgres database" },
  ];

  let activeTools = ["read"];

  const mockPi: any = {
    getAllTools: () => mockTools,
    getActiveTools: () => activeTools,
    setActiveTools: (tools: string[]) => {
      activeTools = tools;
    },
  };

  // Stub unconfigured client: local runs may have a real API key or secret file.
  const jevClient = { isConfigured: () => false } as unknown as JevClient;
  const router = new ToolRouter(mockPi, jevClient);

  const result = await router.findAndActivate("run SQL query against sqlite");
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.activated, []);
  assert.equal(result.probabilities["sqlite_query"], 0);
  assert.deepEqual(activeTools, ["read"]); // preserves existing without expanding
});

test("ToolRouter never offers its own jev tools as candidates", async () => {
  // Regression: after /jev disable, routing used to re-activate jev_find_skill/jev_evaluate.
  const mockTools = [
    { name: "read", description: "Read files" },
    { name: "jev_find_tools", description: "Find and activate tools" },
    { name: "jev_find_skill", description: "Find matching skills" },
    { name: "jev_evaluate", description: "Typed evaluations" },
    { name: "sqlite_query", description: "Query sqlite" },
  ];
  let activeTools = ["read"];

  const mockPi: any = {
    getAllTools: () => mockTools,
    getActiveTools: () => activeTools,
    setActiveTools: (tools: string[]) => {
      activeTools = tools;
    },
  };

  const jevClient = { isConfigured: () => false } as unknown as JevClient;
  const router = new ToolRouter(mockPi, jevClient);

  const candidates = router.shortlist("evaluate skills and find tools").map((c) => c.name);
  assert.ok(!candidates.includes("jev_find_tools"));
  assert.ok(!candidates.includes("jev_find_skill"));
  assert.ok(!candidates.includes("jev_evaluate"));

  const result = await router.findAndActivate("evaluate skills and find tools");
  assert.deepEqual(result.activated, []);
});

test("ToolRouter accepts a probability exactly at the shared threshold and rejects below it", async () => {
  const withProbability = (value: number | undefined) => {
    const jevClient = {
      isConfigured: () => value !== undefined,
      evaluate: async () => ({
        answers: value === undefined ? {} : { sqlite_query: { type: "noul", value } },
        model: "m",
        elapsedMs: 1,
      }),
    } as unknown as JevClient;
    const pi: any = {
      getAllTools: () => [{ name: "sqlite_query", description: "Query sqlite" }],
      getActiveTools: () => [],
      setActiveTools: () => {},
    };
    return new ToolRouter(pi, jevClient);
  };

  const atCutoff = await withProbability(JEV_THRESHOLD).findAndActivate("query sqlite");
  assert.deepEqual(atCutoff.activated, ["sqlite_query"]);
  assert.equal(atCutoff.fallbackUsed, false);

  const belowCutoff = await withProbability(JEV_THRESHOLD - 0.01).findAndActivate("query sqlite");
  assert.deepEqual(belowCutoff.activated, []);
});

test("JevClient handles unconfigured state safely without throwing in check", () => {
  const client = new JevClient();
  assert.equal(typeof client.isConfigured(), "boolean");
});
