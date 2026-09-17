# Pi + Jev Extension Plan

**Status:** discovery; implementation blocked on product choices below  
**Audience:** maintainer building and publishing a public Pi package  
**Post-read action:** answer questionnaire, then implement selected v1 without reopening settled product decisions

## Fast answer format

Reply with option letters:

```text
Q01: A
Q02: A
Q03: A, B
...
```

Use `defaults` to accept every **Recommended** option, then list overrides only.

---

## 1. Decision questionnaire

### Product

#### Q01 — What is v1's main job? Pick one.

- **A — Semantic tool router (Recommended):** Jev selects relevant inactive Pi tools, then extension enables them with Pi's dynamic tool loading.
- **B — Typed judgment toolkit:** expose Choice, Noul, and Score evaluations to Pi's agent and other extensions.
- **C — Safety gate:** judge risky `bash`, `write`, and `edit` calls before execution.
- **D — Agent coach:** detect drift, stuck loops, weak verification, or premature completion.
- **E — Suite:** ship all above in first release.

Why A: existing public packages already cover generic evaluation and safety gates. Tool routing gives project clearer differentiation and improves Pi prompt/tool efficiency.

#### Q02 — Who is primary v1 user? Pick one.

- **A — Pi power users (Recommended):** install package and use it without writing code.
- **B — Pi extension authors:** consume exported Jev client/helpers.
- **C — Teams:** centrally managed policy and config matter most.
- **D — Mixed audience:** equal emphasis on end-user UX and public library API.

#### Q03 — Which core features belong in v1? Pick up to three.

- **A — `jev_find_tools` semantic router (Recommended)**
- **B — `jev_evaluate` batched typed-decision tool (Recommended)**
- **C — `/jev status|enable|disable|test` command (Recommended)**
- **D — pre-execution mutation gate**
- **E — post-execution output classifier**
- **F — stuck-loop and goal-drift detector**
- **G — skill/prompt suggestion**
- **H — custom Jev playground UI**

#### Q04 — How should Jev run? Pick one.

- **A — On demand only (Recommended):** agent or user explicitly invokes Jev. No per-turn API cost.
- **B — Automatic on every user prompt:** router/coach runs before each agent turn.
- **C — Hybrid:** on-demand router plus selected automatic safety checks.

#### Q05 — Should package expose library API for other extensions?

- **A — No in v1 (Recommended):** extension package only; fewer compatibility promises.
- **B — Yes:** export client, schemas, question builders, credential resolver, and result types.
- **C — Depend on `pi-typesafe` as shared API:** reuse its credential/client layer instead of owning one.

### Router behavior

#### Q06 — How should semantic tool routing choose tools?

- **A — Local shortlist + batched Jev Noul judgments (Recommended):** cheap lexical shortlist, then independent “useful for task?” probabilities; enables zero or more tools.
- **B — Single Jev Choice:** select one tool from candidate set; simpler but weak for multi-tool tasks.
- **C — Jev-only all-tool scan:** highest semantic coverage, highest token cost, limited by question count.
- **D — Local routing only:** no Jev call; conflicts with project premise but provides baseline.

#### Q07 — What should happen when Jev is unavailable?

- **A — Return local shortlist and warning (Recommended):** useful fail-open behavior for routing.
- **B — Return no tools and explicit error:** no semantic decision means no activation.
- **C — Ask user to choose from shortlist:** best interactive control; unusable in headless modes.

#### Q08 — Should newly selected tools remain active?

- **A — Yes, for session (Recommended):** additive activation preserves Pi's deferred-tool loading and prompt-cache behavior.
- **B — Until task settles:** deactivate after `agent_settled`; more state and cache churn.
- **C — User chooses each time:** prompt before activation in TUI.

#### Q23 — Which existing tools may router manage?

- **A — Non-built-in extension tools after explicit preview/consent (Recommended):** useful zero-config routing without touching Pi's core tools.
- **B — Explicit tool-name allowlist only:** safest, but requires setup before router helps.
- **C — Tools from selected package sources:** manage trusted groups using `sourceInfo` provenance.
- **D — All tools, including built-ins:** maximum prompt reduction; highest breakage risk.

“Manage” means router may remove selected tools from initial active set, then reactivate matches additively. `/jev disable` must restore tools that were active before router took control.

### Credentials, privacy, and policy

#### Q09 — API-key setup? Pick one.

- **A — `TYPESAFE_API_KEY` only in v1 (Recommended):** no secret-storage code.
- **B — Environment plus `/jev login`:** hidden input, key verification, owner-only global file.
- **C — Reuse `pi-typesafe` credential store:** adds package dependency and coupling.

