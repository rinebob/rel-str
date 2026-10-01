# Changelog


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

### Changed
- [Trading Workflows] 625-699_FE-IMPL-WORKFLOWS: Canonical route tree — AppRoutes renamed to domain-prefixed paths (portfolio, signals/runs|review|charts, trading/live|paper, options/*, analysis/swings, tools/account, dev/flex-chart); '/'→/portfolio landing + /signals & /options parent redirects; post-login lands on /portfolio; literal nav sweep + route-table spec (66 assertions)
- [Trading Workflows] 625-699_DOCS-WORKFLOWS: Journey navigation PRD + impl/test plans + code review (PASS) + UAT (Complete) for #699

### Removed
- [Signal Pipeline Maintenance] 433-705_FE-IMPL-SIGNAL-REVIEW: Order queue cleanup — Paper status group + PAPER badge and SIG/POS/MAN source chips removed; selection clamps to next row after accept-as-paper
- [Signal Pipeline Maintenance] 433-705_DOCS-SIGNAL-REVIEW: Inventory promotion + code review (PASS) + UAT (Complete) for #705


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
- [Option Chain Pct Change Grid] 326-421_FE-IMPL-OPTIONS: Review fixes � shared signal cache, stale-fetch cancellation, lifecycle guards (checkpoint)
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
