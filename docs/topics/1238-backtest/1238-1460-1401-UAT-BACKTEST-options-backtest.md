**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1460  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1401  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-10  

# UAT — #1401: pick-doc client — distinguish infra 404 from shard-gap 404

## Background

During #1398 QA a Selection Replay run's failures turned out to be Google
infra 404s (the `partnerOptionsDeltaPicksV1` endpoint didn't exist yet),
but `fetchPickDoc` skipped **any** 404 that wasn't `OPTIONS_NOT_ENABLED`
as a "coverage gap" — so the run's error read `no year shard found`,
presenting a transport/config failure as a data-availability failure and
costing a cross-project debugging session.

#1401 narrows the skip: only `404 + partnerCode 'NOT_FOUND'` (the partner
app's own shard-miss contract) counts as a coverage gap. Bare 404s — GFE
HTML "Page not found" — now propagate. As a coordinated consequence,
`runReplayPermutation` now classifies permanence on the *code*, not the
status: coded 404 → permanent fail-fast; bare 404 → transient (Cloud
Tasks retry, bounded 3 attempts). The all-miss wrapper carries
`partnerCode: 'NOT_FOUND'` so genuinely-absent data stays permanent.

## Scope

| Acceptance criterion | Verified by |
|---|---|
| `partnerCode === 'NOT_FOUND'` required for the shard-gap skip | S1-B, S2 |
| Bare 404s propagate as fetch failures | S1-C, S2 |
| Tests: bare-404 case added; NOT_FOUND skip + OPTIONS_NOT_ENABLED propagation kept | S2 |
| (beyond-literal) worker: coded-404 → permanent, bare-404 → retryable | S2, S3* |

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`, `functions/` deps installed
- **Google ADC** with impersonation rights over
  `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
  (the probe mints ID tokens against the live SA partner endpoint)
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (IPv6
  workaround — required for partner calls in this environment)
- Node ≥ 20 (`tsx --test` runs the specs)

## Getting to the feature

**There is no UI surface for this change** — it is backend error
classification inside the options-replay pipeline:

`optionsReplayPermutation` worker → `fetchPickDoc` → SA
`partnerOptionsDeltaPicksV1` year-shard fetches.

The verification surface is the live probe + spec suite. The only
end-user-observable difference: a Selection Replay list doc's `error`
field — an infra failure now reads the upstream 404 message instead of
`no year shard found in [Y, Y]` (visible on the Options Backtest replay
runs view for a failed run).

## Scenarios

### S1 — Live probe (scripted) ✅ EXECUTED 2026-11-10

```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx scripts/verify/pick-doc-404-semantics-1401.ts
```

| Leg | Expects | Result |
|---|---|---|
| A — happy path | `fetchPickDoc` returns a real doc (QQQ put −0.20/45-DTE, 2026) | **PASS** — 213 days, 2026-01-02→2026-11-06 |
| B — shard-gap skip | window 2015→2026: pre-coverage years return real `{"code":"NOT_FOUND"}` → skipped; merged doc has only ≥2026-01-01 days | **PASS** — 213 days, all ≥2026-01-01; 11 shard misses logged `partnerPickDoc_shard_skipped` |
| C — infra-404 propagates | bogus endpoint on the real host → genuine GFE HTML 404 → `fetchPickDoc` rejects with the upstream error, never the `no year shard` wrapper, `partnerCode === undefined` | **PASS** — child probe exited with the propagated bare-404 |

Evidence: probe output `PASS A / PASS B / PASS C / === ALL PASS ===`,
exit 0, run 2026-11-10 (this doc's second run — first run identical).

### S2 — Spec suite (scripted) ✅ EXECUTED 2026-11-10

```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx --test ../tests/functions/options-replay/*.test.ts
```

**Result: 78/78 pass.** The #1401-pinned cases:

- `pick-doc-client.test.ts` — bare-404 propagates (not the wrapper);
  mid-sweep bare-404 aborts (earlier shard success can't mask it);
  NOT_FOUND-skip-then-bare-404 mixed sweep; all-miss wrapper carries
  `partnerCode === NOT_FOUND`; NOT_FOUND skip + OPTIONS_NOT_ENABLED
  propagation retained
- `permutation.test.ts` — bare-404 → rethrow for task retry (transient);
  coded-404 (`NOT_FOUND`, and unknown code `SHARD_STALE`) → permanent
  fail-fast, failed doc + failed close-out

### S3 — Post-deploy prod smoke ✅ EXECUTED 2026-11-10

Deploy `firebase deploy --only functions` rolled out ~19:51Z. Post-deploy
observations (`gcloud logging read`, service `optionsreplaypermutation`):

- [x] Real run on the new build completes clean — **NVDA 21:21Z**:
      `options_replay_start` → `partnerPickDoc_request` (2026) →
      `options_replay_worker_complete`, no errors
- [x] Probe re-run post-deploy — 3/3 PASS (shard-gap skip + infra-404
      propagation unchanged against the live SA endpoint)
- [~] Coded-404 fail-fast with `options_replay_worker_permanent` marker —
      **not organically exercised** (no run hit a genuinely-absent
      coordinate); pinned by S2 specs + S1 probe
- [~] Bare-404 → Cloud Tasks retry in prod — **not organically
      exercised** (no infra failure occurred); pinned by S2 specs + S1-C

The happy-path run through the deployed worker confirms the change
didn't break the main flow; the error-classification fork is verified
by S1 (live probe against the real SA contract) and S2 (78/78 specs)
rather than awaiting a production failure.

## Regression checklist

- [x] Non-404 partner failures unaffected (400 off-grid propagates
      immediately — spec-pinned)
- [x] OPTIONS_NOT_ENABLED still fails permanently (coded → permanent —
      spec-pinned)
- [x] Terminal-doc short-circuit / idempotent retry path untouched —
      covered by the existing permutation specs (all pass)
- [x] `partnerHttpErrorToCallableCode` consumers (`options-contract`
      callables) unchanged in behavior — coded/bare 404 both map to
      `not-found`
- [x] functions typecheck + `npm run build` — clean

## Traceability

| Criterion | S1 | S2 | S3 |
|---|---|---|---|
| Skip requires `partnerCode === 'NOT_FOUND'` | ✓ | ✓ | |
| Bare 404 propagates | ✓ | ✓ | |
| Tests updated per issue | | ✓ | |
| Worker permanent/transient split | | ✓ | ✓* |

\* post-deploy: worker live + completing real runs; error fork not organically exercised

## Result log

| Scenario | Result | Evidence | Date |
|---|---|---|---|
| S1 probe | **PASS** | 3/3 legs, exit 0 | 2026-11-10 |
| S2 specs | **PASS** | 78/78 | 2026-11-10 |
| S3 prod smoke | **PASS** | NVDA run 21:21Z complete on new build; probe 3/3 post-deploy | 2026-11-10 |