#### Q10 — Consent model for remote calls? Pick one.

- **A — Explicit session enable (Recommended):** `/jev enable` shows what leaves machine; headless mode requires `PI_JEV_ENABLED=1`.
- **B — Enabled when key exists:** lower friction, weaker consent signal.
- **C — Enabled by default with first-call notice:** fastest start, easiest accidental disclosure.

#### Q11 — What data may router send? Pick one.

- **A — Query plus tool names/descriptions only (Recommended)**
- **B — Also current user prompt and cwd**
- **C — Also recent conversation context**
- **D — User-configurable fields**

#### Q12 — Automatic safety failure policy, if Q03 D/E/F is selected? Pick one.

- **A — Feature-specific (Recommended):** router/coach fail open; destructive gate confirms in UI and blocks headless when undecidable.
- **B — Always fail open:** productivity first.
- **C — Always fail closed:** safety first.
- **D — Shadow mode only in v1:** report decisions, never alter execution.

#### Q13 — Configuration scope? Pick one.

- **A — Environment + global config; trusted project overrides (Recommended)**
- **B — Environment only:** smallest implementation.
- **C — Global config only:** consistent interactive UX, less CI-friendly.
- **D — Global and project config without trust check:** not recommended.

### Package identity and compatibility

#### Q14 — npm package name? Pick one or provide another.

- **A — `pi-jev-router` (Recommended if router-first):** differentiated and descriptive.
- **B — `pi-jev`:** currently available unscoped, but close to existing `@y0usaf/pi-jev`.
- **C — `@theophilo/pi-jev`:** currently available; requires npm scope ownership.
- **D — `pi-jev-toolkit`:** broad name if toolkit-first.
- **E — Other:** provide exact name.

Current collision note: `jev` is taken; `@y0usaf/pi-jev`, `pi-typesafe`, `pi-typesafe-jev`, and `pi-jev-auto-mode` already exist.

#### Q15 — GitHub home? Pick one.

- **A — `TheoOliveira/<npm-name>` public repository (Recommended)**
- **B — GitHub organization repository:** provide organization.
- **C — Different owner/name:** provide exact `owner/repo`.

Current state: local repository has no commits; `TheoOliveira/pi-jev` does not exist yet.

#### Q16 — License and project posture? Pick one.

- **A — MIT, independent/unaffiliated disclaimer, public contributions (Recommended)**
- **B — Apache-2.0, independent/unaffiliated disclaimer, public contributions**
- **C — Source available but not open contribution**
- **D — Other:** provide license/posture.

#### Q17 — Runtime support? Pick one.

- **A — Node.js 20+ and current Pi (Recommended):** matches TypeSafe JS SDK minimum.
- **B — Node.js 22+ and current Pi:** easier native TypeScript test tooling, smaller support matrix.
- **C — Current and previous Pi minor:** more compatibility testing.

#### Q18 — Release policy? Pick one.

- **A — Start `0.1.0`; manual GitHub release/tag triggers npm trusted publishing (Recommended)**
- **B — Start `0.1.0-beta.1`; prereleases until live validation is complete**
- **C — Start `1.0.0`; stable API commitment immediately**
- **D — Automated release PR/versioning tool:** adds process and dependencies.

#### Q19 — Visual launch assets?

- **A — README terminal screenshot only (Recommended)**
- **B — Screenshot plus short MP4/GIF for Pi package gallery**
- **C — No media in v1**

### Operations

#### Q20 — Usage limits? Pick one.

- **A — Conservative defaults (Recommended):** max 24 candidates, 64 KiB request, 5 s timeout, no automatic retries, session request cap.
- **B — Minimal limits:** only SDK/API limits.
- **C — User-defined budgets required before enabling.**

#### Q21 — Telemetry?

- **A — None (Recommended):** only requested TypeSafe API calls; local usage counters.
- **B — Opt-in anonymous feature counts**
- **C — Error reporting service:** requires separate privacy and credential design.

#### Q22 — Maintenance target? Pick one.

- **A — Small stable extension (Recommended):** monthly dependency review, issue-driven releases.
- **B — Active product:** roadmap, frequent releases, compatibility matrix.
- **C — Experimental lab:** rapid breaking changes allowed under `0.x`.

---

## 2. Recommended v1

Defaults produce this product:

> Public Pi package that uses Jev to semantically shortlist and activate relevant tools on demand. It also exposes one bounded typed-evaluation tool. No automatic interception, no safety claims, no background work, no telemetry, and no stored credentials.

### User flow

