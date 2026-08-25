# Changelog

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
