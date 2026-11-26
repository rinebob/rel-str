**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1741  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1667  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-25  

# UAT — #1667: remove hand-maintained topic grouping + bound page scroll to panes

## Scope

#1667 deleted the hand-maintained topic-grouping mechanism end-to-end
and fixed the page-level scrollbar:

- `TOPICS-INVENTORY.md` deleted; `getLifecycleTopicIndex` no longer
  reads any repo doc; `LifecycleTreeResponse` carries no `group`,
  `groupOrder`, or `groupingWarning`.
- FE: the grouped view, `sortMode`/`Grouped`↔`Issue #` pill, and the
  grouping warning banner are gone — the left pane is one flat list in
  issue-# ascending order; all-topics renders flat per-topic blocks.
- `/proj list --doc` excised from the proj skill docs.
- Scroll containment: `app-topic-viewer-page` now carries the
  workbench `:host` bound (`display: block; height: calc(100vh -
  var(--header-height, 0px))`) so the page never scrolls at shell
  level — vertical scroll lives only in the left topics list and the
  right tree-scroll region.

Task acceptance criteria:
1. `getLifecycleTopicIndex` reads no repo doc; the response carries no `group`, `groupOrder`, or `groupingWarning` fields.
2. All-topics renders flat per-topic sections in issue-# order — Issue-# mode is the only mode.
3. Zero live-code references to the deleted symbols (grep-pin spec).
4. Verify scripts green with group assertions removed.
5. DECISION doc exists (rationale + A–F seed map).
6. Scroll containment — scroll lives only in `.tree-scroll` (right) and `.topics` (left); `.tree-head` stays pinned.

Review-round fixes this UAT also confirms: two `fetchInventoryDoc`
fixture stubs deleted (issue-map-1695 test + verify), pin spec widened
to a recursive scan, stale `--doc` rows removed from proj skill docs.

## Prerequisites

- Repo checkout on `prod` with this task's uncommitted changes — the
  dev server serves the new FE directly.
- The dev server is already running at http://localhost:4200 — do NOT
  start a server, and do NOT open a browser for the tester beyond the
  step below that opens DevTools.
- The app session is already authenticated (the page calls the
  deployed callable `getLifecycleTopicIndex`, which reads the real
  rinebob/rel-str GitHub repo — the response currently still emits
  `group`/`groupOrder`, which S7 uses).
