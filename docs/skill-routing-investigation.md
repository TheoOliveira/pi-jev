# Why Jev recommended `setup-pstack` for a router bug

Investigated 2026-09-25. Result: a skill-router question-design bug, reproduced against the live API and fixed in `src/skills.ts`. This is separate from the model router's session-limit bug.

## Evidence from the reported incident

The session recorded two identical requests:

> model claude-fable-5 hit its session limit but still keeps being selected by the model router

The adjacent `jev-auto` custom messages recommended `setup-pstack` at 0.79 and 0.80, at 2026-09-25T20:34:22.569Z and 20:34:59.147Z respectively. These were positive semantic judgments, not offline keyword fallback, which uses probability 0.

The installed skill's frontmatter says:

> Configure which models pstack uses per role. Detects your available models and writes an always-applied rule that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.

Its body writes `~/.cursor/rules/pstack-models.mdc`. The reported task concerned pi-jev selecting an exhausted provider model, not pstack role configuration. Neither this description nor the skill needs changing to resolve the incident. Source: installed `~/.agents/skills/setup-pstack/SKILL.md`, description and Steps 1–5.

A new replay through the actual `SkillRouter.findSkills` and `JevClient.evaluate` reproduced the recommendation at **0.81**. The raw API answer was `{ type: "noul", noul: 0.81 }`, with `model: "jev-1.13.0"`. Normalization preserved that number. The replay reconstructed 153 installed skill records; it did not recover an archived historical registry snapshot. Its exact request and response were inspected before making changes.

## Runtime path in the investigated branch

1. Pi's `getCommands()` exposes skill names as `skill:<name>` and copies their full descriptions. Source: installed `@earendil-works/pi-coding-agent/dist/core/agent-session.js`, `_bindExtensionCore`, lines 1989–2010.
2. [`SkillRouter.getAvailableSkills`](../src/skills.ts) gathers those records. Its earlier prefix fix affects names, not semantic applicability.
3. `shortlist` ranks by substring occurrence and takes twelve candidates. It does not prove that a candidate is applicable.
4. `findSkills` submits one Noul per candidate, with the task and candidate metadata in shared state.
5. [`JevClient.evaluate`](../src/jev.ts) normalizes the returned `noul` value. `findSkills` recommends every candidate at or above 0.65.
6. [`AutoJev.route`](../src/auto.ts) passes those recommendations to [`before_agent_start`](../extensions/index.ts), which emits the instruction to load the matching skills.

Neither this path nor the reproduced request includes the full setup-pstack skill body or conversation history. Its embedded model-name examples therefore did not cause the initial recommendation.

## Root cause and controlled comparisons

The old question was:

> Does the skill 'setup-pstack' (description) provide direct guidance or specialized domain steps for this task: "user request"?

That asks whether related guidance could help. It does not explicitly require the requested action, product, and skill workflow to agree. Both texts discuss model selection, but their activities and products differ.

The fix asks whether the task requests the activity described by the candidate, in the product or framework that skill targets. It explicitly rejects shared-topic matches, assumed product context, and treating an investigation of a recommendation as a request to execute the recommended workflow. It references `task` and `available_skills[index]` in state instead of interpolating their text into the instruction.

Controlled comparisons kept candidate descriptions, order, state, and the 0.65 cutoff fixed:

- An initial wording-only comparison reduced the incident's score from 0.80 to 0.45 while retaining configuration positives at 0.97–0.99.
- The final question on the original twelve-candidate snapshot scored the incident at 0.16, 0.17, and 0.17. A post-fix run through the production router scored 0.19 and recommended nothing.
- The broader frozen fixture described below produced the same separation across three runs.

This establishes a causal effect of the changed question contract on these inputs. It does not isolate every clause of the final wording, prove Jev's internal reasoning, or establish global error rates.

### Why not raise the cutoff or blacklist the skill?

The skill is appropriate for genuine pstack configuration requests. Raising a shared cutoff would change tool and skill behavior elsewhere, and would not address the meaning of the question. No skill name is special-cased in production code. The cutoff remains 0.65, and multiple applicable skills can still be returned.

## Primary-source guidance

