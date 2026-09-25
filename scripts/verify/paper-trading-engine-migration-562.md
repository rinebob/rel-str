# Paper Trading Engine Migration (#562) — Verification Guide

## Scope

Verifies the options-strategy-engine → `paper-trading` migration end to end
against real Firestore:

- `options-strategy-instances` → `paper-trading/instances/items` (+ `kind`,
  `paperAccountId`, `governingVariant`)
- `options-strategy-positions` + `legs`/`daily-updates`/`raw-quotes`
  subcollections → `paper-trading/trades/items` (embedded) +
  `paper-trading/raw-quotes/items`
- `options-strategy-stats` + `equity-curve` → `paper-trading/stats/items`
  (embedded `equityCurve[]`)
- Position-view adapter round-trip (`getPosition`, `getLegs`,
  `listOpenPositions`) reproduces legacy fields — premiumCollected,
  capitalRequired, unrealizedPnl — so computed P&L is identical
- Migration idempotency (deterministic ids, `set` overwrite)

## Script

`functions/scripts/verify/paper-trading-engine-migration-562.ts`

Run from `functions/` (needs ADC + the Node IPv4 preload):

```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx scripts/verify/paper-trading-engine-migration-562.ts
```

Or via the runner: `npx tsx scripts/verify/run-all.ts` (needs ADC).

## What it does

1. Seeds namespaced legacy docs (`verify-562-*`): one instance, one open
   position with leg + daily-update + raw-quote subdocs, one stats doc with a
   curve point.
2. Runs the real migration restricted to those ids
   (`runMigration({ apply: true, only: 'verify-562' })`).
3. Asserts the migrated docs through the new repositories (18 checks):
   instance readable via `getInstance`, trade doc shape (kind, embedded
   legs/marks, synthesized entry fill, `source: strategy`,
   `strategyInstanceId`), adapter-derived `premiumCollected` /
   `capitalRequired`, raw quote in `raw-quotes/items`, stats doc + embedded
   equity curve.
4. Deletes every `verify-562` doc from old and new collections.

## Migration script

`functions/scripts/migrate-options-strategy-to-paper.ts` — dry-run by
default, `--apply` to write, `--only=<substr>` to restrict doc ids. The
dry-run prints a per-scope P&L parity check (recomputes stats from
round-tripped migrated positions vs existing stats docs).

## Known caveat

Two legacy stats scopes (`SPY-WHEEL-INT`, `inst-1`) have stats docs with no
backing positions (stale dev data) — the parity check flags them as
mismatches when running unfiltered; this predates the migration and is not
a mapping error.
