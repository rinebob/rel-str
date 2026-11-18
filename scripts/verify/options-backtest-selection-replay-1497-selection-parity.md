# Verification Guide — Shared Coordinate Selection Parity (#1497)

Task [#1497](https://github.com/rinebob/rel-str/issues/1497) — shared pure
selection fn `selectContractAtCoordinate` in `shared/options-common.ts`
(`@options/common`), implementing SA's confirmed pick-doc semantics
(spike #1496 / IMPL-BE module 0).

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `options-backtest-selection-replay-1497-selection-parity.ts` | parity harness | The falsifiable convergence proof: for coordinate C on day T, runs the fn over the live AV EOD chain (`callPartnerHistoricalOptions` — the same corpus SA materializes from) and asserts `contractId === pickDoc[C].days[T].contractId`, plus dte/expiration/strike/delta equality. Also asserts `no_match` days produce `null` and treats `no_chain` days as informational (no picker input existed). Fixture matrix: QQQ × {put −0.20Δ @45d, call +0.20Δ @45d, put −0.50Δ @180d} × first/middle/last pick days of the 2026 shard + any miss days it carries. |

### Usage

```bash
npx tsx scripts/verify/options-backtest-selection-replay-1497-selection-parity.ts
```

**Needs:** ADC (`GOOGLE_APPLICATION_CREDENTIALS` or
`GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`) — the same credential path as the
deployed partner callables. Registered in `run-all.ts` with `needsAdc`.

**Pass:** every check prints `OK` and the summary ends `N/N checks passed`
(exit 0). **Fail:** a divergence prints `FAIL {cell} @{day}: pick parity —
selected X, corpus picked Y`; unit-level algorithm mechanics are pinned by
`shared/options-common.spec.ts` (jest).

A FAIL here is a spec-drift signal to reconcile (algorithm change on either
side, or a corpus re-seed), never a silent behavior fork.
