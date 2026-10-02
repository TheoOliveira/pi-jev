# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Per-prompt reasoning-level control via `--jev-thinking` / `PI_JEV_THINKING=1` / `/jev thinking [on|off]`. Prompt intent escalates (`high`/`xhigh`) for planning, debugging, security, and review tasks and de-escalates (`minimal`) for short mechanical prompts. The model is never changed, so the prompt-cache identity stays fixed.
- `/jev status` and `/jev` usage list the new thinking mode.
- `modelSwitchCostUsd`, `modelStayCostUsd`, `hasKnownCost`, and `evaluateModel` are exported, and `ModelRouteResult` reports `fit`, `switchCostUsd`, and `stayCostUsd` so the decision is inspectable.

### Changed
- **Auto-model scoring is now cost-aware.** The scorer previously had a single cost reference, `(model.cost?.input ?? 0) * -0.01`, which mixed arbitrary capability points with dollars and left cost at roughly 0.3% of the score; four of the six profiles had no cost term at all. Candidates are now ranked by capability fit, and cost only chooses between models within `FIT_TOLERANCE` of the best fit. Decision granularity is unchanged: still one decision per prompt, no new flags.
- **Cost can no longer downgrade a capability class.** An additive cost term against a bounded fit scale would let a long conversation's cache miss outweigh the entire capability range — a reasoning task could be routed to a non-reasoning model purely because the reasoning one was pricier. Keeping cost as a tie-breaker means price decides only between near-equivalent models.
- **Capabilities are scored only when the profile needs them.** Image and URL points were credited in every profile, so a multimodal model won text-only tasks while being the most expensive option — for `debug this failing test`, a $15/Mtok vision model beat an equivalent $3/Mtok text model. Hard input requirements are now filtered before scoring.
- **Cache misses are priced with the model's real rates** (`cost.input`, `cost.cacheRead`, `cost.cacheWrite`) and the live prefix size from `ctx.getContextUsage().tokens`: switch cost is `prefixTokens * (input + cacheWrite)`, stay cost is `prefixTokens * cacheRead`. Pricing tiers are applied, as pi's own cost calculation does — the bundled catalog tiers 24 models, doubling flagship rates above ~272k tokens. An omitted `cost` is treated as unknown rather than free (it is charged the current model's rates), while an explicit zero cost remains known and free.

### Fixed
- **Skill matching checks requested activity and product scope rather than related topics.** The skill router no longer recommends `setup-pstack` for an exhausted-model routing bug in the live regression corpus, while retaining genuine pstack configuration matches. The shared 0.65 cutoff is unchanged. Added an opt-in live replay and the investigation/evidence in `docs/skill-routing-investigation.md`.

### Notes
- Budget-based Anthropic thinking (models without `compat.forceAdaptiveThinking`) is skipped: Pi derives `budget_tokens` from `max_tokens`, which is itself derived from the level, and Anthropic keys the message cache on `budget_tokens`. That claim comes from Pi's own source comment and is not verified against Anthropic's public documentation.
- `FIT_TOLERANCE` is calibrated against the fit scale: wide enough for price to act, narrower than the reasoning (+30) and image (+40) gaps so cost can never overturn a real capability difference.
- When Jev is configured, a switch is additionally gated by one Noul judgment, thresholded by `requiredConfidence(switchCost)`. Jev supplies the probability and code owns the threshold (`P > cost/value`), so no dollar value is assigned to a correct answer.
- The model-switch question is **batched** with the tool/skill questions when `/jev auto` is also on, so a prompt still costs one Jev request rather than two. Auto-model alone also costs one; without Jev it stays fully local and only breaks ties on cost.

## [0.6.0] - 2026-09-24

### Added
- Auto-model routing (`--jev-model` / `PI_JEV_MODEL=1` / `/jev model [on|off]`) dynamically routes incoming prompts across available models based on task requirements:
  - Task signals (long context, speed, URL, high-context fallback)
  - Quota and provider limit error classification (`PROVIDER_LIMIT_PATTERNS`)
  - Automatic fallback on quota exhaustion with cooldown tracking
  - Conservative, opt-in by default
  - Integration with before_agent_start and turn error hooks
- Dynamic topology routing (`/jev topology`) classifies complex tasks into execution topologies:
  - Single-turn, multi-turn, orchestrator-worker, pipeline, or tree topologies
  - Fast local heuristic classification with optional Jev verification
  - Automatic subagent workflow script generation for delegated multi-step tasks
- Subagent RPC task interceptor (`executeJevAgentTask`):
  - Routes `agent: "jev"` calls in subagent configurations directly to Jev
  - Replaces dummy LLM reasoning passes with real calibration checks
- `/jev test <prompt>` now uses a two-phase pipeline:
  - Model design phase: queries the active LLM to generate targeted noul/choice questions with validation
  - Jev execution phase: runs the designed evaluation against the configured Jev endpoint
  - Falls back to fixed smoke test when no prompt is provided
- Token usage tracking:
  - JevClient captures input, output, and cache tokens from SDK responses (snake_case)
  - `/jev status` displays cumulative session token usage and estimated cost
  - Accurate accounting across all evaluation types

### Changed
- Refactored `AgentOrchestrator` to dispatch generated topology workflows via `pi-subagents` RPC
- Model routing tracks selection changes and avoids redundant switches
- Improved error feedback on unconfigured or unreachable Jev endpoints
- Hardened model-router against malformed models and uninitialized active sessions

### Fixed
- Base URL resolution prioritizes `PI_JEV_BASE_URL` over `TYPESAFE_BASE_URL`
- Custom endpoint configuration works correctly when API key is not required
- Jev API key resolution prioritizes environment variables over in-session keys
- URL prompt routing respects `promptHasUrl` regex when detecting URL targets in input text

## [0.5.0] - 2026-09-23
### Added
- Release pipeline with npm publish workflow
