# Verify — paper-trading-groom-legacy-trades-1651

Verification for `functions/scripts/groom-legacy-signal-trades.ts` — the
one-shot wipe of `source=SIGNAL` trades left by the retired auto-ingest
(task #1651 — BE-IMPL: legacy signal-trade wipe script, Thread #1117).

## Commands

```bash
cd functions

# DRY — fixture deps through the real runGroomSignalTrades (no credentials)
npx tsx scripts/verify/paper-trading-groom-legacy-trades-1651.ts

# LIVE read-only — real census vs a raw source==SIGNAL query (needs ADC)
GOOGLE_CLOUD_PROJECT=rel-str npx tsx scripts/verify/paper-trading-groom-legacy-trades-1651.ts --live

# LIVE destructive — performs the real wipe, then asserts zero eligible
# remain. Run only when the wipe is actually wanted (pre-pane, see AC).
GOOGLE_CLOUD_PROJECT=rel-str npx tsx scripts/verify/paper-trading-groom-legacy-trades-1651.ts --live --apply
```

## Flags

| Flag | Effect |
|------|--------|
| (none) | DRY only — fixture rows exercise the real groom core. |
| `--live` | Adds the real-Firestore census block (read-only). |
| `--live --apply` | Runs the actual wipe on prod, then re-censuses. |

## Pass criteria

- **DRY** — census classification splits eligible vs skipped (cohortId /
  positionGroupId / ticket carriers), dry run calls delete for nobody,
  `--apply` visits every eligible id at the configured batch size, a
  re-run over the skipped-only remainder deletes nothing.
- **LIVE read-only** — `listSignalTrades` scan count equals a raw
  `source==SIGNAL` query.
- **LIVE --apply** — every eligible cascade returns an outcome (failed
  bucket empty); post-wipe census has `eligible == 0` and only
  accept-flow-marker docs survive (accept-flow docs stay by design —
  the literal "`source==SIGNAL` count == 0" AC wording resolves to
  `eligible == 0` given the skip-them AC).

## Operator notes

- **Serial deletes.** The script iterates eligible ids serially inside
  each batch — eligible legacy trades all share `acct-auto-paper`, and
  concurrent cascades would contend on its `openTradeCount` rewind
  (matching `handleDeletePaperTrades`, which is also serial).
- **Failure surface.** A failed cascade lands in `failed` with the
  tradeId + error printed, and the script exits 1. Re-running is the
  fix — already-deleted ids simply vanish from the next census, so a
  partial run converges idempotently.
- **Eligible-by-status histogram.** The census prints one — a PENDING
  entry would mean a phantom `openTradeCount` decrement inside the
  cascade (PENDING trades never incremented it). Observed population:
  `OPEN:89, CLOSED:224` — zero PENDING, as expected.
- **Orphan residue window.** The cascade's post-txn cleanup (rq-* quote
  docs + the `pap_{tradeId}` order ticket) is best-effort; a process
  killed between txn commit and cleanup leaves audit-only orphans, and
  a `notFound` outcome skips cleanup entirely. Orphans are enumerable
  per trade via `raw-quotes where tradeId=={id}` — they cannot affect
  the pane checkbox join (which reads trades, not quotes).
- **Hold mints during the wipe.** `generatePaperSignalTrades` is
  deployed — a curated mint racing the scan window is indistinguishable
  from legacy residue (carries no accept-flow markers). A mint before
  the scan gets wiped; a mint racing the same deterministic id could
  resurrect it. The post-wipe census (`eligible == 0`) catches the
  latter — but run the wipe while pane minting is idle.
- The wipe is deliberately gated behind `--apply` at BOTH layers — the
  groom script itself defaults to dry-run, and the verify script only
  mutates with `--live --apply`.
- Accept-flow trades (`cohortId`/`positionGroupId`/`ticket`) are
  never eligible — `deleteTradeCascade` re-refuses them inside its
  transaction as well, so a marker arriving mid-run still stops the
  delete.
- Observed prod census at verification time: 340 scanned — 313 eligible
  (`OPEN:89, CLOSED:224`), 27 skipped (accept-flow markers).
