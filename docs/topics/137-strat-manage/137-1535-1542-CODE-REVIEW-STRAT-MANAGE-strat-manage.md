**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1535  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1542  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# Code Review — #1542 SHARED: Manage instance ID generator

## Scope reviewed

`shared/manage-instance-id.ts` (generator + `STOP_CODES` vocabulary) ·
`shared/manage-instance-id.spec.ts` ·
`scripts/verify/strat-manage-instance-id-1542.ts` + `.md` ·
`@manage/instance-id` alias registrations (tsconfig ×2, jest) ·
`run-all.ts`/`README.md` registry entries · IMPL doc §5 sync.

Grammar under review: `{SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP}` — the emitted
id is the instance's Firestore doc id **and** dedup key, so ambiguity is
a data-integrity defect, not a cosmetic one.

## Verdict: PASS

Three axes; zero open critical/major findings. Thermo-nuclear returned
FAIL on three majors — all fixed in this pass and re-verified.

## Axis summaries

### Spec — PASS-WITH-FINDINGS

Every reconstructed AC met (sub-agent had no shell; the parent confirmed
the live AC list matches its reconstruction — all three bullets ticked on
the issue). Grammar matches the PRD/IMPL segment order and casing; all
documented examples reproducible from seeds except `SPY-IC-45-30-10-ALL`
— see F-S1.

- **F-S1 (doc divergence, resolved in doc):** the PRD/TEST depict an
  iron-condor ΔLEGS as *shorts-only* (`30-10`); the as-built emits
  `round(|Δ|*100)` **per option leg** (4 pieces for a 4-leg IC). The doc
  set was internally inconsistent — IMPL's encoding sentence said "per
  option leg" while its example said "both short deltas." Resolved in
  favor of per-leg encoding: two ICs differing only in wing width share
  their short deltas and would mint identical dedup keys under the
  shorts-only reading. IMPL §5 updated to say so explicitly. **Flagged
  for user confirm** — if the compact form was intentional, the grammar
  (not just docs) needs revisiting before multi-leg templates land.
