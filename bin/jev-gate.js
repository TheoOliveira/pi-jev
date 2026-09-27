#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "jev-gate-runner.ts");
const require = createRequire(import.meta.url);

let tsxLoaderUrl;
try {
  tsxLoaderUrl = pathToFileURL(require.resolve("tsx")).href;
} catch {
  console.error("[jev-gate] ERROR: Missing runtime dependency: tsx.");
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  ["--import", tsxLoaderUrl, cliPath, ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env }
);

process.exit(result.status ?? 0);
