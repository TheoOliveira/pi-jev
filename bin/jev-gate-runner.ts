import { parseGateArgs, evaluateGate } from "../src/gate.js";
import { JevClient } from "../src/jev.js";

async function main() {
  const args = process.argv.slice(2);
  const options = parseGateArgs(args);

  try {
    const client = new JevClient();
    const result = await evaluateGate(options, client);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const probStr = (result.probability * 100).toFixed(1) + "%";
      const threshStr = (result.threshold * 100).toFixed(1) + "%";
      if (result.passed) {
        console.log(`[jev-gate] PASS: P=${probStr} >= ${threshStr} (${result.elapsedMs}ms)`);
        console.log(`Criteria: "${result.criteria}"`);
      } else {
        console.error(`[jev-gate] FAIL: P=${probStr} < ${threshStr} (${result.elapsedMs}ms)`);
        console.error(`Criteria: "${result.criteria}"`);
      }
    }

    process.exit(result.passed ? 0 : 1);
  } catch (err: any) {
    if (options.failOpen) {
      console.warn(`[jev-gate] WARN (fail-open): ${err?.message || err}`);
      process.exit(0);
    }
    if (options.json) {
      console.error(JSON.stringify({ error: err?.message || String(err), passed: false }, null, 2));
    } else {
      console.error(`[jev-gate] ERROR: ${err?.message || err}`);
    }
    process.exit(2);
  }
}

main();
