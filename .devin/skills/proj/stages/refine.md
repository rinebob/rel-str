# Stage: refine

Re-grill an existing Topic. Used when new information, changed requirements, or implementation discoveries warrant revisiting the plan.

## Inputs

- `TOPIC_NUMBER` — the topic issue number to refine

## Process

### 1. Load context

- Read the Topic issue and all child issues (phases, tasks)
- Read `docs/implementations/TOPIC-{NUMBER}_prd.md`
- Read `docs/implementations/TOPIC-{NUMBER}_blueprint.md`
- Check `git log --oneline prod..HEAD` for any in-progress work
- Read any review docs for this topic

### 2. Identify what changed

Ask the user:
- What new information or requirements have emerged?
- What's not working as planned?
- What needs to change?

### 3. Grill the changes

Use the grilling pattern. Stress-test the proposed changes:
- Do the changes invalidate any acceptance criteria?
- Do the changes affect the area split or file ownership?
- Are there new blocking dependencies?
- Does the scope expand or contract?

### 4. Update the PRD

If acceptance criteria change, update `docs/implementations/TOPIC-{NUMBER}_prd.md` and post a comment on the PRD issue summarizing the changes.

### 5. Update the blueprint

If phases or tasks change:
- Create new task issues for new work
- Close task issues that are no longer needed (with a comment explaining why)
- Update blocking edges
- Update `docs/implementations/TOPIC-{NUMBER}_blueprint.md`

### 6. Report

Tell the user:
- What changed in the PRD and/or blueprint
- New/closed issues
- Updated blocking relationships
- Suggested next step based on what stage the topic is in
