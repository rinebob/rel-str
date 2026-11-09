**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1444  
**Domain:** SAVANT-TRADER  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-10  

# Code Review — #1444: BUG — st-cloud-function callables accept unauthenticated calls

## Round 2 — 2026-11-10: PASS, no third pass warranted

User-requested re-review of the post-remediation diff. All three axes
verified the R1 fixes are genuine (not cosmetic) and fresh-eyes checked
the changed lines.

| Axis | Result | Actionable |
|---|---|---|
| Standards | APPROVE — all 7 R1 remediations verified correct | 1 minor + 2 nits — **fixed** |
| Spec | APPROVE — all 5 ACs re-verified MET; probe expectations traced line-by-line against the new `Array.isArray` checks (`{symbols:[]}`→invalid-argument, bogus-symbol array→skips enabled-set load) | none — informational notes only |
| Thermo-nuclear | APPROVE — delta traced clean: `null` rejected not slipped, `??` provably equivalent post-guard, `{}`→full-backfill hole closed not widened, fixtures match real writers | 1 minor — **fixed** |

**Round-2 findings (all fixed):**

- **Minor — `stGetSymbolsWithSignals` export lost its pre-existing JSDoc**
  during the R1 core extraction (the n1 fix restored the sibling's but
  missed this one) — restored on the export.
- **Minor — probe doc still over-bounded the side effect:** a partner
  `{ok:true, data:{}}` 200 would write an `overviewFetchedAt`-only stub
  doc (invisible to `enabled==true` queries) — doc + script header now
  hedge the "returns early" claim explicitly.
- **Nit — `unauthHistoryRequest` missed the JSDoc reword** its four
  siblings got — added.
- **Nit — `getFunctions().taskQueue()` re-resolves per enqueue** (was
  bound once pre-extraction) — cached by firebase-admin; accepted.

**Noted for ship-notes:** `stOverviewSyncAdmin` non-array `symbols` now
rejects (`invalid-argument`) instead of silently triggering the full
enabled-set backfill; `symbols:null` no longer means "sync everything."
Both strictly safer, both observable wire changes alongside the already
documented `internal`→`invalid-argument` conversion.

**Convergence:** Round 2 produced zero majors and zero new minors on
code paths — the only findings were two doc/comment defects introduced
by the R1 remediation itself, both fixed and re-verified (17/17 specs,
typecheck + build clean). No third pass needed; the remaining exposure
is scoped follow-ups #1453/#1454.

## Round 1 — Verdict: PASS (remediated in-cycle)

All three axes reviewed the scoped diff (four source files, four new spec
files, probe script + docs + registrations, `test:st-cloud-function`
script). One MAJOR finding was a scope question — resolved by user
decision to keep #1444 at the five enumerated callables and file
follow-ups for the wider surface. All minor/nit findings remediated
in-cycle and re-verified.

## The MAJOR finding (resolved — follow-ups filed)

**The `invoker: 'public'` grep under-counted the exposure.** Callable
endpoints deploy public-invoker by default (firebase-tools grants
`allUsers` to every callable regardless of the code-level `invoker`
option; `onRequest` endpoints are public by definition). The #1437/#1444
sweep methodology — grep for literal `invoker: 'public'` — only found
endpoints that declared it explicitly. Verified against firebase-tools'
`fabricator.ts` behavior and confirmed live in the code: `stGetStatus`,
`stGetRunHistory`, and `stGetSymbolIndicatorSeriesV2` are `onCall`
endpoints with no `request.auth` check and no explicit `invoker` — still
anonymously invocable after #1444 ships.

**Decision (user):** keep #1444 at its five enumerated callables — the
wider surface is out of topic scope. Follow-ups filed:

- **#1453 — BUG: st-cloud-function endpoints accept unauthenticated
  calls (remaining surface)** — the three in-family callables above plus
  three `onRequest` endpoints (`stTriggerDaily` — anonymous full ST run;
  `clearStSymbolsAdmin` — anonymous mass-delete of `st-symbols`;
  `seedAllSymbolsFromPartner` — anonymous upstream call + mass writes).
  Includes the design decision the `onRequest` endpoints need (shared
  secret / OIDC / convert-to-callable / stay-public).
