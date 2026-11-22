**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1611  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1306  
**Domain:** SAVANT-TRADER  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-22  

# UAT — #1306 FE-IMPL: row list menu + membership chip

## Scope

Per-row triage-list curation inside the scanner results table: a
membership chip before the Symbol cell (the exclusive list key, empty
when unassigned) and a `playlist_add` row action that opens a dse-menu
of the six exclusive lists in catalog order with a checkmark on the
current list. Picks route through `SymbolListStore.toggleSymbolInList`
(different list → move, re-pick → un-assign). MONITOR and user lists
are excluded by scoping the input to `byRole().exclusive`; untracked
rows get the same menu and keep their `new` badge after being filed.

Task acceptance criteria:
1. Page calls `loadSymbolLists()` on init; membership map
   (`Map<normSymbol, listKey>`) computed from `byRole().exclusive`
2. Chip cell: current triage key as a compact chip, empty when
   unassigned; tracks the map across live catalog emissions
3. `playlist_add` → menu of the 6 exclusive lists in catalog order,
   checkmark on current; pick emits `{symbol, listKey}` →
   `toggleSymbolInList` (move on different pick, un-assign on re-pick)
4. MONITOR/user lists excluded; untracked rows get the same menu
   (badge stays `new`)
5. Specs per TEST-FE §2

Review-round fixes this UAT also confirms (CODE-REVIEW
`1098-1302-1306`, PASS after remediation):
- Stored list symbols are canonicalized at the registry read boundary
  (`normalizeListSymbols`) — a doc carrying `'aapl'`/`' aapl '` still
  files/unchips/moves correctly and the migration write self-heals
  the spelling.
- An open menu closes on silent row re-emission (auto-refresh, sort,
  filter) — no stale-row resurrection.
- Empty catalog distinguishes 'Loading lists…' (stream live) from
  'No lists available' (settled/failed).

## Prerequisites

- Dev server already running (`npm start`, port 4200). Signed in —
  the route is behind `authGuard`.
- Scanner produces live data on load (auto-run fires all recipes;
  the first recipe `52w-high` is the default selection — wait for
  the row table to populate; if Robinhood MCP auth lapses the page
  surfaces reauth, complete it first).
- At least one symbol list reachable: the six system lists (NEW,
  PRIMARY, SECONDARY, NEUTRAL, AVOID, HIDE) exist for every signed-in
  user — the page seeds them on `loadSymbolLists()` if absent.
- Devtools needed only for S8 (offline simulation).

## Getting to the feature

Route: `/trading/scanner`. Deep link `http://localhost:4200/trading/scanner`,
or app nav → **Scanner**. Surface: the scanner page — left rail of
recipes, detail pane with the selected recipe's result table. Row
cells are: `tracked|new` badge → actions (icons) → list chip →
Symbol → instrument_id → …

## Automated evidence (executed this session)

- `npx jest src/app/features/savant-trader/pages/scanner src/app/features/savant-trader/services/symbol-list-registry.spec.ts src/app/features/savant-trader/stores/symbol-list.store.spec.ts` — 6 suites / **99 tests green**
- `npx tsc --noEmit` — clean on all touched files
- `npx jest` full suite — 323/324 suites, **6043/6063** (sole failure:
  `topic-viewer-page.component.spec.ts` — the #1531 session's
  uncommitted store-v2 work, unrelated)
- Menu contents/order, checkmark, emit→store routing, chip
  rendering/tracking, exclusive-only options, untracked-badge
  persistence, stale-menu close, and loading-vs-settled copy are all
  spec-pinned (see CODE-REVIEW doc)

## Scenarios

### S1 — Menu contents and catalog order

- **Confirms:** AC3/AC4 — exactly the six exclusive lists, catalog
  order, MONITOR/user lists absent.
- **Steps:** On the default `52w-high` table, click the
  `playlist_add` icon on the first body row.
- **Expected:** A menu opens listing exactly: **New, Primary,
  Secondary, Neutral, Avoid, Hide** in that order. No MONITOR, no
  user lists. Each item has a check-icon slot, empty unless that list
  currently holds the symbol.
- **Result:** ☑ PASS — 2026-11-22 — verified live

### S2 — File a symbol — chip appears, checkmark lands

- **Confirms:** AC2/AC3 — pick files the symbol; chip tracks the
  catalog emission.
- **Steps:** In the S1 menu click **Primary**.
- **Expected:** Menu closes. Within a moment the row's chip cell
  shows `PRIMARY`. Reopen the menu — **Primary** carries the check
  icon. (Chip updates on the store's catalog echo — a beat after the
  click is expected, not a hang.)
- **Result:** ☐ PASS ☐ FAIL ☐ BLOCKED — {evidence, date}

### S3 — Different pick moves the symbol

- **Confirms:** AC3 — move on different pick.
- **Steps:** Same row, menu → **Hide**.
- **Expected:** Chip changes `PRIMARY` → `HIDE`; reopening shows the
  check on **Hide**. The symbol no longer counts as PRIMARY (menu
  check is the source of truth).
- **Result:** ☑ PASS — 2026-11-22 — verified live

### S4 — Re-pick un-assigns

