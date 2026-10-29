import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  JevClient,
  resolveBaseURL,
  resolveModel,
  resolveApiKeySource,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
} from "../src/jev.js";

const OLD_ENV = { ...process.env };

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in OLD_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, OLD_ENV);
});

test("resolveBaseURL prefers PI_JEV_BASE_URL over TYPESAFE_BASE_URL", () => {
  delete process.env.OPENROUTER_API_KEY;
  process.env.TYPESAFE_BASE_URL = "http://typesafe.local";
  process.env.PI_JEV_BASE_URL = "http://pi-jev.local";

  assert.equal(resolveBaseURL(), "http://pi-jev.local");
});

test("custom endpoint configures JevClient without API key", () => {
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.PI_JEV_BASE_URL = "http://localhost:8000";

  const client = new JevClient();

  assert.equal(client.isConfigured(), true);
  assert.equal(client.getBaseURL(), "http://localhost:8000");
});

test("JevClient stats sum SDK snake_case token usage", async () => {
  delete process.env.OPENROUTER_API_KEY;
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

test("resolveModel prefers PI_JEV_MODEL over TYPESAFE_DEFAULT_MODEL", () => {
  process.env.PI_JEV_MODEL = "tev1:0.8b";
  process.env.TYPESAFE_DEFAULT_MODEL = "typesafe/jev-1.13";

  assert.equal(resolveModel(), "tev1:0.8b");
});

test("resolveModel falls back to TYPESAFE_DEFAULT_MODEL when PI_JEV_MODEL is not set", () => {
  delete process.env.PI_JEV_MODEL;
  process.env.TYPESAFE_DEFAULT_MODEL = "typesafe/jev-1.13";

  assert.equal(resolveModel(), "typesafe/jev-1.13");
});

test("resolveModel trims whitespace and returns null when empty", () => {
  process.env.PI_JEV_MODEL = "  tev1:0.8b  ";
  assert.equal(resolveModel(), "tev1:0.8b");

  process.env.PI_JEV_MODEL = "   ";
  delete process.env.TYPESAFE_DEFAULT_MODEL;
  assert.equal(resolveModel(), null);

  delete process.env.PI_JEV_MODEL;
  assert.equal(resolveModel(), null);
});

test("JevClient getModel and setModel manage model configuration", () => {
  delete process.env.PI_JEV_MODEL;
  delete process.env.TYPESAFE_DEFAULT_MODEL;
  delete process.env.OPENROUTER_API_KEY;

  const client = new JevClient();
  assert.equal(client.getModel(), null);

  process.env.PI_JEV_MODEL = "tev1:0.8b";
  assert.equal(client.getModel(), "tev1:0.8b");

  client.setModel("custom-model");
  assert.equal(client.getModel(), "custom-model");

  client.setModel("   ");
  assert.equal(client.getModel(), "tev1:0.8b");
});

test("resolveApiKeySource resolves OPENROUTER_API_KEY when TYPESAFE_API_KEY is not set", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-jev-home-"));
  try {
    process.env.HOME = tmpHome;
    delete process.env.TYPESAFE_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    const resolved = resolveApiKeySource();
    assert.deepEqual(resolved, {
      key: "sk-or-test-key",
      source: "env",
      origin: "$OPENROUTER_API_KEY",
    });
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("resolveApiKeySource resolves ~/.pi/agent/secrets/openrouter_api_key fallback secret file", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-jev-home-"));
  try {
    process.env.HOME = tmpHome;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const secretsDir = path.join(tmpHome, ".pi", "agent", "secrets");
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.writeFileSync(path.join(secretsDir, "openrouter_api_key"), "sk-or-file-key\n");

    const resolved = resolveApiKeySource();
    assert.deepEqual(resolved, {
      key: "sk-or-file-key",
      source: "file",
      origin: "~/.pi/agent/secrets/openrouter_api_key",
    });
    assert.equal(resolveBaseURL(), "https://openrouter.ai/api");
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("resolveApiKeySource prefers TYPESAFE_API_KEY over OPENROUTER_API_KEY", () => {
  process.env.TYPESAFE_API_KEY = "ts-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test-key";

  const resolved = resolveApiKeySource();
  assert.deepEqual(resolved, {
    key: "ts-key",
    source: "env",
    origin: "$TYPESAFE_API_KEY",
  });
});

test("resolveBaseURL defaults to https://openrouter.ai/api when OPENROUTER_API_KEY is active and PI_JEV_BASE_URL is not set", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-jev-home-"));
  try {
    process.env.HOME = tmpHome;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.PI_JEV_BASE_URL;
    delete process.env.TYPESAFE_BASE_URL;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    assert.equal(resolveBaseURL(), OPENROUTER_DEFAULT_BASE_URL);
    assert.equal(resolveBaseURL(), "https://openrouter.ai/api");
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("PI_JEV_BASE_URL overrides default OpenRouter base URL when both are set", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-jev-home-"));
  try {
    process.env.HOME = tmpHome;
    delete process.env.TYPESAFE_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    process.env.PI_JEV_BASE_URL = "http://localhost:8000";

    assert.equal(resolveBaseURL(), "http://localhost:8000");
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("JevClient defaults to OpenRouter base URL and ~typesafe/jev-latest model when OPENROUTER_API_KEY is set", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-jev-home-"));
  try {
    process.env.HOME = tmpHome;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.PI_JEV_BASE_URL;
    delete process.env.TYPESAFE_BASE_URL;
    delete process.env.PI_JEV_MODEL;
    delete process.env.TYPESAFE_DEFAULT_MODEL;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    const client = new JevClient();
    assert.equal(client.isConfigured(), true);
    assert.equal(client.getKeyOrigin(), "$OPENROUTER_API_KEY");
    assert.equal(client.getBaseURL(), "https://openrouter.ai/api");
    assert.equal(client.getModel(), OPENROUTER_DEFAULT_MODEL);
    assert.equal(client.getModel(), "~typesafe/jev-latest");
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("JevClient with OPENROUTER_API_KEY honors PI_JEV_MODEL override", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-jev-home-"));
  try {
    process.env.HOME = tmpHome;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.PI_JEV_BASE_URL;
    delete process.env.TYPESAFE_BASE_URL;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    process.env.PI_JEV_MODEL = "typesafe/jev-1.13";

    const client = new JevClient();
    assert.equal(client.getModel(), "typesafe/jev-1.13");
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("evaluate passes request.model to client.systemOne", async () => {
  let passedModel: string | undefined;
  const client = new JevClient();
  client.setApiKey("test-key");
  (client as any).client = {
    systemOne: async (req: any) => {
      passedModel = req.model;
      return {
        model: req.model,
        usage: { input_tokens: 1, output_tokens: 1 },
        answers: {},
      };
    },
  };

  await client.evaluate({
    state: "test state",
    questions: {},
    model: "custom-req-model",
  });

  assert.equal(passedModel, "custom-req-model");
});

test("evaluate passes JevClient getModel() to client.systemOne when request.model is omitted", async () => {
  let passedModel: string | undefined;
  const client = new JevClient();
  client.setApiKey("test-key");
  client.setModel("client-model-override");
  (client as any).client = {
    systemOne: async (req: any) => {
      passedModel = req.model;
      return {
        model: req.model,
        usage: { input_tokens: 1, output_tokens: 1 },
        answers: {},
      };
    },
  };

  await client.evaluate({
    state: "test state",
    questions: {},
  });

  assert.equal(passedModel, "client-model-override");
});

test("evaluate passes undefined model to systemOne when unconfigured and request.model is omitted", async () => {
  delete process.env.PI_JEV_MODEL;
  delete process.env.TYPESAFE_DEFAULT_MODEL;
  delete process.env.OPENROUTER_API_KEY;

  let passedModel: string | undefined;
  const client = new JevClient();
  client.setApiKey("test-key");
  (client as any).client = {
    systemOne: async (req: any) => {
      passedModel = req.model;
      return {
        model: "jev-latest",
        usage: { input_tokens: 1, output_tokens: 1 },
        answers: {},
      };
    },
  };

  await client.evaluate({
    state: "test state",
    questions: {},
  });

  assert.equal(passedModel, undefined);
});

test("evaluate passes OpenRouter default model to systemOne when OPENROUTER_API_KEY is active", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-jev-home-"));
  try {
    process.env.HOME = tmpHome;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.PI_JEV_BASE_URL;
    delete process.env.TYPESAFE_BASE_URL;
    delete process.env.PI_JEV_MODEL;
    delete process.env.TYPESAFE_DEFAULT_MODEL;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    let passedModel: string | undefined;
    const client = new JevClient();
    (client as any).client = {
      systemOne: async (req: any) => {
        passedModel = req.model;
        return {
          model: req.model,
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: {},
        };
      },
    };

    await client.evaluate({
      state: "test state",
      questions: {},
    });

    assert.equal(passedModel, "~typesafe/jev-latest");
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
