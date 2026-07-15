# Commit Plan — Phase 4 Execution Transition

**Date:** 2026-07-15  
**Planning doc:** `docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md` — Phase 4, item 1  
**Prefix convention:** `FE-FEAT-RH-AGENT-LATEST-ACTION-PH3`

---

## Commit 1 — Data model and service/store plumbing

**Commit message:**

```text
FE-FEAT-RH-AGENT-LATEST-ACTION-PH3: Add executedAt tracking and ID-based execution update

- Add optional executedAt timestamp to RhAgentOccurrenceDecision and parse it from Firestore.
- Replace query-based markExecutedBatch with direct ID-based markExecutedByIds to avoid a new composite index and stale-document writes.
- Add markExecutedForSymbols store method with optimistic update and rollback.
- Add activeOrderSymbols computed that returns accepted, current-run, unexecuted symbols.
- Surface EXECUTED status in group-store aggregation so status chips reflect execution.

Planning doc section: docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md — Phase 4, item 1
```

**Files to stage:**

```text
src/app/features/rh-agent/services/rh-agent.types.ts
src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts
src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts
src/app/features/rh-agent/stores/rh-agent-group.store.ts
```

---

## Commit 2 — Mark Executed UI and active order filtering

**Commit message:**

```text
FE-FEAT-RH-AGENT-LATEST-ACTION-PH3: Add Mark Executed actions and filter active order rows

- Add executed flag and markExecuted output to TradeRow.
- Add per-row Mark executed button / executed badge and disable controls for executed rows.
- Add header Mark Executed button to mark all enabled active rows at once.
- Switch order table sync to activeOrderSymbols() so executed rows drop out of the active order workflow.

Planning doc section: docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md — Phase 4, item 1
```

**Files to stage:**

```text
src/app/features/rh-agent/components/trade-row/trade-row.component.ts
src/app/features/rh-agent/components/trade-row/trade-row.component.html
src/app/features/rh-agent/components/trade-row/trade-row.component.scss
src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts
src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.html
```

---

## Commit 3 — Documentation

**Commit message:**

```text
DOCS-RH-AGENT-LATEST-ACTION-PH3: Update execution transition plan and thermo review

- Mark Phase 4 item 1 (Execution transition) as complete in the implementation plan.
- Add the thermo-nuclear review doc for this session, including findings, fixes, and approval.

Planning doc section: docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md — Phase 4, item 1
```

**Files to stage:**

```text
docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md
docs/reviews/2026-07-15-thermo-review-execution-transition.md
```

---

## Staging and commit commands

```bash
# Commit 1 — Data model and service/store plumbing
git add src/app/features/rh-agent/services/rh-agent.types.ts \
        src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts \
        src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts \
        src/app/features/rh-agent/stores/rh-agent-group.store.ts
git commit -m "FE-FEAT-RH-AGENT-LATEST-ACTION-PH3: Add executedAt tracking and ID-based execution update" -m "- Add optional executedAt timestamp to RhAgentOccurrenceDecision and parse it from Firestore." -m "- Replace query-based markExecutedBatch with direct ID-based markExecutedByIds to avoid a new composite index and stale-document writes." -m "- Add markExecutedForSymbols store method with optimistic update and rollback." -m "- Add activeOrderSymbols computed that returns accepted, current-run, unexecuted symbols." -m "- Surface EXECUTED status in group-store aggregation so status chips reflect execution." -m "" -m "Planning doc section: docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md — Phase 4, item 1"

# Commit 2 — Mark Executed UI and active order filtering
git add src/app/features/rh-agent/components/trade-row/trade-row.component.ts \
        src/app/features/rh-agent/components/trade-row/trade-row.component.html \
        src/app/features/rh-agent/components/trade-row/trade-row.component.scss \
        src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts \
        src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.html
git commit -m "FE-FEAT-RH-AGENT-LATEST-ACTION-PH3: Add Mark Executed actions and filter active order rows" -m "- Add executed flag and markExecuted output to TradeRow." -m "- Add per-row Mark executed button / executed badge and disable controls for executed rows." -m "- Add header Mark Executed button to mark all enabled active rows at once." -m "- Switch order table sync to activeOrderSymbols() so executed rows drop out of the active order workflow." -m "" -m "Planning doc section: docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md — Phase 4, item 1"

# Commit 3 — Documentation
git add docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md \
        docs/reviews/2026-07-15-thermo-review-execution-transition.md
git commit -m "DOCS-RH-AGENT-LATEST-ACTION-PH3: Update execution transition plan and thermo review" -m "- Mark Phase 4 item 1 (Execution transition) as complete in the implementation plan." -m "- Add the thermo-nuclear review doc for this session, including findings, fixes, and approval." -m "" -m "Planning doc section: docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md — Phase 4, item 1"
```

## Verification

```bash
npm run build -- --configuration development --no-progress
```

**Build status:** passes.
