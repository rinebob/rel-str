**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1008  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# CODE-REVIEW — #1008 st-config + st-symbol-lists consolidation

## Verdict: PASS (round 2)

Round 1 produced three majors + five minors, all remediated. Round 2
re-ran all three axes on the final state: no new majors, all round-1
fixes verified correctly landed, and the round-2 remainder was minors —
all fixed or consciously deferred below. Tests 20/20, `tsc --noEmit`
clean, esbuild clean, audit + sweep + migrator dry-runs exercised on prod.

### Round-2 fix verification

| Finding | Status |
|---|---|
| Fake `batch()` non-atomic + union-merge test overclaimed (sentinel never evaluated) | FIXED — fake commit snapshots+rolls back on mid-batch throw; test renamed to assert the real call contract (both paths, `merge:true`); new spec proves all-or-nothing rollback |
| `--force` + `merge:true` wasn't an overwrite (dest-only fields survive → audit still flags) | FIXED — wholesale `set` (write is only reached when dest absent or forced); comment explains why |
| `sweep-unlisted-to-new.ts` `userId: undefined` edge (Firestore rejects undefined field values) | FIXED — `?? [...uids][0]` fallback |
| Sweep script absent from tsconfig include | FIXED — added |
| `LEGACY_STATUS_DOC_PATH` exported unused | FIXED — module-private |
| Missing return annotations on two mirror fns | FIXED |
| Dead `statusDoc` literal in `run.service.ts` (the mirror header's premise correction pointed at it) | FIXED — removed |
| Stale `AUTO_PAPER_CONFIG_DOC` comment ("moves to") | FIXED — canonical location + soak note |

Deferred (tracked, non-blocking):
- `firestore.rules` + `firestore.indexes.json` have no `st-*` blocks —
  expected: admin SDK bypasses rules during soak; rules land in #1012,
  FE re-point needs them in #1014. Flagged in QA.
- `deepEqual` imported from `order-tickets/legacy-order-intents` by four
  scripts now — generic util in a domain module; hoist to `common/` as a
  follow-up nit (same precedent as #1007).
- `destInclude`/`destExclude` dual mechanism — accepted: self-documenting
  partition of the shared `st-config` root.

## Round 1

### Majors — fixed

### Majors — fixed

| Finding | Axis | Remediation |
|---|---|---|
| Audit `status` family dest-only scan flagged every non-status `st-config` doc (autoPaper, `{uid}`) as a permanent WARN — dead divergence channel, same class as #1007 M2 | all three | `destInclude: {status}` scopes the family's dest-only scan; trading-config's `destExclude: {status}` completes the partition — every `st-config` doc is claimed by exactly one family |
| `addSymbolToDefaultList` dual-write used `Promise.all` — §6 atomicity violation; a canonical-ok/legacy-fail left the NEW symbol invisible to the FE with no mirror healing that direction | Standards (+TN) | single `db.batch()` + `commit()` — all-or-nothing; comment documents why atomicity is required (no canonical→legacy mirror for lists) |
| `sweep-unlisted-to-new.ts` — second BE NEW-list writer still legacy-only | Spec | dual-write via `db.batch()` to legacy + `st-symbol-lists`; console line names both roots |

### Minors — fixed

| Finding | Remediation |
|---|---|
| `stConfigMirror` premise false (`run.service.statusDoc` is dead — only `stGetStatus` consumes status) | Header corrected: shadow kept deliberately as rules-permitted-reader insurance + soak rollback path |
| Wildcard `st-config/{docId}` trigger fired on every mirrored FE config write; routing table + skip branch for a single real route | Literal-path trigger `st-config/status` (`MIRROR_ST_STATUS_PATH`) — deletes `ST_CONFIG_LEGACY_ROUTES`, the skip branch, and the wasted invocations |
| `trading-config/status` doc id would mirror onto `st-config/status` then shadow over the real singleton (multiplexed-namespace collision) | `mirrorTradingConfigDoc` skips id `status` with a warn; pinned by a spec |
| `916-inputs` docstring claimed `st-symbol-lists` while the query still read legacy | Query re-pointed to `ST_SYMBOL_LISTS_ROOT` |
| `st-cloud-function/README.md` documented legacy status/symbol-lists paths | Updated to canonical with mirror-during-soak notes |

### Nits — fixed or deferred

- `stConfigDocPath` had zero prod consumers → now wired into
  `mirrorTradingConfigDoc`, `run-progress` statusRef, `getAgentStatus`.
- Dead `LEGACY_*` aliases in the mirror file → dropped; constants used
  directly in trigger-path literals.
- `mirrorStConfigDoc` direction ambiguity → renamed `shadowStStatusDoc`
  (no docId param — fixed dest); shared `writeMirrorDoc` core removes
  the third copy of the try/set/delete body.
- DEFERRED: third copy of the fake-Firestore fixture — extracting
  `tests/functions/fake-firestore.ts` touches shipped #1007 tests;
  tracked as a follow-up nit.
- INFORMATIONAL: `arrayUnion`+merge semantics only exercised against the
  fake (same gap as #1007); prod soak + audit are the backstop.

## Axes summary

- **Standards** — after remediation: no documented-standard violations;
  mirrors follow the #1007 shape (wholesale set, delete propagation,
  never-throw w/ logger.error, pinned path literals); all Firestore path
  segment counts valid.
- **Spec** — all #1008 requirements met: 3 families migrate
  (ids preserved; `current`→`status` remap), readers/writers cut over,
  mirrors cover both directions as designed, migration is dry-run-default
  + `--apply`/`--family`/`--force` + rerun-safe, audit is direction-aware
  + registered. FE stays on legacy by design until #1014; rules/indexes
  are #1012's scope.
- **Thermo-nuclear** — post-remediation structure is simpler than the
  first pass (literal-path trigger deleted a routing table); all files
  <300 lines; no spaghetti growth; batch accounting verified race-free.

## Test results

- `test:config-lists` — 19 pass / 0 fail (incl. status-collision guard,
  batch dual-write, literal-path pin).
- `test:collection-renames` 23/0 · `test:st-run-completion` 7/0 ·
  `test:st-position-groups` 28/0 · `test:st-order-tickets` 89/0 ·
  `test:st-signals` 34/0 · `test:paper-trading` 272/0.
- `tsc --noEmit` clean; `npm run build` clean.
- Prod dry-run: `migrate-config-lists-1008.ts` — 10 docs (2 config /
  1 status / 7 lists), 0 failures.
- Prod audit pre-migration: expected `1 FAIL` (status canonical absent)
  + `9 WARN` (soak lag) — direction-aware severity confirmed live;
  `destInclude` produces zero spurious dest-only warnings.
- `sweep-unlisted-to-new.ts` dry-run parses and reads prod: 926-symbol
  universe, 0 unlisted (informational for #1011).

## Deploy ordering (from migration runbook)

1. `migrate-config-lists-1008.ts --apply` (canonical populated first —
   BE reads canonical immediately at deploy).
2. Selective deploy: `tradingConfigMirror`, `symbolListsMirror`,
   `stStatusMirror` (new) + functions carrying changed constants
   (`stAutoPaperIngest`, `getAgentStatus`/run-progress carriers,
   `symbolDataSymbolAdded`).
3. Re-run `--apply` to catch FE writes landed between steps.
4. Run the parity audit — expect 0 FAIL.
