# pi-jev

Semantic tool routing and typed decisions for the [Pi coding agent](https://pi.dev) powered by [TypeSafe](https://typesafe.ai) Jev (System One).

## Features

- **Semantic Tool Router (`jev_find_tools`)**: Automatically searches registered inactive tools and additively activates only the tools needed for the user's specific prompt or workflow.
- **Skill Discovery (`jev_find_skill`)**: Semantically matches and suggests the most relevant specialized agent skills (`SKILL.md`) for any task without cluttering prompt context.
- **Typed Judgments (`jev_evaluate`)**: Run fast, calibrated System One decisions directly from the agent using Choice, Noul (yes/no probability), and Score primitives.
- **Dynamic Evaluations (`/jev test <prompt>`)**: The active model designs the Jev question schema for a free-form prompt, then Jev evaluates it.
- **Automatic Mode (opt-in)**: `--jev-auto` / `PI_JEV_AUTO=1` / `/jev auto on` routes tools and suggests skills before every prompt. Off by default.
- **Automatic Model Mode (opt-in)**: `--jev-auto-model` / `PI_JEV_AUTO_MODEL=1` / `/jev auto-model on` selects fast, balanced, reasoning, long-context, or vision models per prompt. Off by default.
- **Tool Call Guard (opt-in)**: `--jev-tool-guard` / `PI_JEV_TOOL_GUARD=1` / `/jev tool-guard on` intercepts tool calls with Jev to detect hallucinations and enhance failed results. Off by default.
- **Jev Compaction (opt-in)**: `--jev-compact` / `PI_JEV_COMPACT=1` / `/jev compact on` uses Jev to retain important tool history during `/compact`, while Pi's normal compaction remains the safe fallback.
- **Agent Orchestration & Typed Agent**: `/jev agents <task>` dispatches `pi-subagents` orchestration; register `agent: "jev"` in workflows for instant sub-second typed judgments without LLM overhead.
- **Post-Run Gate Check (`jev-gate` CLI)**: Fast binary for subagent `gate` parameters (`npx pi-jev-gate -c "criteria"`). Checks git diff / output and exits 0 on pass or 1 on fail.
- **On-Demand & Safe**: Runs when called. No unsolicited per-turn API token costs. Fails closed safely: if Jev is unreachable or unconfigured, tool routing does not blindly activate unjudged tools and reports zero confidence on keyword fallbacks.
- **Cost Clarity**: Tool routing (`jev_find_tools`, `/jev auto`), skill discovery (`jev_find_skill`), evaluations (`jev_evaluate`), Jev subagents (`agent: "jev"`), and gate checks (`pi-jev-gate`) consume a Jev System One request. Heuristic fast-paths like `/jev auto-model` and topology fallback classify locally without spending Jev requests.

## Installation

```bash
pi install npm:pi-jev
```

Or install directly from GitHub:

```bash
pi install git:github.com/TheoOliveira/pi-jev
```

## Setup

Set your TypeSafe API key via environment variable:

```bash
export TYPESAFE_API_KEY=ts_...
```

For Jev-compatible local servers or proxies, point `pi-jev` at a custom endpoint:

```bash
export PI_JEV_BASE_URL=http://localhost:8000
# TYPESAFE_BASE_URL also works, but PI_JEV_BASE_URL wins.
```

Custom endpoints may omit `TYPESAFE_API_KEY`; `pi-jev` sends an empty key in that case for unauthenticated local servers such as Laya's `laya-serve`.

Or store your TypeSafe key in Pi's secret store file:

```bash
mkdir -p ~/.pi/agent/secrets
echo "ts_..." > ~/.pi/agent/secrets/typesafe_api_key
```

Then check status inside Pi:

```text
/jev status
```

## Automatic Mode

Opt in to run one Jev routing pass before each agent turn (automatic mode costs one Jev request per prompt):

```bash
pi --jev-auto            # per-run CLI flag
export PI_JEV_AUTO=1     # persistent via environment
```

Toggle at runtime with `/jev auto on` or `/jev auto off` (no argument flips it). Automatic mode:

- activates inactive tools whose usefulness probability clears `JEV_THRESHOLD` (0.65);
- injects matching skill recommendations into the turn;
- skips slash commands, empty prompts, and prompts while Jev is unconfigured or already evaluating;
- never throws — a Jev failure leaves the turn untouched.

`JEV_THRESHOLD` (in `src/skills.ts`) is the one act/reject cutoff: raise it for precision, lower it for recall. Every path — router, tools, `/jev skills`, auto mode — reads that same constant.

### Jev Gate CLI (`pi-jev-gate` / `jev-gate`)

Use `pi-jev-gate` as a post-run gate check for subagents or CI/CD pipelines. Evaluates git diff, file, or stdin against natural language criteria using Jev System One probability.

- Exits `0` if evaluation probability meets threshold ($\ge 0.70$ by default).
- Exits `1` if rejected.
- Exits `2` on error (or `0` with `--fail-open`).

#### Subagent `gate` Example
Set a child subagent's `gate` parameter to run `pi-jev-gate` immediately upon completion:

```json
{
  "agent": "worker",
  "task": "Refactor auth middleware to use jose",
  "gate": "npx pi-jev-gate -c 'Middleware strictly refactored without breaking exports and no new any types' -d -p 0.8"
}
```

#### Pipeline / CLI Examples
```bash
# Check git diff against acceptance criteria
npx pi-jev-gate -c "All exported functions have TypeScript type annotations" --diff

# Check piped test/linter output
npm test 2>&1 | npx pi-jev-gate -c "Zero test failures and no unhandled promise rejections"

# JSON output with custom threshold
npx pi-jev-gate -c "Documentation updated" -f ./README.md -p 0.85 --json
```

### Typed Jev Subagent (`agent: "jev"`)

Register fast System One evaluations directly in `pi-subagents` workflows without spawning heavy LLM processes.

#### Workflow Example
```javascript
export const meta = { name: "triage_workflow", description: "Classify and route tasks" };

// 1. Instant typed classification with Jev
const triage = await agent("Classify incoming issue", {
  agent: "jev",
  type: "choice",
  criteria: {
    bug: "Bug or regression in existing behavior",
    feature: "New capability request",
    docs: "Documentation or comment update"
  },
  state: args.issueBody
});

// 2. Route dynamically based on System One verdict
if (triage.primaryValue === "bug") {
  await agent("Fix reported bug and add test", { agent: "worker", task: args.issueBody });
}
```

### Agent Orchestration

`/jev agents <task>` uses Jev System One to analyze task requirements and construct specialized multi-agent workflow scripts executed via `pi-subagents`:
- **Implementation tasks**: Staged `scout` (code context) $\rightarrow$ `worker` (changes) $\rightarrow$ `reviewer` (standards & tests).
- **Research tasks**: Parallel `scout` + `researcher` $\rightarrow$ `worker` synthesis.
- **Review / Security tasks**: Parallel `reviewer` + `evidence-auditor`.
- **General tasks**: `worker` $\rightarrow$ `reviewer`.

Execution is asynchronous; completion is reported back into the session. Automatic dispatch is opt-in via `--jev-agents` / `PI_JEV_AGENTS=1` or `/jev auto-agents on`.

### Jev Compaction

`/jev compact on` enables Jev-guided compaction. Tool-history entries are evaluated for retention; important paths, errors, constraints, and results stay in the custom summary. User and assistant intent is not rewritten. The feature preserves Pi's `firstKeptEntryId` boundary and falls back to Pi's built-in summary when Jev is unconfigured, fails, or returns unusable data. It does not silently truncate context.

### Automatic Model Mode

Auto-model uses task signals, attached images, and context size to choose the best available model. It respects `ctx.scopedModels`, skips low-confidence general prompts, and preserves the current model when no compatible option exists. Models that hit quota, rate-limit, timeout, or context-limit errors are temporarily avoided on later prompts; fallback is bounded and never loops. Provider failures do not silently truncate user context.

## Commands

- `/jev status` — Shows Jev configuration (and where the API key came from), auto-mode state, session request count, total tokens, and available tool counts.
- `/jev help` — Lists available subcommands.
- `/jev skills [query]` — Discover and rank matching skills in the workspace using Jev.
- `/jev test [prompt]` — With no prompt, runs the fixed connectivity smoke test. With a prompt, the active model designs the Jev questions for that prompt and Jev evaluates them. Also accepts `/jev eval` and `/jev evaluate`.
- `/jev enable` — Enables Jev tools in the active session.
- `/jev disable` — Disables Jev tools for the active session.
- `/jev auto [on|off]` — Turns automatic per-prompt tool/skill routing on or off (no argument flips it).
- `/jev auto-model [on|off]` — Turns automatic model selection on or off (no argument flips it).
- `/jev tool-guard [on|off]` — Turns tool call anti-hallucination validation and error guidance on or off.
- `/jev compact [on|off]` — Turns Jev-guided compaction on or off. Run `/compact` after enabling.
- `/jev agents <task>` — Dispatches the task to `pi-subagents`, which selects and coordinates available agents.
- `/jev auto-agents [on|off]` — Enables automatic orchestration for complex architecture, refactoring, security, repository-wide, and migration prompts.

## Tools Provided

### 1. `jev_find_tools`
Used by the model to find capabilities that aren't currently loaded into the prompt prefix.

```json
{
  "query": "inspect SQLite database schemas and run queries"
}
```

### 2. `jev_find_skill`
Used by the agent to find relevant specialized workflows and instructions for complex tasks.

```json
{
  "query": "build accessible modal component in React"
}
```

### 3. `jev_evaluate`
Used for structured decisions, classifications, triage, and scoring.

```json
{
  "state": { "diff": "..." },
  "questions": {
    "is_breaking": {
      "type": "noul",
      "instructions": "Does this change introduce any breaking API changes?"
    }
  }
}
```

## Development & Testing

```bash
npm install
npm run typecheck
npm test
```

## License

MIT © Theophilo Damiao
