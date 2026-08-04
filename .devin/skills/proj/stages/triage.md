# Stage: triage

Intake a bug or issue. Creates a tracked issue and links it to the appropriate Topic (or creates a new one if the bug is standalone).

## Inputs

- `description` — bug/issue description (from the `/proj triage "description"` command)

## Process

### 1. Gather context

Ask the user for:
- **Reproduction steps** — how to reproduce the bug
- **Expected vs actual behavior** — what should happen vs what does happen
- **Severity** — CRITICAL / HIGH / MEDIUM / LOW
- **Related Topic** — is this bug in an existing topic? If so, which one?

### 2. Create the bug issue

```bash
gh issue create --title "BUG: [Description]" --body "BODY" --label "bug"
```

Body should include:
- **Reproduction Steps**
- **Expected Behavior**
- **Actual Behavior**
- **Severity**
- **Environment** (browser, device, etc. if applicable)
- **Screenshots/Logs** (if available)

Capture the returned issue number as `BUG_NUMBER`.

### 3. Link to project

```bash
gh project item-add 1 --owner rinebob --url "https://github.com/rinebob/rel-str/issues/BUG_NUMBER"
```

Set project fields:
- Status → `Backlog` (option ID: `c98e776e`)
- Priority → based on severity (CRITICAL → P0, HIGH → P1, MEDIUM/LOW → P2)

### 4. Link to Topic (if applicable)

If the bug belongs to an existing Topic:
```bash
gh issue edit BUG_NUMBER --add-parent TOPIC_NUMBER
```

If the bug is standalone and significant enough to warrant its own Topic, suggest creating one with `/proj idea`.

### 5. Report

Tell the user:
- Bug issue number and URL
- Whether it's linked to a Topic or standalone
- Suggested next step: fix the bug with `/proj implement TOPIC_NUMBER BUG_NUMBER` (if linked) or `/proj idea "fix: description"` (if standalone)
