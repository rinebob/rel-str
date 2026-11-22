**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1656  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1502  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# UAT — #1502 expression-fill-pass re-target to shared selection

## Scope

`expression-fill-pass` retargeted from the DTE-band filter +
`selectOptionContract` weighted scorer to the shared
`selectContractAtCoordinate` — same coordinate vocabulary the engine
EOD pass uses (#1501). Expirations fetch nearest-to-`targetDte` (bounded
4, equidistant → longer DTE, `dte>0` floor), instruments + quotes over
that set, signed coordinate `{type, ±|targetDelta|, dte: targetDte}`,
fill price = RH quote mark of the selected contract. A selected-but-
unpriceable pick skips with `no_contract` — never a silent second
choice. `SignalExpressionTemplate.minDte`/`maxDte` are now optional
`@deprecated` (no reader remains). Engine stays single-leg.

Acceptance criteria covered:

1. Selection uses the shared fn at a concrete coordinate (no window scoring)
2. Fill price = RH quote mark; ticket error paths unchanged
3. Existing pass tests updated

Plus review remediations: `dte>0` floor (r1 major), `minDte`/`maxDte`
deprecation (r1 major), comment/doc accuracy (r1/r2 minors).

## Prerequisites

- Repo `C:\aa\projects\rel-str` on branch `prod`, deps installed.
- For S2 (LIVE): `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`,
  `GOOGLE_CLOUD_PROJECT=rel-str`, ADC (`gcloud auth application-default
  login`), and `RH_CREDENTIAL_KEY_NAME` present in `functions/.env`
  (auto-loaded by the script; the prod KMS-backed session manager
  supplies rotating credentials — no local RH token needed).
- Commands run from `C:\aa\projects\rel-str` (verify script + tsx tests
  from `functions/`).

## Getting to the feature

No reachable UI surface — the exercised surface is the noon-PT
`expressionFillPassTimer` scheduled function in prod
(`functions/src/paper-trading/passes/expression-fill-pass.ts`) and the
`SignalExpressionTemplate` contract
(`shared/paper-trading-contracts.ts`). All scenarios are command-line.

## Automated evidence

| Suite | Command | Expected |
|---|---|---|
| Pass specs | `cd functions && npx tsx --test ../tests/functions/paper-trading/expression-fill-pass.test.ts` | 30/30 |
| Verify DRY | `cd functions && npx tsx scripts/verify/options-engine-expression-fill-1502.ts` | 12/12 |
| Verify LIVE | same + `--live` + env above | 19/19 |
| Paper-trading suite | `npx tsx --test ../tests/functions/paper-trading/*.test.ts` | 437/441 — 4 `analysis-dataset-writer` fails are pre-existing foreign #553 |
| Contract + backtest specs | `npx jest --coverage=false shared/paper-trading-contracts.spec.ts src/app/features/savant-trader/backtest` | all green |
| Functions build | `cd functions && npm run build` | clean |

## Scenarios

### S1 — Coordinate selection semantics (DRY fake chain → real pass)

**Feature:** AC1 — the shared selector at the template's concrete
coordinate; no band, no window scoring.

```powershell
cd functions; npx tsx scripts/verify/options-engine-expression-fill-1502.ts
```

- Expected 12/12:
  - `ok pick = QQQM 2026-11-06 580P (nearest expiry, −0.31Δ)` — signed
    argmin over real deltas at the nearest-DTE expiration
  - `ok fill price = RH quote mark 2.80` — the mark travels quote→pick→fill
  - `ok out-of-band chain still fills` / `ok pick = nearest expiration
    2026-10-01` — no band: a chain outside the old 30–60d window fills
    at the nearest listed expiration
  - `ok positive-delta put row never wins a PUT coordinate` — sign
    normalization by option type
  - `ok unpriceable pick skips — no mint` + `ok ticket records
    no_contract` — selected-but-unpriced → same error category, never a
    second choice
  - `ok empty chain skips` + `ok no instrument fetches on an empty chain`
- Result: ☑ PASS — 2026-11-22 — 12/12 (signed argmin 580P@2.80, out-of-band fill at nearest 2026-10-01, unpriceable→no_contract, empty-chain skip)

### S2 — Live parity on a real SPY chain (LIVE)

