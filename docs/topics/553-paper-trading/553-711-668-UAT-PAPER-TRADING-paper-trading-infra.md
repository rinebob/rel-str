**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Issue:** #711  
**Task:** #668  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# UAT — #668 Terminal-family guard + governingVariant seeding

## Scope

- `isTerminalVariantKey` in the exit registry — `trailing-*` with sane pct
  eligible; everything else rejected.
- `seedVariantRuns` invariants — governing must be terminal (`'none'`
  rejected; no legit caller), every seeded `variantKeys` entry must parse.
- `governingVariantForInstance` — strategy launches honor the stored
  `governingVariant` key (written by the Strategy Builder); missing /
  `'none'` / non-terminal / unparseable / non-string values default to
  `trailing-8` (with a warn for non-`'none'` string keys).
- Strategy Builder select — `trailing-stop` only, default 8%, `none`
  removed; stored ineligible keys coerce to the default on edit.
- Deferred deeper check: live-production verification of the composed
  exit seam is task #669.

## Prerequisites

- Repo at the #668 working tree (uncommitted changes).
- `npx tsx` for functions tests; `npx jest` for FE specs.
- Dev server `npm start` + a signed-in account for the one UI scenario.

## Scenarios

| # | Feature | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Terminal guard | `npx tsx --test tests/functions/paper-trading/ledger.test.ts` | `applyEntryFill`/`createPendingTrade` reject `time-30d`, `limit-sd1`, `none`, `bogus`, `trailing-0`, `trailing-150` governing keys with `not a terminal exit variant`; zero write plans | |
| 2 | Parse rule | same run | `variantKeys` containing `garbage` rejected `not a recognized variant` | |
| 3 | Terminal predicate | `npx tsx --test tests/functions/paper-trading/exit-variants.test.ts` | `trailing-8/15/2.5` true; `initial-stop-10`, `time-30d`, `limit-sd1`, `none`, garbage, `trailing-0`, `trailing-100` false | |
| 4 | Launch resolution | `npx tsx --test tests/functions/paper-trading/trade-adapter.test.ts` | stored `trailing-15` → `trailing-15`; missing/`none`/`time-30d`/`bogus`/`trailing-0`/non-string → `trailing-8`; warn fires 3× for the bad-string cases | |
| 5 | Full regression | `npx tsx --test` over `tests/functions/**`; `npm run build` in `functions/` | all suites pass; bundle emits | |
| 6 | Builder select (manual) | Open the app → Savant Trader → strategy builder dialog (create a new instance) | "Governing Variant" select shows only "Trailing stop"; param input defaults to 8; no "None" option; saving emits `governingVariant: 'trailing-8'` (or chosen pct) | |
| 7 | Builder edit coercion (manual) | Edit an instance whose stored `governingVariant` is `time-30d` or `none` | Form prefills Trailing stop / 8 (BE parity: warn+default) | |
| 8 | Out-of-range param (manual or spec) | In the builder, set Trailing % = 150 | `range` validation error; save blocked | |

## Traceability

| Criterion | Scenarios |
|---|---|
| `isTerminalVariantKey` terminal/pct-bound matrix | 3 |
| `seedVariantRuns` rejects non-terminal + unparseable | 1,2 |
| Instance `governingVariant` honored, `trailing-8` fallback, warn | 4 |
| No shadow seeding (single governing run) | 1,4 |
| US4: only `trailing-stop` selectable; `none` removed | 6,7,8 |
| No regression across ledger/engine/adapter | 5 |

## Execution log

| Scenario | Result | Evidence |
|---|---|---|
| 1 Terminal guard | PASS | `ledger.test.ts` — rejects suite incl. `limit-sd1`/`none`/`bogus`/`trailing-0`/`trailing-150` (5-key loop) + PENDING-path `limit-sd1` case |
| 2 Parse rule | PASS | `ledger.test.ts` — `'garbage'` variantKeys rejected, plans empty |
| 3 Terminal predicate | PASS | `exit-variants.test.ts` `isTerminalVariantKey` matrix incl. degenerate-pct cases |
| 4 Launch resolution | PASS | `trade-adapter.test.ts` — stored-key wins, default matrix, warn `callCount===3`, non-string `42` tolerated |
| 5 Full regression | PASS | 673/673 functions tests; 69/69 strategy-builder+contracts jest specs; `npm run build` clean |
| 6 Builder select | PASS | user confirmation — select shows Trailing stop only, default 8, no None option |
| 7 Edit coercion | PASS | spec `it.each(['time-30d','custom-legacy-key','none'])` asserts trailing-stop/8 prefill |
| 8 Range error | PASS | spec asserts `variantParam: 'range'` for 0/150 + "Out of range" message |

## Refinement pass

One user-facing surface: the strategy-builder governing-variant select.
Scenario 6 (select shows only Trailing stop, default 8, no None option) is
the manual check — the rest is covered by specs (57 form-spec assertions).
