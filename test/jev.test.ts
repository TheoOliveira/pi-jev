import test from "node:test";
import assert from "node:assert/strict";
import { JevClient } from "../src/jev.js";

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
