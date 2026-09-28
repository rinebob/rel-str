**Topic:** Trading Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Workflow Foundation  
**Thread Slug:** foundation  
**Issue:** #646  
**Thread Parent:** #626  
**Topic Parent:** #625  
**Task:** #647  
**Domain:** WORKFLOWS  
**Type:** Conventions  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# Workflow Template + Conventions

The shared format every **Trading Workflow** doc follows, plus the conventions for where workflow docs live, how they hand off, and how they're used during a session. Write new workflows by copying the skeleton below and filling every section.

## Conventions

### Where workflow docs live

All workflow docs live in `docs/topics/625-workflows/` and are named:

```text
625-{stage-issue-#}-{task-#}-WORKFLOW-workflows-{workflow-slug}.md
```

`{stage-issue-#}` is the Blueprint issue the task lives under (e.g., `646`), `{task-#}` is the task that wrote the doc (e.g., `649` → `625-646-649-WORKFLOW-workflows-signal-review.md`), and `{workflow-slug}` is the lowercase-hyphenated workflow name (`signal-review`, `order-placement`, …). Other workflow-system docs (run-sheets, this conventions doc) use their own doc-type segment (`RUNSHEET`, `CONVENTIONS`) in the same position.

### How workflows are organized

Each workflow gets its own **Thread** under Topic #625 — create it with `/proj add-thread 625`. The workflow doc is that Thread's primary deliverable; the Thread also carries any refinements the workflow picks up in real use.

### Doc-as-script usage model

A workflow doc is a **script, not a ledger**. During a session it sits open in an editor tab beside the app; you follow it top to bottom. Checkboxes are optional scaffolding — tick them or don't. No per-session copies, no persisted session state, no daily ritual. If literal progress-tracking turns out to matter, that gap is evidence for the deferred checklist UI — not something to hack around with doc edits.

### `Feeds:` — the handoff convention

Workflows chain. A workflow's `Feeds:` field names the downstream workflow(s) that consume its output, and the exit criteria state *what* gets handed off (e.g., "order candidates flagged for order placement"). If a workflow hands off to nothing, write `**Feeds:** none` — never omit the field; an explicit `none` means "I checked", an absent field means "nobody thought about it".

### `(manual)` — the degraded-step tag

A step that has no app surface yet (e.g., option-spread position-type selection) is tagged `(manual)` and describes the manual procedure in place of a screen reference. The tag doubles as a backlog marker: removing `(manual)` tags is how a workflow doc tracks features landing.

### Timeboxes

Every workflow carries a `**Timebox:**` total; steps carry rough minute estimates. Timeboxes start as estimates and are tuned by real use — when you blow a timebox, note it in the doc's parking lot and revise the estimate later. The timebox's job is to make rabbit-holing *visible*, not to be a hard cutoff.

### Inventory ownership

The Session Run-Sheet carries the workflow inventory/status table. Update it when a workflow doc is written, materially revised, or retired — whoever changes a workflow updates the table in the same change.

---

## The Template

Copy this skeleton verbatim into a new workflow doc, then fill every section:

```markdown
# {Workflow Name}

**Purpose:** {one sentence — what running this accomplishes}  
**When:** {trigger + cadence — e.g. "daily, after the detection run completes"}  
**Timebox:** {total budget, e.g. 30 min}  
**Inputs:** {what must exist before starting — data, prior workflow output, preconditions}  
**Feeds:** {downstream workflow(s) this hands off to, or "none"}  

## Steps

- [ ] {action} — {app screen/route, or `(manual)` + procedure} (~{n} min)
- [ ] ...

## Exit criteria

- [ ] {what "done" means — including what gets handed off via Feeds}

## Parking lot

{free-form — capture stray thoughts/ideas mid-workflow without acting on them}
```

## Section guide

| Section | What goes in it |
|---|---|
| **Purpose** | One sentence. If you need two, the workflow is probably two workflows. |
| **When** | Trigger + cadence. Daily routines name their slot in the day; event-driven workflows name the trigger ("when signal review hands off candidates"). |
| **Timebox** | Total session budget for the workflow. |
| **Inputs** | Preconditions: what data/output must exist, where to look if it's missing. |
| **Feeds** | Downstream workflow names (or `none`). This is the edge in the workflow graph. |
| **Steps** | Ordered, checkable actions. Each names *where* the action happens — an app screen/route — or is tagged `(manual)`. Minute estimates per step. The ` — destination (~n min)` separator form is what the conformance checker looks for — keep it. |
| **Exit criteria** | Verifiable end state, including the handoff artifact for `Feeds:` workflows. |
| **Parking lot** | The anti-distraction pressure valve — stray thoughts go here, get acted on *after* the workflow. |
