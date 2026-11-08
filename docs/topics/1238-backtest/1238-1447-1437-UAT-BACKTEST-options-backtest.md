**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1437  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

# UAT — #1437: BUG — Options Replay/Analysis callables accept unauthenticated calls

QA issue: **#1447 — QA: Options Replay/Analysis callables auth guards**

## Results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| S1 | `options-auth-guard-1437.ts` live probe → `=== ALL PASS ===` | **PASS** | 12/12 — 4 callables × anonymous/garbage/authed-malformed |
| S2 | Signed-in regression: start a Selection Replay run | **PASS** (user-verified) | AngularFire `httpsCallable` attaches the ID token automatically — guard transparent to signed-in calls |
| S3 | Signed-in regression: retry a failed run | **PASS** (user-verified) | same path |
| S4 | Signed-in regression: start an analysis run | **PASS** (user-verified) | same path |
| S5 | No anonymous residue | **PASS** | All anonymous probes died at the guard (401) before any dep ran — no writes possible; probes carry no side-effect paths by construction |

## S1 — scripted live probe (2026-11-07)

Driver: `functions/scripts/verify/options-auth-guard-1437.ts`
(run post-deploy; mints a disposable `qa-1437-auth-guard` user via
service-account impersonation, deletes it in `finally`)

```
PASS  optionsReplayStart anonymous → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  optionsReplayStart garbage token → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  optionsReplayStart authed + bad input → INVALID_ARGUMENT (auth passed) — status=400 error=INVALID_ARGUMENT
PASS  optionsReplayRetry anonymous → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  optionsReplayRetry garbage token → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  optionsReplayRetry authed + bad input → INVALID_ARGUMENT (auth passed) — status=400 error=INVALID_ARGUMENT
PASS  optionsAnalysisStart anonymous → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  optionsAnalysisStart garbage token → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  optionsAnalysisStart authed + bad input → INVALID_ARGUMENT (auth passed) — status=400 error=INVALID_ARGUMENT
PASS  optionsReplayDelete anonymous → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  optionsReplayDelete garbage token → UNAUTHENTICATED — status=401 error=UNAUTHENTICATED
PASS  optionsReplayDelete authed + bad input → INVALID_ARGUMENT (auth passed) — status=400 error=INVALID_ARGUMENT

=== ALL PASS ===
```

The `authed + bad input → INVALID_ARGUMENT` leg is the load-bearing
half: auth passed the guard and the request reached validation —
proof the boundary rejects strangers without breaking legitimate
signed-in calls.

## S2–S4 — signed-in smoke (manual)

Each is a regression check that AngularFire's token flow is unbroken:
start a replay run, retry a failed run, start an analysis run from
the app UI. All three should behave exactly as before the guard —
any signed-in failure here would mean the guard is eating real calls.
