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
  assert.equal(client.getKeyOrigin(), null);
  assert.equal(client.getBaseURL(), "http://localhost:8000");
});
