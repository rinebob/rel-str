**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1407  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1415  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-08  
**Last Updated:** 2026-11-08  

# Code Review — Update Stop dialog decision context (#1415)

## Verdict

**PASS — 2 rounds.** Zero critical, zero major. Two real edge findings were
caught and fixed during the implementation self-review (documented below as
pre-gate remediations). Gate round 1 surfaced nits only; round 2 re-examined
failure paths and snapshot semantics — three more nits, still nothing gating.
Converged.

## Scope

Uncommitted working-tree change for #1415 — decision-context card inside the
stop-loss dialog plus the parent's peak-data plumbing:

- `components/stop-loss-dialog/stop-loss-dialog.component.{ts,html,scss,spec.ts}`
- `portfolio-dashboard.component.{ts,spec.ts}`

`open-orders-table.*` modifications in the worktree are foreign work —
excluded from scope.

## Standards axis — clean

- **View stays a view.** All decision math lives in `computed` signals on the
  dialog; template is declarative (chain nodes, metrics line, meta lines).
  Formatting helpers (`fmtUsd`/`fmtSignedDist`/`fmtDay`) mirror the
  positions-table precedent — same convention, same file.
- **Code judo — zero shared-component API change.** The live proposed price
  is read via `viewChild(StopLossFormComponent)` + the form's public
  `stopLossPrice` signal inside a `computed` — reactive through every write
  path (typing, steppers, percent linking, update-mode prefill) without
  adding a model or output to a component shared with the order-ticket page.
- **Additive data contract.** `StopLossDialogData` gains optional `peak` /
  `peaksPending` only; existing call sites compile unchanged.
- **Parity.** `retracedPct` duplicates the table's formula
  `((peak − cur) / peak) × 100` rather than diverging — the two surfaces
  agree by construction.
- Spec conventions match the file: jasmine-shim spies, TestBed reset +
  re-provide `DS_DIALOG_DATA` per case, zoneless CD.

## Spec axis — all 4 ACs MET

1. **Story chain + metrics match table/orders data** — Entry ($ avg buy +
   `peak.entryDate`), Peak ($ + date), Now, Stop (target order), Proposed
   (live). Metrics: retraced %, proposed dist vs current and vs peak ($ + %),
   locked-in vs basis. Position context (qty, basis, value, PnL) + order
   context (qty, TIF, age) — all spec'd against real fixtures.
2. **Both-peaks when they differ** — `showBothPeaks` gates the
   since-last-fill line; equal-price case spec'd hidden.
3. **Workflow unchanged; specs cover context + state machine** — 40 dialog
   specs: all 28 pre-existing state-machine specs pass untouched + 12 new
   context specs.
4. **Dismissal → silent reconcile only** — both openers keep the `'orders'`
   scope → `reconcileOrders`; pinned by two pre-existing parent specs
   (`reconcileOrders` called, `refresh`/`retrySection` not).

IMPL Phase 4 items verified: story-chain order, % retraced, proposed distance
from price **and** peak, locked-in vs basis, qty/basis/value/PnL, order
qty/TIF/age, both-peaks, unchanged workflow. TEST doc's "stop qty ≠ position
qty" edge resolves structurally — order context shows the order qty, position
meta shows the position qty; `lockedIn` deliberately uses the order qty (the
shares that actually fill).

## Thermo-nuclear axis — nits only

### Pre-gate remediations (found in self-review pass, fixed + spec'd)

- **Fabricated metrics on a missing quote** — `currentPrice = 0` rendered
  `Retraced 100%`, a fake total-loss PnL, `$0.00` value — violating the
  #1413 "never a wrong number" rule. `quotedPrice` guard now settles every
  quote-derived metric to `—`; spec'd.
- **Unanchored "Peak Since Entry"** — Entry node now carries
  `peak.entryDate` so the peak date has its anchor.

### Remaining nits (documented, not gating)

- Template reads `currentPrice > 0` inline while computeds use the private
  `quotedPrice` getter — same predicate, two spellings. Cosmetic.
- Context card renders only in `editing` — during `picking` the candidate
  rows already carry stop/qty/state/date, and "current stop" is undefined
  until a pick. Deliberate.
- Mixed-ladder display vs Update target (inherited from #1414, unchanged):
  the dialog's Stop node quotes the *target* order — the same order Update
  will replace — which is arguably more correct than the table's
  highest-ladder quote.

### Round 2 nits (documented, not gating)

- **Sign-glyph inconsistency** — the dialog's `fmtSignedUsd` emits explicit
  `−`/`+` (U+2212) while the table's `formatDist` uses Intl's ASCII hyphen.
  Same number, two glyphs across surfaces. Cosmetic; the dialog's explicit
  sign styling is deliberate.
- **`peaksPending` is an open-time snapshot** — a dialog opened mid-derive
  keeps '…' after the derive lands (`DS_DIALOG_DATA` is static by design).
  Dialog lifetime is short; wiring a live signal into dialog data is
  over-engineering for the gap. Shared semantic with the table's missing-key
  → '…' rule.
- **Missing-key-pending edge** — a symbol absent from `positionPeaks.data`
  with no section error renders '…' even if a peak will never derive this
  session (e.g. a position appearing between derives — reconcile refetches
  orders only). Same '…' rule the table already follows; consistent, not
  new.

## Test results

- Dialog suite — **40/40 green** (28 pre-existing + 12 context specs).
- Parent component suite — **51/51** incl. 2 new peak-plumbing specs.
- Whole `portfolio-dashboard` dir — **35 suites / 649 tests green**.
- `tsc --noEmit` — clean on all touched files (12 pre-existing implicit-any
  errors in `portfolio-dashboard.store.spec.ts` predate this work — same
  code in HEAD).

## Live-verification note

FE task — UI check happens at QA (#1452): open Update Stop on a
protected row, confirm chain values match the row + Open Orders, type a new
price and watch Proposed + metrics update live.
