# SHARED TEST — Signals Auto Paper Trade

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #911  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

Shared contract tests. Command: `npx jest --coverage=false` (repo root);
shared specs live under `shared/` or `src/` per existing convention —
check where `paper-trading-ids` specs already live and colocate.

## Cases

### `signalTradeDesc`

- [ ] `D_ST_TREND_RIDER_V1_LONG` → `EQV1L`; `V1_SHORT` → `EQV1S`;
      `V2_*` → `EQV2L`/`EQV2S`
- [ ] Every output parses back through `parseTradeId` when embedded in a
      full tradeId — build `251008-sig-AAPL-EQV1L`, parse, assert
      `desc === 'EQV1L'`
- [ ] Unknown signal type throws or returns a defined fallback (match
      impl behavior)

### Stats-scope builders

- [ ] `statsScopeSignalType('D_ST_TREND_RIDER_V1_LONG')` → deterministic
      slug (assert exact string)
- [ ] `statsScopeDirection(TradeSide.LONG)` → `dir-long`; `SHORT` → `dir-short`
- [ ] `statsScopeSector('Health Care')` / `statsScopeIndustry('Medical Devices')` /
      `statsScopeCapTier('LARGE_CAP')` — slugification: lowercase,
      spaces→`-`, non-`[a-z0-9]` stripped, no leading/trailing `-`
- [ ] Same input → same scope (idempotent); distinct inputs that slugify
      identically (e.g. `A-B` vs `A B`) documented as an accepted collision
- [ ] `statsScopeSignalStatus('INTERIM'|'CONFIRMED')` → `sigstatus-*`

### Contract shape

- [ ] `PaperTrade` compiles with all new optional fields absent (existing
      fixtures unchanged) and present (new fixture with full stamp set)
- [ ] `AUTO_PAPER_USER_ID === 'auto-paper'` and produces
      `acct-auto-paper` via `buildAccountId`
- [ ] `PaperTradeOverrides` accepts the new stamp fields through
      `tradeOverrides` (type-level; covered indirectly by BE pass test)
