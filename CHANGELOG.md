# Changelog

## [2026-10-29]

### Added
- [Options Backtest] 1238-1284_FE-IMPL-BACKTEST: `optionsReplayStart` callable wiring — `OptionsReplayRunsService.startReplay` (httpsCallable + runInInjectionContext) + `OptionsReplayStore.startReplay` (success selects the new runId → detail panel streams list docs; failure snack-bars, selection untouched)
- [Options Backtest] 1238-1284_FE-IMPL-BACKTEST: `options-replay-new-run-dialog` — ReactiveForms template picker bound to `REPLAY_TEMPLATES` (name + description per option, `mat-select-trigger` name-only), free-text symbols (deviation: `trackedSymbols` would over-constrain), `marketDateValidator` for impossible dates; 7 specs
- [Options Backtest] 1238-1284_FE-IMPL-BACKTEST: "New Replay" button entry point in the replay section header — sim dialog/controls untouched
- [Options Backtest] 1238-1284_DOCS-BACKTEST: #1284 CODE-REVIEW (PASS, 0 findings; pass-2 mat-select-trigger fix) + #1324 UAT (Complete; 16/16) + IMPL-FE §2 as-built
- [Options Backtest] 1238-1285_FE-IMPL-BACKTEST: `options-replay-contract-list-table` — pure presentational over `ContractListRow[]`, entryDate-sorted, all pick columns + merged bid/ask, `no-selection` marker rows in place with reason labels, `↻ repeat` badge on `repeatsPrevious` rows, `pickDocMeta` coverage header; 8 specs
- [Options Backtest] 1238-1285_FE-IMPL-BACKTEST: `options-replay-contract-series-dialog` — lazy `getHistoricalOptionsContract$(symbol, contractId)` fetch (exact contract, no client persistence), loading → inline-SVG mark polyline / single-obs dot / empty / error naming the contractId; 6 specs
- [Options Backtest] 1238-1285_FE-IMPL-BACKTEST: Run-detail integration — collapsed-by-default row-count toggle per symbol card, inspect → series dialog `{symbol, contractId, entryDate}`; `MatDialogModule` omitted from host imports (element-injector shadowing); 2 specs
- [Options Backtest] 1238-1285_DOCS-BACKTEST: #1285 CODE-REVIEW (PASS, 2 passes, 0 unresolved) + #1327 UAT (Complete; 19/19) + IMPL-FE §4 as-built
- [Scanner Chart View] 1232-1259_FE-IMPL-CHART-REVIEW: `RobinhoodMcpClient.getEquityHistoricals` — `get_equity_historicals` ToolSpec (bounds regular, split-adjusted, `end_time?`), wire payload passes verbatim; 5 specs
- [Scanner Chart View] 1232-1259_FE-IMPL-CHART-REVIEW: `RhChartService` — day/week/month forkJoin over ~10y → exact `ChartService.loadBars$` shape with `version:''` (indicators cleanly skipped); `equityWireBarToOhlc` keeps interpolated bars; 6 specs
- [Scanner Chart View] 1232-1259_FE-IMPL-CHART-REVIEW: `ChartStore.loadCharts` tracked/untracked fork — `untracked()` point-in-time read on `trackedStatus` (late-resolving universe can't re-fire mid-flight), symbol normalization, `version==''` → RH fallback for empty tracked symbol-data, empty-universe pre-fork behavior for QuickCharts/galleries; 6+ fork specs
- [Scanner Chart View] 1232-1259_DOCS-CHART-REVIEW: #1259 CODE-REVIEW (PASS, 2 passes, 0 unresolved) + #1330 UAT (Complete; 19/19) + IMPL-FE as-built
- [Option Contract Time-Series Viewer] 1243-1337_SHARED-IMPL-OPTIONS: `partnerContractAvailabilityV1` wire types — `ContractAvailabilityRequest` (explicit-expirations override, strikeStep, firstObserved bounds), `ContractAvailabilityEntry` (firstObserved/lastObserved + latest snapshot), `ContractAvailabilityResponse` (count/truncated/corpusDates)
- [Option Contract Time-Series Viewer] 1243-1337_FE-IMPL-OPTIONS: OCC generator utils — `toAvailabilityQuery` (explicit list > range, BOTH/strikeStep:0 omitted, symbol normalize), `refineContracts` (all axes AND + alive-across-range), `toPairLines` (deterministic `date,id`/bare emission); `rs-optgen:{SYMBOL}` versioned per-symbol settings blob (sanitized load, openDate unpersistable, wrapped storage); 31 specs
- [Option Contract Time-Series Viewer] 1243-1329_DOCS-OPTIONS: OCC string generator thread planning — PRD + FE/BE IMPL + FE/BE TEST docs
- [Option Contract Time-Series Viewer] 1243-1337_DOCS-OPTIONS: #1337 CODE-REVIEW (PASS, 2 passes, review majors fixed in-gate) + #1341 UAT (Complete; 10/10) + changelog

### Removed
- [ST Firestore Reorg] 984-1019_BE-CHORE-DATA-PIPELINE: `savant-trader/data/symbols` archived (33,282 docs → `functions/scripts/output/legacy-archive-1013/savant-trader-symbols.json`) + deleted — last legacy root under `savant-trader/data` retired; dead `symbols`/`run-ids`/`signal-history` index entries dropped; legacy-reading relays (1000/1001/1019/1159) unregistered + marked retired

## [2026-10-28]

### Added
- [RH Scanner] 1098-1304_SHARED-IMPL-SAVANT-TRADER: `get_equity_historicals` wire contract in `@robinhood-mcp/contracts` — `symbols[]`+`start_time` request, `data.results[] → bars[]` response, 18-value `EquityHistoricalInterval` union, honest required/optional fielding vs all 11 captures, `guide?`/`interpolated?` conditional fields
- [RH Scanner] 1098-1304_SHARED-IMPL-SAVANT-TRADER: Contract verification — offline capture-parity script (bidirectional `Record<keyof>` key diffs, run-all registered) + live executor probe (unregistered per #682 convention) + task guide + index row
- [RH Scanner] 1098-1304_DOCS-SAVANT-TRADER: #1304 CODE-REVIEW (PASS after remediation, 3 axes, 2 passes) + #1314 UAT (Complete, S1–S4) + thread planning docs (PRD/IMPL/TEST, ADR-011) + Untracked Symbol term
- [Option Contract Time-Series Viewer] 1243-1321_FE-UIFIX-OPTIONS: Post-ship polish — Underlying toggle + pad buttons restored in plotted mode, ResizeObserver→refresh for stale-width overflow, `padDateLabels` makes +20d/+50d extend the axis, `loadPlotted` replace semantics (edited list is authoritative), legend removed for an underlying chip + larger swatches
- [Option Contract Time-Series Viewer] 1243-1265_FE-IMPL-OPTIONS: Connected chip↔series hover — `seriesHovered` output maps Syncfusion mark/marker/legend element ids to the contract id (mark-ordinal + series-index keyed, label-collision safe), page wires it to `hoveredContractId` so chart hover lights the chip; deduped emits, stale-hover reset, no refetch
- [Option Contract Time-Series Viewer] 1243-1265_DOCS-OPTIONS: #1265 CODE-REVIEW (PASS, 3 axes, mapping fixes remediated) + #1315 UAT (Complete; H1–H8) + Topic as-built
- [Option Contract Time-Series Viewer] 1243-1264_FE-IMPL-OPTIONS: Multi-pair paste input (bare OCC IDs + `YYYY-MM-DD,<id>` pairs), rejection surfacing with reasons, >50 confirm dialog + `Loaded X/Y` progress, plotted-set chips (swatch/label/open-date/remove), crosshair un-pinned + right-edge underlying-price label, chip-hover series highlight, panel collapse inside header
- [Option Contract Time-Series Viewer] 1243-1264_DOCS-OPTIONS: #1264 CODE-REVIEW (PASS, 2 passes) + #1292 UAT (Complete, S1–S10 all PASS)
- [Savant Design System] 1024-1213_FE-IMPL-DESIGN-SYSTEM: 10 `--theme-*` compat aliases re-pointed onto `--ds-*` (6 previously-undefined names — heatmaps/dashboard-v3/rs-chart-view silent drops fixed), 3 missing `--mat-sys` bridge keys per theme (background/surface-variant/warning)
- [Savant Design System] 1024-1213_DOCS-DESIGN-SYSTEM: #1213 CODE-REVIEW (PASS, 2 rounds) + #1298 UAT (automated green; S1–S9 visual deferred to phase-level pass)
- [Savant Design System] 1024-1214_DOCS-DESIGN-SYSTEM: #1214 CODE-REVIEW (PASS, 3 axes) + #1311 UAT (automated green; D1–D14 visual deferred to phase-level pass)
- [Savant Design System] 1024-1215_DOCS-DESIGN-SYSTEM: #1215 CODE-REVIEW (PASS, 3 axes + convergence round; 2 majors remediated) + #1317 UAT (automated green; D1–D6 visual deferred to phase-level pass)
- [Savant Design System] 1024-1216_DOCS-DESIGN-SYSTEM: #1216 CODE-REVIEW (PASS, 3 axes; 4 minors remediated) + #1323 UAT (automated green; D1–D3 visual deferred to phase-level pass)
- [Savant Design System] 1024-1217_DOCS-DESIGN-SYSTEM: #1217 CODE-REVIEW (PASS, 3 axes; all minors resolved in-implementation) + #1328 UAT (automated green; D1–D5 visual deferred to phase-level pass)
- [ST Firestore Reorg] 984-1013_BE-IMPL-DATA-PIPELINE: Archive+delete op (atomic writes, validated delete gate, resumable), positional parity relay, raw-quotes backfill, 48-test legacy-roots pin spec
- [ST Firestore Reorg] 984-1013_DOCS-DATA-PIPELINE: IMPL/TEST as-built sync, st-cloud-function README update, #1013 CODE-REVIEW (PASS, 1 round) + #1237 UAT (Complete, 8/8)
- [ST Firestore Reorg] 984-1159_BE-IMPL-DATA-PIPELINE: st-runs-symbols-cutover-1159 pin spec — ingest jobs/run-ids split, writer dual refs, service path contracts, TTL membership
- [ST Firestore Reorg] 984-1159_BE-IMPL-DATA-PIPELINE: verbatim migrator (updateTime direction guard for post-deploy straggler re-runs) + parity relay with empty-legacy floors — 245 runs, 24,076 jobs, 926 symbols applied, 9/9 green
- [ST Firestore Reorg] 984-1159_DOCS-DATA-PIPELINE: #1159 CODE-REVIEW (PASS, 1 round remediated) + #1310 UAT (Complete; relay caught overnight PDR drift → straggler re-sync) + as-built entries
- [Options Backtest] 1238-1281_BE-IMPL-BACKTEST: `optionsReplayStart` callable — validate → pending run doc → running-before-fanout → per-symbol task enqueue; ReplayStartDeps seam, boundary-coerced invalid-argument, fail-fast enqueue semantics
- [Options Backtest] 1238-1281_BE-IMPL-BACKTEST: 8 deps-seamed unit tests (validation, fanout shape, effect ordering, failure path) — test:options-replay now globs the suite dir, 17/17
- [Options Backtest] 1238-1281_DOCS-BACKTEST: #1281 CODE-REVIEW (PASS, 2 convergence fixes) + #1312 UAT (Complete; 8/8) + IMPL-BE §1/§5 as-built
- [Options Backtest] 1238-1280_BE-IMPL-BACKTEST: `optionsReplayPermutation` worker + pure `mapPickDocToRows` — per-symbol pick-doc → contract-list rows with convergent `listOutcomes` close-out, 404/unknown-template permanent vs transient retry split, `resolveRunCloseOut` counter math; 21 new tests, 38/38 suite
- [Options Backtest] 1238-1280_DOCS-BACKTEST: #1280 CODE-REVIEW (PASS, 3 convergence fixes) + #1318 UAT (Complete; 16/16) + IMPL-BE §2/§4 as-built
- [Options Backtest] 1238-1283_FE-IMPL-BACKTEST: Selection Replay FE surface — `OptionsReplayRunsService` + dedicated `OptionsReplayStore`, runs list (template name from `REPLAY_TEMPLATES`, progress bar, failed badge), run-detail shell with per-symbol status cards, additive dashboard section (sim untouched); 22 specs, 21/21 green
- [Options Backtest] 1238-1283_DOCS-BACKTEST: #1283 CODE-REVIEW (PASS) + #1320 UAT (Complete; 15/15) + FE blueprint docs first commit + IMPL-FE as-built
- [Scanner Chart View] 1232-1258_FE-IMPL-CHART-REVIEW: LatestRunStore + ScannerService.listLatestRuns — latest-run cache into Map<recipeId, ScanLatestRun>, drift-skip + doc-id guard, catalog-joined scanOptions with ranAt + truncation cap
- [Scanner Chart View] 1232-1258_FE-IMPL-CHART-REVIEW: scan:{recipeId} viewport source + New-only filter — cached rows→tickers (deduped), default-on tracked filter, lazy tracked-universe load, list sources unaffected
- [Scanner Chart View] 1232-1258_FE-IMPL-CHART-REVIEW: Scan dropdown + New-only pill — '—' clear sentinel, ghost-scan escape, single active source slot, DS pill-toggle affordance
- [Scanner Chart View] 1232-1258_FE-IMPL-CHART-REVIEW: Page wiring — loadLatestRuns on init, prevViewport escape guard (dropped-index neighbor advance), untracked rows get NEW chip
- [Scanner Chart View] 1232-1313_FE-CHORE-CHART-REVIEW: Scan-row metadata helpers — `wireRowToScanRow` extracted (reused by `parseScanRows`), `scanPaneMeta` maps wire rows → `{name, detail}` (raw-ticker keys, first-wins dedupe, `sort.column` via `displayCell`/`columnLookup`), `ScanRowMeta` shared type
- [Scanner Chart View] 1232-1313_FE-CHORE-CHART-REVIEW: Signal-list `rowMeta` input — `SignalListRow` common row type (fixes strictTemplates union access), company name on muted line 2, right-aligned `{col}: {val}` detail on line 1, `.row-name` merged into `.signal-line-2` styles
- [Scanner Chart View] 1232-1313_FE-CHORE-CHART-REVIEW: Pane meta wiring — `paneScanMeta`/`paneRowMeta` computed split (scan formatting isolated from selection churn), precedence wire `Name` → `profilesBySymbol` → ticker-only, `loadProfiles` on init (session-cached bulk read, no per-row storm), `[rowMeta]` binding; list-source rows get names too
- [Scanner Chart View] 1232-1313_DOCS-CHART-REVIEW: #1313 CODE-REVIEW (PASS, 2 rounds — profilesBySymbol duplication + strictTemplates union break remediated) + #1322 UAT (Complete, S1–S6) + IMPL-FE §C1

### Fixed
- [Scanner Chart View] 1232-1258_FE-IMPL-CHART-REVIEW: Select-menu panel widened (280px → min(480px, 90vw)) — long scan labels no longer clipped; all rh-select-menu surfaces benefit

### Changed
- [Savant Design System] 1024-1213_FE-IMPL-DESIGN-SYSTEM: Literal sweep — global/styles layer: `border1`/`rsButtonOne`/`customScrollbar` tokenized, `--mat-sys` blocks tagged exceptions + completed to 34 keys, never-defined vars fixed (paper-trade `.mono`, 5 MUI-style vars on sync-chart-view); inventory script `accent` whitelist
- [Savant Design System] 1024-1214_FE-IMPL-DESIGN-SYSTEM: Literal sweep — option-chain + pct-change surfaces (grid/cells/dialogs → `var(--ds-*)`, dead mat-sys fallbacks dropped, swing-fixtures exception)
- [Savant Design System] 1024-1214_FE-IMPL-DESIGN-SYSTEM: Literal sweep — order ticket, queue + trading surfaces (status chips → container pairs, direction → up/down, entity FPs noted, purple/ACR categorical hues tagged)
- [Savant Design System] 1024-1214_FE-IMPL-DESIGN-SYSTEM: Literal sweep — analysis, gallery + signal views (status pills → tokens, histogram chart literals tagged)
- [Savant Design System] 1024-1214_FE-IMPL-DESIGN-SYSTEM: Literal sweep — swing-analysis + strategy builder surfaces (dialogs, error banner, form validation → tokens)
- [Savant Design System] 1024-1214_FE-IMPL-DESIGN-SYSTEM: Literal sweep — chart-config exception tags + inventory (canvas-rendered literals tagged; ST literal sites 366→114)
- [Savant Design System] 1024-1215_FE-IMPL-DESIGN-SYSTEM: Literal sweep — positions-view surfaces (direction container pairs, deprecated --ds-surface-variant purge, invisible status-badge + dead-hover fixes)
- [Savant Design System] 1024-1215_FE-IMPL-DESIGN-SYSTEM: Literal sweep — portfolio-gallery surfaces (white-alpha header literals → border tokens + color-mix, mat-sys tier badges kept, .short → --ds-down)
- [Savant Design System] 1024-1215_FE-IMPL-DESIGN-SYSTEM: Literal sweep — account-summary + stop-loss tokens (dark-invisible rgba label → --ds-on-surface-variant; stop-loss file ships user's #888 update-mode CSS with it)
- [Savant Design System] 1024-1215_FE-CHORE-DESIGN-SYSTEM: ui-color-sites inventory regen — pd/positions literal sites → 2 issue-ref false positives
- [Savant Design System] 1024-1216_FE-IMPL-DESIGN-SYSTEM: Literal sweep — interval-toggle → `var(--ds-*)` (active hue indigo→cyan accent) + 9 dead `var(--fc-*,literal)` fallbacks dropped in flex-chart/overlay
- [Savant Design System] 1024-1216_FE-IMPL-DESIGN-SYSTEM: Literal sweep — shared chart-config exception tags (6 indicators, rs.constants palette/crosshair, rs-chart Syncfusion scrollbar) + st-zone fallback → canonical ST_ZONE_FALLBACK_COLOR
- [Savant Design System] 1024-1216_SHARED-IMPL-DESIGN-SYSTEM: Literal sweep — exception tags on repo-root chart contracts (indicator-visuals canonical hues, flex-chart-theme CHART_PALETTES — #1164 domain)
- [Savant Design System] 1024-1216_FE-CHORE-DESIGN-SYSTEM: ui-color-sites inventory regen — shared literal sites → 28 tagged + 4 entity FPs
- [Savant Design System] 1024-1217_FE-IMPL-DESIGN-SYSTEM: Literal sweep — core surfaces (header/login/signup/sidenav/core + signup inline debug styles → `var(--ds-*)`)
- [Savant Design System] 1024-1217_FE-IMPL-DESIGN-SYSTEM: Literal sweep — dashboards v1–v3 + heatmap grids (#000/black matrix hairlines → `border-strong` — visible delta; interval buttons → accent cyan)
- [Savant Design System] 1024-1217_FE-IMPL-DESIGN-SYSTEM: Literal sweep — feature surfaces (decision-board/tj chips → direction+status container pairs, heatmap-view, rs-table, rs-chart-view, symbol-input, sync-chart, trade-journal)
- [Savant Design System] 1024-1217_FE-IMPL-DESIGN-SYSTEM: Literal sweep — heatmap-chart + topic-viewer + ds-gallery (Syncfusion series + stage palettes + definition mirrors tagged)
- [Savant Design System] 1024-1217_FE-IMPL-DESIGN-SYSTEM: Literal sweep — data/chart contract tags (features/data rsColor fields, store placeholders, heatmap ramps, color-utils, base palettes)
- [Savant Design System] 1024-1217_FE-IMPL-DESIGN-SYSTEM: Literal sweep — savant-trader residuals (~72 dead mat-sys fallbacks, rgba shadows → shadow tokens/color-mix, whites → on-accent)
- [Savant Design System] 1024-1217_FE-CHORE-DESIGN-SYSTEM: ui-color-sites inventory regen — 2042 sites; swept scope resolves to tagged exceptions + documented FPs
- [ST Firestore Reorg] 984-1013_BE-IMPL-DATA-PIPELINE: Canonical-only data paths — order-intents/instances/symbol-lists fallbacks + dual-writes removed; dead constants swept
- [ST Firestore Reorg] 984-1013_CONFIG-CONFIG-DATA-PIPELINE: Retired legacy rules ACLs (incl. portfolio/{anchor}) + 22 dead index entries
- [ST Firestore Reorg] 984-1013_BE-IMPL-DATA-PIPELINE: Legacy-path scrubs in surviving scripts — migrate-1003 settle pass, -564 verifier routed paths, spec rewrites
- [ST Firestore Reorg] 984-1159_BE-IMPL-DATA-PIPELINE: doc-level Firestore traffic cut to st-runs/st-symbols — run create/enqueue/progress/TTL/callables, symbol-doc reads/writes, SignalDateWriter ref split (subcollections stay legacy until #1019)
- [ST Firestore Reorg] 984-1159_FE-IMPL-DATA-PIPELINE: FE doc reads repointed — run.service→st-runs; signal.service/chart-review/chart-view→st-symbols; Collection.ST_RUNS retired
- [ST Firestore Reorg] 984-1159_BE-CHORE-DATA-PIPELINE: ops/verify scripts repointed off frozen legacy roots (916/918 meta legs, replay-missing, backfills, 1013 relay labels)
- [ST Firestore Reorg] 984-1019_BE-IMPL-DATA-PIPELINE: signal writer sole-writes st-signals + st-symbols, fail-hard — run-ids/signal-history batch legs removed; dead runStartedAt/triggeredBy params dropped
- [ST Firestore Reorg] 984-1019_BE-IMPL-DATA-PIPELINE: BE readers → st-signals — dashboard callables (runIds array-contains, flat history) + auto-paper getSignals (canonical direction normalize+warn, deterministic signalType collapse)
- [ST Firestore Reorg] 984-1019_FE-IMPL-DATA-PIPELINE: FE signal readers → st-signals — run-scoped + history queries, strict canonical mapper, Collection.ST_SYMBOLS retired; INTERIM coverage lands
- [ST Firestore Reorg] 984-1019_CONFIG-CONFIG-DATA-PIPELINE: (symbol ASC, runIds CONTAINS) composite index; legacy savant-trader/data rules blocks removed → deny-by-default
- [ST Firestore Reorg] 984-1019_BE-IMPL-DATA-PIPELINE: pins — sole-write/fail-hard writer semantics, zero-legacy-reference boundary scan, composite index
- [ST Firestore Reorg] 984-1019_BE-CHORE-DATA-PIPELINE: readers-1019 relay (A/B/C pre-delete gate + evidence floors, registered all four places); 916/918 verifies repointed to st-signals
- [ST Firestore Reorg] 984-1019_DOCS-DATA-PIPELINE: #1019 CODE-REVIEW (PASS, 2 rounds, minors remediated) + #1319 UAT (Complete; S1–S4 green, S5 ship runbook)

### Removed
- [ST Firestore Reorg] 984-1013_BE-IMPL-DATA-PIPELINE: Soak mirrors + occurrence-decision sweeper (8 functions undeployed; 26 legacy roots, ~317k docs, archived + deleted)
- [ST Firestore Reorg] 984-1013_BE-CHORE-DATA-PIPELINE: Obsolete migration/parity scripts + specs unwired and deleted

## [2026-10-27]

### Added
- [Savant Design System] 1024-1211_FE-IMPL-DESIGN-SYSTEM: /dev/ds palette lock — explicit dark|light host attr, lock persistence (ds-gallery.palette-lock), accent/up hue-adjacency warning, App-wide accent preview pushing derived --ds-accent/--mat-sys families onto `<html>` with self-cleanup
- [Savant Design System] 1024-1211_SHARED-IMPL-DESIGN-SYSTEM: palette-lock verify relay — 19 credential-free checks incl. dart-sass compile, light-restate/mat-sys source-parity pins, no-leak guards; registered in run-all + README index
- [Savant Design System] 1024-1211_DOCS-DESIGN-SYSTEM: #1211 CODE-REVIEW (PASS, 10 in-review fixes) + #1236 UAT (Complete; 7 scenarios PASS; locked palette --ds-accent #22d3ee / --ds-up #00e676 / --ds-down #ff3366)
- [Scanner Chart View] 1232-1257_FE-IMPL-CHART-REVIEW: Latest-run cache write seam — ScannerService.saveLatestRun + launchRecipe/runScan call sites (warn-only, discovery-only)
- [Scanner Chart View] 1232-1257_FE-IMPL-CHART-REVIEW: Latest-run cache spec coverage — write shape, warn-only, once-per-run and no-write pins
- [Scanner Chart View] 1232-1257_DOCS-CHART-REVIEW: #1257 CODE-REVIEW (PASS, 2 rounds) + #1294 UAT (Complete incl. live Firestore write evidence)

## [2026-10-26]

### Added
- [Options Backtest] 1238-1275_SHARED-IMPL-BACKTEST: Selection Replay contract types — pick-doc coordinate/template, SA wire shapes, contract-list row union, run/list docs, callable + task payloads
- [Options Backtest] 1238-1275_CONFIG-CONFIG-BACKTEST: `@options-replay/contracts` alias across root + functions tsconfig and jest mapper
- [Options Backtest] 1238-1275_SHARED-IMPL-BACKTEST: contracts verify script — 18 credential-free checks through the real alias, registered in run-all + README index
- [Options Backtest] 1238-1275_DOCS-BACKTEST: #1275 CODE-REVIEW (PASS, 2 convergence passes) + #1288 UAT (Complete; S1–S9 PASS) + Selection Replay PRD/IMPL/TEST/ADR thread docs + CONTEXT.md domain vocabulary
- [Scanner Chart View] 1232-1256_FE-IMPL-CHART-REVIEW: scan-source key helpers (SCAN_SOURCE_PREFIX/isScanSource/scanSourceRecipeId) + ChartViewViewportService list-source derivation + ':'-collision pin
- [Scanner Chart View] 1232-1256_FE-IMPL-CHART-REVIEW: RhSelectMenuComponent.disabled input + ChartViewToolbarComponent — merged review-header/detail toolbar (scan placeholder, list dropdown, indicators, chart controls, filing chips, Trade/Order/Add, New-only, manual input)
- [Scanner Chart View] 1232-1256_FE-IMPL-CHART-REVIEW: ChartViewComponent page — pane + detail (showToolbar=false), page-scoped toolbar state, select() funnel clearing manual state, advanceQueue idx guard, ungated Trade, Order pill, Add stub, company-name lookup; SignalListComponent dimmedSymbols viewed dimming
- [Scanner Chart View] 1232-1256_FE-IMPL-CHART-REVIEW: AppRoutes.CHART_VIEW + lazy route + nav rename 'Chart Review' → 'Chart View' (legacy /signals/charts stays until #1260)
- [Scanner Chart View] 1232-1256_DOCS-CHART-REVIEW: #1256 CODE-REVIEW (PASS, 2 fresh-eyes passes) + #1289 UAT (Complete; S1–S14 user PASS) + AGENTS.md jest.mock signal-input pitfall
- [Option Contract Time-Series Viewer] 1243-1263_FE-IMPL-OPTIONS: Multi-series contract chart — union axis mark lines, entry→expiration strike markers, single-mode lower panes, lifetime-default clip + header-bar "Clip to entry", continuous Drop-mode underlying, focused drill-down
- [Option Contract Time-Series Viewer] 1243-1263_DOCS-OPTIONS: #1263 CODE-REVIEW (PASS, 2 passes) + #1287 UAT (Complete; S1–S9 + spec-verified deferrals to #1264)
- [Options Backtest] 1238-1276_SHARED-IMPL-BACKTEST: Replay template registry (csp-45-20, csp-30-30) + getReplayTemplate + st-options-* collection roots and deterministic list doc id
- [Options Backtest] 1238-1276_CONFIG-CONFIG-BACKTEST: `@options-replay/templates` alias across root + functions tsconfig and jest mapper
- [Options Backtest] 1238-1276_CONFIG-IMPL-BACKTEST: st-options-replay-runs / st-options-contract-lists rules (authed read, write-false) + (runId, symbol) composite index
- [Options Backtest] 1238-1276_SHARED-IMPL-BACKTEST: registry+collections verify script — 7 credential-free alias-resolution checks, registered in run-all + README index
- [Options Backtest] 1238-1276_DOCS-BACKTEST: #1276 CODE-REVIEW (PASS, convergence fixes folded) + #1291 UAT (Complete; 8 scenarios PASS) + IMPL-SHARED §4 doc-id builder note
- [Scanner Chart View] 1232-1254_SHARED-IMPL-CHART-REVIEW: ScanLatestRun contract (recipeId/ranAt/totalItems/truncated/rows) + serialize/parse, st-scanner latest-runs anchor + collection/doc path helpers, rules allowlist → authed CRUD
- [Scanner Chart View] 1232-1254_SHARED-IMPL-CHART-REVIEW: ScanLatestRun spec coverage — round-trip, drift rejection, 200-row truncated edge, forward-compat extras, path parity, rules allowlist pin
- [Scanner Chart View] 1232-1254_SHARED-IMPL-CHART-REVIEW: latest-run verify script — 13 credential-free checks through real @st/scanner/@st/collections aliases, registered in run-all + README index
- [Scanner Chart View] 1232-1254_DOCS-CHART-REVIEW: #1254 CODE-REVIEW (PASS, 2 convergent rounds) + #1290 UAT (Complete; S1–S5 PASS)
- [Manual Order] 1177-1191_FE-IMPL-ORDER: Authenticated header "New Order" button — `newOrder` output on rs-header wired through CoreComponent → ManualOrderService.open() from any route
- [Manual Order] 1177-1191_FE-IMPL-ORDER: Manual dialog STAGED-only re-resolve — symbol swaps in place (releaseTicket seed: created → discard, adopted → survives), same-symbol adoption keeps the option leg, stale-emit ghost guard + dual-key binding lookups
- [Manual Order] 1177-1191_DOCS-ORDER: #1191 CODE-REVIEW (PASS, 3 convergent rounds) + #1230 UAT (Complete; S1–S9)
- [Options Backtest] 1238-1278_DOCS-BACKTEST: BE IMPL/TEST plans ship — IMPL-BE §3 records confirmed SA pick-doc seam (CellYearDoc wire, year-sharded requests, endpoint name pending av-proxy-api#225); TEST-BE mapper bullets cover miss entries
- [Options Backtest] 1238-1278_DOCS-BACKTEST: #1278 CODE-REVIEW (PASS, 3 passes) + #1293 UAT (Complete; 8/8) + ADR-010 amendment + PRD/IMPL-SHARED wire reconcile
- [Options Backtest] 1238-1279_BE-IMPL-BACKTEST: Pick-doc client — year-sharded fetch+merge per confirmed contract, injectable PickDocTransport seam, coordinate-named 404/malformed-400 error semantics, provisional SA#225 constants single-point
- [Options Backtest] 1238-1279_BE-IMPL-BACKTEST: 9 transport-seamed unit tests (request shape, merge, every error branch) — registered as test:options-replay
- [Options Backtest] 1238-1279_DOCS-BACKTEST: #1279 CODE-REVIEW (PASS, 1 convergence fix) + #1299 UAT (Complete; 9/9) + IMPL-BE §3 as-built note

### Changed
- [Options Backtest] 1238-1278_SHARED-IMPL-BACKTEST: PickDocument reconciled to SA CellYearDoc — days carries PickDocDayEntry (pick | explicit miss), PickDocMiss/PickDocMissStatus/isPickDocPick added, updatedAt; NoSelectionReason maps SA statuses
- [Options Backtest] 1238-1278_SHARED-IMPL-BACKTEST: #1275 verify script narrows day entries via isPickDocPick (union makes raw .contractId unsafe)

## [2026-10-25]

### Added
- [Option Contract Time-Series Viewer] 1243-1262_SHARED-IMPL-OPTIONS: PlottedEntry — the (openDate, contractId) plotted-pair contract
- [Option Contract Time-Series Viewer] 1243-1262_FE-IMPL-OPTIONS: Plotted-pair input parser + verification script
- [Option Contract Time-Series Viewer] 1243-1262_FE-IMPL-OPTIONS: Plotted-set store feature
- [Option Contract Time-Series Viewer] 1243-1262_DOCS-OPTIONS: Multi-symbol thread docs + review/UAT + Plotted Set term

### Changed
- [Scanner Chart View] 1232-1255_FE-REFACTOR-CHART-REVIEW: chartIntervalKey and ChartRange moved to canonical homes — base-indicators/barrel bridge export, flex-chart.types range type, toolbar literal unions replaced
- [Scanner Chart View] 1232-1255_FE-IMPL-CHART-REVIEW: chart toolbar state hoisted to page-scoped ChartToolbarStateService — SignalDetailComponent aliases service signals, showToolbar input suppresses in-template toolbar for the future merged toolbar
- [Scanner Chart View] 1232-1255_DOCS-CHART-REVIEW: topic PRD + FE/SHARED IMPL/TEST docs
- [Scanner Chart View] 1232-1255_DOCS-CHART-REVIEW: #1255 CODE-REVIEW (PASS, convergence fixes folded) + #1269 UAT (Complete; identical-behavior user PASS) + CONTEXT.md terms

## [2026-10-23]

### Added
- [Manual Order Entry] 1177-1190_FE-IMPL-ORDER: option staging lane + collateral/wire utils — OptionStageLane (signal card-lane vs manual contract-lane), {contract,side} lookup probe, verified review_option_order collateral parsing, shared wire-args owner
- [Manual Order Entry] 1177-1190_FE-IMPL-ORDER: option ticket manual mode — real contract-resolution form replaces placeholder, BTO/STO toggle (OPT-MAN-{BTO|STO}-{occ} ids, source MANUAL), advisory STO collateral preview, retarget never re-legs a bound ticket
- [Manual Order Entry] 1177-1190_FE-IMPL-ORDER: manual dialog mounts the real Option tab — empty-provenance mount, removed [decisions] binding
- [Manual Order Entry] 1177-1190_DOCS-ORDER: #1190 CODE-REVIEW (PASS, 3 rounds) + #1226 UAT (Complete; S1–S5 user PASS, remainder spec-covered)
- [Paper Trading Infra] 553-671_FE-IMPL-PAPER-TRADING: dashboard close/cancel actions + confirm dialog + CANCELLED chip — Actions column (OPEN→close, PENDING→cancel, spinner in-flight; cohort rows share the loop), PaperTradeActionDialogComponent, status filter w/ CANCELLED, per-status chips, cancelledTrades selector, ROW_ACTIONS map; QA #1229 remediation (clearError + banner dismiss/Retry)
- [Paper Trading Infra] 553-671_DOCS-PAPER-TRADING: #671 CODE-REVIEW (PASS, 2 rounds to convergence) + #1229 UAT (Complete; S1–S7 user PASS + refinement) + IMPL §2/§4 as-built
- [RH Scanner] 1098-1199_FE-IMPL-SAVANT-TRADER: scanner page auto-run overview — scoreboard rail + detail table (status/count/top-tickers per recipe), .table-scroll region + sticky thead, filters_applied echo, magnitude-aware numeric formatting, reauth re-fires the wave
- [RH Scanner] 1098-1199_DOCS-SAVANT-TRADER: IMPL/TEST as-built sync (rail+detail, 12 recipes) + #1199 CODE-REVIEW (PASS, 3 rounds) + #1225 UAT (Complete; visual pass incl. scroll-in-table)

### Changed
- [Manual Order Entry] 1177-1190_FE-IMPL-ORDER: manual staging permits parallel orders — live/FILLED tickets no longer block manual intent (add-to-position legitimate); STAGED adoption + same-minute doc-collision guard retained; signal/card lane unchanged
- [Savant Design System] 1024-1207_FE-IMPL-DESIGN-SYSTEM: pre-paint data-theme bootstrap (index.html, dark default, corrupt→dark, no prefers-color-scheme) + root signal ThemeService (theme/set/toggle — attribute + localStorage authority)
- [Savant Design System] 1024-1207_FE-IMPL-DESIGN-SYSTEM: header theme toggle — icon shows target theme, delegates to ThemeService
- [Savant Design System] 1024-1207_SHARED-IMPL-DESIGN-SYSTEM: theme-plumbing verify relay — 21 checks incl. single documentElement data-theme writer invariant
- [Savant Design System] 1024-1207_DOCS-DESIGN-SYSTEM: #1207 CODE-REVIEW (PASS, 2 rounds; M1 dark-before-#1209 user-accepted bound) + #1228 UAT (Complete)
- [Savant Design System] 1024-1209_FE-IMPL-DESIGN-SYSTEM: --mat-sys dark+light bridge — dark 31-key set at :root, pre-change light under [data-theme="light"], color-scheme flips; resolves the mixed-theme bound from #1207
- [Savant Design System] 1024-1209_SHARED-IMPL-DESIGN-SYSTEM: mat-sys bridge verify relay — 11 checks, exact-literal pins both blocks, anti-smuggle exactly-twice guard
- [Savant Design System] 1024-1209_DOCS-DESIGN-SYSTEM: #1209 CODE-REVIEW (PASS, 6 findings fixed in-review) + #1231 UAT (Complete; dark legibility/light/charts user-PASS) + IMPL/TEST superseded-model notes

## [2026-10-22]

### Added
- [RH Scanner] 1098-1198_FE-IMPL-SAVANT-TRADER: ScannerStore run-all machinery — per-recipe runs map + ~1s staggered runAllRecipes, refreshRecipe armed-slot consumption, armed+in-flight runsLoading, auth taxonomy, seq-token supersession
- [RH Scanner] 1098-1198_FE-IMPL-SAVANT-TRADER: previewScanRaw path — RobinhoodMcpClient + ScannerService return un-flattened PreviewScanResult via shared previewScanArgs
- [RH Scanner] 1098-1198_DOCS-SAVANT-TRADER: IMPL/TEST as-built sync + #1198 CODE-REVIEW (PASS, 2 rounds) + #1223 UAT (Complete)
- [RH Scanner] 1098-1197_FE-REFACTOR-SAVANT-TRADER: Shared scan-row helpers in scanner-rows.util — normScanSymbol/dedupeScanRows/displayCell/mergeLookup; ScanRow gains instrumentId; RecipeRunState type for run-all
- [RH Scanner] 1098-1197_FE-IMPL-SAVANT-TRADER: ScannerRecipeTableComponent + scanner-sort.util — all wire fields, tracked badge, recipe-sort seed, click-cycle multi-sort with priority badges
- [RH Scanner] 1098-1197_DOCS-SAVANT-TRADER: Auto-run thread docs — PRD/IMPL/TEST + #1197 CODE-REVIEW (3 rounds) + UAT
- [Savant Design System] 1024-1204_SHARED-IMPL-DESIGN-SYSTEM: savant-ds token layer rewritten to 47-token semantic vocabulary — neutral ramp, accent/direction/feedback families; :root light + [data-theme="dark"], literal values, no mat-sys aliases (canonical commit in savant-ds repo)
- [Savant Design System] 1024-1211_FE-IMPL-DESIGN-SYSTEM: /dev/ds palette explorer — accent/direction pickers, localStorage palettes, token inspector, Chrome coverage toggle; 'DS accent' default now previews shipped tokens
- [Savant Design System] 1024-1204_SHARED-CHORE-DESIGN-SYSTEM: verify.mjs manifest → 47-token literal contract; new design-system-theme-tokens-1204 relay (boundary-exact parsing, installed-path compile, vendor parity); UI-color inventory tooling
- [Savant Design System] 1024-1204_DOCS-DESIGN-SYSTEM: Theme & Palette PRD/IMPL/TEST + #1204 CODE-REVIEW (PASS, 2 rounds) + #1220 UAT (Complete) + CONTEXT.md terms
- [Manual Order Entry] 1177-1189_FE-IMPL-ORDER: Manual equity staging — source-agnostic STAGED adoption + live-order block guard
- [Manual Order Entry] 1177-1189_FE-IMPL-ORDER: Option ticket manual mode — runId='' placeholder + gated chains/cash/alloc warm effects
- [Manual Order Entry] 1177-1189_FE-IMPL-ORDER: Gallery ticket dialog manual mode — symbol entry, stage/adopt binding, re-resolve gate, dashboard follow-through
- [Manual Order Entry] 1177-1189_DOCS-IMPL-ORDER: #1189 CODE-REVIEW (PASS, 3 rounds) + #1219 UAT (Complete) + IMPL doc correction
- [Paper Trading Infra] 553-670_FE-IMPL-PAPER-TRADING: close/cancel callables — CallableName.CLOSE_PAPER_TRADE/CANCEL_PAPER_TRADE + PaperTradingService wrappers with typed request/response contracts
- [Paper Trading Infra] 553-670_FE-IMPL-PAPER-TRADING: store close/cancel actions — shared per-trade actingIds (cross-verb race block, defer-guarded invoke), close → reload trades+account, cancel → trades only, unified error surface
- [Paper Trading Infra] 553-670_DOCS-PAPER-TRADING: #670 IMPL as-built + CODE-REVIEW (PASS, 3 axes) + #1221 UAT (Complete)
- [Paper Trading Infra] 553-922_DOCS-PAPER-TRADING: retroactive UAT for #921 auto-paper group-by dims (Complete; shipped 10-11, gate ran 10-22)

### Changed
- [Savant Design System] 1024-1205_SHARED-IMPL-DESIGN-SYSTEM: theme-tokens relay asserts vendored _tokens.scss parity in BOTH consumer apps; SA skip gated on checkout existence — a present checkout missing the vendored file now FAILs instead of silently skipping
- [Savant Design System] 1024-1205_DOCS-DESIGN-SYSTEM: savant-ds README corrected to post-#1204 contract; #1205 CODE-REVIEW (PASS, 2 rounds) + #1224 UAT (Complete) + relay guide/README updates

### Removed
- [ST Firestore Reorg] 984-1016_FE-IMPL-DATA-PIPELINE: review-list persistence removed — triage.service.ts deleted, Collection.ST_REVIEW_LIST dropped, pin spec asserts non-reintroduction
- [ST Firestore Reorg] 984-1016_FE-IMPL-DATA-PIPELINE: triage store — session-local flags; loadReviewFlags + dead loading state deleted; REVIEW dual-write dropped; viewport default 'browse'
- [ST Firestore Reorg] 984-1016_FE-IMPL-DATA-PIPELINE: viewport 'ALL' → list-member union (was the permanently-empty flagged queue)
- [ST Firestore Reorg] 984-1016_FE-IMPL-DATA-PIPELINE: needs-review UI disabled — flag button, Review pill, clear-flags, viewport toggle, new-symbols; Watch selected-state + 'From list' label
- [ST Firestore Reorg] 984-1016_CONFIG-DATA-PIPELINE: review-list rules ACL removed — deny-by-default until #1013 deletes data
- [ST Firestore Reorg] 984-1016_DOCS-DATA-PIPELINE: DATA-MAP updated; #1016 CODE-REVIEW (PASS, 2 rounds) + #1200 UAT (Complete)

## [2026-10-21]

### Added
- [Paper Trading Infra] 553-1085_FE-IMPL-PAPER-TRADING: Compare columns + missing-column parity in AnalysisStore
- [Paper Trading Infra] 553-1085_FE-IMPL-PAPER-TRADING: Slice-menu component — apply/delete + manage-only mode
- [Paper Trading Infra] 553-1085_FE-IMPL-PAPER-TRADING: Workbench-tools component — save-slice form, compare picker, skip notices
- [Paper Trading Infra] 553-1085_FE-IMPL-PAPER-TRADING: Histogram baselineLabel input — truthful compare legend
- [Paper Trading Infra] 553-1085_FE-IMPL-PAPER-TRADING: Wire slices + compare mode into the analysis page
- [Manual Order Entry] 1177-1188_FE-REFACTOR-ORDER: Centralize trading-config cache and staged-ticket discard
- [Manual Order Entry] 1177-1188_FE-IMPL-ORDER: Manual order ticket builders (equity + single-leg option)
- [Manual Order Entry] 1177-1188_FE-IMPL-ORDER: Manual-mode data contract in gallery ticket dialog
- [Manual Order Entry] 1177-1188_FE-IMPL-ORDER: ManualOrderService — dialog entry point + equity staging
- [Manual Order Entry] 1177-1181_DOCS-ORDER: Manual order entry — PRD, IMPL, and TEST docs
- [Manual Order Entry] 1177-1188_DOCS-ORDER: #1188 code review and UAT docs

### Fixed
- [Manual Order Entry] 1177-1188_FE-CHORE-ORDER: Fix date-dependent ticket-merge fixture

## [2026-10-20]

### Added
- [Savant Design System] 1024-1114_FE-IMPL-DESIGN-SYSTEM: signals/review widget migration — filter pills → pill-toggle; Signal Review header → toolbar-row/pill-btn/badge with canonical count/direction markup; Chart Review header → toolbar-row/icon-btn/pill-btn; signal table → badge/dir-edge; dead non-rendering header selectors and duplicated direction literals removed
- [Savant Design System] 1024-1114_FE-VERIFY-DESIGN-SYSTEM: design-system-widget-migration-1114 relay — 47 checks for real shim imports, applicable mixin contracts, canonical markup, dead-selector/literal guards, registration, and Sass compilation against the vendored package; guide + run-all/README registration
- [Savant Design System] 1024-1114_DOCS-DESIGN-SYSTEM: Phase 2 R6 direction-literal/ACR boundary clarified + #1114 CODE-REVIEW (PASS, 3 bounded passes) + #1151 UAT (Complete — 47/47 migration, 85/85 widget relay, build, 4100/4100 Jest, user-confirmed review/chart visuals)
- [Savant Design System] 1024-1115_FE-IMPL-DESIGN-SYSTEM: chart-toolbar/group-panel widget migration — toolbar → toolbar-row/icon-btn/pill-toggle/nav-stepper with canonical flat pill/spacer/nav markup; Group Panel expand-all → icon-btn; long/short counts → badge dir-long/dir-short; dead signal-badge/total-badge/grp-dir selectors removed; stale shim feature-boundary comment corrected
- [Savant Design System] 1024-1115_SHARED-IMPL-DESIGN-SYSTEM: pill-toggle flat variant fix — distinct active fill (primary/on-primary) + container-highest hover in canonical savant-ds _widgets.scss, synced byte-identical to ST + SA vendors (full style-dir parity)
- [Savant Design System] 1024-1115_FE-VERIFY-DESIGN-SYSTEM: design-system-widget-migration-1115 relay — 30 checks incl. compiled flat active/hover fills, badge consumption, dead-selector guards, canonical markup, and vendored-path Sass compiles; guide + run-all/README registration; package verify asserts flat active/hover on compiled CSS
- [Savant Design System] 1024-1115_DOCS-DESIGN-SYSTEM: #1115 CODE-REVIEW (PASS — grp-dir literal, flat hover hole, shim comment remediated) + #1155 UAT (Complete — 30/30 relay, parity, build, 4113/4115 Jest with out-of-scope dev/table-perf exception, user-confirmed charts/review visuals)
- [Savant Design System] 1024-1171_FE-IMPL-DESIGN-SYSTEM: foundation-mixin consumer migration — error banners → vl.error-banner with canonical mat-icon+error-text (paper-trading, strategy-builder, options-strategy-dashboard + MatIconModule); ~13 empty/no-data surfaces → vl.state-block (heatmap, chart-review, signal-review, chain-grid, flex-chart, order-queue, order, triage-report, analysis, histogram/scatter, backtest components, run-history); allocation strips → vl.stat-strip with canonical sb-* markup + compound .neg selectors; plain tables → vl.dense-table (trades/instances/positions) keeping load-bearing locals; run-metrics local spin keyframes removed for the global; MDC mat-table dense-table holdouts deferred to #1163
- [Savant Design System] 1024-1171_FE-VERIFY-DESIGN-SYSTEM: design-system-foundation-migration-1171 relay — 110 checks incl. compiled-CSS .neg specificity guards, mixin includes, canonical markup, dead-literal/selector guards, dense-table adoption, and vendored-path Sass compiles; guide + run-all/README registration
- [Savant Design System] 1024-1171_DOCS-DESIGN-SYSTEM: #1171 CODE-REVIEW (PASS, 2 rounds — canonical banner markup, sb-value.neg specificity, over-broad dense-table deferral, missing MatIconModule remediated) + #1174 UAT (Complete — 110/110 relay, dev build, 4275/4275 Jest, user-confirmed visuals)
- [Screenshot Capture] 746-765_SHARED-CHORE-SCREENSHOT: refresh stale PositionType contract expectation to cover the already-shipped stock/vertical-debit-spread/calendar/option-single enum surface
- [Savant Design System] 1024-1112_FE-CHORE-DESIGN-SYSTEM: refresh sidenav regression expectation for the already-shipped DS Gallery (Dev) menu item
- [Savant Design System] 1024-1112_FE-VERIFY-DESIGN-SYSTEM: widget contract relay — 85 checks across canonical package, byte-identical ST/SA vendors, index/vl shim resolution, exact 9-mixin surface, retired-scope guards, gallery entry/case/include contracts, both-checkout runner gating, and inventory graduation; guide + run-all/README registration
- [Savant Design System] 1024-1112_DOCS-DESIGN-SYSTEM: inventory graduates 9 widgets to Extracted; Phase 1/2 R6 boundary corrected in FE IMPL/TEST; #1112 CODE-REVIEW (PASS) + #1148 UAT (Complete — relays/package/build + 4047/4047 Jest)
- [Gallery Order Ticket View] 743-762_FE-IMPL-GALLERY-VIEW: order-submit handoff — dialog stays open on done-status (confirmation panel: terms + View order / Done; reverts to form if a bound leg flips FAILED); shared orderTicketTerms(); ticket-line + View order deep-link to /trading/live?ticket=<id> held until match or full-queue visibility (rhOrdersLoaded race fix); goBack → trading/gallery
- [Gallery Order Ticket View] 743-762_FE-IMPL-GALLERY-VIEW: Actioned lifecycle — 'watched' removed from card status (Monitor membership no longer sinks cards — QA root cause for stale-looking Actioned symbols); Unwatch path removed end to end; Actioned section split per-status (FAILED/SETTLED/REJECTED sub-headers + color accent bars via facade actionedGroups); manual Paper hidden behind GALLERY_MANUAL_PAPER_ENABLED=false; Chart stub removed
- [Gallery Order Ticket View] 743-762_FE-IMPL-GALLERY-VIEW: page behavior — Group dropdown defaults to None; run-dashboard 'Review Latest Signals' + per-run Review action navigate to trading/gallery via setActiveRun; dataPending waits on symbol lists (no 'No signals' flash)
- [Gallery Order Ticket View] 743-762_DOCS-GALLERY-VIEW: #762 CODE-REVIEW (PASS, 2 rounds) + #1127 UAT (Complete — owner-waived live-order scenarios, spec-covered) + cumulative thread UAT + CONTEXT Monitor/Gallery Card entries
- [Savant Trader] 1098-1131_SHARED-IMPL-SAVANT-TRADER: scanner wire + domain contracts — preview_scan types verified vs live catalog (filters+columns only; ScanSort is client-side recipe sort), ScanRecipe/CurationProposal, narrowing/chunking/truncation helpers, proposal serialize/parse; 13 specs
- [Savant Trader] 1098-1131_CONFIG-SAVANT-TRADER: @st/scanner alias registered in tsconfig/functions/tsconfig/jest
- [Savant Trader] 1098-1131_SHARED-VERIFY-SAVANT-TRADER: rh-scanner-contracts-1131 live relay — 7 checks vs real RH MCP session (enum + symbol-scoped scans)
- [Savant Trader] 1098-1131_DOCS-SAVANT-TRADER: scanner-page PRD + SHARED/FE IMPL/TEST plans + #1131 CODE-REVIEW (PASS) + #1143 UAT (Complete) + RH MCP scanner field guide
- [Savant Trader] 1098-1132_SHARED-IMPL-SAVANT-TRADER: st-scanner anchored root — ST_SCANNER_ROOT/StScannerKind/proposals anchor + items/doc path helpers; firestore.rules authed read, writes gated to proposals anchor; functions barrel re-exports; 21/21 specs
- [Savant Trader] 1098-1132_SHARED-VERIFY-SAVANT-TRADER: st-collections relay covers st-scanner — paths + parity, all 4 barrel names probed, stConfigDocPath gap closed; guide updated
- [Savant Trader] 1098-1132_DOCS-SAVANT-TRADER: #1132 CODE-REVIEW (PASS, 2 rounds) + #1146 UAT (Complete — 5/5 scenarios)
- [Savant Trader] 1098-1136_FE-IMPL-SAVANT-TRADER: previewScan/evaluateUniverse ToolSpecs on RobinhoodMcpClient (data.result → rows + filtersApplied/sortedBy; ANY_OF chunks ≤150, ≤20/batch, per-chunk isolation → unevaluated, dedupe by ticker) + scanner-rows parser (parseScanRows, numeric/percent coercions, canonical column lookup with display_title fallback); data.result drift gate → RobinhoodMcpError; 101/101 specs
- [Savant Trader] 1098-1136_DOCS-SAVANT-TRADER: #1136 CODE-REVIEW (PASS, 2 rounds) + #1149 UAT (Complete — 4/4 scenarios) + CONTEXT.md scanner domain vocabulary
- [Savant Trader] 1098-1137_FE-IMPL-SAVANT-TRADER: scanner recipe catalog — 12 field-guide-verified preview_scan recipes (quality mega/large/mid, 52w high/low ×4, IVR ±0.8/0.2 mcap-scoped, vol-spike, gainers/losers); expression filters only for percent fields with fraction thresholds (never enum PERCENTAGE); supportsPrune+noDataPred on quality; static columnLookup for the verified ROE/NPM canonical renames; 12 catalog specs
- [Savant Trader] 1098-1137_DOCS-SAVANT-TRADER: #1137 CODE-REVIEW (PASS — F1 closed by live preview_scan column probe: all 7 non-standard columns key by display_name) + #1154 UAT (Complete — 4/4 scenarios)
- [Savant Trader] 1098-1138_FE-IMPL-SAVANT-TRADER: scanner compare engine — compareDiscovery (tracked flags, addCandidates = matched∩¬tracked) + comparePrune (two-eval semantics: coverage + filtered — dead = absent from every response, noData before matched-pass, drop = covered∧¬matched∧¬noData with coverage-row dropDetail, unevaluated surfaced separately); catalog specs for display_title collision guard + real noDataPred; 49/49 specs
- [Savant Trader] 1098-1138_DOCS-SAVANT-TRADER: #1138 CODE-REVIEW (PASS — 3 axes, HIGH dead-vs-matched-evidence + MEDIUMs remediated; IMPL §2 rewritten to two-eval signature) + #1156 UAT (Complete — 4/4 scenarios)
- [Savant Trader] 1098-1139_FE-IMPL-SAVANT-TRADER: scanner.service + scanner.store — previewScan delegation, two-eval evaluateTracked (coverage {filters:[]} + filtered, combined done/2·total progress), proposal CRUD on st-scanner/proposals/items via authed() (drift-tolerant reads); signalStore run lifecycle + runSeq/scanSeq/evalSeq/proposalSeq supersession, auto-persist (matchedCount=totalItems), requiresReauth on AUTH, openProposal cache-first+seq; evaluateUniverse onProgress param; compare-engine remediations (covered∧unevaluated⇒unknown not drop, matchedBySymbol noData fallback); 182/182 specs
- [Savant Trader] 1098-1139_DOCS-SAVANT-TRADER: #1139 CODE-REVIEW (PASS, 2 rounds — HIGH covered∧matched-chunk-rejected→drop remediated in compare engine) + #1172 UAT (Complete — 4/4 scenarios) + IMPL §gateway/§Store/§Compare re-sync
- [Savant Trader] 1098-1140_FE-IMPL-SAVANT-TRADER: scanner page — trading/scanner route (lazy, authGuard, PAGE_INFO radar, nav …Analysis·Scanner); recipe picker+blurb over SCANNER_RECIPES, Run/Evaluate tracked (canEvaluateTracked, busy-disabled), per-/batch chunk progress; status line N shown of M matched / N rows·M matched per runKind + PREVIEW_SCAN_ROW_CAP warning; dynamic-column table (tracked badge, percentColumns rescale, client-side recipe.sort, norm-dedupe, '—' cells); AUTH → reauth banner (observation-service flow) vs inline error; store +matchedCount/runKind/columnLookup (presence-verified echo∨static merge shared by display + noDataPred); 219/219 specs
- [Savant Trader] 1098-1140_DOCS-SAVANT-TRADER: #1140 CODE-REVIEW (PASS, 2 rounds — 3 MEDIUMs + 6 LOWs R1, 6 LOWs R2 — mergeLookup presence-verify, runKind label, noDataPred lookup forwarding) + #1175 UAT (Complete — 4/4 scenarios) + IMPL §2/§3 + TEST re-sync
- [Savant Trader] 1098-1141_FE-IMPL-SAVANT-TRADER: scanner compare panel + proposal history — dumb ScannerComparePanelComponent (one ComparePanelData shape for live compare AND reopened proposal; non-empty-bucket expandos w/ counts + per-instance uid'd aria-controls; symbol chips → focusSymbol → page highlights + scrolls tr.focused, effect clears stale focus on compare change; dropDetail chip tooltips; readOnly/title/meta proposal mode); history list (ranAt·recipe·dir-long/dir-short/warning/muted counts) → openProposal read-only detail; NG0955 Set-dedupe; 233/233 specs
- [Savant Trader] 1098-1141_FE-VERIFY-SAVANT-TRADER: rh-scanner-recipes-1098 relay — every SCANNER_RECIPES recipe through live preview_scan({filters,columns}) via executeObservationTool (the catalog the page ships, not a copy); per-recipe failure isolation, contract-shape asserts, toolError surfacing, guarded column-coverage WARN (drift degrades to WARN not crash); run-all + README registered
- [Savant Trader] 1098-1141_DOCS-SAVANT-TRADER: #1141 CODE-REVIEW (PASS, 2 rounds — R1 relay-abort + convergent LOWs, R2 2 convergent MEDIUMs: duplicate expando ids, WARN-block crash) + #1182 UAT (Complete — 4/4 scenarios) + IMPL §3/§5 + TEST re-sync
- [Paper Trading Infra] 553-1081_FE-IMPL-PAPER-TRADING: analysis service + signalStore — dataset index list, header-name papaparse CSV load (COLUMN_TYPES coercion), tags/notes merge-update (null=clear), Storage+index delete, slice CRUD; AND-composed filters + #1067 multi-key sort chain + skipped-column slice notice + race-cancel/stale-state guards; 37 specs
- [Paper Trading Infra] 553-1081_CONFIG-PAPER-TRADING: firestore.rules authed update/delete on analysis-datasets + storage.rules delete on analysis-datasets/ objects (deployed 2026-10-19); create stays server-side
- [Paper Trading Infra] 553-1081_DOCS-PAPER-TRADING: #1081 CODE-REVIEW (PASS — updateTagsNotes merge semantics remediated) + #1129 UAT (Complete, 11 scenarios, 37/37 specs)
- [Paper Trading Infra] 553-1082_FE-IMPL-PAPER-TRADING: trading/analysis route — dataset library (origin badge, status chip, labeled Rule/Scope/Generated provenance, symbol·rule card title, search, tags/notes edit, delete confirm, 5s generating poll) + run-config form (live/replay, exit-grammar + date-range validators block submit, live sends fixed defaults) + generateDataset callable wiring + paper-page link; QA refinements R1/R2; 26+ specs
- [Paper Trading Infra] 553-1082_DOCS-PAPER-TRADING: #1082 CODE-REVIEW (2 passes — disabled-control validator, nav-spec miss, output()/@for drift, CSS tokens) + #1144 UAT (Complete — S1/S2/S6/S11 user-verified, R1 dataset-concept labels + R2 card title refinements)
- [Paper Trading Infra] 553-1083_SHARED-IMPL-PAPER-TRADING: FetchDatasetCsvRequest/Response + chunk doc contract for the workbench read path
- [Paper Trading Infra] 553-1083_BE-IMPL-PAPER-TRADING: Firestore chunk mirror in dataset-writer (items/{id}/chunks/{i}, ~400KB batched) + fetchDatasetCsv callable (pre-migration fallback); deployed 2026-10-20
- [Paper Trading Infra] 553-1083_FE-IMPL-PAPER-TRADING: manifest-driven workbench table — 46-col grid, #1067 sort chain, per-kind filters via lazy per-column filter_list menu, chips/count/reset, column picker, include-open quarantine toggle; store chained computeds; Firestore chunk read; page height bound + dataset-grid scroll region; QA remediations (lazy filter menu, content-visibility rows, card fixes)
- [Paper Trading Infra] 553-1083_CONFIG-PAPER-TRADING: bucket CORS for localhost + prod origins (applied to rel-str.appspot.com)
- [Paper Trading Infra] 553-1083_DOCS-PAPER-TRADING: #1083 CODE-REVIEW (PASS, 3 passes) + #1147 UAT (Complete — 8/8 scenarios on the real AMAT trailing-8 dataset)
- [Paper Trading Infra] 553-1084_FE-IMPL-PAPER-TRADING: analysis views on the filtered subset — pure analysis-stats util (metrics/PF/expectancy/consec W-L/per-signalType, zero-aligned win/loss bins, finite-guarded scatter points); stats/histogram/scatter components (Syncfusion providers, baseline overlay ← viewRows, manifest pickers, jitter, tradeId tooltip); workbench table|stats|histogram|scatter switcher off filteredRows(); library → horizontal card strip; 12+12 specs
- [Paper Trading Infra] 553-1084_FE-CHORE-PAPER-TRADING: filter-menu hang fix — mat-select inside mat-menu busy-looped the main thread (isolated via headless-Chrome repro) → mat-checkbox option list; + stable tradeId row keys, precomputed cell bindings, table-layout fixed
- [Paper Trading Infra] 553-1084_DOCS-PAPER-TRADING: #1084 CODE-REVIEW (PASS — 3 axes, majors remediated in-diff) + #1152 UAT (Complete — 8/8 scenarios + defect section on AMAT ds-20261020-replay-e1aded53) + IMPL §4 as-builts
- [Savant Design System] 1024-1111_FE-IMPL-DESIGN-SYSTEM: ST vendored widget sync + `/dev/ds` Widgets section — 9 canonical compiled-mixin demos with provenance, interactive pill/chip/input state, focused specs, and QA-refined full-page light/dark token treatment; add missing success-container token pair used by existing app surfaces
- [Savant Design System] 1024-1111_FE-IMPL-DESIGN-SYSTEM: SavantApi vendored widget sync — `_widgets.scss` + `_index.scss` byte-identical to `savant-ds`, with no consumer migrations in this task
- [Savant Design System] 1024-1111_DOCS-DESIGN-SYSTEM: #1111 CODE-REVIEW (PASS — standards/spec/thermo-nuclear) + #1126 UAT (Complete — vendor parity, 7/7 focused specs, build, and user-confirmed light/dark visual refinement)
- [Paper Trading Infra] 553-1073_SHARED-IMPL-PAPER-TRADING: TradeAnalysisRow 46-column schema + ANALYSIS_COLUMNS manifest (key/label/kind/enumValues/filterable/defaultVisible) + AnalysisDatasetDoc/AnalysisSlice/SliceFilter/analysisCohort + PaperTradingDoc union & is* guards + analysis-datasets/analysis-slices anchor paths; flat dot-keyed rows (ind.*/strength.*) so manifest key = row key = CSV header
- [Paper Trading Infra] 553-1073_CONFIG-PAPER-TRADING: @paper-trading/analysis alias registered in tsconfig/functions/tsconfig/jest + firestore.rules authed CRUD for analysis-slices (was instances-only writes; deployed)
- [Paper Trading Infra] 553-1073_BE-VERIFY-PAPER-TRADING: paper-trading-analysis-1073-contracts relay (16 checks — dataset/slice doc round-trip, manifest bijection, path parity) + per-task guide + README/run-all index + signal-trades-export Layer-0 seed script
- [Paper Trading Infra] 553-1073_DOCS-PAPER-TRADING: #1073 CODE-REVIEW (PASS — standards/spec/thermo-nuclear) + #1090 UAT (Complete, 9 scenarios PASS) + #1059 thread PRD/IMPL/TEST docs + design note
- [Paper Trading Infra] 553-1074_SHARED-IMPL-PAPER-TRADING: deterministic CSV codec — serializeDataset (manifest-order header, RFC-4180 quoting, codepoint-stable tradeId sort, LF + trailing LF, empty cells for absent/non-finite, lossless String(v) numeric repr — toFixed(2) rejected as lossy vs real 3–4dp fills) + COLUMN_TYPES manifest-derived key→kind map; 15 new specs incl. slice round-trip + SliceFilter ops
- [Paper Trading Infra] 553-1074_CONFIG-PAPER-TRADING: @paper-trading/analysis-csv alias in tsconfig/functions/tsconfig/jest
- [Paper Trading Infra] 553-1074_BE-VERIFY-PAPER-TRADING: paper-trading-analysis-1074-csv-codec relay (7 checks — prod signal trades, stamped ind.* sampling, header/determinism/no-literal/deep-equal round-trip; read-only) + guide + README/run-all index
- [Paper Trading Infra] 553-1074_DOCS-PAPER-TRADING: #1074 CODE-REVIEW (PASS — undefined-coverage gap remediated) + #1094 UAT (Complete, 12 scenarios PASS) + IMPL §3 lossless-repr as-built
- [Savant Design System] 1024-1040_FE-IMPL-DESIGN-SYSTEM: _pd-visual-language delegation shim — @forward 'index' delegates 7 mixins to savant-ds (zero duplicated bodies); $up/$down → var(--ds-*) reads; 5 data-display mixins sole-source pending #1052; ds-parity-probe now delegation-aware (probes diff delegated-vs-package emission through the real shim)
- [Savant Design System] 1024-1040_FE-VERIFY-DESIGN-SYSTEM: design-system-vl-shim-1040 relay (39 checks) — sole-forward + index*-shadow guards, boundary-exact 14-member fixture through real includePaths, no :root leakage, sass via package createRequire
- [Savant Design System] 1024-1040_DOCS-DESIGN-SYSTEM: CODE-REVIEW (2 rounds, PASS — R1 probe regression + fixture/shadow/leak holes remediated) + UAT (Complete — 545/545 jest, all 6 DS relays green)
- [Savant Design System] 1024-1052_SHARED-IMPL-DESIGN-SYSTEM: data-display mixins graduate — dense-table/state-block/stat-strip verbatim-tokenized into savant-ds _data-display.scss + index forward; bounded-tab-group/tab-scroll-pane stay PD-local (Material-coupled, 2 call sites); shim delegates 10, keeps 2
- [Savant Design System] 1024-1052_SHARED-VERIFY-DESIGN-SYSTEM: design-system-data-display-1052 relay + package fixture/decl asserts (20 selectors, both directions); #1039 shadow guard now derives names from installed styles/
- [Savant Design System] 1024-1071_SHARED-IMPL-DESIGN-SYSTEM: vendored savant-ds consumption — vendor/savant-ds committed + dep re-pointed to file:vendor/savant-ds (cloud builds can't resolve sibling file:); sync:ds refresh script; #1039 relay vendor-drift byte-compare; #1034 dry-run spec updated
- [Savant Design System] 1024-1041_FE-IMPL-DESIGN-SYSTEM: /dev/ds element gallery — dev/ds route under authGuard + PAGE_INFO + nav child; DsGalleryComponent renders 12 data-driven cards via @use 'index' as ds (zero local mixins), seen-in provenance footers, host-scoped [data-theme="dark"] toggle with live getComputedStyle evidence
- [Savant Design System] 1024-1041_FE-VERIFY-DESIGN-SYSTEM: design-system-ds-gallery-1041 relay (37 checks — route wiring, ds.* pinning, index*-shadow guard, live sass compile through includePaths, entries/provenance/dark-toggle contract); #1039 vendor drift check now line-ending normalized (IDE CRLF re-saves no longer false-positive)
- [Savant Design System] 1024-1041_DOCS-DESIGN-SYSTEM: CODE-REVIEW (PASS — spec/standards/adversarial axes clean) + #1091 UAT (Complete, 6 scenarios PASS)
- [Savant Design System] 1024-1042_FE-IMPL-DESIGN-SYSTEM: SA consumes savant-ds — av-proxy-api vendored package (file:vendor/savant-ds, same App-Hosting lesson as #1071), includePaths + @use 'tokens' + --mat-sys-* bridge (prebuilt indigo-pink emits none), bz-no-results on ds.state-block, sync:ds refresh script
- [Savant Design System] 1024-1042_FE-VERIFY-DESIGN-SYSTEM: design-system-sa-consumption-1042 relay (13 checks) — cross-repo: dep spec, includePaths, token emit, mat-sys bridge, vendor drift, package-name shadow guards (covers index AND tokens), live sass compile through SA includePaths
- [Savant Design System] 1024-1042_DOCS-DESIGN-SYSTEM: #1042 CODE-REVIEW (2 rounds, PASS — R1 index-shadow, R2 guard generalized to all package partial names) + #1093 UAT (Complete, 7 scenarios PASS)
- [Savant Design System] 1024-1052_DOCS-DESIGN-SYSTEM: #1052 CODE-REVIEW (PASS — R1 hardcoded shadow-list remediated) + #1069 UAT (Complete — historical verbatim parity vs pre-graduation bodies, 20/20 selectors)
- [Savant Design System] 1024-1108_SHARED-IMPL-DESIGN-SYSTEM: widget mixins — _widgets.scss 9 mixins (pill-toggle/pill-btn/badge/icon-btn/toolbar-row/nav-stepper/field-input/toggle-chip/dir-edge) verbatim-graduated from signal surfaces + index forward + verify asserts (~120, both directions); retired ACR/expando scope excluded; .emph display-total cursor:default
- [Savant Design System] 1024-1108_DOCS-DESIGN-SYSTEM: widget-layer PRD (Approved) + SHARED/FE IMPL/TEST plans + #1108 CODE-REVIEW (PASS — .emph cursor resolved in QA) + #1123 UAT (Complete — 981 checks/0 FAIL)
- [Savant Design System] 1024-1035_SHARED-IMPL-DESIGN-SYSTEM: --ds-* token layer (styles/_tokens.scss) — --mat-sys-* mirrors + P&L accents + spacing/typography/density/elevation + [data-theme="dark"] shadow overrides; _index.scss pinned to mixins-only emission contract
- [Savant Design System] 1024-1035_SHARED-VERIFY-DESIGN-SYSTEM: token-layer verify (86 checks) — real sass compile, manifest set-equality both directions, exact literal + dark values, per-alias --mat-sys-* binding, loadPaths consumer resolution; rel-str relay script + run-all needsPath gate
- [Savant Design System] 1024-1035_DOCS-DESIGN-SYSTEM: IMPL _index-forwarding contract fix + CODE-REVIEW (2 rounds, PASS) + UAT (Complete) for --ds-* tokens
- [Savant Design System] 1024-1036_SHARED-IMPL-DESIGN-SYSTEM: _page.scss — ds.page-host/page-shell/content-column/header-bar graduated from _pd-visual-language.scss, tokenized to --ds-*; _index.scss @forward 'page' (first mixin export)
- [Savant Design System] 1024-1036_SHARED-VERIFY-DESIGN-SYSTEM: mixin verify (128 checks) — declaration-anchored fixture asserts, emission contract (only fixture classes emit), mixin-surface set-equality; rel-str relay + verbatim-semantics parity probe (derived token map, 30 decls/6 selectors)
- [Savant Design System] 1024-1036_DOCS-DESIGN-SYSTEM: CODE-REVIEW (2 rounds, PASS) + UAT (Complete) for ds.* page mixins
- [Savant Design System] 1024-1037_SHARED-IMPL-DESIGN-SYSTEM: _dialog.scss (ds.dialog-chrome/dialog-status) + _feedback.scss (ds.error-banner) graduated from _pd-visual-language.scss, tokenized to --ds-*; .spinner resolves the app's global @keyframes spin; _index.scss forwards all three mixin modules
- [Savant Design System] 1024-1037_SHARED-VERIFY-DESIGN-SYSTEM: verify hardened (303 checks) — comment-stripped scans, bidirectional decl asserts, tokens/index emission contracts, anchored fixture roots; shared ds-parity-probe.ts lib + #1036 relay refactor + #1037 relay; run-all needsPath cwd fix
- [Savant Design System] 1024-1037_DOCS-DESIGN-SYSTEM: CODE-REVIEW (3 rounds, PASS) + UAT (Complete) for ds.* dialog/feedback mixins
- [Savant Design System] 1024-1038_SHARED-IMPL-DESIGN-SYSTEM: surface-consolidation verify (340 checks) — styles/ all-entries manifest, _index forwards-exactly-{page,dialog,feedback} (+quote-style/parse-count guards), fixture-exercises-every-mixin both directions, _tokens member-free guard, //-in-string anomaly guard
- [Savant Design System] 1024-1039_SHARED-IMPL-DESIGN-SYSTEM: _tokens.scss header contract correction — --mat-sys-* need only exist on :root (var() binds at computed time; source order irrelevant)
- [Savant Design System] 1024-1039_FE-IMPL-DESIGN-SYSTEM: ST consumption wiring — savant-ds file: dep + junction link, angular.json includePaths on build+test, styles.scss @use 'tokens' (27 --ds-* + dark block in emitted bundle)
- [Savant Design System] 1024-1039_FE-VERIFY-DESIGN-SYSTEM: design-system-consumption-1039 relay (37 checks) — package-anchored sass createRequire, live token-name reads, :root-scoped boundary-exact emitted asserts, src/ shadow guard; #1034 dry-run check de-proxied (exit-0 = resolved)
- [Savant Design System] 1024-1039_DOCS-DESIGN-SYSTEM: CODE-REVIEW (PASS, A1–A4 remediated) + UAT (Complete) for ST consumption wiring
- [Savant Design System] 1024-1038_SHARED-VERIFY-DESIGN-SYSTEM: design-system-index-verify-1038 relay (npm run verify in ../savant-ds) + run-all/README registration
- [Savant Design System] 1024-1038_DOCS-DESIGN-SYSTEM: CODE-REVIEW (2 rounds, PASS) + UAT (Complete) for index forwards + surface verify — Phase #1032 package foundation complete
- [Savant Design System] 1024-1034_SHARED-IMPL-DESIGN-SYSTEM: savant-ds package skeleton (C:\aa\projects\savant-ds) — package.json + README consumption contract (file: dep, includePaths) + _index.scss + verify stub
- [Savant Design System] 1024-1034_SHARED-VERIFY-DESIGN-SYSTEM: savant-ds skeleton verify — real file: install + junction probe (14 checks) + run-all needsPath gate
- [Savant Design System] 1024-1034_DOCS-DESIGN-SYSTEM: Topic 1024 docs — PRD + IMPL×2 + TEST×2 + CODE-REVIEW (PASS) + UAT (Complete); CONTEXT.md savant-ds/Design Token/DS Gallery glossary
- [ST Firestore Reorg] 984-1004_SHARED-IMPL-DATA-PIPELINE: LIFECYCLE_OPEN_TRADE_STATUSES (PENDING|OPEN|ASSIGNED — one canonical "member counts open" set) + PaperTrade/PaperSignalOrderResponse positionGroupId + member-ticket origin.positionGroupId contract
- [ST Firestore Reorg] 984-1004_BE-IMPL-DATA-PIPELINE: st-position-groups — StPositionGroupWriter (create()+ALREADY_EXISTS seq-alloc, same-origin+membersCovered adoption, ensure restore, addMembers txn union; fail-soft) + handlePaperSignalOrder mints the group before member ticket emits and stamps tickets/trades + mirror carries origin.positionGroupId through soak rewrites + shared firestore-utils (isAlreadyExists/unionIds) + live tax-lot/option-position join helpers + cohortToGroup mapper
- [ST Firestore Reorg] 984-1004_BE-IMPL-DATA-PIPELINE: migrate-cohorts-1004 (dry-run default; stamp-aware target resolution — unanimous member-trade stamp wins, split/foreign-origin → conflicted skip; union-merge; never overwrites foreign stamps) + st-position-groups audit (shape/parity/bidirectional incl. reverse-direction dangling-stamp + real-data live-join probe) + verify-564 group assertions; applied on prod — 9 groups/27 trades/9 tickets, conflicted 0
- [ST Firestore Reorg] 984-1004_DOCS-DATA-PIPELINE: #1004 CODE-REVIEW (3 rounds, PASS — majors: lifecycle-status three-way disagreement, manual-origin adoption, migration seq-divergence clobber) + #1070 UAT (Complete — deploy + verify-564 22/22 + prod apply/audit all green)
- [ST Firestore Reorg] 984-1005_SHARED-IMPL-DATA-PIPELINE: order-ticket vocabulary finalized — terms.expressionTemplate on staged tickets, PaperTicket.signalId optional, expressionTemplate whitelisted for minted-trade overrides, intent→ticket renames (persisted 'intent' carrier values retained as data-compat boundary)
- [ST Firestore Reorg] 984-1005_BE-IMPL-DATA-PIPELINE: order-ticket writer — resolveTicketSeed adopts on refId OR signalId (crash-window foreign-ticket dup eliminated), markCancelled/markFilled return .applied for caller-checked transitions, noteError→update() (no zombie docs)
- [ST Firestore Reorg] 984-1005_BE-IMPL-DATA-PIPELINE: position-group addMembers rollups — openCount increments only for ids actually unioned (retry replays can't inflate)
- [ST Firestore Reorg] 984-1005_BE-IMPL-DATA-PIPELINE: accept emits staged pap_{seed} tickets per expression template (no new PENDING trades); runSignalOrderRetry extracted (callables 1186→979, no cycle); cross-day member seeds derive from eqTrade.createdAt; template-identity coverage; cancel rereads state, checks .applied, live-stamped-trade block + foreign-ticket ownership guard
- [ST Firestore Reorg] 984-1005_BE-IMPL-DATA-PIPELINE: expression-fill pass reads staged tickets (legacy PENDING drain retained), mints {SYM}-{YYMMDD}-{origin}-{expr}-{exp}-{strike}-{NN} ids via read-only RH MCP resolution, stamps contract + full lineage, joins group before fill; getTicket recheck / in-loop dedupe / ALREADY_EXISTS same-ticket recheck / sibling detection; group_join + no_entry_fill lastError wedges stay staged for retry
- [ST Firestore Reorg] 984-1005_BE-IMPL-DATA-PIPELINE: screenshot tracking intent→ticket vocabulary (persisted carrier values unchanged)
- [ST Firestore Reorg] 984-1005_BE-VERIFY-DATA-PIPELINE: verify-564 accept→retry→cancel→fill→group-join→cleanup — 28/28 PASS live
- [ST Firestore Reorg] 984-1005_FE-IMPL-DATA-PIPELINE: order-ticket vocabulary in FE ticket types
- [ST Firestore Reorg] 984-1005_DOCS-DATA-PIPELINE: #1005 CODE-REVIEW (3 rounds, PASS — majors: cross-day double-staging, cancel-vs-mint race, seq-scan double-mint, stamped-trade cancel divergence, foreign-ticket cancel) + #1092 UAT (Complete — deploy + verify-564 28/28 + zero leftovers)
- [Savant Design System] 1024-1043_DOCS-IMPL-DESIGN-SYSTEM: 1024-1025-DS-INVENTORY.md — element catalog (12 extracted + 4 infra + 9 candidate rows), live call-site dup counts, real-path citations; mockup convention (/dev/ds screenshots or token-built SVGs, cited by element name)
- [Savant Design System] 1024-1043_FE-VERIFY-DESIGN-SYSTEM: design-system-inventory-1043 relay (16 checks — doc path, canonical header, convention stated, every cited path resolves incl. sibling checkouts, tables populated) + guide + README/run-all index
- [Savant Design System] 1024-1043_DOCS-DESIGN-SYSTEM: #1043 CODE-REVIEW (4 rounds converged — stat-strip miscite, error-literal overcount, bare-filename cites normalized, ST vendoring row added) + #1095 UAT (Complete, 7 scenarios PASS, all 11 DS relays green)
- [Paper Trading Infra] 553-1076_SHARED-IMPL-PAPER-TRADING: analysis-dataset callable contracts — AnalysisRunParams / GenerateTradeDataset{Request,Response} / AnalysisDatasetTaskPayload / ENTRY_CONVENTIONS ('signal-bar-close') + SIGNAL_TYPES whitelist export + entryFilters provenance on AnalysisDatasetDoc
- [Paper Trading Infra] 553-1076_BE-IMPL-PAPER-TRADING: writeDataset (codec serialize → GCS analysis-datasets/{id}.csv → index ready; any failure flips failed+error — never wedges at generating) + generateTradeDataset callable (auth → validate exit grammar via registry limited to the 3 firing PRD families, real ISO barRange, whitelists → generating doc w/ full params → enqueue → {datasetId}; enqueue failure flips failed + unavailable) + analysisDatasetTask stub + ds-{yyyymmdd}-{origin}-{hash8} versioned ids (params+ts+nonce — same-day reruns distinct)
- [Paper Trading Infra] 553-1076_BE-VERIFY-PAPER-TRADING: verify-1076 relay vs real prod — 9 checks (bad-grammar 4xx, generating doc w/ provenance, ready flip, GCS upload + manifest header + lossless 119.465, forced-fail → failed) + honest enqueue SKIP pre-deploy + guide + index
- [Paper Trading Infra] 553-1076_DOCS-PAPER-TRADING: #1076 CODE-REVIEW (2 rounds, PASS — enqueue-failure wedge, deps.now seam, silent catch) + #1096 UAT (Complete, 12 scenarios) + IMPL §2 as-builts + CONTEXT vocab (Analysis Dataset / Slice / Trade Row)
- [Paper Trading Infra] 553-1077_BE-IMPL-PAPER-TRADING: live-snapshot pass — tradeToRow mapper (ledger-observed lifecycle, stamped ind.* verbatim, direction-aware tradeRetPct + neutral symbolMovePct, marks-walked excursion + giveback, excursionSource 'marks', open→provisional mark ret / unfilled→null lifecycle) + runLiveSnapshot (scope filters symbolScope∩signalTypes∩barRange on signalBarDate??entryDate, per-symbol bar load sliced per anchor, symbol|date strength memoize → writeDataset) + analysisDatasetTask live branch (replay still fail-loud #1078, datasetId guard, failed-transition logged)
- [Paper Trading Infra] 553-1077_BE-VERIFY-PAPER-TRADING: verify-1077 read-only dry-run relay vs real prod — 7 checks (247 trades→247 rows, 229 signal-equity/18 excluded, ind.* stamp, closed/open lifecycle, strength population, excursion sanity) + guide + README/run-all index
- [Paper Trading Infra] 553-1077_DOCS-PAPER-TRADING: #1077 CODE-REVIEW (3 rounds, PASS — filter/mapper anchor disagreement, silent catch on failed-transition, whitespace datasetId) + #1103 UAT (Complete, 11 scenarios) + IMPL §3 as-builts
- [Paper Trading Infra] 553-1078_BE-IMPL-PAPER-TRADING: replay pass — per-symbol SDS daily bars (sliced ≤barRange.to) → zones/strength once per symbol → detectAllStTrendRiderSignals V1+V2 (windowV2=own zone, production parity) → signals filtered post-detection to barRange.from ∩ signalTypes → registry walk via evaluateVariant on daily closes (modeled lifecycle, entry at signal-bar close, exit at trigger-day mark) → h/l excursion + giveback + ind.*/strength.* → writeDataset; empty scope → symbol-data enumeration, no-bars → warn+skip; analysisDatasetTask replay branch wired (both origins live)
- [Paper Trading Infra] 553-1078_DOCS-PAPER-TRADING: #1078 CODE-REVIEW (PASS — mfe/mae seeded first-bar for negative-possible convention parity with live; zero-cross detector correctly excluded — chart markers only) + #1105 UAT (Complete, 12 scenarios — AMAT parity exact on prototype window 99/98/32.7%/1.30; full-history baseline 194/193/35.8%/1.30) + IMPL §3 as-builts
- [Paper Trading Infra] 553-1079_BE-VERIFY-PAPER-TRADING: paper-trading-analysis-dataset consolidated relay — real-pass live dry-run (runLiveSnapshot → collector writeDataset: 247 enumerated→247 rows, cohorts, 46-col non-null sample) + AMAT replay parity on frozen window (bars ≥2023 warmup, barRange.to=2026-10-16; exact rows/closed/signal-set, ±0.5pp winrate, ±0.02 payoff vs checked-in prototype CSV) + informational full-history baseline; #1007-transitional legacy fallback (canonical-empty → legacy read + warn, self-heals); non-zero exit on failure (tamper-proven); run-all + README + guide + fixture
- [Paper Trading Infra] 553-1079_DOCS-PAPER-TRADING: #1079 CODE-REVIEW (PASS — tautological row-count check fixed: dep records enumerated count) + #1124 UAT (Complete, 12 scenarios — relay green post-migration warn-free; negative path proven exit 1) + IMPL §4 as-builts
- [ST Firestore Reorg] 984-1006_SHARED-IMPL-DATA-PIPELINE: st-collections LEGACY_OPTIONS_STRATEGY_INSTANCES constant (scripts-only literal for the pre-migration root) + NaN-safe deepEqual in legacy-order-intents (Firestore stores native NaN in the overnight sim grid — parity checks false-mismatched)
- [ST Firestore Reorg] 984-1006_BE-IMPL-DATA-PIPELINE: strategy-instance-repository re-pointed to st-strategy-instances — union-read with legacy paper-trading/instances/items anchor until #1014, newest updatedAt wins (tie → canonical), lifecycle filter post-merge, getInstance fallback; open-pass/position-repository/overnight-simulation-writer daily-analysis on canonical root; settlement txn canonical-first w/ anchor fallback; migrate-strategy-instances-1006 (union migrate, mode:'paper', canonical-newer skip, write-if-absent managed fields — rerun-safe); 19 repo specs
- [ST Firestore Reorg] 984-1006_BE-VERIFY-DATA-PIPELINE: data-pipeline-st-strategy-instances-1006 relay vs real prod — canonical shape, legacy⇄canonical parity (soak drift WARN), daily-analysis carry, repo seam (read-only) + guide + README/run-all index
- [ST Firestore Reorg] 984-1006_DOCS-DATA-PIPELINE: #1006 CODE-REVIEW (3 rounds, PASS — union-read shadowed soak edits → newest-wins; rerun stomped canonical → canonical-newer skip; pre-merge where defeated pause-shadow → post-merge filter) + #1097 UAT (Complete — migration applied, post-deploy audit 0 FAIL/0 WARN)
- [ST Firestore Reorg] 984-1007_SHARED-IMPL-DATA-PIPELINE: ST_PORTFOLIO_ANCHORS exported (kind→anchor map) so the portfolio mirror inverts anchor→kind instead of re-encoding
- [ST Firestore Reorg] 984-1007_BE-IMPL-DATA-PIPELINE: collection renames — paper-trading seam routes account/trade/stats/raw-quote to st-paper-trading (instances until #1014, cohorts stay legacy per #1004, analysis-* own task); backtest writers → st-backtest-*; portfolioItemsMirror legacy→canonical wholesale-set soak + stBacktest*Mirror canonical→legacy merge-set shadow preserving FE-owned archived/qualityDesignation/updatedAt; 23-spec suite incl. trigger-path pins
- [ST Firestore Reorg] 984-1007_BE-IMPL-DATA-PIPELINE: migrate-collection-renames-1007 — dry-run-default 8-family copy, --apply/--family/--force, divergent-dest skip (rerun-safe vs post-cutover writes); applied on prod: 1605 docs, 2 divergent stats protected, 0 failures
- [ST Firestore Reorg] 984-1007_BE-VERIFY-DATA-PIPELINE: data-pipeline-collection-renames-1007 parity audit — updatedAt-aware FAIL/WARN (canonical-newer drift expected, stale/missing canonical FAIL); backtest FE-field symmetric strip; run on prod: 0 FAIL/2 WARN + README/run-all index
- [ST Firestore Reorg] 984-1007_DOCS-DATA-PIPELINE: #1007 CODE-REVIEW (2 rounds, PASS — migrator divergent-dest clobber, audit perma-FAIL post-cutover, mirror erased FE-owned fields; R2 residual: one-sided updatedAt strip → symmetric) + #1116 UAT (Complete — selective 21-fn deploy, 1605-doc migration, 0-FAIL parity, portfolio+backtest soak probes)
- [ST Firestore Reorg] 984-1008_SHARED-IMPL-DATA-PIPELINE: stConfigDocPath — shared `st-config/{docId}` path helper adopted by getAgentStatus + run-progress statusRef; AUTO_PAPER_CONFIG_DOC comment corrected to canonical location
- [ST Firestore Reorg] 984-1008_BE-IMPL-DATA-PIPELINE: config/lists soak — tradingConfigMirror + symbolListsMirror (legacy→canonical wholesale set/delete) + stStatusMirror (literal-path `st-config/status`→legacy shadow, collision-guarded); ingest/getAgentStatus/run-progress reads cut to st-config + st-symbol-lists; addSymbolToDefaultList atomic WriteBatch dual-write; 20-spec suite incl. batch rollback
- [ST Firestore Reorg] 984-1008_BE-IMPL-DATA-PIPELINE: migrate-config-lists-1008 (3 families, dry-run/--apply/--family/--force, only 'current'→'status' remap, divergent-skip rerun-safe) + sweep-unlisted-to-new dual-write + replay dedup + qa-probe-1008 soak verifier; applied on prod: 10 docs, 0 failures, 0 drift across deploy window
- [ST Firestore Reorg] 984-1008_BE-VERIFY-DATA-PIPELINE: data-pipeline-config-lists-1008 parity audit — destInclude partitions shared st-config root (no autoPaper/uid dest-only noise), direction-aware FAIL/WARN; prod run 0 FAIL/0 WARN post-deploy; 916/917/918/seed-config verifies re-pointed to canonical roots + README/run-all index
- [ST Firestore Reorg] 984-1008_FE-CHORE-DATA-PIPELINE: dead run.service.statusDoc field dropped (no live FE status-doc reader — callable-only)
- [ST Firestore Reorg] 984-1008_DOCS-DATA-PIPELINE: #1008 CODE-REVIEW (2 rounds, PASS — audit dest-only noise, non-atomic dual-write, second legacy-only sweep writer, status-doc collapse) + #1128 UAT (Complete — inverted migrate→deploy→re-migrate→audit ordering, 4 live soak probes, canonical ingest/status reads verified on prod)
- [ST Firestore Reorg] 984-1009_BE-IMPL-DATA-PIPELINE: review-list + occurrence-decisions BE surface retired — dead deprecated constants removed from st-collections.ts (last BE reference surface; both collections FE-owned until #1016/#1017); 5-spec guard suite pins zero functions/src references outside the whitelisted TTL sweeper; sweeper deliberately retained (drains until #1013)
- [ST Firestore Reorg] 984-1009_BE-VERIFY-DATA-PIPELINE: data-pipeline-decisions-retirement-1009 prod audit — cwd-independent code-invariant scan, anchored sweeper-export check, decidedAt range validation (missing WARNs as undrainable, unparseable FAILs — no NaN false-OK), fresh-write WARN expected until #1017; run-all/README registered; migrate-st-collections.js do-not-rerun guard
- [ST Firestore Reorg] 984-1009_DOCS-DATA-PIPELINE: #1009 CODE-REVIEW (1 round, PASS — audit NaN-guard major remediated + 9 minors) + #1142 UAT (Complete — 5/5 scenarios, prod audit 0 FAIL/0 WARN, sweeper verified deployed) + st-cloud README retired-path row fix
- [ST Firestore Reorg] 984-1010_BE-IMPL-DATA-PIPELINE: run-jobs 7-day TTL — cleanupStRunJobs nightly sweeper (45 3 * * * UTC, 20k deletes/invocation cap) + shared per-run purge core (enumerates runs under st-runs + savant-trader/data/runs, per-run createdAt<cutoff deletes — collectionGroup('jobs') rejected: no prod index + ~1.12M foreign rs/spread jobs would starve an oldest-first scan) + purge-st-run-jobs-1010 one-shot drain (dry-run default, --apply/--max/--days); 16-spec suite; deployed + live-verified at cap
- [ST Firestore Reorg] 984-1010_BE-VERIFY-DATA-PIPELINE: data-pipeline-run-jobs-ttl-1010 prod audit — sweeper-export + core query-shape checks, exact per-root eligible/retained census, foreign census INFO, missing-createdAt sample WARN → #1013; run-all/README registered
- [ST Firestore Reorg] 984-1010_DOCS-DATA-PIPELINE: #1010 CODE-REVIEW (1 round, PASS — 3 majors remediated pre-verdict: missing group index, foreign-job starvation, trigger-boundary extraction) + #1145 UAT (Complete — live sweep 20k at cap, purge drained remaining 93,486, total 113,486 = dry-run count, 24,076 recent jobs retained, foreign group provably untouched)
- [ST Firestore Reorg] 984-1011_BE-IMPL-DATA-PIPELINE: NEW-list additive backfill — st-new-list-sweep core extracted from the sweep script (FE-order listKeyOf incl. {any}_{EXCLUSIVE} suffix fallback, exclusiveMembers census via summarizeListDocs, ambiguity-rejecting target resolver, arrayUnion-only payload with per-leg meta mint + half-migrated meta heal); sweep-unlisted-to-new rewired onto it, dual-root universe+membership reads, --uid validation + prefix-aware owner attribution; 25 specs
- [ST Firestore Reorg] 984-1011_BE-VERIFY-DATA-PIPELINE: data-pipeline-new-list-1011 prod audit — additive-core invariant, dual-root census, unlisted count, dual exclusive-membership WARN, per-leg NEW-doc meta check (key-sans-role flagged), list-root parity; run-all/README registered (#38)
- [ST Firestore Reorg] 984-1011_DOCS-DATA-PIPELINE: #1011 CODE-REVIEW (PASS, 2 rounds — majors remediated: per-leg doc state on the dual-root write, FE list-key parity, audit multi-NEW crash; round-2 false-positive major rejected with evidence) + #1150 UAT (Complete — 7/7 scenarios, prod 0 unlisted, audit 0 FAIL/0 WARN)
- [ST Firestore Reorg] 984-1012_BE-IMPL-DATA-PIPELINE: firestore.rules + indexes for all 13 canonical st-* roots — legacy-parity policies (user-scoped CRUD tickets/instances/lists, read-only backend roots, st-config status/autoPaper-vs-{uid} split, portfolio get/list probe split, archive-only backtest updates) + 17 composites covering the AC tuples AND the absorbed legacy query surface (signal-history/signals/run-ids → st-signals, occurrence-decisions fold → tickets, listTradesBySignal → items); 13-spec content gate incl. direction/arrayConfig assertions
- [ST Firestore Reorg] 984-1012_DOCS-DOCS-DATA-PIPELINE: #1012 CODE-REVIEW (PASS, 1 round — direction-assertion gap remediated in spec) + #1153 UAT (Complete — 37/37 live emulator rule-enforcement probes; unauthed deny, cross-user deny, singleton write-lock, bare-list escape, archive-only diff, missing-doc probe, default-deny catch-all)
- [ST Firestore Reorg] 984-1014_SHARED-IMPL-DATA-PIPELINE: StStrategyInstance gains deletedAt (covers deleteInstance soft-delete write) + @deprecated on PORTFOLIO_* path constants (pinned until #1013)
- [ST Firestore Reorg] 984-1014_FE-IMPL-DATA-PIPELINE: symbol-list services → st-symbol-lists — all list CRUD/membership/rekey via ST_SYMBOL_LISTS_ROOT, same doc IDs/query shapes
- [ST Firestore Reorg] 984-1014_FE-IMPL-DATA-PIPELINE: strategy-builder → st-strategy-instances — InstanceInput/payload re-typed on canonical StStrategyInstance (mode:StMode compile-pinned), kind dropped, dead PaperStrategyInstance casts removed
- [ST Firestore Reorg] 984-1014_FE-IMPL-DATA-PIPELINE: portfolio services → st-portfolio — allocation buckets + position attributions via stPortfolioItemsPath(BUCKET|ATTRIBUTION)
- [ST Firestore Reorg] 984-1014_FE-IMPL-DATA-PIPELINE: backtest readers → ST_BACKTEST_RUNS_ROOT + ST_BACKTEST_PERMUTATIONS_ROOT
- [ST Firestore Reorg] 984-1014_FE-IMPL-DATA-PIPELINE: trading-config → stConfigDocPath(uid) = st-config/{uid}
- [ST Firestore Reorg] 984-1014_FE-IMPL-DATA-PIPELINE: Collection enum pruned (ST_SYMBOL_LISTS/ST_SYMBOL_META/ST_TRADING_CONFIG/PAPER_TRADING_INSTANCES removed; ST_RUNS/ST_ORDER_INTENTS/ST_REVIEW_LIST/ST_OCCURRENCE_DECISIONS/ST_SYMBOLS retained @deprecated for #1015-#1019/#1159) + st-path-cutover-1014 spec — pin assertions + fs grep-scan asserting zero legacy literals in src/app
- [ST Firestore Reorg] 984-1014_FE-CHORE-DATA-PIPELINE: dead-code removal — symbol-meta.service.ts (zero callers, retired collection), orphaned chunkArray/getDocData/CreatedAtDoc helpers, dead SymbolType
- [ST Firestore Reorg] 984-1014_DOCS-DATA-PIPELINE: #1014 CODE-REVIEW (PASS, 2 rounds — majors remediated) + #1157 UAT (Complete — prod-probe verified populated roots, caught empty st-runs/st-symbols → deferred to #1159; analysis anchors → #1160; grep-scan green)
- [ST Firestore Reorg] 984-1015_FE-IMPL-DATA-PIPELINE: order-ticket boundary → st-order-tickets — OrderTicket↔StOrderTicket mapper ({liv|pap}_ id normalize, origin.signalId mint, auto=signal|program, PAPER-patch reject), service CRUD/hydration on canonical root, ST_ORDER_INTENTS removed, store liv_-merge preserve + pap_ doc-move + non-signal reconcile, rhOrderFillSummary executions-weighted fill price, fillSummary+lastError terminal writes + deleteField requeue cleanup
- [ST Firestore Reorg] 984-1015_FE-IMPL-DATA-PIPELINE: cancel_pending/expired UX — queue Cancelling/Expired groups, ticket-detail error.code + fillSummary fill row + Modify/Cancel hidden while cancelling, card/dialog/option-ticket status surfaces, reconcile merge-preserve until RH terminal
- [ST Firestore Reorg] 984-1015_DOCS-DATA-PIPELINE: #1015 CODE-REVIEW (PASS, 2 rounds — majors remediated: fillSummary.filledAt, market-fill price source, pap_ zombie hydrate, management reconcile, liv_↔pap_ doc-move) + #1173 UAT (Complete — prod audit 188 docs 0 FAIL, live PLTR order verified canonical, card-state replay 204/205 tradeable; runs-stream collapse filed #1180)


## [2026-10-17]

### Added
- [ST Firestore Reorg] 984-1003_SHARED-IMPL-DATA-PIPELINE: fractional-quantity terms validation — non-option instruments accept fractional shares; option/expressionTemplate tickets still require integers; st-types-998 verifier pin updated
- [ST Firestore Reorg] 984-1003_BE-IMPL-DATA-PIPELINE: order-intents→st-order-tickets soak — legacyIntentToTicket pure mapper (status→mode/state incl. 'paper'→mode, lineage/tracking/signalContext, migratedFrom) + orderIntentsMirror txn dual-write (terminal-wins, updatedAt non-regression, opposite-prefix orphan delete, fail-soft malformed)
- [ST Firestore Reorg] 984-1003_BE-IMPL-DATA-PIPELINE: canonical-first reads — getTicketDoc queries st-order-tickets by refId with lifecycle-sibling-safe pick chain + legacy fallback; screenshot tracking.ts repointed to nested tracking.* on canonical tickets
- [ST Firestore Reorg] 984-1003_BE-IMPL-DATA-PIPELINE: migrate-order-intents-1003 — dry-run-default backfill (EQ-trade paper settlement, terminal suppression, orphan cleanup) + post-apply parity audit; applied on prod: 90/90 created, paperSettled=9, rerun unchanged=90, audit 0 FAIL
- [ST Firestore Reorg] 984-1003_DOCS-DATA-PIPELINE: CODE-REVIEW (4 rounds, PASS — incl. stored-PaperTrade-shape + sibling-refId majors remediated) + UAT (Complete — live soak probe 11/11, mirror deployed with eventarc.eventReceiver grant)
- [Savant Design System] 1024-1040_FE-IMPL-DESIGN-SYSTEM: _pd-visual-language delegation shim — @forward 'index' delegates 7 mixins to savant-ds (zero duplicated bodies); $up/$down → var(--ds-*) reads; 5 data-display mixins sole-source pending #1052; ds-parity-probe now delegation-aware (probes diff delegated-vs-package emission through the real shim)
- [Savant Design System] 1024-1040_FE-VERIFY-DESIGN-SYSTEM: design-system-vl-shim-1040 relay (39 checks) — sole-forward + index*-shadow guards, boundary-exact 14-member fixture through real includePaths, no :root leakage, sass via package createRequire
- [Savant Design System] 1024-1040_DOCS-DESIGN-SYSTEM: CODE-REVIEW (2 rounds, PASS — R1 probe regression + fixture/shadow/leak holes remediated) + UAT (Complete — 545/545 jest, all 6 DS relays green)
- [Paper Trading Infra] 553-1067_FE-IMPL-PAPER-TRADING: paper trades table rework — sticky thead + rows-only scroll (border-collapse:separate), viewport-height flex page (ungrouped fills to bottom; grouped outer panel scroll, ~40vh per-table caps), cohort sections collapsed with accordion expandos, duplicate drill-down rendering removed, 8-column sortable headers with multi-key sort chain (shift+click, asc→desc→removed, rank badges, aria-sort + Enter/Space), equity curve panel + orphaned stats pipeline retired (store statsByScope/statsList/isLoadingStats + service getPaperStats$), group open-count/capital via canonical LIFECYCLE_OPEN_TRADE_STATUSES
- [Paper Trading Infra] 553-1067_DOCS-PAPER-TRADING: #1067 CODE-REVIEW (2 rounds, PASS — majors: dead only-child flex chain, stats-fetch waste, grouped-section shrink-to-strips, literal status sets → canonical lifecycle const) + #1068 UAT (Complete — 11/11 scenarios, 9 live-verified)

## [2026-10-16]

### Added
- [Savant Design System] 1024-1035_SHARED-IMPL-DESIGN-SYSTEM: --ds-* token layer (styles/_tokens.scss) — --mat-sys-* mirrors + P&L accents + spacing/typography/density/elevation + [data-theme="dark"] shadow overrides; _index.scss pinned to mixins-only emission contract
- [Savant Design System] 1024-1035_SHARED-VERIFY-DESIGN-SYSTEM: token-layer verify (86 checks) — real sass compile, manifest set-equality both directions, exact literal + dark values, per-alias --mat-sys-* binding, loadPaths consumer resolution; rel-str relay script + run-all needsPath gate
- [Savant Design System] 1024-1035_DOCS-DESIGN-SYSTEM: IMPL _index-forwarding contract fix + CODE-REVIEW (2 rounds, PASS) + UAT (Complete) for --ds-* tokens
- [Savant Design System] 1024-1036_SHARED-IMPL-DESIGN-SYSTEM: _page.scss — ds.page-host/page-shell/content-column/header-bar graduated from _pd-visual-language.scss, tokenized to --ds-*; _index.scss @forward 'page' (first mixin export)
- [Savant Design System] 1024-1036_SHARED-VERIFY-DESIGN-SYSTEM: mixin verify (128 checks) — declaration-anchored fixture asserts, emission contract (only fixture classes emit), mixin-surface set-equality; rel-str relay + verbatim-semantics parity probe (derived token map, 30 decls/6 selectors)
- [Savant Design System] 1024-1036_DOCS-DESIGN-SYSTEM: CODE-REVIEW (2 rounds, PASS) + UAT (Complete) for ds.* page mixins
- [Savant Design System] 1024-1037_SHARED-IMPL-DESIGN-SYSTEM: _dialog.scss (ds.dialog-chrome/dialog-status) + _feedback.scss (ds.error-banner) graduated from _pd-visual-language.scss, tokenized to --ds-*; .spinner resolves the app's global @keyframes spin; _index.scss forwards all three mixin modules
- [Savant Design System] 1024-1037_SHARED-VERIFY-DESIGN-SYSTEM: verify hardened (303 checks) — comment-stripped scans, bidirectional decl asserts, tokens/index emission contracts, anchored fixture roots; shared ds-parity-probe.ts lib + #1036 relay refactor + #1037 relay; run-all needsPath cwd fix
- [Savant Design System] 1024-1037_DOCS-DESIGN-SYSTEM: CODE-REVIEW (3 rounds, PASS) + UAT (Complete) for ds.* dialog/feedback mixins
- [Savant Design System] 1024-1038_SHARED-IMPL-DESIGN-SYSTEM: surface-consolidation verify (340 checks) — styles/ all-entries manifest, _index forwards-exactly-{page,dialog,feedback} (+quote-style/parse-count guards), fixture-exercises-every-mixin both directions, _tokens member-free guard, //-in-string anomaly guard
- [Savant Design System] 1024-1039_SHARED-IMPL-DESIGN-SYSTEM: _tokens.scss header contract correction — --mat-sys-* need only exist on :root (var() binds at computed time; source order irrelevant)
- [Savant Design System] 1024-1039_FE-IMPL-DESIGN-SYSTEM: ST consumption wiring — savant-ds file: dep + junction link, angular.json includePaths on build+test, styles.scss @use 'tokens' (27 --ds-* + dark block in emitted bundle)
- [Savant Design System] 1024-1039_FE-VERIFY-DESIGN-SYSTEM: design-system-consumption-1039 relay (37 checks) — package-anchored sass createRequire, live token-name reads, :root-scoped boundary-exact emitted asserts, src/ shadow guard; #1034 dry-run check de-proxied (exit-0 = resolved)
- [Savant Design System] 1024-1039_DOCS-DESIGN-SYSTEM: CODE-REVIEW (PASS, A1–A4 remediated) + UAT (Complete) for ST consumption wiring
- [Savant Design System] 1024-1038_SHARED-VERIFY-DESIGN-SYSTEM: design-system-index-verify-1038 relay (npm run verify in ../savant-ds) + run-all/README registration
- [Savant Design System] 1024-1038_DOCS-DESIGN-SYSTEM: CODE-REVIEW (2 rounds, PASS) + UAT (Complete) for index forwards + surface verify — Phase #1032 package foundation complete
- [ST Firestore Reorg] 984-1001_BE-IMPL-DATA-PIPELINE: st-signals backfill script — folds legacy signal-history + run-ids into canonical occurrences (entry.barDate ids, runIds union, history-gated CONFIRMED, earliest-detection provenance, upgrade-only merges, malformed/notes channels, dry-run/--symbol, per-symbol isolation, chunked getAll + batch ≤400)
- [ST Firestore Reorg] 984-1001_BE-VERIFY-DATA-PIPELINE: read-only all-dates backfill parity audit — FAIL/WARN tiers (missing/dupes/bad-status/field-identity vs live-created-provenance divergence), runIds extras, doc-id prefix EXTRA scan, per-symbol isolation
- [ST Firestore Reorg] 984-1001_DOCS-DATA-PIPELINE: CODE-REVIEW (3 rounds, PASS) + UAT (Complete) for st-signals backfill
- [ST Firestore Reorg] 984-1002_BE-IMPL-DATA-PIPELINE: StOrderTicketWriter + BE emission — canonical st-order-tickets/{liv|pap}_{id} across auto-paper ingest (signal/auto), open-pass (program/auto, mode from instance), paperSignalOrder (equity + staged per-template expressionTemplate tickets), cancelPaperTrade; atomic emit, txn-guarded lifecycle (failed→filled heal, fill-beats-cancel), legacy order-intents/PENDING trades untouched (dual-write window)
- [ST Firestore Reorg] 984-1002_BE-VERIFY-DATA-PIPELINE: read-only st-order-tickets canonical-shape audit — id↔mode prefix, origin/state/terms axes, state↔field coherence, mode-scoped submittedAt
- [ST Firestore Reorg] 984-1002_DOCS-DATA-PIPELINE: CODE-REVIEW (3 axes converged, PASS) + UAT (Complete) for st-order-tickets emission
- [Options Trading] 942-964_FE-IMPL-OPTIONS: gallery dialog Stock/Option tabs (lazy matTabContent + preserveContent), 'Open order ticket' title, dual close-on-done, OPTION card statusing via decisionIds (side-skip, live-over-STAGED), equity-scoped trade/paper reopen, session-created STAGED discard on close
- [Options Trading] 942-964_DOCS-OPTIONS: CODE-REVIEW (PASS after in-review remediation) + UAT (Complete) for gallery option tab + statusing/discard
- [Trading Indicator Library] 261-945_DOCS-INDICATOR-LIB: UAT Complete — QA #954 RESOLVED/PASS (M1–M9 recorded; spec evidence M4/M7/M8, user-accepted M1/M2/M3/M5/M9, M6 waived pending revisit); ST Anchored VWAP leg-overlay task shipped
- [Options Trading] 942-965_SHARED-IMPL-OPTIONS: optional bid/ask on EquityQuote + OptionQuote — getOptionQuotes fills bid_price/ask_price, feeds the order-dialog quote strip + option ticket quote line
- [Options Trading] 942-965_FE-IMPL-OPTIONS: chain-page copy-contract button + interactive popup — OCC id to clipboard (paste resolves via parseOptionPaste), 250ms delayed-close hover bridge, keyboard path (Enter/Space → copy button, Escape → refocus), focus-suppressed teardown, copy feedback (check icon, aria-live, snackbar on failure)
- [Options Trading] 942-965_FE-IMPL-OPTIONS: order-ticket dialog header/quote + option contract block — 'Order ticket' title row with {SYM}·company + quote strip, EquityPriceService quotes map, live {exp sym strike type} → OCC → RH id → quote block replacing the old ticket header, dialog 640px/92vh de-padded
- [Options Trading] 942-965_DOCS-OPTIONS: CODE-REVIEW (2 rounds, PASS) + UAT (Complete) for chain copy button + dialog layout pass
- [Options Trading] 942-1055_FE-IMPL-OPTIONS: option-chain deep link + gallery-card Option chain ↗ — /options/chain?symbol=X feeds the same setSymbol+loadChain path (distinctUntilChanged on the param, stale-param revert-proof); real anchor on the card action row (right-justified, native new-tab/middle-click, ungated by actionsDisabled)
- [Options Trading] 942-1055_DOCS-OPTIONS: CODE-REVIEW (1 round, PASS) + UAT (Complete) for deep link + card affordance

### Fixed
- [Options Trading] 942-964_SHARED-BUG-OPTIONS: option instrument/quote wire contract — dropped state/tradability pins that zeroed upstream results, data.next pagination (10-page cap), client-side tradability filter, get_option_quotes live-shape parse (mark_price→lastTradePrice, close.price→previousClose)
- [Options Trading] 942-964_FE-BUG-OPTIONS: option ticket hosting fixes — qty default '1' (submit enables immediately, stepper 1→2), quote mark auto-fill preserving user-typed prices, staged emit on stale-session commits (host discard), computed ticketsBySymbol spec mocks

## [2026-10-15]

### Added
- [ST Firestore Reorg] 984-997_SHARED-IMPL-DATA-PIPELINE: st- collection path constants + @st/collections alias — shared module (flat + anchored roots, path helpers, guards), BE re-export barrel, offline verify script
- [ST Firestore Reorg] 984-997_FE-IMPL-DATA-PIPELINE: @deprecated markers on legacy Collection enum members — successor pointers for cutover tasks
- [ST Firestore Reorg] 984-997_DOCS-DATA-PIPELINE: Topic docs — ADR-009, DATA-MAP, PRD, IMPL/TEST plans
- [ST Firestore Reorg] 984-997_DOCS-DATA-PIPELINE: CODE-REVIEW (5 passes, PASS) + UAT (Complete) for st- collections
- [ST Firestore Reorg] 984-998_SHARED-IMPL-DATA-PIPELINE: canonical st- type shapes — StSignal, StOrderTicket (symbol, option legs, failed state, migration homes), StPositionGroup (+userId), StStrategyInstance (+mode/paperAccountId/enabled), PaperTrade lineage/contract fields, direction normalizer, 41 specs
- [ST Firestore Reorg] 984-998_CONFIG-DATA-PIPELINE: @st/* path aliases (FE + BE + jest + tsx) + 38-check offline types verify script
- [ST Firestore Reorg] 984-998_BE-IMPL-DATA-PIPELINE: StSignalStatus delegates to @st/signals — single canonical source
- [ST Firestore Reorg] 984-998_DOCS-DATA-PIPELINE: IMPL §2 as-built deltas + CODE-REVIEW (PASS) + UAT (Complete) for st- type shapes
- [Portfolio Allocation] 576-781_FE-IMPL-PORTFOLIO: Dialogs → token/density pass — dialog-chrome + dialog-status mixins in _pd-visual-language.scss; 5 dialogs tokenized (hex/rgba → --mat-sys-*), dense fields, 32px stroked actions, inline styles → .scss
- [Portfolio Allocation] 576-781_DOCS-PORTFOLIO: CODE-REVIEW (PASS) + UAT (Complete) for dialog token/density pass
- [Options Trading] 942-962_FE-IMPL-OPTIONS: submitOptionOrder via shared review→place→classify flow (review_option_order→place_option_order, legs wire shape, ref_id place-only, no direction) + pre-validation guards + processed_quantity fills + submitTicket OPTION routing + confirm-dialog contract summary (OCC, BUY TO OPEN, premium qty×100)
- [Options Trading] 942-962_DOCS-OPTIONS: CODE-REVIEW (2 rounds, PASS) + UAT (Complete) for option submit path; IMPL-948 persisted-fields/cancel-routing pins for #963/#964
- [ST Firestore Reorg] 984-999_SHARED-IMPL-DATA-PIPELINE: st- doc-id builders (@st/ids) — signal/ticket/trade/group layouts, origin codes, guard contract (arg-order trap, '/' + '_' + dash + bad-seq + invalid-Date rejections), seq-allocation contract
- [ST Firestore Reorg] 984-999_SHARED-IMPL-DATA-PIPELINE: legacy→canonical mapping helpers — OrderSource→origin.type, OrderTicketStatus→{mode,state}, barStatus→StSignalStatus
- [ST Firestore Reorg] 984-999_BE-IMPL-DATA-PIPELINE: signal-persister delegates barStatus mapping to @st/signals
- [ST Firestore Reorg] 984-999_CONFIG-DATA-PIPELINE: @st/ids alias (FE + BE + jest + tsx) + offline ids verify script
- [ST Firestore Reorg] 984-999_DOCS-DATA-PIPELINE: IMPL §3/§4 as-built + CODE-REVIEW (2 rounds, PASS) + UAT (Complete) for st- id builders + mappers
- [ST Firestore Reorg] 984-1000_BE-IMPL-DATA-PIPELINE: st-signals dual-write in SignalDateWriter — canonical occurrence docs upserted in the same batch as legacy run-ids/signal-history/gate-date writes; fail-soft per-entry so canonical failures can't drop legacy writes
- [ST Firestore Reorg] 984-1000_BE-VERIFY-DATA-PIPELINE: read-only st-signals ⇄ run-ids parity audit (per-occurrence aggregation, runIds union, create-only provenance)
- [ST Firestore Reorg] 984-1000_DOCS-DATA-PIPELINE: IMPL §1 as-built + CODE-REVIEW (PASS) + UAT (Complete) for st-signals dual-write
- [Paper Trading Infra] 553-983_BE-VERIFY-PAPER-TRADING: read-only marks-vs-SDS-close drift report + sdsConsumerDispatch replay script (QA re-dispatch path)
- [Paper Trading Infra] 553-983_DOCS-PAPER-TRADING: #983 CODE-REVIEW (PASS) + #1027 UAT (Complete) — dispatched settlement replay evidence, ok=155 drifted=0
- [Options Trading Support] 942-963_FE-IMPL-OPTIONS: OptionOrderTicketComponent — expiration/strike/type selects + OCC paste → seq-guarded staged option ticket (re-leg/adopt/live-ticket guard, self-healing blocks), qty/price/TIF/fatfinger/bucket form, persist→confirm→reverify→submit; OrderTicketPatch distributive union widening
- [Options Trading Support] 942-963_DOCS-OPTIONS: #963 CODE-REVIEW (3 rounds, PASS) + UAT (Complete) + IMPL as-built drift fix
- [Savant Design System] 1024-1034_SHARED-IMPL-DESIGN-SYSTEM: savant-ds package skeleton (C:\aa\projects\savant-ds) — package.json + README consumption contract (file: dep, includePaths) + _index.scss + verify stub
- [Savant Design System] 1024-1034_SHARED-VERIFY-DESIGN-SYSTEM: savant-ds skeleton verify — real file: install + junction probe (14 checks) + run-all needsPath gate
- [Savant Design System] 1024-1034_DOCS-DESIGN-SYSTEM: Topic 1024 docs — PRD + IMPL×2 + TEST×2 + CODE-REVIEW (PASS) + UAT (Complete); CONTEXT.md savant-ds/Design Token/DS Gallery glossary
### Added (checkpoints)
- [Paper Trading Infra] 553-920_BE-VERIFY-PAPER-TRADING: autoPaper trading-config seed script for #920 umbrella QA — resolves ownerUid from {uid}_PRIMARY, writes + reads back (checkpoint)
- [Paper Trading Infra] 553-920_DOCS-PAPER-TRADING: #920 UAT doc (umbrella) — PARTIAL, AC1 PASS / AC2-4 BLOCKED (checkpoint)
- [Paper Trading Infra] 553-553_DOCS-PAPER-TRADING: AS-BUILT feature inventory + topic-level end-to-end UAT docs (checkpoint)
- [Flex Chart Visual Polish] 213-934_FE-IMPL-FLEX-CHART: sandbox settings persisted to localStorage — versioned read/save/clear, per-option paramOverrides map (checkpoint)
- [Flex Chart Visual Polish] 213-955_FE-IMPL-FLEX-CHART: AVWAP per-line depth params, showLine1/showLine2 toggles, distinct orange/green line-2 defaults + Pine reference export (checkpoint)
- [Flex Chart Visual Polish] 213-935_FE-IMPL-FLEX-CHART: ZigZag param input types for bespoke params strip (checkpoint)
- [Flex Chart Visual Polish] 213-909_DOCS-FLEX-CHART: PRD — dev save settings (checkpoint)
- [Flex Chart Visual Polish] 213-928_DOCS-FLEX-CHART: IMPL + TEST — sandbox persisted settings & param editing FE (checkpoint)
- [Flex Chart Visual Polish] 213-934_DOCS-FLEX-CHART: #933 CODE-REVIEW + #934 UAT docs for sandbox settings persistence (checkpoint)
- [Option Chain Pct Change Grid] 326-518_DOCS-OPTIONS: SA corpus handoff SPEC update + RATIONALE doc — why swing generation/options corpus move to SA (checkpoint)
- [Project] DOCS-PARTNER: PDR daily outage report 2026-10-13 (checkpoint)
- [Project] DOCS-PROJ: commit-approval rule in AGENTS.md, TOPICS-INVENTORY #828 entry, skill-gap mock-blindness note (checkpoint)
### Changed
- [Project] CHORE-PROJ: ports:kill covers 4210/3456 + single-port variant; start-dev.mjs async killTree + child-exit shutdown (checkpoint)
- [Paper Trading Infra] 553-920_BE-CHORE-PAPER-TRADING: cron coverage rationale comment on open-pass timer (checkpoint)
### Fixed
- [Paper Trading Infra] 553-920_BE-BUG-PAPER-TRADING: instrument-map resolver surfaces MCP tool-level isError as thrown error — adapter parity (checkpoint)
- [Paper Trading Infra] 553-920_BE-TEST-PAPER-TRADING: listOrders asserts BrokerAdapterError on MCP isError instead of empty page (checkpoint)
- [Robinhood MCP] 657-657_FE-BUG-RH-MCP: display-name fallback for nicknameless accounts — 'Investing' for individual brokerage, title-cased kind otherwise (checkpoint)
- [Paper Trading Infra] 553-983_BE-IMPL-PAPER-TRADING: nightly EOD close stamp — runSignalEodClosePass writes SDS official close into signal-trade marks[date] ({mark,underlyingClose}) before exit eval; markSignalTrade persists underlyingClose
- [Paper Trading Infra] 553-983_BE-TEST-PAPER-TRADING: 8 eod-close pass specs (incl. chain ordering) + 3 markSignalTrade repo specs

## [2026-10-13]

### Added
- [Robinhood MCP] 657-808_BE-IMPL-RH-MCP: Warm MCP session cache — module-scope {connection, accessToken} reuse with token-match invalidation, auth/session-failure single reconnect+retry, timeout rotation; concurrency 8 + minInstances 1 on rhApi (warm-session 1793→~400ms)
- [Navigation and Workflows] 625-648_DOCS-WORKFLOWS: Daily Session run-sheet rewritten as plain daily/weekly checklist (scope pivot — user-directed); stale routes fixed (/portfolio, /signals/review); (external) tag + RS Momentum weekly item; per-strategy drill-down growth seam; #655 UAT Complete
- [Robinhood MCP] 657-792_BE-IMPL-RH-MCP: Surface all 76 RH MCP tools in the observation allowlist — 9 domain groups; Crypto/Alerts/SEC Filings new; mutation/simulation/financial-mutation classification for the new surface
- [Robinhood MCP] 657-792_FE-IMPL-RH-MCP: Observation page — rhs_account_number account dropdown (name-driven + pnl-tool mapping), JSON textarea args for object/array params (legs, tax_lots, scan filters/columns, alert indicator), malformed-JSON execute block, category order for the new groups
- [Trading Indicator Library] 261-932_SHARED-IMPL-INDICATOR-LIB: Trigger Bands wire consts + keyed dot map + light neutral remap — TRIGGER_BANDS_SIGNAL_TYPES/TriggerBandsSignalType/isTriggerBandsSignalType as single BE-FE source; light colorRemap #ffffff->#9e9e9e (checkpoint)
- [Trading Indicator Library] 261-932_BE-IMPL-INDICATOR-LIB: Emit shared TB signal consts; drop dead signals.triggerBands contract slot (checkpoint)
- [Trading Indicator Library] 261-932_FE-IMPL-INDICATOR-LIB: FE mirror drops dead signals.triggerBands; warnIfStaleSeries extracted — staleness diagnostic lives on the lean injector path (checkpoint)
- [Trading Indicator Library] 261-932_FE-IMPL-INDICATOR-LIB: Trigger Bands promoted to prod ST_INDICATOR_OPTIONS; dev sets emptied (checkpoint)
- [Trading Indicator Library] 261-932_FE-IMPL-INDICATOR-LIB: Signal-detail opt-in Trigger Bands on D+W — separate bands/dots menu entries, lean request under own cache key (checkpoint)
- [Trading Indicator Library] 261-932_SHARED-IMPL-INDICATOR-LIB: Land rb-st-trigger-bands.pine reference export (checkpoint)
- [Trading Indicator Library] 261-945_FE-IMPL-INDICATOR-LIB: computeZigZagAnchorResult — one walkPivots pass emits anchor events + projection pivots (checkpoint)
- [Trading Indicator Library] 261-945_FE-REFACTOR-INDICATOR-LIB: shared numParam/colorParam/boolParam extracted to indicator-params.ts (checkpoint)
- [Trading Indicator Library] 261-945_FE-IMPL-INDICATOR-LIB: AVWAP {segments, legs} engine — surviving-anchor chain alternates H/L like ST ZigZag; line1/line2 rename (checkpoint)
- [Trading Indicator Library] 261-945_FE-IMPL-INDICATOR-LIB: 16-series AVWAP builder — MultiColoredLine chain w/ per-leg hues + dashed developing leg; rightDepth default 2; showZigZag toggle (checkpoint)
- [Trading Indicator Library] 261-945_FE-IMPL-INDICATOR-LIB: render path — series type/dashArray/pointColorMapping bindings + per-point color theming (checkpoint)
- [Trading Indicator Library] 261-945_DOCS-INDICATOR-LIB: PRD/IMPL/TEST sync — surviving-anchor leg overlay (checkpoint)
- [Trading Indicator Library] 261-945_DOCS-INDICATOR-LIB: #945 CODE-REVIEW (PASS) + #954 UAT doc (checkpoint)
- [Portfolio Allocation] 576-780_FE-IMPL-PORTFOLIO: dense-table() mixin + missing M3 tokens in global :root (outline-variant, surface-container-low — M2 indigo-pink emits none; hairlines/hover/tints app-wide were silently dead)
- [Portfolio Allocation] 576-780_FE-IMPL-PORTFOLIO: allocation buckets (expando mini-table + totals) + positions tables migrated to dense-table, inline styles -> styleUrl scss
- [Portfolio Allocation] 576-780_FE-IMPL-PORTFOLIO: equity/option/open-orders/order-history migrated to dense-table (.num numerics, sticky chrome, pinned totals) — commit also lands fused in-flight work (sortable headers, Entry column, open-orders Mark/Dist/select/modify) + removes rowShim dev scaffolding
- [Portfolio Dashboard] 219-979_FE-IMPL-PORTFOLIO: replaceEquityOrder extracted — confirmed-cancel gate + bounded place loop; updateEquityStopOrder delegates; cancelOptionOrder wrapper
- [Portfolio Dashboard] 219-979_FE-IMPL-PORTFOLIO: Order Modify routed through replaceEquityOrder (phase-mapped snackbars, always-refresh); bulk cancel parallelized via allSettled
- [Paper Trading Infra] 553-980_BE-VERIFY-PAPER-TRADING: auto-paper dispatch script parameterized {runId, marketDate, triggeredBy} — drives live gate + ingest QA legs
- [Paper Trading Infra] 553-980_DOCS-PAPER-TRADING: #980 CODE-REVIEW (PASS) + #981 UAT (Complete) — live dispatch evidence for all trigger legs
### Changed
- [Robinhood MCP] 657-690_BE-IMPL-RH-MCP: Discovery assembler emits main index doc + 9 per-category children; flat dot-path response shapes; inventory verifier aggregates across children
- [Robinhood MCP] 657-689_DOCS-RH-MCP: Canonical discovery doc split into main index + 9 category docs with bidirectional links
- [Robinhood MCP] 657-792_DOCS-RH-MCP: CODE-REVIEW (PASS) + UAT (Complete) for the 76-tool observation page
- [Trading Indicator Library] 261-932_FE-REFACTOR-INDICATOR-LIB: bindTriggerBandsRequest shared lean-request binding replaces triplicated computed+effect twins (checkpoint)
- [Trading Indicator Library] 261-932_FE-REFACTOR-INDICATOR-LIB: BESPOKE_MAIN_PANE_INDICATORS set replaces the five-clause !== template chain (checkpoint)
- [Trading Indicator Library] 261-932_DOCS-INDICATOR-LIB: #932 CODE-REVIEW (PASS, rounds 2-4) + UAT doc for #939 (checkpoint)
- [Portfolio Allocation] 576-780_FE-REFACTOR-PORTFOLIO: position entryDate derived from order history; closed-trades section dropped from dashboard state
- [Portfolio Allocation] 576-780_DOCS-PORTFOLIO: #780 CODE-REVIEW (PASS, 2 rounds) + #978 UAT (Complete)
- [Portfolio Dashboard] 219-979_DOCS-PORTFOLIO: #979 CODE-REVIEW (PASS, round 2 — cancel→place race fixed) + #982 UAT (Complete)
### Fixed
- [Trading Indicator Library] 261-932_FE-BUG-INDICATOR-LIB: IndicatorSeriesStore.clearCache(symbol) never matched the callable|symbol|... key layout; ChartStore.loadCharts blanks symbolDataVersion at fetch start — no stale-key fetch or cross-symbol overlay (checkpoint)
- [Portfolio Allocation] 576-780_FE-BUG-PORTFOLIO: /portfolio renders once all section data loads — tab group gated on globalLoading instead of 4 concurrent table spinners (mid-QA finding); includes fused #979 order-table wiring + dialog deps
- [Paper Trading Infra] 553-980_BE-FIX-PAPER-TRADING: auto-paper trigger gate — stAutoPaperIngest admits nightly+manual only; pdr/symbol-added/absent triggers skip non-post-trigger (intraday runs no longer mint trades)



- [Portfolio Dashboard] 219-979_FE-FIX-PORTFOLIO: open-orders bulk bar + selection affordances gated on agenticAllowed; dead MatCheckboxModule dropped; order-mark spec added
- [Portfolio Dashboard] 219-979_FE-FIX-PORTFOLIO: buildModifyOrderTicket fail-fast on missing symbol/zero remainder; modify dialog rejects same-price + non-positive; safe mark @if
- [Portfolio Dashboard] 219-979_FE-FIX-PORTFOLIO: open-orders bulk bar + selection affordances gated on agenticAllowed; dead MatCheckboxModule dropped; order-mark spec added

## [2026-10-12]

### Fixed
- [Portfolio Dashboard] 219-952_FE-BUG-PORTFOLIO: Trailing scroll room on .pg-body — the last card's @defer (on viewport) placeholder could pin below the clipped scrollport edge at max scroll and never activate the chart
- [Paper Trading Infra] 553-931_BE-IMPL-PAPER-TRADING: stSignalHistory flattened-signals reader — prod signal docs carry literal `signals.{type}` top-level fields (all 3 writers emit via set(merge)) but the callable read a nested map and returned []; signalEntriesFromDoc canonical both-shape read boundary + StRunIdDoc/StSignalHistoryDoc signals? optional — verified broken live then returning real entries post-deploy
- [Paper Trading Infra] 553-931_BE-REFACTOR-PAPER-TRADING: auto-paper ingest repointed to the shared reader — signalEntriesFromRunDoc moved verbatim out of the pass, zero behavior change
- [Paper Trading Infra] 553-931_BE-VERIFY-PAPER-TRADING: st-signal-history-931-reader prod script (real docs → real entries) + #916-inputs third reader copy deduped to the canonical boundary

### Added
- [Paper Trading Infra] 553-931_BE-TEST-PAPER-TRADING: signalEntriesFromDoc specs — flattened/nested/merge/precedence/sourceRunId/empty, wired as test:st-signals
- [Paper Trading Infra] 553-931_DOCS-PAPER-TRADING: #931 CODE-REVIEW (PASS, 1 round) + #975 UAT (Complete — verified live on deployed callable)
- [Options Trading Support] 942-960_FE-IMPL-OPTIONS: MCP client option chain/instrument methods — getOptionChains + getOptionInstruments typed methods, OptionChain/OptionInstrument/OptionInstrumentFilters types, capture-verified fields, active/tradable pins, data.next truncation warn, batch-composable ToolSpecs
- [Options Trading Support] 942-960_DOCS-OPTIONS: #960 CODE-REVIEW (PASS, in-review remediation) + #973 UAT (Complete)
- [Portfolio Allocation] 576-778_FE-IMPL-PORTFOLIO: Dashboard adopts shared account switcher in the header bar — name-only pills, non-agentic chip, half-height toggles via --mat-button-toggle-height: 24px; agentic-preferred default selection in both stores
- [Portfolio Allocation] 576-778_FE-IMPL-PORTFOLIO: Allocation shell — account stat strip + New bucket button into the header bar (full column for tab panes); retired bucket list removed entirely
- [Portfolio Allocation] 576-778_DOCS-PORTFOLIO: #789 UAT (Complete — 9/9 scenarios, both refinement rounds recorded)
- [Portfolio Dashboard] 219-952_FE-IMPL-PORTFOLIO: Position card chart — cloned gallery-card-chart minus signal entity (symbol input, no occurrence dots); shared card-chart/indicator/mount-queue stores; per-card D/W + ±50; mount-once latch (scroll-out keeps chart mounted, releases on data loss)
- [Portfolio Dashboard] 219-952_FE-IMPL-PORTFOLIO: Position card mounts real chart via @defer viewport + prefetch idle
- [Portfolio Dashboard] 219-952_DOCS-PORTFOLIO: #952 IMPL/TEST corrections + CODE-REVIEW (PASS) + #976 UAT (Complete — last-card activation finding resolved mid-QA)
- [On-demand Screenshot Capture] 746-850_SHARED-IMPL-SCREENSHOT: per-artifact ScreenshotIndexEntry (interval + svgPath/pngPath), CaptureChartResult PT date/time stamp, symbol-prefixed artifact basenames, buildScreenshotIndexDocId ({SYMBOL}-{PTdate}-{PTtime}-{event}[-{refId6}]-{interval})
- [On-demand Screenshot Capture] 746-850_BE-IMPL-SCREENSHOT: capture timestamps are Pacific Time (DST-aware, h23) instead of UTC; filenames carry the symbol; captureChartSnapshot writes one swallowed index doc per stored artifact; lifecycle capture writes the same readable per-artifact ids inside the carrier transaction
- [On-demand Screenshot Capture] 746-850_FE-IMPL-SCREENSHOT: OrderExecutionService fires captureChartSnapshot on confirmed placement (order-placed) or synchronous fill (order-filled) — refId/groupId = ticket refId, fire-and-forget, failures can never affect the order result; live-verified with real resting orders post-deploy
- [On-demand Screenshot Capture] 746-850_DOCS-SCREENSHOT: #850 CODE-REVIEW (PASS, in-loop sync-throw fix) + #936 UAT (Complete)
- [Options Trading Support] 942-961_FE-IMPL-OPTIONS: Option contract + staging utils — parseOptionPaste/chainsToExpirations/selectsToInstrumentArgs/premiumNotional/fatfingerBlock (fail-closed on any non-finite input, default 25) + buildOptionSignalTicket; ticket id {SYMBOL}-OPT-{LONG|SHORT}-{occId}-{ts} prevents PT-minute .set() collisions
- [Options Trading Support] 942-961_DOCS-OPTIONS: #961 CODE-REVIEW (PASS, 3 rounds) + #977 UAT (Complete) + IMPL-948 caller-contract pins for #963/#964
- [Portfolio Dashboard] 219-887_SHARED-IMPL-PORTFOLIO: get_equity_orders single-order lookup (order_id arg — terminal orders ARE returned, live-verified) + partially_filled_rest_cancelled in OrderState/VALID_STATES
- [Portfolio Dashboard] 219-887_FE-IMPL-PORTFOLIO: updateEquityStopOrder primitive — cancel → order_id confirm-poll → bounded replacement retry on same refId; phase/unprotected reporting; three-channel tool-error extraction (a rejected cancel can no longer report success); fill-adjacent aborts (fills/executions/ambiguous-cum-quantity → refresh-first); live-denylist place responses (PLACEMENT_DEAD vs PLACEMENT_UNCONFIRMED)
- [Portfolio Dashboard] 219-887_FE-IMPL-PORTFOLIO: Store + dialog hardening for ambiguous placement — clean-dead mints+persists fresh refId, dead-with-fills keeps burned refId; dialogs disableClose through in-flight + close(true) on any submission attempt
- [Portfolio Dashboard] 219-887_FE-VERIFY-PORTFOLIO: portfolio-update-stop-887 live probe — exercised the real path on SCHB (27.38 → 27.28; old confirmed cancelled via order_id poll, replacement confirmed)
- [Portfolio Dashboard] 219-887_DOCS-PORTFOLIO: IMPL/TEST synced to as-built contract + #887 CODE-REVIEW (PASS, 7 rounds) + #925 UAT (Complete — live-verified)

## [2026-10-11]

### Fixed
- [Portfolio Dashboard] 219-951_FE-BUG-PORTFOLIO: Retry symbol-profile load after a failed fetch — getAllSymbols fails soft and left the session degraded (no tier chips, sector/industry, cap sort); facade effect + refresh() retry path, store self-guards

### Added
- [Portfolio Dashboard] 219-951_FE-IMPL-PORTFOLIO: PositionCard sort/group/order refinements — dimension-primary group order (alphabetical, tier rank for cap-tier) with sinks last, empty-string sinking, unhandled-dim throw, degenerate-quote day-change guards, isStopLossProtecting widened to Pick + quantity>0 long-only invariant
- [Portfolio Dashboard] 219-951_FE-IMPL-PORTFOLIO: Position card — cap-tier badge left of symbol + LONG/SHORT chip, econ/meta rows (qty@cost, mark, position-signed day change, P&L, value, days, bucket, sector·industry), PROTECTED @ price (pct) / UNPROTECTED badge, action row above chart cell (Close/Stop emit; Add/Detail/Orders stubs)
- [Portfolio Dashboard] 219-951_FE-IMPL-PORTFOLIO: Position gallery group expando — label, N positions, ↑/↓ side tallies; retained dormant behind useExpandos pending flat-vs-expando confirmation
- [Portfolio Dashboard] 219-951_FE-IMPL-PORTFOLIO: Group-sorted flat grid — facade.orderedCards (flat cap sort in NONE, contiguous dimension blocks otherwise), useExpandos flag, expand-all hidden while expandos dormant
- [Portfolio Dashboard] 219-951_DOCS-PORTFOLIO: #951 IMPL/TEST corrections + CODE-REVIEW (PASS, 2 rounds) + #969 UAT (Complete)
- [Portfolio Dashboard] 219-950_FE-REFACTOR-PORTFOLIO: Shared scheduleIdle/cancelIdle util + SYMBOL_LIST_SENTINEL_OPTIONS extracted; signal gallery view + header consume both
- [Portfolio Dashboard] 219-950_FE-IMPL-PORTFOLIO: PositionCard join model + PortfolioGalleryFacade + PortfolioGalleryUiStore — dashboard/quotes/profiles/attribution/buckets/orders compose into cards with independent degradation; signed short day-P&L, closed/zero-qty filter, long-only protection guard, per-slice partialErrors, watchers keyed on primitive accountNumber
- [Portfolio Dashboard] 219-950_FE-IMPL-PORTFOLIO: Portfolio-v2 page shell — 7-stat summary strip, All/Long/Short pills, Chart D/W, Group + List dropdowns, refresh, loading/error/no-agentic/empty/filtered-empty/warn states, stub flat grid
- [Portfolio Dashboard] 219-950_FE-IMPL-PORTFOLIO: portfolio-v2 lazy route behind authGuard + PAGE_INFO + route spec
- [Portfolio Dashboard] 219-950_DOCS-PORTFOLIO: Portfolio gallery thread docs — PRD + IMPL/TEST plans + #950 CODE-REVIEW (PASS, 1 round) + #966 UAT (Complete)


## [2026-10-08]

### Fixed
- [Trading Indicator Library] 261-872_FE-IMPL-INDICATOR-LIB: historyStart now compares the pivot's session date (ISO 'YYYY-MM-DD' string on bar.date), not the bar's x epoch — production x is a PT-midnight instant, so the boundary shifted for users west of PT; Candidate/pivotTime deleted; parseIsoDateLocal shared helper + regression test pushes every x to 2030

### Added
- [Paper Trading Infra] 553-916_SHARED-IMPL-PAPER-TRADING: Auto-paper signal stamps + stats scope ids — signalTradeDesc (EQV{n}{L|S}, fails loud off trend-rider daily), signalDedupeKey, six statsScope* builders, 10 optional PaperTrade stamp fields, AUTO_PAPER_USER_ID
- [Paper Trading Infra] 553-916_BE-IMPL-PAPER-TRADING: PaperTradeOverrides stamp whitelist + auto-paper verify scripts (no-cred contracts + ADC prod-inputs — caught the flattened signals.* run-ids shape)
- [Paper Trading Infra] 553-916_DOCS-PAPER-TRADING: Signals Auto Paper Trade PRD + IMPL/TEST plans (shared/BE/FE) + #916 CODE-REVIEW (PASS, 2 rounds) + #929 UAT (Complete)
- [Trading Indicator Library] 261-872_FE-IMPL-INDICATOR-LIB: Anchored VWAP sandbox params panel — 10-param override surface gated on enable (number min/max + color swatches), empty-control reverts to default, mat-datepicker + ISO text + clear for historyStart; IndicatorParamDef.input discriminator
- [Trading Indicator Library] 261-872_DOCS-INDICATOR-LIB: FE IMPL/TEST plan sync + #872 CODE-REVIEW (PASS — J1 major epoch-vs-session-date remediated in-loop) + #930 UAT (Complete — A1-A11 automated, M1-M10 user-verified)
- [Trading Indicator Library] 261-871_FE-IMPL-INDICATOR-LIB: ST Anchored VWAP in the flex-chart - indicator definition with 8 params, fixed 12-series builder (4 slots x active + 2 alternating history, null gap breaks), registry/menu opt-in, adapter computed with theme + log-scale mapping, dedicated template render loop; 42 new tests
- [Trading Indicator Library] 261-871_DOCS-INDICATOR-LIB: #871 CODE-REVIEW (PASS, 2 rounds - Syncfusion null-Gap verified from source) + #902 UAT (Complete - A1-A9 automated, M1-M6 user-verified) + FE IMPL/TEST plan sync
- [Portfolio Dashboard] 219-886_SHARED-IMPL-PORTFOLIO: StopLossFormComponent full param surface — timeInForce/marketHours model() inputs (gtc/regular_hours), StopLossSubmit payload, TIF + Hours pills (Extended/All Day disabled — RH rejects non-regular stops, live-verified), showOrderParams + initialStopPrice prefill inputs
- [Portfolio Dashboard] 219-886_FE-IMPL-PORTFOLIO: Stop param plumbing at both consumers — dialog threads StopLossSubmit; regular_hours pinned at both submission seams; order ticket binds neither pill (no silent Day stops); dead onPlaceStopLoss fallback + canPlaceStopLoss removed
- [Portfolio Dashboard] 219-886_DOCS-PORTFOLIO: #886 CODE-REVIEW (PASS) + #912 UAT (Complete — 5 live stops placed) + PRD US16/IMPL amendments for the confirmed regular-hours constraint
- [Portfolio Allocation] 576-778_FE-IMPL-PORTFOLIO: Shared AccountSwitcherComponent — single-select pill group (accountName per account, non-agentic flag chip with tooltip+ARIA, deselect guard) shared by dashboard header and allocation page
- [Portfolio Allocation] 576-779_FE-IMPL-PORTFOLIO: Visual-language mixins — page-host (calc(100vh − --header-height) fixes the one-header-height viewport clip), stat-strip, tab-scroll-pane; bounded-tab-group emits a live ::ng-deep .mat-mdc-tab-body-wrapper bound + 32px dense tab row
- [Portfolio Allocation] 576-693_FE-CHORE-PORTFOLIO: Bucket-row expansion — inline detail panel under each bucket/Unassigned row (stats + positions mini-table, multi-expand, retired-section support) replacing the detail dialog; shared isUnassignedRow/fmtQty/positionPnl helpers; carries #779's table-wrap row-scroll + sticky header + dense controls
- [Portfolio Allocation] 576-779_FE-IMPL-PORTFOLIO: Allocation page shell — header bar (switcher pills + Portfolio link + refresh), tokenized account strip (Value/Allocated/Cash/Unassigned + as-of), single Buckets|Positions tab row at 0ms animation, bounded scroll chain, shared loading/error/empty states incl. accountsLoaded-driven true empty state
- [Portfolio Allocation] 576-693_DOCS-PORTFOLIO: #693 IMPL + code review + #839 UAT record
- [Portfolio Allocation] 576-778_DOCS-PORTFOLIO: #778 code review (PASS) + #789 UAT record
- [Portfolio Allocation] 576-779_DOCS-PORTFOLIO: #779 code review (PASS) + #897 UAT (Complete — 12 scenarios PASS incl. two in-loop fixes)
- [Portfolio Allocation] 576-693_DOCS-PORTFOLIO: #839 UAT Complete — all 14 scenarios PASS; the scroll-clip + nested-wrapper findings resolved by #779's shell work
- [Navigation and Workflows] 625-854_FE-IMPL-WORKFLOWS: PageIdentityService — route-driven title+icon shared by rs-header and the shell; fullscreen reveal becomes an identity chip (icon + title + exit); .page-title promoted to h1
- [Navigation and Workflows] 625-854_FE-IMPL-WORKFLOWS: Sidenav Dev submenu — NavItem.children + mat-menu popup; Tools ▸ Dev lists dev/flex-chart, dev/gallery, dev/screenshot without polluting the workflow nav
- [Navigation and Workflows] 625-854_FE-IMPL-WORKFLOWS: Page title sweep (21 surfaces) + default-header fullscreen flip (auto setFullscreen(true) removed from 13 pages + signal-review facade; ngOnDestroy cleanup kept) + right-anchored action bars
- [Navigation and Workflows] 625-854_DOCS-WORKFLOWS: #854 CODE-REVIEW (PASS, 2 rounds) + page inventory (38/38) + #898 UAT (Complete — nav-surface-scoped)
- [Trading Indicator Library] 261-880_SHARED-IMPL-INDICATOR-LIB: Trigger Bands Pine palette — ST_TRIGGER_BANDS_COLORS (white neutral, cross-side yellow/blue state colors), dot colors keyed by backend signalType, uniform line width
- [Trading Indicator Library] 261-880_BE-IMPL-INDICATOR-LIB: Pullback dots on every armed-state bar — dot emission keyed on longPullbackState/shortPullbackState (Pine plot semantics; dots stop when breakout clears the state), verify script + golden fixture updated
- [Trading Indicator Library] 261-880_FE-IMPL-INDICATOR-LIB: Trigger Bands dev gate + sandbox wiring — FlexChartConfig.dev strips dev-typed configs in effectiveConfig, ST_DEV_INDICATOR_OPTIONS, dev/flex-chart picker + lean opt-in request (D+W, own cache key) + "TB dots" sub-toggle, two MultiColoredLine series with step-expanded hinge+level data reproducing TV's right-endpoint coloring, dot scatter overlay; carries #879's renderer lineage
- [Trading Indicator Library] 261-880_DOCS-INDICATOR-LIB: #879 + #880 CODE-REVIEWs (both PASS) + #910 UAT (Complete) + IMPL/TEST plans synced to as-built armed-state dots and two-series renderer
- [Trading Indicator Library] 261-273_SHARED-IMPL-INDICATOR-LIB: Land rb-st-std-dev-lines.pine Pine export — referenced by Topic #261, copied from sibling rb-ps project (checkpoint)
- [Trading Indicator Library] 261-311_SHARED-IMPL-INDICATOR-LIB: Land rb-st-zones.pine Pine export — referenced by Topic #261, copied from sibling rb-ps project (checkpoint)


## [2026-10-07]

### Added
- [Robinhood MCP] 657-813_FE-IMPL-RH-MCP: executeTools batch client + portfolio fan-out — one /batch request per phase per account, ordered per-item results, toolError gates, flat 90s timeout
- [Robinhood MCP] 657-813_DOCS-RH-MCP: #813 code review (PASS, 2 rounds) + #900 UAT (Complete)
- [Robinhood MCP] 657-809_BE-IMPL-RH-MCP: POST /batch — shared-session sequential tool execution with ordered per-item results, 20-call cap, 75s budget, session-failure envelope
- [Robinhood MCP] 657-809_DOCS-RH-MCP: #809 code review (PASS) + #893 UAT (Complete)
- [Navigation and Workflows] 625-853_FE-IMPL-WORKFLOWS: rs-header page-identity zone — icon+title after brand via NavigationEnd + pathFromRoot + resolvePageInfo; wordmark collapses <720px
- [Navigation and Workflows] 625-853_DOCS-WORKFLOWS: #853 review (PASS, 2 rounds) + #868 UAT (Complete — 8/8 incl. signed-out/narrow-viewport/icon-glyph checks)
- [Navigation and Workflows] 625-852_FE-IMPL-WORKFLOWS: PAGE_INFO page-identity registry (title + icon, Record<AppRoutes> exhaustive) + resolvePageInfo longest-prefix/normalized lookup + Route.title wired on all 38 leaf routes — tab titles flow from the registry via TitleStrategy
- [Navigation and Workflows] 625-852_DOCS-WORKFLOWS: #824 PRD + #837 IMPL/TEST + #852 review (PASS, 2 rounds) + #859 UAT (Complete — tab titles user-verified on dev server)
- [Robinhood MCP] 657-810_BE-IMPL-RH-MCP: rhApi CORS layer — shared ST_ALLOWED_ORIGINS allowlist + cors middleware w/ maxAge 86400, preflights answer before the auth/KMS handler build
- [Robinhood MCP] 657-810_FE-IMPL-RH-MCP: env-driven rhApiBaseUrl (prod calls the cloudfunctions.net URL — App Hosting has no rewrite support) + Firebase ID-token attach on listTools/executeTool/reauthenticate
- [Robinhood MCP] 657-810_DOCS-RH-MCP: #810 review (PASS, 3 rounds) + #857 UAT (live CORS matrix verified; prod-portfolio scenario pending post-push smoke)
- [On-demand Screenshot Capture] 746-844_SH-IMPL-SCREENSHOT: CaptureChartSpec.groupId (campaign root → {symbol}/{groupId}/ path level) + PositionType strategy tags (vertical-debit-spread/calendar/option-single) + group-segment sanitizer
- [On-demand Screenshot Capture] 746-844_BE-IMPL-SCREENSHOT: captureChartSnapshot parses groupId + enum-membership positionType + grouped-path verify script (12/12 vs real bucket)
- [On-demand Screenshot Capture] 746-844_DOCS-SCREENSHOT: #826 PRD (approved) + IMPL/TEST plans + #844 CODE-REVIEW (PASS) + #858 UAT (Complete)
- [Trading Indicator Library] 261-869_FE-IMPL-INDICATOR-LIB: computeZigZagAnchorEvents — every ZigZag anchor incl. later-replaced ones with its confirmation bar (pivot bar + rightDepth), via one pivot walk shared with computeZigZagPivots (output unchanged; 10,240-combination equivalence check vs previous implementation)
- [Trading Indicator Library] 261-869_DOCS-INDICATOR-LIB: ST Anchored VWAP PRD (approved) + FE/SHARED IMPL/TEST plans + #869 CODE-REVIEW (PASS) + #882 UAT (Complete) + Anchored VWAP / Anchor Pivot / Confirmation Bar / History Window glossary terms
- [Trading Indicator Library] 261-870_FE-IMPL-INDICATOR-LIB: computeAnchoredVwap — Anchored VWAP segments for two retracement scales: lines drawn from each anchor's confirmation bar (VWAP accumulating from the pivot bar), handed off on the next same-side anchor's confirmation bar, replaced anchors drawn, hlc3 x volume with flat-carry and a pivot-bar seed, History Window in both modes (per scale, both sides combined); 42 tests incl. an independent direct-summation reference, the T1 anchor events as oracle and a no-lookahead property
- [Trading Indicator Library] 261-870_DOCS-INDICATOR-LIB: #870 CODE-REVIEW (PASS) + #891 UAT (Complete) + PRD story 6 clarification (line content vs History Window)
- [Trading Indicator Library] 261-876_BE-IMPL-INDICATOR-LIB: computeStTriggerBands engine (body-based length-3 Donchian bands + long/short pullback, pullback-state and breakout flags) with 21 unit tests, SPY/AAPL real-data verify script (18/18) and TradingView export parity script (490 AAPL daily bars, bands + 4 flags identical)
- [Trading Indicator Library] 261-876_DOCS-INDICATOR-LIB: ST Trigger Bands PRD (approved, indicator-only) + BE/FE IMPL/TEST plans + #876 CODE-REVIEW (PASS) + #881 UAT (Complete)
- [Trading Indicator Library] 261-877_BE-IMPL-INDICATOR-LIB: Trigger Bands in the indicator-series callable - TriggerBandsPoint (bands + six pullback/breakout flags), pullback and breakout dot markers (version TB), D/W/M series independent of the 30-bar gate, opt-in via IndicatorFamily.TRIGGER_BANDS (default response unchanged), filterResponse extracted to a pure module; 14 integration tests + real-data verify script (21/21)
- [Trading Indicator Library] 261-877_DOCS-INDICATOR-LIB: #877 CODE-REVIEW (PASS) + #894 UAT (Complete) + BE plan updates
- [On-demand Screenshot Capture] 746-845_BE-IMPL-SCREENSHOT: captureLifecycleEvent intake — transactional pending→captured ledger on the carrier doc's capturedEvents map, await-capped (10s) executeCaptureChart, st-screenshots index at {groupId}-{refId}-{event}; failed markers retryable, nothing propagates to the order path
- [On-demand Screenshot Capture] 746-845_DOCS-SCREENSHOT: #845 CODE-REVIEW (PASS — undefined-groupId index write fixed in-loop) + #883 UAT (Complete)
- [On-demand Screenshot Capture] 746-846_BE-FE-IMPL-SCREENSHOT: shared lifecycle-tracking contracts (CapturedEventEntry, LifecycleCarrier, ScreenshotIndexEntry, OrderIntentTrackingFields) as the single FE+BE source; tracking.ts carriers + anchored doc paths + intent tracking I/O behind a narrow TrackingDb seam (undefined-key strip before merge-set); BaseOrderTicket extends OrderIntentTrackingFields; Collection.ST_SCREENSHOTS (restored — dropped by af900f68)
- [On-demand Screenshot Capture] 746-846_DOCS-SCREENSHOT: #846 CODE-REVIEW (PASS — explicit-undefined tracking write fixed in-loop) + #896 UAT (Complete) (restored — dropped by af900f68)
- [On-demand Screenshot Capture] 746-847_BE-IMPL-SCREENSHOT: lifecycle hooks at the ledger seams — onTradeLifecycle dep on LedgerDeps fired post-commit (applyEntryFill/applyPendingFill → order-filled; applyExitFill → position-closed), markPositionSettled position-closed on terminal statuses; screenshot-lifecycle.ts (positionTypeForLegs, cohort/position group roots, lazy-loaded swallow-and-log hook, ledgerDepsWithCapture wiring); 14 tsx tests
- [On-demand Screenshot Capture] 746-847_DOCS-SCREENSHOT: #847 CODE-REVIEW (PASS) + #899 UAT (Complete)
- [On-demand Screenshot Capture] 746-848_BE-IMPL-SCREENSHOT: lifecycle-capture verify script — seeds a scratch carrier and drives captureLifecycleEvent through real prod seams (Firestore txns + bucket writes); 24-check ledger contract incl. dedup rerun no-op; FIREBASE_CONFIG seeded for local default-bucket access; run-all + README + guide registered
- [On-demand Screenshot Capture] 746-848_DOCS-SCREENSHOT: #848 CODE-REVIEW (PASS) + #903 UAT (Complete)
- [Portfolio Dashboard] 219-885_SHARED-IMPL-PORTFOLIO: BrokerOrder gains verbatim timeInForce/marketHours — normalizeOrder parses time_in_force/market_hours (absent → undefined) + specs
- [Portfolio Dashboard] 219-885_FE-IMPL-PORTFOLIO: EquityTimeInForce/EquityMarketHours unions on BaseOrderTicket + StopOrderParams threaded through stop builders (gtc/regular_hours defaults) + buildStopLossUpdateTicket (stop_loss_update sourceRef) + toEquityTimeInForce/toEquityMarketHours narrowing helpers
- [Portfolio Dashboard] 219-885_DOCS-PORTFOLIO: Update Stop Loss PRD (#832) + IMPL/TEST plans (#861) + #885 CODE-REVIEW (PASS) + #895 UAT (Complete) + Update Stop / Trailing Stop / Water Mark / Trail Distance glossary terms
- [Gallery Order Ticket View] 743-820_FE-IMPL-GALLERY-VIEW: flat 'None' grouping — GroupDimension sentinel (getGroupKey throws on it), facade flatCards sorted market-cap desc, Sunk cards still pinned in the Sunk expando below the flat grid
- [Gallery Order Ticket View] 743-838_FE-IMPL-GALLERY-VIEW: store seams — stale-response guard on loadSymbolsWithSignals (run-switch mid-fetch can't clobber the new run), failed symbol-history loads no longer cache [] (refresh retries), ui-store chartTimeframe + resync tick, card-chart cacheEpoch dropping stale writes
- [Gallery Order Ticket View] 743-860_FE-IMPL-GALLERY-VIEW: GalleryChartMountQueueService — one chart mount per requestAnimationFrame, FIFO, dead grants skipped free, re-entrant/throwing grants can't strand the queue; card-chart mounts grant-gated on inWindow+bars+no-error (fixes the 16-card flat-page hang)
- [Gallery Order Ticket View] 743-819_FE-IMPL-GALLERY-VIEW: card chart D/W toggle + per-card override + header resync, labeled Trade/Reject/Paper/Chart toolbar, meta rows incl. price+day-change before exchange, leaf computeds killing the cross-symbol re-render storm, flat-grid render, symbol overlay in the chart cell
- [Gallery Order Ticket View] 743-819_DOCS-GALLERY-VIEW: CODE-REVIEW docs for #819/#820/#838/#860 (all PASS) + UAT sections F/H/M in the accumulating doc + #819 task UAT (QA #840/#841/#856/#865 all PASS)

## [2026-10-06]

### Added
- [Gallery Order Ticket View] 743-756_FE-IMPL-GALLERY-VIEW: Per-symbol GalleryCardChartStore (daily bars + symbol-data version cache, IndicatorSeriesStore warm with quick-charts filter keys) + LocalBarReadService.getSymbolDataVersion$
- [Gallery Order Ticket View] 743-756_FE-IMPL-GALLERY-VIEW: GalleryCardChartComponent — full quick-charts daily stack (trend bands/strength, zone V1/V2, weekly HTF window, strategy dots) + card-occurrence price-pane dots; 40-bar log-scale cell, no chrome
- [Gallery Order Ticket View] 743-756_FE-IMPL-GALLERY-VIEW: Card chart cell @defer (on viewport; prefetch on idle) + page idle prefetch of visible card symbols; flex-chart --fc-min-height override; jsdom IntersectionObserver stub
- [Gallery Order Ticket View] 743-756_DOCS-GALLERY-VIEW: #756 code review (PASS, remediation round) + #817 UAT (Complete — C1-C4, C6 user-verified; C5 removed as impossible) + IMPL doc updated to shipped design + newest-first UAT section convention
- [On-demand Screenshot Capture] 746-771_BE-IMPL-SCREENSHOT: MIN_CAPTURE_WIDTH/HEIGHT spec floor + clip-id regression test
- [On-demand Screenshot Capture] 746-771_FE-IMPL-SCREENSHOT: Per-interval variant re-renders (fixes failed-precondition on unequal bar counts), placeholder-not-banner on thin data, takeUntilDestroyed + defer() hardening
- [On-demand Screenshot Capture] 746-771_DOCS-SCREENSHOT: #771 code review (PASS, remediation round) + #822 UAT (Complete — 9/9 user-verified) + IMPL/TEST doc drift fixes
- [On-demand Screenshot Capture] 746-770_BE-IMPL-SCREENSHOT: renderOnly contract flag (default true, skips rasterize + GCS writes), geometry-scoped SVG clip ids fixing cross-SVG pane bleed, shared capture geometry constants
- [On-demand Screenshot Capture] 746-770_FE-IMPL-SCREENSHOT: /dev/screenshot playground — authGuarded lazy route, spec form → captureChartSnapshot → inline SVG artifacts + paths, Store-to-GCS gate, width variants + last-15 zoom via re-render, stale-response guard (incl. #771 in-place work)
- [On-demand Screenshot Capture] 746-770_DOCS-SCREENSHOT: #770 code review (PASS, remediation round) + #818 UAT (Complete — 7/7 user-verified)
- [Robinhood MCP] 657-805_CONFIG-IMPL-RH-MCP: rh-agent-credentials explicit deny in firestore.rules (read/write: if false under root default-deny; deployed); KMS key + IAM + RH_CREDENTIAL_KEY_NAME/RH_OWNER_UID provisioning verified live (13/13)
- [Robinhood MCP] 657-805_DOCS-RH-MCP: #805 code review (PASS) + #816 UAT (Complete, 6/6) + KMS rotation-vs-destroy semantics fix in the credentials primer
- [Robinhood MCP] 657-806_BE-IMPL-RH-MCP: upload-rh-credential CLI + upload-credential-bundle core (seed/--replace CAS, full-field round-trip check, structural-only evidence) + live verify script + describeBundle shared redaction; production rh-agent-credentials/bundle seeded at revision 1
- [Robinhood MCP] 657-806_DOCS-RH-MCP: #806 code review (PASS, remediation round) + #825 UAT (Complete — 8/8 incl. live-doc seed guard + token hygiene) + verify guide
- [Robinhood MCP] 657-807_BE-IMPL-RH-MCP: Shared /api/rh dispatch — route table extracted to api-shared/ (tools list, tool POST, reauth; pre-parsed req.body for onRequest, 413 without socket destroy, null-body 400); local observation API delegates with loopback guard + 90s timeout
- [Robinhood MCP] 657-807_BE-IMPL-RH-MCP: rhApi onRequest (us-central1, 120s, 512MiB, concurrency 8) — Firebase verifyIdToken + RH_OWNER_UID gate (401/403 before dispatch), KMS/Firestore credential repository, structural rh_api_call/rh_api_auth_reject audit, REAUTHORIZATION_REQUIRED reauth route
- [Robinhood MCP] 657-807_BE-IMPL-RH-MCP: Connect-path hardening — refresh CAS conflict adopts the concurrent winner's bundle (no stranded rotation), reloadBundle cache invariant, wrapped reload errors; 30s connect timeout closes late sessions; fetchFn test seam
- [Robinhood MCP] 657-807_DOCS-RH-MCP: #807 code review (PASS, 2 rounds — CAS race + orphan-close remediated) + #833 UAT (Complete — 6/6 live scenarios incl. non-owner 403 + log hygiene) + verify guide; 13-test cloud suite + 48/48 surface green

### Changed
- [Gallery Order Ticket View] 743-756_FE-REFACTOR-GALLERY-VIEW: ohlcToPriceBar hoisted to shared savant-trader utils; chart.service maps via it (dedupe for card-chart store)


## [2026-10-05]

### Added
- [On-demand Screenshot Capture] 746-769_BE-IMPL-SCREENSHOT: PNG rasterization in captureChartSnapshot — @resvg/resvg-js@2.6.2 via font.fontFiles + loadSystemFonts:false over bundled Roboto 400/500/700 (Apache-2.0, LICENSE vendored); .png sibling per .svg at the same path stem, image/png contentType, artifacts[].pngPath + interleaved paths; --external:@resvg/resvg-js build flag; 6 rasterizer + 48 callable specs; live verify 17/17
- [On-demand Screenshot Capture] 746-769_DOCS-SCREENSHOT: #769 code review (PASS, 1 remediation round) + UAT (Complete — incl. manual PNG visual check)
- [Gallery Order Ticket View] 743-755_FE-IMPL-GALLERY-VIEW: Card + sink model — GalleryCard status/allRejected/actionedAt/ticket; deriveCardStatus precedence (watched > rejected > ticket lifecycle); findCardTickets canonical decision-id matching (run/side/occurrence-scoped, legacy ids, decisionIds:[] fallback); allRejected verdict over the full occurrence set pre-timeframe-trim; isSunkCard + pinned Sunk group ordered by actionedAt desc
- [Gallery Order Ticket View] 743-755_FE-IMPL-GALLERY-VIEW: GalleryCardActionsService — tradeCard/paperCard/rejectCard/openTicketDialog with busyCardKeys in-flight guards; stale-state recheck inside busy window (STAGED reopens, non-staged bails); rejected occurrences excluded from staged decisionIds; friendly snackbars
- [Gallery Order Ticket View] 743-755_FE-IMPL-GALLERY-VIEW: Facade pared to view-model seam (actionContext computed); page wires actions service + actionBusy; GalleryTicketDialogComponent MatDialog host (tradingConfig via MAT_DIALOG_DATA, closes on broker/paper-accepted only); .gallery-page height via --header-height var
- [Gallery Order Ticket View] 743-755_FE-IMPL-GALLERY-VIEW: Card toolbar — labeled ghost chips (Trade primary / Reject·Restore / Paper / disabled Chart stub); status chip title-cased; ticketLine formatter ($-notional vs qty×limit); per-button disabled + actionBusy through gallery-group; sunk dimming; 1px-border chart placeholder
- [Gallery Order Ticket View] 743-755_FE-IMPL-GALLERY-VIEW: Order-ticket store — stageTicketAndWait pessimistic persist; sendTicketToPaper shared transaction (source-state re-read + eligibility guard, transient SUBMITTING, revert-before-persist); loadTickets preserves local SUBMITTING/PAPER over stale STAGED
- [Gallery Order Ticket View] 743-755_FE-IMPL-GALLERY-VIEW: Ticket paths — editedPartial shared helper; onAcceptAsPaper persists edits before confirm dialog + send (acceptingPaper spans the save window); order.component bulk paper delegates to store path; dead acceptAsPaper + dead injections removed
- [Gallery Order Ticket View] 743-755_FE-IMPL-GALLERY-VIEW: signal-order-staging.util — DEFAULT_DOLLAR_AMOUNT const (replaces ?? 100s) + quantity-based whole-share ticket shape; signal-review facade consumes it
- [Gallery Order Ticket View] 743-755_DOCS-GALLERY-VIEW: #755 code review (PASS, 4 rounds) + UAT A1–A11 + refinement (Complete) + IMPL/TEST/CONTEXT updates
- [Robinhood MCP] 657-684_BE-IMPL-RH-MCP: Read-only sweep captures — 235 redacted response files under docs/topics/657-rh-mcp/captures/ (204 ok / 28 err / 1 declined mutation + drift + tools/list meta)
- [Robinhood MCP] 657-684_BE-IMPL-RH-MCP: Sweep manifest grown to 233 gated probes across 54 tools + rh-mcp-runner-683.ts verify-script latent-bug fix (prompt-by-type, missing env vars) + rh-mcp-runner-683.md dead-link fix
- [Robinhood MCP] 657-684_BE-DOCS-RH-MCP: TEST-doc sweep results, #684 code review (PASS, 1 remediation round), #797 UAT (QA PASS)
- [Robinhood MCP] 657-804_BE-REFACTOR-RH-MCP: Canonical credential contract surface — CredentialCipher + typed error classes (conflict/busy/invalid-bundle/malformed-doc) in credential-repository.ts, shared parseBundle codec (ISO-8601 timestamp shape), env + portable repos migrated to canonical taxonomy/validation
- [Robinhood MCP] 657-804_BE-IMPL-RH-MCP: KmsCipher (CredentialCipher over Cloud KMS, fail-closed on unset RH_CREDENTIAL_KEY_NAME) + KmsFirestoreCredentialRepository — ciphertext-only doc at rh-agent-credentials/bundle, transactional revision CAS via CredentialDocStore port (real txn body unit-tested offline), @google-cloud/kms@6.2.0, 13 unit tests
- [Robinhood MCP] 657-804_BE-IMPL-RH-MCP: Live verify script rh-mcp-kms-repository-804.ts (scratch doc, refuses live path, exit 0/1/2) + run-all needsEnv gate + guide
- [Robinhood MCP] 657-804_DOCS-RH-MCP: Thread #795 PRD + BE/FE IMPL/TEST docs, KMS primer DESIGN doc, #804 code review (PASS, 2 rounds) + UAT (Complete — live round-trip deferred to #805)


- [Robinhood MCP] 657-688_BE-IMPL-RH-MCP: Discovery doc assembler — manifest × captures × live tools/list → canonical draft (lib + CLI, 12 unit tests wired into test:rh-agent-mcp-discovery; review remediations: ToolCatalogDrift import, full descriptions, unprobed-vs-missing messaging)
- [Robinhood MCP] 657-688_BE-DOCS-RH-MCP: Canonical discovery draft rh-mcp-tool-discovery-canonical-657-658-689.md (76 tools / 9 domains / 233 capture links / drift) + #688 code review PASS + #815 UAT QA PASS

## [2026-10-04]

### Added
- [Portfolio Allocation] 576-776_FE-IMPL-PORTFOLIO: Shared visual-language SCSS partial — feature-internal _pd-visual-language.scss with page-shell/content-column/header-bar/dense-table/state-block/error-banner mixins + $up/$down accents, all mat-sys tokens (dark-theme safe)
- [Portfolio Allocation] 576-776_DOCS-PORTFOLIO: Visual-consistency Thread docs — PRD (Approved), IMPL:FE, TEST:FE, code review (PASS), UAT (Complete)
- [Portfolio Allocation] 576-777_FE-IMPL-PORTFOLIO: Dashboard shell — header bar (icon + title + scoreboard + actions) and 1100px centered content column on _pd-visual-language mixins; account tabs → mat-button-toggle pill row; single section tab row (Equities/Options/Orders/History/Account) with per-pane scrolling
- [Portfolio Allocation] 576-777_FE-IMPL-PORTFOLIO: Header scoreboard with signal-order font treatment; dollar totals masked by default until opt-in eye toggle (localStorage-persisted); Allocations link in header + ← Portfolio back link on allocation page
- [Portfolio Allocation] 576-777_DOCS-PORTFOLIO: #777 code review (PASS) + UAT (Complete, round-2 redesign approved)
- [Signal Pipeline Maintenance] 433-433_FE-IMPL-SIGNAL-REVIEW: Signal-review UAT fix batch — pageInitializing loading gate (no empty-state flash), DAILY/LONG entry filter defaults, Signals {n} pill, expand-before-scroll prev/next into collapsed groups, scroll-to-top rows, ChartStore in-flight cancellation + 250ms load debounce (rapid-nav OOM); #755 staging-util extraction rides along (checkpoint)
- [Signal Pipeline Maintenance] 433-433_DOCS-SIGNAL-REVIEW: As-built signal-review page UAT — ~60 scenarios covering the current implementation incl. all fix-batch expectations (checkpoint)

- [On-demand Screenshot Capture] 746-765_SHARED-IMPL-SCREENSHOT: Screenshot capture contract types — canonical ChartInterval, CaptureInterval D/W subset, CaptureEvent, PositionType (stock), CaptureChartSpec/Artifact/Result, capture defaults (D+W, 30 bars, 'all' sentinel)
- [On-demand Screenshot Capture] 746-765_SHARED-IMPL-SCREENSHOT: Screenshot capture path + result builders — buildScreenshotStoragePath (st-trade-screenshots/, HHmmss never-overwrite, 6-char refId, empty-symbol throw) + buildCaptureChartResult (svg/paths derived from artifacts)
- [On-demand Screenshot Capture] 746-765_CONFIG-IMPL-SCREENSHOT: @screenshot-capture/{contracts,utils} aliases in root + functions tsconfigs and jest moduleNameMapper

### Changed
- [On-demand Screenshot Capture] 746-765_BE-REFACTOR-SCREENSHOT: indicator-computation.ts re-exports canonical ChartInterval (enum unified in shared/, identical wire values)
- [On-demand Screenshot Capture] 746-765_FE-REFACTOR-SCREENSHOT: indicator.types.ts re-exports canonical ChartInterval (fixes FE/BE enum duplication)
- [On-demand Screenshot Capture] 746-765_DOCS-SCREENSHOT: Topic docs — PRD, BE-SH + FE IMPL/TEST, code review (PASS, 2 rounds), UAT (Complete)

### Added
- [Gallery Order Ticket View] 743-754_FE-IMPL-GALLERY-VIEW: Shared helpers — signalsBySymbolForRun/hasPendingRunHistory run-history accessors, marketCapTierRank export (Object.hasOwn), fillSignalClosePrices
- [Gallery Order Ticket View] 743-754_FE-IMPL-GALLERY-VIEW: SymbolHistoryStore — fills missing signal closePrice from the firing bar's close (backend never wrote `close`; fixes signal-review's signalPrice anchor too)
- [Gallery Order Ticket View] 743-754_FE-IMPL-GALLERY-VIEW: GalleryUiStore — page-local timeframe/direction/list/sort state
- [Gallery Order Ticket View] 743-754_FE-IMPL-GALLERY-VIEW: Card aggregation utils — one card per symbol+side, D/W merge, opposite directions two cards; canonical list filter; sector/market-cap/list sorts
- [Gallery Order Ticket View] 743-754_FE-IMPL-GALLERY-VIEW: GalleryFacade — latest-completed-run resolution + eager loads; init gating covers history fan-out (no empty flash)
- [Gallery Order Ticket View] 743-754_FE-IMPL-GALLERY-VIEW: Gallery page — header filters/sort, responsive card grid, loading/error/empty/filtered-empty states
- [Gallery Order Ticket View] 743-754_FE-IMPL-GALLERY-VIEW: Lazy dev/gallery route under authGuard (promotion to trading/gallery is #762)
- [Gallery Order Ticket View] 743-754_DOCS-GALLERY-VIEW: Topic docs — PRD, IMPL, TEST, ADR-009, code review (PASS, 2 rounds), UAT (Complete); AGENTS.md hierarchy-display convention
- [Gallery Order Ticket View] 743-783_FE-IMPL-GALLERY-VIEW: Grouping model — GalleryUiStore groupDimension + expandedGroups (collapsed default) replace sort/groupBy, entry defaults Daily+Long+PRIMARY+Sector; groupGalleryCards util (sector/industry/market-cap, (Unknown) last, within-group marketCap desc); sort API removed
- [Gallery Order Ticket View] 743-783_FE-IMPL-GALLERY-VIEW: GalleryGroup component — expando panel with "N signals" + D/W + long/short count chips (signal-review conventions)
- [Gallery Order Ticket View] 743-783_FE-IMPL-GALLERY-VIEW: Page wiring — "Group" select replaces Sort, expand/collapse-all icon button, flat grid → grouped panel stack
- [Gallery Order Ticket View] 743-783_DOCS-GALLERY-VIEW: #783 code review (PASS, 1 round + post-review tweaks) + UAT scenarios G1–G8 (Complete) + IMPL Phase 1b updated to shipped design
- [Flex Chart Visual Polish] 213-731_FE-IMPL-SAVANT-TRADER: Add ±50 visible-bar controls to the quick-charts daily chart — −50/+50 buttons in the Daily label row, floor 30 / ceiling = loaded bars; includes 250ms symbol-change load debounce (checkpoint)
- [Flex Chart Visual Polish] 213-731_SHARED-REFACTOR-FLEX-CHART: Remove theme/scale-math re-export shims — deleted flex-chart/chart-theme.ts, strategies/log-transform.ts, strategies/price-format.ts; all consumers import @flex-chart/theme and @flex-chart/scale-math directly; specs moved to shared/ beside their modules (checkpoint)

### Added
- [On-demand Screenshot Capture] 746-766_SHARED-IMPL-SCREENSHOT: Canonical shared/ chart theme + scale math (CHART_PALETTES, log/linear ticks) + @flex-chart/* aliases in both tsconfigs and jest
- [On-demand Screenshot Capture] 746-766_BE-IMPL-SCREENSHOT: Server-side SVG renderer — ChartRenderModel → deterministic SVG (panes, per-kind series, windows layers, header metadata, data-* crop attributes); 39 specs + verify script (9 checks)
- [On-demand Screenshot Capture] 746-766_DOCS-SCREENSHOT: #766 code review (PASS, 2 rounds) + UAT (Complete)
- [On-demand Screenshot Capture] 746-767_SHARED-IMPL-SCREENSHOT: shared/flex-chart-indicator-visuals.ts — canonical ST indicator visual vocabulary (zone/uptick/signal-dot/TS/std-dev/band/HTF-window constants); capture default dimensions moved to contracts
- [On-demand Screenshot Capture] 746-767_BE-IMPL-SCREENSHOT: Chart data assembler — getCachedBars → computeSymbolIndicatorSeries → render model with FE parity (z-order, pane gating, std-dev lines/fills via real computation, HTF window shading); 24 specs incl. positional FE std-dev parity + real-data verify (20 checks)
- [On-demand Screenshot Capture] 746-767_DOCS-SCREENSHOT: #767 code review (PASS, 2 rounds) + UAT (Complete)

### Changed
- [On-demand Screenshot Capture] 746-766_FE-IMPL-SCREENSHOT: flex-chart chart-theme/log-transform/price-format converted to shared/ re-export shims (drift impossible by construction)
- [On-demand Screenshot Capture] 746-767_FE-IMPL-SCREENSHOT: 10 FE indicator/converter files migrated to the shared visual vocabulary — FE changes propagate to server captures by construction

### Added
- [On-demand Screenshot Capture] 746-768_SHARED-IMPL-SCREENSHOT: symbolPathSegment + MAX_CAPTURE_DIMENSION (4096) shared contract additions
- [On-demand Screenshot Capture] 746-768_BE-IMPL-SCREENSHOT: captureChartSnapshot onCall — auth-gated spec validation → assemble → render → SVG writes to st-trade-screenshots/ in the default bucket; InsufficientBarsError → failed-precondition; 47 specs + real-GCS verify (14 checks)
- [On-demand Screenshot Capture] 746-768_DOCS-SCREENSHOT: #768 code review (PASS, 2 rounds) + UAT (Complete)

## [2026-10-01]

### Added
- [Paper Trading Infra] 553-724_BE-IMPL-PAPER-TRADING: Engine settlement parity — expired legs now settle on `expiration <= runDate` (missed nights retry instead of zombifying); shared `getUnderlyingCloseOnOrBefore` walks back to the last trading-day close (weekend/holiday expirations), floored at the position open date; ITM legs refuse worthless settlement when no brokerage checker is wired; `markPositionSettled` tightened to OPEN-only; orphaned `settlement-pass.test.ts` registered
- [Paper Trading Infra] 553-724_DOCS-PAPER-TRADING: Code review (PASS, 2 rounds) + UAT (Complete — automated evidence; manual pass deferred to the strategy-builder UI) for #724
- [Robinhood MCP] 657-683_SHARED-IMPL-RH-MCP: toolError on ToolExecutionSuccess — envelope-level isError surfaced separately (parsed can't see it when error text is JSON); executor + adapter propagate; listOrders options declare `since`
- [Robinhood MCP] 657-683_BE-IMPL-RH-MCP: Manifest-driven probe runner — sequential execution, read pacing/backoff/retry-prompts, per-call mutation gate (no bypass, re-gate on retry), post-mutation settle poll, redacted+env-scrubbed atomic captures, `--only/--group/--from/--dry-run` CLI; loader gains settle-args schema validation, orders-tool settle convention, pending-state vocabulary; 118-spec suite + 6-check offline verify
- [Robinhood MCP] 657-683_DOCS-RH-MCP: Probe-runner code review (PASS, 21 rounds) + UAT (Complete — live read probe, gate decline, flag matrix) + manifest settle args + captures + verify wiring
- [Signal Pipeline Maintenance] 433-438_FE-IMPL-SIGNAL-REVIEW: Batch A — #717 requeue/modify regenerates burned refId (no more RH 409) + terminal rows get Requeue/dismiss; #719 removing a ticket clears all its occurrence decisions (signalContext.decisionIds; canonicalizes legacy ids) so the Accept toggle un-checks; #723 shared ticketCostBasisPrice — limit price vs live quote, live recalc, sell rows labelled Proceeds; #707 header cash nets resting limit-buy notional; #709 staged-only checkboxes + Select all/Clear + sequential Send-N-to-paper with in-flight SUBMITTING guard, per-ticket errors, summary counts
- [Signal Pipeline Maintenance] 433-438_DOCS-SIGNAL-REVIEW: Batch A code review (PASS, converged) + UAT (Complete — scenario 1 FAIL→fixed for multi-decision bug, 2–22 user-approved) + inventory promotions
- [Navigation and Workflows] 625-700_FE-IMPL-WORKFLOWS: NavSection + NAV_SECTIONS in PRD group order — NAV_MENU_ITEMS now derived flat; NavItem slimmed to name/text/href; dead AppRoutes members, topnav mixins, and .global-topnav-menu-css removed; nav-sections spec
- [Navigation and Workflows] 625-700_FE-DOCS-WORKFLOWS: Code review (PASS) + UAT (Complete, 10 scenarios) for #700
- [Navigation and Workflows] 625-625_DOCS-WORKFLOWS: Topic rename sweep — "Trading Workflows"→"Navigation and Workflows" across doc headers + PRD titles; commits previously-untracked #648/#655 docs
- [Navigation and Workflows] 625-701_FE-IMPL-WORKFLOWS: Sidenav grouped rendering + auth gating — NAV_SECTIONS render as labeled groups gated on AuthStore.isAuthenticated; signed-out menu shows Log in/Sign up only; nav items now real buttons; SIGNED_OUT_SECTIONS + unguarded-href invariant + CoreComponent navigate-wiring specs (#740 rides along)
- [Navigation and Workflows] 625-701_FE-DOCS-WORKFLOWS: Code review (PASS, 2 rounds converged) + UAT (Complete, 10 scenarios user-executed) for #701
- [Flex Chart Visual Polish] 213-731_DOCS-FLEX-CHART: Add PRD for flex-chart visual polish (checkpoint)
- [Flex Chart Visual Polish] 213-731_DOCS-FLEX-CHART: Add implementation and test plans (checkpoint)
- [Flex Chart Visual Polish] 213-731_SHARED-IMPL-FLEX-CHART: Add chart theme palette and appearance support (checkpoint)
- [Flex Chart Visual Polish] 213-731_SHARED-IMPL-FLEX-CHART: Extend FlexChartConfig for appearance, visibleBars, mainPanePercent (checkpoint)
- [Flex Chart Visual Polish] 213-731_SHARED-IMPL-FLEX-CHART: Wire theme palette into flex-chart component (checkpoint)
- [Flex Chart Visual Polish] 213-731_SHARED-IMPL-FLEX-CHART: Implement configurable main/lower pane split (checkpoint)
- [Flex Chart Visual Polish] 213-731_SHARED-BUG-FLEX-CHART: Anchor Category axis and prevent phantom bars (checkpoint)
- [Flex Chart Visual Polish] 213-731_SHARED-IMPL-FLEX-CHART: Add right margin and visibleBars handling (checkpoint)
- [Flex Chart Visual Polish] 213-731_SHARED-IMPL-FLEX-CHART: Apply palette slots to indicator defaults (checkpoint)
- [Flex Chart Visual Polish] 213-731_FE-IMPL-SAVANT-TRADER: Adopt flex-chart config changes across consumers (checkpoint)
- [Flex Chart Visual Polish] 213-731_FE-IMPL-SAVANT-TRADER: Enable signal dots and trend riders by default in sandbox (checkpoint)
- [Flex Chart Visual Polish] 213-731_FE-IMPL-SAVANT-TRADER: Add indicator-converter unit tests (checkpoint)
- [Flex Chart Visual Polish] 213-731_SHARED-BUG-FLEX-CHART: Keep price as the Category-axis anchor when Trend Bands is off (checkpoint)
- [Flex Chart Visual Polish] 213-731_FE-IMPL-SAVANT-TRADER: Wire backend signal dots and Trend Rider dots into the flex-chart sandbox (checkpoint)
- [Flex Chart Visual Polish] 213-731_FE-IMPL-SAVANT-TRADER: Log swallowed bar-load errors in ChartService (checkpoint)

### Changed
- [Navigation and Workflows] Topic #625 renamed from "Trading Workflows" (2026-10-01) — issue title, all `**Topic:**` doc headers, PRD title subtitles, and CONTEXT.md reference updated; `WORKFLOWS` domain label, `625-workflows/` dir, and `trading-workflows` slugs unchanged. Prior changelog entries retain the `[Trading Workflows]` tag as shipped

## [2026-09-30]

### Added
- [Paper Trading Infra] 553-668_BE-IMPL-PAPER-TRADING: Terminal-guard seeding + instance governingVariant resolution — seedVariantRuns rejects non-terminal/'none'/unparseable governing keys; strategy launches honor the stored trailing-{pct} (warn + trailing-8 fallback); no shadow runs
- [Paper Trading Infra] 553-668_FE-IMPL-PAPER-TRADING: Builder governing select — trailing-stop only per US4 ('none' removed, default 8%, range validation, ineligible stored keys coerce to default on edit)
- [Paper Trading Infra] 553-668_SHARED-IMPL-PAPER-TRADING: Governing-eligibility contracts — NONE_VARIANT_KEY + shared isGoverningEligiblePct bound + governingVariant field on StrategyInstanceConfig
- [Paper Trading Infra] 553-668_DOCS-PAPER-TRADING: Trade-exits execution-fidelity amendments + code review (PASS, 4 rounds) + UAT (Complete) for #668
- [Paper Trading Infra] 553-669_BE-VERIFY-PAPER-TRADING: Trade-exits prod verify — 26-check composed script (prod seeding audit, instance-resolution round trips, seed guards, cancel/close guards) + guide + registered in both run-all runners; full paper-trading verify chain (561–669) registered
- [Robinhood MCP] 657-682_BE-IMPL-RH-MCP: Catalog drift check — live tools/list vs bundled catalog (structural schema diff, rename hints, name-collision detection) + refresh-tool-catalog writer; captures 00-drift.json + 01-live-tools-list.json; 25-case spec + 6-check offline verify
- [Robinhood MCP] 657-682_BE-CHORE-RH-MCP: Regenerate tool catalog from live — 49→76 tools (+27 new: crypto, alerts, SEC filings, politician trades, historicals, scanners)
- [Robinhood MCP] 657-682_DOCS-RH-MCP: Drift/live-list captures + 76-tool amendments to discovery PRD/IMPL/TEST + code review (PASS, 4 rounds) + UAT (Complete) for #682
- [Signal Pipeline Maintenance] 433-706_FE-IMPL-SIGNAL-REVIEW: Queue rows show anchor → live price → %Δ — signalPrice at generation ("At signal") → avg cost (FILLED only) → stop/limit; direction-colored %, line-2 badges, <1200px date hide, ≥$1000 whole-dollar
- [Signal Pipeline Maintenance] 433-706_DOCS-SIGNAL-REVIEW: Code review (PASS, 3 rounds) + UAT (PASS) for #706; inventory items 11–12 promoted (#717 ref_id requeue 409, #719 accept-toggle desync) + doc-header convention
- [Portfolio] 576-592_SHARED-IMPL-PORTFOLIO: bucketId attribution contract comment — ticket stores the bucket doc id directly; name-slug resolution dropped
- [Portfolio] 576-592_FE-IMPL-PORTFOLIO: bucketTargetWarnings — bucket over-target warn-not-block naming bucket/exposure/order cost/projected/target; buy-side only
- [Portfolio] 576-592_FE-IMPL-PORTFOLIO: AllocationStore.ensureAccount — load a non-selected account's buckets/stats for the order-ticket picker without stealing page selection
- [Portfolio] 576-592_FE-IMPL-PORTFOLIO: seedFromTicket$ — fill-time attribution by bucketId; txn verifies bucket exists/ACTIVE/same-account; linkKey = orderId; buy-only, no overwrite
- [Portfolio] 576-592_FE-IMPL-PORTFOLIO: reconcileTerminalStatuses seeds attribution on FILLED tickets carrying bucketId; sells/cancels never seed
- [Portfolio] 576-592_FE-IMPL-PORTFOLIO: Order-ticket bucket picker + read-only Signal row — optional, never gates submit; per-option [selected] binding; confirm-dialog warning-item styling hardened
- [Portfolio] 576-592_FE-CHORE-PORTFOLIO: drop unused DecimalPipe on allocation page
- [Portfolio] 576-592_DOCS-PORTFOLIO: PRD/IMPL amended to direct bucketId (no auto-stamp, no name resolution); attribution-lifecycle diagram; code review (PASS) + UAT (Complete, 8 scenarios) for #592
- [Trading Workflows] 625-702_FE-DOCS-WORKFLOWS: Code review (PASS, 1 round) + UAT (Complete, 11 scenarios) for #702

### Changed
- [Trading Workflows] 625-699_FE-IMPL-WORKFLOWS: Canonical route tree — AppRoutes renamed to domain-prefixed paths (portfolio, signals/runs|review|charts, trading/live|paper, options/*, analysis/swings, tools/account, dev/flex-chart); '/'→/portfolio landing + /signals & /options parent redirects; post-login lands on /portfolio; literal nav sweep + route-table spec (66 assertions)
- [Trading Workflows] 625-699_DOCS-WORKFLOWS: Journey navigation PRD + impl/test plans + code review (PASS) + UAT (Complete) for #699
- [Trading Workflows] 625-702_FE-IMPL-WORKFLOWS: Savant Trader header — slim 48px dark bar (brand renamed, refresh-time component + store deleted, dead select-stock-dialog service removed); global fullscreen toggle + floating reveal chevron in core shell; 16 hardcoded calc(100vh - 64px|4rem) sites swept to var(--header-height, 48px)

### Removed
- [Signal Pipeline Maintenance] 433-705_FE-IMPL-SIGNAL-REVIEW: Order queue cleanup — Paper status group + PAPER badge and SIG/POS/MAN source chips removed; selection clamps to next row after accept-as-paper
- [Signal Pipeline Maintenance] 433-705_DOCS-SIGNAL-REVIEW: Inventory promotion + code review (PASS) + UAT (Complete) for #705

### Fixed
- [Trading Workflows] 625-702_FE-BUG-WORKFLOWS: Signal Order + signal-action-report left UiStateService.fullscreen stuck true after navigation, hiding the shell header globally — both pages now reset on OnDestroy


## [2026-09-28]

### Added
- [Robinhood MCP] 657-681_BE-IMPL-RH-MCP: Probe manifest loader/validator — fail-closed mutation gate (definition flag OR static set), strict arg checks, $ENV placeholders, dry-run plan printer
- [Robinhood MCP] 657-681_DOCS-RH-MCP: Discovery PRD/IMPL/TEST + seed manifest + code review (PASS, 4 rounds) + UAT (Complete) + verify script (9/9) for #681
- [Paper Trading Infra] 553-667_BE-IMPL-PAPER-TRADING: Live-quote close — closePaperTrade callable (per-leg live marks → net order price, unavailable on miss, governing run finalized)
- [Paper Trading Infra] 553-667_DOCS-PAPER-TRADING: Prod verify (7/7 real quote round-trip) + code review (PASS, 2 rounds) + UAT (Complete) for #667
- [GitHub read-only issue UI] 619-697-715_SHARED-IMPL-DEV-TOOLS: stageOrdinal helper — single source for stage-ordinal derivation (tree chips + left-pane dots)
- [GitHub read-only issue UI] 619-697-715_FE-IMPL-DEV-TOOLS: Topic Viewer visual polish — 430px left pane, chip-free rows w/ stage dot, Topic: prefix strip, title ellipsis, stage-colored chips, depth guides, centered caret (touch-target bleed fix), context header, styled banners/empty states
- [GitHub read-only issue UI] 619-697-715_DOCS-DEV-TOOLS: Misc-fixes inventory (#713) + code review (PASS, 2 rounds) + UAT (Complete) for #715
- [GitHub read-only issue UI] 619-621-641_BE-IMPL-DEV-TOOLS: Deploy getLifecycleTree + GITHUB_READ_TOKEN secret + av-proxy-api whitelist (BE + FE mirror)
- [GitHub read-only issue UI] 619-621-641_DOCS-DEV-TOOLS: Code review (PASS) + UAT (Complete) for #641
- [GitHub read-only issue UI] 619-621-644_FE-IMPL-DEV-TOOLS: Topic Viewer route + nav — /tools/topic-viewer lazy route (auth-gated), nav entry, dev-lifecycle→topic-viewer rename
- [GitHub read-only issue UI] 619-621-644_DOCS-DEV-TOOLS: Code review (PASS, 2 iterations) + UAT (Complete) for #644
- [GitHub read-only issue UI] 619-621-643_FE-IMPL-DEV-TOOLS: Lifecycle viewer page + tree — repo picker, grouped topic list, expand/collapse tree, banners, empty states
- [GitHub read-only issue UI] 619-621-643_DOCS-DEV-TOOLS: Code review (PASS, 2 iterations) + UAT (Complete) for #643
- [Paper Trading Infra] 553-665_SHARED-IMPL-PAPER-TRADING: Trade-exits contracts — CANCELLED status, trailing-8 seeding defaults (no shadows), TERMINAL_VARIANT_FAMILIES, close/cancel callable shapes
- [Paper Trading Infra] 553-665_BE-IMPL-PAPER-TRADING: Cancelled stats exclusion + doc-userId owner resolution (governing closes now reach signal trades) + consumer re-baselines
- [Paper Trading Infra] 553-665_DOCS-PAPER-TRADING: Trade Exits PRD/IMPL/TEST docs, code review (PASS, 3 rounds) + UAT (Complete) for #665, contract verify script
- [GitHub read-only issue UI] 619-621-642_FE-IMPL-DEV-TOOLS: DevLifecycleService + LifecycleStore — callable wrapper, grouped topic sections, expansion-gated tree, stale-response guard
- [GitHub read-only issue UI] 619-621-642_DOCS-DEV-TOOLS: Code review (PASS, 2 iterations) + UAT (Complete) for #642
- [GitHub read-only issue UI] 619-621-640_BE-IMPL-DEV-TOOLS: getLifecycleTree callable — auth gate, repo validation, truncation-guard, grouping degrade, error mapping
- [GitHub read-only issue UI] 619-621-640_DOCS-DEV-TOOLS: Code review (PASS, 2 iterations) + UAT (Complete) for #640
- [Trading Workflows] 625-647_DOCS-WORKFLOWS: Workflow template + conventions — PRD/IMPL/TEST, conventions doc, code review (PASS, 2 rounds), UAT (Complete) for #647
- [Trading Workflows] 625-647_DOCS-WORKFLOWS: Workflow template conformance verify script (workflows-template-647.ts) + run-all/README registrations
- [GitHub read-only issue UI] 619-621-639_BE-IMPL-DEV-TOOLS: Lifecycle GraphQL fetch shell — paginated topic search, batched BFS, subIssues pagination, truncation counting, Status decode
- [GitHub read-only issue UI] 619-621-639_DOCS-DEV-TOOLS: Code review (PASS, 3 iterations) + UAT (Complete) for #639
- [Portfolio] 576-582-589_CONFIG-PORTFOLIO: Firestore rules get-vs-list split — txn id-probes (create/rename/attribution) no longer denied
- [Portfolio] 576-582-589_FE-IMPL-PORTFOLIO: Buckets tab — unified config+analytics table, create/edit/retire/delete dialogs (writes stay open until success), retired section, >100% warn
- [Portfolio] 576-582-589_DOCS-PORTFOLIO: Buckets-tab code review (PASS, 2 rounds) + UAT (Complete)
- [Portfolio] 576-582-590_FE-IMPL-PORTFOLIO: Positions tab — assign/move/unassign dialog, bulk select + Actions menu, single-txn batched writes, resting-order stub filter
- [Portfolio] 576-582-590_DOCS-PORTFOLIO: Positions-tab code review (PASS, 2 rounds) + UAT (Complete)

- [GitHub read-only issue UI] 619-621-637_SHARED-IMPL-DEV-TOOLS: Lifecycle tree contract + transforms — closed-label decode, node typing, tree assembly with subtree-max updatedAt, inventory-doc grouping
- [GitHub read-only issue UI] 619-621-637_DOCS-DEV-TOOLS: PRD + IMPL/TEST plans + code review (PASS, 4 iterations) + UAT (Complete) for #637
- [Swing Analysis Page] 594-509_FE-IMPL-SWING-ANALYSIS: Company info strip in page header — all profile fields inline, em-dash fallbacks, never blocks chart (tasks #507–509)
- [Swing Analysis Page] 594-509_FE-IMPL-SWING-ANALYSIS: Nav autocomplete picker — tracked-only, ticker + company-name match, commit/revert guards; settings-dialog free-text symbol input removed
- [Watchlist Management] 465-523-528_CONFIG-IMPL-WATCHLIST: Legacy bare-id symbol-list docs readable/deletable by authed users — lazy rekey support
- [Swing Analysis Page] 594-509_DOCS-SWING-ANALYSIS: QA PASS (#529) + UAT Complete for #507–509
- [Watchlist Management] 465-528_DOCS-WATCHLIST: Code review (PASS) + QA PASS (#532) + UAT Complete for #528

### Changed
- [Watchlist Management] 465-523-528_FE-IMPL-WATCHLIST: All list surfaces rewired to catalog computeds — SymbolListName/enum-era plumbing retired, role-aware untriaged, deleted-list filter fallback

### Fixed
- [Watchlist Management] 465-523-528_FE-IMPL-WATCHLIST: Triage chips render icons again (fiber_new/star/visibility/remove_circle_outline/trending_down/block/history) with per-list active colors — text-pill regression reverted

## [2026-09-27]

### Added
- [Swing Analysis Page] 594-609_FE-IMPL-SWING-ANALYSIS: Config sets + stricter save paths (set_ doc keys, paramsId rename passthrough, empty-input error)
- [Swing Analysis Page] 594-609_FE-IMPL-SWING-ANALYSIS: Store — SWING_PRESETS, runtime configEnabled flag, set ops (save/apply/clone-all/clear), batch removal
- [Swing Analysis Page] 594-609_FE-IMPL-SWING-ANALYSIS: Dialog two-list config manager — narrow active rows + per-row on/off, chart enable-filter
- [Swing Analysis Page] 594-609_DOCS-SWING-ANALYSIS: PRD/IMPL amendments + code review (PASS) + UAT (Complete)
- [Portfolio] 576-582-588_FE-IMPL-PORTFOLIO: Allocation page shell — /portfolio-allocation route + nav, account tabs (non-agentic flagged), header/subtabs, refresh; store selection-preservation
- [Portfolio] 576-582-588_DOCS-PORTFOLIO: Page-shell code review (PASS, 3 rounds) + UAT (Complete)
- [Swing Analysis Page] 594-608_FE-IMPL-SWING-ANALYSIS: Dialog compact control styling — inline label+input rows, compact inputs/buttons
- [Swing Analysis Page] 594-608_DOCS-SWING-ANALYSIS: Code review (PASS) + UAT (Complete)
- [Swing Analysis Page] 594-607_FE-IMPL-SWING-ANALYSIS: Dialog — two-list config manager (presets + saved library, active-row clone/remove/save-to-library); legacy snapshot store APIs removed
- [Swing Analysis Page] 594-607_DOCS-SWING-ANALYSIS: Code review (PASS, 5 rounds) + UAT (Complete)

## [2026-09-26]

### Added
- [Paper Trading Infra] 553-559-568_FE-IMPL-PAPER-TRADING: Strategy-builder governing-variant selector — family + param → BE-parseable keys, registry-driven options
- [Paper Trading Infra] 553-559-568_DOCS-PAPER-TRADING: Code review (PASS, 4 rounds — param validation, silent-error surface)
- [Paper Trading Infra] 553-559-569_FE-IMPL-PAPER-TRADING: Paper trading dashboard — account header, 5-dim group-by, cohort drill-down, per-scope equity curve
- [Paper Trading Infra] 553-559-569_DOCS-PAPER-TRADING: Code review (PASS, 2 rounds — caught Map/Object.entries production bug)
- [Paper Trading Infra] 553-559-567_FE-IMPL-PAPER-TRADING: Accept-as-paper on signal-order — PAPER status, confirm dialog paper mode, staged-signal gating
- [Paper Trading Infra] 553-559-567_FE-IMPL-PAPER-TRADING: Queue Paper group + teal PAPER badge; PAPER visible pre-RH-load; remove-skip guards cohort provenance
- [Paper Trading Infra] 553-559-567_DOCS-PAPER-TRADING: Code review (PASS, 4 rounds)
- [Paper Trading Infra] 553-559-566_FE-IMPL-PAPER-TRADING: PaperTradingService — five-callable wrapper + CallableName entries + service spec
- [Paper Trading Infra] 553-559-566_FE-IMPL-PAPER-TRADING: PaperTradingStore — account/trades/stats/variants state, groupTradesBy selectors, merge-vs-replace stats, 18 specs
- [Paper Trading Infra] 553-559-566_DOCS-PAPER-TRADING: Code review (PASS, 3 rounds)
- [Swing Analysis Page] 594-606_FE-IMPL-SWING-ANALYSIS: Store config library + always-N configs
- [Swing Analysis Page] 594-606_FE-IMPL-SWING-ANALYSIS: Retire saved-sets panel + dual-mode toggle
- [Portfolio] 576-582-586_SHARED-IMPL-PORTFOLIO: Owner-scoped allocation contracts — required userId on buckets + attributions
- [Portfolio] 576-582-586_SHARED-IMPL-PORTFOLIO: Anchored collection paths — portfolio/{buckets,attributions}/items
- [Portfolio] 576-582-586_CONFIG-IMPL-PORTFOLIO: @portfolio-allocation tsconfig/jest aliases
- [Portfolio] 576-585-586_CONFIG-IMPL-PORTFOLIO: Owner-scoped Firestore rules for allocation collections
- [Portfolio] 576-585-586_CONFIG-IMPL-PORTFOLIO: Composite indexes — items userId+accountNumber(+status)
- [Portfolio] 576-582-586_FE-IMPL-PORTFOLIO: Broker order legs + executions on the MCP client
- [Portfolio] 576-582-586_FE-IMPL-PORTFOLIO: MCP→domain allocation mappers (positions/fills, leg expansion, sell→close inference)
- [Portfolio] 576-582-586_FE-IMPL-PORTFOLIO: AllocationBucketService — txn-guarded CRUD, frozen slug ids
- [Portfolio] 576-582-586_FE-IMPL-PORTFOLIO: PositionAttributionService — atomic linkKey groups, ticket seeding, unassign
- [Portfolio] 576-582-586_FE-IMPL-PORTFOLIO: AllocationDataService — all-accounts list, snapshot/positions/fills seam
- [Portfolio] 576-582-586_DOCS-PORTFOLIO: Prod verify round-trip + code review (PASS) + UAT + anchored-collection doc sync
- [Portfolio] 576-582-587_SHARED-IMPL-PORTFOLIO: Shared buildEquityCurve + exported well-formed position guard
- [Portfolio] 576-582-587_FE-IMPL-PORTFOLIO: AllocationStore — account-scoped selectors, Unassigned/Cash pseudo-rows, write delegation
- [Portfolio] 576-582-587_DOCS-PORTFOLIO: Store code review (PASS) + UAT (Complete)
- [Swing Analysis Page] 594-605_FE-IMPL-SWING-ANALYSIS: st-swing-configs config library - slim docs, paramsId-keyed CRUD, showTriggerDots hashing
- [Swing Analysis Page] 594-605_CONFIG-IMPL-SWING-ANALYSIS: st-swing-configs security rules
- [Swing Analysis Page] 594-605_FE-IMPL-SWING-ANALYSIS: Prod verify script - st-swing-configs round-trip
- [Portfolio] 576-577-584_SHARED-IMPL-PORTFOLIO: Allocation rollup utils?" target/drift/warn predicates, position attribution join, FIFO realized P&L, computeBucketStats seam, cash residual + cashCheck; contracts gain netValue + linkKey
- [Portfolio] 576-577-584_DOCS-PORTFOLIO: Rollup-utils code review (PASS) + process diagrams + PRD/IMPL sync (cash-as-basis, atomic multi-leg)
- [Paper Trading Infra] 553-554-563_SHARED-IMPL-PAPER-TRADING: Exit-variant contract doc corrections (exit-event price bases, working-state conventions)
- [Paper Trading Infra] 553-554-563_BE-IMPL-PAPER-TRADING: Exit-variant registry — pure rules + typed params (initial/trailing/time-stop, limit-stddev stub)
- [Paper Trading Infra] 553-554-563_BE-IMPL-PAPER-TRADING: Ledger + repo seams — dedup + governing invariant, EXITED-terminal runs, adapter realized-P&L stats bridge
- [Paper Trading Infra] 553-554-563_BE-IMPL-PAPER-TRADING: Nightly exit-eval pass — governing close, shadow counterfactuals, backfill, mark-gap tolerance, orchestrator wiring
- [Paper Trading Infra] 553-554-563_BE-IMPL-PAPER-TRADING: Settlement run-finalization (intrinsic-value exit events) + PT market-date mark keys
- [Paper Trading Infra] 553-554-563_BE-IMPL-PAPER-TRADING: Exit-eval verification script (15 prod checks), guide, run-all wiring, settle-finalization checks in 562 verify
- [Paper Trading Infra] 553-554-563_DOCS-PAPER-TRADING: Exit-engine code review (PASS, 5 passes)
- [Paper Trading Infra] 553-554-564_SHARED-IMPL-PAPER-TRADING: Signal expression templates (LONG→csp/lc, SHORT→sc/lp), shadow-variant defaults, PaperTrade.expressionTemplate + userId, signal-order contract
- [Paper Trading Infra] 553-554-564_BE-IMPL-PAPER-TRADING: Pending-trade ledger seams — createPendingTrade (PENDING, no cash) + applyPendingFill (PENDING→OPEN atomic) + PaperTradeOverrides whitelist
- [Paper Trading Infra] 553-554-564_BE-REFACTOR-PAPER-TRADING: Canonical RH MCP response shapes (rh-mcp-shapes.ts); resolver + quote provider migrated — fixes nested instrument_id extraction
- [Paper Trading Infra] 553-554-564_BE-IMPL-PAPER-TRADING: paperSignalOrder callable (ticket provenance, acceptance-quote equity fill, cohort + PENDING fan-out, idempotent retry) + noon-PT expression-fill pass (chains→instruments→quotes→delta/DTE selection→OPEN)
- [Paper Trading Infra] 553-554-564_CHORE-PAPER-TRADING: Signal→paper prod verification script (16 checks), guide, run-all registration
- [Paper Trading Infra] 553-554-564_DOCS-PAPER-TRADING: Signal→paper code review (PASS, 4 rounds)
- [Paper Trading Infra] 553-554-565_SHARED-IMPL-PAPER-TRADING: Canonical EquityCurvePoint in shared/common.ts + getPaperStats scope semantics
- [Paper Trading Infra] 553-554-565_BE-IMPL-PAPER-TRADING: Generalized stats pass — all/inst/var/cohort/sig/sym rollups nightly post-settlement; tradeToPosition qty-aware premium fix
- [Paper Trading Infra] 553-554-565_BE-IMPL-PAPER-TRADING: listExitVariantConfigs registry defaults + key↔params cross-check
- [Paper Trading Infra] 553-554-565_BE-IMPL-PAPER-TRADING: Read callables — listPaperTrades, getPaperStats, getPaperAccount, listExitVariants
- [Paper Trading Infra] 553-554-565_CHORE-PAPER-TRADING: Read-APIs prod verification (20 checks, self-healing cleanup) + guide + run-all
- [Paper Trading Infra] 553-554-565_DOCS-PAPER-TRADING: Code review (PASS)
- [Swing Analysis Page] 594-595-594_DOCS-SWING-ANALYSIS: Re-parented swing-analysis docs from #261 to #594 — 34 docs moved to docs/topics/594-swing-analysis-page/ with renumbered prefixes, headers, and domain; TOPICS-INVENTORY.md grouped reference added (checkpoint)
- [Portfolio Allocation] 576-577-583_SHARED-IMPL-PORTFOLIO: Allocation bucket + attribution contracts and id builders — freeze-at-creation ids, slug-equality uniqueness, as-of rollups, 19 specs
- [Portfolio Allocation] 576-577-583_DOCS-PORTFOLIO: Allocation Manager PRD/IMPL/TEST docs + #583 code review (PASS, 4 rounds); AGENTS.md portfolio- prefix; CONTEXT.md Allocation Bucket term

## [2026-09-25]

### Added
- [Paper Trading Infra] 553-554-562_SHARED-REFACTOR-PAPER-TRADING: PaperTrade.legacyStatus for engine status round-trips
- [Paper Trading Infra] 553-554-562_BE-REFACTOR-PAPER-TRADING: Engine migration onto paper-trading collections — passes + repositories under engine/, trade+account atomic open/settle, idempotent migration script, 24-check prod verify
- [Paper Trading Infra] 553-554-562_CONFIG-REFACTOR-PAPER-TRADING: Firestore rules + composite index for paper-trading anchors
- [Paper Trading Infra] 553-554-562_FE-IMPL-PAPER-TRADING: Strategy builder persists instances to paper-trading/instances/items
- [Paper Trading Infra] 553-554-562_DOCS-PAPER-TRADING: Engine-migration code review (PASS, 5 passes) + verify guide
- [Paper Trading Infra] 553-554-561_SHARED-IMPL-PAPER-TRADING: PaperTrade.variantKeys denormalized for array-contains variantKey filtering
- [Paper Trading Infra] 553-554-561_BE-IMPL-PAPER-TRADING: Ledger core — 6-kind repository, transactional applyEntryFill/applyExitFill, real-prod verification script
- [Paper Trading Infra] 553-554-561_DOCS-PAPER-TRADING: Ledger-core code review doc (PASS, 2nd pass) + verify guide
- [Paper Trading Infra] 553-554-560_SHARED-REFACTOR-PAPER-TRADING: Shared ID segment formatters (YYMMDD/delta/DTE) extracted to shared/id-format.ts; strategy-instance-id consumes them
- [Paper Trading Infra] 553-554-560_SHARED-IMPL-PAPER-TRADING: Paper-trading record contracts (lifecycle-aggregate PaperTrade, discriminated PaperTradeLeg, variant runs), collection-path helpers, human-readable ID builders
- [Paper Trading Infra] 553-554-560_CONFIG-IMPL-PAPER-TRADING: @paper-trading/contracts + @paper-trading/ids path aliases for app, functions, and jest
- [Paper Trading Infra] 553-554-560_SHARED-IMPL-PAPER-TRADING: Permanent verification script + credential-free run-all skipping
- [Paper Trading Infra] 553-554-560_DOCS-PAPER-TRADING: PRD, SHARED/BE/FE impl + test plans, second-pass code review (PASS), AGENTS.md collection-layout exception

## [2026-09-24]

### Added
- [Flex Chart Maintenance] 468_FE-REFACTOR-FLEX-CHART: Shared LogScalePillComponent (power icons, aria-pressed, focus-visible) replaces 3 inline copies; flex-chart ResizeObserver dedupes on measured size
- [Flex Chart Maintenance] 468-538-547_FE-IMPL-FLEX-CHART: Signal-detail defaults to log scale + dot-indicator extras upsert by id (NG0955 fix)
- [Flex Chart Maintenance] 468-538-547_DOCS-FLEX-CHART: Code review doc for signal-detail rollout (PASS, 2nd pass)
- [Options Current Pricing] 486-502_FE-IMPL-OPTIONS: Contract hover popup + shared DelegatedCellHover controller (also ships in-session filters/picker/shading work nominally scoped to #503)
- [Options Current Pricing] 486-502_DOCS-OPTIONS: Code review doc (PASS, 2nd pass) + IMPL/TEST icon-hover updates
- [Options Current Pricing] 486-503_FE-IMPL-OPTIONS: Filter/header/date-controls + DTE-band column picker + absolute-from-baseline scroll sync (self-healing at boundaries, centered output re-anchors panes)
- [Options Current Pricing] 486-503_DOCS-OPTIONS: Code review doc (PASS, 2nd pass) + AS-BUILT for Topic #486
- [Flex Chart Maintenance] 468-538-546_FE-IMPL-FLEX-CHART: Swing-analysis header Log Y-axis pill wired to the chart config
- [Flex Chart Maintenance] 468-538-546_DOCS-FLEX-CHART: Code review doc for swing-analysis rollout
- [Flex Chart Maintenance] 468-538-545_FE-IMPL-FLEX-CHART: Quick-charts panel Log Y-axis pill wired to all three charts
- [Flex Chart Maintenance] 468-538-545_DOCS-FLEX-CHART: Code review doc for quick-charts rollout
- [Watchlist management] 465-523-527_FE-IMPL-WATCHLIST: Generic RhSelectMenu option values and grouped option rendering
- [Watchlist management] 465-523-527_FE-IMPL-WATCHLIST: Catalog-derived Triage/My lists filter options and shared filter sentinel
- [Watchlist management] 465-523-527_FE-IMPL-WATCHLIST: Grouped catalog list filters in chart review with deleted-list fallback
- [Watchlist management] 465-523-527_FE-IMPL-WATCHLIST: Typed grouped list filters in signal review
- [Watchlist management] 465-523-527_DOCS-WATCHLIST: Code review doc for grouped list filters (PASS, 2nd pass)

## [2026-09-23]

### Added
- [Flex Chart Maintenance] 468-538-544_FE-IMPL-FLEX-CHART: FlexChartComponent default logScale and ChartToolbarComponent log toggle
- [Flex Chart Maintenance] 468-538-544_DOCS-FLEX-CHART: Rollout PRD, impl/test plans, code review doc, and changelog entry

## [2026-09-22]

### Added
- [Option Chain Pct Change Grid] 326-473_FE-IMPL-OPTIONS: Shared delta-default filter, config merge, and capped snapshot fetches
- [Option Chain Pct Change Grid] 326-472_FE-IMPL-OPTIONS: Swing-compare entry at sidebar top; manual controls collapsed; shared Filters panel
- [Option Chain Pct Change Grid] 326-483_FE-IMPL-OPTIONS: Delineate run containers; suppress cell tooltips during chart popup; penny-cell exclusion
- [Option Chain Pct Change Grid] 326-357_DOCS-DOCS-OPTIONS: Code review docs for misc-fixes batch (472/473/483)
- [Watchlist management] 465-466_FE-IMPL-SAVANT-TRADER: Rename PAST_SIGNALS to MONITOR and add canonical list-filter constants (checkpoint)
- [Watchlist management] 465-525_FE-IMPL-WATCHLIST: Store catalog computeds over watchLists$ — snapshot-truth mutations, role-routed toggles, role-aware untriaged
- [Watchlist management] 465-525_DOCS-WATCHLIST: Code review doc for store catalog computeds ship
- [Watchlist management] 465-492-465_BE-IMPL-WATCHLIST: New-symbols inbox — backend writer targets NEW (checkpoint)
- [Watchlist management] 465-492-465_FE-IMPL-WATCHLIST: NEW exclusive system list — seed, probe, exclusive-key sets (checkpoint)
- [Watchlist management] 465-492-465_DOCS-WATCHLIST: CONTEXT glossary — registry defs, Monitor, New symbols inbox (checkpoint)
- [Watchlist management] 465-492-526_FE-IMPL-WATCHLIST: User-list CRUD API — create/rename/delete/reorder with system-key guards and ghost-resurrection-safe writes
- [Watchlist management] 465-492-526_DOCS-WATCHLIST: Code review doc for user-list CRUD (PASS, 2nd pass)
- [Option Chain Pct Change Grid] 326-518_DOCS-OPTIONS: SA corpus handoff spec — swing platform, enabled-options corpus, endpoint contract (no fetch-on-miss)
- [Option Chain Pct Change Grid] 326-519_BE-IMPL-OPTIONS: OPTIONS_NOT_ENABLED maps to callable failed-precondition; partner code embedded in error message
- [Option Chain Pct Change Grid] 326-516_FE-IMPL-OPTIONS: Corpus-chain error handling (unsupported-symbol message), per-date resilience with retry rows, live-fetch source badge (tasks 516/517/520)
- [Watchlist management] 465-466_FE-IMPL-SAVANT-TRADER: Wire canonical list filters and membership-driven Monitor across review surfaces (checkpoint)
- [Watchlist management] 465-466_DOCS-SAVANT-TRADER: Add watchlist misc-issues PRD and code review doc (checkpoint)
- [Current option pricing] 486-497_FE-IMPL-OPTIONS: Option chain page skeleton, route, and nav entry
- [Current option pricing] 486-497_DOCS-OPTIONS: PRD, FE impl/test plans, code review doc, and glossary terms
- [Current option pricing] 486-498_FE-IMPL-OPTIONS: Session-resolution utils (1PM PT boundary, weekend/holiday walk-back, 7-day cap)
- [Current option pricing] 486-498_DOCS-OPTIONS: Code review doc for session-resolution utils
- [Current option pricing] 486-499_FE-IMPL-OPTIONS: Option-chain store data pipeline (session+prior snapshots, underlying closes, priorError isolation)
- [Current option pricing] 486-499_DOCS-OPTIONS: Code review doc for chain store
- [Current option pricing] 486-501_SHARED-REFACTOR-OPTIONS: Shared option-grid helpers — normalizeOptionType, daysBetween, chainContracts, formatAtmDiff
- [Current option pricing] 486-501_FE-IMPL-OPTIONS: Calls/puts/both layout toggle, compact pct-change-parity cells, per-side strike orientation, gated ATM scroll
- [Current option pricing] 486-501_DOCS-OPTIONS: Code review doc for layout/orientation ship
- [Trading Indicator Library] 261-506_DOCS-DOCS-INDICATOR-LIB: Symbol picker + company info header — PRD, IMPL, TEST (checkpoint)
- [Trading Indicator Library] 261-444_DOCS-DOCS-INDICATOR-LIB: PRD — persist swing configurations (checkpoint)
- [Flex Chart Maintenance] 468-477_FE-IMPL-FLEX-CHART: Auth-guarded flex-chart sandbox page (symbol, D/W/M, log toggle, debug readout)
- [Flex Chart Maintenance] 468-479_FE-IMPL-FLEX-CHART: Manual log-scale Y-axis — log10 transform on Double axis, visible-range extents, exact-position stripLine ticks + gutter labels
- [Flex Chart Maintenance] 468-476_DOCS-FLEX-CHART: Log Y-axis PRD, IMPL/TEST plans, and code review doc
- [Flex Chart Maintenance] 468-478_FE-IMPL-FLEX-CHART: Synthetic data mode + edge-case presets (100x range, penny, bad-tick) for the sandbox
- [Flex Chart Maintenance] 468-478_DOCS-FLEX-CHART: Code review doc for synthetic data mode
- [Watchlist management] 465-524_FE-IMPL-WATCHLIST: Symbol list registry read path — defs, composite doc ids, live watchLists$, lazy migration
- [Watchlist management] 465-524_DOCS-WATCHLIST: Unified list infrastructure PRD, IMPL/TEST plans, code review
- [Flex Chart Maintenance] 468-482_FE-IMPL-FLEX-CHART: Sandbox edge cases — decade-aware log ticks, sub-$1 label formatting, floor-clamped tick path, fullscreen page, indicator picker dismiss
- [Flex Chart Maintenance] 468-482_DOCS-FLEX-CHART: Code review doc for edge-cases + PRD acceptance pass

### Changed
- [Watchlist management] 465-466_FE-REFACTOR-SAVANT-TRADER: Consolidate list state ownership in SymbolListStore (checkpoint)

### Fixed
- [Watchlist management] 465-466_FE-BUG-SAVANT-TRADER: Fix nav position, filter-jump, and saved-sets sync (checkpoint)
- [Flex Chart Maintenance] 468-482_FE-BUG: Guard setPersistence so HMR re-bootstrap can't wipe the Firebase auth session

## [2026-09-21]

### Added
- [Option Chain Pct Change Grid] 326-426_BE-IMPL-OPTIONS: Map upstream HTTP status to callable error codes
- [Option Chain Pct Change Grid] 326-426_FE-IMPL-OPTIONS: Dialog-based swing-compare builder + per-date snapshot resilience
- [Option Chain Pct Change Grid] 326-426_DOCS-DOCS-OPTIONS: Phase code review doc + doc status updates
- [Trading Indicator Library] 261-429_FE-IMPL-INDICATOR-LIB: Add batch sweep UI and scope swing-set reads to the user
- [Trading Indicator Library] 261-446_CONFIG-IMPL-INDICATOR-LIB: Add bulk swing seed script (921 symbols x 4 configs swept)
- [Trading Indicator Library] 261-429_DOCS-DOCS-INDICATOR-LIB: Update docs for st-swing-sets and add batch-UI code review
- [Trading Indicator Library] 261-430_FE-IMPL-INDICATOR-LIB: Saved-sets browser — lazy load, symbol filter, N-slot multi-load
- [Trading Indicator Library] 261-462_FE-IMPL-INDICATOR-LIB: Symbol nav store slice (symbol-nav.feature)
- [Trading Indicator Library] 261-463_464_FE-IMPL-INDICATOR-LIB: Symbol nav UI — prev/next, N of M, watchlist filter + chips
- [Trading Indicator Library] 261-461_DOCS-DOCS-INDICATOR-LIB: Nav thread docs (PRD/IMPL/TEST)

### Changed
- [Trading Indicator Library] 261-430_FE-IMPL-INDICATOR-LIB: Saved-sets symbol-first picker; manual controls + batch sweep behind settings dialog; seeded-matching defaults (10/10/10, 3/3/3)
- [Trading Indicator Library] 261-429_CONFIG-CONFIG-INDICATOR-LIB: Rename swing sets to st-swing-sets and tighten list rule

## [2026-09-20]

### Changed
- [Signal Pipeline Maintenance] 433-440_FE-IMPL-SIGNAL-REVIEW: Order queue row data (shares/units/$) + staged group aggregates
- [Signal Pipeline Maintenance] 433-440_DOCS-DOCS-SIGNAL-REVIEW: #440 code review (PASS) + IMPL as-built note
- [Signal Pipeline Maintenance] 433-439_FE-IMPL-SIGNAL-REVIEW: Enable actions on any completed run; fix isCurrentInLatestRun
- [Signal Pipeline Maintenance] 433-447_FE-IMPL-SIGNAL-REVIEW: Repair specs for jest-30 — Firebase stubs, required inputs, spec drift
- [Signal Pipeline Maintenance] 433-447_BE-IMPL-SIGNAL-REVIEW: Explicit firebase-admin type imports in st-collections
- [Signal Pipeline Maintenance] 433-447_CONFIG-CHORE-SIGNAL-REVIEW: Extend jasmine shim for jest-30 CallData + transform jose
- [Signal Pipeline Maintenance] 433-447_DOCS-DOCS-SIGNAL-REVIEW: Document jest-30 testing patterns + code review
- [Signal Pipeline Maintenance] 433-439_DOCS-DOCS-SIGNAL-REVIEW: Misc-fixes topic docs + #439 code review

## [2026-09-19]

### Added
- [Option Chain Pct Change Grid] 326-425_FE-IMPL-OPTIONS: RunSection lazy grids + run-scope chart popup (checkpoint)
- [Option Chain Pct Change Grid] 326-425_DOCS-OPTIONS: Add Task #425 code review (PASS) (checkpoint)
- [Option Chain Pct Change Grid] 326-424_FE-IMPL-OPTIONS: SwingCompare container + RunSection shell (checkpoint)
- [Option Chain Pct Change Grid] 326-424_DOCS-OPTIONS: Add Task #424 code review (PASS) (checkpoint)
- [Option Chain Pct Change Grid] 326-423_FE-IMPL-OPTIONS: SwingSetPicker component + zigzag geometry (checkpoint)
- [Option Chain Pct Change Grid] 326-423_DOCS-OPTIONS: Add Task #423 code review (PASS) (checkpoint)
- [Option Chain Pct Change Grid] 326-422_FE-IMPL-OPTIONS: Swing-compare state + date-list utilities (checkpoint)
- [Option Chain Pct Change Grid] 326-422_DOCS-OPTIONS: Add Task #422 code review (PASS) (checkpoint)
- [Option Chain Pct Change Grid] 326-421_FE-IMPL-OPTIONS: Review fixes — shared signal cache, stale-fetch cancellation, lifecycle guards (checkpoint)
- [Option Chain Pct Change Grid] 326-421_DOCS-OPTIONS: Add Task #421 code review (PASS) (checkpoint)
- [Option Chain Pct Change Grid] 326-421_FE-IMPL-OPTIONS: Load saved swing sets + signal history into the store (checkpoint)
- [Option Chain Pct Change Grid] 326-418_DOCS-OPTIONS: Add PRD, IMPL, and TEST docs for pivot-signal selector (checkpoint)
- [Trading Indicator Library] 261-428_FE-IMPL-INDICATOR-LIB: Add store-owned batch sweep for swing analyses
- [Trading Indicator Library] 261-428_DOCS-DOCS-INDICATOR-LIB: Blueprint IMPL/TEST docs and #428 code review

## [2026-09-18]

### Added
- [Option Chain Pct Change Grid] 326-431_FE-IMPL-OPTIONS: Misc grid UI fixes — layout, contrast modes, highlights, selector refactor
- [Option Chain Pct Change Grid] 326-431_DOCS-DOCS-OPTIONS: Code review for misc grid UI fixes batch
- [Option Chain Pct Change Grid] 326-374_CONFIG-CONFIG-OPTIONS: Switch Jest to jest-preset-angular transformer
- [Option Chain Pct Change Grid] 326-374_SHARED-IMPL-OPTIONS: Harden pct-change-config pure utils
- [Option Chain Pct Change Grid] 326-374_FE-IMPL-OPTIONS: Add ConfirmDialogComponent
- [Option Chain Pct Change Grid] 326-374_FE-IMPL-OPTIONS: Fix grid component self-reference and color test
- [Option Chain Pct Change Grid] 326-374_FE-IMPL-OPTIONS: Harden target type selector sync and input handling
- [Option Chain Pct Change Grid] 326-374_FE-IMPL-OPTIONS: Harden pct-change store state management
- [Option Chain Pct Change Grid] 326-374_FE-IMPL-OPTIONS: Integrate config UI into page
- [Option Chain Pct Change Grid] 326-374_DOCS-DOCS-OPTIONS: Add code review doc for Task #374
- [Trading Indicator Library] 261-389_SHARED-IMPL-INDICATOR-LIB: Add lineColor to ZigZagConfig type
- [Trading Indicator Library] 261-389_FE-IMPL-INDICATOR-LIB: Pass lineColor through buildZigZagIndicator
- [Trading Indicator Library] 261-389_DOCS-INDICATOR-LIB: Add code review doc for Task #389
- [Trading Indicator Library] 261-390_SHARED-IMPL-INDICATOR-LIB: Multi-ZigZag rendering in flex-chart
- [Trading Indicator Library] 261-390_DOCS-INDICATOR-LIB: Add code review doc for Task #390
- [Trading Indicator Library] 261-391_FE-IMPL-INDICATOR-LIB: Remove bars from saved analyses
- [Trading Indicator Library] 261-391_DOCS-INDICATOR-LIB: Add code review doc for Task #391
- [Trading Indicator Library] 261-392_FE-IMPL-INDICATOR-LIB: Refactor SwingAnalysisStore to configs array
- [Trading Indicator Library] 261-392_DOCS-INDICATOR-LIB: Add code review doc for Task #392
- [Trading Indicator Library] 261-393_FE-IMPL-INDICATOR-LIB: Add dual-mode toggle and config UI
- [Trading Indicator Library] 261-393_DOCS-INDICATOR-LIB: Add review doc and update changelog for Task #393 ship
- [Option Chain Pct Change Grid] 326-404_FE-IMPL-OPTIONS: Add extractContractSeries util for contract chart popup
- [Option Chain Pct Change Grid] 326-404_DOCS-OPTIONS: Add contract chart popup lifecycle docs
- [Option Chain Pct Change Grid] 326-406_FE-IMPL-OPTIONS: Add contract selection state for chart popup
- [Option Chain Pct Change Grid] 326-406_DOCS-OPTIONS: Add Task #406 code review doc
- [Option Chain Pct Change Grid] 326-405_FE-IMPL-OPTIONS: Add ContractMiniChartComponent
- [Option Chain Pct Change Grid] 326-405_DOCS-OPTIONS: Add Task #405 review doc + IMPL sync
- [Option Chain Pct Change Grid] 326-407_FE-IMPL-OPTIONS: Wire contract chart popup into the grid
- [Option Chain Pct Change Grid] 326-407_DOCS-OPTIONS: Add Task #407 review doc + IMPL sync
- [Option Chain Pct Change Grid] 326-412_FE-IMPL-OPTIONS: Fix chart popup overlay crash + per-point annotations (checkpoint)
- [Option Chain Pct Change Grid] 326-412_DOCS-OPTIONS: Add Task #412 code review doc (checkpoint)
- [Trading Indicator Library] 261-394_FE-IMPL-INDICATOR-LIB: Add nested tree swing table
- [Trading Indicator Library] 261-394_DOCS-INDICATOR-LIB: Add review doc and update plan docs for Task #394 ship
- [Trading Indicator Library] 261-395_FE-IMPL-INDICATOR-LIB: Add stats panel large/small/all toggle
- [Trading Indicator Library] 261-395_DOCS-INDICATOR-LIB: Add code review doc for Task #395
- [Trading Indicator Library] 261-261_SHARED-IMPL-INDICATOR-LIB: Add reversal-trigger dots to ZigZag chart series (checkpoint)
- [Trading Indicator Library] 261-261_FE-IMPL-INDICATOR-LIB: Tune swing-analysis defaults, layout, and fullscreen (checkpoint)
- [Trading Indicator Library] 261-414_FE-IMPL-INDICATOR-LIB: Debounce lineColor picker and default small swings to black (checkpoint)
- [Trading Indicator Library] 261-414_SHARED-IMPL-INDICATOR-LIB: Flatten saved swing sets to swing-sets/{symbol}_{paramsId} (checkpoint)

## [2026-09-17]

### Added
- [Trading Indicator Library] 261-336_FE-IMPL-INDICATOR-LIB: Add swing table component for ZigZag swing analysis
- [Trading Indicator Library] 261-337_FE-IMPL-INDICATOR-LIB: Add stats panel component for ZigZag swing analysis
- [Trading Indicator Library] 261-338_FE-IMPL-INDICATOR-LIB: Add swing analysis page + route (page shell)
- [Trading Indicator Library] 261-336_DOCS-INDICATOR-LIB: Add code review and UAT docs for swing table
- [Trading Indicator Library] 261-337_DOCS-INDICATOR-LIB: Add code review doc for stats panel
- [Trading Indicator Library] 261-338_DOCS-INDICATOR-LIB: Add code review doc for swing analysis page
- [Option Chain Pct Change Grid] 326-361_DOCS-OPTIONS: Add blueprint docs for save param configuration Thread (checkpoint)
- [Option Chain Pct Change Grid] 326-368_SHARED-IMPL-OPTIONS: Add pct-change config shared types
- [Option Chain Pct Change Grid] 326-368_DOCS-OPTIONS: Add code review doc for Task #368
- [Option Chain Pct Change Grid] 326-369_BE-IMPL-OPTIONS: Add Firestore rules for configs collection
- [Option Chain Pct Change Grid] 326-369_DOCS-OPTIONS: Add code review doc for Task #369
- [Option Chain Pct Change Grid] 326-370_FE-IMPL-OPTIONS: Add pct-change config pure functions
- [Option Chain Pct Change Grid] 326-370_DOCS-OPTIONS: Add code review doc for pct-change config pure functions
- [Option Chain Pct Change Grid] 326-371_FE-IMPL-OPTIONS: Add pct-change config service
- [Option Chain Pct Change Grid] 326-371_DOCS-OPTIONS: Add code review doc for Task #371
- [Option Chain Pct Change Grid] 326-372_FE-IMPL-OPTIONS: Add target type selector component
- [Option Chain Pct Change Grid] 326-372_DOCS-OPTIONS: Add code review doc for Task #372
- [Option Chain Pct Change Grid] 326-373_FE-IMPL-OPTIONS: Add config state to store
- [Option Chain Pct Change Grid] 326-373_DOCS-OPTIONS: Add code review doc for Task #373
- [Trading Indicator Library] 261-339_SHARED-IMPL-INDICATOR-LIB: Port ZigZag to standalone Pine with leftDepth/rightDepth split
- [Trading Indicator Library] 261-339_DOCS-INDICATOR-LIB: Add code review doc for ZigZag Pine export
- [Trading Indicator Library] 261-383_DOCS-INDICATOR-LIB: Add PRD and blueprint docs for Dual ST ZigZag Overlay (checkpoint)
- [Trading Indicator Library] 261-261_DOCS-INDICATOR-LIB: Add project workflow conventions to AGENTS.md (checkpoint)

## [2026-09-16]

### Changed
- [Option Chain Pct Change Grid] 326-345_FE-IMPL-OPTIONS: Add resolvePrice fallback, normalizeType, underlying price fields, and rewritten color mapping
- [Option Chain Pct Change Grid] 326-346_FE-IMPL-OPTIONS: Add underlying price fetch, default QQQ/2025-04-07, and pass prices to grid computation
- [Option Chain Pct Change Grid] 326-347_FE-IMPL-OPTIONS: Extract external templates/styles, add fullscreen, sticky headers, delta/ATM/underlying display, and shrink cells

### Added
- [Option Chain Pct Change Grid] 326-355_DOCS-OPTIONS: Add AS-BUILT doc for Topic #326 ship

### Changed
- [Trading Indicator Library] 261-335_FE-IMPL-INDICATOR-LIB: Harden swing analysis Firestore service + security rules

### Added
- [Trading Indicator Library] 261-335_DOCS-INDICATOR-LIB: Add code review doc + update verification script for swing analysis service

### Added
- [Trading Indicator Library] 261-334_FE-IMPL-INDICATOR-LIB: Add swing analysis store (SignalStore) + Firestore service
- [Trading Indicator Library] 261-334_DOCS-INDICATOR-LIB: Add code review doc for swing analysis store (PASS)
- [Trading Indicator Library] 261-334_DOCS-INDICATOR-LIB: Add Firestore round-trip verification script for swing analysis
- [Trading Indicator Library] 261-333_FE-IMPL-INDICATOR-LIB: Add ZigZag chart indicator + registry integration
- [Trading Indicator Library] 261-333_FE-IMPL-INDICATOR-LIB: Add ZigZag indicator test suite — 19 tests
- [Trading Indicator Library] 261-333_DOCS-INDICATOR-LIB: Add code review doc for ZigZag chart indicator (PASS)
- [Trading Indicator Library] 261-332_FE-IMPL-INDICATOR-LIB: Add ZigZag pure engine — pivots, swings, stats
- [Trading Indicator Library] 261-332_FE-IMPL-INDICATOR-LIB: Add ZigZag engine test suite — 40 tests across 4 specs
- [Trading Indicator Library] 261-332_DOCS-INDICATOR-LIB: Add code review doc for ZigZag engine (PASS)
- [Option Chain Pct Change Grid] 326-343_SHARED-IMPL-OPTIONS: Add chain snapshot shared types and promote historical options types
- [Option Chain Pct Change Grid] 326-343_DOCS-OPTIONS: Add code review doc for Task #343
- [Option Chain Pct Change Grid] 326-344_BE-IMPL-OPTIONS: Add getHistoricalOptionsChain callable
- [Option Chain Pct Change Grid] 326-344_DOCS-OPTIONS: Add code review doc for Task #344
- [Option Chain Pct Change Grid] 326-345_FE-IMPL-OPTIONS: Add computePctChange + pctChangeToColor utilities — 36 tests
- [Option Chain Pct Change Grid] 326-345_DOCS-OPTIONS: Add code review doc for Task #345
- [Option Chain Pct Change Grid] 326-346_FE-IMPL-OPTIONS: Add getHistoricalOptionsChain$ service method + OptionChainPctChangeStore — 20 tests
- [Option Chain Pct Change Grid] 326-346_DOCS-OPTIONS: Add code review doc for Task #346
- [Option Chain Pct Change Grid] 326-347_FE-IMPL-OPTIONS: Add pct change grid component + page + routing — 22 tests
- [Option Chain Pct Change Grid] 326-347_DOCS-OPTIONS: Add code review doc for Task #347

## [2026-09-15]

### Added
- [Option Chain Pct Change Grid] 326-326_DOCS-OPTIONS: Add PRD and SA caching proposal for option chain pct change grid (checkpoint)
- [Option Chain Pct Change Grid] 326-326_SHARED-DOCS-OPTIONS: Add implementation and test plans for shared chain snapshot types (checkpoint)
- [Option Chain Pct Change Grid] 326-326_BE-DOCS-OPTIONS: Add implementation and test plans for chain snapshot callable (checkpoint)
- [Option Chain Pct Change Grid] 326-326_FE-DOCS-OPTIONS: Add implementation and test plans for pct change grid feature (checkpoint)
- [Indicator Library] 261-325_DOCS-INDICATOR-LIB: Add ZigZag PRD, implementation plans, test plans, and reference source (checkpoint)
- [Indicator Library] 261-320_DOCS-INDICATOR-LIB: Add code review doc for Trend Rider Zero Cross FE BE-dots migration (checkpoint)

### Changed
- [Indicator Library] 261-320_FE-IMPL-INDICATOR-LIB: Remove client-side zero-cross dot detection, use BE dots (checkpoint)

## [2026-09-14]

### Added
- [Indicator Library] 261-319_BE-IMPL-INDICATOR-LIB: Add zero-cross detection to BE signal pipeline
- [Indicator Library] 261-319_DOCS-INDICATOR-LIB: Add PRD, IMPL, TEST, and code review docs for Task #319
- [Portfolio Dashboard] 219-314_SHARED-IMPL-PORTFOLIO: Add PnlTrade types and getPnlTradeHistory client method
- [Portfolio Dashboard] 219-314_FE-IMPL-PORTFOLIO: Wire closed trades into portfolio dashboard store and component
- [Portfolio Dashboard] 219-314_FE-IMPL-PORTFOLIO: Add tests for closed trades dashboard wiring
- [Portfolio Dashboard] 219-314_DOCS-PORTFOLIO: Add code review doc and update changelog for Task #314
- [Indicator Library] 261-311_SHARED-IMPL-INDICATOR-LIB: Add Trend Rider Zero Cross plots to ST Zones Pine
- [Indicator Library] 261-311_DOCS-INDICATOR-LIB: Add code review doc for Task #311
- [Indicator Library] 261-310_SHARED-IMPL-INDICATOR-LIB: Add Trend Rider Zero Cross detector and indicator options
- [Indicator Library] 261-310_FE-IMPL-INDICATOR-LIB: Wire zero-cross dots into ST chart extras
- [Indicator Library] 261-310_DOCS-INDICATOR-LIB: Add Trend Rider Zero Cross PRD, IMPL, TEST, and code review docs
- [Portfolio Dashboard] 219-297_FE-IMPL-PORTFOLIO: Wire stop-loss action into equity positions table
- [Portfolio Dashboard] 219-297_DOCS-PORTFOLIO: Add code review doc for Task #297

## [2026-09-13]

### Added
- [Indicator Library] 261-273_SHARED-IMPL-INDICATOR-LIB: Export ST StdDevLines to PineScript
- [Indicator Library] 261-273_DOCS-INDICATOR-LIB: Add code review doc for Pine export
- [Portfolio Dashboard] 219-296_FE-IMPL-PORTFOLIO: Add stop-loss dialog component
- [Portfolio Dashboard] 219-296_DOCS-PORTFOLIO: Add code review doc for Task #296
- [Portfolio Dashboard] 219-295_FE-IMPL-PORTFOLIO: Wire close-position action into equity positions table
- [Portfolio Dashboard] 219-295_DOCS-PORTFOLIO: Add code review doc for Task #295
- [Portfolio Dashboard] 219-294_FE-IMPL-PORTFOLIO: Add close-position utility and dialog component
- [Portfolio Dashboard] 219-294_DOCS-PORTFOLIO: Add code review doc for Task #294
- [Portfolio Dashboard] 219-293_SHARED-IMPL-PORTFOLIO: Extract StopLossFormComponent for reuse
- [Portfolio Dashboard] 219-293_FE-IMPL-PORTFOLIO: Embed StopLossFormComponent in OrderTicketComponent
- [Portfolio Dashboard] 219-293_DOCS-PORTFOLIO: Add planning and review docs for Task #293

## [2026-09-12]

### Added
- [Portfolio Dashboard] 219-287_FE-IMPL-PORTFOLIO: Add Cost Basis, Value columns, totals footer, and closed-position toggle to position tables
- [Portfolio Dashboard] 219-287_FE-IMPL-PORTFOLIO: Wire section components into dashboard shell with store signals
- [Portfolio Dashboard] 219-287_DOCS-PORTFOLIO: Add code review doc for Task #287 integration + wiring
- [Portfolio Dashboard] 219-286_FE-IMPL-PORTFOLIO: Add 5 portfolio dashboard section components
- [Portfolio Dashboard] 219-286_DOCS-PORTFOLIO: Add code review doc for Task #286 section components
- [Portfolio Dashboard] 219-285_FE-IMPL-PORTFOLIO: Add Portfolio Dashboard routing and shell component
- [Portfolio Dashboard] 219-285_DOCS-PORTFOLIO: Add Task #285 code review document
- [Portfolio Dashboard] 219-284_FE-IMPL-PORTFOLIO: Add PortfolioDashboardStore with state, selectors, and load methods
- [Portfolio Dashboard] 219-284_DOCS-PORTFOLIO: Add code review doc for Task #284 PortfolioDashboardStore
- [Portfolio Dashboard] 219-283_FE-IMPL-PORTFOLIO: Add pure PnL and stop-loss protection utilities
- [Portfolio Dashboard] 219-283_DOCS-PORTFOLIO: Add code review doc for Task #283 pure utilities

### Fixed
- [Portfolio Dashboard] 219-287_FE-BUG-PORTFOLIO: Fix quote, order, and option position parsing
- [Portfolio Dashboard] 219-287_FE-BUG-PORTFOLIO: Add unconfirmed to LIVE_ORDER_STATES
- [Portfolio Dashboard] 219-286_FE-BUG-PORTFOLIO: Show all Robinhood accounts instead of filtering to agentic-allowed

## [2026-09-11]

### Added
- [Portfolio Dashboard] 219-282_FE-IMPL-PORTFOLIO: Add RobinhoodMcpClient typed wrapper with quote batching
- [Portfolio Dashboard] 219-282_DOCS-PORTFOLIO: Add portfolio dashboard planning and review docs

### Changed
- [Portfolio Dashboard] 219-282_FE-REFACTOR-PORTFOLIO: Move RobinhoodMcpObservationService to core

## [2026-09-10]

### Added
- [Trading Indicator Library] 261-269_FE-IMPL-INDICATOR-LIB: Std Dev Lines chart indicator + tests
- [Trading Indicator Library] 261-269_DOCS-DOCS-INDICATOR-LIB: Code review for Std Dev Lines chart indicator
- [Trading Indicator Library] 261-268_BE-CHORE-INDICATOR-LIB: Std Dev Lines verification script + guide
- [Trading Indicator Library] 261-268_DOCS-DOCS-INDICATOR-LIB: Code review for Std Dev Lines verification script

## [2026-09-09]

### Added
- [Trading Indicator Library] 261-267_BE-IMPL-INDICATOR-LIB: Std Dev Lines computation engine + unit tests
- [Trading Indicator Library] 261-267_DOCS-DOCS-INDICATOR-LIB: Std Dev Lines PRD, plans, and code review
- [Trading Strategy Library] 106-258_BE-IMPL-BACKTEST: Add open-close strategy comparison script runner
- [Trading Strategy Library] 106-258_BE-CHORE-BACKTEST: Add verification scripts for script runner
- [Trading Strategy Library] 106-258_DOCS-DOCS-STRAT-LIB: Add code review doc for #258 script runner
- [Trading Strategy Library] 106-257_BE-IMPL-BACKTEST: Add open-close return computation module
- [Trading Strategy Library] 106-257_BE-CHORE-BACKTEST: Add verification scripts for compute module
- [Trading Strategy Library] 106-257_DOCS-DOCS-STRAT-LIB: Add Topic #106 strategy library docs
- [Robinhood Trading UI] 176-212_SHARED-IMPL-SAVANT-TRADER: Add terminalAt field to OrderTicket type (checkpoint)
- [Robinhood Trading UI] 176-212_SHARED-IMPL-SAVANT-TRADER: Centralize RH state mapping and fix isActiveStopLoss (checkpoint)
- [Robinhood Trading UI] 176-212_SHARED-IMPL-SAVANT-TRADER: Batch terminal reconciliation in service and store (checkpoint)
- [Robinhood Trading UI] 176-212_FE-IMPL-SAVANT-TRADER: Signal order page RH merge and requeue guard (checkpoint)
- [Robinhood Trading UI] 176-212_FE-IMPL-SAVANT-TRADER: Order queue restore Resting group and remove dead helpers (checkpoint)
- [Robinhood Trading UI] 176-212_FE-IMPL-SAVANT-TRADER: Order ticket remove dead code and restore RESTING cancel guards (checkpoint)
- [Robinhood Trading UI] 176-212_DOCS-DOCS-SAVANT-TRADER: Code review for #212 order UI cleanup (checkpoint)

## [2026-09-08]

### Added
- [Robinhood Trading UI] 176-241_SHARED-IMPL-SAVANT-TRADER: Remove Trading Case contracts, add broker-types
- [Robinhood Trading UI] 176-241_BE-IMPL-SAVANT-TRADER: Update broker normalizer/adapter for broker-types
- [Robinhood Trading UI] 176-241_FE-IMPL-SAVANT-TRADER: Order Ticket write-once model + intent→ticket rename
- [Robinhood Trading UI] 176-241_BE-CHORE-SAVANT-TRADER: Add broker MCP verification scripts
- [Robinhood Trading UI] 176-241_DOCS-DOCS-SAVANT-TRADER: Add ADR-008, review docs, and update domain model

### Changed
- [Robinhood Trading UI] 176-241_CONFIG-CONFIG-SAVANT-TRADER: Remove trading-case alias, exclude scripts/verify
- [Export ST indicators to PineScript for TradingView] 221-251_SHARED-IMPL-SAVANT-TRADER: Add stepped HTF Trend Strength histogram to Pine and local indicators

## [2026-09-07]

### Added
- [Robinhood Trading UI] 176-212_FE-IMPL-SAVANT-TRADER: Add HTTP timeout interceptor for MCP calls (checkpoint)
- [Robinhood Trading UI] 176-212_FE-IMPL-SAVANT-TRADER: Add QUEUED/RESTING states and broker order parsing (checkpoint)
- [Robinhood Trading UI] 176-212_FE-IMPL-SAVANT-TRADER: Add broker position hydration and stop-loss reconciliation (checkpoint)
- [Robinhood Trading UI] 176-212_FE-IMPL-SAVANT-TRADER: Add fractional close intent builder and utils (checkpoint)
- [Robinhood Trading UI] 176-212_FE-IMPL-SAVANT-TRADER: Update order workspace UI for UAT (checkpoint)
- [Robinhood Trading UI] 176-240_SHARED-IMPL-SAVANT-TRADER: Add isPlainObject utility and skipped field to broker contracts
- [Robinhood Trading UI] 176-240_BE-IMPL-SAVANT-TRADER: Add Robinhood broker order and position normalizer
- [Robinhood Trading UI] 176-240_BE-IMPL-SAVANT-TRADER: Add broker order and position normalizer/adapter tests
- [Robinhood Trading UI] 176-240_DOCS-DOCS-SAVANT-TRADER: Add broker order verification scripts and code review
- [Robinhood Trading UI] 176-239_SHARED-IMPL-SAVANT-TRADER: Define Trading Case and reconciliation contracts
- [Robinhood Trading UI] 176-239_SHARED-IMPL-SAVANT-TRADER: Add Trading Case contract tests
- [Robinhood Trading UI] 176-239_DOCS-DOCS-SAVANT-TRADER: Document broker-authoritative reconciliation architecture
### Changed
- [Robinhood Trading UI] 176-239_CONFIG-CONFIG-SAVANT-TRADER: Wire Trading Case test infrastructure
- [Export ST indicators to PineScript for TradingView] 221-232_SHARED-IMPL-SAVANT-TRADER: Port ST Trend Strength
- [Export ST indicators to PineScript for TradingView] 221-232_DOCS-DOCS-SAVANT-TRADER: Record Trend Strength review
- [Export ST indicators to PineScript for TradingView] 221-233_SHARED-IMPL-SAVANT-TRADER: Add Zone V1/V2 price-pane event overlay
- [Export ST indicators to PineScript for TradingView] 221-233_DOCS-DOCS-SAVANT-TRADER: Record Zone V1/V2 event overlay review

## [2026-09-06]

### Added
- [Export ST indicators to PineScript for TradingView] 221-231_SHARED-IMPL-SAVANT-TRADER: Port ST Trend Bands and zones
- [Export ST indicators to PineScript for TradingView] 221-231_DOCS-DOCS-SAVANT-TRADER: Record Trend Bands and zones review

## [2026-09-05]

### Added
- [Export ST indicators to PineScript for TradingView] 221-228_SHARED-IMPL-SAVANT-TRADER: Add Pine v6 indicator foundation
- [Export ST indicators to PineScript for TradingView] 221-228_DOCS-DOCS-SAVANT-TRADER: Record Pine foundation planning and review
- [Export ST indicators to PineScript for TradingView] 221-229_SHARED-IMPL-SAVANT-TRADER: Translate shared ST math and state behavior
- [Export ST indicators to PineScript for TradingView] 221-229_DOCS-DOCS-SAVANT-TRADER: Record shared ST math review

## [2026-09-02]

### Added
- [Savant Trader] 176-212_BE-CHORE-SAVANT-TRADER: Remove isEnabled field and add occurrence decision TTL cleanup (checkpoint)
- [Savant Trader] 176-212_SHARED-IMPL-SAVANT-TRADER: Add cross-run decision loading and staleness display (checkpoint)
- [Savant Trader] 176-212_FE-IMPL-SAVANT-TRADER: Fix persistence, prev/next navigation, and review/accept separation (checkpoint)
- [Savant Trader] 176-212_FE-IMPL-SAVANT-TRADER: UI cleanup for order queue, ticket, quick-charts, and dashboard (checkpoint)
- [Savant Trader] 176-212_BE-CHORE-SAVANT-TRADER: Add backfill-overview and migrate-st-collections scripts (checkpoint)
- [Savant Trader] 176-212_DOCS-DOCS-SAVANT-TRADER: Add UAT results, decision pipeline PRD, ADR-006, and code review (checkpoint)
- [Savant Trader] 176-212_CONFIG-CONFIG-PROJ: Update .devin/skills submodule pointer (checkpoint)

## [2026-08-27]

### Fixed
- [Data Pipeline] 159-210_BE-BUG-DATA-PIPELINE: Fix intraday run completion path
- [Data Pipeline] 159-210_BE-BUG-DATA-PIPELINE: Fix fallback symbol normalization

### Added
- [Data Pipeline] 159-210_DOCS-DOCS-DATA-PIPELINE: Add code review doc for intraday fix

## [2026-08-25]

### Added
- [Savant Trader] 176-192_SHARED-IMPL-SAVANT-TRADER: Add OrderIntent discriminated union type model
- [Savant Trader] 176-177_DOCS-DOCS-SAVANT-TRADER: Add code review doc for Savant Trader rename
- [Savant Trader] 176-189-190_DOCS-DOCS-SAVANT-TRADER: Add code review doc for S1f/S1g store and page rename
- [Savant Trader] 176-194_DOCS-DOCS-SAVANT-TRADER: Add code review doc for FE-A1 review flag wiring
- [Savant Trader] 176-195_DOCS-DOCS-SAVANT-TRADER: Add code review doc for FE-A2 ephemeral status collapse
- [Savant Trader] 176-196_DOCS-DOCS-SAVANT-TRADER: Add code review doc for FE-B1 order intent service + staging store
- [Savant Trader] 176-197_DOCS-DOCS-SAVANT-TRADER: Add code review doc for FE-B2 order execution service
- [Savant Trader] 176-198_DOCS-DOCS-SAVANT-TRADER: Add code review doc for FE-B3 account number preference
- [Savant Trader] 176-199_DOCS-DOCS-SAVANT-TRADER: Add code review doc for FE-C1a signal order screen
- [Savant Trader] 176-200_DOCS-DOCS-SAVANT-TRADER: Add code review doc for FE-C1b order ticket
- [Savant Trader] 176-201_DOCS-DOCS-SAVANT-TRADER: Add code review doc for FE-D1 signal pipeline wiring
- [Savant Trader] 176-202_DOCS-DOCS-SAVANT-TRADER: Add code review doc for FE-D2a agent-order rename
- [Savant Trader] 176-203_DOCS-DOCS-SAVANT-TRADER: Verify Robinhood simultaneous resting orders

### Changed
- [Savant Trader] 176-188_SHARED-REFACTOR-SAVANT-TRADER: Rename services/ files and classes, fix callable names
- [Savant Trader] 176-191_SHARED-REFACTOR-SAVANT-TRADER: Rename utils/ and common/ files and classes
- [Savant Trader] 176-193_BE-REFACTOR-SAVANT-TRADER: Rename BE directory, files, classes, collection constants, and firestore rules
- [Savant Trader] 176-189-190_BE-REFACTOR-SAVANT-TRADER: Fix broken BE script imports and update st-cloud-function README
- [Savant Trader] 176-189-190_SHARED-REFACTOR-SAVANT-TRADER: Rename stores, pages, components, services, types, and constants
- [Savant Trader] 176-189-190_TESTS-REFACTOR-SAVANT-TRADER: Update test imports and mock methods for st- rename
- [Savant Trader] 176-194_FE-IMPL-SAVANT-TRADER: Wire TriageStore review flag methods to TriageService
- [Savant Trader] 176-195_FE-IMPL-SAVANT-TRADER: Collapse ephemeral decision status into durable store
- [Savant Trader] 176-196_FE-IMPL-SAVANT-TRADER: Add OrderIntentService and OrderStagingStore
- [Savant Trader] 176-197_FE-IMPL-SAVANT-TRADER: Add OrderExecutionService for equity order placement and reconciliation
- [Savant Trader] 176-198_FE-IMPL-SAVANT-TRADER: Add TradingConfigService for account number preference
- [Savant Trader] 176-199_FE-IMPL-SAVANT-TRADER: Add signal order screen with master-detail queue layout
- [Savant Trader] 176-200_FE-IMPL-SAVANT-TRADER: Add order ticket component with confirmation dialog
- [Savant Trader] 176-201_FE-IMPL-SAVANT-TRADER: Wire signal pipeline to stage accepted intents
- [Savant Trader] 176-202_FE-IMPL-SAVANT-TRADER: Rename agent-order directory to signal-order

## [2026-08-24]

### Added
- [Data Pipeline PDR Migration] 159-167_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add SDS completion detection with set-based schema
- [Data Pipeline PDR Migration] 159-167_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add SDS watchdog for stale runs and sequences
- [Data Pipeline PDR Migration] 159-167_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add SDS downstream consumer dispatch
- [Data Pipeline PDR Migration] 159-167_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add SDS completion unit tests (52 tests)
- [Data Pipeline PDR Migration] 159-167_BE-CHORE-DATA-PIPELINE-PDR-MIGRATION: Add SDS completion verification script
- [Data Pipeline PDR Migration] 159-167_DOCS-DATA-PIPELINE-PDR-MIGRATION: Add ADR-005, code review, and task order docs
- [Data Pipeline PDR Migration] 159-168_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add SDS fallback timer with createPostRun extraction
- [Data Pipeline PDR Migration] 159-168_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add open pass timer with 5-minute slot computation
- [Data Pipeline PDR Migration] 159-168_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add fallback and open pass timer unit tests (17 tests)
- [Data Pipeline PDR Migration] 159-168_BE-CHORE-DATA-PIPELINE-PDR-MIGRATION: Add fallback and open pass timer verification scripts
- [Data Pipeline PDR Migration] 159-168_DOCS-DATA-PIPELINE-PDR-MIGRATION: Add code review doc for fallback and open pass timer
- [Data Pipeline PDR Migration] 159-169_BE-CHORE-DATA-PIPELINE: Add verification script for PDRv2 cleanup
- [Data Pipeline PDR Migration] 159-169_DOCS-DATA-PIPELINE: Add code review, monitoring doc, update task order
- [Data Pipeline PDR Migration] 159-170_FE-IMPL-DATA-PIPELINE: Add LocalBarReadService with PT date math and shared OhlcBar type
- [Data Pipeline PDR Migration] 159-170_FE-CHORE-DATA-PIPELINE: Add verification script for local bar-read service
- [Data Pipeline PDR Migration] 159-170_DOCS-DATA-PIPELINE: Add code review doc for local bar-read service
- [Data Pipeline PDR Migration] 159-171_FE-IMPL-DATA-PIPELINE: Migrate option chart to local bar store
- [Data Pipeline PDR Migration] 159-171_FE-CHORE-DATA-PIPELINE: Add verification script for option chart migration
- [Data Pipeline PDR Migration] 159-171_DOCS-DATA-PIPELINE: Add code review doc for option chart migration
- [Data Pipeline PDR Migration] 159-172_FE-IMPL-DATA-PIPELINE: Migrate spread chart to local bar store
- [Data Pipeline PDR Migration] 159-172_FE-CHORE-DATA-PIPELINE: Add verification script for spread chart migration
- [Data Pipeline PDR Migration] 159-172_DOCS-DATA-PIPELINE: Add code review doc for spread chart migration

### Changed
- [Data Pipeline PDR Migration] 159-167_BE-REFACTOR-DATA-PIPELINE-PDR-MIGRATION: Delete rhAgentPdrTrigger and wire SDS exports
- [Data Pipeline PDR Migration] 159-168_BE-REFACTOR-DATA-PIPELINE-PDR-MIGRATION: Delete old optionsOpenPass cron and wire new exports
- [Data Pipeline PDR Migration] 159-169_BE-CHORE-DATA-PIPELINE: Fix sds_fallback_start logging and update stale references

### Removed
- [Data Pipeline PDR Migration] 159-169_BE-CHORE-DATA-PIPELINE: Remove dead symbol-driven pipeline and PDRv2 currentPrice side-effect

## [2026-08-23]

### Added
- [Data Pipeline PDR Migration] 159-166_DOCS-DATA-PIPELINE-PDR-MIGRATION: Update PRD, IMPL, TEST for intraday design revision
- [Data Pipeline PDR Migration] 159-166_DOCS-DATA-PIPELINE-PDR-MIGRATION: Add code review doc for SDS core
- [Data Pipeline PDR Migration] 159-166_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add PDR parser with interval normalization
- [Data Pipeline PDR Migration] 159-166_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add SDS core message handler with run/sequence management
- [Data Pipeline PDR Migration] 159-166_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add SDS worker with transactional counter updates
- [Data Pipeline PDR Migration] 159-166_BE-IMPL-DATA-PIPELINE-PDR-MIGRATION: Add SDS Pub/Sub subscriber and wire exports
- [Data Pipeline PDR Migration] 159-166_BE-CHORE-DATA-PIPELINE-PDR-MIGRATION: Add SDS verification scripts and test runner
- [Data Pipeline PDR Migration] 159-161_DOCS-DATA-PIPELINE-PDR-MIGRATION: Add blueprint docs for PDR migration (checkpoint)

### Changed
- [Data Pipeline PDR Migration] 159-166_BE-REFACTOR-DATA-PIPELINE-PDR-MIGRATION: Delete syncTrackedSymbolsDaily and fix tracked symbol extraction

## [2026-08-19]

### Added
- [Strategy Builder UI] 137-149_FE-IMPL-STRAT-BUILD-UI: Add compact dialog form for creating and editing strategy instances
- [Strategy Builder UI] 137-149_FE-IMPL-STRAT-BUILD-UI: Add exit policy compatibility validation and openTimePT format validation
- [Strategy Builder UI] 137-149_FE-IMPL-STRAT-BUILD-UI: Add 32 component tests for form validation, ID preview, exit policies, and edit pre-fill

### Changed
- [Strategy Builder UI] 137-149_SHARED-BUG-STRAT-BUILD-UI: Include openTimePT in strategy instance ID to prevent collisions for strategies with identical symbol/delta/DTE but different opening times
- [Strategy Builder UI] 137-149_FE-REFACTOR-STRAT-BUILD-UI: Switch list component from route-based create/edit to MatDialog
- [Strategy Builder UI] 137-149_FE-REFACTOR-STRAT-BUILD-UI: Replace text action buttons with icon buttons, add Target Delta column
- [Strategy Builder UI] 137-149_FE-REFACTOR-STRAT-BUILD-UI: Pass openTimePT to generateInstanceId, clean up store finalize import
- [Strategy Builder UI] 137-149_DOCS-STRAT-BUILD-UI: Update docs to reflect dialog design (stepper abandoned) and openTimePT ID format

## [2026-08-18]

### Added
- [Strategy Builder UI] 137-148_FE-FEATURE-STRAT-BUILD-UI: Add Strategy Builder list component
- [Strategy Builder UI] 137-148_FE-FEATURE-STRAT-BUILD-UI: Add Strategy Builder component tests
- [Strategy Builder UI] 137-148_FE-FEATURE-STRAT-BUILD-UI: Register Strategy Builder routes
- [Strategy Builder UI] 137-148_FE-FEATURE-STRAT-BUILD-UI: Add Manage Strategies link to dashboard
- [Strategy Builder UI] 137-148_DOCS-STRAT-BUILD-UI: Add code review document for Task #148
- [Strategy Builder UI] 137-147_FE-CONFIG-STRAT-BUILD-UI: Add path aliases and collection constant
- [Strategy Builder UI] 137-147_FE-FEATURE-STRAT-BUILD-UI: Add Strategy Builder Firestore service
- [Strategy Builder UI] 137-147_FE-FEATURE-STRAT-BUILD-UI: Add Strategy Builder SignalStore
- [Strategy Builder UI] 137-147_DOCS-STRAT-BUILD-UI: Add code review document for Task #147

### Changed
- [Strategy Builder UI] 137-148_CHORE-STRAT-BUILD-UI: Remove @topic file locks after ship
- [Strategy Builder UI] 137-147_CHORE-STRAT-BUILD-UI: Remove @topic file locks after ship

## [2026-08-17]

### Added
- [Strategy Builder UI] 137-146_BE-IMPL-STRAT-BUILD-UI: Add Firestore-backed strategy instance repository
- [Strategy Builder UI] 137-146_BE-REFACTOR-STRAT-BUILD-UI: Migrate pass orchestrators to repository and split modules
- [Strategy Builder UI] 137-146_BE-CONFIG-STRAT-BUILD-UI: Add user-scoped Firestore rules for options-strategy-instances
- [Strategy Builder UI] 137-146_BE-CONFIG-STRAT-BUILD-UI: Add seed script for legacy QQQM-WHEEL instance
- [Strategy Builder UI] 137-146_DOCS-STRAT-BUILD-UI: Add code review document for Task #146
- [Strategy Builder UI] 137-145_SHARED-IMPL-STRAT-BUILD-UI: Unified types, enums, and ID generator
- [Strategy Builder UI] 137-145_SHARED-TESTS-STRAT-BUILD-UI: Add tests for ID generator and unified contracts
- [Strategy Builder UI] 137-145_BE-TESTS-STRAT-BUILD-UI: Add spreadTypeToOptionSide and config shape tests

### Changed
- [Strategy Builder UI] 137-146_CHORE-CHORE-STRAT-BUILD-UI: Add missing @topic tag to options-strategy-engine collections
- [Strategy Builder UI] 137-146_CHORE-CHORE-STRAT-BUILD-UI: Remove @topic file locks after ship
- [Strategy Builder UI] 137-145_BE-IMPL-STRAT-BUILD-UI: Migrate BE to unified shared types
- [Strategy Builder UI] 137-145_DOCS-DOCS-STRAT-BUILD-UI: Update PRD, IMPL, TEST, and CODE-REVIEW docs

### Fixed
- [Strategy Builder UI] 137-145_BE-IMPL-STRAT-BUILD-UI: Populate flat fields in registry seed instance

### Changed
- [Strategy Builder UI] 137-145_CHORE-CHORE-STRAT-BUILD-UI: Remove @topic file locks after ship

## [2026-08-16]

### Added
- [Strategy Builder UI] 137-137_DOCS-STRAT-BUILD-UI: Add PRD, IMPL, and TEST docs for Strategy Builder UI (checkpoint)
- [Options Position Strategy Engine] 108-112_FE-IMPL-OPTIONS: Add options strategy FE types and status labels
- [Options Position Strategy Engine] 108-112_FE-IMPL-OPTIONS: Add options strategy callable wrapper service
- [Options Position Strategy Engine] 108-112_FE-IMPL-OPTIONS: Register options strategy dashboard route
- [Options Position Strategy Engine] 108-112_FE-IMPL-OPTIONS: Add options strategy dashboard SignalStore
- [Options Position Strategy Engine] 108-112_FE-IMPL-OPTIONS: Add options strategy dashboard component
- [Options Position Strategy Engine] 108-112_DOCS-DOCS-OPTIONS: Add FE code review and update impl/test doc status
- [Options Position Strategy Engine] 108-111_BE-IMPL-OPTIONS: Add strategy query service and listAllPositions repository helper
- [Options Position Strategy Engine] 108-111_BE-IMPL-OPTIONS: Add listStrategyPositions and getStrategyEquityCurve callables
- [Options Position Strategy Engine] 108-111_DOCS-DOCS-OPTIONS: Add three-axis code review for dashboard callables + update doc status
- [Options Position Strategy Engine] 108-111_BE-IMPL-OPTIONS: Add pure stats utility functions for max drawdown and stats computation
- [Options Position Strategy Engine] 108-111_BE-IMPL-OPTIONS: Add stats repository with atomic recompute and incremental open-pass update
- [Options Position Strategy Engine] 108-111_BE-IMPL-OPTIONS: Wire stats pass into nightly schedule and add open-pass incremental update
- [Options Position Strategy Engine] 108-111_DOCS-DOCS-OPTIONS: Add three-axis code review for stats rollup + update doc status
- [Options Position Strategy Engine] 108-111_BE-REFACTOR-OPTIONS: Extract shared settlement types, repository helpers, and de-duplicate findPrimaryLeg
- [Options Position Strategy Engine] 108-111_BE-IMPL-OPTIONS: Implement settlement pass for expiring short-put positions
- [Options Position Strategy Engine] 108-111_BE-IMPL-OPTIONS: Implement held-shares daily mark pass for assigned positions
- [Options Position Strategy Engine] 108-111_BE-IMPL-OPTIONS: Wire settlement and held-shares passes into nightly schedule
- [Options Position Strategy Engine] 108-111_DOCS-DOCS-OPTIONS: Add three-axis code review for settlement + held-shares passes

### Changed
- [Options Position Strategy Engine] 108-111_CHORE-OPTIONS: Remove @topic #108 file locks from shipped files (criterion #6)
- [Options Position Strategy Engine] 108-111_CHORE-OPTIONS: Remove @topic #108 file locks from shipped files (criterion #7)
- [Options Position Strategy Engine] 108-111_CHORE-OPTIONS: Remove @topic #108 file locks from shipped files (criteria #8+#9)

## [2026-08-15]

### Added
- [Options Strategy Engine — Hybrid Quote Provider] 114-120_SHARED-IMPL-HYBRID-QUOTE-PROVIDER: Add shared options strategy engine contracts and OptionQuoteSource enum
- [Options Strategy Engine — Hybrid Quote Provider] 114-121_BE-IMPL-HYBRID-QUOTE-PROVIDER: Add AV EOD provider, nightly selection orchestrator, OCC→RH instrument map service, and closed-form Black-Scholes simulator
- [Options Strategy Engine — Hybrid Quote Provider] 114-121_BE-TESTS-HYBRID-QUOTE-PROVIDER: Add tests for AV EOD quote provider, selection, instrument map, and Black-Scholes simulator
- [Options Strategy Engine — Hybrid Quote Provider] 114-122_BE-IMPL-HYBRID-QUOTE-PROVIDER: Add RH MCP session manager, quote provider, and OptionContractRef validation
- [Options Strategy Engine — Hybrid Quote Provider] 114-122_BE-TESTS-HYBRID-QUOTE-PROVIDER: Add tests for RH MCP session manager, quote provider, and instrument map service
- [Options Strategy Engine — Hybrid Quote Provider] 114-123_BE-IMPL-HYBRID-QUOTE-PROVIDER: Implement open pass and mark pass
- [Options Strategy Engine — Hybrid Quote Provider] 114-123_BE-TESTS-HYBRID-QUOTE-PROVIDER: Add unit tests for open pass and mark pass
- [Options Strategy Engine — Hybrid Quote Provider] 114-124_BE-IMPL-HYBRID-QUOTE-PROVIDER: Wire scheduled cloud functions for options strategy passes
- [Options Strategy Engine — Hybrid Quote Provider] 114-124_BE-TESTS-HYBRID-QUOTE-PROVIDER: Add unit tests for config bridge helpers
- [Options Strategy Engine — Hybrid Quote Provider] 114-129_SHARED-TESTS-HYBRID-QUOTE-PROVIDER: Add shared unit tests for OCC helpers and options strategy engine contracts
- [Options Strategy Engine — Hybrid Quote Provider] 114-130_BE-TESTS-HYBRID-QUOTE-PROVIDER: Add integration tests for selection -> open -> mark flow

### Changed
- [Options Strategy Engine — Hybrid Quote Provider] 114-114_CHORE-HYBRID-QUOTE-PROVIDER: Remove @topic #114 file locks and close Topic #114

### Added (checkpoints)
- [Options Strategy Engine — Hybrid Quote Provider] 114-129_SHARED-TESTS-HYBRID-QUOTE-PROVIDER: Add shared unit tests for OCC helpers and options strategy engine contracts (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-130_BE-TESTS-HYBRID-QUOTE-PROVIDER: Add integration tests for selection -> open -> mark flow (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-129_DOCS-DOCS-HYBRID-QUOTE-PROVIDER: Add gate review for tasks #129 and #130 with fixes (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-124_BE-IMPL-HYBRID-QUOTE-PROVIDER: Wire scheduled cloud functions for options strategy passes (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-124_BE-TESTS-HYBRID-QUOTE-PROVIDER: Add unit tests for config bridge helpers (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-124_DOCS-DOCS-HYBRID-QUOTE-PROVIDER: Add interim code review for task #124 with findings and fixes (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-123_SHARED-IMPL-HYBRID-QUOTE-PROVIDER: Add interpolatedClose field to OptionQuote (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-123_BE-IMPL-HYBRID-QUOTE-PROVIDER: Implement open pass and mark pass (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-123_BE-TESTS-HYBRID-QUOTE-PROVIDER: Add unit tests for open pass and mark pass (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-121_BE-IMPL-HYBRID-QUOTE-PROVIDER: Add AV EOD provider, nightly selection orchestrator, OCC→RH instrument map service, and closed-form Black-Scholes simulator (checkpoint)

## [2026-08-14]

### Added
- [Options Strategy Engine — Hybrid Quote Provider] 114-120_SHARED-IMPL-HYBRID-QUOTE-PROVIDER: Add shared options strategy engine contracts and tests (checkpoint)
- [Options Strategy Engine — Hybrid Quote Provider] 114-115_SHARED-DOCS-HYBRID-QUOTE-PROVIDER: Refine hybrid quote provider PRD (checkpoint)
- [Options Position Strategy Engine] 108-108_SHARED-DOCS-OPTIONS: Checkpoint options strategy engine blueprint docs (checkpoint)

## [2026-08-06]

### Added
- [Spread Time Series Viewer] 77-83_77-84_BE-IMPL-SPREAD-VIEWER: Add fetchWithRetry POST support and spread proxy
- [Spread Time Series Viewer] 77-85_BE-IMPL-SPREAD-VIEWER: Add spread run orchestrator, worker, and model
- [Spread Time Series Viewer] 77-86_BE-CONFIG-SPREAD-VIEWER: Add Firestore rules and code review for spread viewer backend
- [Spread Time Series Viewer] 77-80_SHARED-IMPL-SPREAD-VIEWER: Add shared types and OCC contract ID helpers
- [Spread Time Series Viewer] 77-80_DOCS-DOCS-SPREAD-VIEWER: Add code review doc for SHARED task

### Changed
- [Spread Time Series Viewer] 77-80_CHORE-CHORE-SPREAD-VIEWER: Remove @topic tags after ship
