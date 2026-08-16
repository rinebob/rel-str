# Changelog

## [2026-08-16]

### Added
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