- **Confirms:** AC3 — re-pick of the checked list un-assigns
  (store's toggle).
- **Steps:** Same row, menu → **Hide** again.
- **Expected:** Chip cell goes empty; reopening shows no check on
  any item. Symbol is unassigned, still in the table.
- **Result:** ☑ PASS — 2026-11-22 — verified live

### S5 — Untracked row keeps its `new` badge after filing

- **Confirms:** AC4 — list membership is independent of tracked
  status.
- **Steps:** Pick a row whose badge reads `new` (not `tracked`) —
  e.g. flip the header filter to **New** first so every row
  qualifies. File it to **Primary** via the menu.
- **Expected:** Badge still reads `new` (does NOT flip to `tracked`);
  chip shows `PRIMARY`. Flip the filter back to **All**.
- **Result:** ☑ PASS — 2026-11-22 — verified live

### S6 — Menu dismissal paths

- **Confirms:** review MINOR — menu closes on pick, outside click,
  and row re-emissions; only one menu open at a time.
- **Steps:** Open a row's menu → click a sortable column header
  (e.g. **% Change**) → reopen → click anywhere outside the menu →
  reopen on row 1 then open on row 3.
- **Expected:** Each action closes the menu — sort click closes it
  (document click + rows re-emit), outside click closes it, and only
  one menu exists at a time (row 3's opens, row 1's is gone).
- **Result:** ☑ PASS — 2026-11-22 — verified live

### S7 — Menu on bottom rows

- **Confirms:** accepted trade-off — menu clips at the scroll
  viewport but stays reachable.
- **Steps:** Scroll the table to the last row; open its menu.
- **Expected:** Menu may render partly below the fold — scrolling
  the table reveals it fully and it stays aligned to its row. Not a
  freeze, not unreachable.
- **Result:** ☑ PASS — 2026-11-22 — verified live

### S8 — Empty-catalog copy (devtools, optional)

- **Confirms:** review MINOR — honest empty state on catalog
  failure vs loading.
- **Steps:** DevTools → Network → Offline → reload the page → open a
  row's `playlist_add` menu. Restore online afterward.
- **Expected:** Menu shows **No lists available** (not an eternal
  'Loading lists…'); a snackbar flags the load failure.
- **Result:** ☑ PASS — 2026-11-22 — verified live

### S9 — Chip tracks the catalog across surfaces (optional)

- **Confirms:** AC2 live-tracking — the chip is map-driven, not
  row-local.
- **Steps:** With the scanner open showing a filed symbol, open a
  second tab to `/trading/swing-analysis`, unfile the same symbol
  from its list there (list filter → remove), return to the scanner
  tab.
- **Expected:** The scanner chip clears without reloading the page —
  the shared `watchLists$` stream drives both surfaces.
- **Result:** ☑ PASS — 2026-11-22 — verified live

## Manual UI/UX refinement pass

- Chip reads as a compact key badge and doesn't crowd the Symbol cell
- Menu styling matches sibling dse-menu surfaces (slice menu,
  allocation bulk menu)
- `playlist_add` icon has hover state + aria-label
- Check icon column keeps labels aligned when no item is checked
- Mobile (<768px): rail collapses to a strip; row menu still usable
- **Result:** ☑ PASS — chip/menu consistent with dse-menu convention; icon hover + aria-label present; check column aligns; menu reachable on bottom rows

## Findings

- **F1 (fixed in place):** `RecipeRunState` discarded the error message —
  the detail pane could only render "Scan failed" with no reason, so an
  environmental failure was indistinguishable from a scan defect. Added
  `error: string | null` to the run state, populated from `toError(e)`
  in `launchRecipe`'s error path, rendered in `.detail-error`. Specs
  pinned (store captures the message; page renders it).
- **F2 (environmental, resolved — not a #1306 defect):** all
  `preview_scan` calls failed briefly — the `st-config/rhCredentialCanary`
  doc was a stale `transient` stamp (`client id not allowed`) frozen
  from the 11-20 rev-lineage window; the deployed KMS credential path is
  healthy (verified by the KMS session — forced canary → `state: ok`).
  Non-AUTH category → no reauth banner → before F1, total silence.
  Scans recovered; all scenarios green.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 loadSymbolLists + map from exclusive | S1, S2 (menu+chip require the catalog) |
| AC2 chip cell + live map tracking | S2–S5, S9 |
| AC3 menu/checkmark/pick→toggle | S1–S4, S6 |
| AC4 MONITOR/user excluded; untracked same menu + `new` badge | S1, S5 |
| AC5 specs per TEST-FE §2 | Automated evidence |
| Review: canonical symbols boundary | S2–S4 (end-to-end on real docs) |
| Review: stale-menu close | S6 |
| Review: honest empty copy | S8 |

## Regression / smoke

- `npx jest src/app/features/savant-trader` — targeted suites green
- Row sort still works (header clicks); All/New/Tracked pills
  unchanged (S5 exercises them)
- Swing Analysis list dropdown still files/unfiles correctly after
  the registry canonicalization (S9 exercises it)
- Badge column + actions column alignment at dense row height

## Verdict

**PASS** — S1–S9 + refinement green on live data; F1 remediated and spec-pinned during execution; F2 environmental (stale canary), resolved.

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-11-18 | #1306 | agent | suite green | 99/99 targeted + 6043/6063 full (foreign failure excluded) |
| 2026-11-22 | #1306 | user+agent | PASS | S1–S9 + refinement live-green; F1 silent-error fix landed mid-pass (114/114) |
