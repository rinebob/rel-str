# Verification Scripts

Permanent, on-demand scripts that verify BE pipeline stages against real behavior.
These are NOT part of the test suite — they are deliberate, manual invocations.

## Running

Run all verification scripts in order:
```
cd functions
npx tsx scripts/verify/run-all.ts
```

Run a single task's scripts:
```
cd functions
npx tsx scripts/verify/{script-name}.ts
```

## Index

| Task | Script | Pipeline stage | Guide |
|---|---|---|---|
| #257 | `strat-lib-257-compute.ts` | Return computation + metrics | [strat-lib-257.md](strat-lib-257.md) |
| #258 | `strat-lib-258-comparison.ts` | Script runner pipeline (Firestore → compute → JSON) | [strat-lib-258.md](strat-lib-258.md) |
| #268 | `indicator-lib-268-engine.ts` | Std Dev Lines engine (golden values + Firestore → compute → validate) | [indicator-lib-268.md](indicator-lib-268.md) |
| #876 | `indicator-lib-876-engine.ts` | ST Trigger Bands engine (Firestore bars -> compute -> reference parity + invariants) | [indicator-lib-876.md](indicator-lib-876.md) |
| #877 | `indicator-lib-877-callable.ts` | Trigger Bands in the indicator series (Firestore bars -> computeSymbolIndicatorSeries -> filterResponse, payload cost) | [indicator-lib-877.md](indicator-lib-877.md) |
| #561 | `paper-trading-ledger-561.ts` | fill → ledger → Firestore atomic write | [paper-trading-ledger-561.md](../../../scripts/verify/paper-trading-ledger-561.md) |
| #562 | `paper-trading-engine-migration-562.ts` | legacy options-strategy-* → `paper-trading/{anchor}/items` migration + P&L parity | [paper-trading-engine-migration-562.md](../../../scripts/verify/paper-trading-engine-migration-562.md) |
| #563 | `paper-trading-exit-eval-563.ts` | nightly variant eval → governing fill / mark-gap tolerance | [paper-trading-exit-eval-563.md](../../../scripts/verify/paper-trading-exit-eval-563.md) |
| #564 | `paper-trading-signal-order-564.ts` | signal-order → paperSignalOrder → noon fill pass (needs RH MCP OAuth) | [paper-trading-signal-order-564.md](../../../scripts/verify/paper-trading-signal-order-564.md) |
| #565 | `paper-trading-read-apis-565.ts` | generalized stats pass + read callables | [paper-trading-read-apis-565.md](../../../scripts/verify/paper-trading-read-apis-565.md) |
| #1562 | `paper-trading-stats-src-scopes-1562.ts` | stats pass `src-{source}` scope family — doc ids, canonical shape, src-* ⇄ all partition invariant (real pass, needs ADC) | inline usage in script header |
| #1563 | `paper-trading-stats-increments-1563.ts` | ledger stats-increment seam — real entry/exit/settle transitions move `stats-all`/`src-*` counters intraday; mints missing scope docs with all 8 counters; self-heals via recompute (seeds + deletes MANUAL trades, needs ADC) | inline usage in script header |
| #666 | `paper-trading-cancel-666.ts` | PENDING→CANCELLED txn seam + cancel guards | [paper-trading-cancel-666.md](../../../scripts/verify/paper-trading-cancel-666.md) |
| #667 | `paper-trading-close-667.ts` | OPEN→CLOSED at live RH quote (needs RH MCP OAuth) | [paper-trading-close-667.md](../../../scripts/verify/paper-trading-close-667.md) |
| #676 | `paper-trading-signal-marks-676.ts` | nightly marks on signal-source trades → governing stops evaluable | [paper-trading-signal-marks-676.md](../../../scripts/verify/paper-trading-signal-marks-676.md) |
| #720 | `paper-trading-signal-settlement-720.ts` | expired signal option legs settle — worthless / intrinsic | [paper-trading-signal-settlement-720.md](../../../scripts/verify/paper-trading-signal-settlement-720.md) |
| #983 | `paper-trading-eod-close-983.ts` | signal-trade marks[date] vs SDS official close (read-only drift report) | inline usage in script header |
| #983 | `sds-consumer-dispatch.ts` | replay the nightly settlement chain on demand — enqueues `{consumer, marketDate}` onto `sdsConsumerDispatch` (QA re-dispatch path; writes via the normal chain) | inline usage in script header |
| ~~#1000~~ | ~~`data-pipeline-st-signals-dual-write-1000.ts`~~ | retired at #1019 ship — legacy symbols parent archived + deleted | — |
| ~~#1001~~ | ~~`data-pipeline-st-signals-backfill-1001.ts`~~ | retired at #1019 ship — legacy symbols parent archived + deleted | — |
| #1002 | `data-pipeline-st-order-tickets-1002.ts` | st-order-tickets canonical-shape audit — id prefix vs mode, origin/state/terms axes, state↔field coherence (read-only, needs ADC) | inline usage in script header |
| ~~#1003~~ | ~~`data-pipeline-st-order-tickets-migration-1003.ts`~~ | retired in #1013 — legacy order-intents deleted | — |
| ~~#1006~~ | ~~`data-pipeline-st-strategy-instances-1006.ts`~~ | retired in #1013 — legacy anchors deleted | — |
| ~~#1007~~ | ~~`data-pipeline-collection-renames-1007.ts`~~ | retired in #1013 — renamed legacy roots deleted | — |
| ~~#1008~~ | ~~`data-pipeline-config-lists-1008.ts`~~ | retired in #1013 — legacy config/list roots deleted | — |
| ~~#1009~~ | ~~`data-pipeline-decisions-retirement-1009.ts`~~ | retired in #1013 — sweeper + collections deleted | — |
| #1010 | `data-pipeline-run-jobs-ttl-1010.ts` | st-run jobs TTL — sweeper export + per-run createdAt-predicate check + eligible/retained census by root + foreign census (read-only, needs ADC; backlog WARN expected until purge-st-run-jobs-1010 --apply) | inline usage in script header |
| ~~#1011~~ | ~~`data-pipeline-new-list-1011.ts`~~ | retired in #1013 — legacy list root deleted (dual-root census is single-root now) | — |
| #1013 | `data-pipeline-legacy-roots-1013.ts` | legacy-roots inventory + legacy⇄canonical parity before archive+delete — FAIL lists doc ids that would be lost (read-only, needs ADC) | inline usage in script header |
| ~~#1019~~ | ~~`data-pipeline-st-signals-readers-1019.ts`~~ | retired at #1019 ship — served its pre-delete gate; legacy symbols parent deleted | — |
| ~~#1159~~ | ~~`data-pipeline-st-runs-symbols-1159.ts`~~ | retired at #1019 ship — legacy runs + symbols parents deleted | — |
| ~~#1158~~ | ~~`data-pipeline-analysis-anchors-1158.ts`~~ | retired at #1158 ship — legacy analysis anchors archived + deleted | — |
| #1073 | `paper-trading-analysis-1073-contracts.ts` | analysis contracts — path helpers, manifest⇄schema bijection, dataset-index + slice doc round-trip on real Firestore (writes+deletes two verify-1073-* probe docs, needs ADC) | [paper-trading-analysis-1073.md](paper-trading-analysis-1073.md) |
| #1074 | `paper-trading-analysis-1074-csv-codec.ts` | CSV codec — serialize→parse round-trip on real live trades, manifest-order header, byte-identical determinism, no literal-marker cells (read-only) | [paper-trading-analysis-1074.md](paper-trading-analysis-1074.md) |
| #1076 | `paper-trading-analysis-1076-dataset-writer.ts` | dataset writer + callable — validation, generating→ready/failed index lifecycle on real Firestore, real GCS upload + byte readback, enqueue seam (writes+deletes verify-1076-* probes, needs ADC) | [paper-trading-analysis-1076.md](paper-trading-analysis-1076.md) |
| #1077 | `paper-trading-analysis-1077-live-snapshot.ts` | live snapshot dry-run — every trade → one row, cohort split, ind.*/strength.*/excursion sanity on real prod (read-only, no writes) | [paper-trading-analysis-1077.md](paper-trading-analysis-1077.md) |
| #1079 | `paper-trading-analysis-dataset.ts` | consolidated relay — live dry-run via the real pass (collector writeDataset) + AMAT replay parity vs checked-in prototype CSV on a frozen bar window + full-history baseline (read-only, needs ADC) | [paper-trading-analysis-dataset.md](paper-trading-analysis-dataset.md) |
| #724 | `paper-trading-engine-settlement-724.ts` | engine settlement retries missed nights + weekend-expiry walk-back | [paper-trading-engine-settlement-724.md](../../../scripts/verify/paper-trading-engine-settlement-724.md) |
| #1247 | `paper-trading-engine-open-1247.ts` | open-pass ladder — new leg per cadence despite prior opens; same-day idempotent; maxOpenPositions cap; canonical stats-all restored | [paper-trading-engine-open-1247.md](../../../scripts/verify/paper-trading-engine-open-1247.md) |
| #669 | `paper-trading-trade-exits-669.ts` | composed exit seam — prod seeding audit + governingVariant resolution + seed guards + cancel/close guards | [paper-trading-trade-exits-669.md](../../../scripts/verify/paper-trading-trade-exits-669.md) |
| #766 | `screenshot-capture-766-render.ts` | render model → SVG (fixture render + structural checks + browser artifact) | [screenshot-capture-766.md](screenshot-capture-766.md) |
| #767 | `screenshot-capture-767-assemble.ts` | symbol-data bars → indicator series → render model → SVG (real-data end-to-end) | [screenshot-capture-767.md](screenshot-capture-767.md) |
| #768 | `screenshot-capture-768-callable.ts` | callable handler → assemble → render → real bucket write + error contract | [screenshot-capture-768.md](screenshot-capture-768.md) |
| #769 | `screenshot-capture-769-rasterize.ts` | PNG sibling per SVG — resvg rasterize → bucket PNG (signature/dims/contentType) | [screenshot-capture-769.md](screenshot-capture-769.md) |
| #844 | `screenshot-capture-844-contracts.ts` | `groupId` → `{symbol}/{group}/` path level + strategy `positionType` tags → real bucket write | [screenshot-capture-844.md](screenshot-capture-844.md) |
| #848 | `screenshot-capture-826-lifecycle.ts` | lifecycle intake end-to-end — seeded carrier → capture → `capturedEvents` manifest + `st-screenshots` index → dedup no-op | [screenshot-capture-826.md](screenshot-capture-826.md) |
| #1141 | `rh-scanner-recipes-1098.ts` | every SCANNER_RECIPES recipe → live `preview_scan` — result/row-shape tripwire + column-key coverage WARN (read-only, needs local RH MCP session) | inline usage in script header |
| #1430 | `options-replay-single-symbol-1430.ts` | single-symbol run model audit — runs (scalar symbol, no counters), list keyed at docId == runId, results keyed `{runId}_{exitId}`; legacy multi-symbol docs WARN as migration candidates (read-only, needs ADC) | [options-backtest-selection-replay-1430-single-symbol.md](../../../scripts/verify/options-backtest-selection-replay-1430-single-symbol.md) |
| #1437 | `options-auth-guard-1437.ts` | auth-boundary probe — anonymous/garbage-token → 401 UNAUTHENTICATED, minted token → INVALID_ARGUMENT; all four options callables (post-#1437 deploy) | [options-auth-guard-1437.md](options-auth-guard-1437.md) |
| #1444 | `st-auth-guard-1444.ts` | auth-boundary probe — anonymous/garbage-token → 401 UNAUTHENTICATED, minted token → per-callable expectation; all five st-cloud-function callables (post-#1444 deploy) | [st-auth-guard-1444.md](st-auth-guard-1444.md) |
| #1401 | `pick-doc-404-semantics-1401.ts` | pick-doc 404 semantics vs live SA — happy path, shard-gap `NOT_FOUND` skip, bogus-endpoint infra-404 propagation (read-only, needs impersonation/ADC) | [pick-doc-404-semantics-1401.md](pick-doc-404-semantics-1401.md) |
| #878 | `indicator-lib-878-pine-parity.ts` | static audit — rb-st-trigger-bands.pine cleanup (no cruft) + engine-parity contract (gated arming, breakout-only envelope dots); read-only, no env | [indicator-lib-878-pine-parity.md](indicator-lib-878-pine-parity.md) |
| #873 | `indicator-lib-873-pine-parity.ts` | static audit — rb-st-anchored-vwap.pine causal contract (draw-from-trigger, scan-back, supersession reconciliation, budgets, fix-set pins); read-only, no env | [indicator-lib-873-pine-parity.md](indicator-lib-873-pine-parity.md) |
| #1431 | `options-analysis-all-otm-1431.ts` | expired-fields probe — intrinsic↔ITM invariant per record, ITM/OTM census per doc, nearest-the-money recompute vs the worker's underlying-close source (read-only, needs ADC) | inline usage in script header |
| #1491 | `options-replay-leg-contracts-1491.ts` | run-doc `getRun` inputs (templateId/startDate on every run) + `legToPickDocCoordinate` registry parity + persisted `pickDocMeta.coordinate` chain (read-only, needs ADC) | [options-replay-leg-contracts-1491.md](options-replay-leg-contracts-1491.md) |
| #1492 | `options-replay-template-registries-1492.ts` | two-registry audit — shape structure/bands on-grid + unique ids + migration parity (4 legacy verbatim) + every prod run's templateId resolves via `getReplayTemplate` and `getReplayVariant` (read-only, needs ADC) | [options-replay-template-registries-1492.md](options-replay-template-registries-1492.md) |
| #1493 | `options-replay-position-rows-1493.ts` | v1→v2 narrowing audit — every prod list doc's pick rows narrow field-for-field to position legs via `v1ListDocToV2`; markers gain `legMisses`; `repeatsPrevious` normalized across gaps (read-only, needs ADC) | [options-replay-position-rows-1493.md](options-replay-position-rows-1493.md) |
| #1498 | `options-replay-start-forms-1498.ts` | `startReplay` three-form resolution + `variantSnapshot` stamping + rejection matrix — DRY stage is fake-deps/no-credentials (run-all safe); `--live` submits real runs via prodDeps (needs ADC + `GOOGLE_CLOUD_PROJECT=rel-str`) | [options-replay-start-forms-1498.md](options-replay-start-forms-1498.md) |
| #1499 | `options-replay-worker-1499.ts` | `runReplayPermutation` multi-leg data path — snapshot → per-leg pick-doc fetch → atomic position rows → `schemaVersion:2` + `legMetas[]` (DRY fake-deps, run-all safe); `--live` real SA fetch + Firestore writes via prodDeps | [options-replay-worker-1499.md](options-replay-worker-1499.md) |
| #1500 | `options-analysis-position-1500.ts` | `runReplayAnalysis` leg-aware path — v1→v2 narrowing → per-leg series fetch → signed net series (freeze, nearest-living dte, stock legs) → position records (DRY fake-deps, run-all safe); `--live` real SA fetch + Firestore writes via prodDeps | [options-analysis-position-1500.md](options-analysis-position-1500.md) |
| #1501 | `options-engine-eod-selection-1501.ts` | `runEodSelectionPass` on the shared coordinate selector — signed-delta argmin in nearest-DTE expiry, no-contract/tolerance → null, malformed-candidate rejection, quote mapping, concrete-dte id segments (DRY fake-chain, run-all safe); `--live` real SPY chain fetch + real instance doc validate/normalize | [options-engine-eod-selection-1501.md](options-engine-eod-selection-1501.md) |
| #1502 | `options-engine-expression-fill-1502.ts` | `runExpressionFillPass` on the shared coordinate selector — nearest-DTE expiration (no band), signed-delta argmin, fill = RH quote mark, unpriceable pick → no_contract skip, empty-chain skip (DRY fake-chain, run-all safe); `--live` real SPY chain via KMS session + pass≡selector parity | [options-engine-expression-fill-1502.md](options-engine-expression-fill-1502.md) |
| #1503 | `options-simulator-deprecation-1503.ts` | legacy simulator deprecation — superseded marker (Selection Replay + Backtest Analytics, #1240/#1266/#1270; retained, do not extend) on runBacktestSimulation + stBacktestPermutation callable; callers/signature/re-export intact (static source assertions, no env) | [options-simulator-deprecation-1503.md](options-simulator-deprecation-1503.md) |
| #1573 | `paper-trading-curated-contracts-1573.ts` | curated-trade contract surface — variant set + policy marker + SDS_BARS + batch bounds + live⇄mint id determinism + dedupe⇄occurrence layout trap (read-only, no env) | [paper-trading-curated-contracts-1573.md](paper-trading-curated-contracts-1573.md) |
| #1574 | `paper-trading-curated-exit-engine-1574.ts` | curated exit engine — ma-close/target grammar + evaluators + variantLevel + independent closers + selectGoverningRun policy + smaAt (read-only, no env) | [paper-trading-curated-exit-engine-1574.md](paper-trading-curated-exit-engine-1574.md) |
| #1575 | `paper-trading-backfill-signal-trade-1575.ts` | curated signal mint — deterministic sig-origin ids + SDS_BARS entry + one-commit backfill + ledger close + dedupe + callable auth/cap (fixture mint through the real ledger, no env) | [paper-trading-backfill-signal-trade-1575.md](paper-trading-backfill-signal-trade-1575.md) |
| #1576 | `paper-trading-ledger-ops-1576.ts` | ledger ops — deleteTradeCascade (trade+rq+pap_* gone, signal-scoped, idempotent) + deletePaperTrades buckets + ingest curated dims + SECONDARY admit (fixture through real seam/pass, no env) | [paper-trading-ledger-ops-1576.md](paper-trading-ledger-ops-1576.md) |
| #1649 | `paper-trading-signal-review-contracts-1649.ts` | signal-review contract surface — signalReview doc id + pick mapper literal + occurrence-id layout + dedupe⇄occurrence non-interchangeability (read-only, no env) | [paper-trading-signal-review-contracts-1649.md](paper-trading-signal-review-contracts-1649.md) |
| #1650 | `paper-trading-signal-review-callables-1650.ts` | signal-review callables — bundle mapping/dedupe-join/stamp semantics + queue union/ownerUid (DRY fixture deps; `--live` prod deps + real Firestore stamp) | [paper-trading-signal-review-callables-1650.md](paper-trading-signal-review-callables-1650.md) |
| #1651 | `paper-trading-groom-legacy-trades-1651.ts` | legacy signal-trade wipe — census classification (cohort/group/ticket skipped), dry no-delete, apply batching, idempotent re-run (DRY fixture deps; `--live` real census, `--apply` the real wipe + zero-eligible post-check) | [paper-trading-groom-legacy-trades-1651.md](paper-trading-groom-legacy-trades-1651.md) |
| #1658 | `rh-mcp-refresh-lease-1658.ts` | refresh-lease port on real Firestore — acquire/deny/release + holder fencing + expired-TTL takeover + currentRevision on the real doc; scratch lease doc, credential doc untouched (needs ADC, no KMS key) | [rh-mcp-refresh-lease-1658.md](rh-mcp-refresh-lease-1658.md) |
| #1675 | `indicator-lib-ibs-1675.ts` | IBS contract surface — `@st/ibs` alias resolution, IBS formula/degenerate-range literals, daily ET-time + weekly weekday availability (injected `now`), real wall-clock agreement (no ctx) | [indicator-lib-ibs-1675.md](indicator-lib-ibs-1675.md) |
| #1678 | `ibs-trend-rider-filter-1678.ts` | IBS gate on real symbol-data bars — candidates vs emitted vs suppressed per V1/V2 × D/W, bound/subset/recorded-ibs invariants, `--symbol`/`--threshold` args (needs ADC, read-only) | [ibs-trend-rider-filter-1678.md](ibs-trend-rider-filter-1678.md) |

