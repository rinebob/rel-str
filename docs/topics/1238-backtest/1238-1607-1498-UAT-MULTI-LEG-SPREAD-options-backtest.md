**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-spread  
**Issue:** #1607  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1498  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1498 optionsReplayStart two-form request + snapshot

## Scope

Task [#1498](https://github.com/rinebob/rel-str/issues/1498) rewired the
`optionsReplayStart` request boundary: exactly one of `variantId` /
`legs` / `templateId` resolves to a run's registry identity plus a
self-describing `variantSnapshot {variantId?, name, legs[]}` stamped on
the run doc at create — later registry edits can't rewrite history.
Inline-legs runs carry `templateId: 'custom'`; bounds guard the doc
write (legs ≤ 8, `variantName` ≤ 200 chars, canonical grid-Δ stamping).

## Prerequisites

- Node + tsx; `cd functions`.
- DRY stage: no credentials.
- `--live` stage: ADC (`firebase login`), `GOOGLE_CLOUD_PROJECT=rel-str`,
  IPv4 preload (`NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`).

## Getting to the feature

No UI — the surface is the `optionsReplayStart` callable core. Verify:

```bash
cd functions
npx tsx scripts/verify/options-replay-start-forms-1498.ts           # DRY
NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs" \
GOOGLE_CLOUD_PROJECT=rel-str \
npx tsx scripts/verify/options-replay-start-forms-1498.ts --live    # LIVE
```

## Automated evidence (fresh, post-review 2026-11-17)

| Check | Result | Evidence |
|---|---|---|
| `npm run test:options-replay` | PASS | **114/114** (0 fail; IPv4 preload set) |
| Verify DRY stage | PASS | **23/23** — all 3 forms resolve; snapshot shapes; normalization; 11-case rejection matrix |
| Verify `--live` stage | PASS | **38/38 total** — real `prodReplayStartDeps` submit → poll to terminal |
| `shared` specs (jest) | PASS | 49/49 templates (incl. `'custom'` reserved + `validateVariantLegs` pins), 15/15 options-common |
| `functions` typecheck | PASS | 0 errors |

## Scenarios

### S1 — `{variantId}` form resolves and stamps (AC1/AC2)

- Submit `{variantId:'pcs-45-20-5', symbols:['SPY'], startDate}` via
  dry/live stages.
- **Expected:** run doc `templateId='pcs-45-20-5'`, `variantSnapshot`
  `{variantId:'pcs-45-20-5', name:'45DTE 20/5Δ put credit spread',
  legs:[short put -0.20Δ 45DTE, long put -0.05Δ 45DTE]}`; live run fails
  `'Unknown templateId'` under the pre-#1499 worker (expected terminal).
- **Result/evidence:** **PASS** — dry asserts + live doc persisted
  (`…_rirbur_SPY` → `failed` as designed until #1499).

### S2 — `{legs[]}` inline form validates, normalizes, stamps (AC1/AC2)

- Submit 2-leg inline `[short put -0.20Δ 45DTE, long stock]` (+ a stray
  extra key); with/without `variantName`.
- **Expected:** `templateId='custom'`, `variantId` absent, name
  `variantName ‖ 'custom 2-leg'`; legs normalized to contract fields
  (stray key dropped); Δ canonicalized to grid (e.g. -0.19999 → -0.2).
- **Result/evidence:** **PASS** — dry asserts all shapes; live doc
  `…_w79um3_SPY` → `failed 'Unknown templateId 'custom''` as designed;
  canonical-Δ pinned by unit spec.

### S3 — Legacy `{templateId}` form unchanged + snapshot (regression)

- Submit `{templateId:'csp-45-20', symbols:['SPY'], startDate}`.
- **Expected:** `templateId='csp-45-20'`, snapshot `{variantId:'csp-45-20',
  name:'45DTE 20Δ put (CSP)', legs:[1 option leg]}`; `Unknown templateId`
  rejection identical for bad ids; the **live run completes** under the
  deployed worker (backward compat).
- **Result/evidence:** **PASS** — live run `…_200vms_SPY` → `completed`;
  `getReplayTemplate` semantics verbatim.

### S4 — Form exclusivity + bounds (AC1)

- Submit none / all pairs / all three of `variantId`/`legs`/`templateId`;
  `legs:[]`, `legs:'x'`, `legs:null`, `legs` >8, `variantName` non-string
  or >200 chars, unknown `variantId`, duplicate/off-grid legs.
- **Expected:** every case → `invalid-argument`, zero runs created,
  zero enqueues.
- **Result/evidence:** **PASS** — dry rejection matrix 11/11; unit
  table covers all pairs + triple + bounds.

### S5 — Fanout + enqueue-failure doctrine (AC3/AC4)

- Multi-symbol submit; one `enqueue` throws.
- **Expected:** payload exactly `{runId, symbol}` per symbol; the
  failing symbol's run lands `failed` with the error — remaining
  symbols unaffected.
- **Result/evidence:** **PASS** — unit spec asserts payload key set +
  per-run failure isolation; live stage earlier proved
  `markRunEnqueueFailed` against real Firestore (service-account
  enqueue error → run marked `failed`).

### S6 — Self-describing snapshot (AC2 refinement)

- A stamped `variantSnapshot` carries everything needed to replay:
  concrete legs (kind/type/Δ/dte/side) + name + optional variantId —
  no registry read required by the worker (#1499 contract).
- **Result/evidence:** **PASS** — snapshot deep-equality asserted in
  unit + verify docs; `OptionsReplayRunWrite` makes it required at
  write time.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface (callable boundary + run-doc
schema only; the FE dialog lands in #1504/#1505).

## Findings

- None during QA. Review-cycle remediations already covered: doc-size
  bounds, `'custom'` reservation, canonical-Δ stamping, registration.

## Traceability

| AC | Scenario |
|---|---|
| Both forms accepted; neither/both → invalid-argument | S1, S2, S4 |
| Run doc carries resolved snapshot (self-describing) | S1, S2, S3, S6 |
| Enqueue failure → failed run | S5 |
| Unit tests via ReplayStartDeps fakes | 114/114 suite |
| Fanout unchanged; payload `{runId, symbol}` | S5, dry payload assert |

## Regression / smoke

- [x] Legacy templateId path — live `completed` run proves deployed-worker compat
- [x] Registry drift guard unchanged — 49/49 spec incl. `'custom'` reserved pin
- [x] Run-all registration — script in `functions/scripts/verify/run-all.ts` + READMEs

## Verdict

**PASS** — all scenarios verified fresh post-review with automated +
live-prod evidence.

## Results log

- 2026-11-17 — impl done → review PASS (1 major remediated) → QA
  execution: 114/114 unit, 23/23 dry, 38/38 live (3 real runs:
  templateId completed; variant/legs failed as designed until #1499).
