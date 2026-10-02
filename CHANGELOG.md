# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Per-prompt reasoning-level control via `--jev-thinking` / `PI_JEV_THINKING=1` / `/jev thinking [on|off]`. Prompt intent escalates (`high`/`xhigh`) for planning, debugging, security, and review tasks and de-escalates (`minimal`) for short mechanical prompts. The model is never changed, so the prompt-cache identity stays fixed.
- `/jev status` and `/jev` usage list the new thinking mode.

### Fixed
- **Skill matching checks requested activity and product scope rather than related topics.** The skill router no longer recommends `setup-pstack` for an exhausted-model routing bug in the live regression corpus, while retaining genuine pstack configuration matches. The shared 0.65 cutoff is unchanged. Added an opt-in live replay and the investigation/evidence in `docs/skill-routing-investigation.md`.

### Notes
- Budget-based Anthropic thinking (models without `compat.forceAdaptiveThinking`) is skipped: Pi derives `budget_tokens` from `max_tokens`, which is itself derived from the level, and Anthropic keys the message cache on `budget_tokens`. That claim comes from Pi's own source comment and is not verified against Anthropic's public documentation.

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
