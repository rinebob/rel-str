# proj — AI-Native Project Lifecycle Skill

Manages the full lifecycle of a significant project feature ("Topic") using GitHub Issues + Projects as the tracking system. Designed for use with Windsurf's Cascade AI assistant.

## Quick Start

```bash
/proj idea "add spread time series viewer"
/proj plan 12
/proj blueprint 12
/proj implement 12 25
/proj review 12 25
/proj ship 12 25
```

## Lifecycle Stages

```
idea → plan → blueprint → implement → review → ship
                ↑                                    |
                |←───────── refine ←─────────────────|
```

| Command | Description |
|---------|-------------|
| `/proj idea "desc"` | Capture a new idea |
| `/proj plan 12` | Flesh out + grill + produce PRD |
| `/proj blueprint 12` | Split into areas, create phases/tasks |
| `/proj implement 12 25` | Implement task #25 (TDD) |
| `/proj review 12 25` | Quality gate (3-axis code review) |
| `/proj ship 12 25` | Commit + deploy + close issues |
| `/proj refine 12` | Re-grill an existing Topic |
| `/proj triage "bug"` | Intake a bug/issue |
| `/proj release` | Snapshot changelog |
| `/proj abandon 12` | Close an Idea/Topic |
| `/proj backfill 2026-01-01` | Migrate existing work into the system |

## Requirements

- Windsurf IDE with Cascade AI assistant
- GitHub repository with Issues + Projects enabled
- `gh` CLI authenticated with `project` scope
- Skills installed in `.devin/skills/proj/`

## Configuration

All GitHub Project IDs, field IDs, and option IDs are in [config.md](config.md). Update this file if the project structure changes.

## How It Works

1. **Idea** — Capture raw thoughts, supporting material, and open questions. Creates a Topic issue + Idea issue in GitHub.
2. **Plan** — Grill the concept (relentless Q&A with the user), produce a PRD with testable acceptance criteria.
3. **Blueprint** — Grill the implementation approach, produce implementation plans + test plans per area (BE/FE/SHARED), break into phases and tasks with blocking edges.
4. **Implement** — TDD iteration: write tests first, implement to pass, refactor. Tracks file ownership via `@topic` tags to prevent cross-Topic conflicts.
5. **Review** — Three-axis code review (Standards, Spec, Thermo-nuclear) + full test suite. Produces a code review doc with PASS/FAIL verdict.
6. **Ship** — Commit with structured format, update changelog, close issues, remove file locks, generate as-built docs.

## Key Features

- **GitHub Issues as source of truth** — every stage, phase, and task is a tracked issue
- **Grilling loop** — ideas and plans are stress-tested before any code is written
- **File locking** — `@topic` tags prevent two Topics from editing the same file simultaneously
- **Structured commits** — every commit references its Topic and Task issue numbers
- **Documentation trail** — PRDs, implementation plans, test plans, code reviews, as-built docs, changelog entries are all auto-generated
- **Single environment** — commit to `prod` = deployed. QA is a pre-commit gate, not a separate environment
