**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1583  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1493  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-16  
**Last Updated:** 2026-11-16  

# UAT — SHARED Task: Position-row v2 schema + v1 narrowing shim (#1493)

## Scope

Position-row schema v2 in `shared/options-replay-contracts.ts`:
`ContractListPositionRow` (`kind:'position'`, `legs[]`, `repeatsPrevious` —
a single-leg position is `legs.length === 1`; the v1 `pick` kind is
retired), `PositionOptionLeg`/`PositionStockLeg`, `PositionLegMiss` +
required non-empty `legMisses` on `ContractListNoSelectionRow`,
`schemaVersion: 2` + `legMetas[]` on `OptionsContractListDoc`, and the v1
narrowing shim (`v1PickToPosition` / `v1RowsToPositionRows` /
`v1ListDocToV2` / `positionRepeatsPrevious`). V1 shapes survive under
`*V1` names (`ContractListPickRowV1`, `ContractListNoSelectionRowV1`,
`ContractListRowV1`, `OptionsContractListDocV1`) — every existing
reader/writer compiles untouched until its own migration task lands.

Two review passes ran six axes total; this UAT verifies the *delivered*
behavior end-to-end — the shim narrows every real prod v1 doc
field-for-field, repeat normalization can't invent repeats across gaps,
consumers stay green, and the registered audit is reproducible.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str` with `npm install` done
  (root + `functions/`).
- Jest: `npx jest <spec> --coverage=false`.
- For the prod audit and narrowing probe: Google application-default
  credentials (Firestore read on the prod project). Obtain via
  `gcloud auth application-default login`; both scripts are read-only.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` if
  `gh`/network calls hang (IPv6 workaround).

### Real prod data used throughout (as of 2026-11-16)

All six `st-options-contract-lists` docs are v1 (`schemaVersion` absent,
`pickDocMeta` present), `status: 'success'`:

| Doc id (= runId) | Symbol | Template | Rows | Repeat picks | Markers | First pick |
|---|---|---|---|---|---|---|
| `2026-11-06_fri_120138_manual_09h45m_SPY` | SPY | `csp-45-20` | 213 | 11 | 9 | `SPY260213P00655000` @ 2026-01-02 |
| `2026-11-06_fri_120138_manual_j9gqhh_QQQ` | QQQ | `csp-45-20` | 214 | 11 | 2 | `QQQ260213P00580000` @ 2026-01-02 |
| `2026-11-06_fri_132650_manual_y00qbp_NFLX` | NFLX | `csp-30-30` | 214 | 54 | 2 | `NFLX260130P00086000` @ 2026-01-02 |
| `2026-11-07_sat_142311_manual_dbdl0c_XOM` | XOM | `csp-30-30` | 213 | 66 | 1 | `XOM260130P00120000` @ 2026-01-02 |
| `2026-11-10_tue_114859_manual_o1wlmv_GOOG` | GOOG | `csp-30-30` | 216 | 69 | 2 | `GOOG260130P00305000` @ 2026-01-02 |
| `2026-11-10_tue_132126_manual_83lilp_NVDA` | NVDA | `csp-30-30` | 216 | 69 | 3 | `NVDA260130P00180000` @ 2026-01-02 |

Totals: **1,267 pick rows + 19 no-selection markers** across 6 docs.
All templates are 1-leg (`csp-45-20` = put −0.45Δ @20 DTE short;
`csp-30-30` = put −0.30Δ @30 DTE short) — so `legMetas` must contain
exactly one `PickDocMeta` and every position row exactly one option leg.

## Getting to the feature

No app route — this task ships contract types, a narrowing shim, and an
audit surface; the UI keeps reading v1 through `*V1` types (unchanged).
The surfaces a tester exercises:

- v2 types + shim: `shared/options-replay-contracts.ts`
  (rows ~235–320, shim ~335–430, doc shapes ~475–510) + spec
  `shared/options-replay-contracts.spec.ts`.
