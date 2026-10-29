**Topic:** Scanner Chart View  
**Topic Slug:** chart-review  
**Thread:** Chart View Extension  
**Thread Slug:** scanner-chart-view  
**Issue:** #1259  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1259  
**Domain:** CHART-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — #1259 Ephemeral RH charts for untracked symbols

F5: `RobinhoodMcpClient.getEquityHistoricals` (ToolSpec) → new
`RhChartService.loadBars$` (D/W/M ~10y → ChartDataset, `version: ''`) →
`ChartStore.loadCharts` tracked/untracked fork with symbol-data-empty
fallback. One review round, three axes in parallel (Standards / Spec /
Thermo-nuclear); all actionable findings remediated in-tree.

## Verdict: **PASS**

| AC | Verdict | Evidence |
|---|---|---|
| `getEquityHistoricals` — tool/args, bars→OhlcBar, errors | MET* | `equityHistoricalsSpec` mirrors `previewScanSpec`; client spec: exact args, end_time passthrough, payload, failure + malformed throws. *Mapping lives in `equityWireBarToOhlc` (service) — documented as-built deviation; AC met in substance |
| `loadBars$` three-interval shape, `version: ''` | MET | forkJoin day/week/month ~10y; spec asserts shape + `version:''` |
| Fork on `trackedSymbols`; untracked never triggers `loadIfNeeded` | MET | `version:''` → `if(version)` guard unreachable on RH arm; spec asserts NOT-called |
| Empty symbol-data → RH fallback | MET | `switchMap(r => r.version === '' ? rh : of(r))`; `''` confirmed as the exact no-data signal in chart.service |
| Interpolated bars kept | MET | flag dropped, bar kept; spec'd |
| Rapid switching cancels RH loads | MET | `barsSub` covers both arms + switchMap inner; spec'd incl. mid-fallback |
| Specs per FE test plan | MET | 16 new specs (client 5, service 6, store 8); positive `loadIfNeeded` assertion added in remediation |

## Findings → remediations

