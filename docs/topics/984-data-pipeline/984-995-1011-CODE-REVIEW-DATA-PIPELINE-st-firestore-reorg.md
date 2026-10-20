**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1011  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# CODE-REVIEW — #1011 NEW-list additive backfill

## Verdict: PASS — 1 round

Three axes (Standards / Spec / Thermo-nuclear) on the #1011 changeset:
`functions/src/common/st-new-list-sweep.ts` (new), `sweep-unlisted-to-new.ts`
(rewired), `data-pipeline-new-list-1011.ts` (new audit),
`new-list-sweep-1011.test.ts` (new suite), run-all/README/package
registrations.

**2 majors found, both remediated pre-verdict.** 10 minors remediated,
6 accepted-and-documented. Prod probes (read-only) informed every
data-dependent finding.

## Majors — remediated

1. **Per-leg doc state (thermo F1)** — the script checked existence and
   `userId` on the legacy leg only, then wrote one payload to both roots.
   A canonical-only NEW doc would get `createdAt` re-stamped; a legacy-only
   doc would mint a canonical doc missing `role` — which the FE renders as
   a nonexclusive user list (members stop counting as triaged).
   **Fix:** each leg builds its own payload from its own `get()` —
   meta+`createdAt` mint per-leg, union-only on existing legs
   (`sweep-unlisted-to-new.ts:112-129`).
2. **List-key resolution diverged from the FE (thermo F2 / spec)** —
   `listKeyOf` was `key ?? docId`; the FE resolves `name` → `{userId}_`
   id-suffix → docId. An unstamped `u1_PRIMARY` or `{name:'PRIMARY'}` doc
   would be misclassified nonexclusive and its members re-filed.
   **Fix:** `listKeyOf` now mirrors the FE order — `key` → `name` →
   `{userId}_`-suffix → docId (`st-new-list-sweep.ts:49-60`). Unstamped
   uid-shaped docs *without* `userId` stay nonexclusive — unattributable,
   conservative direction. Prod probe: zero unstamped docs exist today.

## Minors — remediated

- **Multi-NEW silent pick** → `resolveNewListTarget` throws on
  `newDocIds.length > 1` without `--uid` (prod: 1 NEW doc, single uid).
- **userId guessing** → omitted from the payload when unattributable; a
  shared bare doc never gets a guessed owner (ownership reassignment was
  user-visible).
- **`--uid` hijack** — the force flag now refuses an existing non-NEW
  target instead of stamping `key:'NEW'` onto a user list.
- **Verify audited only the legacy leg** → both legs audited; bare
  `{name}`-era shape accepted, stamped `key`/`role` must agree.
- **Verify crash paths** — `(symbols)?.length ?? 0`; `uids.size !== 1`
  guarded before `resolveNewListTarget`; `AUDIT CRASH:` prefix.
- **Census glue duplicated** across script + audit → `summarizeListDocs`
  shared in the module.
