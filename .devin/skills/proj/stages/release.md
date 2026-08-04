# Stage: release

Snapshot the changelog and produce a release summary.

## Inputs

- No required inputs. Optional: a date or tag to scope the release.

## Process

### 1. Gather completed topics

Query the project for items with Status = `Done`:

```bash
gh project item-list 1 --owner rinebob --format json
```

Filter for items closed since the last release. If no previous release exists, include all Done items.

### 2. Read the changelog

Read `docs/CHANGELOG.md` if it exists. Identify the last release date or tag.

### 3. Compile the release summary

Create `docs/releases/RELEASE-{YYYY-MM-DD}.md` with:

```markdown
# Release: YYYY-MM-DD

## Topics Shipped
- Topic #N: [Title] — [brief summary]
- Topic #N: [Title] — [brief summary]

## Tasks Completed
- Task #N: [Description] (AREA)
- Task #N: [Description] (AREA)

## Bugs Fixed
- #N: [Description]
- #N: [Description]

## Notes
[Any deployment notes, migration steps, or breaking changes]
```

### 4. Tag the release (optional)

If the user wants a git tag:
```bash
git tag -a vYYYY.MM.DD -m "Release: YYYY-MM-DD"
git push origin vYYYY.MM.DD
```

### 5. Report

Tell the user:
- Release doc path
- Number of topics, tasks, and bugs in this release
- Git tag (if created)
