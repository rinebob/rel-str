# Verify — #565 Read APIs + generalized stats scopes

## What it covers

The dashboard read surface: the generalized stats pass (rollup scopes across
every `PaperTrade` dimension) and the four read callables
(`listPaperTrades`, `getPaperStats`, `getPaperAccount`, `listExitVariants`).

## Script

### `functions/scripts/verify/paper-trading-read-apis-565.ts`

**Run:** `cd functions && npx tsx scripts/verify/paper-trading-read-apis-565.ts`

**Prerequisites:** Application Default Credentials with Firestore access
(`gcloud auth application-default login`). No RH OAuth needed — the read
APIs never touch the broker.

**Flags/args:** none.

**What it does:**

1. Seeds three namespaced trades (`verify-565-*`: one strategy-attributed,
   one signal-cohort, one CLOSED with realized P&L — all on symbol `VRFY`)
   plus an `acct-verify-565-uid` account, directly into Firestore.
2. Runs the REAL generalized stats pass (`runPaperStatsPass` with prod
   repository + stats-writer deps) — writes `stats-{scope}` docs for every
   populated scope: `all`, `sym-VRFY`, `inst-verify-565-inst`,
   `cohort-verify-565-cohort`, `sig-verify-565-sig`, `var-*`.
3. Calls the real callable handlers with `paperReadDeps()` (production
   wiring — the same seam the deployed `onCall`s use):
   - `listPaperTrades` — symbol, cohort+expression (AND), variantKey
     array-contains, status.
   - `getPaperStats` — named scope, omitted-scope enumeration, unknown
     scope → `[]`.
   - `getPaperAccount` — seeded uid returns the account; unknown uid → null.
   - `listExitVariants` — registry defaults (initial-stop-10, trailing-20,
     time-9d/30d, limit-sd1 stub).
4. **Cleanup:** deletes seeded docs, re-runs the stats pass so shared
   scopes (`all`, `var-*`) self-heal without the verify trades, then
   deletes the namespaced scope docs.

**Pass:** `=== 20 passed, 0 failed ===` — every check `OK`, cleanup line
printed. **Fail:** `FAIL` lines name the check plus the observed value;
exit code 1.

**Notes:**
- The `stats-all`/`stats-var-*` docs are shared real scopes — the run adds
  the verify trades' P&L to today's curve point briefly, but cleanup
  recomputes them post-delete so nothing stale persists.
- Namespaced scope docs (inst/cohort/sig/sym-VRFY) are deleted at the end.