- [TypeSafe Noul documentation](https://docs.typesafe.ai/primitives/noul.md): the number is the probability that the stated yes/no proposition holds. It is not a degree of relevance and has no separate confidence field. A high value for the wrong proposition is not a guarantee of correct routing.
- [TypeSafe skill-suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion.md): "A question about subject matter will not separate explain what a monad is from a request that needs a skill, since both are software." Its verification question asks whether the skill does "the specific thing the user's request asks for."
- [TypeSafe Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md): Jev answers the question written, not the intended one; irrelevant state and underspecified judgments can cause errors. Thresholds should not be transferred blindly across differently worded questions.
- [TypeSafe state documentation](https://docs.typesafe.ai/concepts/state.md) and [building guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md): put evidence in named state fields and reference those fields in the judgment.
- Pi's installed `docs/skills.md`, sections "Create a skill" and "Understand how skills load": the description determines when a skill is considered; descriptions should state both what the skill does and when it applies. Full instructions load later.

The official cookbook uses two requests, a wider semantic ranking, fuller skill evidence, and at most one suggestion. Those are design options, not requirements established by this incident. Its Hermes-roster benchmark is not a benchmark of pi-jev. This fix retains pi-jev's single-call, multi-label design.

## Before/after evaluation

[`test/fixtures/skill-routing.ts`](../test/fixtures/skill-routing.ts) freezes fifteen public skill descriptions and sixteen labeled prompts. It includes the original twelve candidate descriptions plus debugging, frontend, and merge-conflict controls. Each prompt ran three times with the previous question and three times with the revised question. Both arms use the actual discovery, shortlist, normalization, and recommendation code. The comparison mode changes only the question text.

Model returned by every measured call: `jev-1.13.0`. Cutoff: 0.65. All calls completed without heuristic fallback.

| Prompt category | Old setup-pstack probability | Fixed probability | Expected |
|---|---:|---:|---|
| Reported session-limit bug | 0.79–0.80 | 0.14–0.16 | Do not recommend |
| Generic unavailable-model selection | 0.75–0.77 | 0.13–0.16 | Do not recommend |
| Explicit pi-jev debugging | 0.33–0.38 | 0.14 | Do not recommend |
| Research why setup-pstack was matched | 0.16–0.18 | 0.13–0.16 | Do not recommend |
| Quoted setup-pstack name in a log | 0.28–0.33 | 0.08–0.10 | Do not recommend |
| Configure pstack models | 0.98 | 0.94 | Recommend |
| Change pstack's bug-fix role model | 0.96 | 0.95–0.96 | Recommend |
| Explicit setup-pstack workflow | 0.96 | 0.95 | Recommend |
| Change pstack model when Claude is limited | 0.77–0.80 | 0.93–0.94 | Recommend |

The previous question failed 6 of 48 case-runs: both false-positive categories on all three repetitions. The fixed question passed **48 of 48** case-runs. Debugging, htmx migration, frontend design, and merge-conflict positive controls all retained their expected skill; greetings and unrelated questions recommended none. The fixture requires listed positives and excludes listed negatives; it is not an exhaustive label of every potentially relevant skill.

All per-candidate probabilities, recommendations, candidate lists, timestamps, and assertion failures are retained in [`skill-routing-evidence.json`](skill-routing-evidence.json). The small corpus was used during development, not held out. Repetition checks stability, not statistical independence or generalization.

## Integration against upstream main

The separate PR is based on `3c6d6c5` from upstream main, not the dirty investigation branch. Main had meanwhile merged batched automatic routing, which builds its own skill questions rather than calling `findSkills`. The PR extracts `skillApplicabilityQuestion` and uses it in **both** paths. A regression test checks identical questions and candidate-index references while preserving one combined tool/skill request per automatic turn.

The earlier `skill:` prefix normalization is deliberately excluded from this PR, along with model-router and security changes. Tests exercise prefixed command names. The replay normalizes those names only when comparing results to fixture labels; production naming behavior is unchanged. The original research evidence above came from the investigation branch with prefix normalization present.

Validation on the clean PR branch: **56 offline tests pass**, project and replay-script typechecks pass, **48/48 fresh explicit live cases pass**, and **6/6 batched automatic live cases pass**. Automatic routing includes a read-tool candidate in the shared request; its reported-bug probability is 0.15, while pstack configuration controls score 0.93–0.94. See [PR validation measurements](skill-routing-pr-validation.json).

## Verification and reproduction

Offline tests lock the exact scope-aware question contract, candidate-index references, unchanged threshold behavior, and multiple recommendations. They do not pretend to prove semantic behavior using a fake classifier. The opt-in live replay measures that separately.

```bash
npm run typecheck
npm test

# Requires a configured TypeSafe key. Sends only fixture prompts/descriptions.
node --import tsx scripts/replay-skill-routing.ts --live --repeats 3 --output /tmp/skills-after.json

# Restores only the previous question; expected to exit 1 on the documented misses.
node --import tsx scripts/replay-skill-routing.ts --live --legacy --repeats 3 --output /tmp/skills-before.json
```

The replay script fails on missing expected positives, unexpected prohibited recommendations, or API fallback. It does not invoke a skill, change model settings, or send skill bodies or private session history.

## Limits and follow-up findings

These findings were inspected but are not changed by this targeted fix:

- **Shortlist recall:** the original query matched `setup-pstack` on `model`, `the`, and `model` again. `diagnosing-bugs` matched only `the` and missed the twelve-candidate cutoff. Other candidates gained points from substrings such as `but` or `its`. The fix correctly abstains instead of suggesting setup-pstack, but it cannot recommend a debugging skill absent from the candidate pool. Better retrieval needs a broader recall corpus and latency/budget evaluation.
- **Explicit-only metadata:** Pi's `getCommands()` includes skills whose `disableModelInvocation` metadata is not carried on command records. The command discovery path does not enforce that flag. The reconstructed pool included explicit-only principle skills; setup-pstack itself is not explicit-only. This is a separate discovery-policy issue, not the cause of setup-pstack's score.
- **Two discovery sources:** command-context discovery can collect both an unprefixed metadata key and a prefixed command key for the same skill. The automatic hook lacks `getSystemPromptOptions`, so the incident's reproduced command-only path had one setup-pstack record. Deduplication is separate from this semantic fix.
- **Offline fallback:** `findSkills` returns keyword matches with probability 0 on service failure. AutoJev on the investigated branch forwarded those matches. Upstream main, and therefore this PR, now uses a combined request and returns an error skip when it fails. The historical fallback concern does not describe current automatic routing; explicit lookup still has its labeled keyword fallback.
- **Missing conversation context:** routing evaluates the current prompt. A short follow-up whose product is established only in prior turns can now be rejected conservatively. Test conversational context separately before supplying history indiscriminately.
- **Model drift:** `jev-latest` can change. Retained model IDs and the live replay make future changes measurable; the 48-case result is not a guarantee for every skill, language, or future model.

Run `/reload` to load the changed extension. No pstack configuration, installed skill files, or global threshold were modified.
