**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1672  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1727  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# CODE REVIEW — #1727: SHARED engine hoist + IBS filter stage

**Verdict: PASS** — after in-gate remediation of 4 majors and 9 minors/nits.

## Pass sequence

- **First pass** — three axes ran in parallel (Standards, Spec, Thermo-nuclear) over the scoped diff + full reads of every new/moved file. Surfaced 1 false-positive critical (foreign-session hunks swept into the diff file), 4 real majors, ~10 minors.
- **Second pass** — remediated all majors in-gate; re-verified every AC against the remediated code; re-ran all affected suites (jest 147/147 on touched specs, node 52/52, functions build, verify script 41/41).
- **Convergence: PASS** — no unresolved critical/major findings remain on in-scope files; residuals are nits, pre-existing items, or explicitly deferred/minted as follow-ups.

## Axes summary

### Standards
Confirmed the hoist eliminated the duplicated bodies: no zone math or state machine survives in `st-zone.indicator.ts`, `st-zone-v2.indicator.ts`, or `st-trend-rider-dots.indicator.ts`; `signal-detection.ts` is a legitimate emit layer (record shaping `direction→StSignalDirection`, `indicators.ibs` merge, index stripping for `detectLastBarSignals` — not a middle man). `partitionByIbs` is the only emit path in code; the two `OHLCV` types are a clean strict-engine vs loose-strategy seam; no Angular/Firebase imports crept into `shared/`.

### Spec (per-AC)
- **AC1 MET** — one body each: engines moved byte-identical (`git` similarity 100%/99% — import line only) into `shared/`; uptick SM + zero-cross single-bodied in `st-signal-detect.ts`; all BE/FE consumers import `@st/*`. *Caveat → minted #1731* for the residual FE band-overlay/band-width duplication (out of this task's declared "zone math" scope, same one-body spirit — including a real NaN carry-forward drift).
- **AC2 MET** — detectors carry no filter param; `ibs` now enters the type graph only via `Partitioned<T>` (the optional field was removed from `ZoneSignalCandidate` in-gate — type-enforced, not convention-enforced).
- **AC3 MET** — `detectZoneUptickDots` is an emitter over the shared engine; ATR placement, suppressed partition, `UptickDotResult` shape preserved; optional `version` param feeds candidate `signalType` parity.
- **AC4 MET** — parity spec pins identical emitted/suppressed index sets across the two emit compositions; the real-data verify script proves BE wrappers ≡ raw detector+partition on prod bars (41/41: V1/V2 × D/W × uptick/zero-cross, plus partition completeness and record-ibs invariants).
- **AC5 MET (post-remediation)** — identifiers renamed everywhere; "gate" prose swept from all live files (test describes, spec headers, verify guide, README). The `rb-st-zones.pine` comment is deferred to #1724 (Pine's own filter task — noted there). Historical task docs keep shipped vocabulary intentionally.
- **AC6 MET** — moved specs travel and pass; functions build clean; jest full suite 339/339.

### Thermo-nuclear
Net structural improvement — approved shape for "many more algos." `st-signal-detect.ts` (183 lines) and `st-signal-filter.ts` (105 lines) are dependency-free; emitters genuinely thin; `Partitioned<T>` minimal rather than over-generalized. The `emitZoneSignals` composition helper was extracted in-gate so a third algo adds a detector + one line.

## Findings and dispositions

### Critical
- **[resolved — false positive]** "Out-of-scope hunks in diff" (settlement-pass.ts #728 semantics, st-types-998 fixture, gh-lifecycle-639 import move, AGENTS.md self-audit section): all verified as a **concurrent session's uncommitted work** in the shared working tree, swept into the review diff by broad pathspecs — none are this task's changes. Ship-time mitigation already exists (per-file staging + the session file's declared scope).

### Majors remediated in-gate
- **`ibs?` field on `ZoneSignalCandidate`** weakened the filter-agnostic guarantee → removed; `toZoneSignal` typed `Partitioned<ZoneSignalCandidate>`; invariant now type-enforced.
- **Duplicated emit composition** in the two BE wrappers → extracted `emitZoneSignals(candidates, bars, tf, ibs)`.
- **gate→filter prose** incomplete in ~8 live files → all renamed (describe blocks, headers, verify guide, README entry).
- **Alias-table indentation corruption** in `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js` → cleaned + `@st/*` block re-ordered.
- **Missing-bar latch edge** undocumented → `st-trend-rider-dots.indicator.ts` header now spells out the latch-spend-without-render semantics; `'D'` availability comment restored.
- **`detectLastBarSignals` param order** diverged from siblings (`bars`/`window` swapped — silently compilable footgun) → signature aligned to `(ltfZone, windowV2, ltfBars, …)`; all 6 call sites updated.

### Minors remediated in-gate
- Mid-file imports in the parity spec → top.
- `shared/st-signal-filter.spec.ts` now imports via `@st/signal-filter` (pins mapper wiring like `st-ibs.spec.ts`).
- New `shared/st-signal-detect.spec.ts` (11 pins): leading-zeros skip, FIRED re-arm, NaN-window reset, **NaN-in-zone asymmetry** (uptick treats NaN delta as flat vs zero-cross's `continue` — pinned deliberately), short mirror, zero-cross neutrality.
- README ordered-list duplicate `68.` numbers + stale "gate" entry → fixed.
- `p.y ?? NaN` dead defensive arm removed (`y: number` can't be null).
- AGENTS.md rule boundary clarified (covers `st-signals`/`dotMarkers` algos, not generic `flex-chart/signals/*.signals.ts` annotations).

### Nits / deferred (recorded, not blocking)
- `st-trend-rider.strategy.ts:114` "gated by the same-timeframe Zone V2 context" — generic "gated" describing the window check, not the IBS filter; acceptable.
- `rb-st-zones.pine:201` "IBS gate" comment → deferred to #1724 (Pine filter task, same rename pass).
- Pre-existing: `detectLastBarSignals` runs the full SM+partition 4× per symbol (O(4n)); strategy.ts's four copy-paste push blocks; `st-zone.indicator.ts` local `ZONE_COLORS` ramp vs shared `ST_ZONE_COLORS` (intentional V1 divergence per #1216); `ctfFastLength`/`ctfSlowLength` params advertised but unused (were always inert — now confirmed since shared engine hardcodes 5/10); `functions/src/indicators/index.ts` barrel has one consumer (kept as the documented facade).
- `version` param on `detectZoneUptickDots` is observational today (candidate `signalType`/`reason` strings, discarded by `toDot`) — kept deliberately: it pins parity of candidate shape for future consumers.
- `functions/src/indicators/index.ts` header claim corrected in scope of this diff's reality (remaining locals aren't "no FE recompute" — they simply weren't in hoist scope).
- `indicator-computation.ts` still feeds the partition a zero-OHLC stub — **tracked as #1728's core change**, not this task's.

## Test results

- jest full suite: **339 suites / 6,491 tests — all green**
- Touched-spec battery post-remediation: **147/147** (detect + filter specs, dots emitter incl. parity describe, zone/zone-v2, sandbox suite)
- functions node suites: **52/52** signal-detection, **17/17** st-cloud-function, **81/81** SDS, **34/34** st-signals
- functions build (esbuild): clean
- App `tsc --noEmit`: 15 pre-existing errors in foreign files only (bulk-swing-sweep, portfolio-dashboard spec) — zero in touched files
- `indicator-lib-shared-engine-1727.ts` on real SPY bars: **41/41 checks**
