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
**Last Updated:** 2026-10-22  

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

**As-built (#670):**
- `CallableName.CLOSE_PAPER_TRADE`/`CANCEL_PAPER_TRADE` added; service
  methods take `tradeId` and build `{ tradeId }` — `cancelPaperTrade$`
  returns `CancelPaperTradeResponse` (`{tradeId}`), not `void` — plan
  corrected to the shipped contract.
- Store: `actingTradeIds: string[]` state + `actingIds` computed
  (`ReadonlySet<string>`) — one shared in-flight set covers close and
  cancel so the two verbs can't race on the same tradeId; a second call
  on an in-flight id is ignored (not queued).
- Shared `runExitAction` helper: `invoke` stays lazy because
  `service.call()` fires the callable eagerly at construction — the
  in-flight check must gate it.
- Success → `loadAll()` (account + trades — realized P&L changes both).
  Failure → `error` signal + snackbar with the callable's own message;
  `unauthenticated` maps to the store's auth message via `toMessage`.
  Row/page button wiring is #671 — no UI surface in this task.

## 2. Dashboard actions

- OPEN row → **Close** icon-button → confirm dialog (trade id, symbol,
  expression, current mark if shown) → spinner → on success row flips to
  CLOSED. `unavailable`/`failed-precondition` → error text in dialog or a
  snackbar, trade untouched.
- PENDING row → **Cancel** icon-button → confirm dialog → CANCELLED.
- Terminal rows (CLOSED/EXPIRED/ASSIGNED/CANCELLED) → no action.
- Same actions inside the cohort drill-down rows (shares the row renderer
  if the template allows — one component, both tables).

**As-built (#671):**
- New standalone `PaperTradeActionDialogComponent`
  (`components/paper-trade-action-dialog/`) — `MAT_DIALOG_DATA` carries
  `{ trade, action }`; summary shows id/symbol/expression/qty/variant and
  the latest `mark` (descending scan — a latest entry may carry only
  `underlyingClose`); confirm calls `store.closeTrade`/`cancelTrade`,
  closes (no result value) once `actingIds` settles; errors surface via
  the store's existing error/snackbar path (no separate transport).
- Actions column added to the shared `@for` trade-row template — OPEN →
  `exit_to_app` close button, PENDING → `cancel` cancel button, terminal
  rows render the spinner while `actingIds` has the id and nothing
  otherwise. Cohort drill-down rows get it free (same template loop).
- Status `mat-select` in the header → `onStatusFilter` →
  `store.setTradeFilters`; `'ALL'` clears the filter. CANCELLED is a
  selectable entry, and `cancelledTrades` computed added to the store —
  cancelled trades previously vanished from every selector.

## 3. Strategy builder — governing select

- `variantFamilies` filtered by `TERMINAL_VARIANT_FAMILIES` → the family
  select offers `trailing-stop` only; the `'none'` mat-option is removed.
- `trailing-stop` param default **8** (pct); `VARIANT_PARAM_META` gains a
  `max` and `variantParamValid` enforces the shared eligibility bound
  (`isGoverningEligiblePct`, SHARED §4) so `trailing-0`/`trailing-150`
  can't be created or round-tripped.
- Editing an instance whose stored key is non-terminal, unparseable, or
  degenerate prefills the trailing-8 default (matching the BE resolver's
  warn-and-default at launch).
- `parseVariantKey` tolerates non-string input (Firestore is schema-free)
  and returns null — 'none' is not a family.

**As built (#672):** landed under commit `7f78fefb` during the #668
ship (US4 bundle) — `variantFamilies()` filters the loaded variant
registry by `TERMINAL_VARIANT_FAMILIES`, `variantParam` defaults 8,
`isGoverningEligiblePct` enforced in `variantParamValid` (range
error), edit-mode coercion to trailing-8 for non-terminal/unparseable/
degenerate stored keys. `trailing-8.5` decimal pin added under #672.

**As remediated (#672 review, 2 rounds):** `variantParamValid` dropped
the FE-invented `VARIANT_PARAM_META` [1,99] bound —
`isGoverningEligiblePct` is the sole group-level eligibility gate
(a stored BE-legal `trailing-0.5`/`trailing-99.5` prefilled into an
unsaveable editor — prefill≠validator predicates). Round 2 caught the
bound surviving as *control-level* validators: Angular installs real
`min`/`max` validators on `input[type=number][min|max]` — meta bounds
are now contract-expressive (0–100) so the attribute validators can
never reject a contract-eligible pct, and the validator gains a
serialize-then-re-parse round-trip guard (sub-1e-6 params serialize
to exponential notation neither side can read). `variantFamilies` is a
plain field derived from `VARIANT_PARAM_META` ∩ `TERMINAL_VARIANT_FAMILIES`
— no registry dependency, so an unloaded/empty registry can't blank the
select while the default still saves. `NONE_VARIANT_KEY` replaces
`'none'` literals and `DEFAULT_TRAILING_STOP_KEY` derives the form/prefill
defaults; shared `VariantFamily` type imported; dead `integer` error
branch, `PaperTradingStore` inject, `loadExitVariants` call, and the
entire FE registry pipeline (`loadExitVariants`/`exitVariants`/
`listExitVariants$` — zero consumers) removed.

## 4. Status display

`CANCELLED` gets a chip/style in the trades table (dimmed, terminal) and
appears in the status filter.

**As-built (#671):** raw `{{ trade.status }}` text replaced with a
`.status-chip.status-{status}` span — per-status tint for OPEN/PENDING/
CLOSED/ASSIGNED, dimmed neutral for CANCELLED + EXPIRED (terminal
never-held states read as inactive, not failed).