## Order across tasks

1. **#257** — `strat-lib-257-compute.ts` (return computation module)
2. **#258** — `strat-lib-258-comparison.ts` (script runner pipeline)
3. **#268** — `indicator-lib-268-engine.ts` (std dev lines engine)
4. **#561** — `paper-trading-ledger-561.ts` (ledger writes)
5. **#562** — `paper-trading-engine-migration-562.ts` (migration parity)
6. **#563** — `paper-trading-exit-eval-563.ts` (variant eval)
7. **#564** — `paper-trading-signal-order-564.ts` (signal→paper entry)
8. **#565** — `paper-trading-read-apis-565.ts` (stats + read APIs)
8b. **#1562** — `paper-trading-stats-src-scopes-1562.ts` (stats `src-*` scope family)
8c. **#1563** — `paper-trading-stats-increments-1563.ts` (ledger stats-increment seam — seeds/destroys MANUAL trades; run alone, not in parallel)
9. **#666** — `paper-trading-cancel-666.ts` (cancel seam)
10. **#667** — `paper-trading-close-667.ts` (live-quote close)
11. **#676** — `paper-trading-signal-marks-676.ts` (signal-trade marks)
12. **#720** — `paper-trading-signal-settlement-720.ts` (signal-trade settlement)
13. **#724** — `paper-trading-engine-settlement-724.ts` (engine missed-night + weekend-expiry parity)
13b. **#983** — `paper-trading-eod-close-983.ts` (post-nightly: marks = official close)
13c. **#1247** — `paper-trading-engine-open-1247.ts` (open-pass ladder cadence + cap)
14. **#669** — `paper-trading-trade-exits-669.ts` (composed exit seam + prod audit)
15. **#766** — `screenshot-capture-766-render.ts` (render model → SVG)
16. **#767** — `screenshot-capture-767-assemble.ts` (data assembly → model → SVG)
17. **#768** — `screenshot-capture-768-callable.ts` (callable → bucket write + error contract)
18. **#769** — `screenshot-capture-769-rasterize.ts` (PNG rasterization → bucket sibling)
19. **#844** — `screenshot-capture-844-contracts.ts` (grouped path + position types → bucket write)
20. **#848** — `screenshot-capture-826-lifecycle.ts` (lifecycle intake: carrier ledger + index + dedup, real Firestore + bucket)
21. **#876** — `indicator-lib-876-engine.ts` (trigger bands engine)
22. **#877** — `indicator-lib-877-callable.ts` (trigger bands in the indicator series)
25. **#1002** — `data-pipeline-st-order-tickets-1002.ts` (st-order-tickets canonical-shape audit; empty until post-deploy emission)
28. **#1073** — `paper-trading-analysis-1073-contracts.ts` (analysis contracts: anchor paths, manifest⇄schema, dataset + slice round-trip; writes then deletes verify-1073-* probes)
29. **#1074** — `paper-trading-analysis-1074-csv-codec.ts` (CSV codec: serialize→parse round-trip + determinism on real trades; read-only)
30. **#1076** — `paper-trading-analysis-1076-dataset-writer.ts` (writer + callable: validation, index-doc lifecycle, real GCS upload; enqueue check skips until functions deploy)
31. **#1077** — `paper-trading-analysis-1077-live-snapshot.ts` (live snapshot dry-run: row-per-trade, cohorts, ind.*/strength.*/excursion on real prod; read-only)
32. **#1079** — `paper-trading-analysis-dataset.ts` (consolidated relay: real-pass live dry-run + AMAT replay parity vs prototype CSV on frozen window; read-only — until the #1007 migration runs, its live leg reads the legacy trades path with a warn)
37. **#1010** — `data-pipeline-run-jobs-ttl-1010.ts` (st-run jobs TTL census + sweeper/core audit; meaningful after the `cleanupStRunJobs` deploy; backlog WARN clears after `purge-st-run-jobs-1010.ts --apply`)
40. **#1141** — `rh-scanner-recipes-1098.ts` (every catalog recipe → live preview_scan: success + result/row shape, column-key WARN; needs local RH MCP session like 564/667 — fails without a token, that's env not script)
41. **#1430** — `options-replay-single-symbol-1430.ts` (single-symbol run model audit across the three st-options collections; meaningful after a post-deploy submission — empty runs report EMPTY and pass; legacy multi-symbol docs WARN until the migration deletes them)
42. **#1437** — `options-auth-guard-1437.ts` (live auth-boundary probe on the four options callables; FAILs until the #1437 deploy lands — run post-deploy, needs service-account impersonation for token mint)
43. **#1444** — `st-auth-guard-1444.ts` (live auth-boundary probe on the five st-cloud-function callables; FAILs until the #1444 deploy lands — authed leg enqueues one harmless bogus-symbol overview task)
44. **#1401** — `pick-doc-404-semantics-1401.ts` (pick-doc 404 semantics vs live SA endpoint: `NOT_FOUND` shard skip + infra-404 propagation; ~1 min, read-only GETs, needs impersonation)
45. **#878** — `indicator-lib-878-pine-parity.ts` (static audit of the Trigger Bands Pine export — cleanup + engine-parity contract; instant, read-only, no env)
46. **#873** — `indicator-lib-873-pine-parity.ts` (static audit of the Anchored VWAP Pine export — causal contract + supersession reconciliation + budgets; instant, read-only, no env)
47. **#1431** — `options-analysis-all-otm-1431.ts` (expired-fields correctness vs live result docs: record-level intrinsic↔ITM invariant, per-doc ITM/OTM census, nearest-the-money spot recompute against `getCachedBarsFromSymbolData`; read-only, needs ADC)
48. **#1491** — `options-replay-leg-contracts-1491.ts` (post-payload-shrink audit: every run doc carries the worker's `getRun` fields; `legToPickDocCoordinate` reproduces each registry coordinate and the persisted `pickDocMeta.coordinate`; read-only, needs ADC)
49. **#1492** — `options-replay-template-registries-1492.ts` (post-two-registry audit: every shape's bands land on the pick-doc grid and ids are unique; the four legacy templates migrate verbatim — name/side/coordinate; every prod run's `templateId` resolves via both the legacy and variant surfaces; read-only, needs ADC)
50. **#1493** — `options-replay-position-rows-1493.ts` (post-v2-schema audit: every prod list doc narrows through `v1ListDocToV2` — pick rows → position legs field-for-field with the recorded coordinate stamped, markers gain `legMisses`, `repeatsPrevious` normalized so gaps/first rows can't repeat; read-only, needs ADC)
51. **#1573** — `paper-trading-curated-contracts-1573.ts` (curated-trade contract surface: variant set + policy marker + SDS_BARS + batch bounds + live⇄mint id determinism; instant, read-only, no env)
52. **#1574** — `paper-trading-curated-exit-engine-1574.ts` (curated exit engine: ma-close/target grammar + evaluators + variantLevel + closer classification + deepest-stop policy + smaAt; instant, read-only, no env)
53. **#1575** — `paper-trading-backfill-signal-trade-1575.ts` (curated signal mint: deterministic ids + SDS_BARS provenance + in-memory variant walk + one-commit marks/runs + ledger close + dedupe; fixture mint through the real ledger, no env)
54. **#1576** — `paper-trading-ledger-ops-1576.ts` (ledger ops: signal-scoped delete cascade — trade + rq-* + pap_* gone, idempotent notFound — + deletePaperTrades per-item buckets + ingest curated dims + SECONDARY admit; fixture through real seam/pass, no env)
55. **#1498** — `options-replay-start-forms-1498.ts` (startReplay three-form resolution + snapshot stamping + rejection matrix; DRY default is fake-deps/no-credentials; `--live` submits real runs — needs ADC + GOOGLE_CLOUD_PROJECT)
56. **#1499** — `options-replay-worker-1499.ts` (multi-leg worker: snapshot legs → per-leg bounded fetch → atomic position-row join → v2 doc + legMetas + close-out; DRY default is fake-deps/no-credentials; `--live` writes real run docs and runs the worker data path — needs ADC + GOOGLE_CLOUD_PROJECT)
57. **#1500** — `options-analysis-position-1500.ts` (leg-aware analyzer: v1→v2 narrowing → per-leg series fetch → signed net cost-to-close series (settlement freeze, nearest-living dte, stock legs) → position records; DRY default is fake-deps/no-credentials; `--live` analyzes a real verify-1499 list doc — needs ADC + GOOGLE_CLOUD_PROJECT)
58. **#1501** — `options-engine-eod-selection-1501.ts` (engine EOD selection on the shared coordinate selector: signed-delta argmin in the nearest-DTE expiration, no-contract → null, deltaTolerance post-check, malformed candidates ignored, quote mapping, concrete-dte id segments; DRY default is fake-chain/no-credentials; `--live` fetches a real SPY chain + validates a real instance doc — needs ADC + GOOGLE_CLOUD_PROJECT)
59. **#1502** — `options-engine-expression-fill-1502.ts` (expression-fill-pass on the shared coordinate selector: nearest-to-targetDte expirations replace the DTE band, signed argmin over RH quote deltas, fill price = RH quote mark, unpriceable pick → no_contract, empty chain → skip; DRY default is fake-chain/no-credentials; `--live` fetches a real SPY chain through the prod KMS session and asserts the pass mints exactly the contract the raw selector picks — needs ADC + RH_CREDENTIAL_KEY_NAME)
60. **#1649** — `paper-trading-signal-review-contracts-1649.ts` (signal-review contract surface: signalReview doc id + pick-mapper literal + occurrence-id layout + dedupe⇄occurrence non-interchangeability; instant, read-only, no env)
61. **#1503** — `options-simulator-deprecation-1503.ts` (legacy simulator deprecation note: @deprecated marker on runBacktestSimulation + stBacktestPermutation naming Selection Replay + Backtest Analytics / #1240/#1266/#1270 + retained-do-not-extend policy; worker import/invoke, signature head, and index.ts re-export pinned unchanged; static source assertions, no env)
62. **#1650** — `paper-trading-signal-review-callables-1650.ts` (signal-review callables: bundle occurrence mapping + signalDedupeKey join incl. swapped-layout/accept-flow non-match pins + read-then-stamp semantics + error mapping; queue PRIMARY ∪ SECONDARY dedupe + merges + missing-ownerUid failed-precondition; DRY fixture deps, `--live` prod deps + real Firestore — needs ADC)
63. **#1658** — `rh-mcp-refresh-lease-1658.ts` (refresh-lease port: acquire/deny/release + holder fencing + expired-TTL takeover + currentRevision on the real bundle doc; scratch lease doc — needs ADC, no KMS key)
64. **#1675** — `indicator-lib-ibs-1675.ts` (IBS contract surface: `@st/ibs` alias + formula/degenerate literals + D/W availability with injected `now` + real wall-clock agreement; instant, read-only, no env)
65. **#1651** — `paper-trading-groom-legacy-trades-1651.ts` (legacy signal-trade wipe: census split — marker-carrying trades skipped, dry no-delete, apply batching + idempotent re-run; DRY fixture deps — `--live` real census needs ADC, `--live --apply` performs the real wipe)
66. **#1678** — `ibs-trend-rider-filter-1678.ts` (IBS gate empirical check on real `symbol-data` bars: production zone chain → unfiltered vs gated detection; per-cell emitted/suppressed table + bound/subset/recorded-ibs invariants; needs ADC, read-only)

