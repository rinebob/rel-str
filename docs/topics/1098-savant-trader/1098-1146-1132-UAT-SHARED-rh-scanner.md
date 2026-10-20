# UAT — #1132 st-scanner collection paths + rules

**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1146  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1132  
**Domain:** SHARED  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

## Scope

Task [#1132](https://github.com/rinebob/rel-str/issues/1132) — canonical
`st-scanner` Firestore paths and the rules block for the proposals anchor.
No runtime scanner behavior, no UI, no deployment.

## Acceptance criteria (task body)

1. `ST_SCANNER_ROOT`, `stScannerProposalsPath()`,
   `stScannerProposalDocPath(id)` added to `shared/st-collections.ts`.
2. `firestore.rules` gains `match /st-scanner/{anchor}/items/{docId}`:
   authenticated read; create/update/delete gated to
   `anchor == 'proposals'`.
3. Focused unit specs covering path values and odd/even segment parity.

## Refinement

Not applicable — no user-facing surface.

## Prerequisites

- Repo root `C:\aa\projects\rel-str`, node_modules installed.
- No live services needed — paths are constants; rules are a static file
  (deploy rides with the next rules deploy, not this task).

## Scenarios

### 1. Unit specs — path shapes + segment parity

```powershell
npx jest shared/st-collections.spec.ts
```

Expected: suite green (21 tests). The `st-scanner anchored paths`
describe pins `st-scanner/proposals/items` (odd segment count →
collection path) and `st-scanner/proposals/items/prop-1` (even → doc
path); `ANCHORED_ROOTS` guards `st-scanner` single-segment/`st-` prefix.

### 2. Registered verification relay — every canonical root + helper

```powershell
npx tsx scripts/verify/data-pipeline-st-collections-997.ts
```

Expected: `=== ALL CHECKS PASSED ===` including 13 scanner/config checks —
root, anchor, items path + odd parity, doc path + even parity, all four
scanner value exports through the functions barrel, and `stConfigDocPath`.

### 3. Functions typecheck — barrel re-export compiles

```powershell
cd functions && npm run typecheck
```

Expected: clean. Proves `export type { StScannerKind }` and the four
value re-exports resolve correctly under `isolatedModules`.

### 4. Rules block — static verification

```powershell
Select-String -Path firestore.rules -Pattern 'st-scanner' -Context 0,3
```

Expected: `match /st-scanner/{anchor}/items/{docId}` inside
`match /databases/{database}/documents`, before the default deny;
`allow read: if request.auth != null`;
`allow create, update, delete: if anchor == 'proposals' && request.auth != null`.
Negative boundary (no emulator run): other anchors are read-only,
unauthenticated reads denied, anchor docs + deeper subcollections fall
through to default deny — verified structurally; live rules behavior
awaits the next `firebase deploy --only firestore:rules`.

### 5. No cross-domain drift — scanner files are the whole diff

```powershell
git diff --name-only main...HEAD  # or working tree inspection
```

Expected: diff is limited to `shared/st-collections.ts`,
`shared/st-collections.spec.ts`, `firestore.rules`,
`functions/src/common/st-collections.ts`,
`scripts/verify/data-pipeline-st-collections-997.{ts,md}` plus this doc.
No paper-trading/gallery/analysis files touched by this task.

## Traceability

| Task AC | Scenario |
|---|---|
| AC1 — root + path helpers | 1, 2, 3 |
| AC2 — rules block | 4 |
| AC3 — spec coverage | 1 |
| barrel re-export (review-added) | 2, 3 |
| registered relay stays true | 2 |

## Results log

Executed 2026-10-19 — all scenarios PASS (fresh evidence):

1. `npx jest shared/st-collections.spec.ts` → **21/21 passed** (3.9s).
   `st-scanner` anchored-paths describe + `ANCHORED_ROOTS` guard green.
2. `npx tsx scripts/verify/data-pipeline-st-collections-997.ts` →
   **ALL CHECKS PASSED** — scanner root/anchor/items/doc paths, segment
   parity, all four barrel re-exports (`barrel scanner root/anchor/items
   path/doc path`), `stConfigDocPath` + parity.
3. `cd functions && npm run typecheck` → **clean** (`tsc --noEmit`,
   exit 0) — barrel `export type { StScannerKind }` + value re-exports
   compile under `isolatedModules`.
4. `firestore.rules:466-469` — match block verbatim as specified:
   authed read; `create/update/delete` gated to `anchor == 'proposals'`;
   inside `documents` block, before default deny. Negative boundary
   confirmed structurally (non-proposals anchors read-only; unauth
   denied; anchor docs + deeper paths → default deny). Live rules
   behavior awaits the next rules deploy — flagged, not a blocker.
5. Task diff footprint confirmed scoped: `shared/st-collections.ts`,
   `shared/st-collections.spec.ts`, `firestore.rules`,
   `functions/src/common/st-collections.ts`,
   `scripts/verify/data-pipeline-st-collections-997.{ts,md}` — no
   cross-domain files touched. (Working tree contains other sessions'
   files — unrelated, out of scope.)

**Verdict: PASS — QA issue #1146 eligible for closure.**
