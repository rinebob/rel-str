**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1488  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1491  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# Code Review — SHARED Task: Leg + variant + request/snapshot contracts (#1491)

Deliverable: the shared contract layer every multi-leg task builds on — leg/variant/snapshot types, the canonical leg→pick-doc-coordinate derivation, a mutually-exclusive start-request union, and a shrunken `{runId, symbol}` permutation payload that made the run document the worker's single source of truth.

## Standards

Three rounds of findings; all blocking items fixed in-code before this verdict.

- **Fixed** — dead field: `variantSnapshot` sat in `ReplayPermutationRunView` unread. Removed; the field stays optional on `OptionsReplayRun` for #1498 to stamp/consume.
- **Fixed** — duplicated derivation: the prod audit's leg→coordinate check reimplemented the mapping. Now consumes the canonical `legToPickDocCoordinate` so the audit proves the shared code, not a parallel copy.
- **Fixed** — overbroad field: `variantName` was accepted on every request form via the shared base. Moved to the inline-legs form only, with `variantName?: never` on the variant/legacy forms for symmetric exclusion.
- **Fixed** — silent failures: early permanent-failure guards wrote a failed list doc with no log signal. `failPermanently` now emits `options_replay_worker_permanent` at warn level on every path.
- **Fixed** — undocumented payload field: `symbol` retained on `{runId, symbol}` now carries a comment — the worker needs it to write an identifiable failed stub when the run doc itself is missing.
- **Fixed** — vacuous tests: form-narrowing specs could pass with zero assertions inside a branch. Replaced with explicit assertions on the narrowed values.

### Advisory (non-blocking)

