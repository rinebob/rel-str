# Stage: blueprint

Split the PRD into implementation areas, create phases and tasks with blocking edges.

## Inputs

- `TOPIC_NUMBER` — the topic issue number to blueprint

## Process

### 1. Load context

- Read the Topic issue and PRD issue
- Read `docs/implementations/TOPIC-{NUMBER}_prd.md`
- Read `CONTEXT.md`, relevant ADRs, and existing codebase structure
- Understand the repo's area boundaries (BE = `functions/src/`, FE = `src/app/`, SHARED = shared types/constants)

### 2. Grill the implementation approach

Use the grilling pattern. Ask questions one at a time:

- **Architecture** — what's the high-level approach?
- **Area split** — which parts are BE, FE, SHARED?
- **Dependencies** — what does this depend on? What depends on this?
- **Sequencing** — what must happen before what?
- **Testing strategy** — what are the seams? Where do tests go?
- **File impact** — which files will be created/modified?
- **Risk areas** — what's the riskiest part?

### 3. Define areas

For each area (BE, FE, SHARED) that's in scope:

- List the files that will be created or modified
- Identify any file ownership conflicts with existing `@topic` tags
- Note the testing approach for that area

Create `docs/implementations/TOPIC-{NUMBER}_blueprint.md` with the full implementation plan.

### 4. Define phases

Break the work into ordered phases. Each phase is a GitHub issue with the `phase` label.

For each phase:
- **Name** — short descriptive name
- **Area** — BE, FE, SHARED, or cross-area
- **Goal** — what this phase accomplishes
- **Depends on** — which phases must complete first
- **Tasks** — list of tasks within this phase

### 5. Define tasks

Break each phase into concrete tasks. Each task is a GitHub issue with the `task` label and an `area:*` label.

For each task:
- **Title** — clear, actionable
- **Description** — what to do and how
- **Acceptance** — link back to PRD acceptance criteria
- **Files** — which files this task will touch
- **Test plan** — what tests to write (TDD)
- **Blocks** — which tasks are blocked by this one
- **Blocked by** — which tasks block this one

### 6. Create issues in GitHub

For each phase:
```bash
gh issue create --title "PHASE N: [Name]" --body "BODY" --label "phase,area:BE"
gh issue edit PHASE_NUMBER --add-parent TOPIC_NUMBER
gh project item-add 1 --owner rinebob --url "https://github.com/rinebob/rel-str/issues/PHASE_NUMBER"
```

For each task:
```bash
gh issue create --title "TASK: [Name]" --body "BODY" --label "task,area:BE"
gh issue edit TASK_NUMBER --add-parent PHASE_NUMBER
gh project item-add 1 --owner rinebob --url "https://github.com/rinebob/rel-str/issues/TASK_NUMBER"
```

Set task project fields:
- Status → `Backlog` (option ID: `c98e776e`)
- Area Status (BE/FE/SHARED) → `Not Started`
- Size → estimate (XS/S/M/L/XL)

### 7. Set blocking edges

Document blocking relationships in the task issue bodies. Use the format:

```
**Blocks:** #26, #27
**Blocked by:** #23, #24
```

### 8. File locking

For each task, list the files it will touch. Add `@topic-TOPIC_NUMBER` tags to those files (as comments at the top). If a file already has a `@topic` tag from a different topic, report the conflict and stop.

### 9. Update Topic status

Set the Topic issue's project Status → `Blueprint` (option ID: `16324f56`).

### 10. Report

Tell the user:
- Blueprint file path
- List of phases with their issue numbers
- List of tasks with their issue numbers, area, and blocking relationships
- File lock summary
- Suggest next step: `/proj implement TOPIC_NUMBER TASK_NUMBER`
