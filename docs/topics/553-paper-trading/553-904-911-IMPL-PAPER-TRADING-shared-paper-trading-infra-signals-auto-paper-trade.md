# SHARED IMPL — Signals Auto Paper Trade

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #911  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

Contract surface for the auto-paper ingest: the stamp fields denormalized
onto each auto-created trade, the dedupe/direction conventions, the new
stats-scope id builders, and the dedicated auto-paper identity constant.

## Files

- `shared/paper-trading-contracts.ts` — `PaperTrade` stamp fields +
  `PaperTradeOverrides` whitelist extension (overrides type lives in
  `functions/src/paper-trading/ledger.ts:90` — update the Pick there)
- `shared/paper-trading-ids.ts` — new `statsScope*` builders + slug helper

## 1. `PaperTrade` stamp fields (flat, optional)

Add to `PaperTrade` (`shared/paper-trading-contracts.ts:165`). All optional
— manual/existing trades carry none of them:

```ts
// ── auto-paper provenance stamps (Thread #904) ──
signalType?: string;                       // 'D_ST_TREND_RIDER_V1_LONG' | ...
signalTimeframe?: string;                  // 'D'
signalBarDate?: string;                    // YYYY-MM-DD bar the signal fired on
signalStatus?: string;                     // 'INTERIM' | 'CONFIRMED' at capture
signalRunId?: string;                      // ST run that produced the signal
signalIndicators?: Record<string, number | string | null>; // verbatim from StSignalEntry.indicators
sector?: string;
industry?: string;
marketCapTier?: string;
captureList?: string;                      // 'PRIMARY' — list that admitted the symbol
```

**Direction needs no new field** — `order.side` (`TradeSide.LONG|SHORT`)
already carries it. `signalId` carries the dedupe key (§3).

Also extend `PaperTradeOverrides` (`functions/src/paper-trading/ledger.ts:90`)
so `applyEntryFill`'s `tradeOverrides` can merge the new fields — add the
names above to the `Pick<>`.

## 2. Identity + sizing constants

```ts
/** Dedicated system uid for auto-papered trades — segregates the dataset
 *  from all live/manual activity. Account doc self-creates via baseAccount. */
export const AUTO_PAPER_USER_ID = 'auto-paper';
```

Location: `shared/paper-trading-contracts.ts` (FE filters on it later).
Quantity is a constant `1` on the BE side — no shared constant needed.

## 3. Dedupe + tradeId conventions

- **`signalId` = `${SYMBOL}_${signalType}_${barDate}`** — deterministic,
  one per signal occurrence per day across all runs.
- **`tradeId` desc = `EQ${ver}${dir}`** where ver ∈ {V1,V2}, dir ∈ {L,S} —
  e.g. `EQV1L` → `251008-sig-AAPL-EQV1L`. Matches `parseTradeId`'s desc
  pattern `[A-Z0-9]+`. Deterministic tradeId = doc-existence dedupe inside
  the fill transaction (no query, race-safe).
- Helper: `export function signalTradeDesc(signalType: string): string` —
  maps `D_ST_TREND_RIDER_V1_LONG` → `EQV1L`. Lives in
  `paper-trading-ids.ts` next to `EQUITY_TRADE_DESC`.

## 4. Stats-scope builders

`paper-trading-ids.ts`, alongside the existing `statsScope*` fns:

```ts
export function statsScopeSignalType(signalType: string): string;  // 'sigtype-{slug}'
export function statsScopeDirection(side: TradeSide): string;      // 'dir-long' | 'dir-short'
export function statsScopeSector(sector: string): string;          // 'sector-{slug}'
export function statsScopeIndustry(industry: string): string;      // 'ind-{slug}'
export function statsScopeCapTier(tier: string): string;           // 'captier-{slug}'
export function statsScopeSignalStatus(status: string): string;    // 'sigstatus-interim' | '-confirmed'
```

Slug helper (private): lowercase, `[a-z0-9]+` runs joined with `-`,
collapse/trim. Deterministic — `statsScopeIndustry('Medical Devices')` →
`ind-medical-devices`. Trades missing a field contribute no scope for
that dimension (existing `if (trade.cohortId)` pattern).

## Notes

- No changes to `VariantRun`, `PaperFill`, `PaperOrderTerms`, registry —
  `trailing-8` seeds via existing `dims.governingVariant`/`variantKeys`.
- `expression` stays `'EQ'` (`EQUITY_TRADE_DESC`); `source` stays `SIGNAL`.
- Shadow variants deferred — `variantKeys: ['trailing-8']` only.