| Finding | Severity | Disposition |
|---|---|---|
| `length === 0` universe check conflated "not loaded" with "loaded+empty" and made rendering nav-history-dependent (thermo MINOR-2) | minor | **Fixed** — `trackedStatus() !== 'ready'` gates the fork; correct semantic, same behavior |
| No symbol normalization at store boundary — three downstream checks (universe `includes`, Firestore doc id, RH echo match) assumed uppercase (thermo MINOR-4) | minor | **Fixed** — `sym = symbol.trim().toUpperCase()` used for patchState, both services, `loadIfNeeded` (sibling `normalizeSymbol` precedent); +spec |
| Wire bars unsorted (standards M2) | minor | **Fixed** — `.sort` by `d` before PriceBar mapping, sibling-matching |
| Spec gap: no positive `loadIfNeeded` assertion (spec axis) | minor | **Fixed** — full-args assertion on tracked path |
| Spec gap: mid-fallback (`switchMap` inner) cancellation untested (thermo NIT-4) | minor | **Fixed** — `rhPending.observed` teardown spec |
| Store header docstring stale (standards N1) | nit | **Fixed** |
| symbol-data **failures** mask as empty → silent RH degrade (thermo MINOR-1) | minor | Adjudicated — `chart.service` already console.warns the failure; degraded chart beats blank chart; store comment documents it as deliberate. A failure/success discriminator on the result would be the real fix — out of scope |
| `toDataset`/empty-dataset duplication vs chart.service (standards M1) | minor | Adjudicated — ~12 lines, both sides spec'd; extraction risk > drift risk for now |
| 3 eager unabortable calls per load; `executeBatch` could ride one POST (standards N3/thermo MINOR-3) | minor | Adjudicated — calls fire exactly at subscribe, no waste; batch would add per-slot failure complexity for marginal gain. Noted for future |
| `Number()`/`slice(0,10)` unvalidated wire fields (thermo NIT-1) | nit | Skip — contract-verified wire shape (#1304 captures) |
| `trackedStatus: 'error'` unreachable upstream — `getTrackedSymbols$` catchError resolves `[]` as 'ready' (thermo NIT-2) | nit | **Pre-existing store bug, out of scope** — benign for this fork (empty→symbol-data-first is desired); flag for a future triage task |
| Transient NEW-chip/fork divergence during universe load (thermo NIT-3) | nit | Cosmetic, self-resolving |

## Verified claims

- `version === ''` is the exact "no usable symbol-data" signal (null result, catchError path, empty shards) — no false positive on real data
- `if (version)` guard makes `loadIfNeeded` unreachable on the RH arm — airtight
- Galleries use `GalleryCardChartStore`, not `ChartStore` — untouched
- QuickCharts/sandbox keep pre-fork behavior via the `ready` gate

## Test results

- Focused: **179/179** (chart.store, rh-chart, robinhood-mcp-client, flex-chart-sandbox incl. prior-pass suites)
- Prior blast-radius run: 26/26 suites, 469 tests green
- `tsc --noEmit` clean · `ng build` clean

---

# Round 2 — 2026-10-28

Three axes re-run on the post-remediation changeset; each axis briefed on
round-1 dispositions so only **new** findings surfaced.

## Verdict: **PASS** (after remediation)

### New findings → dispositions

| Finding | Axis / severity | Disposition |
|---|---|---|
| `loadCharts` reads `trackedStatus()`/`trackedSymbols()` synchronously — when a caller invokes it inside `effect()` (SignalDetail does, flex-sandbox does), those reads become effect deps → **universe resolving mid-flight cancels + refires the load, possibly flipping data-source arms** | thermo **major** | **Fixed** — fork reads wrapped in `untracked()`; regression spec uses real `signal()` mocks inside a real `effect()` and was verified to fail without the fix (`runs` 1→2) |
| Store normalized `sym` but `IndicatorSeriesStore` keyed `loadIfNeeded` under it while consumers `responseFor` with raw input → latent silent indicator miss on non-uppercase input | thermo minor / standards minor | **Fixed** — normalize inside `cacheKey` (one funnel covering `loadIfNeeded`/`responseFor`/`loadingFor`/`errorFor`) + `clearCache` arg + callable request symbol |
| Whitespace-only symbol slipped `!symbol` guard → `sym=''` → 3 doomed MCP calls for `['']` + `selectedSymbol: ''` | thermo minor / standards minor / spec low | **Fixed** — normalize-then-gate (`!sym`); +spec |
| Bar-sort remediation had no spec — deleting `bars.sort` failed no test | standards minor / spec low | **Fixed** — out-of-order wire spec asserts ascending + dateRange |
| `toDataset` `find()` echo-mismatch/absent entry → silent empty chart, `error: null` | thermo minor | **Fixed** — `console.warn` lists returned symbols when the requested one is absent; +spec |
| `Number()` on malformed wire prices → `NaN` into PriceBar/scale math | standards nit | Skip — contract-verified wire shape; consistent with round-1 adjudication |
| `args.symbols` sent raw vs siblings' trim/filter/dedupe; "≤10" docstring unenforced | standards nit | Skip — all callers pass one normalized symbol; server validates |
| `executeBatch` (one POST, per-interval degrade) vs `forkJoin` all-or-nothing | thermo minor / standards N3 | Kept — partial D/W/M is explicitly undesirable; batch re-adjudicated to round-1 decision |
| `toolError` envelope branch unspec'd for single-call path | spec info | Noted — transitive coverage via shared `parseSpecResult` |

### Round-2 verification

- Focused consumers set: **9/9 suites, 211/211 tests** (chart.store, rh-chart, indicator-series, robinhood-mcp-client, flex-chart-sandbox, quick-charts ×2, signal-detail, gallery-card-chart)
- `untracked` regression spec proven non-vacuous (fails `runs` 1→2 without the fix)
- `tsc --noEmit`: 2 errors in `scripts/bulk-swing-sweep.ts` + `indicator-config-dialog.component.ts` — both **unmodified pre-existing HEAD files outside the changeset**
- New specs: +4 store (whitespace guard, effect-race regression, +2) / +2 rh-chart (sort, warn) — 23 #1259 specs total
