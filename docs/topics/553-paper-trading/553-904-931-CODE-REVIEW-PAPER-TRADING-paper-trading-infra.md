# Code Review — #931 BUG: flattened `signals.*` keys vs nested reader

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #904  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #931  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## Scope

Reviewed the uncommitted #931 fix: `signalEntriesFromDoc` canonical reader
in `signals.ts`, `stSignalHistory` repoint, ingest-pass dedupe, interface
corrections, verify scripts, and the new spec file
(`.devin/tmp/931-diff.patch` + the two untracked files). One consolidated
agent covered all three axes — proportionate to a ~300-line diff.

## Findings

| Sev | Location | Finding | Disposition |
|---|---|---|---|
| minor | `functions/package.json` | New spec unwired — specs run only via explicit `tsx --test` lists; moved specs would have silently stopped running | **Fixed** — added `test:st-signals` |
| minor | `signals.ts:57,74` | Interface docblocks still claimed nested-map storage, contradicting the new field comments | **Fixed** — docblocks now describe the flattened reality |
| nit | `signals.ts` helper | `??=` flattened-wins precedence undocumented in tests | **Fixed** — spec pins same-type-both-shapes precedence |
| nit | `paper-trading-auto-paper-916-inputs.ts:100` | Third inline copy of the both-shapes read left behind | **Fixed** — repointed to `signalEntriesFromDoc` |
| nit | `paper-trading-auto-paper-918-ingest.ts:42` | `.js` specifier inconsistent with sibling imports | **Fixed** — extensionless |
| nit | `signal.service.ts:44-63` (FE) | FE `collectSignalEntries` pushes nested + flattened with no dedupe — divergent edge-case semantics vs the BE `??=` | **Deferred** — pre-existing, out of scope; noted for a future shared-shape consolidation |
| nit | `signals.ts` isEntry | Guard requires only `barDate`+`direction`; `stSignalHistory` trusts `timeframe`/`signalType`/`sourceRunId` beyond it | **Accepted** — prod writers emit complete entries; malformed-entry hardening is a separate concern |
| nit | verify script | run-ids check silently skips when no docs; hand-rolled `initializeApp` | **Accepted** — smoke-script scope |
| nit | `st-cloud-function/README.md` | Export table doesn't list `signalEntriesFromDoc` | **Deferred** — README upkeep isn't in this task's convention |

## Pre-existing, out of scope

`stGetSymbolSignalHistory` accepts `timeframe` but never filters by it;
JSDoc says "default 5" while code defaults `days = 14`. Not touched.

## Thermo-nuclear answers

- **Both shapes, same signalType**: unreachable via current writers (all
  emit flattened); `??=` flattened-wins is correct since flattened is the
  only live write shape for these collections.
- **`set(merge)` interplay**: `set` never splits dotted keys; no
  `update('signals.X')` exists — writers can't create the collision.
- **Stale importers**: zero `signalEntriesFromRunDoc` references remain.

## Spec axis — ACs

- AC1 decision recorded — issue comment + `signals.ts` docblock + callable
  comment cite the normalize-on-read contract. **Met**
- AC2 `stSignalHistory` returns prod's shape — verify script proves
  flattened prod docs → real entries (`sourceRunId` intact). **Met** —
  deployed callable still runs the old read until next deploy
- AC3 types match prod shape — `signals?` optional (flattened keys aren't
  typeable). **Met**
- AC4 #918 ingest read path — repointed, same semantics. **Met**

## Test results

- `test:st-signals` (new): 6/6
- `test:paper-trading`: 197/197
- `tsc --noEmit`: clean
- Prod verify: `st-signal-history-931-reader.ts` — PASS

## Verdict: PASS

No critical/major findings after fixes. The reader is the single
canonical boundary now; the decision is recorded in code and on #931.
