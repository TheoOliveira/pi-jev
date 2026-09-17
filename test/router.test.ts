import test from "node:test";
import assert from "node:assert/strict";
import { ToolRouter } from "../src/router.js";
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

test("ToolRouter findAndActivate fallback when unconfigured activates top local candidates", async () => {
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

  const jevClient = new JevClient();
  const router = new ToolRouter(mockPi, jevClient);

  const result = await router.findAndActivate("run SQL query against sqlite");
  assert.equal(result.fallbackUsed, true);
  assert.ok(result.activated.includes("sqlite_query"));
  assert.ok(activeTools.includes("sqlite_query"));
  assert.ok(activeTools.includes("read")); // preserves existing
});

test("JevClient handles unconfigured state safely without throwing in check", () => {
  const client = new JevClient();
  assert.equal(typeof client.isConfigured(), "boolean");
});
