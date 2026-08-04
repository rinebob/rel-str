# Stage: review

Three-axis code review + full test suite. Produces a code review doc with PASS/FAIL verdict.

## Inputs

- `TOPIC_NUMBER` — the topic issue number
- `TASK_NUMBER` — the task issue number to review

## Process

### 1. Load context

- Read the task issue and its implementation comment
- Read the PRD acceptance criteria
- Read the blueprint test plan
- Identify the diff base: the last commit on `prod` or the merge-base of the current branch and `prod`

### 2. Update task status

Set the task's project fields:
- Status → `QA` (option ID: `71647f9a`)
- Area Status → `In Review`

### 3. Capture the diff

```bash
git diff prod...HEAD --stat
git log prod..HEAD --oneline
```

### 4. Run three-axis review

Run all three axes as parallel sub-agents (or sequentially if the tool doesn't support parallel):

#### Axis 1: Standards

Does the code conform to the repo's documented coding standards?

- Read `.devin/skills/rel-str-coding-guidelines.md`
- Read `.devin/skills/rh-agent-coding-guidelines.md` (if RH Agent area)
- Read `.devin/skills/angular-developer.md`
- Check for Fowler code smells (see code-review skill for the full smell baseline)
- Report violations with file + line citations

#### Axis 2: Spec

Does the code faithfully implement the PRD acceptance criteria?

- Read each acceptance criterion from the PRD
- Check whether it's implemented, partially implemented, or missing
- Check for scope creep (behavior not asked for in the PRD)
- Report findings with spec line references

#### Axis 3: Thermo-nuclear

Deep scrutiny for catastrophic failure modes:

- Read `.devin/skills/thermo-nuclear-code-review.md` for the full checklist
- Security: injection, auth bypass, secret exposure, unsafe deserialization
- Data loss: unhandled errors, missing persistence, race conditions
- State corruption: shared mutable state, missing cleanup, orphaned resources
- Production safety: missing error handling, unbounded queries, memory leaks
- Firebase/Firestore: security rules, cost of queries, batch limits
- Report findings with severity (CRITICAL / HIGH / MEDIUM / LOW)

### 5. Run full test suite

```bash
npm test
npm --prefix functions run test
```

If tests fail, report failures and stop — the review verdict is FAIL.

### 6. Write the review doc

Create `docs/dev-notes/REVIEW-TOPIC-{NUMBER}-TASK-{TASK_NUMBER}.md` with:

```markdown
# Code Review: [Task Title]

**Date:** YYYY-MM-DD
**Reviewer:** Cascade (3-axis review)
**Topic:** #TOPIC_NUMBER
**Task:** #TASK_NUMBER
**Diff base:** prod@SHA
**Scope:** N files changed, +X / -Y lines

## Standards
[Findings or "No violations found"]

## Spec
[Findings or "All acceptance criteria met"]

## Thermo-nuclear
[Findings or "No critical issues found"]

## Test Suite
[Pass/fail summary]

## Verdict

**PASS** / **FAIL**

[If FAIL, list required fixes before shipping]
```

### 7. Report

Present the review doc to the user. If PASS, suggest next step: `/proj ship TOPIC_NUMBER TASK_NUMBER`. If FAIL, list the required fixes and suggest re-running `/proj implement` to address them.
