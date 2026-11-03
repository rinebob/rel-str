**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1364  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1368  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# Code Review — #1368 analysis-results collection + rules + indexes

**Verdict:** **PASS** (no criticals/majors; one shared nit-class consolidated and closed in-cycle)  
**Test gate:** jest full suite **287 suites / 4,963 tests PASS**; targeted `shared/st-collections` + `shared/options-analysis` 46/46; `test:st-rules-indexes` 15/15; both verify scripts clean; functions `tsc --noEmit` + esbuild clean.

Three axes run in parallel per review protocol. Findings are consolidated here.

---

## Thermo-Nuclear (deep structural review)

**Verdict: essentially clean.** No critical or major findings. Verified explicitly:

- Doc-key "never parse it back" discipline enforced on both the builder comment and consumers; the doc denormalizes `contractListDocId`/`runId`/`symbol`/`exitId` as fields, so no consumer needs to split.
- Rules block correct: flat-root `{docId}` wildcard (not `{runId}`), `allow write: if false`, positioned before the default-deny catch-all; block ordering pinned globally by the spec's first assertion.
- Index design covers every documented query shape; nothing missing.
- Versioning interplay (`{list}_{exit}` overwrite + `registryVersion` staleness detection) documented as intended.

| # | Finding | Disposition |
|---|---|---|
| TN-1 (minor) | Options domain now has three flat `st-options-*` roots — drifting toward the sprawl the anchor pattern exists to prevent | **ADDRESSED** — flat-family rationale noted on `ST_OPTIONS_ANALYSIS_RESULTS_ROOT` (deliberate family; revisit if a fourth record kind appears). Retrofitting shipped collections is out of scope. |
| TN-2 (minor) | `set(merge:true)` + optional `error?` = stale `error` string on failed→success rewrite | **ADDRESSED** — IMPL-BE write step now requires clearing `error` on terminal success writes (`FieldValue.delete()` or full `set`). Forward-noted for #1372. |
| TN-3 (nit) | `contractListDocId+exitId` composite exceeds documented query needs | **ACCEPTED** — spec-mandated verbatim by IMPL-SHARED §indexes; near-zero cost at this write volume; also serves `orderBy(exitId)`/compound filters. |
| TN-4 (nit) | Read-only rules regexes not anchored to the block's closing `}` — an appended `allow create` leg would pass | **FIXED** — `\s*\}` anchor added to all five read-only patterns (pre-existing hole across the family, cheap to close once). |
| TN-5 (nit) | #1367 verify script composes `{list}_{exitId}` by literal concat — second source of truth now that the builder exists | **FIXED** — routed through `stOptionsAnalysisResultDocId` + `ST_OPTIONS_ANALYSIS_RESULTS_ROOT`. |
| TN-6 (nit) | Key-segment naming drift: `{listId}` vs `{contractListDocId}` vs `{listDocId}` | **FIXED** — header recap now uses `{contractListDocId}` (matches the builder param + contracts). Doc prose keeps `{listDocId}` where it's shorthand for the segment. |
| TN-7 (nit) | Builder takes `contractListDocId` as opaque `string`; zero input normalization vs sibling builder | **ACCEPTED** — same trust model as precedent; a branded type is over-engineering for v1. Registry charset spec guards `exitId`. |

## Standards

**Verdict: essentially clean — 4 nits, no violations.** Naming, placement, JSDoc conventions, spec ordering, rules policy shape, index JSON shape, and verify-script conventions all match the #1276/#1367 precedents.

