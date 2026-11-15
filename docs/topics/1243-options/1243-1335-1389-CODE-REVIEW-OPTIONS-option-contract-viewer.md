**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1335  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1389  
**Domain:** OPTIONS  
**Type:** CODE REVIEW  
**Status:** Complete  
**Created:** 2026-11-12  
**Last Updated:** 2026-11-12  

# Code Review — #1389 Study-range bound filters plotted chart set

**Scope (hunk-scoped, working tree is mixed):** `option-group-generator.utils.ts` (`openDateWithinBound`), `option-chart.component.ts` (bound filter in `plottedChartSeries`, `chipColorIndex` re-derivation, `chartHighlight` gate, `boundHiddenIds`), `option-chart.component.html` (highlight binding + `.bound-hidden` class), `option-chart.component.scss` (`.bound-hidden` style), plus spec additions in both sibling spec files. Excluded: `this.list.bindResultsDeepLink()` — belongs to #1431/#1471's uncommitted work.

## Round 1 — three-axis findings (2026-11-12)

### Standards — clean, no hard violations

- No external SDK calls (pure predicate + projection + specs).
- Mild **Message Chains** judgement call: `genStore.refine().aliveRange` reaches two levels into another store's shape — matches how the band's `[activeStudyRange]` input already reads it (component.html:582), so consistent, not a new smell.
- `aliveRange` semantic overload: one store field now drives two predicates — the drawer's alive-across refine and the chart's opened-within. Well-commented at both sites; intended per the issue.
- `chipContracts` doc claims the strip "never advertises contracts that aren't on screen" — stale under bound-hiding (fixed in Round 2 via `.bound-hidden` + comment).
- File size: `option-chart.component.ts` ~440 lines — pre-existing composition-root shape, diff adds ~40.
- Test conventions: new specs follow the file's `setup()`/`jest.fn`/`flush()`/zoneless patterns.

### Spec — all ACs met; AC4 holds by surface-orthogonality

| AC | Verdict | Evidence |
|---|---|---|
| Bound hides out-of-range open dates; clearing restores | **MET** | `plottedChartSeries` filter; plottedContracts untouched (spec: hide/keep + clear-restores) |
| Bare-id → first-observation proxy | **MET** | `s.points[0]?.date`; `renderedSeries` never clips bare-id entries so points[0] is the true first obs |
| Series survive unchanged; marker dots + clip-to-entry apply to visible | **MET** | `markerSpans` derives from filtered input; points flow through position-mode clip first (spec: clip composition) |
| Composes with display type/expiry filters + Clip to entry | **MET (vacuous for type/expiry)** | No plotted-set type/expiry filters exist — `displayType`/`selectedExpirations`/`expMin/Max` only filter the catalog table (`displayedRows`). Composition holds by surface-orthogonality; clip composition spec'd. Flagged for AC-intent confirmation. |
| Specs: dated+undated, boundaries, clear-restore, no-bound | **MET** | utils spec (5) + component spec (12 incl. Round-2 pins) |

No unjustified scope creep — `chipColorIndex` rework is required by the bound (tagged + spec'd).

### Thermo-nuclear

Seam verdict: **page-projection is correct** — store seam would couple root→page-scoped stores; chart seam would diverge chips/axis further.

| # | Severity | Finding |
|---|---|---|
| F1 | MAJOR | Axis domain doesn't shrink: `allDates` unions hidden contracts' dates + marker endpoints + underlying-window anchor; `initVisibleRange` resets to the full domain on every bound change. "Isolate the cohort" doesn't re-fit the view. **Needs product decision (Q1).** |
| F2 | MAJOR | Hover/pin on a bound-hidden chip → `highlightedContractId` matches no series → every visible line dims; a pin survives `applyRange` → unexplained persistent all-dim. **FIXED in Round 2.** |
| F3 | MAJOR (design) | Generator flow footgun: brush → alive-across refine → bare-id Send → bare-id proxy = `firstObserved ≤ bound.start` → most/all of the sent set hides. `useRangeAsOpenDate` is the intended disambiguator but nothing warns the user. **Needs product decision (Q2).** |
| F4 | MINOR | `points[0]` assumes chronological wire order — same assumption `padObservations`/`nearestIndexByDate` already make; comment added. Acceptable per scope discipline. |
| F5 | MINOR | Hidden chips indistinguishable; `?? 0` swatch fallback collides with visible series-0 color. **FIXED in Round 2** (`.bound-hidden` dimming + `boundHiddenIds`). |
| F6 | MINOR | `setRefine` accepts `aliveRange` unvalidated — latent write path, no current caller passes it. Noted, not hardened (scope discipline). |
| F7 | NIT | Multi-pick semantics: only the earliest pick counts (`openDate = dates[0]`). A contract picked 05-01 AND 06-10 hides under [06-01,06-30]. Spec-faithful ("entry/open date") but worth confirming intent **(Q3)**. |
| F8 | NIT | `hasEntryDates` now gates on the displayed set — clip button tracks visible contracts. Acceptable. |

## Round 2 — convergence fixes (2026-11-12)

**F2 fix** — new `chartHighlight` computed gates the chart's `highlightedContractId` input to the displayed-id set (`chipColorIndex().has(id)`); template binds `chartHighlight()` instead of `store.highlightedContractId()`. Store keeps the hover/pin — clearing the bound re-engages the highlight on the returning line (spec'd: hidden-chip hover suppressed, visible passes; pin suppressed while hidden, re-engages on clear).

