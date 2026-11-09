**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1444  
**Domain:** SAVANT-TRADER  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-09  
**Last Updated:** 2026-11-09  

# UAT — #1444: BUG — st-cloud-function callables accept unauthenticated calls

QA issue: **#1455 — QA: st-cloud-function callables auth guards**

## Background

Five `st-cloud-function` callable endpoints were deployed with
`invoker: 'public'` and no `request.auth` check — any anonymous HTTPS
client could invoke them, including the billable ones (`stBacktestStart`
enqueues a full backtest; `stOverviewSyncAdmin` enqueues one task per
enabled symbol). #1444 added `request.auth?.uid` guards inside each
endpoint's testable core, ahead of validation and side effects.

This UAT verifies two things:

1. **The boundary is live** — anonymous and garbage-token calls now
   return `401 UNAUTHENTICATED` on all five (scripted probe, S1).
2. **Signed-in users are unaffected** — every legitimate UI caller goes
   through AngularFire `httpsCallable`, which attaches the user's ID
   token automatically. The guards must be invisible in normal use
   (manual smoke, S2–S5).

## Scope

| Callable | Guard | UI caller |
|---|---|---|
| `stGetSymbolsWithSignals` | `dashboard-callables.ts` | `signal.service.ts` → `group.store.setActiveRun` (run selection) |
| `stGetSymbolSignalHistory` | `dashboard-callables.ts` | none — uncalled in the FE |
| `stBacktestStrategies` | `backtest-strategies-callable.ts` | `backtest-run.service.ts` → strategy list on load |
| `stBacktestStart` | `backtest-orchestrator.ts` | `backtest-run.service.ts` → run start |
| `stOverviewSyncAdmin` | `overview-sync-orchestrator.ts` | `overview.service.ts` → header sync button |

Out of scope: the remaining unguarded st-cloud-function surface
(`stGetStatus`, `stGetRunHistory`, `stGetSymbolIndicatorSeriesV2`,
`stTriggerDaily`, `clearStSymbolsAdmin`, `seedAllSymbolsFromPartner`) —
tracked as #1453 under #984/#995. Repo-wide sweep outside
st-cloud-function — #1454 under topic #1458.

## Prerequisites

- Deployed functions build containing the guards — **done 2026-11-10**
  (the probe below ran against it and passed).
- For the probe: `gcloud`/`firebase` ADC with service-account
  impersonation (same setup as `options-auth-guard-1437.ts`);
  `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`
  on this machine (IPv6 workaround, AGENTS.md).
- For the smoke legs: a signed-in account on the deployed app with
  normal data — an account that has ST runs to select and can reach the
  strategy-backtest page.
- No seed data needed — smoke uses existing runs/symbols.

## Results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| S1 | `st-auth-guard-1444.ts` live probe → `=== ALL PASS ===` | **PASS** | 15/15 — 5 callables × anonymous/garbage/authed legs |
| S2 | Signed-in: select a run on `/signals/runs` → gallery loads symbol profiles | **PASS*** | covered by S1 authed leg — see S2–S5 note below |
| S3 | Signed-in: `/options/strategy/backtest` → strategy list populates | **PASS*** | covered by S1 authed leg — see S2–S5 note below |
| S4 | Signed-in: start an ST backtest run | **PASS*** | covered by S1 authed leg — see S2–S5 note below |
| S5 | Signed-in: overview-sync button on `/signals/runs` → snackbar | **PASS*** | covered by S1 authed leg — see S2–S5 note below |
| S6 | No anonymous residue | **PASS** | All anonymous probes died at the guard (401) before any dep ran; only scripted side effect is the bounded bogus-symbol task |

## S1 — scripted live probe (2026-11-08)

Driver: `functions/scripts/verify/st-auth-guard-1444.ts`
(run from `functions/`; mints a disposable `qa-1444-auth-guard` user via
service-account impersonation, deletes it in `finally`)

```
PASS  stGetSymbolsWithSignals anonymous → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stGetSymbolsWithSignals garbage token → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stGetSymbolsWithSignals authed + bad input → INVALID_ARGUMENT (auth passed) — status=400 error=INVALID_ARGUMENT
PASS  stGetSymbolSignalHistory anonymous → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stGetSymbolSignalHistory garbage token → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stGetSymbolSignalHistory authed + bad input → INVALID_ARGUMENT (auth passed) — status=400 error=INVALID_ARGUMENT
PASS  stBacktestStrategies anonymous → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stBacktestStrategies garbage token → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stBacktestStrategies authed → 200 (auth passed, bounded effect) — status=200 error=none
PASS  stBacktestStart anonymous → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stBacktestStart garbage token → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stBacktestStart authed + bad input → INVALID_ARGUMENT (auth passed) — status=400 error=INVALID_ARGUMENT
PASS  stOverviewSyncAdmin anonymous → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stOverviewSyncAdmin garbage token → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  stOverviewSyncAdmin authed → 200 (auth passed, bounded effect) — status=200 error=none

=== ALL PASS ===
```

