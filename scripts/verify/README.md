# Verification Scripts Index

## Overview

Permanent, committed verification scripts that exercise the real (prod) pipeline.
These are NOT part of the test suite — they hit live services and must be run
deliberately, on-demand.

## Tasks

| Task | Guide | Pipeline Stage | Scripts |
|---|---|---|---|
| #240 — BE Normalize Robinhood Orders | [savant-trader-broker-orders.md](savant-trader-broker-orders.md) | MCP call → normalize → output | `savant-trader-broker-orders-list.ts`, `savant-trader-broker-orders-get.ts`, `savant-trader-broker-positions-list.ts` |

## Run All

```bash
npx tsx scripts/verify/run-all.ts <accountNumber>
```

Runs every verification script in documented order and reports a pass/fail summary.

## Conventions

- Scripts live in `scripts/verify/` with naming `{domain}-{task-slug}-{stage}.{ext}`.
- Per-task guides: `scripts/verify/{domain}-{task-slug}.md`.
- Runner: `scripts/verify/run-all.ts` — single invocation for all scripts.
- Never wired into `npm test` or CI — these hit prod directly.
