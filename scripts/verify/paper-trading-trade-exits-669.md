# Verify guide — #669 BE Trade-Exits composed seam

Composed production verification for the trade-exits thread (#652): a
read-only seeding audit across every existing prod trade, live
`createPosition` round-trips through `governingVariantForInstance`, the
seed-guard rejections added in #668, and the cancel/close handler guards.

## Scripts

| Script | Covers | Credentials |
|---|---|---|
| `paper-trading-trade-exits-669.ts` | prod trade-doc audit (parseable runs, ≤1 governing, terminal-key check, no ACTIVE on terminal status, variantKeys mirror) → scratch-instance `createPosition` seeding (`trailing-15` honored; `time-30d`/`none` → `trailing-8` fallback) → `createPendingTrade` guard rejections (`none`/`time-30d`/`bogus`/`trailing-0`/`trailing-150`/bad `variantKeys`, no leaked docs) → seeded cancel → CANCELLED + runs EXITED → close guards (not-found, failed-precondition) | ADC only (close guards precede the quote fetch — no RH MCP needed) |

## Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-trade-exits-669.ts
```

**Pass:** 26 checks `OK`, scratch docs cleaned + verified deleted, exit 0.
**Fail:** offending check prints `FAIL` with detail; cleanup still runs and
survivors are listed; exit 1.

## Notes

- Scratch docs: `verify-669-pos-*` trades, `verify-669-pending`,
  `verify-669-guard-*` trade ids, `verify-669-inst-*` instances,
  `acct-verify-669` account, `stats-inst-verify-669-*` stats docs, plus
  any raw-quote docs for those trades — all deleted in a `finally` and
  **verified gone** (post-cleanup existence check fails the run if any
  survive; read errors count as suspect, not deleted). Safe to re-run —
  cleanup runs first.
- Scratch instances are written `lifecycleState: STOPPED` +
  `openTimePT: '99:99'` deliberately: a leaked instance must not feed the
  selection/open/stats passes. Don't run two copies concurrently —
  cleanup of run A can delete run B's seeded docs (fails loudly, no
  corruption).
- The prod audit tolerates legacy migrated docs whose runs carry the
  inert `none` key (written by `positionToTrade`, not the guarded seed
  path). Everything else must parse via `parseVariantKey`.
- Guard checks intentionally stop before `netExitPrice` — the live-quote
  close round-trip is covered by `paper-trading-close-667.ts`.
- A warn line `[TradeAdapter] Instance verify-669-inst-time …` during the
  run is expected — it proves the fallback logs.
