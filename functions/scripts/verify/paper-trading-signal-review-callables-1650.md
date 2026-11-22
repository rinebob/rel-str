# paper-trading-signal-review-callables-1650

**Task:** #1650 — BE-IMPL: signal-review callables (queue + bundle) (Thread #1117)

**What it verifies:** `handleGetSignalReviewBundle` +
`handleGetSignalReviewQueue` end-to-end through the real handlers —
occurrence reshaping, the `signalDedupeKey` ledger join (incl. the
swapped-layout and accept-flow-decisionId hazards), read-then-stamp
review-state semantics, error mapping, and the PRIMARY ∪ SECONDARY
queue union with `ownerUid` resolution.

**Mode:** DRY uses fixture deps — no env, safe in `run-all`. LIVE
(`--live`) exercises `signalReviewProdDeps` against real Firestore;
it performs the designed `st-config/signalReview` stamp write for one
member symbol.

## Usage

```bash
cd functions
npx tsx scripts/verify/paper-trading-signal-review-callables-1650.ts          # DRY
npx tsx scripts/verify/paper-trading-signal-review-callables-1650.ts --live   # + real Firestore (needs ADC)
```

## Pass

Exit 0 — every check prints `OK`. DRY ends `=== 14 passed, 0 failed ===`;
LIVE adds the prod-deps block.

## Fail

Any `FAIL` line names the broken seam — a join-key layout drift, a
missed stamp, a wrong error code, or a queue merge regression.

## Cleanup

LIVE stamps `st-config/signalReview.lastOpenedAt[symbol]` — the
callable's designed side effect; idempotent, no cleanup needed.
