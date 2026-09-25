// Explicit opt-in: sends only the public fixture prompts/descriptions to Jev.
// node --import tsx scripts/replay-skill-routing.ts --live --repeats 3 --output /tmp/skill-routing.json
// Add --legacy to compare the previous applicability question with identical inputs.
import * as fs from "node:fs";
import { SkillRouter, JEV_THRESHOLD } from "../src/skills.js";
import { JevClient } from "../src/jev.js";
import type { JevEvaluationRequest, JevEvaluationResponse, QuestionConfig } from "../src/types.js";
import { cases, skills } from "../test/fixtures/skill-routing.js";

if (!process.argv.includes("--live")) {
  console.error("Pass --live to send the fixture cases to the configured TypeSafe API. Optional: --legacy --repeats N --output FILE");
  process.exit(2);
}
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const repeats = Number(option("--repeats") ?? 1);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("--repeats must be between 1 and 10");
const legacy = process.argv.includes("--legacy");
const jev = new JevClient();
if (!jev.isConfigured()) throw new Error("Jev is not configured");
const responses: JevEvaluationResponse[] = [];
const router = new SkillRouter({
  getCommands: () => skills.map((s) => ({
    name: `skill:${s.name}`, description: s.description, source: "skill",
    sourceInfo: { path: `/fixtures/${s.name}/SKILL.md`, source: "fixture", scope: "user", origin: "top-level" },
  })),
}, {
  isConfigured: () => true,
  evaluate: async (request, signal) => {
    let input: JevEvaluationRequest = request;
    if (legacy) {
      const questions: Record<string, QuestionConfig> = {};
      // Keep current discovery, candidate order, state, normalization, and cutoff.
      // Only restore the old question text, so this isolates the prompt change.
      for (const name of Object.keys(request.questions)) {
        const skill = skills.find((s) => s.name === name.replace(/^skill:/, ""));
        if (!skill) throw new Error(`Unknown fixture skill ${name}`);
        questions[name] = {
          type: "noul",
          instructions: `Does the skill '${name}' (${skill.description}) provide direct guidance or specialized domain steps for this task: "${typeof request.state === "object" ? request.state.task : request.state}"?`,
        };
      }
      input = { ...request, questions };
    }
    const response = await jev.evaluate(input, signal);
    responses.push(response);
    return response;
  },
});
const results = [];
for (let run = 1; run <= repeats; run++) {
  for (const fixture of cases) {
    responses.length = 0;
    const result = await router.findSkills(fixture.query, JEV_THRESHOLD, undefined, AbortSignal.timeout(30_000));
    const response = responses.at(-1);
    const recommended = result.recommended.map((s) => s.name.replace(/^skill:/, ""));
    const errors = [
      ...fixture.include.filter((name) => !recommended.includes(name)).map((name) => `missing ${name}`),
      ...fixture.exclude.filter((name) => recommended.includes(name)).map((name) => `unexpected ${name}`),
      ...(result.fallbackUsed ? ["evaluation failed; heuristic fallback is not semantic evidence"] : []),
    ];
    const row = {
      run, id: fixture.id, query: fixture.query, model: response?.model,
      candidates: result.candidates,
      probabilities: Object.fromEntries(Object.entries(response?.answers ?? {}).map(([name, answer]) => [name.replace(/^skill:/, ""), answer.value])),
      recommended, errors,
    };
    results.push(row);
    console.log(JSON.stringify({ run, id: row.id, pstack: row.probabilities["setup-pstack"], recommended, errors }));
  }
}
const failures = results.filter((row) => row.errors.length > 0).length;
const report = { recordedAt: new Date().toISOString(), mode: legacy ? "legacy" : "scope-aware", threshold: JEV_THRESHOLD, repeats, total: results.length, failures, results };
const output = option("--output");
if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(`${results.length - failures}/${results.length} cases passed (${report.mode})`);
if (failures) process.exitCode = 1;
