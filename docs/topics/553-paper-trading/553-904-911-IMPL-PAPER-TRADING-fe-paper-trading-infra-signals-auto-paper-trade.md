# FE IMPL — Signals Auto Paper Trade

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

Thin surface: extend the existing `trading/paper` group-by picker with the
six new auto-paper dimensions. Stats docs already render through the
existing scope selector — the BE writes the scopes, the FE just needs to
group and pivot onto them. No new page, no new services.

## Files

- `src/app/features/savant-trader/stores/paper-trading.store.ts` —
  `tradesBy*` computeds
- `src/app/features/savant-trader/pages/paper-trading/paper-trading.component.ts`
  — `GroupByKey`, `groupedTrades` dispatch, `selectGroupScope` mapping
- `src/app/features/savant-trader/pages/paper-trading/paper-trading.component.html`
  — picker options + column label
- `src/app/features/savant-trader/pages/paper-trading/paper-trading.component.scss`
  — only if a new chip/column needs layout

## 1. Store computeds

Extend `GroupByKey` (find its union def — component or store) with:

```
'signalType' | 'direction' | 'sector' | 'industry' | 'capTier' | 'signalStatus'
```

Add matching computeds alongside `tradesBySymbol` et al:

```ts
tradesBySignalType   — key t.signalType     ?? '—'
tradesByDirection    — key t.order.side      (LONG/SHORT)
tradesBySector       — key t.sector         ?? '—'
tradesByIndustry     — key t.industry       ?? '—'
tradesByCapTier      — key t.marketCapTier  ?? '—'
tradesBySignalStatus — key t.signalStatus   ?? '—'
```

Manual trades group under `'—'` (they carry no stamps) — acceptable; the
dataset is auto-paper-focused. `'—'` groups sort last if trivial, else
leave existing sort.

## 2. Component

- `groupedTrades` — extend the dispatch chain with the six new keys.
- `selectGroupScope` — extend the mapping:
  `signalType → statsScopeSignalType(key)`, `direction →
  statsScopeDirection(key as TradeSide)`, `sector → statsScopeSector(key)`,
  `industry → statsScopeIndustry(key)`, `capTier →
  statsScopeCapTier(key)`, `signalStatus → statsScopeSignalStatus(key)`.
  `'—'` keys produce no scope — leave `statsScope` unchanged (guard: skip
  `statsScope.set` when key is `'—'` or scope fn would slug junk).
- HTML picker — six new `<mat-option>`s; the group card header label
  switches on dimension (check existing label rendering; add labels:
  "Signal Type", "Direction", "Sector", "Industry", "Cap Tier",
  "Signal Status").

## 3. Out of scope

- No new stats contracts — `PaperStats`/`listStats`/`getPaperStats$` are
  untouched; new scopes arrive through the existing enumerate-all load.
- No per-signal detail page, no histograms, no filters beyond group-by —
  deferred until the data shows what views matter (PRD decision).
- Gallery card "Paper" button repurposing — Topic #743's territory.
