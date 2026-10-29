**Topic:** Scanner Chart View  
**Topic Slug:** chart-review  
**Thread:** Chart View Extension  
**Thread Slug:** scanner-chart-view  
**Issue:** #1249  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1313  
**Domain:** CHART-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — #1313 Pane enrichment (company names + row data)

CHORE filed from #1258 QA. Two review rounds, three axes in parallel
(Standards / Spec / Thermo-nuclear); all actionable findings remediated
in-tree.

## Round 1 (initial diff)

## Standards

**Findings — all remediated:**

1. **(major) Duplicated fetch logic** — bespoke `loadSymbolNames` +
   `symbolNameMap` + `SignalService.getAllSymbols` reimplemented what
   `SymbolListStore.profilesBySymbol` already owns (session-cached,
   in-flight-deduped, uppercase-keyed `Map<symbol, StSymbolProfile>` —
   `symbol-profiles.feature.ts`). → Replaced: `ngOnInit` calls
   `symbolListStore.loadProfiles()`; `paneRowMeta` reads
   `profilesBySymbol().get(sym.toUpperCase())?.name`. ~20 lines and a
   redundant collection read deleted; page back under the 400-line
   threshold (382).
2. **(major) Canonical type redeclared 3×** — `{name?; detail?}` spelled
   inline at `signal-list.component.ts`, `chart-view.component.ts`, and
   the spec mock. → All sites use the exported `ScanRowMeta`.
3. **(minor) Duplicated CSS** — `.row-name` was byte-identical to
   `.signal-line-2`. → Selectors merged.
4. **(nit) `p.name as string` cast** — gone with `loadSymbolNames`.

Contract baseline: clean — `firstValueFrom(getAllSymbols())` one-shot
read pattern matches the store's own usage (now reused rather than
duplicated).

## Spec

| AC | Verdict | Evidence |
|---|---|---|
| Ticker + company name when resolvable; degrade ticker-only | MET | `paneRowMeta` (chart-view.component.ts); `.row-name` render gated on `item.name`; GHOST-row spec |
| Batch/reuse name resolution, no per-row storm | MET | one `loadProfiles()` → `getAllSymbols()` collection read per session; per-doc `getDoc` only fires for the *selected* symbol (pre-existing behavior) |
| ≥1 recipe-relevant column alongside ticker | MET | `detail = "{sort.column}: {displayCell}"` — canonicalization + percent rescale + magnitude formatting |
| Specs for precedence + rendering | MET | `scanPaneMeta` describe (6 its), page precedence spec, list-source spec, signal-list render spec |

**Adjudicated, kept as-is:**

- *Names on list-source rows* — beyond the letter of the AC ("scan pane
  rows") but strictly additive and uniform; flagged in the implement
  handoff, kept.
- *'Name' column hardcode* — the wire returns `columns['Name']` for free
  (live capture dep-prev-scan-01 verified); the recipe model can't
  request alternate name keys, so honoring "when the recipe requests
  one" reduces to the literal key.
- *Enabled-only profile coverage* — `getAllSymbols` filters
  `enabled==true`; a disabled tracked symbol degrades to ticker-only.
  AC's degrade clause covers it.
- *RH fallback absent* — "if needed" per the issue; degrade covers it.

## Thermo-nuclear

**Findings — all remediated:**

1. **(major) `paneRowMeta` rebuilt the whole run-meta map on selection
   churn** — `symbolNameCache` writes twice per selection and was a
   dependency of the merge computed. → Split into `paneScanMeta`
   (depends only on `latestRuns` + `activeList`) and a cheap per-symbol
   merge; the `symbolNameCache` tier was dropped entirely (see #3).
2. **(major) bespoke `'scan:'` parsing** — `startsWith`/`slice` duped
   `scanSourceRecipeId` (`common/constants.ts`). → Helper used.
3. **(minor) third precedence tier exceeded the AC** — `symbolNameCache`
   is only populated for the *selected* symbol, so names popped in on
   click. → Tier dropped; precedence is now wire `Name` →
   `profilesBySymbol` → ticker-only (AC's (a) → (b) → degrade).
4. **(minor) last-wins vs first-wins dup tickers** — `meta.set`
   clobbered while the pane dedupes first-wins. → `meta.has` guard +
   spec case.
5. **(nit) `wireRowToScanRow` guard asymmetry** — drops
   `parseScanRows`' `typeof ticker` check; safe only because
   `parseScanLatestRun` validates cached docs. → JSDoc precondition
   documented.

## Test results (round 1)

- Focused suites (post-remediation): **77/77** — scanner-rows.util,
  signal-list, chart-view page, viewport, toolbar.
- Full suite: **275/275 suites, 4,757 tests** — all green.
- `tsc --noEmit -p tsconfig.app.json`: clean.

## Round 2 (post-remediation re-review)

All three axes re-verified the remediations and confirmed them clean.
One **new** finding, the highest-value catch of the review:

- **(major) strictTemplates build break** — `items()` returned a union
  where the manual-history branch lacks `name`/`detail`; `isHistoryRow`
  widens to `boolean` so the template's `@else` narrowing doesn't
  discriminate → `TS2339` on `item.name`/`item.detail`. Invisible to
  jest (jest-preset-angular doesn't typecheck templates) and to
  `tsc --noEmit` (no template checking). Confirmed by `ng build` failing,
  then fixed: `SignalListRow` interface declared in
  `signal-list.component.ts` and `items()` annotated `SignalListRow[]`
  so both branches share the contract. `ng build` now clean.

**Adjudicated, not fixed:**

- *(low)* `symbolNameCache`/getDoc could consult `profilesBySymbol`
  first — a micro-optimization on pre-existing #1256 code that also
  covers disabled docs; out of scope.
- *(low)* twin fetch-effects in signal-list — pre-existing pattern.
- *(low)* raw-case `tracked.has(t)` vs uppercase profile keys —
  cosmetic; RH tickers are uppercase; `sym.toUpperCase()` lookup is
  already applied where it matters.
- *(nit)* `jasmine.createSpy` in signal-list spec — matches the file's
  pre-existing style.
- *(nit)* `normScanSymbol` "shared membership policy" comment —
  accurate for its callers; the pane's raw-ticker keying is internal
  consistency, not a violation.

## Test results (final tree)

- Focused suites: **77/77** after the `SignalListRow` fix.
- `ng build --configuration development`: **clean** (strictTemplates
  satisfied).
- `tsc --noEmit -p tsconfig.app.json`: clean.
- Full suite was green at 4,757 on the pre-annotation tree; the
  `SignalListRow` change is type-level only (no runtime effect) and its
  consumers are covered by the focused suites.

## Verdict

**PASS** — all ACs met; every critical/major finding across both rounds
remediated and verified; remaining findings are low/nit on pre-existing
code or adjudicated above. No further round needed.
