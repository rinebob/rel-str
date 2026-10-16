**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #1027  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #983  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# UAT — #983 signal-trade EOD close stamp

## Scope

Signal-source paper trades (`paper-trading/trades/items/{id}`, `sig`
origin) must carry the **official SDS daily close** in `marks[date]` —
not the last ~1 PM PT intraday RH quote. A new nightly-chain step
(`runSignalEodClosePass`) stamps the close before exit-variant eval so
trailing stops also evaluate the official print. Share-leg trades only;
option legs keep intraday marks (expiry settles via the #720 pass).

## Prerequisites

- Functions deployed with the #983 code (verify: a nightly-run log line
  `Signal EOD close pass for {date}: stamped=…` exists under
  `[OptionsStrategyPasses]`).
- ADC credentials (`gcloud auth application-default login`) for the
  read-only drift script.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` in
  any terminal that calls GCP (IPv6 workaround).

## Start instructions

All checks run from `functions/`:

```powershell
cd functions
npx tsx scripts/verify/paper-trading-eod-close-983.ts [marketDate]
```

`marketDate` defaults to today PT. To force the chain without waiting
for the natural nightly run, dispatch the settlement consumer:

```powershell
npx tsx scripts/verify/sds-consumer-dispatch.ts settlement 2026-10-15
```

## Scenarios

### 1. Chain-order evidence (logs)

- **Confirms:** EOD stamp runs before exit eval in the nightly chain.
- **Steps:** after one settlement run (natural or dispatched), read
  Cloud Logging for `[OptionsStrategyPasses]` lines on the date.
- **Expected:** `Signal EOD close pass for {date}: stamped=N …` logged
  BEFORE `Exit eval pass for {date}`.
- **Result:** PASS — 23:55:46Z `Signal EOD close pass … stamped=155
  skipped=7 noClose=0 errors=0`; 23:55:48Z `Exit eval pass …
  evaluated=162` (dispatched settlement replay, 2026-10-15).

### 2. Drift report flips to clean

- **Confirms:** `marks[date]` equals the SDS close on every share-leg
  signal trade.
- **Steps:** `npx tsx scripts/verify/paper-trading-eod-close-983.ts
  2026-10-15` after the chain run.
- **Expected:** `ok={all share-leg trades} drifted=0`; `nonShare` and
  `noClose` may be non-zero (legitimate skips).
- **Pre-fix baseline (2026-10-15):** `ok=0 drifted=147 noClose=0
  nonShare=7 total=154`.
- **Result:** PASS — post-stamp replay `ok=155 drifted=0 noClose=0
  nonShare=7 total=162` (8 new `261015-sig-*` trades ingested by today's
  nightly in between).

### 3. Stamped doc shape spot-check

- **Confirms:** the mark entry carries both fields and the doc's EOD
  state is consistent.
- **Steps:** open any stamped trade
  (`paper-trading/trades/items/{261015-sig-*}`). Check
  `marks.2026-10-15` = `{mark: <SDS close>, underlyingClose: <same>}`,
  `legs[0].lastMark` = close, `unrealizedPnl` matches
  `(close − entryFill.price) × qty × dir`, `lastMarkedAt` = stamp time.
- **Expected:** all consistent; `updatedAt` advanced.
- **Result:** PASS — `261015-sig-AMAT-EQV2S`:
  `marks.2026-10-15={mark:430.01, underlyingClose:430.01}`,
  `legs[0].lastMark=430.01`, `lastMarkedAt=2026-10-15T23:55:24Z`.

### 4. Audit trail

- **Confirms:** provenance of the non-RH mark.
- **Steps:** read `paper-trading/raw-quotes/items/rq-{tradeId}-261015`.
- **Expected:** `rawResponse` = `{mark, source:'sds-daily-close',
  pass:'eod-close'}`.
- **Result:** PASS — `rq-261015-sig-AMAT-EQV2S-261015` carries
  `pass:'eod-close'`, `source:'sds-daily-close'`, `mark:430.01`;
  merge preserved the earlier intraday `quote`/`tool` fields.

### 5. Option-leg trades untouched

- **Confirms:** premium marks not overwritten by underlying close.
- **Steps:** drift report `nonShare` count + spot-check one option-leg
  trade's `marks[date]`.
- **Expected:** option trades keep their premium mark; `nonShare`
  count ≥ pre-fix count (7 on 10-15).
- **Result:** PASS — `nonShare=7`, identical to the pre-fix count; pass
  log `skipped=7` matches exactly those trades.

### 6. SHORT-direction P&L sanity

- **Confirms:** short signal trades recompute `unrealizedPnl` with
  correct sign (`(entry−close)×qty`).
- **Steps:** pick a `*_EQV*S` trade, compare `unrealizedPnl` vs
  `entryFill.price` and the stamped close.
- **Expected:** sign-correct (close < entry → positive for shorts).
- **Result:** PASS — `261015-sig-AMAT-EQV2S` SHORT, entry 430.38, close
  430.01 → `unrealizedPnl=+0.37` (price fell → short profits).

### 7. Missing-bar fail-soft

- **Confirms:** no SDS bar → intraday mark stands, `skippedNoClose`
  counted.
- **Steps:** covered by unit spec; live check only if a holiday/delay
  occurs. Next market holiday is the natural case.
- **Expected:** no mark overwrite, log line shows `noClose≥1`.
- **Result:** PASS (spec-level; live case deferred by nature).

## Traceability

| #983 requirement | Scenario |
|---|---|
| `marks[date]` = SDS official close | 2, 3 |
| Stamped before evalPass | 1 |
| Share legs only | 2, 5 |
| Refresh unrealizedPnl + lastMark | 3, 6 |
| `pass:'eod-close'` audit doc | 4 |
| Fail-soft on missing bar | 7 |
| Non-OPEN race skip | unit spec (closed-mid-pass) |
| Idempotent / no bloat | 2 (re-run shows same counts) |

## Regression / smoke

- Exit eval still runs nightly (log line `Exit eval pass … evaluated=N`).
- Signal settlement (option expiry) unaffected — next expiry Friday.
- Paper-stats pass still writes `paper-trading/stats/items/*`.

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| 1 chain order | PASS | 23:55:46Z eod-close → 23:55:48Z eval |
| 2 drift flips | PASS | ok=155 drifted=0 (was 0/147) |
| 3 doc shape | PASS | AMAT: mark=uc=430.01, lastMark+lastMarkedAt set |
| 4 audit trail | PASS | rq-…-261015: pass=eod-close, source=sds-daily-close |
| 5 option legs | PASS | nonShare=7 = pre-fix count |
| 6 short P&L | PASS | AMAT short: entry 430.38 → +0.37 on 430.01 close |
| 7 fail-soft | PASS | spec; live case deferred |

Refinement pass: Not applicable — no user-facing surface.
