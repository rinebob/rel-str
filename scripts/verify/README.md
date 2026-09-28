# Verification Scripts Index

## Overview

Permanent, committed verification scripts that exercise the real (prod) pipeline.
These are NOT part of the test suite — they hit live services and must be run
deliberately, on-demand.

## Tasks

| Task | Guide | Pipeline Stage | Scripts |
|---|---|---|---|
| #240 — BE Normalize Robinhood Orders | [savant-trader-broker-orders.md](savant-trader-broker-orders.md) | MCP call → normalize → output | `savant-trader-broker-orders-list.ts`, `savant-trader-broker-orders-get.ts`, `savant-trader-broker-positions-list.ts` |
| #334 — FE Swing Analysis Store | [indicator-lib-swing-analysis.md](indicator-lib-swing-analysis.md) | Firestore path construction + round-trip | `indicator-lib-swing-analysis-store.ts` |
| #560 — SHARED Paper Trading Contracts | [paper-trading-contracts-560.md](paper-trading-contracts-560.md) | IDs + collection paths + kind guards | `paper-trading-contracts-560-ids.ts` |
| #561 — BE Ledger Core | [paper-trading-ledger-561.md](paper-trading-ledger-561.md) | fill → ledger → Firestore persist (account + trade atomic write) | `functions/scripts/verify/paper-trading-ledger-561.ts` (needs ADC; runs from `functions/`) |
| #562 — BE Engine Migration | [paper-trading-engine-migration-562.md](paper-trading-engine-migration-562.md) | legacy options-strategy-* → `paper-trading/{anchor}/items` + Position-view adapter + P&L parity | `functions/scripts/verify/paper-trading-engine-migration-562.ts` + `functions/scripts/migrate-options-strategy-to-paper.ts` (needs ADC; runs from `functions/`) |
| #563 — BE Exit Engine | [paper-trading-exit-eval-563.md](paper-trading-exit-eval-563.md) | nightly variant eval → governing closing fill via ledger / shadow exitEvents / mark-gap + sentinel tolerance | `functions/scripts/verify/paper-trading-exit-eval-563.ts` (needs ADC; runs from `functions/`) |
| #564 — BE Signal→paper path | [paper-trading-signal-order-564.md](paper-trading-signal-order-564.md) | order-ticket → `paperSignalOrder` (equity fill + cohort + PENDING expressions) → noon fill pass (chains → instruments → quotes → selection → OPEN) | `functions/scripts/verify/paper-trading-signal-order-564.ts` (needs ADC + local RH MCP OAuth; runs from `functions/`) |
| #565 — BE Read APIs + stats scopes | [paper-trading-read-apis-565.md](paper-trading-read-apis-565.md) | generalized stats pass (all/inst/var/cohort/sig/sym scopes) + listPaperTrades / getPaperStats / getPaperAccount / listExitVariants callables | `functions/scripts/verify/paper-trading-read-apis-565.ts` (needs ADC; runs from `functions/`) |
| #605 — FE swing-config library | [swing-analysis-misc-fixes-605.md](swing-analysis-misc-fixes-605.md) | `st-swing-configs` slim-doc write → read → idempotent overwrite → userId list → delete | `swing-analysis-misc-fixes-605-config-library.ts` (needs ADC) |
| #586 — FE Allocation services | [portfolio-allocation-586.md](portfolio-allocation-586.md) | `portfolio/{buckets,attributions}/items` round-trip — bucket CRUD, attribution assign/group-move/unassign, composite-index queries | `portfolio-allocation-586-roundtrip.ts` (needs ADC) |
| #637 — SHARED lifecycle-tree contract | [dev-tools-lifecycle-contracts-637.md](dev-tools-lifecycle-contracts-637.md) | TOPICS-INVENTORY parse → buildTree → orderTopics sections | `dev-tools-lifecycle-contracts-637.ts` (no credentials) |

## Run All

```bash
npx tsx scripts/verify/run-all.ts [accountNumber]
```

Runs every verification script in documented order and reports a pass/fail summary. Scripts that need the account number are skipped (reported as SKIPPED) when it isn't supplied; credential-free scripts always run.

## Conventions

- Scripts live in `scripts/verify/` with naming `{domain}-{task-slug}-{stage}.{ext}`.
- Per-task guides: `scripts/verify/{domain}-{task-slug}.md`.
- Runner: `scripts/verify/run-all.ts` — single invocation for all scripts.
- Never wired into `npm test` or CI — these hit prod directly.