- Example data (all real, visible in the list today):
  - `#619 — Topic: GitHub read-only issue UI` — deepest tree
    (Threads #697, #1117-adjacent stages, #1609, ~30+ descendant issues)
  - `#553 — Topic: Paper Trading Infra` — deep tree
  - `#261 — Topic: Trading Indicator Library` — medium tree
  - `#137 — Topic: Strategy Manager` — medium tree
  - `#300 — Topic: Misc fixes, refactoring and improvements` — shallow
  - 52 open `Topic:` issues total — enough to overflow the left pane.
  - No closed `Topic:` issues exist today — the show-closed toggle's
    expected delta is zero items (see S6).
- S8 needs DevTools open (F12 → Network tab) — the only tooling need.

## Getting to the feature

Route: `tools/topic-viewer`. Entry point: app left nav → **Tools**
section → **Topic Viewer** (icon `account_tree`). Surface: two-pane
workbench — left = scrollable topic list with search box, show-closed
toggle, and all-topics toggle; right = topic tree pane with a pinned
header (topic title + expand/collapse controls) above a scrollable
tree region.

## Automated evidence (executed this session)

- `npx jest` (full suite) — **342 suites / 21,803 tests green**,
  including `shared/lifecycle-grouping-removed.spec.ts` (AC3 pin —
  recursive scan of ~700 `.ts` files × 19 banned symbols).
- `npx tsx --test tests/functions/gh-lifecycle/*.test.ts` — 123/123.
- `npm --prefix functions run typecheck` — clean; `tsc -p
  tests/tsconfig.json` — zero errors in swept files.
- Verify scripts `dev-tools-lifecycle-contracts-637`,
  `dev-tools-gh-lifecycle-639-fetch`, `dev-tools-gh-lifecycle-640-callable`,
  `dev-tools-gh-lifecycle-1635-index`, `dev-tools-gh-lifecycle-1636-topic-tree`
  — all PASS against live GitHub (`gh auth token` fallback), group
  assertions removed.
- `functions/scripts/verify/gh-lifecycle-issue-map-1695.ts` — 11/11
  (post-fix confirm).

## Scenarios

### S1 — Flat list, no grouping chrome (AC1/AC2 surface)
- **Confirms:** group machinery is gone from the UI.
- **Steps:** Open `tools/topic-viewer`. Look at the left pane and the
  page toolbar.
- **Expected:** the left pane is one continuous flat list of topic
  rows (issue number + title + stage chip). NO "Grouped | Issue #"
  toggle pill anywhere in the toolbar; NO group section headers like
  "Options & Spread Engine" or "Dev Tools & Infrastructure"; NO
  warning banner about a missing/stale inventory doc.
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

### S2 — Issue-# ascending order (AC2)
- **Confirms:** the only sort is issue-# ascending.
- **Steps:** In the left pane, read the issue numbers top to bottom.
  Toggle "Show closed" off and on and re-check the first few rows.
- **Expected:** strictly ascending issue numbers (e.g., `#26`, `#43`,
  `#77`, …) regardless of title; toggling show-closed only adds/removes
  closed rows, never reorders.
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

### S3 — Left-pane scroll containment (AC6)
- **Confirms:** the page never scrolls at shell level; only `.topics` scrolls.
- **Steps:** With the flat list loaded (52 open topics overflow the
  pane), scroll down inside the left list with the mouse wheel / trackpad.
- **Expected:** the topic list scrolls inside its own region; the page
  toolbar (search box, toggles) and the app header stay pinned; there
  is no scrollbar on the far right edge of the browser window for the
  page itself. Reaching the end of the list does not move the toolbar.
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

### S4 — Right-pane scroll containment + pinned tree head (AC6)
- **Confirms:** `.tree-head` is pinned; `.tree-scroll` owns right-pane scroll.
- **Steps:** Click topic `#619 — GitHub read-only issue UI`. Wait for
  its tree. Expand several nodes (or use the expand-all control in the
  tree header). Scroll the right pane.
- **Expected:** the header row (topic title, issue link, expand/collapse
  controls) stays pinned at the top of the pane while only the tree
  rows underneath scroll. The page toolbar never moves. No shell-level
  scrollbar appears.
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

### S5 — All-topics flat blocks (AC2)
- **Confirms:** all-topics mode renders flat per-topic blocks in issue-# order.
- **Steps:** Click the all-topics toggle (the control that previously
  switched between single-topic and all-topics view). Let blocks load.
- **Expected:** one block per topic, flat — no group section headers;
  blocks appear in issue-# ascending order; each block shows its own
  state (skeleton while loading, error+retry on failure, tree rows when
  ready). Blocks land progressively.
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

### S6 — Show-closed + query filter on the flat list
- **Confirms:** filters survived the flattening.
- **Steps:** (a) Type `paper` in the search box → the list narrows to
  `#553 — Topic: Paper Trading Infra` (and any other title match).
  (b) Clear, type `619` → `#619 — Topic: GitHub read-only issue UI`
  shows selected (digit query → deep resolution, #1696). (c) Clear,
  toggle "Show closed" on then off.
- **Expected:** text queries filter the flat list; `619` lands the
  deep-resolved topic; show-closed on/off changes nothing today — all
  52 topics are open (honest expectation: zero closed `Topic:` issues
  exist; the filter itself is pinned by specs).
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

### S7 — Deployed-superset backward compat
- **Confirms:** the FE works against the still-emitting deployed
  callable (pre-deploy contract shrink).
- **Steps:** F12 → Network tab → reload the page. Find the
  `getLifecycleTopicIndex` (or `getLifecycleTree`) callable request →
  Response. Confirm the JSON topics still carry `group` /
  `groupOrder` fields and/or a top-level `groupOrder` array (the
  deployed function predates this change). Observe the page.
- **Expected:** response contains the legacy group fields; the page
  renders the flat list with no grouping UI and no console errors —
  the FE ignores the superset. (After the next functions deploy these
  fields disappear; this scenario then verifies they're absent.)
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

### S8 — Regression: deep resolution + expansion (#1696)
- **Confirms:** the store flattening didn't break digit-query resolution.
- **Steps:** In the search box, type `1741` (this QA issue — a native
  child of #1667 → chain resolves to root #619). Then clear.
- **Expected:** the list resolves to `#619 — Topic: GitHub read-only
  issue UI` — its row shows selected, the right pane opens its tree,
  and the resolution note/path indicator appears per the #1696 design.
  Clearing the query returns the flat list.
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

### S9 — Empty + no-children states
- **Confirms:** edge states on the flat model.
- **Steps:** (a) Type a nonsense query like `zzzznothing` → empty
  state. (b) Clear, click a shallow topic such as `#300 — Topic: Misc
  fixes` (or whichever topic has few/no open descendants).
- **Expected:** (a) the list shows its empty state (no crash, no stale
  rows). (b) the tree pane shows the topic root with few or no children
  — no skeleton stuck, no error.
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

### S10 — Narrow viewport
- **Confirms:** containment holds at smaller widths.
- **Steps:** Resize the browser to ~900px wide. Repeat S3/S4 scrolling
  in both panes.
- **Expected:** same containment — panes scroll internally, toolbar and
  tree-head pinned, no shell-level page scrollbar.
- **Result:** ☑ PASS — user-confirmed 2026-11-25 (all UAT passes)

## Manual UI/UX refinement pass

- Visual hierarchy: flat list rows scan cleanly; stage chips render
  beside titles; selected row state visible.
- Spacing/density: no double scrollbars or nested scroll regions
  visible at pane boundaries.
- Keyboard: search box focuses and filters; row click selects.
- Loading states: all-topics skeletons resolve to trees; error blocks
  show retry.
- Consistency: pane borders/header heights match the sibling workbench
  pages (scanner, option-chain).
- **Result:** ☑ PASS — user-confirmed 2026-11-25

## Findings

None.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 — index emits no group fields | S1, S7 |
| AC2 — flat issue-# render (list + all-topics) | S1, S2, S5, S6 |
| AC3 — zero live-code refs (grep-pin) | Automated evidence (jest pin spec) |
| AC4 — verify scripts green | Automated evidence (637/639/640/1635/1636 PASS) |
| AC5 — DECISION doc | Doc exists at docs/topics/619-dev-tools/619-1634-1667-DECISION-DEV-TOOLS-remove-topic-grouping.md |
| AC6 — scroll containment | S3, S4, S10 |
| Regression — deep resolution / filters / edges | S6, S8, S9 |
| Deployed-superset compat | S7 |

## Regression / smoke

- `npx jest src/app/features/topic-viewer shared` — 65 suites / 16,687 green (pass-2).
- Nearby surfaces to eyeball: other workbench pages (scanner, option-chain)
  are unaffected — the `:host` rule is scoped to `app-topic-viewer-page`.
- `.devin/skills/proj/` docs: `/proj list` output should no longer
  mention `--doc` (skill docs swept); `board --doc` still works (separate flag).

## Verdict

**PASS** — S1–S10 + refinement pass user-confirmed 2026-11-25; automated gates green (jest 342/342, tsx 123/123, typechecks clean, verify 637/639/640/1635/1636/1695 PASS).

## Results log

- 2026-11-24 — Doc created; automated evidence recorded; S1–S10 + refinement pass handed to user.
- 2026-11-25 — User confirmed all scenarios pass. Functions deploy initiated by user (shrinks the wire contract — group/groupOrder/groupingWarning stop emitting).
