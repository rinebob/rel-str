**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1618  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1532  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# UAT — #1532 FE page controls (search, sort, all-topics, Labels, chips)

## Scope

Page slice of Blueprint #1521, over the shipped #1531 store — header
controls (search input + match-count badge, Grouped|Issue # pill
toggle, All-topics checkbox, disabled Labels button placeholder for
#1533), left pane on the `visibleTopics` union (grouped sections or
flat list), stage chip replacing the dot, all-topics right pane via the
tree's `rows` input, `.match` highlight on query hits, shared
`_stage-chips.scss` palette. Header order per owner: repo picker,
refresh, as-of, search, sort pills, Labels, all-topics, show-closed.

Task acceptance criteria:
1. All controls work at ~1024px; search filters list + highlights tree hits.
2. Stage chip (full label, color-coded) replaces the dot on topic rows.
3. Long titles ellipsis; chips never leave the row.
4. TestBed specs with fixture response.

Review-round fixes this UAT also confirms (the gate's two majors):
5. Query hits highlight + auto-expand across **every** all-topics tree
   (`matchInfo` scope = rendered trees), not just the selected one.
6. Match-count badge only appears with a real match surface
   (selected topic or all-topics) — never "0 matches" over a filtered
   list.
7. Clicking a topic in all-topics mode expands additively — other
   trees keep their expansion.
8. Empty panes are query-aware: `No topics match "{q}"` not
   "No Topics found in this repo".

## Prerequisites

- Repo checkout on `prod` with the #1532 working-tree changes.
- Dev server already running at `http://localhost:4200` (verified
  this session — page loaded live data post rate-limit refill).
- No seed data needed — the page reads live GitHub via the deployed
  `getLifecycleTree` callable.

## Getting to the feature

Route: `/tools/topic-viewer`. Entry point: app nav → **Topic Viewer**
link. Surface: repo picker + control header, grouped topic list left,
selected topic's tree right.

## Automated evidence (executed this session, post-remediation diff)

- `npx jest src/app/features/topic-viewer/` — **4 suites / 76 specs
  green** (44 store incl. 3 new all-topics match/expansion, 8 service,
  15 page, 9 tree).
- `npx jest --coverage=false` — **324 suites / 6,087 tests green**.
- `npx tsc -p tsconfig.app.json --noEmit` — **clean**.

## Scenarios

### S1 — Page-level spec coverage (the ACs' behavioral proof)

- **Confirms:** AC2, AC4 + badge gate, empty-copy, all-topics wiring.
- **Steps:** `npx jest src/app/features/topic-viewer/topic-viewer-page.component.spec.ts`
- **Expected:** all specs pass — controls forward to store stubs,
  `visibleTopics` union renders both modes, stage chip present + dot
  absent, badge gated on query+surface, pluralization, all-topics
  pane + empty + query-aware copy, `.match` on all-topics tree rows.
- **Result:** ☑ PASS — part of the 76/76 run (2026-11-18).

### S2 — Store in-gate specs (the review majors)

- **Confirms:** AC5–AC7 — match scope spans rendered trees,
  descendant-only query yields honest 0, additive expansion seed.
- **Steps:** `npx jest src/app/features/topic-viewer/topic-viewer.store.spec.ts -t "all-topics"`
- **Expected:** the three new specs pass alongside the existing
  all-topics block.
- **Result:** ☑ PASS — 44/44 store specs green (2026-11-18).

### S3 — Full-suite regression + typecheck

- **Confirms:** no blast radius (store `matchInfo`/`selectTopic`
  changes touch shared surfaces used by every topic-viewer consumer).
- **Steps:** `npx jest --coverage=false`; `npx tsc -p tsconfig.app.json --noEmit`
- **Expected:** suite green, no type errors.
- **Result:** ☑ PASS — 6,087/6,087 + clean (2026-11-18).

### S4 — Live smoke: default view + controls (user-run, ~60s)

- **Confirms:** AC1 + header order + regression on the shipped page
  (doubles as the deferred #1531 S6 superset).
- **Steps:** open `http://localhost:4200/tools/topic-viewer` → wait for
  fetch → confirm header order: repo picker, Refresh, as-of, search,
  Grouped|Issue # pills, Labels (disabled), All topics, Show closed →
  click a topic → expand/collapse a caret → toggle Show closed.
- **Expected:** grouped list + tree as before; stage chip shows the
  full label (e.g. `5_IMPLEMENT`) color-coded where the dot was; no
  console errors.
- **Result:** ⊘ WAIVED — owner decision 2026-11-18 (ship before
  the caching thread #1609; folds into the post-cache live smoke).
  **Partial live evidence:** owner viewed the new controls rendered on
  live data this session ("i see the new ui elements looks good") and
  directed the header reorder — elements, chips, and layout confirmed
  working pre-reorder; the post-reorder layout is a DOM-order-only
  change not separately eyeballed.

### S5 — Live smoke: search + sort + all-topics (user-run, ~60s)

- **Confirms:** AC1–AC3, AC5–AC8 end-to-end on live data.
- **Steps:** type `impl` in search → left list filters, match-count
  badge appears with a topic selected; note hits highlight + ancestors
  auto-expand → clear search (expansion restores) → click **Issue #**
  (flat list, no section headers) → back to **Grouped** → check
  **All topics**: every section + its trees render; with `impl`
  typed, hits highlight across *multiple* trees, not just one → click
  a topic in the left list while all-topics is on: other trees stay
  expanded → narrow the window to ~1024px: controls wrap without
  clipping.
- **Expected:** per AC; badge shows e.g. "N matches" only with a
  selection or all-topics on; a nonsense query (`zzz`) shows
  `No topics match "zzz"` not "No Topics found in this repo".
- **Result:** ⊘ WAIVED — owner decision 2026-11-18 (same basis
  as S4; the search/sort/all-topics behaviors are spec-pinned in S1/S2
  and get their live pass with the post-cache smoke).

## Manual UI/UX refinement pass

- S4/S5 above double as the refinement pass: chip legibility vs the
  old dot, control spacing/wrap at ~1024px, highlight tint visibility
  across section trees, disabled-button affordance.
- **Result:** ⊘ WAIVED — with S4/S5 (partial live evidence as
  noted in S4).

## Findings

None yet.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 controls at ~1024px + search filters/highlights | S1, S4, S5 |
| AC2 stage chip replaces dot | S1, S4 |
| AC3 ellipsis + chips stay in row | S1 (DOM classes), S5 (visual) |
| AC4 TestBed specs w/ fixture | S1 |
| AC5 match scope spans all-topics trees | S2, S5 |
| AC6 badge honest (match surface gate) | S1, S5 |
| AC7 additive selectTopic expansion | S2, S5 |
| AC8 query-aware empty copy | S1, S5 |

## Regression / smoke

- `npx jest --coverage=false` — 6,087/6,087 (2026-11-18).
- Single-topic tree path untouched in shape — existing tree specs green.

## Verdict

PASS — S1–S3 green (76/76 focused, 6,087/6,087 suite, tsc clean);
S4/S5 + refinement pass waived by owner with partial live evidence
(controls confirmed rendered on live data pre-reorder); post-cache
smoke covers the remaining live checks.

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-11-18 | #1532 | devin | S1–S3 PASS | 76/76 focused, 6,087/6,087 suite, tsc clean |
| 2026-11-18 | #1532 | devin | S4/S5 WAIVED | owner decision — post-cache smoke covers; partial live evidence |
