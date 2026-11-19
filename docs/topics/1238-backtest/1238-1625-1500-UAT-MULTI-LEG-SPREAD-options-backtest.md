**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-spread  
**Issue:** #1625  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1500  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# UAT — #1500 Analyzer: position net series + records

## Scope

Task [#1500](https://github.com/rinebob/rel-str/issues/1500) made the
`optionsReplayAnalysis` worker position-aware: v1 list docs narrow to
1-leg position rows (`v1ListDocToV2`); each option leg's contract
series is fetched separately (deduped by `contractId`, bounded
concurrency); legs join into a signed net mark/greeks/IV series with
settlement freezing and per-bar nearest-living expiry; the existing
exit evaluators run unchanged and emit position-grain
`AnalysisTradeRecord`s under every registered exit. Review remediation
added **posture normalization** — net-debit positions flip onto
liquidation value so premium-decay rules read as loss exits (no day-0
garbage) and a long leg expiring ITM reports `expiredItm: true` — plus
the outcome-layer extraction, contractId fetch dedup, and
net-semantics contract docs. The v2 enqueue gate in
`optionsAnalysisStart` is removed; `gridVersion: 0` manage-instance
lists are still rejected.

## Prerequisites

- Node + tsx; `cd functions`.
- DRY stage: no credentials.
- `--live` stage: ADC (`firebase login`), `GOOGLE_CLOUD_PROJECT=rel-str`,
  IPv4 preload (`NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`).
- LIVE evidence left in place: `st-options-analysis-results/verify-1500-{ts}_{exitId}`.

## Getting to the feature

No UI — the surface is the `optionsReplayAnalysis` task worker +
`st-options-analysis-results` docs. Verify:

```bash
cd functions
npx tsx scripts/verify/options-analysis-position-1500.ts           # DRY
NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs" \
GOOGLE_CLOUD_PROJECT=rel-str \
npx tsx scripts/verify/options-analysis-position-1500.ts --live    # LIVE
```

Unit suites:

```bash
npx tsx --test tests/functions/options-analysis/*.test.ts          # 103
npx tsx --test tests/functions/options-replay/*.test.ts            # 127 regression
```

## Automated evidence (fresh, post-review 2026-11-18)

| Check | Result | Evidence |
|---|---|---|
| `tests/functions/options-analysis` | PASS | **103/103** — 14 net-builder + 17 v2 worker + 7 review-remediation tests incl. narrowing byte-parity |
| `tests/functions/options-replay` | PASS | **127/127** regression — worker path untouched |
| Verify DRY stage | PASS | **26/26** — pcs join, narrowing parity, calendar freeze/dte, cov posture flip, leg-fail, no-fabrication |
| Verify `--live` stage | PASS | **10/10** — real `verify-1499-*` SPY doc → real SA leg fetches → real result docs |
| `npm run build` (functions) | PASS | esbuild clean |

## Scenarios

### S1 — v1 → v2 narrowing parity (AC: v1 docs analyze unchanged)

- Run a legacy v1 pick list and the equivalent 1-leg v2 position doc
  through `runReplayAnalysis` with identical series/closes.
- **Expected:** byte-identical trade arrays on every exit doc —
  `entryMark`/`entryDelta`/`entryIv` reproduce the pick row verbatim
  (1-leg short → `postureSign = 1`, no flip).
- **Result/evidence:** **PASS** — `worker.test.ts` narrowing-parity
  test deep-equals all 6 exit docs v1↔v2; DRY stage re-asserts.

### S2 — Two-leg net series + records (AC: marks/greeks/IV in analyzer)

- `pcs` fixture: short 500P @2.0 + long 490P @0.5, both expiring
  2026-02-20.
- **Expected:** one fetch per unique contractId; `entryMark` = 1.5
  (net cost-to-close); `contractId` = `SHORT+LONG` joined; net
  entryDelta −0.15, entryIv −0.02; `expired` at max expiry with
  `expiredItm: false` (both OTM at close 520).
- **Result/evidence:** **PASS** — unit + DRY pcs scenario; live run
  produced real net `entryMark` matching signed leg marks.

### S3 — Settlement freeze + nearest-living expiry (AC: expired legs freeze; position lives to last expiry)

- Calendar fixture: short 500P expires 2026-01-30 (settles ITM,
  intrinsic 5, frozen); long 490P lives to 2026-02-20.
- **Expected:** frozen leg contributes intrinsic on every later bar;
  position dies at the LAST expiry; `dte-21` fires 21 days before the
  short leg's expiry (01-09), not the position's last; `expired`
  fields = signed net (intrinsicAtExpiry 5, `expiredItm: true`).
- **Result/evidence:** **PASS** — unit + DRY calendar scenario.

### S4 — Stock leg off underlyingClose (stock legs; posture flip)

- Covered call: short call + long stock leg; `underlyingClose` map
  520→521.
- **Expected:** zero fetch for the stock leg; entry is net-debit
  (−518 CTC) → record flips to +518 liquidation value; `entryIv`
  absent; net settlement flips to +500 → `expiredItm: true`.
- **Result/evidence:** **PASS** — unit + DRY cov scenario.

### S5 — Posture normalization on debit positions (review critical)

- Debit call spread: long 500C @3.0 + short 510C @1.0 (net debit 2.0),
  value decays to 0.15; and a 1-leg long put expiring ITM.
- **Expected:** debit record reads `entryMark` +2.0 in value space;
  `target-90` fires when the position loses ~93% (exit 01-08) — NOT
  day-0; the long put reports `expiredItm: true`, `intrinsicAtExpiry`
  +5, `entryDelta` −0.5 (its own side's delta).
- **Result/evidence:** **PASS** — two dedicated unit tests
  (`net-debit position flips…`, `long put expiring ITM…`).

### S6 — Leg-series failure → error; sibling isolation (AC: failure → 'error')

- A 2-leg position whose second leg fetch throws, plus a healthy
  sibling position in the same doc.
- **Expected:** the failed position emits one `error` record under
  EVERY registered exit naming the leg index + cause, with real entry
  economics (`entryMark` 1.5); the healthy sibling produces normal
  non-error records under every exit; docs stay `success`.
- **Result/evidence:** **PASS** — unit leg-fail + sibling-isolation
  tests; DRY leg-fail scenario.

### S7 — contractId fetch dedup (review remediation)

- Two position rows holding the same contract (`repeatsPrevious`
  pattern), different entry dates.
- **Expected:** ONE `fetchSeries` call per unique contractId, window
  widened to the earliest holding entry; each row still gets its own
  record sliced to its own entry.
- **Result/evidence:** **PASS** — `worker.test.ts` dedup test asserts
  `fetchCalls.length === 1` and 2 independent records; legacy
  repeat-contractId test pins the same.

### S8 — v2 enqueue + manage-instance guard (start.ts)

- `optionsAnalysisStart` against a v2 list doc vs a `gridVersion: 0`
  synthetic manage-instance doc.
- **Expected:** v2 doc enqueues (old `failed-precondition` v2 gate
  removed); `gridVersion: 0` still rejected with the daily-pass
  message (its docs are analyzed by #1544's exit-scan pass at position
  grain — a manual rerun would clobber `st-options-analysis-results`).
- **Result/evidence:** **PASS** — `start.test.ts`: v2 enqueue +
  gridVersion-0 rejection tests.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface (BE task worker + Firestore
result docs; FE consumption of joined `contractId`s flagged as a
forward note in the code review, not this task's scope).

## Findings

None.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Position marks/greeks/IV computed in analyzer, not stored on rows | S2, S3, S4 |
| Expired legs freeze at settlement; position lives to last expiry | S3 |
| v1 docs analyze unchanged via narrowing | S1 |
| Leg-series failure → existing 'error' outcome | S6 |
| Tests per TEST-BE (faked series + in-memory lists) | S1–S8, evidence table |
| Review: debit posture normalization (no day-0 fires) | S4, S5 |
| Review: contractId dedup | S7 |
| Review: v2 enqueue gate removal + manage-instance guard | S8 |

## Regression / smoke

- [x] `tests/functions/options-replay` 127/127 — sibling worker untouched
- [x] v1 pick-list analysis produces byte-identical records (S1)
- [x] `dte-time` single-leg behavior unchanged (evaluator falls back to
      position expiry when the bar carries none)
- [x] `npm run build` clean; `tsc --noEmit` clean
- [x] Pre-existing unrelated failures noted: 4
      `paper-trading/analysis-dataset-writer.test.ts` stale-fixture
      failures on `prod` HEAD (committed `8be72113`/`c1354e60`) — zero
      overlap with this change

## Verdict

**PASS** — every acceptance criterion and review-remediation scenario
executed with fresh evidence; no findings.

## Results log

| Date | Scenario | Result | Evidence |
|---|---|---|---|
| 2026-11-18 | S1 narrowing parity | PASS | unit deep-equals + DRY v1↔v2 check |
| 2026-11-18 | S2 two-leg net series | PASS | unit + DRY pcs; live net entryMark |
| 2026-11-18 | S3 freeze + nearest-living | PASS | unit + DRY calendar |
| 2026-11-18 | S4 stock leg + cov flip | PASS | unit + DRY cov (+518/+500/ITM) |
| 2026-11-18 | S5 debit posture | PASS | 2 unit tests (debit exit, long ITM) |
| 2026-11-18 | S6 failure + isolation | PASS | unit + DRY leg-fail |
| 2026-11-18 | S7 fetch dedup | PASS | unit (fetchCalls === 1) |
| 2026-11-18 | S8 enqueue + guard | PASS | start.test.ts |
| 2026-11-18 | Evidence suite | PASS | 103 + 127 + 26 dry + 10 live + build |
