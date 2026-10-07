# Changelog


## [2026-10-07]

### Added
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
- [Trading Indicator Library] 261-876_BE-IMPL-INDICATOR-LIB: computeStTriggerBands engine (body-based length-3 Donchian bands + long/short pullback, pullback-state and breakout flags) with 21 unit tests, SPY/AAPL real-data verify script (18/18) and TradingView export parity script (490 AAPL daily bars, bands + 4 flags identical)
- [Trading Indicator Library] 261-876_DOCS-INDICATOR-LIB: ST Trigger Bands PRD (approved, indicator-only) + BE/FE IMPL/TEST plans + #876 CODE-REVIEW (PASS) + #881 UAT (Complete)

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