- **#1454 — BUG: unguarded callable/onRequest endpoints accept
  unauthenticated calls (repo sweep outside st-cloud-function)** — ~25
  more endpoints across `cleanup.callables.ts` (8 anonymous mass
  deletes), `options-contract.callables.ts` (6), heatmap admin (4),
  webhooks (incl. `validateAndRegisterPairs`'s `uid:'anon'` full-backfill
  hole — likely the largest single exposure), `partner-proxy.ts`,
  `rs-signal-history.callables.ts`, `archive.ts`,
  `rs-chart-bars.callables.ts`. Flagged: some may be intentionally public
  (external callers can't mint Firebase ID tokens); several files are
  active in other sessions.

## Standards axis — REQUEST CHANGES → all actionable findings fixed

| # | Finding | Resolution |
|---|---|---|
| M1 | Three unguarded in-family callables + sweep premise wrong | Scope decision → #1453/#1454 filed |
| m1 | Input-shape hardening not carried over from #1437 idiom: `(input?.symbols \|\| []).map` throws TypeError→`internal` on `symbols:'SPY'`; `data?.symbols?.length` passes a string through to per-char enqueue | **Fixed** — `Array.isArray` check → `invalid-argument` in `handleStBacktestStart` (backtest-orchestrator.ts:66-69) and `handleStOverviewSyncAdmin` (overview-sync-orchestrator.ts:101-104) |
| m2 | Probe doc claimed bogus-symbol task "fails in the worker and retries out" — actually partner 404 → worker returns early (succeeds), and `data:{}` 200 would write a stub doc | **Fixed** — corrected mechanism in `st-auth-guard-1444.md` (×2) and the script header |
| m3 | `StDashboardDeps` exported but `BacktestStartDeps`/`BacktestStrategiesDeps`/`OverviewSyncDeps` file-private | **Fixed** — all three exported, matching the #1437 `*Deps` convention |
| m4 | Test fixtures `as StSignal`/`as StrategyMetadata` masked missing required fields (`runIds`/`ticketIds`/`positionGroupIds`/`createdAt`/`updatedAt`; `version`/`author`) + raw `'long'` instead of `TradeSide.LONG` | **Fixed** — complete typed fixtures, `TradeSide` import, casts dropped |
| n1 | Orphaned JSDoc: `stGetSymbolSignalHistory`'s descriptive block sat stacked on the core; export undoc'd | **Fixed** — block moved back to the export |
| n2/n3 | Helper duplication across spec files (precedent-consistent); `catch(error:any)`+`new Error` preserved verbatim | Accepted — noted for the record |

## Spec axis — APPROVE

| AC | Verdict |
|---|---|
| AC1 caller sweep | **Met** — independently re-verified: only callers are FE `httpsCallable` services; `stGetSymbolSignalHistory` uncalled repo-wide; scheduler calls helpers in-process; no OIDC/machine caller exists |
| AC2 guards inside testable cores | **Met** — first statement in all five cores, before validation/deps/try-catch |
| AC3 unit tests pin the guard | **Met** — per-callable guard test asserting `unauthenticated` + zero-dep proof (recorded calls/runs/enqueued arrays) |
| AC4 atomic deploy | **Met** — no caller-side fix needed; single ship unit |
| AC5 probe covering all five | **Met** — 15-leg probe; each authed expectation cross-checked against the core's actual validation order |

Minor noted: `internal`→`invalid-argument` wire-code change on
validation errors — observable contract change worth a changelog line at
ship (no caller keys off the old code).

## Thermo-nuclear axis — APPROVE

Verified clean: guard undodgeable (auth can't be injected via
`request.data`; `auth?.uid` covers undefined/empty); ordering correct
everywhere; `prodDeps` lazy — no import-time side effects; `HttpsError`
rethrows prevent flattening; scheduler unaffected; tests fail if any
guard is removed; probe cannot pass pre-deploy. The MAJOR is the same
sweep-scope finding (→ #1453/#1454); minors m1/m2/m3 mirrored standards
and were fixed in-cycle.

## Test results

- `npm run test:st-cloud-function` — **17/17** (registered script,
  package.json)
- `tests/functions/st-runs-symbols-cutover-1159.test.ts` — **7/7**
  (the only external spec touching the four modules)
- `functions` `tsc --noEmit` + `npm run build` — clean
- `typecheck:tests` — 0 errors in `st-cloud-function` specs (39
  pre-existing errors in foreign sessions' test files — paper-trading,
  rh-agent-mcp, position-groups — not introduced by this change)

## Deploy note

Guards are not live until `firebase deploy --only functions`. The probe
`st-auth-guard-1444.ts` FAILs by design until then (post-deploy check).
Deploy is held for a clean tree — foreign uncommitted BE work is present.
