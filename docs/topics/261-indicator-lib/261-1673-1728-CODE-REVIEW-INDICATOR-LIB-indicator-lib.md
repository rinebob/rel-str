**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1673  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1728  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-25  

# Code Review — BE: marker path real OHLC + IBS filter partition + suppressed dotMarkers

**Verdict: PASS** — three axes, no criticals after in-gate remediation; all majors remediated in-gate.

## Pass log

```text
First pass complete — Standards: no hard violations, 2 minors + 4 nits; Spec: 5 AC MET, 1 PARTIAL (W spec-matrix coverage); Thermo: 3 majors (ctx-optionality lie, D/W block duplication + 4× ATR, un-pinned signal-history corpus semantic), 4 minors, nits
Second pass complete — majors/minors remediated in-gate and re-verified (tsc clean, 69/69 spec suite incl. 2 new specs, 28/28 live verify, full jest 343/343 / 21,912)
Convergence: PASS — second pass surfaced no new findings; remaining items are accepted nits/documented deferrals
```

## Axes

### Standards
No hard violations. Findings remediated in-gate: stale diagnostic
`scripts/test-indicator-series-v2.js` reads updated to the partitioned
shape (minor); `ZoneSignalSets` renamed off `ZoneDotMarkers` (nit);
always-filter contract documented on the `generateZoneSignals` signature
(nit); `Partitioned<ZoneSignalCandidate>` typed properly (nit). Accepted:
FE `indicator.types.ts` mirrors BE types (file-header-documented
convention); `windowV2 = zone` identity re-map kept (pre-existing, its
comment explains the seam).

### Spec
- AC1 no zero-OHLC shim — **MET** (grep-clean; real `OhlcBar[]` → `partitionByIbs`)
- AC2 suppressed partition in dotMarkers — **MET** (`{emitted,suppressed}` both intervals)
- AC3 uptick + zero-cross same partition — **MET** (one merged candidate set, one call)
- AC4 emitted == strategy-path emitted — **MET** (spec-pinned ×4 cells + live verify ×4)
- AC5 additive-safe doc shape — **MET** (all readers updated; response computed live)
- AC6 spec matrix + alignment — **MET** after in-gate W-suppression spec (was PARTIAL)

Declared deviations assessed sound: raw `OhlcBar[]` to the partition
(`IbsBarLike` tolerates it); `generateZoneSignals` exported as the spec
seam; `signals.zoneV*` emitted-only (required by the parity contract);
optional `ibs` on markers (groundwork for #1680).

### Thermo-nuclear
Majors remediated in-gate:
1. **ctx-optionality lie** — `partitionByIbs(undefined)` = unfiltered vs
   marker path's `= {}` default. Resolved: always-filtered is *intended*
   (no unfiltered marker mode — the ghost set is the suppressed view);
   the contract is now documented on the signature.
2. **D/W block duplication + ATR×4** — collapsed into `attachZoneSignals`
   + `generateZoneDotMarkers(set)` computing ATR once per
   (interval, version).
3. **Un-pinned corpus semantic** — `generate-historical-signal-history.ts`
   header now documents that `signals.zoneV*` is emitted-only since #1728
   (old docs hold the unfiltered set; `--wipeout` unifies).

Minors remediated: `DOT_MARKER_KEY` map replaces the ternary chain;
length-mismatch guard now throws (structural invariant) + spec; stale
diagnostic script reads fixed. Accepted: `suppressed` ships on every
request pre-#1680 (plumbing-first dead-weight — documented); old-shape
arrays degrade to zero dots (deploy order covers).

## Test results

- `tests/functions/indicator-marker-path-ibs-1728.test.ts` — 17/17
  (parity ×4, suppression semantics ×3, undefined-pass ×3, W suppression,
  alignment, doc-shape, misalignment-throws)
- `npm run test:signal-detection` — 69/69
- jest (assembler + chart-indicators targeted) — 64/64
- **full jest suite — 343/343 suites, 21,912 tests**
- `npx tsc --noEmit -p functions` — clean; FE tsc — clean of changed files
- Verify `indicator-marker-path-ibs-1728.ts` on real QQQ `symbol-data` —
  **28/28**; suppression ~30% D / ~24–30% W (matches the Pine artifact)

## Deferred

- **#1680** (already tracked) — FE suppressed-ghost rendering consumes the
  `suppressed` payload this task now ships.
- **#1754** (minted by the #1655 QA, already tracked) — old-date INTERIM
  signal docs can't mint / lack `indicators.ibs` — related corpus
  lifecycle, not this task's scope.
