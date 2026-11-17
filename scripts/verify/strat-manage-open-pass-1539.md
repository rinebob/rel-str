# Verification Guide — Manage Instance Reader + Open-Pass Rework (#1539)

Task [#1539](https://github.com/rinebob/rel-str/issues/1539) — BE
manage-instance reader + noon-PT open pass for the OpsStrat Manage Page
Overhaul (Topic #137, Thread #1510):
`functions/src/paper-trading/engine/manage-instance-reader.ts` (validate/
normalize + ACTIVE query + trigger partition + legacy skip-warn) and
`functions/src/paper-trading/engine/passes/manage-open-pass.ts`
(daily/signal gates → per-leg RH chain resolution → dedup → position
create → `lastFiredAt`), wired to the `manageOpenPassTimer` noon cron
and exported from `functions/src/index.ts`.

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `strat-manage-open-pass-1539.ts` | reader + open pass | Drives the real functions-side modules offline: `normalizeManageInstance` over valid/legacy/deleted/invariant-violating docs and the malformed-`maxOpenPositions` path, then `runManageOpenPass` end-to-end with injected MCP + persistence fakes — two-leg CDS chain resolution (Δ/DTE per leg, deterministic `{instanceId}-{marketDate}` position id, OCC ids, debit premium math), same-day cadence dedup + deterministic-id pre-check, `maxOpenPositions` cap, signal-trigger gate (flat without fresh signal, opens with), `no_contracts` skip, and the stock-leg throw (share plumbing deferred to a later task) |

### Usage

```bash
npx tsx scripts/verify/strat-manage-open-pass-1539.ts
```

No arguments, no environment variables, no Firestore calls — the RH MCP
tool caller, signal probe, position reads/writes, and result sink are
all injected fakes. Importing the modules runs
`firebase-admin-init` (parameterless `initializeApp()`; credentials are
never touched).

**Pass:** every check prints `OK   name: value` and the script ends with
`All checks passed` (exit 0).

**Fail:** the offending line prints `FAIL name: value` + an `expected:`
line; the script ends with `N check(s) FAILED` (exit 1).

## Setup / teardown

None — read-only, no side effects.