1. Install package from npm or GitHub.
2. Export `TYPESAFE_API_KEY`.
3. Run `/jev enable`, read remote-data notice, and confirm.
4. Agent calls `jev_find_tools` when active tools cannot cover task.
5. Extension creates local candidate shortlist from inactive tool metadata.
6. One Jev request judges candidate usefulness independently.
7. Extension activates selected tools additively with `pi.setActiveTools()`.
8. Pi exposes selected definitions on next model request.
9. If Jev fails, extension returns deterministic shortlist plus warning.
10. Agent may call `jev_evaluate` for explicit typed judgments.

### Deliberately excluded from recommended v1

- Mutation permission gate
- Secret detection
- Automatic per-turn judgments
- Stuck-loop detection
- Custom full-screen UI
- Public library API
- Persistent API-key storage
- Telemetry

Add these only after measured demand. Existing packages already cover several.

---

## 3. Implementation plan

Selections from section 1 may add, remove, or reorder work below.

### Milestone 0 — Lock positioning and identity

- Record answers from Q01–Q23 in this document.
- Choose exact npm name and GitHub `owner/repo`.
- Confirm package name, GitHub name, and command/tool names do not create avoidable confusion with existing projects.
- Write one-sentence value proposition and non-goals.
- Choose license and TypeSafe/Pi unaffiliated disclaimer.

**Exit:** package identity, v1 feature list, data policy, and release posture are unambiguous.

### Milestone 1 — Bootstrap public Pi package

Create minimum package structure:

```text
.github/workflows/ci.yml
.github/workflows/publish.yml
.gitignore
extensions/index.ts
src/jev.ts
src/router.ts
test/
CHANGELOG.md
LICENSE
README.md
SECURITY.md
package.json
package-lock.json
tsconfig.json
```

Package metadata:

- npm name, version, description, repository, bugs, homepage, license, author
- `keywords`: `pi-package`, `pi-extension`, `pi-coding-agent`, `typesafe`, `jev`, `system-one`
- `pi.extensions: ["./extensions/index.ts"]`
- `files` allowlist so tests, local secrets, and scratch files cannot publish
- `engines.node` from Q17
- `@typesafe-ai/sdk` in `dependencies`
- Pi core packages and `typebox` in `peerDependencies` with `*` where imported, per Pi package rules
- no install/postinstall scripts

Keep TypeScript source directly loadable by Pi. Add build output only if Q05 requires public library exports.

**Exit:** `pi -e .` loads cleanly with no key, no network call, and no background resource.

### Milestone 2 — Build bounded Jev client

- Create client lazily on first requested evaluation, never in extension factory.
- Resolve selected credential source without logging key.
- Pass Pi tool/event abort signal to SDK request.
- Enforce state size, question count, timeout, and session request cap before network I/O.
- Use one request for independent questions over same state.
- Normalize errors into safe categories: disabled, missing key, validation, timeout, rate limit, upstream, aborted.
- Never include upstream body, authorization header, submitted state, or secret in displayed errors.
- Track local request count, input size, latency, model, and TypeSafe usage for `/jev status`; no remote telemetry.

**Exit:** fake-transport tests cover success, abort, timeout, malformed response, limits, and secret-safe errors.

### Milestone 3 — Implement semantic tool router

- Discover tool metadata after extension factories finish, using `pi.getAllTools()` and canonical `sourceInfo` provenance.
- Define managed set from Q23; never manage built-ins by default.
- On explicit enable, preview managed tools, snapshot which were active, then deactivate only managed candidates while keeping `jev_find_tools` active.
- Build local candidate set from inactive managed tools using names and descriptions.
- Exclude router itself, already-active tools, and user-configured exclusions.
- Apply deterministic token/keyword scoring and cap shortlist before Jev.
- Ask one narrow Noul question per candidate: whether tool is useful for supplied task.
- Select candidates by configurable probability threshold; keep no-match valid.
- Activate matches additively with `pi.setActiveTools([...active, ...matches])`.
- On `/jev disable`, restore managed tools that were active before router enablement; leave unrelated tool state untouched.
- Cache verdict by normalized query plus tool-catalog fingerprint for session.
- Return compact result with selected tools, probabilities, latency, and fallback status.
- Provide compact call/result rendering; expanded view shows candidate scores.
- Omit `promptSnippet`/`promptGuidelines` from lazily loaded tools to preserve prompt-prefix caching where possible.

**Exit:** selected tools are callable on next model request; unrelated tools stay inactive; Jev outage still yields useful local candidates.

### Milestone 4 — Add explicit typed evaluation tool if selected