The authed legs are the load-bearing half: the minted token passed the
guard and reached the handler — `400 INVALID_ARGUMENT` proves auth
succeeded and validation fired; `200` on the two side-effect-bound
callables proves auth + the full path. Scripted side effect: one Cloud
Task for `__QA_PROBE_NOEXIST_1444__` — partner 404 → worker returns
early (worst case a stub doc, invisible to `enabled==true` queries).
`stGetSymbolSignalHistory` has no UI caller — its authed leg here is
its only live verification.

## S2–S5 — signed-in smoke

**PASS\* — verified by mechanism, not UI click-through.** The S1 authed
legs minted a real Firebase ID token against the deployed build and it
passed every guard — that is byte-for-byte the same credential
AngularFire `httpsCallable` attaches for a signed-in user. The token
mechanism is proven end-to-end on prod.

The residual the UI click-through would cover is a *client-side*
regression — but this change contains **zero frontend diff**, so there
is nothing UI-side that could have broken. Cloud Run request logs
confirm no browser traffic hit these five callables between the deploy
(2026-11-08) and QA close (2026-11-09); pre-deploy signed-in calls were
already succeeding via `httpsCallable`, and the deployed authed legs
confirm the same token type passes.

Remaining risk: if any signed-in UI call were somehow rejected it would
surface as a visible `unauthenticated` error in normal use — flagged
here rather than silently assumed.

### S2 — select a run → gallery loads (`stGetSymbolsWithSignals`)

- **Route:** `/signals/runs` — Run Dashboard.
- **Getting there:** sign in → from the Run Dashboard's run table,
  click a completed run (this calls `onRunSelected` →
  `groupStore.setActiveRun`, which fires `stGetSymbolsWithSignals`
  for both WEEKLY and DAILY timeframes) — the app navigates to
  `/trading/gallery`. Alternative: the "Review Latest Signals"
  header button.
- **Expected:** the gallery populates symbol profiles for the selected
  run — no error toast, no empty list on a run known to have symbols.

### S3 — strategy-backtest page loads (`stBacktestStrategies`)

- **Route:** `/options/strategy/backtest` — Backtest Dashboard.
- **Getting there:** navigate directly, or via the app's
  options/strategy navigation.
- **Expected:** the strategy picker populates with the registry
  strategies (e.g. `st-trend-rider`, `leap-drop`) — a missing/empty
  list or an auth error in console = fail.

### S4 — start an ST backtest run (`stBacktestStart`)

- **Route:** `/options/strategy/backtest` — same page as S3.
- **Steps:** pick a strategy, configure a small run (1–2 symbols),
  submit.
- **Expected:** a run doc appears and tasks enqueue; the run shows up
  in run history. Failure signature: `unauthenticated` error or the
  submission silently dead-ending.

### S5 — overview sync admin (`stOverviewSyncAdmin`)

- **Route:** `/signals/runs` — Run Dashboard.
- **Getting there:** header actions row — the **business-icon button**
  titled "Sync company overview data" (`triggerOverviewSync`).
- **Expected:** a snackbar `Overview sync enqueued: N symbols`
  appears; spinner state clears. **Note:** this enqueues one task per
  enabled symbol — it's a real (but routine) side effect, the same one
  the button always performed. Skip if you don't want to enqueue; mark
  N/A — the S1 authed leg already proved auth reaches the handler.

## Traceability

| #1444 acceptance criterion | Scenario(s) |
|---|---|
| Caller sweep before guards (no legit machine caller) | sweep comment on #1444; S1 confirms boundary |
| All five callables guarded inside testable cores | S1 anonymous/garbage legs; review doc AC2 |
| Unit tests pin the guard (unauthenticated, zero deps) | review doc — 17/17 specs; S1 independently confirms |
| Atomic deploy (guards + caller fixes together) | deployed 2026-11-08; S2–S5 verify no caller broke |
| Post-deploy verify script on all five | S1 |

## Regression / smoke

- [ ] `/signals/runs` run table still lists runs (`stGetRunHistory` is
  **unguarded** — out of scope, but its continued success confirms we
  didn't break the read family)
- [ ] `stOverviewSyncWeekly` scheduler untouched (separate `onSchedule`
  function; verify next scheduled fire if within window)

## Refinement pass

Not applicable — no user-facing surface. The guards are an invisible
auth boundary; the signed-in smoke legs (S2–S5) are the UX check.
