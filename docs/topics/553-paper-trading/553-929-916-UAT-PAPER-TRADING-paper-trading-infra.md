**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #929  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #916  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# UAT — #916 SHARED: trade stamps + stats scope ids

## Scope

Contract-level task: the stamp fields, id helpers, and stats-scope builders
that BE tasks #918/#919 and FE #921 consume. No runtime feature ships in this
task — acceptance is spec + verify-script driven.

## Prerequisites

- Repo root `C:\aa\projects\rel-str`, deps installed (`npm i` at root and `functions/`)
- Scenario 3 only: ADC credentials (`gcloud auth application-default login`)
  against prod project — read-only.

## Start instructions

Run commands from repo root unless noted.

## Scenarios

### 1. Shared contract specs — `signalTradeDesc`, dedupe key, scope builders

- **Feature:** deterministic desc/dedupe/scope id helpers.
- **Steps:** `npx jest shared/paper-trading-ids.spec.ts --coverage=false`
- **Expected:** suite green; covers `D_ST_TREND_RIDER_V{1,2}_{LONG,SHORT}` →
  `EQV{1,2}{L,S}`, round-trip through `parseTradeId`, throws on non-daily
  (`W_`/`M_`), non-trend-rider, and unversioned types; `signalDedupeKey`
  `{SYM}_{TYPE}_{BARDATE}`; all six `statsScope*` builders with slug cases
  (`Health Care`→`health-care`, `LARGE_CAP`→`large-cap`), `A-B`≡`A B`
  collision documented, empty-slug throw.
- **Result:** ___

### 2. Contract shape + auto-paper account id

- **Feature:** `PaperTrade` stamp fields optional; `AUTO_PAPER_USER_ID`.
- **Steps:** `npx jest shared/paper-trading-contracts.spec.ts --coverage=false`
- **Expected:** green; asserts `AUTO_PAPER_USER_ID === 'auto-paper'` and
  `buildAccountId` → `acct-auto-paper`; stamp fields present/absent compile.
- **Result:** ___

### 3. Contract verification script (no credentials)

- **Feature:** all helpers + account id derivable offline.
- **Steps:** `npx tsx scripts/verify/paper-trading-auto-paper-916-contracts.ts`
- **Expected:** `ALL CHECKS PASSED`; prints derived `EQV1L`, `acct-auto-paper`,
  six scope prefixes.
- **Result:** ___

### 4. Prod input-shape verification (ADC read-only)

- **Feature:** the data shapes #918's ingest will read — run/jobs/run-ids,
  symbols-doc overview fields, `PRIMARY` list — match the contracts.
- **Steps:** `cd functions && npx tsx scripts/verify/paper-trading-auto-paper-916-inputs.ts`
- **Expected:** `ALL CHECKS PASSED` — flattened `signals.{type}` keys on the
  run-ids doc, `sector`/`industry`/`marketCapTier` on `symbols/{sym}`,
  `{uid}_PRIMARY` doc with `symbols[]`; prints derived tradeId/signalId/scopes.
- **Result:** ___

### 5. Typecheck — ledger Pick extension

- **Feature:** `PaperTradeOverrides` whitelists the 10 stamps, lifecycle fields
  still excluded.
- **Steps:** `cd functions && npx tsc --noEmit`
- **Expected:** clean exit (a typo'd or missing Pick member fails here).
- **Result:** ___

### 6. Regression — paper-trading functions suite

- **Feature:** `ledger.ts` override whitelist didn't break existing fills.
- **Steps:** `cd functions && npm run test:paper-trading`
- **Expected:** suite green (entry/exit/pending/cancel tests unchanged).
- **Result:** ___

## Negative / boundary

- `signalTradeDesc('W_ST_TREND_RIDER_V1_LONG')`, `('D_MEAN_REVERT_V1_LONG')`,
  `('SOME_OTHER_SIGNAL')` → throw (scenario 1 covers).
- `statsScopeSector('')` / punct-only → throw via `scopeSlug` (scenario 1).

## Traceability

| Task AC | Scenario |
|---|---|
| All stamp fields on `PaperTrade`, optional, fixtures compile | 2, 5 |
| `PaperTradeOverrides` accepts new fields | 5 (+ ledger.ts:90–116 Pick) |
| `signalTradeDesc` maps 4 TR types; parses via `parseTradeId` | 1 |
| Six `statsScope*` builders deterministic per SHARED TEST | 1, 3 |
| `buildAccountId(AUTO_PAPER_USER_ID)` → `acct-auto-paper` | 2, 3 |
| `npx jest` green for new shared specs | 1, 2 |
| Ingest input shapes prod-verified (flattened `signals.*`, symbols-doc, list) | 4 |

## Regression / smoke

- Scenario 6 covers the only file with pre-existing behavior (`ledger.ts`).

## Results log

Executed 2026-10-08:

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Shared spec suite | PASS | `jest shared/paper-trading-ids.spec.ts` — 45/45 green incl. `EQV1L/2L/1S/2S` descs, `parseTradeId` round-trip, throws on `W_`/`M_`/`D_MEAN_REVERT_V1_LONG`/unversioned, dedupe key, all six builders, `A-B`≡`A B` collision, empty-slug throw |
| 2 | Contract shape + account id | PASS | `jest shared/paper-trading-contracts.spec.ts` — 14/14 green; `AUTO_PAPER_USER_ID === 'auto-paper'`, `buildAccountId` → `acct-auto-paper` asserted; combined run 59/59 |
| 3 | Contracts verify (no creds) | PASS | `npx tsx scripts/verify/paper-trading-auto-paper-916-contracts.ts` → ALL CHECKS PASSED |
| 4 | Prod inputs verify (ADC) | PASS | `npx tsx functions/scripts/verify/paper-trading-auto-paper-916-inputs.ts` → ALL CHECKS PASSED; prod AAMI: `D_ST_TREND_RIDER_V1_LONG` INTERIM entry under flattened `signals.*` key, sector FINANCIAL SERVICES, captier mid, PRIMARY 206 members; derived `261009-sig-AAMI-EQV1L`, trade doc absent. **Note:** requires `NODE_OPTIONS=--require ipv4-only.cjs` (AT&T IPv6 issue) — ADC token fetch fails without it |
| 5 | Typecheck | PASS | `cd functions && npx tsc --noEmit` — clean |
| 6 | Paper-trading functions regression | PASS | `npm run test:paper-trading` — 168/168 |

Refinement pass: **Not applicable — no user-facing surface** (contract/id helpers only).