**F5 fix** — `boundHiddenIds` computed (non-error plotted contracts not in the displayed input) + `.bound-hidden` chip class (opacity 0.45, matching `.underlying-chip.off` convention). Hidden contracts keep their chip — they're still in the set — but no longer claim a rendered line or collide on palette-0.

**Added specs** (component spec, +5): hidden-chip hover suppression, pin-survives-bound re-engage, `boundHiddenIds` mark/clear, all-hidden empty input with set intact, chip-color realignment (Round 1).

## Round 3 — user decisions on F1/F3/F7 (2026-11-12)

**Q1 (F1) → resolved: keep the full domain.** The user confirmed the axis keeps hidden contracts' dates/expirations deliberately — underlying-bar add/remove work lands next and owns that clip behavior. Pinned with a spec asserting `chartAxisLabels` is unchanged under a bound.

**Q2 (F3) → resolved: auto-fill openDate = bound.start on generator send.** `store.emit()` and the drawer's `sendLines` now derive `openDate() || refine().aliveRange?.start` — a brushed bare send lands dated at bound.start and stays visible; an explicit openDate still wins. Specs cover both directions.

**Q3 (F7) → resolved: position-granular.** The brush is about start dates; each pick is a separate position sharing the contract. `boundVisible` (new private projection step):
- contract visible iff ANY pick opened within the bound (bare-id contracts keep the first-observation proxy)
- projected `openDate` = earliest in-bound pick; `markerDates` = in-bound picks only — the out-of-bound positions do not render
- position mode clips at the shown position's open (in-bound pick), not the earliest pick

**Added specs** (+5 component, +2 store): any-pick-within visibility + in-bound-only markers/open date, all-picks-outside hides, position-mode clip at the in-bound pick, axis-domain pin, emit bound-start auto-fill, explicit-openDate precedence.

## Round 4 — convergence pass (2026-11-12)

Re-reviewed the Round-3 diff specifically (`boundVisible`, emit auto-fill, all consumers).

- **Found + fixed (minor):** chip `chip-open-date` still showed `entry.openDate` — the earliest pick — while the chart renders only the in-bound position under a bound. A [05-01, 06-10] contract under [06-01, 06-30] rendered a 06-10 marker beside a chip reading 05-01. `chipOpenDate` now resolves through a `displayedOpenDate` map over `plottedChartSeries` (falls back to `entry.openDate` for hidden/unplotted chips). Spec'd.
- **Verified clean:** earliest-in-bound ordering (markerDates sorted upstream), position-mode clip is a strict subset of the upstream clip, `boundHiddenIds`/`chartHighlight`/`chipColorIndex` all consume displayed ids consistently, `emit`/`sendLines` derivations identical, focused view exempt, DOM spec passes with the template change.
- **Known-not-fixed (documented, deliberate):** `setRefine` accepts `aliveRange` unvalidated (latent write path, no caller); hidden-chip swatch falls back to palette-0 (whole chip renders at 45% opacity — no line-color claim is made).

## Test results

- Savant-trader suites: **3347/3347 tests, 168/168 suites** — green (3348 after Round-4 spec)
- Focused: `option-chart.component.spec.ts` 53/53; `option-group-generator.store.spec.ts` 22/22; all 10 option-chart/generator suites 262/262 incl. DOM; `tsc -p tsconfig.app.json` clean

## Verdict

**PASS** — all five ACs met, both Round-2 defects fixed, all three Round-3 semantic decisions implemented and spec'd, Round-4 display nit resolved. Standards clean; no unresolved majors. Converged — further passes would only revisit already-documented minors.
