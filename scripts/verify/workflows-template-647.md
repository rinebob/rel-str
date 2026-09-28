# Verify Guide — workflows-template-647

Task #647 (Topic #625, Thread #626): workflow template + conventions doc.
Docs-only task — these checks are structural, no credentials or prod
services involved.

## Scripts

### `workflows-template-647.ts`

Verifies the workflow template + conventions doc, and optionally that a
workflow doc conforms to the template.

**Usage:**

```bash
npx tsx scripts/verify/workflows-template-647.ts [path-to-workflow-doc]
```

| Argument | Required | Values |
|---|---|---|
| `path-to-workflow-doc` | no | Path to a `WORKFLOW` doc to check for template conformance (e.g. `docs/topics/625-workflows/625-646-649-WORKFLOW-workflows-signal-review.md`). Omit to check the conventions doc only. |

**What it checks:**

- Conventions doc exists at `docs/topics/625-workflows/625-646-647-CONVENTIONS-workflows-trading-workflows.md`
- Conventions doc defines: the naming pattern (`625-{stage-issue-#}-{task-#}-WORKFLOW-workflows-{workflow-slug}.md`), doc-as-script model, `(manual)` tag, explicit `Feeds: none`, per-workflow Thread model
- Conventions doc embeds all template fields (`Purpose`, `When`, `Timebox`, `Inputs`, `Feeds`) and sections (`## Steps`, `## Exit criteria`, `## Parking lot`)
- With a workflow doc arg (fenced code blocks are ignored during parsing):
  - every template field present
  - `Feeds` non-empty or explicit `none`
  - each required section present **and non-empty**
  - ≥1 checkbox step — `- [ ]` or `- [x]` both count (ticking is allowed by the doc-as-script model)
  - every step names a destination after ` — ` (em/en-dash + text, the `(~n min)` estimate stripped first) or is tagged `(manual)`

**Pass:** `=== ALL CHECKS PASSED ===`, exit 0.
**Fail:** `FAIL` lines name the missing/malformed element, exit 1.

**Setup/teardown:** none — pure file reads.
