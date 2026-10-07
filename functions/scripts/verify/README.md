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
| #561 | `paper-trading-ledger-561.ts` | fill → ledger → Firestore atomic write | [paper-trading-ledger-561.md](../../../scripts/verify/paper-trading-ledger-561.md) |
| #562 | `paper-trading-engine-migration-562.ts` | legacy options-strategy-* → `paper-trading/{anchor}/items` migration + P&L parity | [paper-trading-engine-migration-562.md](../../../scripts/verify/paper-trading-engine-migration-562.md) |
| #563 | `paper-trading-exit-eval-563.ts` | nightly variant eval → governing fill / mark-gap tolerance | [paper-trading-exit-eval-563.md](../../../scripts/verify/paper-trading-exit-eval-563.md) |
| #564 | `paper-trading-signal-order-564.ts` | signal-order → paperSignalOrder → noon fill pass (needs RH MCP OAuth) | [paper-trading-signal-order-564.md](../../../scripts/verify/paper-trading-signal-order-564.md) |
| #565 | `paper-trading-read-apis-565.ts` | generalized stats pass + read callables | [paper-trading-read-apis-565.md](../../../scripts/verify/paper-trading-read-apis-565.md) |
| #666 | `paper-trading-cancel-666.ts` | PENDING→CANCELLED txn seam + cancel guards | [paper-trading-cancel-666.md](../../../scripts/verify/paper-trading-cancel-666.md) |
| #667 | `paper-trading-close-667.ts` | OPEN→CLOSED at live RH quote (needs RH MCP OAuth) | [paper-trading-close-667.md](../../../scripts/verify/paper-trading-close-667.md) |
| #676 | `paper-trading-signal-marks-676.ts` | nightly marks on signal-source trades → governing stops evaluable | [paper-trading-signal-marks-676.md](../../../scripts/verify/paper-trading-signal-marks-676.md) |
| #720 | `paper-trading-signal-settlement-720.ts` | expired signal option legs settle — worthless / intrinsic | [paper-trading-signal-settlement-720.md](../../../scripts/verify/paper-trading-signal-settlement-720.md) |
| #724 | `paper-trading-engine-settlement-724.ts` | engine settlement retries missed nights + weekend-expiry walk-back | [paper-trading-engine-settlement-724.md](../../../scripts/verify/paper-trading-engine-settlement-724.md) |
| #669 | `paper-trading-trade-exits-669.ts` | composed exit seam — prod seeding audit + governingVariant resolution + seed guards + cancel/close guards | [paper-trading-trade-exits-669.md](../../../scripts/verify/paper-trading-trade-exits-669.md) |
| #766 | `screenshot-capture-766-render.ts` | render model → SVG (fixture render + structural checks + browser artifact) | [screenshot-capture-766.md](screenshot-capture-766.md) |
| #767 | `screenshot-capture-767-assemble.ts` | symbol-data bars → indicator series → render model → SVG (real-data end-to-end) | [screenshot-capture-767.md](screenshot-capture-767.md) |
| #768 | `screenshot-capture-768-callable.ts` | callable handler → assemble → render → real bucket write + error contract | [screenshot-capture-768.md](screenshot-capture-768.md) |
| #769 | `screenshot-capture-769-rasterize.ts` | PNG sibling per SVG — resvg rasterize → bucket PNG (signature/dims/contentType) | [screenshot-capture-769.md](screenshot-capture-769.md) |
| #844 | `screenshot-capture-844-contracts.ts` | `groupId` → `{symbol}/{group}/` path level + strategy `positionType` tags → real bucket write | [screenshot-capture-844.md](screenshot-capture-844.md) |

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
14. **#669** — `paper-trading-trade-exits-669.ts` (composed exit seam + prod audit)
15. **#766** — `screenshot-capture-766-render.ts` (render model → SVG)
16. **#767** — `screenshot-capture-767-assemble.ts` (data assembly → model → SVG)
17. **#768** — `screenshot-capture-768-callable.ts` (callable → bucket write + error contract)
18. **#769** — `screenshot-capture-769-rasterize.ts` (PNG rasterization → bucket sibling)
19. **#844** — `screenshot-capture-844-contracts.ts` (grouped path + position types → bucket write)