<!-- #1661 — purge-legacy-cohorts-1661.ts is a destructive one-shot (drains
paper-trading/cohorts, backfills trade.positionGroupId) — dry-run by default,
--apply gated on the repoint deploy. Kept out of run-all like #1566's purge. -->
<!-- #1013 retired the #1003/#1006/#1007/#1008/#1009/#1011 migration-parity relays and their
target scripts (migrate-*, sweep-unlisted-to-new, qa-probe-1008) — the legacy roots they
verified against were deleted. Replacement: `verify/data-pipeline-legacy-roots-1013.ts`
(pre-delete inventory/parity) + `scripts/archive-legacy-roots-1013.ts` (archive+delete ops,
dry-run default). -->

<!-- #1566 — `scripts/purge-legacy-stats-docs-1566.ts` (one-shot ops; dry-run
default lists candidates, `--apply` deletes + post-verify) removes stale
legacy stats docs (stats-ALL + stats-{unprefixed-instanceId}) from
st-paper-trading/stats/items so listStats stops surfacing ghost scopes.
Run --apply ONLY after the #1565 deploy removes the legacy readers.
Same task repointed paper-trading-read-apis-565.ts's trade/stats/account
refs to stPaperTradingDocPath — its legacy paper-trading/* literals made
every check fail against the dead root post-#1007 (now 20/20 on prod). -->

<!-- #1019 ship retired the #1000/#1001/#1019/#1159 parity relays — their legacy evidence
(savant-trader/data/symbols incl. run-ids + signal-history) was archived to
functions/scripts/output/legacy-archive-1013/savant-trader-symbols.json and deleted.
Scripts kept on disk for reference; unregistered from run-all. -->
