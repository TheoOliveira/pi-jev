# pi-jev

Semantic tool routing and typed decisions for the [Pi coding agent](https://pi.dev) powered by [TypeSafe](https://typesafe.ai) Jev (System One).

## Features

- **Semantic Tool Router (`jev_find_tools`)**: Automatically searches registered inactive tools and additively activates only the tools needed for the user's specific prompt or workflow.
- **Typed Judgments (`jev_evaluate`)**: Run fast, calibrated System One decisions directly from the agent using Choice, Noul (yes/no probability), and Score primitives.
- **On-Demand & Safe**: Runs when called. No unsolicited per-turn API token costs. Fails open gracefully to local keyword shortlists if Jev is unreachable or unconfigured.

## Installation

```bash
pi install npm:pi-jev
```

Or install directly from GitHub:

```bash
pi install git:github.com/TheoOliveira/pi-jev
```

## Setup

Set your TypeSafe API key in your environment:

```bash
export TYPESAFE_API_KEY=ts_...
```

Then check status inside Pi:

```text
/jev status
```

## Commands

- `/jev status` — Shows Jev configuration, session request count, total tokens, and available tool counts.
- `/jev test` — Runs a sample dual-question evaluation against TypeSafe Jev.
- `/jev enable` — Enables Jev tools in the active session.
- `/jev disable` — Disables Jev tools for the active session.

## Tools Provided

### 1. `jev_find_tools`
Used by the model to find capabilities that aren't currently loaded into the prompt prefix.

```json
{
  "query": "inspect SQLite database schemas and run queries"
}
```

### 2. `jev_evaluate`
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
