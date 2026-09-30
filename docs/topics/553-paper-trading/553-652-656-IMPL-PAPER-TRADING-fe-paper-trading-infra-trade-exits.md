# FE IMPL — Trade Exits

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Thread Slug:** trade-exits  
**Issue:** #656  
**Thread Parent:** #652  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

## Files

- `src/app/features/savant-trader/services/paper-trading.service.ts` —
  `closePaperTrade$`, `cancelPaperTrade$` + `CallableName` entries
- `src/app/features/savant-trader/stores/paper-trading.store.ts` — close/
  cancel actions + closing-in-flight state
- `src/app/features/savant-trader/pages/paper-trading/` — action buttons +
  confirm dialog on the trades table and cohort drill-down
- `src/app/features/savant-trader/pages/strategy-builder/` — governing
  select restricted to `trailing-{pct}`

## 1. Service + store

- `closePaperTrade$(tradeId)` → `ClosePaperTradeResponse`; `cancelPaperTrade$(tradeId)` → `void`.
- Store actions `closeTrade`/`cancelTrade`: in-flight per-tradeId signal;
  on success refresh the trade list (or apply the returned fields
  optimistically — prefer refresh, consistent with the page's load path);
  on failure surface the callable error message on the row/page error
  signal. Quote failures must be *visible* — no silent catch.

## 2. Dashboard actions

- OPEN row → **Close** icon-button → confirm dialog (trade id, symbol,
  expression, current mark if shown) → spinner → on success row flips to
  CLOSED. `unavailable`/`failed-precondition` → error text in dialog or a
  snackbar, trade untouched.
- PENDING row → **Cancel** icon-button → confirm dialog → CANCELLED.
- Terminal rows (CLOSED/EXPIRED/ASSIGNED/CANCELLED) → no action.
- Same actions inside the cohort drill-down rows (shares the row renderer
  if the template allows — one component, both tables).

## 3. Strategy builder — governing select

- `variantFamilies` filtered by `TERMINAL_VARIANT_FAMILIES` → the family
  select offers `trailing-stop` only; the `'none'` mat-option is removed.
- `trailing-stop` param default **8** (pct); `VARIANT_PARAM_META` gains a
  `max` and `variantParamValid` enforces the shared eligibility bound
  (`isGoverningEligibleParams`, SHARED §4) so `trailing-0`/`trailing-150`
  can't be created or round-tripped.
- Editing an instance whose stored key is non-terminal, unparseable, or
  degenerate prefills the trailing-8 default (matching the BE resolver's
  warn-and-default at launch).
- `parseVariantKey` tolerates non-string input (Firestore is schema-free)
  and returns null — 'none' is not a family.

## 4. Status display

`CANCELLED` gets a chip/style in the trades table (dimmed, terminal) and
appears in the status filter.
