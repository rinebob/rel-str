**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** — (page-level as-built verification; not tied to a single task)  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Domain:** SIGNAL-REVIEW  
**Type:** UAT  
**Status:** In Progress  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03

# UAT — Signal Review page (as-built feature verification)

## Scope

Exhaustive manual verification of the `/signals/review` page **as it exists
today**, derived from the current code (not the original PRDs, several of
which predate shipped changes). Sources inventoried:

- `pages/signal-review/signal-review.component.*`
- `components/signal-review-header`, `group-panel`, `symbol-row`,
  `symbol-acr-actions`, `symbol-list-actions`, `symbol-signal-history`,
  `signal-filter-pills`, `status-summary-chips`, `quick-charts-panel`,
  `quick-charts`, `run-metrics-strip`, `rh-select-menu`
- `stores/signal-review.facade.ts`, `group.store.ts`, `symbol-list.store.ts`,
  `signal-review-ui.store.ts`, `triage.store.ts`,
  `occurrence-decision.store.ts`, `symbol-history.store.ts`
- `utils/utils.ts` (`buildSymbolGroups`, `shouldShowInListFilter`,
  `formatTradingViewWatchlist`, …)

Prior docs: `docs/topics/176-savant-trader/UAT-SAVANT-TRADER.md` §2 (legacy,
partially stale), `433-727-batch-a-UAT-…md` (Batch A cross-page scenarios).

## Conventions

