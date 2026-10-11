# CODE-REVIEW — #919 BE: stats scope fan-out

**Topic:** Paper Trading Infra  
**Topic Slug:** 553-paper-trading  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #919  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #919  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

Single-axis consolidated review of the ~77-line diff:
`paper-stats-pass.ts` `tradeScopes` fans auto-paper stamp fields into
`sigtype-*`, `dir-*`, `sector-*`, `ind-*`, `captier-*`, `sigstatus-*`
scopes, plus 3 new specs.

## Verdict

**PASS after one fix.** All contract checks clean — builder
names/signatures, gating (dir-* only when `signalType`), CANCELLED
exclusion upstream, no scheduling changes, spec matches IMPL §4.

## Findings & dispositions

| Finding | Disposition |
|---|---|
| LOW — sluggability predicate `/[a-z0-9]/i` can disagree with `scopeSlug` on Unicode fold chars (`ſ`→`s`, `K`→`k`): guard passes, slugger still throws, kills the pass | **Fixed** — `try/catch` around `build(value)` instead of predicting; catches every disagreement, not just the regex blind spot |
| NIT — `dir-*` emits even when `signalType` itself is un-sluggable | Accepted — `dir` keys off `order.side` per IMPL; a signal-direction slice remains valid even if the type can't be named |
| NIT — test file header listed only the old scope set | Fixed |
| Accepted-by-design | `stats-sig-*` doc growth (~one per signal/day); slug separator collisions (documented in #916) |

## Context note

A question raised during impl — "what happens when the analysis asked
for isn't a pre-computed scope?" — was answered in-session: the stamp
fields on the trade doc are the load-bearing layer (arbitrary Firestore
queries remain possible); the scopes are convenience tiles. A
`slicePaperTrades` callable for arbitrary stamp-filtered aggregation was
flagged as a possible follow-up once #921's usage shows which questions
recur — deferred by the user pending real usage.

## Verification

- `test:paper-trading`: **200/200** (3 new specs: full six-scope fan-out
  with slug shapes, `dir-*` gating, un-sluggable stamp isolation)
- `tsc --noEmit`: clean
- Nightly write path spec-covered; no prod verify — no auto-paper trades
  exist yet (config doc not written).
