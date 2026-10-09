# FE TEST — Signals Auto Paper Trade

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

FE specs — `npx jest --coverage=false`. Follow the existing
`paper-trading.component.spec.ts` / store spec patterns; async paths use
the `setTimeout(0)` flush convention from AGENTS.md.

## Store computeds

- [ ] Each new `tradesBy*` groups stamped trades under the right key and
      unstamped (manual) trades under `'—'`
- [ ] `tradesByDirection` keys off `order.side` (`LONG`/`SHORT`)
- [ ] Mixed datasets group independently — a trade with `signalType` but
      no `sector` lands in its `sigtype` group and the `'—'` sector group

## Component

- [ ] Picker renders all six new options; selecting each repivots
      `groupedTrades` to that dimension's groups
- [ ] `selectGroupScope` maps each dimension key to the right scope id
      (`sigtype-*`, `dir-*`, `sector-*`, `ind-*`, `captier-*`,
      `sigstatus-*`) and sets `statsScope`
- [ ] Group key `'—'` does NOT corrupt `statsScope` (guard — scope stays
      on previous selection or falls back to `all`)
- [ ] Selecting a group pivots the equity curve via the existing
      `effectiveScope`/`scopedStats` path — no new plumbing
- [ ] Group header labels render per dimension ("Signal Type",
      "Direction", "Sector", "Industry", "Cap Tier", "Signal Status")

## Edge / regression

- [ ] `statsByScope` missing a selected scope → `effectiveScope` falls
      back to `'all'` (existing behavior preserved)
- [ ] Empty trade list → all new computeds return the single `'all'`/
      empty group without errors
- [ ] Existing group-bys (instance/cohort/variant/expression/symbol) still
      work — no dispatch regression