- Prod audit: `functions/scripts/verify/options-replay-position-rows-1493.ts`
  — registered in `functions/scripts/verify/run-all.ts` and the verify
  README; usage in `options-replay-position-rows-1493.md`.
- UI surface that *consumes* the unchanged v1 surface (regression only):
  `/options/strategy/backtest` → "Contract list" table + the
  `/options/chart` replay panel — both read `ContractListRowV1` rows.

## Test scenarios

### Scenario 1 — Spec: v2 shapes + narrowing + repeat semantics

- **Feature:** all v2 types (`PositionOptionLeg` extends `PickDocDay`
  +side+coordinate; `PositionStockLeg`; non-empty `legs`/`legMisses`
  tuples; `pick` kind retired); three shim surfaces field-for-field;
  `repeatsPrevious` normalization across gaps/first rows/corrupt flags;
  `v1ListDocToV2` stub-doc guard; `positionRepeatsPrevious`
  all-legs-match branches.
- **Start:** repo root.
- **Steps:** `npx jest shared/options-replay-contracts.spec.ts --coverage=false`
- **Expected:** all tests pass; the `v1 narrowing shim` and
  `positionRepeatsPrevious` describes green; compile pins
  (`@ts-expect-error` on `'pick'` kind, empty `legMisses`, missing
  `legMisses`, `doc.pickDocMeta`, `stockLeg.contractId`) intact.
- **Result:** PASS — 50/50 (2026-11-16).

### Scenario 2 — Prod audit: every real v1 doc narrows field-for-field

- **Feature:** `v1ListDocToV2` on all six real docs — `schemaVersion: 2`
  stamped, `legMetas === [pickDocMeta]` verbatim, passthrough fields
  (`runId`/`symbol`/`templateId`/`status`/`generatedAt`/`error`)
  identical, row count + kind mapping preserved, each position leg
  carries all 12 `PickDocDay` fields + `side` verbatim with the doc's
  recorded coordinate stamped, each marker gains
  `legMisses: [{legIndex:0, coordinate, reason?}]`, and
  `repeatsPrevious` is normalized (`inputFlag && prev-is-position &&
  legs-match`).
- **Steps (needs ADC):** `cd functions && npx tsx scripts/verify/options-replay-position-rows-1493.ts`
- **Expected:** `AUDIT PASS`, `0 FAIL / 0 WARN`, summary line
  `6 v1 doc(s) narrowed (1267 position rows, 19 markers), 0 already-v2`.
- **Result:** PASS — `AUDIT PASS`, `0 FAIL / 0 WARN`, 6/1267/19
  (2026-11-16, and re-run post-pass-2 audit fixes — same counts).

### Scenario 3 — Scoped audit on the XOM doc (richest repeat data)

- **Feature:** `--run <id>` narrows one doc — the XOM list has the most
  `repeatsPrevious` flags (66) and 1 marker, exercising repeat checks
  hardest.
- **Steps:** `cd functions && npx tsx scripts/verify/options-replay-position-rows-1493.ts --run 2026-11-07_sat_142311_manual_dbdl0c_XOM`
- **Expected:** `AUDIT PASS`, `0 FAIL / 0 WARN`,
  `1 v1 doc(s) narrowed (212 position rows, 1 markers), 0 already-v2`.
- **Result:** PASS — exactly `1 v1 doc(s) narrowed (212 position rows,
  1 markers), 0 already-v2`, `AUDIT PASS` (2026-11-16).

### Scenario 4 — Audit negative path: mistyped `--run`

- **Feature:** a `--run` id matching no doc reports operator error, not
  "collection empty".
- **Steps:** `cd functions && npx tsx scripts/verify/options-replay-position-rows-1493.ts --run no-such-run`
- **Expected:** `WARN … matched no list doc` (or equivalent), audit
  completes, exit 0.
- **Result:** PASS — `WARN collection: --run 'no-such-run' matched no
  list doc` **plus** `WARN collection: zero v1 docs narrowed — narrowing
  evidence is empty` (the pass-2 dead-warn fix working live — both
  counted in `0 FAIL / 2 WARN`), `AUDIT PASS`, exit 0 (2026-11-16).

