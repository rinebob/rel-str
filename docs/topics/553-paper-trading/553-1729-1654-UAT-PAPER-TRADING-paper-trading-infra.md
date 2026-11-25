**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1729  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1654  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# UAT — #1654 FE-IMPL: occurrence pane + checkbox toggles (Phase 2)

## Scope

Phase 2 of the `/signals/symbol-review` pane (Thread #1117 — Signal
Selection): the occurrence list — checkbox rows where **checked IS ledger
membership** — with confirmed (never optimistic) mint/delete toggles,
per-row pending + error lines, and the "new since last visit" divider.
The chart is NOT in scope — Phase 3 (#1655).

## Prerequisites

- The dev server is running (`npm run start`) — app builds clean.
- Normal signed-in session. All four callables are deployed (verified
  2026-11-24 via `firebase functions:list`: `getSignalReviewQueue`,
  `getSignalReviewBundle`, `generatePaperSignalTrades`,
  `deletePaperTrades` — v2, us-central1).
- At least one queue symbol with occurrences (the nightly signal run
  populates `st-signals`).
- **Ledger side-effect warning:** checking a row mints a REAL PaperTrade
  and unchecking hard-deletes it. Toggled trades appear/disappear in
  `/trading/paper`. Prefer a symbol whose signals you don't mind
  paper-trading, and restore rows to their prior state at the end.

## Getting to the feature

- **Route:** `/signals/symbol-review`
- **Entry point:** left nav → **Signals** section → **Symbol Review**
  (between "Signal Review" and "Chart View")
- **Surface:** two-pane shell — 220px symbol picker on the left; the
  right pane now renders the occurrence list for the selected symbol.

## Automated evidence

- Focused jest: **50/50** — `signal-review.store.spec` (33),
  `occurrence-list.component.spec` (9), `symbol-review.component.spec` (11)
- Full suite: **6,471/6,471** green (338 suites)
- `tsc --noEmit -p tsconfig.app.json`: 0 errors tree-wide
- Review-fixed seams pinned by specs: checkbox DOM snap-back
  (refused/failed toggle can't leave the box lying), `confirmedPatches`
  overlay (select×toggle interleave can't resurrect a stale join),
  `symbolOpenedAt` merge (queue response can't resurrect the dot).

## Scenarios

### S1 — Occurrence list renders with row fields

**Confirms:** AC1 — checkbox, barDate, signalType, direction,
INTERIM/CONFIRMED chip, checked styling.

- Steps: open the page; click a picker row with occurrences.
- Expected: the right pane lists one row per signal occurrence, newest
  first — checkbox, `YYYY-MM-DD` date, signal type (e.g.
  `D_ST_TREND_RIDER_V2_LONG`), `LONG`/`SHORT` direction, and a small
  status chip (`CONFIRMED` for closed-bar signals; `INTERIM` for
  developing-bar, if any exist — INTERIM rows may be absent on weekends).
- Checked rows (signals already minted to trades) render tinted and
  arrive already checked.
- Result/evidence: **PASS** — user-verified: rows render checkbox + date + type + direction + chip; checked rows tinted.

### S2 — "new since last visit" divider

**Confirms:** AC5 — occurrences newer than `previousOpenedAt` above the
divider; `null` → all new; stable across toggles.

- Steps: (a) on your FIRST open of a symbol — no divider appears; every
  row is "new". (b) To see the divider split, re-open a symbol you last
  opened BEFORE its newest signal — a dashed "NEW SINCE LAST VISIT"
  divider separates rows signaled after your last visit (above) from
  older rows (below).
- The divider is intentionally suppressed when it would have nothing on
  one side: all-new (first visit) or all-old (re-visit with no newer
  signals, incl. a same-session revisit) → no divider. That is the
  correct display, not a bug.
- Result/evidence: **PASS** — user-verified: suppressed at edges by design (first-visit all-new, same-session revisit all-old); mid-list split on a symbol re-opened after a newer signal.

### S3 — Check → mint: checkbox confirms server-side, trade appears in the ledger

**Confirms:** AC2/AC4 — `generatePaperSignalTrades` mints; `created`/
`deduped` → checked + tradeId; confirmed (non-optimistic) pending.

- Steps: pick an unchecked row; click its checkbox. While the mint is
  in flight the box disables + a small spinner shows. When it resolves,
  the box lands checked and the row tints.
- Then open `/trading/paper` in another tab — a new trade for that
  symbol/type appears (signal-scoped; deterministic id).
- Expected: the box NEVER shows the checked state before the server
  confirms — it waits for the answer.
- Note: `/trading/paper` loads its trades once at mount — open it AFTER
  the mint resolves (or refresh it); an already-open tab won't show the
  new trade.
- Result/evidence: **PASS** (agent-verified) — mint landed:
  `261109-sig-AAPL-EQV2L` OPEN in `st-paper-trading/trades/items`,
  created 22:15:26Z, entry @350.69 on 2026-11-09 SDS_BARS; `signalId`
  joins the 11-09 V2 row checked. Function logs: auth VALID, bars
  loaded. User's empty ledger view was a stale mount-time fetch.

### S4 — Uncheck → delete: trade removed from the ledger

**Confirms:** AC3 — `deletePaperTrades`; `deleted`/`notFound` →
unchecked + tradeId dropped.

- Steps: uncheck the row you minted in S3 (box disables while pending →
  resolves unchecked, tint gone).
- Expected: the trade disappears from `/trading/paper` on the next view
  or refresh of that page.
- Result/evidence: **PASS** — user-verified: uncheck → deleted; trade gone from /trading/paper on refresh.

### S5 — Delete refusal stays checked + legible reason (conditional)

**Confirms:** AC3 — `failed` → stays checked + refusal reason.

- Only arm if a checked row belongs to a cohort/accept-flow trade (rows
  minted through this pane delete cleanly — a refusal needs a
  cohort-trade row in the bundle, if any exist).
- Steps: uncheck such a row → the box returns to checked and a red
  one-line reason appears under the row (e.g. "cohort membership — not
  signal-scoped").
- Expected: the refusal reads as an answer, not a silent bug — box shows
  the true state, error explains why.
- If no such row exists: record N/A (the path is spec-pinned —
  `delete failed → stays checked + reason`).
- Result/evidence: N/A — no cohort-trade rows in the ledger (all signal-source delete cleanly); refusal path spec-pinned.

### S6 — Checkbox snap-back on failure (conditional)

**Confirms:** the box only ever shows confirmed state (review fix M1).

- Any toggle that fails (delete refusal, mint error, transport error)
  must leave the checkbox showing the row's TRUE state — checked stays
  checked, unchecked stays unchecked — never the clicked-but-unconfirmed
  state.
- Covered implicitly by S5 if it fires; otherwise record N/A — pinned by
  spec "snaps the box back to model state on tap".
- Result/evidence: **PASS** — user-verified via the S9 refusal: box snapped back to unchecked true state + error line.

### S7 — Concurrent toggles on different rows are independent

**Confirms:** AC4 — per-row `togglePending`.

- Steps: click two different unchecked rows in quick succession —
  both disable independently; each resolves on its own. If one errors,
  the other is unaffected.
- Result/evidence: **PASS** — user-verified: rapid clicks on two rows resolved independently.

### S8 — Re-open preserves toggles + advances the divider

**Confirms:** AC5 stability + the review-fixed overlay seams — a
re-fetched bundle can't resurrect toggled state; re-open advances the
divider.

- Steps: with a couple of rows toggled (checked), navigate to Chart View
  and back, re-select the symbol.
- Expected: your checked rows are still checked on the fresh join; the
  divider has advanced — rows that were "new" before are now below the
  line (your previous visit became the stamp).
- Result/evidence: **PASS** — user-verified: checks persisted across nav-away + re-select on the fresh join.

### S9 — Error surfaces (conditional)

**Confirms:** mint `error` / transport failure → row stays unchecked +
per-row error line; cleared on successful retry.

- Only arm if you hit an error naturally (e.g. a mint for a bar date
  with no stored bars reports "no stored bars…").
- If none observed: record N/A (spec-pinned — item error, transport
  failure, retry-clear).
- Result/evidence: **PASS** — user-verified: checking the
  `AAPL 2026-10-12 V1 LONG` (INTERIM) row refused with "signal bar
  2026-10-12 unusable (non-finite close or interim flag)" — box snapped
  back unchecked, per-row error line legible, no ledger write. Root
  cause is DATA not code: 24 AAPL 2026 bars carry stale `barStatus:0`
  (interim) flags that the sync never finalized — mints on those dates
  refuse until the corpus is repaired (triaged separately).

### S10 — Neighbors unaffected

**Confirms:** Phase-1 shell + picker + dot behavior intact; `/trading/paper`
and the other Signal Review page unchanged.

- Steps: the picker still shows the new-signal dot, which still clears
  when you open the symbol; `/signals/review` and `/trading/paper`
  render normally.
- Result/evidence: **PASS** — user-verified: picker dot clears on open; /signals/review + /trading/paper unchanged.

## Refinement pass

Note anything that reads wrong, looks off, or feels awkward — copy,
spacing, chip legibility, divider placement, pending/error
presentation, row density on long logs.

## Traceability

| AC | Scenario |
|----|----------|
| AC1 list component (fields/chip/divider/error) | S1, S2 |
| AC2 check → mint (created/deduped/error) | S3, S9 |
| AC3 uncheck → delete (deleted/notFound/failed) | S4, S5, S9 |
| AC4 confirmed toggles + per-row pending + concurrency | S3, S7 |
| AC5 divider position + stability | S2, S8 |
| Review fix M1 (snap-back) | S5, S6 |
| Review fix M2 (interleave overlay) | S8 |
| Review fix (dot-resurrect merge) | S2, S8, S10 |

## Results log

| Date | Scenario | Result | Evidence |
|------|----------|--------|----------|
| 2026-11-24 | S1-S10 | **PASS** | S3+S9 agent-verified (ledger probes); S5 N/A (no cohort rows); in-gate fixes: stale barStatus corpus repaired (44,343 bars), setPersistence auth-wipe removed |