| # | Finding | Disposition |
|---|---|---|
| S-1 | Header recap `{listId}_{exitId}` vs builder param `contractListDocId` | **FIXED** (same as TN-6) |
| S-2 | Two comments claim `exitId` guarded to `[a-z0-9-]`; actual guard is `/^[a-z0-9][a-z0-9-]*$/` | **FIXED** — both comments now cite the exact regex. |
| S-3 | Comment enumerates 3 of the 5 read-only roots | **FIXED** — comment genericized + documents the new `\s*\}` anchor. |
| S-4 | Verify script re-asserts builder behavior the spec already pins (`endsWith` weaker than spec's equality) | **ACCEPTED** — precedent-sanctioned alias-resolution smoke (same justification as #1276); exercises a realistic underscore-containing runId. |

## Spec

**Verdict: CLEAN.** Every AC verified against file contents: constant + builder (doc-key format matches IMPL `{listDocId}_{exitId}` and the #1367 review's downstream note), rules policy byte-identical to contract-lists precedent, both composites declared with COLLECTION scope, all three indexed fields exist on `AnalysisResultDoc`, rules/indexes spec wired via `test:st-rules-indexes`, verify suite + guide + README row + run-all entry registered.

| # | Finding | Disposition |
|---|---|---|
| SP-1 (minor) | #1367 verify script still composes the doc key inline + hardcodes the root | **FIXED** (same as TN-5) |

Informational (no action): BE barrel intentionally doesn't re-export options roots — options-domain code imports `@st/collections` directly (`options-replay` does). Rules/indexes are declarations; live enforcement awaits `firebase deploy --only firestore:rules,firestore:indexes`.

---

## In-cycle remediation summary

| Change | Files |
|---|---|
| #1367 script uses canonical builder + root constant | `scripts/verify/options-backtest-analytics-1367-registry-contracts.ts` |
| `\s*\}` anchor on all five read-only regexes | `tests/functions/firestore-rules-indexes-1012.test.ts` |
| `{listId}`→`{contractListDocId}`; exact charset; flat-family rationale | `shared/st-collections.ts` |
| Exact charset in comment | `scripts/verify/options-backtest-analytics-1368-results-collection.ts` |
| merge-write stale-`error` note (forward to #1372) | `1238-1266-1357-IMPL-BACKTEST-BE-options-backtest-analytics.md` |

## Re-verified after remediation

- `test:st-rules-indexes` → **15/15**
- jest `shared/st-collections` + `shared/options-analysis` → **46/46**
- `options-backtest-analytics-1367-registry-contracts.ts` → all checks pass
- `options-backtest-analytics-1368-results-collection.ts` → 11/11

## Round 2 (post-remediation re-review)

All three axes re-ran on the remediated files.

**Verdicts:** Standards **PASS** (all six round-1 fixes verified landed, 1 minor + 2 pre-existing nits) · Spec **CLEAN** (all ACs re-verified, 2 informational nits) · Thermo-Nuclear **clean/approve** (1 minor, 2 nits).

| # | Finding | Disposition |
|---|---|---|
| R2-TN-1 (minor) | Existence-only `assert.match` can't detect a *second* match block granting writes to a read-only root (Firestore ORs allows across matching blocks) | **FIXED** — each read-only root pinned to exactly one `match /{root}/` block via occurrence count (all five read-only roots). |
| R2-S-1 (minor) | 1367 script still composes keys literally at the *assertion targets* (`${listDocId}_${resultDoc.exitId}`, `${payload.runId}_${payload.symbol}`) | **ACCEPTED** — those literals are the contract under test; routing assertions through the builder would be tautological. The spec pins the format independently via exact string equality. |
| R2-S-2 (nit) | 1367 guide still says "the collection itself lands in #1368" | **FIXED** — now links `options-backtest-analytics-1368.md`. |
| R2-nits | `hasIndex()` doesn't assert `queryScope`; `listDocId` shorthand vs `contractListDocId` in script locals; `writeListDoc` stores raw `symbol` field | **ACCEPTED** — pre-existing patterns / out of scope; listed for awareness. |

**Re-verified:** `test:st-rules-indexes` 15/15 (incl. new uniqueness guard) · full suite 287/4,963 — one flake (`option-order-ticket` 5s timeout under load; **74/74 in isolation**, file untouched by this task).

**Third-pass assessment:** not needed. Round 2 produced one real hole (duplicate-match bypass — now closed), one stale doc line, and accepted-by-design items. The remaining risk lives in the unimplemented BE worker (#1372), not this declarative layer.

## Carried forward to downstream tasks

- **#1372 (analyzer worker):** terminal `success` writes must clear `error` (merge retains it); `runId`/`exitId` composite supports the cross-symbol slice; removed `exitId` leaves a stale doc — detect via `registryVersion`.
- **Ship/deploy:** rules + indexes land on `firebase deploy --only firestore:rules,firestore:indexes` — not yet deployed.
- `run-all.ts` carries two uncommitted hunks (this task's entry + foreign #1158) — hunk-level staging at ship.
