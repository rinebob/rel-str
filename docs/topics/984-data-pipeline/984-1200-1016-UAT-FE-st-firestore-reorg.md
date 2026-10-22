**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1200  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1016  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# UAT — #1016 FE review-list UI removal

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1 Persistence layer gone (automated) | PASS | grep: zero live `TriageService`/`ST_REVIEW_LIST`/`savant-trader/data/review-list` refs in `src/` (comments/spec pins only); `triage.service.ts` deleted; rules ACL removed, global deny `firestore.rules:601-603`; pin spec asserts `ST_REVIEW_LIST` absent |
| S2 Focused + full test suite | PASS | 62/62 focused suites post-round-2; full suite 257 suites / 4,372 tests all pass; `tsc` clean on touched files |
| S3 Signal Review — flag UI disabled | PASS | user-verified 2026-10-22: flag button greyed, Review 0 pill + clear-flags disabled |
| S4 Signal Review — screening statuses still work | PASS | user-verified: WATCH/CONSIDER functional (ephemeral) |
| S5 Chart Review — browse sidebar populated | PASS | user-verified: sidebar lists union of list members in browse mode |
| S6 Chart Review — disabled controls + labels | PASS | user-verified: toggle + new-symbols disabled, 'From list' label, Watch shows selected state |
| S7 No console Firestore errors | PASS | user-verified: clean on both pages |
| S8 Rules deny-by-default on review-list | NOTED | static verification only — takes effect at next `firebase deploy --only firestore` (ship step); no client can write today because the only writer was deleted |

## Scope

- Remove every FE reader/writer of `savant-trader/data/review-list`
  (`TriageService`, `Collection.ST_REVIEW_LIST`, rules ACL, all store
  persistence calls).
- No functional "needs review" UI — flag button, Review pill,
  clear-flags, viewport signals/browse toggle, and new-symbols flow are
  **disabled** (user override: pages retained for repurpose, controls
  disabled not deleted).
- Chart Review must remain usable in browse mode — the `'ALL'` filter now
  shows the union of all list members (was the permanently-empty flagged
  queue).
- CONSIDER/WATCH ephemeral screening unaffected; Watch button must show
  its selected state (round-2 fix).

## Prerequisites

- Repo at `prod` with the uncommitted #1016 working tree.
- Dev server running: `npm start` → http://localhost:4210 (already up).
- No special credentials beyond the app's normal Firebase/RH session.

## Start instructions

- Signal Review page: http://localhost:4210/signals/review
- Chart Review page: http://localhost:4210/signals/charts
- DevTools console open to catch Firestore permission errors.

## Scenarios

### S1 — Persistence layer gone (automated, already executed)

- `grep -rn "TriageService\|ST_REVIEW_LIST\|savant-trader/data/review-list" src/`
  → every hit is a `#1016` comment or spec assertion. **PASS**
- `ls src/app/features/savant-trader/services/triage.service.ts` → absent. **PASS**
- `firestore.rules` — no review-list match block; `match /{document=**}
  allow read, write: if false` at :601-603 covers it. **PASS**
- `firestore.indexes.json` — no review-list index. **PASS**
- `st-path-cutover-1014.spec.ts` asserts `'ST_REVIEW_LIST' in Collection
  === false` (re-introduction fails the suite). **PASS**

### S2 — Test suite (automated, already executed)

- Full `npx jest`: 257 suites / 4,372 tests, all pass.
- Focused post-remediation: 62/62 (triage.store, group.store, viewport,
  facade, signal-review component, cutover pin).
- `tsc --noEmit` clean on all touched files.

### S3 — Signal Review: flag UI disabled (user)

1. Navigate to `/signals/review` with a run loaded.
2. On any symbol row, hover the bookmark/flag icon in the ACR action
   cluster.
3. **Expected:** button is greyed out and does not respond to clicks.
4. **Expected:** header shows a greyed "Review 0" pill (never a count >
   0) and the clear-flags control is disabled.
5. Result: ____

### S4 — Signal Review: screening statuses still work (user)

1. On a symbol row, click the **WATCH** (eye) ACR button.
2. **Expected:** button shows selected state; no console errors.
3. Click **CONSIDER** if present; same expectation.
4. **Expected:** statuses are ephemeral — refresh the page and they clear
   (this confirms they are NOT hitting review-list persistence).
5. Result: ____

### S5 — Chart Review: browse sidebar populated (user)

1. Navigate to `/signals/charts`.
2. **Expected:** page opens in browse mode (no toggle pressed state).
3. **Expected:** left sidebar lists symbols — the union of all list
   members — NOT an empty panel. (Before the fix this was the
   permanently-empty flagged queue.)
4. Select different lists in the sidebar list dropdown; members update.
5. Result: ____

### S6 — Chart Review: disabled controls + labels (user)

1. **Expected:** viewport signals/browse toggle button is greyed out,
   tooltip reads "View mode toggle disabled — flag queue removed".
2. **Expected:** new-symbols button is greyed out.
3. With a sidebar symbol selected, header shows "From list" (not
   "Queued for review").
4. Click the **Watch** (eye) button on the selected symbol.
   **Expected:** the button shows its selected state (round-2 fix —
   ephemeral WATCH now merges into the status feed).
5. Result: ____

### S7 — No console errors (user)

1. With DevTools open, reload both review pages and click around.
2. **Expected:** no Firestore `permission-denied` or missing-`TriageService`
   errors. Zone.js `NG0914` warnings are pre-existing noise, ignore.
3. Result: ____

### S8 — Rules deny-by-default (noted)

Static verification only: the review-list ACL was removed and the global
`{document=**}` deny covers the path. The deleted `TriageService` was the
only client writer, so no request can originate from the FE today. The
rules file deploys with the next `firebase deploy --only firestore` at
ship time; backend data deletion is #1013. No executable check required.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| All readers/writers of review-list removed | S1, S2, S8 |
| No dead needs-review UI (disabled per override) | S3, S5, S6 |
| Pages remain functional for repurpose | S4, S5, S7 |
| Chart-review browse default usable (round-1 major) | S5 |
| Watch selected-state + "From list" label (round-2) | S4, S6 |
| Pin spec guards re-introduction | S1, S2 |

## Regression / smoke

- CONSIDER/WATCH row markers still render on signal-review (S4).
- Symbol lists dropdown still loads lists (S5).
- Durable ACCEPT/REJECT flow unaffected — `occurrence-decisions` writes
  removed only in #1017 (separate task); ACR buttons still emit through
  the facade (S4 covers WATCH; ACCEPT/REJECT are durable paths unchanged
  by this task).
