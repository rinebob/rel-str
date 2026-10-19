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
| #666 | `paper-trading-cancel-666.ts` | PENDING→CANCELLED txn seam + cancel guards | [paper-trading-cancel-666.md](../../../scripts/verify/paper-trading-cancel-666.md) |
| #667 | `paper-trading-close-667.ts` | OPEN→CLOSED at live RH quote (needs RH MCP OAuth) | [paper-trading-close-667.md](../../../scripts/verify/paper-trading-close-667.md) |
| #676 | `paper-trading-signal-marks-676.ts` | nightly marks on signal-source trades → governing stops evaluable | [paper-trading-signal-marks-676.md](../../../scripts/verify/paper-trading-signal-marks-676.md) |
| #720 | `paper-trading-signal-settlement-720.ts` | expired signal option legs settle — worthless / intrinsic | [paper-trading-signal-settlement-720.md](../../../scripts/verify/paper-trading-signal-settlement-720.md) |
| #983 | `paper-trading-eod-close-983.ts` | signal-trade marks[date] vs SDS official close (read-only drift report) | inline usage in script header |
| #983 | `sds-consumer-dispatch.ts` | replay the nightly settlement chain on demand — enqueues `{consumer, marketDate}` onto `sdsConsumerDispatch` (QA re-dispatch path; writes via the normal chain) | inline usage in script header |
| #1000 | `data-pipeline-st-signals-dual-write-1000.ts` | st-signals ⇄ run-ids dual-write parity for a marketDate — expected occurrences, runIds union, status/direction, create-only provenance (read-only, needs ADC) | inline usage in script header |
| #1001 | `data-pipeline-st-signals-backfill-1001.ts` | st-signals ⇄ legacy (signal-history + run-ids) backfill parity across ALL dates — missing/extra/mismatch per symbol (read-only, needs ADC) | inline usage in script header |
| #1002 | `data-pipeline-st-order-tickets-1002.ts` | st-order-tickets canonical-shape audit — id prefix vs mode, origin/state/terms axes, state↔field coherence (read-only, needs ADC) | inline usage in script header |
| #1003 | `data-pipeline-st-order-tickets-migration-1003.ts` | order-intents ⇄ st-order-tickets parity — counterpart exists per mappable legacy doc, refId/origin/state/terms/tracking preserved (read-only, needs ADC) | inline usage in script header |
| #1004 | `data-pipeline-st-position-groups-1004.ts` | st-position-groups canonical-shape audit + cohorts ⇄ groups parity + bidirectional member back-stamps (read-only, needs ADC) | inline usage in script header |
| #1006 | `data-pipeline-st-strategy-instances-1006.ts` | st-strategy-instances canonical-shape audit + legacy ⇄ canonical parity + daily-analysis carry-over + repo union-read seam (read-only, needs ADC) | [data-pipeline-st-strategy-instances-1006.md](data-pipeline-st-strategy-instances-1006.md) |
| #1007 | `data-pipeline-collection-renames-1007.ts` | st-paper-trading/st-portfolio/st-backtest-* ⇄ legacy parity — soak-direction-aware severity (cutover FAIL on divergence; mirrored families WARN) (read-only, needs ADC) | inline usage in script header |
| #1073 | `paper-trading-analysis-1073-contracts.ts` | analysis contracts — path helpers, manifest⇄schema bijection, dataset-index + slice doc round-trip on real Firestore (writes+deletes two verify-1073-* probe docs, needs ADC) | [paper-trading-analysis-1073.md](paper-trading-analysis-1073.md) |
| #1074 | `paper-trading-analysis-1074-csv-codec.ts` | CSV codec — serialize→parse round-trip on real live trades, manifest-order header, byte-identical determinism, no literal-marker cells (read-only) | [paper-trading-analysis-1074.md](paper-trading-analysis-1074.md) |
| #1076 | `paper-trading-analysis-1076-dataset-writer.ts` | dataset writer + callable — validation, generating→ready/failed index lifecycle on real Firestore, real GCS upload + byte readback, enqueue seam (writes+deletes verify-1076-* probes, needs ADC) | [paper-trading-analysis-1076.md](paper-trading-analysis-1076.md) |
| #1077 | `paper-trading-analysis-1077-live-snapshot.ts` | live snapshot dry-run — every trade → one row, cohort split, ind.*/strength.*/excursion sanity on real prod (read-only, no writes) | [paper-trading-analysis-1077.md](paper-trading-analysis-1077.md) |
| #1079 | `paper-trading-analysis-dataset.ts` | consolidated relay — live dry-run via the real pass (collector writeDataset) + AMAT replay parity vs checked-in prototype CSV on a frozen bar window + full-history baseline (read-only, needs ADC) | [paper-trading-analysis-dataset.md](paper-trading-analysis-dataset.md) |
| #724 | `paper-trading-engine-settlement-724.ts` | engine settlement retries missed nights + weekend-expiry walk-back | [paper-trading-engine-settlement-724.md](../../../scripts/verify/paper-trading-engine-settlement-724.md) |
| #669 | `paper-trading-trade-exits-669.ts` | composed exit seam — prod seeding audit + governingVariant resolution + seed guards + cancel/close guards | [paper-trading-trade-exits-669.md](../../../scripts/verify/paper-trading-trade-exits-669.md) |
| #766 | `screenshot-capture-766-render.ts` | render model → SVG (fixture render + structural checks + browser artifact) | [screenshot-capture-766.md](screenshot-capture-766.md) |
| #767 | `screenshot-capture-767-assemble.ts` | symbol-data bars → indicator series → render model → SVG (real-data end-to-end) | [screenshot-capture-767.md](screenshot-capture-767.md) |
| #768 | `screenshot-capture-768-callable.ts` | callable handler → assemble → render → real bucket write + error contract | [screenshot-capture-768.md](screenshot-capture-768.md) |
| #769 | `screenshot-capture-769-rasterize.ts` | PNG sibling per SVG — resvg rasterize → bucket PNG (signature/dims/contentType) | [screenshot-capture-769.md](screenshot-capture-769.md) |
| #844 | `screenshot-capture-844-contracts.ts` | `groupId` → `{symbol}/{group}/` path level + strategy `positionType` tags → real bucket write | [screenshot-capture-844.md](screenshot-capture-844.md) |
| #848 | `screenshot-capture-826-lifecycle.ts` | lifecycle intake end-to-end — seeded carrier → capture → `capturedEvents` manifest + `st-screenshots` index → dedup no-op | [screenshot-capture-826.md](screenshot-capture-826.md) |

