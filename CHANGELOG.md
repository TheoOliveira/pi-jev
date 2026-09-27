# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Auto-model scoring is now cost-aware.** The scorer previously had a single cost reference, `(model.cost?.input ?? 0) * -0.01`, which mixed arbitrary capability points with dollars and left cost at roughly 0.3% of the score; four of the six profiles had no cost term at all. Candidates are now ranked by capability fit, and cost only chooses between models within `FIT_TOLERANCE` of the best fit. Decision granularity is unchanged: still one decision per prompt, no new flags.
- **Cost can no longer downgrade a capability class.** An additive cost term against a bounded fit scale would let a long conversation's cache miss outweigh the entire capability range — a reasoning task could be routed to a non-reasoning model purely because the reasoning one was pricier. Keeping cost as a tie-breaker means price decides only between near-equivalent models.
- **Capabilities are scored only when the profile needs them.** Image and URL points were credited in every profile, so a multimodal model won text-only tasks while being the most expensive option — for `debug this failing test`, a $15/Mtok vision model beat an equivalent $3/Mtok text model. Hard input requirements are now filtered before scoring.
- **Cache misses are priced with the model's real rates** (`cost.input`, `cost.cacheRead`, `cost.cacheWrite`) and the live prefix size from `ctx.getContextUsage().tokens`: switch cost is `prefixTokens * (input + cacheWrite)`, stay cost is `prefixTokens * cacheRead`. Pricing tiers are applied, as pi's own cost calculation does — the bundled catalog tiers 24 models, doubling flagship rates above ~272k tokens. An omitted `cost` is treated as unknown rather than free (it is charged the current model's rates), while an explicit zero cost remains known and free.

### Added
- `modelSwitchCostUsd`, `modelStayCostUsd`, `hasKnownCost`, and `evaluateModel` are exported, and `ModelRouteResult` reports `fit`, `switchCostUsd`, and `stayCostUsd` so the decision is inspectable.

### Notes
- `FIT_TOLERANCE` is calibrated against the fit scale: wide enough for price to act, narrower than the reasoning (+30) and image (+40) gaps so cost can never overturn a real capability difference.
- When Jev is configured, a switch is additionally gated by one Noul judgment, thresholded by `requiredConfidence(switchCost)`. Jev supplies the probability and code owns the threshold (`P > cost/value`), so no dollar value is assigned to a correct answer.
- The model-switch question is **batched** with the tool/skill questions when `/jev auto` is also on, so a prompt still costs one Jev request rather than two. Auto-model alone also costs one; without Jev it stays fully local and only breaks ties on cost.

## [0.6.0] - 2026-09-24

### Added
- Custom Jev-compatible endpoint support via `PI_JEV_BASE_URL` or `TYPESAFE_BASE_URL`, including unauthenticated local servers such as Laya `laya-serve`.
- `/jev status` now shows the active Jev endpoint.
- OpenCode Zen URL-aware model routing.

### Fixed
- `pi-jev-gate` runtime loading now works from package installs without dev dependencies in the caller cwd.
- `/jev status` reports the real API key origin and counts SDK `input_tokens`/`output_tokens` usage.
- `--jev-auto-model` and `--jev-agents` take effect independently of `/jev auto`.
- `/jev auto` now sends one Jev request per prompt as documented.


## [0.5.0] - 2026-09-20

### Added
- **Tool Guard**: Opt-in tool call validation and anti-hallucination interceptor (`--jev-tool-guard`, `PI_JEV_TOOL_GUARD=1`, `/jev tool-guard [on|off]`). Evaluates tool parameters with Jev System One to block hallucinated paths/flags and enhances error output with targeted recovery hints.

### Fixed
- **Safe Fallback**: When Jev is unreachable or unconfigured, tool router no longer auto-activates tools blindly and reports 0 probability rather than false certainty (1.0). Skill router only surfaces keyword matches with 0 probability (closes #1: "A failed request activates three tools and reports them at probability 1.0").
- Removed outdated reference to nonexistent `/jev login` in `jev_evaluate` error message.
- Documentation clarifies that heuristic routing (`/jev auto-model`, topology fallback) executes locally without spending Jev requests.

## [0.4.0] - 2026-09-18

### Added
- Jev Gate CLI binary (`bin/jev-gate.js`, exposed as `pi-jev-gate` and `jev-gate`) for subagent post-run `gate` checks and CI/CD validation. Evaluates git diff, stdin, or files against acceptance criteria with fast System One noul probability.
- Typed Jev Subagent (`agent: "jev"` / `agentType: "jev"`) handler in `pi-subagents` RPC for sub-second, zero-LLM-overhead choice, score, and probability decisions inside workflows.

### Fixed
- `/jev agents <task>` now directly constructs multi-agent `workflowScript` topologies delegating to builtin agents (`scout`, `worker`, `reviewer`, `researcher`, `evidence-auditor`), replacing single `delegate` subagent calls.

## [0.3.0] - 2026-09-17

### Added
- Opt-in automatic model routing via `--jev-auto-model`, `PI_JEV_AUTO_MODEL=1`, and `/jev auto-model [on|off]`.
- Model profiles for fast, balanced, reasoning, long-context, and vision tasks. Selection respects scoped models and attached images.
- Provider-limit handling: quota, rate-limit, timeout, unavailable, auth, and context-limit errors are classified; retry-prone models are temporarily avoided on later prompts without loops or silent truncation.
- Opt-in Jev-guided `/compact` via `--jev-compact`, `PI_JEV_COMPACT=1`, or `/jev compact on`. Important tool history is retained in a custom compaction summary, with Pi's built-in summary as fail-open fallback.
- Explicit agent orchestration via `/jev agents <task>` and opt-in automatic orchestration via `--jev-agents`, `PI_JEV_AGENTS=1`, or `/jev auto-agents on`, using the installed `pi-subagents` RPC.

## [0.2.1] - 2026-09-17

### Documentation
- Add secret store key resolution option (`~/.pi/agent/secrets/typesafe_api_key`) to Setup section in README.

## [0.2.0] - 2026-09-17

### Added
- Dynamic evaluation command: `/jev test <prompt>` (aliases `/jev eval`, `/jev evaluate`) asks the session's active model to design the Jev question schema from the user's prompt, then runs it on TypeSafe Jev. `/jev test` alone still runs the fixed smoke test.
- Automatic mode: `--jev-auto` flag / `PI_JEV_AUTO=1` env var and `/jev auto [on|off]` command run one Jev routing pass before each prompt, activating tools and surfacing matching skills.

### Changed
- Single activation threshold `JEV_THRESHOLD` (0.65) in `src/skills.ts`, used by the router, both tools, `/jev skills`, and auto mode. `/jev skills` previously used 0.6, so manual skill search could show matches auto mode hid.

### Fixed
- Router no longer offers `pi-jev`'s own tools as routing candidates. After `/jev disable`, automatic routing used to re-activate `jev_find_skill` and `jev_evaluate`.
- `/jev` subcommands now match exactly, so `/jev autofoo on` and `/jev skillsfoo` report an error instead of silently toggling or searching.
- `/jev skills` discloses local heuristic fallback instead of presenting 1.00 probabilities as Jev judgments.
- `/jev status` reports where the API key came from (`$TYPESAFE_API_KEY` vs `~/.pi/agent/secrets/typesafe_api_key`) and counts only genuinely routable tools.
- `/jev help` lists usage at info level instead of warn-as-unknown-command.
- Router and skill fallback tests no longer depend on the machine being unconfigured.
- `npm run smoke` passes `-ne` so it no longer collides with an already-installed `pi-jev` copy.

## [0.1.1] - 2026-09-17

### Added
- `jev_find_skill` tool and `/jev skills [query]` command for semantic skill discovery and recommendation.

## [0.1.0] - 2026-09-17

### Added
- Initial public release of `pi-jev` package for the Pi coding agent.
- `jev_find_tools` tool for semantic candidate shortlisting and additive tool activation.
- `jev_evaluate` tool exposing typed TypeSafe Jev decisions (Choice, Noul, Score).
- `/jev` slash commands (`status`, `enable`, `disable`, `test`).
- Bounded TypeSafe client integration with safe error handling and usage accounting.
- Comprehensive unit test suite and CI workflows.
