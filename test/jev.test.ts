import test from "node:test";
import assert from "node:assert/strict";
import { JevClient, resolveBaseURL } from "../src/jev.js";

const OLD_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...OLD_ENV };
});

test("resolveBaseURL prefers PI_JEV_BASE_URL over TYPESAFE_BASE_URL", () => {
  process.env.TYPESAFE_BASE_URL = "http://typesafe.local";
  process.env.PI_JEV_BASE_URL = "http://pi-jev.local";

  assert.equal(resolveBaseURL(), "http://pi-jev.local");
});

test("custom endpoint configures JevClient without API key", () => {
  delete process.env.TYPESAFE_API_KEY;
  process.env.PI_JEV_BASE_URL = "http://localhost:8000";

  const client = new JevClient();

  assert.equal(client.isConfigured(), true);
  assert.equal(client.getBaseURL(), "http://localhost:8000");
});

test("JevClient stats sum SDK snake_case token usage", async () => {
  const client = new JevClient();
  client.setApiKey("test-key");
  (client as any).client = {
    systemOne: async () => ({
      model: "jev-test",
      usage: { input_tokens: 3, output_tokens: 4 },
      answers: { pick: { choice: "yes" } },
    }),
  };

  await client.evaluate({
    state: "state",
    questions: {
      pick: { type: "choice", instructions: "pick", criteria: { yes: null } },
    },
  });

  assert.equal(client.stats.requestsCount, 1);
  assert.equal(client.stats.totalTokens, 7);
});

test("JevClient reports env key origin instead of in-session", () => {
  process.env.TYPESAFE_API_KEY = "env-key";

  const client = new JevClient();

  assert.equal(client.getKeyOrigin(), "$TYPESAFE_API_KEY");
});

test("JevClient reports explicit runtime key as in-session", () => {
  const client = new JevClient();
  client.setApiKey("runtime-key");

  assert.equal(client.getKeyOrigin(), "set in-session");
});

test("JevClient lets non-empty runtime key override env key", () => {
  process.env.TYPESAFE_API_KEY = "env-key";

  const client = new JevClient();
  client.setApiKey(" runtime-key ");

  assert.equal(client.getKeyOrigin(), "set in-session");
  assert.equal((client as any).getActiveApiKey().key, "runtime-key");
});

test("JevClient ignores empty runtime key and keeps env key", () => {
  process.env.TYPESAFE_API_KEY = "env-key";

  const client = new JevClient();
  client.setApiKey("  ");

  assert.equal(client.getKeyOrigin(), "$TYPESAFE_API_KEY");
  assert.equal((client as any).getActiveApiKey().key, "env-key");
});