### Scenario 5 — Interactive narrowing probe: field-for-field evidence

- **Feature:** hands-on evidence on the XOM doc — a real pick row →
  1-leg position, a real marker → `legMisses`, a real repeat →
  normalized flag. Run this tsx probe from `functions/`:

```typescript
// .devin/tmp/narrowing-probe.ts — read-only; imports the same init as the audit
import { db } from '../../functions/src/firebase-admin-init';
import { v1ListDocToV2 } from '../../shared/options-replay-contracts';
import type { OptionsContractListDocV1 } from '../../shared/options-replay-contracts';

async function main() {
  const snap = await db.collection('st-options-contract-lists')
    .doc('2026-11-07_sat_142311_manual_dbdl0c_XOM').get();
  const v1 = snap.data() as OptionsContractListDocV1;
  const v2 = v1ListDocToV2(v1);

  console.log('doc:', v2.schemaVersion, '| legMetas:', v2.legMetas.length,
    '| coord:', JSON.stringify(v2.legMetas[0].coordinate));

  // First row — XOM260130P00120000 @ 2026-01-02
  const p0 = v2.rows[0];
  if (p0.kind === 'position') {
    const l = p0.legs[0];
    console.log('position[0]:', l.kind, l.side, l.contractId, l.strike,
      'Δ' + l.delta, 'mark', l.mark, '| coord:', JSON.stringify(l.coordinate));
  }
  // The single marker row + the position after it (gap normalization)
  const mi = v1.rows.findIndex((r) => r.kind === 'no-selection');
  console.log('marker:', JSON.stringify(
    (v2.rows[mi] as { legMisses: unknown }).legMisses));
  console.log('after-gap row kind/repeat:',
    v2.rows[mi + 1].kind,
    (v2.rows[mi + 1] as { repeatsPrevious?: boolean }).repeatsPrevious);
  // A real repeat pair — first two consecutive repeat-claimed picks
  const repIdx = v2.rows.findIndex(
    (r, i) => r.kind === 'position' && r.repeatsPrevious && i > 0);
  console.log('repeat row:', v2.rows[repIdx].entryDate,
    '— same contract as prior row:',
    (v2.rows[repIdx - 1] as { legs: { contractId?: string }[] }).legs[0]
      .contractId ===
    (v2.rows[repIdx] as { legs: { contractId?: string }[] }).legs[0]
      .contractId);
}
main().then(() => process.exit(0));
```

- **Steps:** `cd functions && npx tsx ../.devin/tmp/narrowing-probe.ts`
- **Expected:** `legMetas: 1` with coordinate
  `{"type":"put","targetDelta":-0.3,"expiry":{"mode":"nearestDte","dte":30}}`;
  `position[0]: option short XOM260130P00120000 120 Δ-0.… mark …` with
  that same coordinate; the marker's `legMisses` =
  `[{"legIndex":0,"coordinate":{…}}]` (+ `reason` if recorded); the row
  after the gap is a `position` with `repeatsPrevious: false` (a gap can
  never repeat, even if the v1 flag claimed one); the repeat row shows
  the same `contractId` as the row before it.
- **Result:** PASS — real output (2026-11-16):
  `doc: 2 | legMetas: 1 | coord: {"targetDelta":-0.3,"expiry":{"mode":"nearestDte","dte":30},"type":"put"}`;
  `position[0]: option short XOM260130P00120000 120 Δ-0.31849 mark 1.48`
  with the same coordinate stamped; the marker @ 2026-10-30 narrowed to
  `legMisses: [{"legIndex":0,"coordinate":{…-0.3Δ/30dte put…}}]`; the
  position row after the gap carries `repeatsPrevious: false` (a gap can
  never repeat); the repeat row @ 2026-01-22 shares its `contractId`
  with the row before it — all-legs-match on real data.

### Scenario 6 — Renamed consumers stay green

