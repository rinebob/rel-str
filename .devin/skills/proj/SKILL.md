---
name: proj
description: "AI-native project lifecycle skill. Manages the full lifecycle of a significant project feature (Topic) using GitHub Issues + Projects as the tracking system. Stages: idea, plan, blueprint, implement, review, ship, refine, triage, release, abandon, backfill."
---

# proj — AI-Native Project Lifecycle

`proj` manages the full lifecycle of a significant project feature ("Topic") from idea to deployment. Every stage, phase, and task is a tracked GitHub issue with labels, status, and parent/child links. Every commit references its Topic and Task issue numbers.

## Dispatch

Parse the user's command and route to the matching stage doc. Each stage doc contains the full instructions for that lifecycle stage.

| Command | Stage Doc | Description |
|---------|-----------|-------------|
| `/proj idea "desc"` | [stages/idea.md](stages/idea.md) | Capture a new idea |
| `/proj plan 12` | [stages/plan.md](stages/plan.md) | Flesh out + grill + produce PRD |
| `/proj blueprint 12` | [stages/blueprint.md](stages/blueprint.md) | Split into areas, create phases/tasks |
| `/proj implement 12 25` | [stages/implement.md](stages/implement.md) | Implement task #25 (TDD) |
| `/proj review 12 25` | [stages/review.md](stages/review.md) | Quality gate (3-axis code review) |
| `/proj ship 12 25` | [stages/ship.md](stages/ship.md) | Commit + deploy + close issues |
| `/proj refine 12` | [stages/refine.md](stages/refine.md) | Re-grill an existing Topic |
| `/proj triage "bug"` | [stages/triage.md](stages/triage.md) | Intake a bug/issue |
| `/proj release` | [stages/release.md](stages/release.md) | Snapshot changelog |
| `/proj abandon 12` | [stages/abandon.md](stages/abandon.md) | Close an Idea/Topic |
| `/proj backfill 2026-01-01` | [stages/backfill.md](stages/backfill.md) | Migrate existing work into the system |

If no stage is given, show this dispatch table and ask which stage to run.

## Configuration

All GitHub Project IDs, field IDs, and option IDs are in [config.md](config.md). Read it before any stage that interacts with GitHub.

## Common Patterns

These patterns apply across multiple stages. Stage docs reference them by name rather than repeating the details.

### Create an issue

```bash
gh issue create --title "TITLE" --body "BODY" --label "LABEL1,LABEL2"
```

Capture the returned issue number immediately — it's needed for project linking, parent/child relationships, and commit messages.

### Link issue to project

```bash
gh project item-add 1 --owner rinebob --url "https://github.com/rinebob/rel-str/issues/NUMBER"
```

### Set a project field

```bash
gh project item-edit --id ITEM_ID --field-id FIELD_ID --project-id PROJECT_ID --single-select-option OPTION_ID
```

First, find the item's project ID:
```bash
gh project item-list 1 --owner rinebob --format json | jq '.items[] | select(.content.number == NUMBER) | {id: .id, number: .content.number}'
```

### Set parent/child relationship

Use GitHub's sub-issue feature:
```bash
gh issue edit CHILD_NUMBER --add-parent PARENT_NUMBER
```

### Close an issue

```bash
gh issue close NUMBER --comment "COMMENT"
```

### File locking via @topic tags

When a task begins editing a file, add a `@topic-N` tag comment at the top of the file (or in the file's section header). Before editing any file, scan for existing `@topic` tags — if a different topic owns the file, stop and report the conflict.

Only the `implement` and `blueprint` stages create/check file locks. The `ship` stage removes them.

### Commit message format

```
{topic}-{task}_{AREA}-{TYPE}-{DOMAIN}: Description

- Bullet point describing key change
- Another bullet point

Closes #TASK_NUMBER
Refs #TOPIC_NUMBER
```

Where:
- `{topic}` = topic issue number (e.g., `12`)
- `{task}` = task issue number (e.g., `25`)
- `{AREA}` = BE | FE | SHARED
- `{TYPE}` = FEAT | FIX | REFACTOR | TEST | DOCS | CHORE
- `{DOMAIN}` = functional domain (e.g., RH-AGENT, RS, OPTIONS, AUTH, CHART)

Example:
```
12-25_BE-FEAT-RH-AGENT: Add triage decision persistence

- Create rh-agent-triage-decisions Firestore collection
- Add write-through from RhAgentTriageStore
- Add status/date reporting page

Closes #25
Refs #12
```

## Lifecycle Flow

```
idea → plan → blueprint → implement → review → ship
                ↑                                    |
                |←───────── refine ←─────────────────|
```

`triage` can enter at any point (bugs discovered during any stage).
`release` snapshots the changelog at any time.
`abandon` closes a topic at any stage.
`backfill` imports pre-existing work.