- Nits taken: `template.code` charset-asserted (not normalized —
  assert-don't-normalize is the consistent choice here); interior-space
  symbol rejected; misleading verify check name corrected.

### Standards — PASS-WITH-FINDINGS

No critical/major. Minors fixed: `STOP_CODES` keys off `STOP_TYPE_ALL`
(single source); `stopType: StopType` (was `string`); SPREAD segment
charset check; non-finite delta guard (converged with thermo M2).
Nits noted, dispositioned below.

### Thermo-nuclear — FAIL → fixed

Three majors, all real dedup-key misfires, all fixed:

- **M1 — unvalidated `mode`:** `isValidModeStopType` treats every
  non-`'paper'` value as real, and `InstanceMode` is compile-time only —
  `mode:'PAPER'` + `stopType:'T8'` minted a real-mode dedup key.
  Fixed: `INSTANCE_MODES.includes(mode)` gate first.
- **M2 — non-finite `targetDelta`:** `NaN`/`Infinity`/`1e+21` minted
  `'NaN'`/`'Infinity'`/`'1e+23'` segments — distinct malformed inputs
  colliding on `'NaN'`, violating ALL-CAPS. Fixed: option legs require
  finite |Δ| ∈ (0,1]; a whole-id charset net catches anything residual
  (e.g. `dte 1e21 → '1e+21'`).
- **M3 — no template conformance:** `spreadSegment` checked only
  `template.id === variant.templateId`. Put legs wearing `templateId:
  'cds'` minted a byte-identical id to the call spread (the grammar
  can't see `type`/`side`). Fixed: `variantMatchesTemplate` enforced
  when a template is passed — the generator is the only enforcement
  surface today, and its own header promised exactly this.

Minors fixed: unknown/`undefined` `leg.kind` no longer fails open to
`'STK'` (explicit else-throw, covers sparse-array holes transitively via
the conformance gate); `STOP_CODES` typed `Readonly` (was mutable
`Record` inviting compile-time-valid mutation).

### Deferred / nits

- Identity omits `userId`/`trigger` — **intentional**: the contract doc
  states uniqueness is `variant × symbol × stopType` (global dedup,
  restart toggles). Confirmed against `manage-instance-contracts.ts:8`.
- `Math.round` half-boundary bucketing is representation-dependent
  (0.395→39 vs 0.455→46) — deterministic, sub-percent conflation is by
  design. No action.
- `'CUSTOM'` SPREAD segment is a literal shared with the catalog spec —
  precedent exists (`MANAGE_CUSTOM_TEMPLATE_ID` pattern); a future
  template seeded `code:'CUSTOM'` is guarded by the catalog spec's
  sentinel checks.
- `assertSegment('stop')` is unreachable today (vocabulary gate is
  stricter) — kept as a forward-guard for future bad seeds.
- Ordering invariant (long|Δ| > short|Δ| for debit templates) stays a
  create-path concern — the id grammar doesn't encode direction, and a
  conforming-but-inverted variant still mints a unique id.

## Findings ledger

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| Major | 3 (thermo M1–M3) | all fixed |
| Minor | ~8 | fixed or dispositioned above |
| Nit | ~8 | fixed or documented |

## Pass 2 — 2026-11-15

Re-ran all three axes on the post-pass-1 code (fixes in scope as new
surface). Findings were minor-class plus one major flagged with a scope
question:

- **F1 (major → DOCUMENTED, needs user decision before BE create
  lands):** the CUSTOM path still conflates what ΔLEGS can't see — an
  ad hoc put spread and an ad hoc call spread at the same |Δ|s mint the
  same `…-CUSTOM-…` id (stock-only LONG-vs-SHORT likewise). M3's
  conformance gate can't apply — there is no template. Options: encode
  type/side in CUSTOM ΔLEGS (`C50-P40` — grammar change, keeps seeded
  ids clean); require `template` at mint (breaks the spec'd CUSTOM
  emit); or accept. Dispositioned: **documented** in the module header +
  `template` JSDoc as the residual, because ad hoc variants are
  expected to resolve a named template when one exists and there are
  zero callers today — but this is a grammar decision the artifact
  workstream or the BE create path must revisit.
- **F2 (minor, fixed):** the #1541 freeze was shallow — legs arrays and
  leg objects were frozen but the template/variant **parents** weren't;
  `MANAGE_TEMPLATES[0].code = 'CUSTOM'` succeeded at runtime. Now
  `Object.freeze(t)`/`Object.freeze(v)` per entry.
- **F3 (minor, fixed):** `INSTANCE_MODES`/`INSTANCE_TRIGGERS`/
  `INSTANCE_RUN_STATES` were `readonly` but unfrozen — `INSTANCE_MODES
  .push('live')` would have silently extended the M1 mode gate. Frozen.
- **Self-caught during pass-2 setup:** my own whole-id net rejected
  `BRK.B` (first-segment class lacked `.`) — fixed + dotted-ticker spec.
- Minors fixed: `dteSegment` ran before `dlegsPiece` (raw TypeError
  instead of the curated kind error — reordered); all-dot/degenerate
  symbols admitted (charset now `[A-Z0-9]+(\.[A-Z0-9]+)*`); numeric-string
  `targetDelta` coerced via `Math.abs` (`'0.5'`→`'50'` — typeof-gated);
  non-array `legs` TypeError'd on the custom path (`Array.isArray`
  guard); verify header over-claimed STK coverage (added the check);
  redundant `as` casts removed; sibling-alias import; section banner;
  stale `dte` contract doc (diagonals can't instantiate); verify-guide
  reject list marked non-exhaustive; `dlegsPiece` order tightened.
- Nits dispositioned: sparse-array leg *holes* skip `map` (emit `--`,
  caught by the whole-id net — mechanism noted, outcome correct);
  `Math.round` FP-boundary bucketing (deterministic, by design);
  `'0'`/`'100'` ΔLEGS pieces (documented encode); `throws()` in the
  verify script is message-blind (spec anchors the messages — accepted
  asymmetry); codes `'ALL'`/`'STK'` unreservable as template codes
  (positional parse is unambiguous — cosmetic).

**Pass-2 verdict:** axes PASS-WITH-FINDINGS (standards, spec) / FAIL on
F1 only (thermo) — F1 is documented as a flagged residual pending the
user's grammar decision, not silently absorbed.

**Pass-2 test state:** 25/25 spec tests, 25/25 verify checks, all four
manage specs 62/62 green.

### Post-pass-2 design clarification (user-confirmed)

User confirmed the ad hoc semantics: **a custom variant is still based
on a template — the custom part is the delta/dte specs, not the
shape.** Consequences, applied:

- `variantMatchesTemplate` split into `variantMatchesTemplateShape`
  (kind/type/side/count — identity, what the generator gates on) +
  band membership (authoring policy — seeds, Create dialog, BE create
  path). The generator now uses the shape layer only: an out-of-band
  ad hoc variant under `cds` (e.g. 60Δ/50Δ) mints `QQQ-CDS-60-60-50-ALL`
  instead of throwing.
- F1's residual narrows further than pass-2 framing: ad hoc variants
  carry a real `templateId` and pass shape conformance — the CUSTOM
  conflation is reachable only by a truly template-free variant, the
  escape hatch the contracts already mark hypothetical. Documented in
  the module header accordingly; still flagged for the artifact-schema
  workstream.
- New pins: spec test `mints out-of-band ad hoc variants` + verify
  check `out-of-band but shape-conforming mints`. State: 26/26 verify
  checks, 63/63 manage specs.

## Test results

- Focused spec: 25/25 (was 16 pre-review; +9 guard/charset/arity tests
  across both passes).
- Verify script: 25/25 checks OK (was 18; +7 new-guard checks).
- Shared suite post-fix: 52 suites / 962 tests green.
- Full suite: 4 failures — **all foreign WIP, none on the reviewed
  surface**: `contract-list.service.ts` calls `convertOptionsContractListDoc`,
  which the in-flight #1493 session renamed to `…V1` without updating
  the consumer (3 test failures + suite compile fails). One manage-id
  spec compile error in that run was stale (pre-import-fix run;
  subsequent focused run green). App `tsc` errors likewise confined to
  foreign files (`bulk-swing-sweep.ts`, `portfolio-dashboard.store.spec.ts`).

## Files changed by this review

`shared/manage-instance-id.ts` (mode gate, finite-delta guard, template
conformance, per-segment charsets, whole-id net, else-throw on unknown
kind, `STOP_TYPE_ALL`-keyed + `Readonly` STOP_CODES, `StopType` typing)
· `shared/manage-instance-id.spec.ts` (+7 tests, STK/delta tests moved
to the ad-hoc path) · verify script (+6 checks, check rename,
hasOwnProperty) · IMPL doc §5 (as-built guards + IC ΔLEGS divergence
noted).
