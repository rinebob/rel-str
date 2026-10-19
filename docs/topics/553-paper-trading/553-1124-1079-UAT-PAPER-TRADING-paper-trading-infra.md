# UAT — #1079 analysis-dataset verify relay (QA #1124)

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1124  
**Blueprint:** #1075  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1079  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Verdict: PASS

All acceptance criteria verified against real prod (`rel-str`). The relay
(`functions/scripts/verify/paper-trading-analysis-dataset.ts`) ran clean
end-to-end post-migration — canonical `st-paper-trading` read directly,
zero warns.

## Results log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| S1 | Dry-run never writes to GCS/index | PASS | Both passes run through an injected collector `writeDataset` — the only write surface is in-memory; `writeDataset` invoked exactly once with 247 rows |
| S2 | Live leg = real pass, real ledger | PASS | `runLiveSnapshot` against prod: **247 enumerated → 247 rows**, 229 signal-equity / 18 excluded, 19 closed / 228 open |
| S3 | Row count asserts vs enumerated ledger | PASS | Check compares rows to the dep-recorded enumerated count (fixed in review — the pass-return comparison was tautological) |
| S4 | Column non-null sample | PASS | 46 fields printed (e.g. `tradeId` 247, `ind.zoneV2` 125, `strength.adx` 220, `capitalRequired` 0 — equity rows) |
| S5 | AMAT parity asserts + prints diff | PASS | Expected-vs-actual table printed; **99 rows / 98 closed / 32.7% / 1.30** — all within tolerance (rows+closed exact, winrate ±0.5pp, payoff ±0.02) |
| S6 | Signal-set diff | PASS | `signalBarDate\|signalType` both ways vs checked-in prototype CSV — **zero diff, 99 signals** |
| S7 | Non-zero exit on parity failure | PASS | Tamper-proven: 5 fixture returns sign-flipped → `%profitable` + `payoff` FAIL → **exit 1**; restored → green |
| S8 | Wired into run-all | PASS | `run-all.ts` paper-trading group (after verify-1077) + README table + run-order #32 |
| S9 | Full-history baseline informational | PASS | Prints `194/193/35.8%/1.30` labeled not-asserted (drifts legitimately if SDS backfills older shards) |
| S10 | #1007 transitional fallback | PASS | Canonical-empty → legacy read with `⚠` (exercised during the migration window); post-migration reads canonical — warn-free |
| S11 | tsc | PASS | `npx tsc --noEmit` (functions) clean |
| S12 | Regression specs | PASS | paper-trading suite **272/272**; replay+live-snapshot passes **23/23** |

## Acceptance traceability (issue #1079)

| AC | Result |
|---|---|
| dry-run mode never writes to GCS or the index collection | PASS (S1) — collector seam, structural |
| AMAT run asserts closed count / %profitable / payoff within tolerance and prints the diff | PASS (S5, S6) — plus exact signal-set diff |
| script exits non-zero on parity failure; wired into run-all | PASS (S7 tamper-proven, S8) |

## Findings

- None — one review-round finding (tautological row-count check) fixed
  before QA; verified in S3.

## Notes

- `FROZEN_TO = 2026-10-16` bounds the replay window at the fixture's max
  referenced date — the parity check is stable as SDS appends bars.
- The legacy fallback is dormant post-migration; it fires only if
  canonical enumerates zero (pre-migration environment or a regression —
  the warn makes either visible).
- Run evidence: `.devin/tmp/qa-1079-run.log` (working copy, not shipped).
