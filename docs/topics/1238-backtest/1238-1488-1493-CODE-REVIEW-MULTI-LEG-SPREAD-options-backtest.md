**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1488  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1493  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-16  
**Last Updated:** 2026-11-16  

# Code Review — SHARED Task: Position-row v2 schema + v1 narrowing shim (#1493)

Deliverable: position-row schema v2 in `shared/options-replay-contracts.ts` — `ContractListPositionRow` (`kind:'position'`, `legs[]`, `repeatsPrevious`; single-leg is `legs.length === 1`, `pick` kind retired), `PositionOptionLeg`/`PositionStockLeg` discriminated union, `PositionLegMiss` + required `legMisses` on no-selection rows, `schemaVersion: 2` + `legMetas[]` on the doc — plus the v1 narrowing shim (`v1PickToPosition` / `v1RowsToPositionRows` / `v1ListDocToV2` / `positionRepeatsPrevious`), v1 shapes preserved under V1 names, mechanical V1 renames across ~20 consumer files, and the prod audit `options-replay-position-rows-1493`.

## Standards

Blocking items fixed in-code before this verdict.

- **Fixed** — `ContractListPickRow` carried no `V1` suffix while its siblings became `ContractListNoSelectionRowV1`/`ContractListRowV1`/`OptionsContractListDocV1` — an unqualified v1 type a reader could pair with the v2 union. Renamed to `ContractListPickRowV1` across all ~17 code consumers.
- **Fixed** — file header still claimed "Pure types" while the file ships `isPickDocPick`/`legToPickDocCoordinate`/`templateToOptionLeg` and now four shim functions; header rewritten honestly.
- **Fixed** — `row.reason ? { reason: row.reason } : {}` duplicated twice within four lines in `v1RowsToPositionRows`; hoisted once.
- **Fixed** — stale type references in shipped docs: `options-backtest-selection-replay-1275-contracts.md` still said "`ContractListRow` union (pick +…)"; IMPL §5's v1-names list and `positionRepeatsPrevious` semantic text updated to shipped reality.

### Advisory (non-blocking)

- `contracts.ts` is ~610 lines, the spec ~860 — both were over the size guideline before this task (+~95/+~330). A `options-replay-v1-shim.ts` split would keep contracts.ts types-pure but separates the shim from the types it narrows; deferred — the file needs a holistic split (registry sections vs types), not a piecemeal one.
- `coordEqual`/`isStr`/`Finding`/`fail`/`warn`/`--run` parsing is now a third verbatim copy across the #1491/#1492/#1493 audit scripts — the rule-of-three threshold has passed. A shared `functions/scripts/verify/lib.ts` is justified but would refactor two shipped scripts — deferred as a standalone cleanup task.
- `rows` stays mutable on both doc shapes while `legs`/`legMisses`/`legMetas` are readonly — deliberate: `rows` is the writer's accumulation field (`ContractListWrite` pushes), per-row payloads are immutable. Consistent with v1.
- `templateId` is required-typed while its comment says a merge-Partial stub "may omit it" — pre-existing inconsistency propagated from v1 to the v2 copy. Stub incompleteness is a runtime fact the type can't express; noted.
- **Staging note (not a code finding):** the working tree carries ~90 foreign-session files. The #1493 commit must stage only its own surface — same surgical discipline as #1492.

## Spec

All four acceptance criteria MET:

- **AC1 — v1 `pick` rows narrow to 1-leg positions field-for-field, incl. `repeatsPrevious` across gaps: MET.** `v1PickToPosition` spreads every day field verbatim; `v1RowsToPositionRows` normalizes the flag (`inputFlag && prev-is-position && legs-match`) so gaps/first rows/corrupt-true flags can't survive — verified by spec and the prod audit (1,267 real rows).
- **AC2 — `legMisses` carries per-leg coordinate + reason: MET.** `PositionLegMiss {legIndex, coordinate, reason?}`; markers fill `[{legIndex:0, coordinate, reason?}]`; required-field and non-empty pinned via `@ts-expect-error`.
- **AC3 — all-legs-match `repeatsPrevious` on v2 rows: MET.** `positionRepeatsPrevious` — length + kind + side equality, option legs on `contractId`, stock legs on side; marks/Greeks may drift, identity can't. Stricter than the plan's literal text (adds kind+side on option legs) — strictly stronger, docs re-synced.
- **AC4 — spec covers narrowing + new row shapes: MET.** Three describes, ~20 new cases incl. corrupt-flag and stub-doc edges.

