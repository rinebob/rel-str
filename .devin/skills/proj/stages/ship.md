# Stage: ship

Commit with structured format, update changelog, close issues, remove file locks, generate as-built docs.

## Inputs

- `TOPIC_NUMBER` — the topic issue number
- `TASK_NUMBER` — the task issue number to ship

## Prerequisites

- The task must have passed review (`/proj review` with PASS verdict)
- If no review was run, ask the user if they want to skip the review gate

## Process

### 1. Load context

- Read the task issue and review doc
- Check `git status` for uncommitted changes
- Verify the review verdict was PASS (or user explicitly skipped)

### 2. Stage changes

```bash
git status
git add -A
```

Review the staged changes one final time. Confirm no debug code, no secrets, no unrelated changes.

### 3. Commit

Use the structured commit format from SKILL.md:

```
{topic}-{task}_{AREA}-{TYPE}-{DOMAIN}: Description

- Bullet point describing key change
- Another bullet point

Closes #TASK_NUMBER
Refs #TOPIC_NUMBER
```

Ask the user to confirm the commit message before committing.

```bash
git commit -m "COMMIT_MESSAGE"
```

### 4. Deploy

The repo's default branch is `prod` — committing to `prod` means deployed. If on a feature branch:

```bash
git push origin HEAD
gh pr create --base prod --title "TITLE" --body "BODY"
```

If on `prod` directly:
```bash
git push origin prod
```

Firebase deploy (if backend functions changed):
```bash
firebase deploy --only functions
```

Ask the user which deploy steps are needed — don't auto-deploy.

### 5. Close the task issue

```bash
gh issue close TASK_NUMBER --comment "Implemented in commit SHA. Review: PASS."
```

Set the task's project fields:
- Status → `Done` (option ID: `57f03408`)
- Area Status → `Done`

### 6. Check if all tasks are done

List the Topic's child phases and their child tasks. If all tasks in all phases are closed, the Topic is complete — proceed to step 7. Otherwise, report which tasks remain and suggest the next one.

### 7. If Topic is complete

- Close the Topic issue: `gh issue close TOPIC_NUMBER --comment "All tasks complete. Topic shipped."`
- Set Topic project Status → `Done` (option ID: `57f03408`)
- Generate as-built doc: `docs/implementations/TOPIC-{NUMBER}_as-built.md`
- Update changelog (see step 8)

### 8. Update changelog

Append to `docs/CHANGELOG.md` (create if it doesn't exist):

```markdown
## [YYYY-MM-DD] Topic #TOPIC_NUMBER: [Title]

- Task #TASK_NUMBER: [Description] (AREA)
- Task #TASK_NUMBER: [Description] (AREA)
...
```

### 9. Remove file locks

Remove all `@topic-TOPIC_NUMBER` tags from files that were locked by this topic. The files are now available for other topics to edit.

### 10. Report

Tell the user:
- Commit SHA
- Deploy status
- Issues closed
- Whether the Topic is complete or tasks remain
- Changelog updated
- File locks removed
