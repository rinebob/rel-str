# Stage: plan

Flesh out the idea through grilling, produce a PRD with testable acceptance criteria.

## Inputs

- `TOPIC_NUMBER` — the topic issue number to plan

## Process

### 1. Load context

- Read the Topic issue: `gh issue view TOPIC_NUMBER`
- Read the Idea issue (child of Topic)
- Read `docs/implementations/TOPIC-{NUMBER}_idea.md` if it exists
- Read `CONTEXT.md` and any relevant ADRs in the repo

### 2. Grill the concept

Use the grilling pattern from the `grilling` skill. Ask relentless questions one at a time, wait for the user's answer, then ask the next. Cover:

- **Problem statement** — what exact problem does this solve?
- **Users** — who benefits and how?
- **Scope** — what's in, what's explicitly out?
- **Constraints** — technical, timeline, dependency constraints
- **Edge cases** — what happens when things go wrong?
- **Alternatives** — what else was considered and rejected?
- **Success criteria** — how do we know it's done?
- **Risks** — what could derail this?

Don't proceed to PRD until the user has answered enough questions to write testable acceptance criteria. If the user wants to stop early, respect that — but note which questions are unanswered.

### 3. Write the PRD

Create `docs/implementations/TOPIC-{NUMBER}_prd.md` with:

```markdown
# PRD: [Topic Title]

**Topic Issue:** #TOPIC_NUMBER
**Date:** YYYY-MM-DD
**Status:** Draft

## Problem Statement
[Clear, concise problem description]

## Users
[Who benefits and how]

## Scope
### In Scope
- ...
### Out of Scope
- ...

## Constraints
- ...

## Acceptance Criteria
- [ ] AC1: [testable criterion]
- [ ] AC2: [testable criterion]
- ...

## Open Questions
- ...

## Risks
- ...

## Alternatives Considered
- ...
```

Each acceptance criterion must be **testable** — it should be possible to write a test or perform a verification that confirms the criterion is met.

### 4. Create the PRD issue

```bash
gh issue create --title "PRD: [Topic Title]" --body "BODY" --label "prd"
```

Set parent to the Topic:
```bash
gh issue edit PRD_NUMBER --add-parent TOPIC_NUMBER
```

Link to project and set Status → `Plan` (option ID: `cbe47bd5`).

### 5. Update Topic status

Set the Topic issue's project Status → `Plan` (option ID: `cbe47bd5`).

### 6. Report

Tell the user:
- PRD file path
- PRD issue number and URL
- List of acceptance criteria
- Suggest next step: `/proj blueprint TOPIC_NUMBER`