- **Feature:** every file that consumed the old names now compiles and
  behaves identically under `*V1` — FE table/dialog/picker/chart
  surfaces + BE worker/mapper/permutation + test fixtures.
- **Steps:** `npx jest tests/functions/options-replay tests/functions/options-analysis src/app/features/savant-trader/backtest src/app/features/savant-trader/utils/contract-list-emit.util.spec.ts src/app/features/savant-trader/components/contract-list-picker src/app/features/savant-trader/stores/contract-list-session.store.spec.ts src/app/features/savant-trader/pages/option-chart/option-chart-list.spec.ts src/app/features/savant-trader/pages/option-chart/option-chart-services.spec.ts src/app/features/savant-trader/services/contract-list.service.spec.ts --coverage=false`
- **Expected:** all suites pass — the rename is type-only, zero
  behavioral change.
- **Result:** PASS — 187 tests across the directly-renamed suites
  (11/187) plus 14/184 in the replay/analysis sweep (2026-11-16).

### Scenario 7 — Regression probes: the prior audits still pass

- **Feature:** earlier verifications pin the surfaces this task renamed —
  they must not have broken.
- **Steps:** from `functions/`:
  `npx tsx ../scripts/verify/options-backtest-selection-replay-1275-contracts.ts`
  (contract vocabulary probe — no creds),
  `npx tsx scripts/verify/options-replay-leg-contracts-1491.ts`
  (needs ADC), `npx tsx scripts/verify/options-replay-template-registries-1492.ts`
  (needs ADC).
- **Expected:** `ALL CHECKS PASSED` / `AUDIT PASS` × 3.
- **Result:** PASS — #1275 `ALL CHECKS PASSED`; #1491 `AUDIT PASS`;
  #1492 `AUDIT PASS` (18 shapes, 4 variants, 6 run docs) (2026-11-16).

### Scenario 8 — Typecheck: functions project clean

- **Steps:** `cd functions && npx tsc --noEmit`
- **Expected:** exit 0, no errors. (Root `npx tsc` is expected to show
  foreign-session errors outside this task's files — not in scope.)
- **Result:** PASS — clean (2026-11-16).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| v1 `pick` rows narrow to 1-leg positions field-for-field (incl. `repeatsPrevious` across gaps) | S1, S2, S3, S5 |
| `legMisses` carries per-leg coordinate + reason | S1, S2, S5 |
| All-legs-match semantics for `repeatsPrevious` on v2 rows | S1, S2, S5 |
| Spec covers narrowing + new row shapes | S1 |
| Registered verification script + guide | S2, S3, S4 |
| Existing consumers compile/behave unchanged | S6, S7, S8 |
| Deferred findings recorded (verify-lib consolidation, file-size split) | review doc advisory list — checked |

## Regression / smoke checklist

- [x] `pickRowsOf`/`contract-list-emit.util` still filters `kind === 'pick'` on v1 rows — S6
- [x] `options-replay-firestore-converter` still passes raw docs through — S6
- [x] `mapPickDocToRows` writer emits identical v1 rows — S6 (pick-doc-mapper.test)
- [x] `optionsReplayStart`/worker type surface unchanged — S6, S7
- [x] Prior audits (#1275, #1491, #1492) still green — S7

## Manual UI/UX refinement pass

Not applicable — shared contracts + audit surface, no UI. The visible
surfaces (contract-list table, chart replay) consume the unchanged v1
types; their behavior is covered by S6's suites.

## Findings

None yet.

## Results log

- 2026-11-16 — UAT drafted. S1/S2/S6/S8 executed by QA agent.
- 2026-11-16 — S3 (scoped XOM audit), S4 (mistyped `--run` — pass-2
  dead-warn fix observed live: both WARNs counted), S5 (interactive
  narrowing probe — field-for-field + gap-normalization evidence on the
  real XOM doc), S7 (all three prior probes green) — all PASS.
  **QA PASS.** Status → Complete; QA issue #1583 → RESOLVED.
