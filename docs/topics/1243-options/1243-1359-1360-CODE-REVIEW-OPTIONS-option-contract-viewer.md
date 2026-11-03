**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1359  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1360  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# Code Review â€” Task #1360: Marker model + decoupled underlying window

Three axes (Standards / Spec / Thermo-nuclear) run on the task's change set:
`shared/options-contract-contracts.ts`, `plotted-pairs.util.{ts,spec.ts}`,
`plotted-contracts-feature.{ts,spec.ts}`, `plotted-window.utils.ts` (new),
`options-contract-viewer.store.ts`,
`options-contract-chart-series.builder.ts`, `options-contract-chart.component.{ts,spec.ts}`,
`option-chart.component.{ts,spec.ts}`. Sibling uncommitted work in the same
files (`studyRange` brush seam, generator-drawer template hunks) was excluded
by hunk attribution; `focusPlotted`/`clearChartFocus`/`chartFocusContractId`
predate the diff (shipped `d1c0ef7c`).

## Standards

| # | Finding | Disposition |
|---|---|---|
| S-1 (major) | Earliest-pick scan + `âˆ’70d` prefix math copy-pasted across `plotted-contracts-feature.ts` and `options-contract-viewer.store.ts` (4 sites); `86400000`/`T00:00:00.000Z` literals twice | **FIXED** â€” `plotted-window.utils.ts` is now the single home: `earliestPickDate`, `pickPrefixFrom`, `contextCoverage`, `markerDatesOf`. Feature file down to 355 lines. |
| S-2 (major) | "Pick days" defined three ways â€” `markerDatesOf` unions openDate, `markerDates?.[0]` reads raw, builder falls back â€” silently divergent for openDate-only producers | **FIXED** â€” every read goes through `markerDatesOf`/`earliestPickDate`. |
| S-3 (nit) | Stale comment "openDate (or first observation) â†’ expiration" (`options-contract-chart.component.ts:110`) | **FIXED** |
| S-4 (nit) | `picks â‰¤ expiration` filter duplicated (feature `allDates` + `computeMarkerSpans`) | Accepted â€” different input types (entry vs chart contract); merging would couple state and render layers. |
| S-5 | IMPL doc specifies `underlyingWindow` as "explicit store state â€¦ never re-derived"; implemented as a computed | Accepted â€” derives from marker metadata, not rendered points; the property the design needed (clip can't shrink it) holds. Doc flagged for IMPL wording update. |

## Spec

All six acceptance criteria **MET** (each listed with evidence below). One implemented-but-wrong:

| # | Finding | Disposition |
|---|---|---|
| C-1 (major) | Right edge of the context window never restored: `ensureContextBars` only checked `desired < firstBar`, so bars truncated at a focused contract's `endDate` stayed short forever; the spec passed only because fixtures returned empty bars | **FIXED** â€” `contextCoverage` checks both edges (`desired < firstBar || lastBar < getMarketDatePT()`) and refetches `[min(desired, firstBar), today]` so one call restores both. Deterministic spec added (fixture bars ending before the real market day). |
| C-2 | `removePlotted` restores the window on any removal, not just the focused chip | Accepted â€” harmless no-op when covered; keeps context if a different contract stays focused. Comment tightened. |
| D-1 | Spec gaps: `resetPadDays` clamp, right-edge restore, kept-contract `data`/`status` retention, datedâ†’bare collapse, failed-load bar preservation | **FIXED** â€” five specs added. |
| Scope check | `seriesHovered`/`highlightedContractId`, `ResizeObserver`, `studyRange` output | Not this diff â€” prior shipped work / sibling task hunk. Excluded. |

AC evidence: parser union + earliest openDate (`plotted-pairs.util.ts:66-83`), authoritative replace vs same-call union (`plotted-contracts-feature.ts:204-244`), multi-vertex single-series spans (`options-contract-chart-series.builder.ts:101-119,168-190`), window `[earliest âˆ’ ~50 sessions, lastBar]` (`plotted-contracts-feature.ts:119-134`), clip-invariant domain (`allDates` unions windowed bar dates, `:150-166`; `renderedSeries` clips only contract obs, `:99-111`), single-date spans unchanged (2-vertex `[pick, expiration]`).

## Thermo-nuclear

| # | Finding | Disposition |
|---|---|---|
| TN-1 (critical) | `loadContractInternal` wiped `underlyingBars: []` on entry (and on invalid IDs) with no error-path restore â€” a failed/bad OCC load permanently destroyed the plotted set's context; also caused axis shrinkâ†’regrow flicker | **FIXED** â€” both wipes removed (old bars stay until the next fetch lands, atomic replacement); contract-error path now restores via `contextCoverage` when the set's window is uncovered. Spec added. |
| TN-2 (major) | One invariant, four mechanisms, five call sites â€” widen/restore/clamp scattered | **FIXED** â€” collapsed to `contextCoverage` at the fetch seam + `earliestPickDate`/`pickPrefixFrom`; `ensureContextWindow` is the sole feature-side caller (loadPlotted / clearChartFocus / removePlotted). |
| TN-3 (major) | `focusPlotted`/`clearChartFocus`/`isMultiMode` have no production callers | Not this diff (shipped `d1c0ef7c` â€” chip drill-down is wired; "back" affordance is a #1362/#1363 surface). Flagged to the thread, not counted against the task. |
| TN-4 (major) | Dual-field `openDate`/`markerDates` drift risk | **FIXED** via S-2 â€” canonical `markerDatesOf` everywhere; the stored invariant `openDate = markerDates[0]` is now produced in one place. |
| TN-5 | Stale `contractData` drives single-contract chrome in set view | Pre-existing, out of scope â€” flagged as a thread-level follow-up. |
| TN-7/9 | `underlyingWindow` public but internally consumed; redundant `.sort()[0]` on sorted bars | Accepted â€” specs read it; sort cost trivial at ~500 rows. |
| TN-8 | `UNDERLYING_CONTEXT_DAYS=70` vs `SESSIONS=50` unit divergence | Accepted â€” documented over-fetch bound; the window itself counts real bar rows, so display semantics are exact. |
| TN-10 | Bar fetch serialized after contract fetch | Deferred â€” `parsed.symbol` is known upfront, but the range needs the contract's start/end; marginal win, noted. |
| Nit | `PlottedChartContract.markerDates?` optional | Accepted â€” the builder fallback preserves openDate-only producers. |

## Test results

- Full suite: **287 suites / 4,954 tests â€” PASS**
- Touched sweep: `src/app/features/savant-trader` **150 suites / 2,924 tests â€” PASS**
- `tsc -p tsconfig.app.json --noEmit` â€” clean
- Spec quality: typed fixtures, observable-behavior assertions (fetch args, window shape, axis domain), deterministic `setTimeout(0)` flush; one masked-vacuous spec found and replaced (C-1)

## Verdict

**PASS** â€” critical and major findings remediated in-gate with covering specs; remaining items are minors accepted with stated reasons or out-of-diff attributions flagged to the thread.

---

# Second pass — post-remediation re-review

A second full pass (all three axes re-run on the post-fix working tree) verified every
pass-1 fix and surfaced **four new findings**, all remediated in-gate:

## New findings and resolutions

| # | Finding | Disposition |
|---|---|---|
| 2-1 (major) | `contextCoverage` judged coverage on **bar dates** vs `getMarketDatePT()` — a calendar date. On weekends/holidays/pre-ingest `last < today` is permanently true, so every `loadPlotted`/`removePlotted`/`clearChartFocus`/error-restore fired a full-range refetch that could never restore coverage. Bar dates can't distinguish "narrowed by a contract fetch" from "data legitimately ends here". | **FIXED** — new `underlyingBarsRange: FetchRange` state records the last *requested* `{symbol, from, to}`; `contextCoverage(range, anchor, today)` judges the request. A contract fetch `[start, endDate]` reads uncovered on both edges; a legitimately-ending data tail no longer false-negatives. Symbol-scoped so a foreign-underlying load can't mask the set's coverage. |
| 2-2 (major) | `fetchUnderlyingBars` error handler still wiped `underlyingBars: []` — the TN-1 fix missed the shared seam one layer down; a transient failure on a context refetch destroyed the whole window. | **FIXED** — error path keeps existing bars (stale context beats an empty chart) + logs; spec added. |
| 2-3 (major) | `addPadDays`/`resetPadDays` could truncate the **right** edge: enabled in set view but fetched `to = contractData.endDate(+pad)` — stale `contractData` (which `loadPlotted` never clears) collapsed the tail below today, and could fetch the wrong symbol entirely. | **FIXED** — pad fetches are context-clamped on *both* edges (`to = max(range.to, today)` when a dated set is loaded) and fetch the set anchor's symbol, not stale `contractData.symbol`. Specs updated. |
| 2-4 (major) | Contract-error restore refetched `parsed.symbol` — the *failed contract's* symbol — replacing the plotted set's context with a foreign underlying. | **FIXED** — the error path delegates to `ensureContextCoverage()`, which always fetches `contextAnchor().symbol` (the set's underlying). Spec added. |

## Structural remediation

The fix converged on one seam per concern:

- **`underlying-bars-feature.ts` (new, ~150 lines)** — the whole underlying-bar slice moved
  out of the store: `fetchUnderlyingBars` (records `FetchRange`; error keeps bars),
  `loadUnderlyingBars`, `loadUnderlyingBarsFullHistory`, `loadUnderlyingBarsFrom`,
  `loadUnderlyingBarsForRange` (context-clamped both edges — the single clamp site),
  `ensureContextCoverage` (the single coverage/restore site), `addPadDays`, `resetPadDays`.
  Store: 412 ? ~270 lines; feature decomposition matches `withCatalogMethods`/`withPlottedContracts`.
- **`plotted-window.utils.ts`** — `contextAnchor()` returns `{earliest, symbol}` in one scan
  (replaces the re-scan `.find()`); `earliestPickDate` delegates to it; `contextCoverage`
  re-keyed on `FetchRange` with a discriminated-union result (`from` exists only when
  uncovered — no lying field).
- **`plotted-contracts-feature.ts`** — `ensureContextWindow` collapsed to
  `s.ensureContextCoverage()` calls; redundant `focusPlotted` focus double-write removed;
  `getMarketDatePT`/`contextCoverage` imports dropped.
- Dead imports removed (`OhlcBar`, `ContractCatalogEntry`).

Consequence of clamping the contract-load fetch to context on both edges: drill-down
*never narrows* the underlying at all, so `clearChartFocus`/`removePlotted` restores only
fire for genuinely narrow or foreign ranges (spec'd with a SPY contract over a QQQ set).

## Second-pass verdicts per axis

- **Standards:** all pass-1 fixes confirmed; only minors/nits (addressed above or deferred below).
- **Spec:** all six ACs still MET end-to-end; the four findings above were the spec-level gaps.
- **Thermo-nuclear:** extraction seam verified clean; the weekend-coverage and focus-trap
  items were its majors — coverage fixed; **focus-trap** (`chartFocusContractId` set by every
  contract load, UI back-affordance not yet wired) confirmed sibling-task scope (#1362/#1363),
  unchanged disposition.

## Still deferred (unchanged)

- 838-line page component (`option-chart.component.ts`) — mostly pre-existing; projection
  block is a named follow-up extraction.
- Stale `contractData` chrome in set view (TN-5) — thread-level follow-up.
- `plottedLoadProgress` transient inaccuracy on overlapping `loadPlotted` batches — cosmetic.
- `occIdInput` doubles as "last loaded id" — pre-existing naming lie, noted.
- Bare-set removal after drill-down leaves narrowed bars — bounded edge case, no dated set
  means no context obligation.

## Second-pass test results

- Touched sweep: **150 suites / 2,927 tests — PASS** (+3 specs: bar-fetch error keeps bars,
  foreign-contract restore, failed-foreign set-symbol restore)
- `tsc -p tsconfig.app.json --noEmit` — clean for the change set
- `npx tsc --noEmit` (whole repo incl. `scripts/`): two errors in
  `scripts/bulk-swing-sweep.ts` (`FirebaseFirestore` namespace) and
  `indicator-config-dialog.component.ts` — **unchanged files, pre-existing at HEAD,
  other-task scope** — flagged, not this task's diff.

## Verdict (reaffirmed)

**PASS** — second pass found real gaps in the coverage seam, all remediated with covering
specs; the requested-range coverage model is now provably weekend-safe and symbol-scoped.
No third pass needed: the remaining items are minors with stated dispositions or
sibling-task scope.
