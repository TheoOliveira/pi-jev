// Snapshot of installed skill descriptions, 2026-09-25. No skill bodies or user paths.
import type { SkillMetadata } from '../../src/skills.js';

export const skills: SkillMetadata[] = [
  {
    "name": "typesafe-ai",
    "description": "Build AI-powered software with TypeSafe: small units of AI intelligence you can use like programming primitives. Its System One models, including Jev, turn natural language and application state into typed judgments and probabilities that code can combine. Use when a feature needs programmable common sense, when brainstorming what AI could make possible in an app, or when an LLM prompt-and-parse step could become a structured decision. Applications include routing, ranking, extraction, verification, and interactive experiences; these are starting points, not the limits. Read live docs and cookbooks to find useful patterns and discover new combinations.\n"
  },
  {
    "name": "how",
    "description": "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Can critique architecture. Use why for motivation."
  },
  {
    "name": "ask-matt",
    "description": "Ask which skill or flow fits your situation. A router over the skills in this repo."
  },
  {
    "name": "htmx-upgrade-from-htmx2",
    "description": "Use when helping a user upgrade or migrate their codebase from htmx 2.x to htmx 4.x. Covers attribute renames, event name changes, config updates, header changes, extension migration, and step-by-step upgrade workflow."
  },
  {
    "name": "maintain-verification-skill",
    "description": "Periodic pass that keeps a project's verification skill and feature map honest: parallel source readers per feature, one live session driving every feature, at most one PR of proven corrections. Use for /maintain-verification-skill or \"audit the verify skill\"."
  },
  {
    "name": "principle-build-the-lever",
    "description": "Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. The tool is the artifact a reviewer can rerun."
  },
  {
    "name": "principle-exhaust-the-design-space",
    "description": "Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Build 2-3 competing prototypes and compare side by side before committing."
  },
  {
    "name": "principle-model-the-domain",
    "description": "Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files. Encode the domain in a structure instead of scattered conditionals."
  },
  {
    "name": "prototype",
    "description": "Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like."
  },
  {
    "name": "setup-pstack",
    "description": "Configure which models pstack uses per role. Detects your available models and writes an always-applied rule that overrides the skill defaults. Use for /setup-pstack, \"configure pstack models\", or changing pstack's model choices."
  },
  {
    "name": "gstack-freeze",
    "description": "Restrict file edits to a specific directory for the session. (gstack)\n"
  },
  {
    "name": "gstack-unfreeze",
    "description": "Clear the freeze boundary set by /skill:gstack-freeze, allowing edits to all directories\nagain. (gstack)\n"
  },
  {
    "name": "diagnosing-bugs",
    "description": "Diagnosis loop for hard bugs and performance regressions. Use when the user says \"diagnose\"/\"debug this\", or reports something broken/throwing/failing/slow."
  },
  {
    "name": "frontend-design",
    "description": "Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics."
  },
  {
    "name": "resolving-merge-conflicts",
    "description": "Use when you need to resolve an in-progress git merge/rebase conflict."
  }
];

export const cases: Array<{ id: string; query: string; include: string[]; exclude: string[] }> = [
  {
    "id": "reported-session-limit",
    "query": "model claude-fable-5 hit its session limit but still keeps being selected by the model router",
    "exclude": [
      "setup-pstack"
    ],
    "include": []
  },
  {
    "id": "explicit-router-bug",
    "query": "Debug pi-jev: the model router keeps choosing Claude after its five-hour quota is exhausted",
    "exclude": [
      "setup-pstack"
    ],
    "include": []
  },
  {
    "id": "generic-model-selection",
    "query": "Why does the model selector keep using an unavailable model?",
    "exclude": [
      "setup-pstack"
    ],
    "include": []
  },
  {
    "id": "negated-pstack",
    "query": "Do not configure pstack; fix pi-jev selecting rate-limited models",
    "exclude": [
      "setup-pstack"
    ],
    "include": []
  },
  {
    "id": "research-recommendation",
    "query": "fully research jev matching /skill:setup-pstack and if it is deemed to be a router bug, fix it",
    "exclude": [
      "setup-pstack"
    ],
    "include": []
  },
  {
    "id": "quoted-name",
    "query": "The log says \"setup-pstack\". Explain why that skill was matched.",
    "exclude": [
      "setup-pstack"
    ],
    "include": []
  },
  {
    "id": "configure-pstack",
    "query": "configure pstack models",
    "exclude": [],
    "include": [
      "setup-pstack"
    ]
  },
  {
    "id": "change-role-model",
    "query": "change pstack's bug-fix model to a cheaper available model",
    "exclude": [],
    "include": [
      "setup-pstack"
    ]
  },
  {
    "id": "explicit-workflow",
    "query": "Use setup-pstack to configure which models pstack uses per role",
    "exclude": [],
    "include": [
      "setup-pstack"
    ]
  },
  {
    "id": "pstack-limit-workaround",
    "query": "Set pstack to use a different model when Claude hits its limit",
    "exclude": [],
    "include": [
      "setup-pstack"
    ]
  },
  {
    "id": "greeting",
    "query": "hello",
    "exclude": [
      "typesafe-ai",
      "how",
      "ask-matt",
      "htmx-upgrade-from-htmx2",
      "maintain-verification-skill",
      "principle-build-the-lever",
      "principle-exhaust-the-design-space",
      "principle-model-the-domain",
      "prototype",
      "setup-pstack",
      "gstack-freeze",
      "gstack-unfreeze",
      "diagnosing-bugs",
      "frontend-design",
      "resolving-merge-conflicts"
    ],
    "include": []
  },
  {
    "id": "unrelated",
    "query": "What is the capital of France?",
    "exclude": [
      "typesafe-ai",
      "how",
      "ask-matt",
      "htmx-upgrade-from-htmx2",
      "maintain-verification-skill",
      "principle-build-the-lever",
      "principle-exhaust-the-design-space",
      "principle-model-the-domain",
      "prototype",
      "setup-pstack",
      "gstack-freeze",
      "gstack-unfreeze",
      "diagnosing-bugs",
      "frontend-design",
      "resolving-merge-conflicts"
    ],
    "include": []
  },
  {
    "id": "generic-debugging",
    "query": "diagnose why the build is failing and debug the error",
    "exclude": [
      "setup-pstack"
    ],
    "include": [
      "diagnosing-bugs"
    ]
  },
  {
    "id": "htmx-migration",
    "query": "Upgrade my htmx 2 app to htmx 4",
    "exclude": [
      "setup-pstack"
    ],
    "include": [
      "htmx-upgrade-from-htmx2"
    ]
  },
  {
    "id": "frontend-design",
    "query": "Build a distinctive frontend landing page for my website",
    "exclude": [
      "setup-pstack"
    ],
    "include": [
      "frontend-design"
    ]
  },
  {
    "id": "merge-conflict",
    "query": "Resolve the in-progress git merge conflict",
    "exclude": [
      "setup-pstack"
    ],
    "include": [
      "resolving-merge-conflicts"
    ]
  }
];
