# paper-trading-signal-review-contracts-1649

**Task:** #1649 — SHARED-IMPL: signal-review contracts (Thread #1117)

**What it verifies:** the runtime-verifiable surface of the
signal-selection review contracts — `SIGNAL_REVIEW_CONFIG_DOC`, the
`signalPickFromReviewOccurrence` mapper, the occurrence-id layout, and
the `signalDedupeKey` vs `stSignalOccurrenceId` non-interchangeability
the server-side join exists to prevent.

**Mode:** read-only contract checks — no env, no Firestore, safe in
`run-all`.

## Usage

```bash
cd functions
npx tsx scripts/verify/paper-trading-signal-review-contracts-1649.ts
```

## Pass

Exit 0 — every check prints `OK`. Expected output ends with
`=== 11 passed, 0 failed ===`.

## Fail

Any `FAIL` line names the broken contract element — a renamed constant,
a mapper field swap, or an id-layout drift.

## Cleanup

None — no writes.