**Feature:** AC1+AC2 end-to-end against the prod credential path — the
pass mints exactly what the raw selector picks on live RH data, at the
live mark, writing nothing.

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"; $env:GOOGLE_CLOUD_PROJECT="rel-str"
cd functions; npx tsx scripts/verify/options-engine-expression-fill-1502.ts --live
```

- Expected 19/19 including:
  - `ok pass pick ≡ selector pick on live data` — the pass's minted
    contract equals `selectContractAtCoordinate` applied to the same
    live fetch set (last run: `SPY261224P00660000` Δ−0.290 mark 13.85
    dte 33)
  - `ok fill price = the picked quote mark`
  - `ok nothing written — applyEntryFill was captured, not committed`
- Result: ☑ PASS — 2026-11-22 — 19/19 (live pick SPY261224P00660000 Δ−0.290 mark 13.85 dte 33 ≡ selector; fill=mark; zero writes)

### S3 — Same-day (0-DTE) exclusion — r1 major remediation

**Feature:** a same-day expiration can never reach the instrument
fetch or a fill — the retired scorer's `dte<=0` reject restored as a
fetch floor.

- Steps: `npx tsx --test ../tests/functions/paper-trading/expression-fill-pass.test.ts`
  — spec `never fills a same-day expiration — the dte>0 floor restores
  the old band guarantee` lists `MARKET_DATE` itself in the chain
  alongside real expirations and asserts `get_option_instruments` is
  never called for it while the fill lands on `2026-11-06`.
- Result: ☑ PASS — 2026-11-22 — 30/30 incl. the same-day-floor pin

### S4 — Contract deprecation — r1 major remediation

**Feature:** `minDte`/`maxDte` are optional `@deprecated`; nothing
reads them; old persisted templates remain readable.

- Steps:
  1. `grep -n "minDte\|maxDte" shared/paper-trading-contracts.ts` —
     only the two optional `@deprecated` field declarations remain;
     `SIGNAL_EXPRESSION_TEMPLATES` seeds no longer write them.
  2. `grep -rn "template.minDte\|template.maxDte\|\.minDte\|\.maxDte"
     functions/src/` — no production reader (hits in
     `option-contract-selection.ts` criteria + `leap-drop.strategy.ts`
     are the separate leap-drop contract, still live by design).
  3. `npx jest --coverage=false shared/paper-trading-contracts.spec.ts`
     — contract specs still green; fixtures retaining the fields
     (expression-fill `CSP_TEMPLATE`, verify `CSP`, `ledger.test.ts`)
     compile — the readable-old-doc path.
- Result: ☑ PASS — 2026-11-22 — only the two optional @deprecated declarations remain; zero production readers; jest 213/213 (contracts+backtest)

### S5 — Ticket error paths + fill-path coverage unchanged

**Feature:** AC2 — both fill paths and ticket lifecycle semantics
preserved.

- Steps: the 30-spec suite covers the staged `pap_*` mint path (ticket
  fill, position-group join, group-join failure → ticket healing,
  idempotent re-run, cancellation race, mint-retry bound) and the
  legacy `PENDING` in-place fill path — same specs that existed under
  the band scorer, updated for coordinate semantics.
- Expected: `pap_verify-1502` style logs record `no_contract` for
  unpriceable picks (S1 evidence); no broker mutation tools appear in
  any path (`ok no broker mutations` pin).
- Result: ☑ PASS — 2026-11-22 — 30/30 spec suite covers both fill paths; no_contract evidence in S1; no broker-mutation pin

### S6 — Regression + build

- Steps: `npx tsx --test ../tests/functions/paper-trading/*.test.ts` +
  `cd functions && npm run build`.
- Expected: 437/441 — the 4 `analysis-dataset-writer` failures are
  pre-existing on HEAD (foreign `#553` lineage, commit `8be72113`,
  documented at `#1501`); build clean.
- Result: ☑ PASS — 2026-11-22 — 437/441 (4 pre-existing foreign #553 analysis-dataset-writer fails on HEAD); build clean

## Manual UI/UX refinement pass

Not applicable — no user-facing surface (BE scheduled pass + shared
contract only; the FE `minDte`/`maxDte` form fields feed the separate
leap-drop backtest contract, untouched).

## Findings

- None.

## Traceability

| AC / remediation | Scenarios |
|---|---|
| AC1 shared fn at concrete coordinate, no window scoring | S1, S2, S3 |
| AC2 fill = RH quote mark; ticket error paths unchanged | S1, S2, S5 |
| AC3 existing pass tests updated | S3, S5, S6 |
| r1 major: 0-DTE admittance | S3 |
| r1 major: required-write-only band fields | S4 |
| r1/r2 minors: comment scoping, sign doc, verify-script hygiene | S1, S2 (verify green = conventions exercised) |

## Regression / smoke

- [x] `runExpressionFillPass` staged + legacy paths — 30 specs
- [x] `selectOptionContract` retained for unmigrated callers
      (`manage-open-pass`, `backtest-simulator`) — grep-verified
- [x] Functions build clean
- [x] Verify registrations (`run-all.ts`, both READMEs) — script
      executes end-to-end

## Verdict

**PASS** — all six scenarios green; no findings.

## Results log

| Date | Scenarios | Result | Notes |
|---|---|---|---|
| 2026-11-22 | S1–S6 | PASS | 12/12 DRY · 19/19 LIVE · 30/30 specs · 213/213 jest · 437/441 (4 foreign) · build clean |