## Order across tasks

1. **#257** — `strat-lib-257-compute.ts` (return computation module)
2. **#258** — `strat-lib-258-comparison.ts` (script runner pipeline)
3. **#268** — `indicator-lib-268-engine.ts` (std dev lines engine)
4. **#561** — `paper-trading-ledger-561.ts` (ledger writes)
5. **#562** — `paper-trading-engine-migration-562.ts` (migration parity)
6. **#563** — `paper-trading-exit-eval-563.ts` (variant eval)
7. **#564** — `paper-trading-signal-order-564.ts` (signal→paper entry)
8. **#565** — `paper-trading-read-apis-565.ts` (stats + read APIs)
9. **#666** — `paper-trading-cancel-666.ts` (cancel seam)
10. **#667** — `paper-trading-close-667.ts` (live-quote close)
11. **#676** — `paper-trading-signal-marks-676.ts` (signal-trade marks)
12. **#720** — `paper-trading-signal-settlement-720.ts` (signal-trade settlement)
13. **#724** — `paper-trading-engine-settlement-724.ts` (engine missed-night + weekend-expiry parity)
13b. **#983** — `paper-trading-eod-close-983.ts` (post-nightly: marks = official close)
14. **#669** — `paper-trading-trade-exits-669.ts` (composed exit seam + prod audit)
15. **#766** — `screenshot-capture-766-render.ts` (render model → SVG)
16. **#767** — `screenshot-capture-767-assemble.ts` (data assembly → model → SVG)
17. **#768** — `screenshot-capture-768-callable.ts` (callable → bucket write + error contract)
18. **#769** — `screenshot-capture-769-rasterize.ts` (PNG rasterization → bucket sibling)
19. **#844** — `screenshot-capture-844-contracts.ts` (grouped path + position types → bucket write)
20. **#848** — `screenshot-capture-826-lifecycle.ts` (lifecycle intake: carrier ledger + index + dedup, real Firestore + bucket)
21. **#876** — `indicator-lib-876-engine.ts` (trigger bands engine)
22. **#877** — `indicator-lib-877-callable.ts` (trigger bands in the indicator series)
23. **#1000** — `data-pipeline-st-signals-dual-write-1000.ts` (st-signals ⇄ run-ids dual-write parity for a marketDate)
24. **#1001** — `data-pipeline-st-signals-backfill-1001.ts` (st-signals ⇄ legacy backfill parity across all dates; run after `backfill-st-signals-1001.ts`)
25. **#1002** — `data-pipeline-st-order-tickets-1002.ts` (st-order-tickets canonical-shape audit; empty until post-deploy emission)
26. **#1003** — `data-pipeline-st-order-tickets-migration-1003.ts` (order-intents ⇄ canonical parity; run after `migrate-order-intents-1003.ts --apply` + during the mirror soak)
27. **#1004** — `data-pipeline-st-position-groups-1004.ts` (st-position-groups shape + cohorts ⇄ groups parity + member back-stamps; run after `migrate-cohorts-1004.ts --apply` and after a post-deploy `paperSignalOrder` accept — verify-564 covers the live accept path)
28. **#1073** — `paper-trading-analysis-1073-contracts.ts` (analysis contracts: anchor paths, manifest⇄schema, dataset + slice round-trip; writes then deletes verify-1073-* probes)
29. **#1074** — `paper-trading-analysis-1074-csv-codec.ts` (CSV codec: serialize→parse round-trip + determinism on real trades; read-only)
30. **#1076** — `paper-trading-analysis-1076-dataset-writer.ts` (writer + callable: validation, index-doc lifecycle, real GCS upload; enqueue check skips until functions deploy)
31. **#1077** — `paper-trading-analysis-1077-live-snapshot.ts` (live snapshot dry-run: row-per-trade, cohorts, ind.*/strength.*/excursion on real prod; read-only)
32. **#1079** — `paper-trading-analysis-dataset.ts` (consolidated relay: real-pass live dry-run + AMAT replay parity vs prototype CSV on frozen window; read-only — until the #1007 migration runs, its live leg reads the legacy trades path with a warn)
33. **#1006** — `data-pipeline-st-strategy-instances-1006.ts` (st-strategy-instances shape + parity + daily-analysis carry-over + repo seam; run after `migrate-strategy-instances-1006.ts --apply` and the re-pointed deploy)
34. **#1007** — `data-pipeline-collection-renames-1007.ts` (per-family legacy ⇄ canonical parity; run after `migrate-collection-renames-1007.ts --apply` and the mirror-trigger deploy)
