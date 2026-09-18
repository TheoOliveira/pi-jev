#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "jev-gate-runner.ts");

// Use tsx loader or node type stripping to execute runner
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", cliPath, ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env }
);

process.exit(result.status ?? 0);
