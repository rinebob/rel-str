# Stage: abandon

Close an Idea or Topic that is no longer being pursued.

## Inputs

- `TOPIC_NUMBER` — the topic issue number to abandon

## Process

### 1. Load context

- Read the Topic issue and all child issues
- Check for any in-progress work: `git log --oneline prod..HEAD`
- Check for file locks: search for `@topic-TOPIC_NUMBER` tags

### 2. Confirm with the user

Ask the user to confirm they want to abandon this topic. Show:
- Topic title and description
- Current stage (Idea, Plan, Blueprint, In Progress, etc.)
- Number of child issues (phases, tasks)
- Any uncommitted work

### 3. Close all child issues

For each open child issue (phases, tasks, PRD, Idea):
```bash
gh issue close NUMBER --comment "Abandoned: Topic #TOPIC_NUMBER is no longer being pursued."
```

### 4. Close the Topic issue

```bash
gh issue close TOPIC_NUMBER --comment "Topic abandoned. All child issues closed."
```

Set the Topic's project Status → `Done` (option ID: `57f03408`) so it leaves the active board.

### 5. Remove file locks

Search for and remove any `@topic-TOPIC_NUMBER` tags from files.

### 6. Clean up uncommitted work

If there are uncommitted changes related to this topic, ask the user whether to:
- Discard them (`git checkout -- .` or `git stash`)
- Keep them on a branch for future reference

### 7. Report

Tell the user:
- Issues closed (list all numbers)
- File locks removed
- Any uncommitted work disposition