- **Actionable run** = a completed run (SUCCESS or PARTIAL with
  `completedAt`). Any completed run is actionable, including prior runs (#439).
  Viewing a RUNNING/FAILED run disables mutation controls.
- **Durable** = persisted to Firestore (`occurrence-decisions`, review flags,
  list membership). **Ephemeral** = in-memory only (CONSIDER, WATCH,
  filters, expansion, selection).
- To view a **prior run**: run-dashboard → run row → Review Signals.
- Leave the **P/F** column `[ ]` until verified; record deviations in Notes.

## Test data needs

- At least one completed run with both W and D signals, including a symbol
  with **multiple** signals (e.g., a W and a D signal, or two signalTypes —
  SPCX class).
- Symbols distributed across at least two triage lists (e.g. PRIMARY +
  SECONDARY) and some untriaged.
- A prior completed run distinct from the latest.

---

## 1. Entry & run context

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 1.1 | Entry from run-dashboard | On run-dashboard, click **Review Signals** on a completed run row | App navigates to `/signals/review`; that run becomes the active run; its symbols load | [ ] | |
| 1.2 | Direct load / refresh | Hard-reload `/signals/review` with no in-memory active run | Page shows loading; once the runs stream arrives the **latest completed** run auto-selects and its symbols load | [ ] | |
| 1.3 | Fullscreen on enter | Land on the page | Page enters fullscreen layout | [ ] | |
| 1.4 | Fullscreen on leave | Navigate away (Back, or any nav) | Fullscreen exits | [ ] | |
| 1.5 | Run metrics strip | Look at the strip under the header | Shows viewed run's **Status** (icon + color), **Market Date**, **Symbols** `processed/total`, **Signals**, **Duration**, and trigger (`manual`/`pdr`/`nightly`) | [ ] | |
| 1.6 | Prior run context | Enter via Review Signals on a **prior** completed run | Strip shows that run's date/status; page renders that run's symbols; all controls still enabled (prior runs are actionable) | [ ] | |
| 1.7 | Non-completed run | View a RUNNING or FAILED run (if reachable) | ACR buttons on every row disabled; **Order** pill and clear-review-flags button disabled; browsing still works | [ ] | |
| 1.8 | Default filters on entry | Enter the page (from dashboard or direct load), before touching anything | Timeframe pill starts on **D**, direction pill on **Long** — every visit; list shows only daily longs; other pills read All | [ ] | `enterPage` re-applies D/Long each visit |

## 2. Loading, error, empty

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 2.1 | Loading | Enter the page / press Refresh | Spinner overlay for the **whole init window** — until run auto-select resolves AND symbols load AND the list catalog arrives; "No signals found" must never flash first; Refresh button disabled during symbol load | [ ] | Loading gated by `pageInitializing`, not just `symbolsLoading` |
| 2.2 | Load error | Force a symbols-load failure (offline / devtools) | Error state shows `error_outline` icon + message + **Retry**; snackbar "Failed to load symbols"; Retry refetches | [ ] | |
| 2.3 | Empty run | View a run with zero signals | Empty state: `inbox` icon, "No signals found for this date", hint "Run the agent or select a different date" | [ ] | |
| 2.4 | Empty list filter (KNOWN BUG #630) | Load page with the **PRIMARY** list active when PRIMARY is empty/unfetched | Page shows its groups normally for list members; if list empty → empty groups. **Verify whether the known empty-list-on-load bug reproduces** | [ ] | #630 suspected: empty PRIMARY doc silently hides everything |

## 3. Header

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 3.1 | Title & counts | Read the header left | Back arrow, `psychology` icon, "Signal Review", `{n} symbols`, `W {n}`, `D {n}` badges | [ ] | Counts track visible (filtered) symbols |
| 3.2 | Direction counts | Read after counts | `↑ {n}` long and `↓ {n}` short chips; hidden entirely when both are 0 | [ ] | |
| 3.3 | Timeframe pills | Click **D**, **W**, then **All** | Pill activates; group rows re-filter to symbols with matching-timeframe signals (uses loaded history; falls back to profile last-signal fields); counts update | [ ] | |
| 3.4 | Direction pills | Click **Long**, **Short**, then **All** | Pill activates; rows filtered by direction; long/short counts update | [ ] | |
| 3.5 | Status chips | Perform review/accept/consider/reject/watch actions | Nonzero chips appear: `↑` REVIEW, `✓` ACCEPT, `?` CONSIDER, `✕` REJECT, `✕` EXCLUDE, `↓` LOW_TRADABILITY, `👁` WATCH; zero-count chips hidden | [ ] | EXCLUDE/LOW_TRADABILITY/WATCH are legacy screening statuses — verify they ever display |
| 3.6 | Back | Click back arrow | Navigates to run-dashboard; fullscreen exits | [ ] | |
| 3.7 | Signals-total pill | Look immediately right of the direction filter pills | Prominent display-only `Signals {n}` pill (primary-colored, `notifications` icon); n = total signals across visible rows — updates with timeframe/direction/list filters | [ ] | Rows with unloaded history count 1 |

## 4. Grouping & list filters

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 4.1 | Group dropdown | Select **Sector**, **Industry**, **Market Cap** in turn | Groups re-render keyed by that dimension **without a data reload**; `(Unknown)` group always sorts last | [ ] | Default dimension: Industry |
| 4.2 | Group ordering | Observe group order per dimension | Sector/Industry: alphabetical; Market Cap: MEGA→LARGE→MID→SMALL→MICRO; `(Unknown)` last | [ ] | |
| 4.3 | Row ordering | Within an expanded group | Rows sorted by market cap descending | [ ] | |
| 4.4 | Empty groups | Filter such that a dimension produces a group with 0 rows | Groups with no visible rows do not render | [ ] | |
| 4.5 | List dropdown structure | Open the **List** dropdown | Top sentinel **All**; group **Triage** = exclusive lists (New symbols, Primary, Secondary, Neutral, Avoid, Hidden) + **Not triaged**; group **My lists** = Monitor + user lists | [ ] | |
| 4.6 | Default list | Fresh page load | List filter defaults to **Primary** | [ ] | |
| 4.7 | Filter to a list | Select **Primary** then **Secondary** | Only member symbols render; counts and groups update | [ ] | |
| 4.8 | Not triaged | Select **Not triaged** | Only symbols in zero *exclusive* lists show (Monitor/user-list membership doesn't count) | [ ] | |
| 4.9 | Deleted-list fallback | With a list filter active, delete that list (via list mgmt elsewhere) | Filter falls back to **All** on the next catalog emission | [ ] | |
| 4.10 | List + signal filters compose | Apply a list filter AND a D/Long signal filter | Intersection shown | [ ] | |

## 5. Pipeline actions (header pills)

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 5.1 | Review pill | Flag a symbol for review (bookmark), then click **Review {n}** | Navigates to `/chart-review`; count matches flagged symbols; pill highlighted when n>0 | [ ] | |
| 5.2 | Order pill | With ≥1 accepted symbol, click **Order {n}** | Navigates to `/signal-order`; count = accepted symbols | [ ] | |
| 5.3 | Order pill disabled | With 0 accepts, or viewing a non-completed run | Button disabled | [ ] | |
| 5.4 | Report pill | Click **Report** | Navigates to `/signal-action-report` | [ ] | |
| 5.5 | Observation pill | Click **Observation** | Navigates to `/rh-account-inquiry` | [ ] | |
| 5.6 | Clear review flags | Flag 2+ symbols, click `playlist_remove` icon | All REVIEW flags cleared (persisted — survives reload); Review count → 0; disabled on non-actionable run | [ ] | |
| 5.7 | Export list | Select **Primary**, click `download` | Downloads `ST-PRIMARY.txt`, TradingView format `EXCHANGE:SYMBOL` comma-joined; disabled on **All** | [ ] | |
| 5.8 | Export — edge cases | Export an empty list; a list with symbols lacking exchange metadata; **Not triaged** | Empty → snackbar "…is empty"; unresolvable symbols skipped + snackbar note; Not triaged exports the unlisted universe as `ST-NO_MEMBERSHIP.txt` | [ ] | |
| 5.9 | Prev/Next chevrons | With a quick-chart symbol selected, click `<` `>` | Moves chart selection through the **visible** list in grouped order; target row scrolls to the **top** of the signals panel; disabled at first/last and when no chart symbol | [ ] | |
| 5.9a | Prev/Next into collapsed group | Collapse the group containing the next symbol, then click `>` | Target group **auto-expands first**, row mounts and scrolls to the top; group header label + chevron render normally (no blank panel) | [ ] | Fixed: expand-before-scroll for collapsed targets |
| 5.9b | Rapid prev/next | Click `>` repeatedly in quick succession (10+ fast clicks) | Selection advances per click without waiting for charts; page stays responsive (no hang/OOM); charts load once for the settled symbol (250ms debounce); superseded bar requests are cancelled, not stacked | [ ] | Regression: rapid clicks used to OOM — each symbol kept its request+data alive |
| 5.10 | Expand/collapse all | Click `unfold_more` | All groups expand and every row's signal history preloads; icon flips to `unfold_less`; click again collapses all | [ ] | |
| 5.11 | Fullscreen toggle | Click `fullscreen` icon | Toggles fullscreen; icon flips to `fullscreen_exit` | [ ] | |

## 6. Group panel

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 6.1 | Group header | Read a collapsed group header | Group label + "N symbols" + `↑ n long` / `↓ n short` (each shown only when >0) + per-group expand icon | [ ] | |
| 6.2 | Per-group expand | Click a group's header | Expands; signal history preloads for rows that don't have it yet (spinner per row) | [ ] | |
| 6.3 | Per-group expand-all button | Click the unfold icon inside a group header | Expands the group without toggling row panels | [ ] | stopPropagation — header doesn't also collapse |

## 7. Symbol row

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 7.1 | Row contents | Read a row | Ticker, per-signal direction badges (LONG/SHORT colored, tooltip = signalType), Charts button, 5 ACR buttons, system-list chips, meta line | [ ] | |
| 7.2 | Signal-pending badge | Expand a group before history arrives | Row with a signal but unloaded history shows a `signal` badge placeholder | [ ] | |
| 7.3 | Meta line | Read secondary line | name · sector · exchange · cap-tier badge (MEGA/LG/MID/SM/µ) · β x.xx · P/E x.x — each field omitted when absent | [ ] | |
| 7.4 | Row select/expand | Click a row | Panel expands → signal history (up to 10 rows: date, timeframe, signalType, direction; INTERIM chip when status is INTERIM); row marked selected; history auto-loads | [ ] | |
| 7.5 | History empty/loading | Expand a symbol with no run history | Spinner while loading; "No signal history found" when empty | [ ] | |
| 7.6 | Charts button | Click **Charts** on a row | Quick-charts panel loads that symbol; row gets active-chart highlight; clicking the same row's Charts again deselects (panel returns to placeholder) | [ ] | |
| 7.7 | ACR stop-propagation | Click any ACR or list button | Row does NOT expand/collapse — action applies only | [ ] | |

## 8. ACR decisions

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 8.1 | Accept | Click ✓ on an unaccepted symbol | Button activates; ACCEPT chip +1; durable `occurrence-decisions` docs written to Firestore (one per signal occurrence, optimistic + revert on failure); an order ticket auto-stages on `/signal-order` | [ ] | Ticket: market order, side from direction, `dollarAmount` = account default, `signalContext` carries decisionIds + signalPrice |
| 8.2 | Accept toggle-off | Click ✓ on an accepted symbol | Decision docs for the symbol+run deleted; staged ticket removed; chip decrements | [ ] | |
| 8.3 | Multi-signal accept | N/A as a user workflow — a W signal is never the accept basis; filter to D and accept the daily (price is the price) | If a symbol still carries >1 signal doc, accept produces one deduped ticket with all decisionIds tracked → removal un-checks Accept (#719 regression, covered by 11.2) | [x] | Not a workflow — no manual action needed |
| 8.4 | Reject | Click ✕ | REJECT decision docs persisted to `occurrence-decisions`; any staged ticket for the symbol removed; chip +1 | [ ] | Verified in code: `persistDecisionsBatch` writes to Firestore w/ optimistic revert on failure |
| 8.5 | Consider | Click ? | Ephemeral CONSIDER status; chip +1; **not** persisted — clears on reload or run switch | [ ] | Verify intentional vs durable |
| 8.6 | Review bookmark | Click `bookmark_border` | Flag persisted via TriageService (survives reload; dateless — independent of run); chip +1; button active; click again un-flags | [ ] | |
| 8.7 | Reset | Click `undo` on a decided symbol | Decision docs for symbol+run deleted from Firestore → PENDING; button disabled while already PENDING | [ ] | Verified: `deleteDecisionsBatch`. Note: staged ticket NOT removed (clears decisions only) — by design unless reported otherwise |
| 8.8 | Stale decision | View a symbol whose latest decision is from a different run's marketDate | Date chip shows the decision's market date; accept/reject buttons get `stale` styling | [ ] | |
| 8.9 | Prior-run decisions | On a prior completed run: accept and reject symbols | Decisions written against the viewed runId; staged ticket references the viewed run | [ ] | #439 |
| 8.10 | Disabled on non-actionable run | While viewing a RUNNING/FAILED run | All five ACR buttons disabled | [ ] | |
| 8.11 | Decision persistence | Accept/reject, then hard-reload the page | Durable decisions restored (ACCEPT/REJECT states visible); CONSIDER gone | [ ] | |
| 8.12 | Flag write failure | Force a review-flag write failure (devtools offline) | Optimistic flag reverts; snackbar "Failed to flag symbol for review" | [ ] | |

## 9. List membership (row chips)

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 9.1 | Chips rendered | Read the list-action chips on a row | New symbols `fiber_new`, Primary `star`, Secondary `visibility`, Neutral `remove_circle_outline`, Avoid `trending_down`, Hidden `block`, Monitor `history`; user lists render no chips | [ ] | |
| 9.2 | Exclusive move | Click **Secondary** on a Primary-listed symbol | Symbol moves to Secondary AND is stripped from Primary (exactly one triage bucket) | [ ] | |
| 9.3 | Exclusive un-assign | Click the currently-active exclusive chip | Symbol leaves all exclusive lists (becomes untriaged) | [ ] | |
| 9.4 | Monitor toggle | Click `history` | Symbol added/removed from Monitor (nonexclusive); icon flips to `history_off` while active | [ ] | |
| 9.5 | Filter consequence | With Primary filter active, move a row's symbol out of Primary | Row leaves the visible set | [ ] | |
| 9.6 | Write failure | Force a list write failure | Snackbar "Failed to save {sym} to {list}"; membership auto-reverts on next Firestore emission | [ ] | |

## 10. Quick-charts panel

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 10.1 | Placeholder | Before selecting any symbol | `bar_chart` icon + "Select a symbol to view signal charts" | [ ] | |
| 10.2 | Chart stack | Select a symbol | Three `flex-chart`s stacked **Daily / Weekly / Monthly**; loading spinner "Loading {SYM}…" first; error state shows message | [ ] | |
| 10.3 | Meta header | Above the charts | Symbol, name, sector, industry, market-cap label | [ ] | |
| 10.4 | Visible bars | Inspect each chart | D=30 bars, W=30 bars, M=100 bars; no zoom toolbar, no scrollbar | [ ] | |
| 10.5 | Log scale | Toggle the log-scale pill | All three charts switch Y-axis to linear/log together; default is log | [ ] | |
| 10.6 | Synced crosshair | Hover any chart | Crosshair date/price mirrored on the other two charts | [ ] | |
| 10.7 | Overlays | On D and W charts | Signal dots, uptick dots (v1+v2), and higher-timeframe zone-window bands render | [ ] | |
| 10.8 | Daily ±50 bar buttons | Click the **+** button in the Daily chart's label row repeatedly, then **−** | Daily chart widens by 50 bars per click; −50 narrows by 50. **−** disables at the 30-bar floor; **+** disables at the loaded-bars ceiling. W and M charts unchanged (30/100) | [ ] | |

## 11. Cross-run & cross-page consistency

| # | Section | Action | Expected | P/F | Notes |
|---|---------|--------|----------|-----|-------|
| 11.1 | New run lands | While viewing the previous latest run, let a newer completed run arrive | Filters reset to All/All, expansion collapses, selection + quick chart cleared, ephemeral screening cleared; prior-run decisions marked not-current (stale chips appear) | [ ] | |
| 11.2 | Ticket removal → toggle | Accept a symbol → go to `/signal-order` → remove the staged ticket → Back | Accept button un-checked on return (#719) | [ ] | Verified in Batch A — regression check |
| 11.3 | De-accept → ticket | Toggle Accept off → check `/signal-order` | Staged ticket gone | [ ] | |
| 11.4 | Re-accept | After removal/de-accept, click Accept again | Fresh ticket stages with a fresh refId; decision re-created | [ ] | |
| 11.5 | Nav round-trip | signal-review → chart-review → back; → signal-order → back | Active run, decisions, review flags, list filter all preserved (root-provided stores) | [ ] | |

## 12. As-built notes (verify or ticket)

- **`showAllSymbols` is unreachable on this page** — the store supports a
  signals-only/all-symbols toggle but the header renders no control for it.
  Page is signals-only by default. Confirm intent or ticket.
- **`clearSymbolHistory` is unreachable** — `symbol-acr-actions` declares a
  `clearHistory` output but no button emits it. Dead path; confirm or remove.
- **Reset does not remove the staged ticket** — `resetSymbol` clears
  decisions only; de-accept (Accept toggle) also removes the ticket.
  Asymmetric; verify desired behavior (see 8.7).
- **CONSIDER/WATCH are ephemeral** — cleared on reload/run switch by design
  (triage store); EXCLUDE/LOW_TRADABILITY chips exist but nothing writes
  those statuses from this page.
- **Review flags are dateless** — a flag on run A still shows when viewing
  run B. By design (bookmark ≠ decision), but verify it reads correctly.
- **Entry defaults vs run-switch reset differ** — `enterPage` applies
  D/Long on every page entry, but a new run landing mid-session still
  resets filters to All/All (`group.store` effect). Verify intended, or
  unify.

## Result

| Field | Value |
|---|---|
| Outcome |  |
| Tester |  |
| Date |  |
| App version | `prod` @  |

### Deviations / findings

_(record scenario number, expected vs actual, severity, linked issue)_
