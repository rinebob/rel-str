**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1721  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1653  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT — #1653 FE-IMPL: symbol-review route + shell + queue picker (Phase 1)

## Scope

Phase 1 of the `/signals/symbol-review` pane (Thread #1117 — Signal Selection): the route, the page shell, the symbol picker bound to the live `getSignalReviewQueue` callable, and the store/service skeleton that Phase 2 (#1654) hangs the occurrence list on. Minting/deleting and the chart are NOT in scope — they land in #1654/#1655.

## Prerequisites

- The dev server is running (`npm run start`) — the app builds clean.
- Logged-in account with `getSignalReviewQueue`/`getSignalReviewBundle` callable permission (the normal signed-in session; both callables shipped with #1650 and are deployed).
- PRIMARY ∪ SECONDARY list membership with un-groomed signals in `st-signals` — the nightly run populates this; if the queue comes back empty, S2's empty-state branch applies instead.

## Getting to the feature

- **Route:** `/signals/symbol-review`
- **Entry point:** left nav → **Signals** section → **Symbol Review** (between "Signal Review" and "Chart View")
- **Surface:** two-pane shell — a 220px symbol-picker list on the left, a detail placeholder pane on the right, under a "Symbol Review" header.

## Automated evidence

- Focused jest: **158/158** — `signal-review.service.spec` (5), `signal-review.store.spec` (8), `symbol-review.component.spec` (10), `core-routes.spec`, `nav-sections.spec`
- Full suite: **6,395/6,395** green (337 suites)
- `tsc --noEmit -p tsconfig.app.json`: clean on all task files
- `core-routes.spec` pins the canonical path `signals/symbol-review` ↔ `AppRoutes.SYMBOL_REVIEW` ↔ `PAGE_INFO` title; `nav-sections.spec` pins the Signals item order including "Symbol Review"

## Scenarios

### S1 — Route + shell loads with the queue

**Confirms:** route registered, nav entry lands on the page, `loadQueue` fires on init.

- Steps: nav → Signals → **Symbol Review**.
- Expected: two-pane layout fills the viewport (no collapsed strip); left pane shows a spinner briefly, then either the symbol row list or the empty-queue state; header reads "Symbol Review" with the subtitle "Curate signals into paper trades — checked rows mint, unchecked delete."
- Result/evidence: **PASS** — user-verified: two-pane shell fills viewport; queue rows loaded.

### S2 — Picker rows carry symbol + last-signal date + new-signal dot

**Confirms:** queue rows bound correctly; `hasNewSignal` (`lastDailySignalDate > lastOpenedAt`) renders the dot.

- Steps: inspect the left pane rows.
- Expected: each row shows the symbol, its `lastDailySignalDate` (YYYY-MM-DD), and a small dot on the right edge for rows whose latest signal is newer than your last open of that symbol. Rows never opened also carry the dot. Sorted by signal date, newest first.
- If the queue is empty: left pane shows "No symbols with un-groomed signals." — record that as the observed state.
- Result/evidence: **PASS** — user-verified: rows carry symbol + last-signal date; dot on new-since-open rows.

### S3 — Select a symbol: loading → bundle placeholder; dot clears

**Confirms:** `selectSymbol` fires the bundle callable, the keyed-bundle gate renders only the selected symbol's data, and the just-stamped `lastOpenedAt` clears the dot in-session (review M2 fix).

- Steps: click any row **with a dot** (e.g., the top dotted row).
- Expected: (a) row highlights (primary-container selected style); (b) detail pane shows "Loading {SYM}…" briefly; (c) then "​{SYM} — N signal(s) queued (occurrence pane lands in the next phase)" or "No un-groomed signals for {SYM}"; (d) **the dot on that row disappears immediately** — no refresh needed.
- Result/evidence: **PASS** — user-verified: select → loading → bundle placeholder; selected row highlighted; dot cleared in-session.

### S4 — Fast-switching symbols never shows the wrong symbol's data

**Confirms:** `bundleSeq` stale-response guard + symbol-keyed bundle (review M1 fix).

- Steps: click row A, then immediately click row B before A's load finishes. Repeat a few times with different pairs.
- Expected: the detail pane only ever shows the last-clicked symbol's name and count — never "A — N signals" under a B selection, never a transient flash of A's data under B's header.
- Result/evidence: **PASS** — user-verified: fast switching never showed another symbol's data.

### S5 — Navigate away and back: retained selection re-opens

**Confirms:** the session store's retained selection is deliberately re-opened (re-fetches + re-stamps), not rendered stale.

- Steps: with a symbol selected, navigate to Chart View (nav → Signals → Chart View), then back to Symbol Review.
- Expected: the picker still shows your selection highlighted; the detail pane briefly shows the loading state again, then the same bundle — a real re-open, not a frozen render.
- Result/evidence: **PASS** — user-verified: retained selection re-loaded on return.

### S6 — Empty/error states behave (data-dependent arms)

**Confirms:** the honest empty states + error banners.

- Arms (record whichever applies):
  - **Empty queue** (if S2 showed the empty state): no list renders; the detail pane shows "Select a symbol to review its signals."
  - **Zero-occurrence bundle** (defensive arm — every queued symbol should have signals; skip if unreachable): "No un-groomed signals for {SYM}."
  - **First-load failure** (only observable if the callable fails — do NOT force): queue error copy renders instead of the empty state, not alongside it.
- Result/evidence: **N/A — arms unreachable on live data** (queue non-empty, every queued symbol has occurrences, no callable failure). States are spec-pinned: empty-queue, queue-error-gates-empty-copy, zero-occurrence, and the cross-symbol mislabel refusal all covered in `symbol-review.component.spec.ts` (10 specs). User confirmed the pane works correctly.

### S7 — Regression / smoke

**Confirms:** the nav + route additions didn't disturb neighbors.

- Steps: open Signal Review (`/signals/review`) — loads normally; open Chart View (`/trading/chart-view`) — loads normally.
- Expected: both pages unchanged.
- Result/evidence: **PASS** — user-verified: Signal Review + Chart View unaffected.

## Manual UI/UX refinement pass

- [x] Two-pane layout fills the viewport height; picker list scrolls when the queue is long; no page-level scrollbar competing with the pane scroll
- [x] Selected row uses the primary-container highlight; hover affordance on rows; dot is visible but not noisy
- [x] Loading/empty/error copy is readable and consistent with nearby pages
- [x] Keyboard: picker rows are real `<button>`s — tab-reachable, Enter/Space selects; selected row carries `aria-current`
- [x] Dark theme renders cleanly (mat-sys tokens — no hardcoded palette)

## Findings

None — all scenarios pass; S6 error/empty arms unreachable on live data and spec-pinned instead.

## Traceability

| AC | Scenario |
|----|----------|
| AC1 route + CallableName ×4 + nav + PAGE_INFO | S1, S7 (+ automated: core-routes/nav-sections/service parity specs) |
| AC2 four wrappers unwrapping `.data` + parity spec | automated (service spec — 5 tests incl. literal-name parity) |
| AC3 store: loadQueue/selectSymbol + seq guard + loading/error | S3, S4, S6 (+ automated: store spec — 8 tests) |
| AC4 two-pane shell + picker + dot + empty states | S1–S6 |
| AC5 specs + jest/tsc green | automated evidence |

## Regression / smoke

- [x] Full jest suite — 6,395/6,395 — PASS
- [x] `nav-sections.spec` item order — PASS
- [x] S7 manual neighbor check — PASS (user-verified)

## Verdict

**PASS** — S1–S5 + S7 user-verified; S6 N/A on live data (spec-pinned). Ship-eligible.

## Results log

- 2026-11-23 — doc created; automated evidence recorded; manual scenarios pending user drive.
- 2026-11-24 — executed: S1–S5 + S7 PASS (user-verified); S6 N/A — no repro on live data (states spec-pinned). Refinement pass clean per tester. Verdict: **PASS**.
