import test from "node:test";
import assert from "node:assert/strict";
import { JevClient } from "../src/jev.js";

test("JevClient reports env key origin instead of in-session", () => {
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "env-key";
  try {
    const client = new JevClient();
    assert.equal(client.getKeyOrigin(), "$TYPESAFE_API_KEY");
  } finally {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  }
});

test("JevClient reports explicit runtime key as in-session", () => {
  const client = new JevClient();
  client.setApiKey("runtime-key");
  assert.equal(client.getKeyOrigin(), "set in-session");
});
