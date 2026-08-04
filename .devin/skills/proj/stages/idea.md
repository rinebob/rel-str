# Stage: idea

Capture a raw idea. Creates a Topic issue + Idea issue in GitHub.

## Inputs

- `description` — short description of the idea (from the `/proj idea "description"` command)
- Any additional context the user provides in conversation

## Process

### 1. Gather context

Ask the user for any supporting material, links, references, or open questions they have about the idea. Don't rush — collect enough to write a useful issue body.

### 2. Create the Topic issue

The Topic is the top-level container for the entire feature. It stays open across all lifecycle stages.

```bash
gh issue create --title "TOPIC: Description" --body "BODY" --label "topic"
```

Body should include:
- **Summary** — one-paragraph description
- **Motivation** — why this matters
- **Open Questions** — bullet list of unresolved questions
- **Supporting Material** — links, references, screenshots

Capture the returned issue number as `TOPIC_NUMBER`.

### 3. Create the Idea issue

The Idea issue is the child of the Topic and captures the raw thinking.

```bash
gh issue create --title "IDEA: Description" --body "BODY" --label "idea" 
```

Set parent:
```bash
gh issue edit IDEA_NUMBER --add-parent TOPIC_NUMBER
```

### 4. Link both to the project

```bash
gh project item-add 1 --owner rinebob --url "https://github.com/rinebob/rel-str/issues/TOPIC_NUMBER"
gh project item-add 1 --owner rinebob --url "https://github.com/rinebob/rel-str/issues/IDEA_NUMBER"
```

### 5. Set project fields

For the Topic issue:
- Status → `Idea` (option ID: `540f02c8`)
- Priority → ask user (P0/P1/P2)
- Size → ask user (XS/S/M/L/XL) or leave unset

For the Idea issue:
- Status → `Idea` (option ID: `540f02c8`)
- BE Status → `Not Started` (option ID: `9de4dd6a`)
- FE Status → `Not Started` (option ID: `edc6a799`)
- SHARED Status → `Not Started` (option ID: `7e98ca45`)

Use the common patterns from SKILL.md to find item IDs and set fields.

### 6. Create a docs directory

Create `docs/implementations/TOPIC-{NUMBER}_idea.md` with the full idea content — this is the living document that will grow through plan → blueprint → implement → ship.

### 7. Report

Tell the user:
- Topic issue number and URL
- Idea issue number and URL
- Suggest next step: `/proj plan TOPIC_NUMBER`