- (minor) `shared/options-replay-contracts.ts` is 401 lines — just over the 400 smell line; the spec is 511. Both remain single-purpose and cohesive; splitting contracts now would shard one vocabulary across files. Revisit if #1498's doc-shape changes push it further.
- (minor) Transitional legacy `templateId` request form is a deliberate compatibility bridge — the FE run dialog and `qa-1439-delete`/`options-auth-guard-1437` verifiers still submit it. Quarantined for removal once the FE builder (#1507 lineage) and variant runtime (#1498) land.

## Spec

| Acceptance criterion | Verdict |
|---|---|
| `OptionLeg` / `StockLeg` / `VariantLeg` in shared contracts | **Met** — option legs carry `type` + signed `targetDelta` + `dte` + `side`; stock legs carry `side` only; `kind` discriminates |
| `legToPickDocCoordinate` canonical derivation | **Met** — emits exactly `{type, targetDelta, expiry:{mode:'nearestDte', dte}}`; put deltas signed negative, calls positive; spec pins both conventions |
| `ReplayVariant` + `VariantSnapshot` | **Met** — concrete self-describing variant + stampable snapshot shape; `OptionsReplayRun.variantSnapshot?` forward-declared for #1498 |
| Mutually-exclusive request forms | **Met** — `{variantId}` \| `{legs + variantName}` \| legacy `{templateId}`; cross-fields pinned via `?: never`; 7 exclusivity spec cases incl. `{templateId,legs}` pair |
| Shrunken permutation payload `{runId, symbol}` | **Met** — `start.ts`/`retry.ts` enqueue the reduced shape; worker reads `templateId`/`startDate` from the run doc via a `getRun` dep |
| Worker trusts run doc, not payload | **Met** — payload no longer carries selection inputs; stale/missing run data fails permanently instead of acting on poisoned values |
| Malformed run input → permanent failure | **Met** — `!templateId \|\| !startDate` guard fails permanently before `loadTradingDays` can burn retries on `undefined` |

**Scope boundary (documented, intentional):** `variantId`/`legs` forms typecheck but `start.ts` runtime-rejects them `invalid-argument` until #1498 wires variant resolution + snapshot stamping. The type runs ahead of the runtime on purpose — the alternative was shipping a contract no caller may use or pulling #1498's implementation into this task.

### Advisory (non-blocking)

- (minor) `templateId` stays **required** on `OptionsReplayRun`/`OptionsContractListDoc`. Making it optional was attempted in-review and reverted: the optionality cascades into `options-analysis` payload/record contracts (its start callable reads `doc.templateId` into a required field), which is #1498/#1501's doc-shape decision, not this task's. Likely resolution there: `variantSnapshot` replaces `templateId` as legs-run identity.
- (nit) A failed stub written when the run doc itself is missing may omit `templateId` — merge-writes are `Partial`; the field comment on `OptionsContractListDoc` says so.

## Thermo-nuclear

Full-path trace: dialog → `startOptionsReplay` → run doc + enqueue → `permutation` worker → template/coordinate resolution → list doc → contract cells.

- Verified the run doc is now the single source of truth on the worker path — no second place where `templateId`/`startDate` can diverge between enqueue and execution.
- Verified the reduced payload's `symbol` is load-bearing, not vestigial (missing-run-doc stub writes it).
- Verified `variantSnapshot` is a forward seam, not dead weight: optional on the run contract, absent from the worker view, stamped by #1498.
- Reverted-finding documented under Spec advisories (optional `templateId`): correct instinct, wrong task — the blast radius reaches `options-analysis`, so the decision moves to the task that introduces legs-form writes.
- Structural simplification check: the three-form union is the minimal honest shape given the legacy bridge; no deeper abstraction is warranted until #1498 proves the legs-form write path.

## Test results

- **Shared contract spec** (`jest`): 29/29 pass.
- **Options-replay suite** (`node:test` via tsx): 82/82 pass — incl. worker-reads-run-doc and malformed-input permanent-failure cases.
- **Full jest**: 312 suites / 5,608 tests, all pass.
- **Typechecks**: `functions` tsc clean; `tsconfig.app.json` + `tsconfig.spec.json` clean. `tests` tsconfig carries pre-existing foreign errors (gh-lifecycle, contract-availability, paper-trading fixtures) — none introduced or worsened by this task.
- **Prod audit** `options-replay-leg-contracts-1491.ts`: **AUDIT PASS** — 4/4 registry templates round-trip `legToPickDocCoordinate`; 6 real run docs all carry the fields `getRun` now requires; persisted `pickDocMeta.coordinate` chain consistent; 0 FAIL / 0 WARN.

## Second pass (2026-11-15 — user-requested re-review)

All three axes re-ran on the post-fix code. This pass surfaced **one MAJOR + two MINOR that mattered**, all fixed and re-verified:

- **MAJOR (fixed) — `payload.symbol` escaped the run-doc SoT boundary.** The payload's symbol still drove `loadTradingDays`/`fetchPickDoc`/list writes while `run.symbol` went unread — a mismatched payload could fetch and persist under the wrong symbol silently. `symbol` is now in `ReplayPermutationRunView`; the data path uses `run.symbol` exclusively and `payload.symbol` survives only to label the missing-run-doc stub. New test proves a QQQ run doc wins over a SPY payload.
- **MINOR (fixed) — presence-only malformed-input guard.** `startDate: 'garbage'` (truthy but invalid) passed the old `!startDate` check and burned the retry budget. Guard now shape-checks: `typeof` on symbol/templateId + `isValidMarketDate` on startDate. Four-case malformed matrix test added (missing templateId, missing symbol, garbage + whitespace startDate), asserting zero fetches and exactly one (failed) write.
- **MINOR (fixed) — worker-failed runs never got `error`.** `closeOutRun` now accepts and stamps `error`, matching `markRunEnqueueFailed`/`failRun` — the dominant failure path no longer leaves the FE-mapped field empty. Terminal-skip close-out forwards the list doc's own error.
- **MINOR (fixed) — `String(s)` coercion invented tickers.** `null`→'NULL', `123`→'123' passed the charset and created real run docs. Symbols are now `typeof`-filtered before normalization.
- **MINOR (fixed) — retry eligibility ignored selection inputs.** A corrupt failed run missing `templateId`/`startDate` was claimed (destroying its list doc) then permanently re-failed by the worker. Retry now no-ops on missing inputs.
- **MINOR (fixed) — stale 1275 verify script** still asserted the dead 4-key payload; updated to `{runId, symbol}` and re-verified passing.
- **MINOR (fixed) — audit Leg 3 silent-skip.** A completed run lacking `pickDocMeta.coordinate` now FAILs (absence is a contract violation, not a skip); `coordEqual` no longer crashes on a malformed persisted coordinate.

**Deferred advisories (documented, not fixed):** list-doc last-writer-wins on duplicate dispatch (commented at the running-write site — bounded at-least-once posture; run close-out is already tx-guarded); future-dated `startDate` accepted by `isValidMarketDate` (product call on semantics); crafted `runId` doc-path edges (pre-existing); empty-`legs` acceptance (belongs to #1498's runtime boundary); stray `variantName` silently dropped on the legacy form (benign, noted).

Re-verified after fixes: functions suite **93/93**, shared spec **29/29**, functions/app/spec tsc clean, prod audit **AUDIT PASS**, stale 1275 script green.

## Verdict

**PASS** — all acceptance criteria met; two full review passes (six axes total) converged to no remaining blocking findings; full suite, typechecks, and prod audit green.
