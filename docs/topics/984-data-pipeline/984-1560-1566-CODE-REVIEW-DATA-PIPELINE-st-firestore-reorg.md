**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1560  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Task:** #1566  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Code Review — #1566 BE-CHORE: stale legacy stats doc cleanup + verification

Three-axis gate review (Standards / Spec / Thermo-nuclear sub-agents) of
the stale-stats cleanup: `isCanonicalStatsScope` + prefix contract in
`paper-trading-ids`, the `purge-legacy-stats-docs-1566.ts` ops script,
the `read-apis-565` stale-root repoint, and the widened `stats-ALL`
grep-pin.

Pass sequence:

```text
First pass complete — 0 MAJOR, 1 convergent MINOR (--max + strict
post-verify always exits 1 on capped runs), 4 additional MINORs
(--max=N silently ignored; script missing from tsconfig include;
read-apis-565 varScopeExisted race; read-apis-565 cleanup ordering),
7 NITs; all 7 ACs met with evidence otherwise.
Second pass complete — all remediations applied and verified (pin
14/14, ids spec 48/48, tsc clean, prod dry-run re-enumerates the same
7 stale of 723); no new findings.
Convergence: PASS — convergent minor + all findings remediated in-gate;
prod evidence green end-to-end.
```

## Verdict: PASS

## Per-AC evidence

| AC | Verdict | Evidence |
|---|---|---|
| 1 — script enumerates `st-paper-trading/stats/items`, deletes non-canonical ids | MET | `purge-legacy-stats-docs-1566.ts` — `STATS_ITEMS` via `stPaperTradingItemsPath(STATS)`; `CANONICAL_STATS_SCOPE_PREFIXES` exactly matches the AC's 12 prefixes + `all`; all 13 scope builders verified to emit covered scopes; every stats-doc writer traced (`paper-stats-pass`, `stats-increments`, `statsDocRef`) |
| 2 — dry-run default, `--apply` deletes | MET | Bare run lists candidates (7 stale on prod); `--apply` batches at 400 (< 500-op limit); `--max`/`--max=` cap both parsed + validated — `purge-st-run-jobs-1010` convention |
| 3 — runs only after the legacy-reader deploy | MET (documentation-level) | Script header ⚠ block + README note; dry-run default makes a bare invocation harmless — matches ops-script convention |
| 4 — post-run `getPaperStats` (no scope) canonical-only | MET | `handleGetPaperStats` → `listStats` → `listItems(STATS)` → `ST_KINDS` routes to the same `st-paper-trading/stats/items` collection the script re-enumerates + asserts on post-apply |
| 5 — grep-pin zero refs to 5 symbols | MET | `legacy-stats-retirement-1565.test.ts` — 14 pins covering `runStatsPass`, `incrementStatsOnOpen`, `defaultReadStatsDoc`, `getStrategyEquityCurve`, `'ALL'` literals, and `stats-ALL` (functions/src + shared/, spec files excluded) |
| 6 — `read-apis-565` `stPaperTradingDocPath` repoint + re-run green | MET | `tradeRef`/`statsRef`/`acctRef` all repointed (all three were on the dead legacy root, not just `statsRef`); re-ran **20/20 on prod** incl. cleanup self-heal |
| 7 — verify README registration | MET | `<!-- #1566 … -->` ops-script note — matches the `#1013`/`#1019` convention (ops scripts aren't run-all entries by design) |

## Findings remediated in-gate

**MINOR (convergent, Standards + Thermo):** `--max` + strict post-verify
contradiction — a deliberately capped run would always `FAILED` on its
own untargeted remainder. Fixed: post-apply asserts only *targeted*
docs are gone; capped remainder reported as expected ("rerun --apply
to continue").

**MINOR (Thermo):** `--max=N` equals-form was silently ignored →
unbounded delete. Fixed: `--max` and `--max=` both parsed + validated.

**MINOR (Spec):** `purge-legacy-stats-docs-1566.ts` missing from
`functions/tsconfig.json` include → `tsc -p` never typechecked it.
Fixed: added to the enumerated scripts list.

**MINOR (Thermo):** `read-apis-565` `varScopeExisted` race — a var doc
minted by a real trade between the pre-run snapshot and the heal pass
would be deleted as an "orphan." Fixed: var deletes now skip scopes the
healed pass itself wrote (`healed.scopesWritten`).

**MINOR (Thermo):** `cleanup()` ordering — a heal-pass throw stranded
namespaced ghost docs forever. Fixed: namespaced deletes hoisted into
the first batch (before the heal pass).

**NITs fixed:** `stats-ALL` literal in the shared comment → reworded to
"legacy combined doc"; pin radius widened to `shared/` (non-spec);
prefix list reordered to builder-declaration order; `scopeOf` comment
corrected; redundant ternary simplified; `paper-stats-pass` header
family enumeration aligned to all 12 families; script header now
documents that canonical-prefixed ghosts are kept by design.

## Deferred / documented

- **`--apply` is gated on the #1565 deploy** (AC3) — the deployed
  `getStrategyEquityCurve` still reads `stats-ALL` until the user
  pushes + deploys. The script, dry-run evidence, and gate
  documentation ship now; `--apply` runs post-deploy.
- **Canonical-prefixed ghosts** (`stats-inst-verify-*` from crashed
  verify runs, zero-trade canonical scopes) are out of this purge's
  scope by design — documented in the script header.

## Test evidence

- `shared/paper-trading-ids.spec.ts` — 48/48 (new `isCanonicalStatsScope`
  pins: all 13 builders canonical; `'ALL'`/unprefixed-instance/empty rejected)
- `legacy-stats-retirement-1565.test.ts` — 14/14
- `test:paper-trading` — 398/398
- `npx jest` — 6102/6102
- `npm run build` + `tsc -p` — clean
- Prod dry-run — 723 stats docs → exactly 7 stale (`stats-ALL` + 6
  `stats-{unprefixed-instanceId}` incl. `stats-SPY-WHEEL-INT`)
- `read-apis-565` prod re-run — 20/20
