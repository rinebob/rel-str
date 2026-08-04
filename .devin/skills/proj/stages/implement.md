# Stage: implement

Implement a specific task using TDD. Tracks file ownership via `@topic` tags.

## Inputs

- `TOPIC_NUMBER` — the topic issue number
- `TASK_NUMBER` — the task issue number to implement

## Process

### 1. Load context

- Read the task issue: `gh issue view TASK_NUMBER`
- Read the parent phase issue and the Topic issue
- Read `docs/implementations/TOPIC-{NUMBER}_blueprint.md` for the implementation plan
- Read `docs/implementations/TOPIC-{NUMBER}_prd.md` for acceptance criteria
- Read the task's test plan from the blueprint

### 2. Verify file locks

Before editing any file, scan for existing `@topic` tags. If a file has a `@topic-N` tag where N ≠ TOPIC_NUMBER, stop and report the conflict. Do not edit files locked by another topic.

### 3. Update task status

Set the task's project fields:
- Status → `In Progress` (option ID: `4fb017f2`)
- Area Status (BE/FE/SHARED) → `In Progress`

### 4. TDD iteration

Follow the TDD skill (`/tdd`) for the implementation:

1. **Confirm seams** — identify the public interfaces to test against, confirm with the user
2. **Red** — write a failing test for one slice of behavior
3. **Green** — write the minimum code to pass the test
4. **Repeat** — one test → one implementation → repeat, each test a tracer bullet
5. **Refactor** — only after all tests pass, and only in the review stage

Run typechecking regularly:
- Frontend: `npm run build -- --configuration development --no-progress`
- Backend: `npm --prefix functions run typecheck` and `npm --prefix functions run build`
- Single test files regularly, full suite at the end

### 5. File locking

Add `@topic-TOPIC_NUMBER` tags to any new files created during implementation. Verify existing tags are still intact.

### 6. Update task issue

When implementation is complete, post a comment on the task issue summarizing:
- Files created/modified
- Tests written
- Any deviations from the blueprint plan and why

### 7. Report

Tell the user:
- What was implemented
- Test results
- Suggest next step: `/proj review TOPIC_NUMBER TASK_NUMBER`