Shim surface (4 exports vs the plan's 1) is faithful fulfillment, not creep: AC1's "across gaps" is impossible for `v1PickToPosition` alone (no sequence context), AC3 requires `positionRepeatsPrevious`, "readers see only v2" requires the doc-level entry.

- **Fixed** — `v1ListDocToV2` dereferenced `pickDocMeta.coordinate`/iterated `rows` unconditionally — a merge-Partial stub doc crashed with a bare TypeError. Now throws `incomplete v1 list doc — gate on status before narrowing` + spec pin.

## Thermo-Nuclear

Sound design; V1 boundary is honest — every unmigrated consumer wears `V1`-suffixed types matching what prod docs actually contain.

- **Fixed** — spread-order inversion in `v1PickToPosition`: stamped fields (`kind`/`side`/`coordinate`) preceded `...dayFields`, inverting the `pick-doc-mapper` convention and letting a future `DayPick.coordinate` silently overwrite the stamp. Now `{ ...dayFields, kind:'option', side, coordinate }`.
- **Fixed** — `legMisses: []` typechecked but is semantically impossible (a failed day names ≥1 leg). Now `readonly [PositionLegMiss, ...PositionLegMiss[]]`.
- **Fixed** — `legMetas` was mutable while every sibling collection is `readonly`. Now `readonly PickDocMeta[]`.
- **Fixed** — two tautological `toBeDefined()` expects after `@ts-expect-error` replaced with `void` (the compile pin is the content); non-empty-tuple `@ts-expect-error` added.
- **Resolved favorably (no change needed):** the `inputFlag && prev-is-position && legs-match` AND-chain is the minimal honest normalization — a no-op on well-formed v1 data (the v1 writer already resets on gaps) that can only tighten, never invent, a repeat. `out[]` accumulator correctly means "previous output row". `schemaVersion?: never` cleanly pins absence=v1 and also stops `ContractListWrite` (Partial-Omit of V1) from stamping `2`. `positionRepeatsPrevious`'s identity-vs-drift seam (contractId+kind+side vs marks/Greeks) is the right cut. The audit's repeat check is partially circular (re-derives via the same function) but pins each conjunct against real input — acceptable for a prod audit.
- Tautological note: shared `coordinate` object spreads by reference into every narrowed leg/miss — a mutating consumer would corrupt all rows; same pattern repo-wide, noted not blocking.

## Pass 2 — 2026-11-16

Re-ran all three axes on the post-pass-1 state (the fixes are new surface). All pass-1 fixes confirmed correct; two new fix-interaction findings plus nits, all minor-class:

- **Fixed (audit)** — `v1ListDocToV2(doc)` ran unguarded per doc while the pre-filter only checked `pickDocMeta`; the new shim throw turned a `pickDocMeta`-present/`rows`-absent doc into an audit crash aborting all remaining docs instead of a per-doc FAIL. Now wrapped in try/catch → `fail(snap.id, …); continue`. (Flagged independently by Standards + Thermo axes.)
- **Fixed (audit)** — dead `warn`: the "zero v1 docs narrowed" check ran *after* the findings print loop and the FAIL/WARN snapshot — never emitted, never counted. Moved before the summary; the vacuous-pass case now surfaces as a counted WARN.
- **Fixed (contracts)** — `positionRepeatsPrevious([], [])` returned vacuous `true` on an impossible input. `ContractListPositionRow.legs` is now `readonly [PositionLeg, ...PositionLeg[]]` (the docstring already asserted ≥1 — same pin as `legMisses`), plus a `!legs.length` early-return so the helper is honest standalone.
- **Fixed (nits)** — stub spec fixture used `"status":"error"` (not a real `OptionsContractListStatus` — now `'failed'`); three remaining `expect(x).toBeUndefined()` after `@ts-expect-error` voided for consistency with the pass-1 `void` convention.

- **Dispositioned (no change)** — `pickDocMeta.coordinate`-absent guard hardening: the Partial-stub failure mode omits meta atomically; a meta-without-coordinate doc can't be produced by the writer (meta+rows are one atomic write). Audit `coordEqual` already catches it if it ever existed. Scope discipline — no armor beyond the real data shape.
- **Dispositioned (no change)** — a `pickDocMeta`-bearing/`rows`-absent doc now fails per-doc rather than warning — unreachable via the writer; previously a bare TypeError. Strictly better.

**Pass-2 test state:** spec 50/50, consumer suites 14/184 green, prod audit PASS (6 docs, 1,267 positions, 19 markers), functions tsc clean.

## Test results

- Focused spec: **50/50** (v2 shapes, all three shim surfaces, all-legs-match branches, corrupt-flag + stub-doc edges).
- Renamed-consumer suites: **11 suites / 187 tests** green post-rename.
- Full suite (pre-review-fix run): 314/315 suites, 5,794 tests — the 1 failure is `shared/paper-trading-contracts.spec.ts`, a foreign-session spec ahead of its own implementation; zero on this surface.
- Prod audit `options-replay-position-rows-1493.ts`: **AUDIT PASS** — 6 v1 docs, 1,267 position rows + 19 markers field-for-field.
- `functions` tsc clean; root tsc's only errors are foreign-session files.

## Verdict

**PASS** — no critical/major findings; all minors fixed in-code or dispositioned above.
