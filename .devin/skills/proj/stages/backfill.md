# Stage: backfill

Migrate existing work into the proj system. Creates issues for work that was done outside the proj lifecycle.

## Inputs

- `SINCE_DATE` — date (YYYY-MM-DD) from which to import existing work

## Process

### 1. Gather existing work

```bash
git log --since SINCE_DATE --oneline prod
```

Review the commits and group them by logical feature/topic. Ask the user to confirm the grouping.

### 2. For each logical topic

Ask the user:
- **Topic title** — a name for the feature
- **Description** — what it does
- **Is it complete?** — or is there remaining work?

### 3. Create the Topic issue

```bash
gh issue create --title "TOPIC: [Title] (backfilled)" --body "BODY" --label "topic"
```

Body should note this was backfilled from existing commits.

Link to project and set:
- Status → `Done` (option ID: `57f03408`) if complete, or `In Progress` (option ID: `4fb017f2`) if work remains
- Priority → ask user
- Size → ask user

### 4. Create task issues for each commit group

For each logical unit of work within the topic:
```bash
gh issue create --title "TASK: [Description] (backfilled)" --body "BODY" --label "task,area:BE"
gh issue edit TASK_NUMBER --add-parent TOPIC_NUMBER
```

Link to project, set Status → `Done` if the work is already committed.

### 5. Create as-built doc

Create `docs/implementations/TOPIC-{NUMBER}_as-built.md` summarizing what was built, referencing the actual commits.

### 6. Update changelog

Append to `docs/CHANGELOG.md`:
```markdown
## [YYYY-MM-DD] Topic #N: [Title] (backfilled from commits since SINCE_DATE)

- Task #N: [Description] (AREA)
...
```

### 7. Report

Tell the user:
- Topics created with issue numbers
- Tasks created with issue numbers
- Changelog updated
- Any remaining work identified