Register `jev_evaluate` with strict TypeBox schema:

- JSON-compatible `state`
- 1–32 named questions
- question type: `choice`, `noul`, or `score`
- Choice requires bounded named criteria and a no-match option when appropriate
- Score requires ordered, self-contained situation descriptions
- Noul returns yes probability; do not invent separate confidence
- output includes typed answers, distributions/confidence where supplied, model, usage, and latency

Tool description must teach:

- one coherent judgment per question
- batch independent questions over same state
- code owns thresholds and actions
- confidence is distribution concentration, not truth or permission

**Exit:** each primitive has schema, rendering, and mocked integration coverage.

### Milestone 5 — Add command and mode UX

Recommended command surface:

```text
/jev status
/jev enable
/jev disable
/jev test
```

Optional by answers:

```text
/jev login
/jev logout
/jev playground
/jev last
```

Behavior:

- `/jev enable` shows concise data notice before first remote use.
- Print/JSON modes never prompt; explicit environment enablement controls access.
- RPC uses supported dialog protocol only.
- Status shows enabled state, key source—not key value—request count, model, and last safe error.
- Session reload resets ephemeral enablement and usage unless config says otherwise.
- Footer status stays compact and appears only when useful.

**Exit:** TUI, RPC, JSON, and print modes have defined non-crashing behavior.

### Milestone 6 — Security and privacy pass

- Honor project config only when `ctx.isProjectTrusted()` is true.
- Document exact fields sent for every feature.
- Default router payload to query plus tool names/descriptions only.
- Never read project files implicitly for Jev state.
- Never start network work during extension loading.
- Redact registered key from all errors and rendered details.
- Reject oversized payloads before serialization/network.
- Use least-privilege GitHub Actions permissions.
- Add `SECURITY.md` with private vulnerability-reporting route.
- Add threat-model tests for malicious tool descriptions, prompt injection in metadata, secret-like input, project config attempts, and headless failure policy.

**Exit:** README data notice matches code; no hidden remote transmission path exists.

### Milestone 7 — Verification and compatibility

Use smallest test stack that works: Node test runner plus TypeScript compiler; add no test framework unless needed.

Checks:

```text
npm run typecheck
npm test
npm pack --dry-run
pi -e . -p --no-session "report loaded Jev tools"
```

Test layers:

- unit: validation, shortlist, thresholds, cache, limits, error redaction
- extension integration: tool registration, active-tool preservation, additive activation, mode behavior
- transport integration: injected fake fetch; no network
- opt-in live smoke: one cheap Jev request, never required for forks/PRs
- package smoke: install generated tarball into clean temporary Pi home
- Node matrix from Q17

**Exit:** clean checkout passes CI; packed tarball contains only intended runtime/docs files; npm and git install paths both work.

### Milestone 8 — Public documentation

README sections:

1. One-line value and terminal preview
2. Differentiation from existing Jev/Pi packages
3. Install from npm and GitHub
4. TypeSafe key setup
5. Consent and what leaves machine
6. Commands and tools
7. Examples for router and typed evaluation
8. Limits, costs, confidence semantics, and failure behavior
9. Configuration reference
10. Development and test commands
11. Compatibility policy
12. Independent/unaffiliated disclaimer and license

Also add:

- `CHANGELOG.md`
- `SECURITY.md`
- concise contribution section in README; separate `CONTRIBUTING.md` only when contribution volume warrants it
- screenshot or MP4 selected in Q19
- package-gallery `pi.image` or `pi.video` metadata if media exists

**Exit:** fresh Pi user can install, configure, understand remote data, run one feature, and uninstall without maintainer help.

### Milestone 9 — GitHub and npm publication

GitHub:

- Create public repository under selected owner.
- Push initial reviewed commit.
- Set description, topics, homepage, issue templates only if needed.
- Enable branch protection after CI exists.
- Enable Dependabot security alerts; avoid auto-merge initially.

npm:

1. Log into npm manually; current machine is not authenticated.
2. Verify exact package name again immediately before first publish.
3. Publish initial package manually if npm requires package to exist before trusted-publisher setup.
4. Configure npm trusted publisher with exact GitHub owner, repository, and workflow filename.
5. Use GitHub-hosted runner, Node 22.14+, npm 11.5.1+, and `id-token: write` for publish job.
6. Remove long-lived npm token after OIDC trusted publishing works.
7. Publish public package with provenance.
8. Install from npm in clean Pi home and run smoke test.
9. Create matching GitHub release and tag.

Release gate:

- version and changelog agree
- clean CI
- tarball inspected
- no secrets
- repository public for provenance
- npm package links resolve to correct repo
- install commands tested exactly as documented

