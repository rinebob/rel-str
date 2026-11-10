**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1365  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1401  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-10  

# Code Review — #1401: BE Task — distinguish infra 404 from shard-gap 404 in pick-doc client

## Round 2 — 2026-11-10: PASS, no third pass warranted

User-requested re-review of the post-remediation diff. All three axes
verified R1 fixes genuine and fresh-eyes checked the changed lines.

| Axis | Result | Actionable |
|---|---|---|
| Standards | APPROVE — const adoption genuine, `failPermanently` dedupe semantics-identical (merge write), new tests clean | 3 nits — 2 fixed, residual literals outside this diff noted |
| Spec | APPROVE — all asks re-traced post-remediation; `permanent` broadening to any coded 404 consistent with coded=deliberate / bare=infra; synthesized `NOT_FOUND` has no misreading consumer (pick-doc never flows through a callable) | none |
| Thermo-nuclear | APPROVE — merge-write can't clobber rows/pickDocMeta; unknown-template path actually *improved* (failed doc now well-formed); "any coded 404 = permanent" defended (coded = SA app answered deliberately; enumerating known codes would risk re-latching the #1401 bug) | 4 nits — 2 fixed |

**Round-2 remediations:**
- `options_replay_worker_permanent` warn added — a terminal no-retry was previously silent except the Firestore doc
- Probe leg C now asserts `partnerCode === undefined` — pins the bare-404 contract, not just "not the wrapper"
- `permutation.ts` header line-wrap fixed

**Noted, not fixed:**
- Residual `'NOT_FOUND'`/`'OPTIONS_NOT_ENABLED'` literals in sibling test files (`options-error-mapping.test.ts`, `options-contract-availability.test.ts`) and FE `snapshot-errors.utils.ts` — outside this diff; FE can't import the const anyway
- Invalid-window 400 burns the 3-attempt retry (deterministic but uncoded) — pre-existing, out of scope
- Leg C has no live `OPTIONS_NOT_ENABLED` leg (can't fabricate a non-enabled symbol) — unit coverage only, accepted

**Out-of-scope observation for the backlog:** `st-overview-helper.ts:101`
treats *any* 404 (incl. bare infra) as "not an equity" — same
misclassification class as #1401, different module. Flagged for a
follow-up issue.

**Re-verified:** 78/78 options-replay specs, functions typecheck clean.

**Verdict: PASS stands — a third pass would re-derive the same approvals.**

## Round 1 — 2026-11-10: PASS (all findings remediated in-cycle)

| Axis | Result | Actionable |
|---|---|---|
| Standards | APPROVE — no documented-standard violations; PartnerHttpError usage + NOT_FOUND body contract verified against live probe output | 2 judgement calls + 1 nit — **all fixed** |
| Spec | APPROVE — all three asks met; worker-layer `permanent` change judged a *necessary consequence*, not creep (bare-404-as-permanent would have failed runs with no retry — the exact pre-deploy-window case) | 1 stale header — **fixed**; worker change to be noted on issue |
| Thermo-nuclear | APPROVE — full path traced clean; retry bounded at 3 attempts; synthesized `NOT_FOUND` reachable only via genuine all-miss; probe cannot false-pass | 2 minors + 2 nits — minors **fixed**, nits noted |

### Findings remediated in-cycle

**Standards:**
- Primitive obsession — `'NOT_FOUND'`/`'OPTIONS_NOT_ENABLED'` magic strings spread across client + tests + mapper → exported `PARTNER_CODE_NOT_FOUND` / `PARTNER_CODE_OPTIONS_NOT_ENABLED` from `partner-infrastructure.ts` (the contract's owner); all use sites converted
- Stale contract paragraph — `pick-doc-client.ts` file header now documents the bare-404→propagate rule alongside the coded misses
- Duplicated code — `permutation.ts` catch's inline failed-write + close-out now delegates to the existing `failPermanently` helper

**Spec:**
- Stale semantics header — `permutation.ts` "a missing pick doc (404) … does NOT retry" clarified to coded-404 vs bare-404 (bare takes the transient path)

**Thermo-nuclear:**
- Minor — coded-404-with-unknown-code → `permanent` was an unstated, untested invariant: a coded 404 means the partner *app* answered deliberately (not GFE infra), so permanent is correct — now pinned by a dedicated spec case and covered by the comment
- Minor — probe leg B would false-fail if SA ever backfills pre-2026 shards (days <2026-01-01 become legitimate data): FAIL-B diagnosis note added to the script + guide
- Nit (noted, not fixed) — deterministic client errors (400 invalid-window, missing symbol-data) burn the 3-attempt retry; pre-existing, a 4xx whitelist would tighten but is out of scope
- Nit — probe's top-level-await + re-exec deviates from the sibling `main()/check()` pattern; justified (env must precede module-load const) and documented in the header

### Verified attack paths (thermo-nuclear trace)

- Year1 `NOT_FOUND` skip + year2 bare-404 → propagates, transient path, bounded retry → final-attempt `failed` ✓ (now pinned by a dedicated spec case)
- Bare-404 every year → propagates on first shard; never reaches the wrapper ✓
- All-miss wrapper carries `partnerCode: 'NOT_FOUND'` — reachable only when every shard genuinely answered the partner's code; consumers (`partnerHttpErrorToCallableCode` → `not-found`, FE error utils) treat it correctly ✓
- `fetchWithRetry` does not retry 404 at the transport layer — propagation is immediate ✓

### Test results

- `tests/functions/options-replay/` — **78/78 pass** (tsx, with IPv4 preload; includes 4 new #1401-pinned cases: bare-404 propagate, mid-sweep bare-404 abort, NOT_FOUND→bare-404 mixed sweep, unknown-coded-404→permanent + bare-404→retry at the worker)
- functions typecheck + `npm run build` — clean
- Live probe `pick-doc-404-semantics-1401.ts` — **3/3 PASS** vs real SA endpoint: happy path 213 days; 2015–2025 real `NOT_FOUND` bodies skipped; bogus endpoint → genuine Google infra 404 propagated

### Verdict

**PASS.** The skip is keyed on the partner's own `NOT_FOUND` code; infra misses propagate and take the bounded retry path; genuinely-absent data still fails fast.