- **`enabled === false` symbols** excluded from the universe (prod:
  926/926 enabled today; disabled docs shouldn't be filed).
- **`--uid` arg validation** — missing/`--`-prefixed value exits with
  usage instead of minting a doc named `--apply_NEW`.
- **Dry-run prints the resolved target** — no more blind `--apply`.
- **Nits** — `trim()` before uppercase; `.select('enabled')` ids+field
  reads; `NEW_LIST_KEY` aliases `DEFAULT_SYMBOL_LIST_NAME`;
  `EXCLUSIVE_LIST_KEYS` mirrors documented (no shared key registry exists).

## Accepted — documented, not code

- **`symbol-meta` root omitted from universe** — empty on prod today
  (probe: 0 docs); `st-collections.ts` plans the merge into `st-symbols`
  at #1013. If it populates before then, the audit's unlisted census
  can't see it — noted on #1013.
- **Bare `NEW` target ≠ literal `{uid}_NEW`** — accepted: keeps a single
  inbox; the payload stamps `key:'NEW'` so the auto-paper scope query
  (`where('key','==','NEW')` on `st-symbol-lists`) still resolves it.
- **§1 regex canary** in the audit — weak by design (structure guard, not
  a semantic check).

## Prod evidence (read-only)

- Universe: 926 enabled symbols (legacy 926 + canonical 0);
  `symbol-meta` empty.
- Lists: 7 docs per root, doc-id parity; all stamped `{uid}_{KEY}` with
  `userId`; single uid; one NEW doc (`…_NEW`, 472 members).
- Unlisted: **0** — AC met; audit `0 FAIL / 0 WARN`.
- Dry-run end-to-end: 0 unlisted; target resolution exercised.

## Tests

- `test:new-list-sweep`: **21/21** (6 suites) — classification order,
  exclusive set pin, unlisted, all resolution branches incl. multi-NEW
  throw, mirrored-doc union, additive payload shapes, `userId` omission.
- `test:config-lists` regression: 20/20.
- **Full jest: 242/242 suites, 4066/4066 tests.**

## ACs

| AC | Status |
|---|---|
| Zero-membership tracked symbols added to `{uid}_NEW` | Met — mechanism proven; prod already at 0 unlisted, verified by audit |
| Strictly additive — no existing memberships removed | Met — `arrayUnion` + `set(merge)` is the only write shape; per-leg meta minting preserves existing state |

---

## Round 2 — 2025 follow-up pass (all three axes re-run)

Verdict: **PASS sustained.** 0 MAJOR confirmed — 1 claimed major was a
false positive; all real findings remediated and re-verified.

### Axes

| Axis | Result |
|---|---|
| Standards | 2 MAJOR claimed — #1 **false positive** (claimed `listDoc(id,{name})` TS2353; actual calls are `listKeyOf(id,{name})` whose param accepts `name`; `tsc -p tests/tsconfig.json` shows **0** errors in the test file — the suite's ~44 pre-existing errors are in other files). #2 = audit multi-NEW crash — real, fixed |
| Spec | 1 latent violation (half-migrated meta) + 3 minors — all fixed |
| Thermo | 0 MAJOR; all 7 round-1 remediations verified to hold; 3 new minors fixed, 1 documented |

### Round-2 findings → remediation

| # | Finding | Sev | Disposition |
|---|---|---|---|
| S-1 | `key` stamped on existing leg without `role` — a `{name}`-era/suffix-resolved NEW doc would end up `key`-stamped + `role`-less → FE reclassifies nonexclusive, members un-triaged | MAJOR (latent) | **Fixed** — `buildNewListDoc` takes the leg's `existing` data; meta re-stamps when `key`/`role` missing; `createdAt` still mint-only |
| S-2/T-3 | Audit §3 fell through to `resolveNewListTarget` on multi-NEW → AUDIT CRASH instead of a report | MAJOR | **Fixed** — `else if` short-circuit + INFO→WARN |
| S-3 | Dead preference `.find(endsWith('_NEW')) ?? [0]` unreachable after `>1` throw | minor | **Fixed** — `newDocIds[0]` |
| S-4 | `SymbolListDocLike.data()` omitted `name` consumed by `listKeyOf` | minor | **Fixed** |
| S-5 | Comment understated the load-bearing unconditional `key` | minor | **Fixed** |
| S-6 | Universe construction duplicated script↔audit | minor | **Fixed** — `enabledSymbolIds` shared helper |
| S-8/9/10/11 | FE-parity comment caveat, mid-file import, silent `--apply`, "exactly"→"at least" header | nits | **Fixed** |
| T-2b | Unstamped `u1_PRIMARY` (no `userId` field) resolved as user list → members re-filed → dual membership | minor (unsafe direction) | **Fixed** — `{any}_{EXCLUSIVE}` id-suffix fallback in `listKeyOf` |
| T-3 | Audit couldn't detect dual exclusive membership (≥2 docs) | minor | **Fixed** — per-symbol distinct-doc-id count, dedupes mirrored legs; WARN on ≥2 |
| T-4 | `--uid ''` slipped validation; uid provenance could stamp a contradicting `userId` | nit | **Fixed** — `/^\S+$/` + `--`-prefix rejection; precedence `uidArg → leg userId → target id-prefix → sole-uid` |
| T-5 | `.toUpperCase()` without `.trim()` asymmetry | nit | **Fixed** |

### Documented, not fixed (with rationale)

- **Soak-mirror clobber (T-1, MINOR):** `symbolListsMirror` replaces
  `st-symbol-lists/{id}` with the legacy after-image on every legacy
  write — the canonical leg of the sweep's batch is redundant where the
  mirror agrees, and canon-only divergent members are sacrificed.
  Self-healing (wiped members resurface as unlisted → next sweep
  re-files) and by soak design. Documented in the script header.
- **`key` honored on non-prefixed ids (S-F2/T-2a):** `listKeyOf` honors
  stamped `key` unconditionally; the FE gates it on `{viewerUid}_`
  prefix. Requires a corrupt doc no writer produces; direction is
  conservative. Documented in `listKeyOf`'s comment.
- **Role-driven vs key-driven exclusivity (T-2c):** `{key:'x',
  role:'exclusive'}` / `{key:'PRIMARY', role:'nonexclusive'}` anomalies
  would diverge. Prod probe: zero such docs.
- **Filename lacks `-1011` (S-7):** script predates the task (created in
  the #1008 batch, referenced under its current name in shipped docs) —
  renaming would stale shipped references for a cosmetic convention.
- **`typecheck:tests` suite-wide red (~44 errors):** pre-existing, in
  `config-lists-1008`, `order-intents-migration`, `gh-lifecycle` etc. —
  not introduced by this task; my file contributes 0.

### Round-2 verification

- `tsc --noEmit` (functions): clean.
- `test:new-list-sweep`: **25/25** — +3 specs (exclusive-suffix
  fallback, half-migrated meta re-stamp, key-only meta heal,
  `enabledSymbolIds`) and 1 re-scoped (non-exclusive suffix stays
  full-id).
- Live prod audit: `0 FAIL / 0 WARN` — incl. new "no symbol sits in two
  exclusive docs" check; dry-run still 0 unlisted.