**Exit:** package installs through both `pi install npm:<name>` and `pi install git:github.com/<owner>/<repo>@<tag>`.

### Milestone 10 — Post-launch validation

- Watch install failures, TypeSafe API errors, Pi compatibility issues, and false router selections.
- Collect local/manual fixture set—no telemetry—from real tool catalogs.
- Measure shortlist recall, selected-tool precision, latency, request cost, and fallback usefulness.
- Adjust questions/thresholds from fixtures, not intuition.
- Promote from beta or `0.x` only after compatibility and payload behavior stabilize.
- Consider excluded features only when issues show demand.

**Exit:** first maintenance release uses observed failures, not speculative roadmap work.

---

## 4. Acceptance criteria

- Package loads in Pi with no key and performs zero network requests.
- Remote calls require selected consent/enable policy.
- Router never disables built-ins or tools outside selected managed set.
- `/jev disable` restores managed tools that were active before router enablement.
- Tool activation is additive and visible on next model turn.
- Jev outage has documented, tested fallback.
- Request limits, cancellation, and safe errors work.
- Secrets never appear in logs, tool output, session details, or CI.
- Project config cannot weaken behavior unless project is trusted.
- TUI, RPC, JSON, and print modes do not hang on unavailable UI.
- npm tarball contains only intended files.
- CI validates supported Node/Pi matrix.
- README states exact remote payloads and costs.
- GitHub release, npm version, changelog, and tag match.
- npm provenance is visible after trusted publish.

---

## 5. Risks and controls

| Risk | Control |
|---|---|
| Package duplicates existing Jev integrations | Router-first positioning; explicit comparison; narrow v1 |
| Tool descriptions contain prompt injection | Treat metadata as untrusted state; narrow question; never execute text |
| Too many tools exceed Jev/request budget | Deterministic shortlist and hard candidate cap |
| Jev picks plausible but wrong tools | Probabilities visible; additive activation; local fallback; fixture calibration |
| API outage blocks Pi | On-demand design and fail-open router fallback |
| Source or secrets leave machine unexpectedly | Minimal payload, explicit enable, exact README disclosure, redaction tests |
| Extension breaks prompt caching | Add tools only; avoid prompt metadata on lazy tools |
| Credential storage creates security burden | Environment-only recommended v1 |
| Public API freezes internals too early | No library export in v1 |
| Supply-chain compromise | lockfile, minimal dependencies, OIDC trusted publishing, provenance, no install scripts |
| Pi API changes | peer dependency declaration, CI smoke against supported Pi versions |

---

## 6. Existing ecosystem snapshot

| Project | Current focus | Implication |
|---|---|---|
| `pi-typesafe` | batched evaluator, playground, reusable API, stored key | Do not clone generic toolkit unless interoperability is goal |
| `@y0usaf/pi-jev` | mutation gate, output judge, `jev_ask` | Safety + generic ask already covered |
| `pi-jev-auto-mode` | fail-closed semantic permission gate | High-assurance auto-mode space already occupied |
| `pi-typesafe-jev` | typed Jev tools and persistent key | Another generic-tool competitor |

Recommended gap: semantic discovery and additive activation of Pi tools, later skills/prompts if Pi APIs support reliable activation.

---

## 7. Source references

- Pi extension docs: local installed `@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi package docs: local installed `@earendil-works/pi-coding-agent/docs/packages.md`
- TypeSafe docs index: <https://docs.typesafe.ai/llms.txt>
- TypeSafe JavaScript SDK: <https://docs.typesafe.ai/sdk/javascript>
- TypeSafe primitives: <https://docs.typesafe.ai/primitives>
- TypeSafe confidence: <https://docs.typesafe.ai/confidence>
- npm trusted publishing: <https://docs.npmjs.com/trusted-publishers/>
- npm provenance: <https://docs.npmjs.com/generating-provenance-statements/>
- Existing projects: <https://github.com/y0usaf/pi-jev>, <https://github.com/DevMortimer/pi-typesafe>, <https://github.com/jomatsu/pi-jev-auto-mode>

---

## 8. Answer record

Fill after selection:

```text
Q01: E — Suite
Q02: A — Pi power users
Q03: A, B, C — semantic router, typed evaluation, `/jev` commands
Q04: A — On demand only
Q05:
Q06:
Q07:
Q08:
Q09:
Q10:
Q11:
Q12:
Q13:
Q14:
Q15:
Q16:
Q17:
Q18:
Q19:
Q20:
Q21:
Q22:
Q23:
```
