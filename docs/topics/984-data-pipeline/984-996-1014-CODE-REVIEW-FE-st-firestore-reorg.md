**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #996  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1014  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# CODE-REVIEW — #1014 FE-IMPL: service path re-points

## Verdict: PASS

Three axes (Standards / Spec / Thermo-nuclear) run against the full
uncommitted diff (impl + specs, 19 files) across **2 rounds**. Round 1
majors were remediated in-diff; round 2 verified all remediations and
produced only minor findings, all remediated. One major is a blueprint
gap, not a code defect, and is documented as deferred below.

## Round 2 (2026-10-20)

All round-1 remediations verified by all three axes. New findings and
dispositions:

| Sev | Finding | Resolution |
|---|---|---|
| MINOR | `chunkArray`/`getDocData`/`CreatedAtDoc` dead in `firestore-helpers.ts` — sole consumer was deleted symbol-meta.service | **Remediated** — removed functions + index.ts re-export (live helpers `requireUserId`/`buildStOccurrenceDecisionId`/`canonicalOccurrenceDecisionId` retained) |
| MINOR | Residual `as PaperStrategyInstance` casts in strategy-builder-form.component (+spec) — dead cast, `governingVariant` is on the base contract | **Remediated** — casts and imports dropped |
| MINOR | `StStrategyInstance` omitted `deletedAt` — field the service writes on soft-delete | **Remediated** — `deletedAt?: string` added to canonical interface |
| MINOR | TEST doc required "grep-based spec" but pin spec only asserted enum-member absence | **Remediated** — added fs-based literal scan over src/app (retired-path spellings, comment-line filtered, allowlist: constants.ts + this spec) |
| NIT | `as unknown as` cast in pin spec; stale header in backtest.types.ts | **Remediated** — `member in Collection` check; comment corrected |

Post-round-2 verification: 842 tests green (all touched suites +
shared/ contracts); tsc clean on touched files; grep scan asserts zero
legacy Firestore literals outside the pinned constants file.

## Standards

**Remediated in-diff:**
- Dead `SymbolType` removed — its only consumer was the deleted
  `SymbolMetaService` (`common/constants.ts`, `index.ts` re-export).
- Stale "server stamps kind" comment on `InstanceInput`
  (`strategy-builder.service.ts`) — `kind` no longer exists in the
  written doc; the stamping client is this service.

**Verified clean:**
- All `@st/collections` imports resolve to real exports; segment parity
  correct everywhere (odd collection paths, even doc paths).
- Specs assert exact `path` args on the Firestore mock boundary —
  real contract coverage, not implementation-detail tests.
- `symbol-meta.service.ts` deletion leaves zero references.

**Nits (accepted):**
- `BUCKETS_ITEMS`/`ATTRIBUTIONS_ITEMS` redeclared per service —
  matches the existing per-service readonly-field convention.
- `Collection as unknown as Record<string,string>` in the pin spec —
  the only way to assert enum-member *absence*; justified.

## Spec

- **st-* re-points — MET.** symbol-lists, strategy-instances
  (mode/enabled matches the canonical `StStrategyInstance` contract and
  the BE repository normalizer), portfolio buckets/attributions,
  backtest runs/permutations, config, runs, symbol-doc reads — all via
  shared constants; doc IDs and query shapes preserved.
- **Grep verification — MET.** No legacy Firestore literals remain in
  covered services; the four retained `Collection` members are
  intentionally deferred (#1015–#1019) and pinned by
  `st-path-cutover-1014.spec.ts`.
- **Scope creep — none in the committed diff.** Two flagged items were
  confirmed user WIP co-located in shared files
  (`chart-review.component.ts` `willLeaveActiveList`, ~35 lines —
  requires hunk-level staging at ship).

## Thermo-nuclear

**Remediated in-diff:**
- `InstanceInput` re-typed from legacy `PaperStrategyInstance` to
  `StStrategyInstance` (`@st/strategy-instances`); `loadInstances$`
  returns `StStrategyInstance[]` instead of erasing to
  `StrategyInstanceConfig[]`; `createInstance` payload explicitly typed
  `Omit<StStrategyInstance,'id'>` so `mode:'paper'` is checked against
  `StMode` at the boundary.
- Stale-path doc comments fixed (`order-ticket.types.ts`,
  `utils.ts`); `@deprecated` tags added to `PORTFOLIO_*` constants in
  `shared/portfolio-allocation-ids.ts` (values unchanged — shared spec
  pins spellings until #1013).
- `PaperTradingKind.INSTANCE` deprecation was considered and rejected:
  the member exists for dual-write pass-through (`stPaperTradingAnchor`
  catches it loudly); deprecating would warn on legitimate use.

**Nits (accepted):** identity-alias fields (`runsCollection`) match the
existing service convention; `loadInstances$` has no `mode` filter —
all docs are mode=paper today; revisit if live instances land.

## Findings

| Sev | Finding | Resolution |
|---|---|---|
| MAJOR | `analysis.service.ts` still reads/writes `paper-trading/analysis-datasets|analysis-slices/items` — last FE consumer on the legacy paper-trading root with **no canonical destination**: `StPaperTradingKind` omits analysis kinds and firestore.rules denies FE writes to `st-paper-trading` | **DEFERRED — blueprint gap.** Needs a follow-up task (add analysis anchors to `StPaperTradingKind` + rules write perms + FE re-point). Cannot be implemented inside #1014 — no destination exists. Recommend a new task under #996. |
| MAJOR | `strategy-builder.service.ts` write contract typed off legacy `PaperStrategyInstance`, stale stamp comment | **Remediated** — typed on `StStrategyInstance`; payload checked at boundary |
| MAJOR | ~35-line `willLeaveActiveList` + `onNextSymbol` change in `chart-review.component.ts` | **Not #1014** — confirmed user WIP in a shared file; excluded from verdict; requires hunk-level staging at ship |
| MINOR | `SymbolType` dead after `SymbolMetaService` deletion | **Remediated** — removed declaration + index re-export |
| MINOR | `PORTFOLIO_*` constants still undeprecated on retired roots | **Remediated** — `@deprecated` JSDoc added |
| NIT | stale doc comments (3 sites) | **Remediated** |
| NIT | `loadInstances$` no `mode` filter; empty-list `symbols[idx+1]` in chart-review | Deferred/accepted |

## Test results

- Full suite: **247/247 suites, 4144/4144 tests PASS** (jest,
  `--coverage=false`).
- `tsc --noEmit`: zero errors in touched files; 4 pre-existing errors
  in untouched files (`bulk-swing-sweep.ts` ×2,
  `indicator-config-dialog.component.ts`, `analysis.component.spec.ts`
  — the last is unrelated user #1084 WIP, `filteredRows` API churn).

## Ship notes

- `chart-review.component.ts` and `signal.service.ts` are **shared
  dirty files** — stage only the #1014 hunks (import + `ST_SYMBOLS_ROOT`
  usage + comments), leave the `willLeaveActiveList` block for the
  user's task.
- Legacy `savant-trader/data/*` roots remain live until #1013; no
  runtime behavior change is expected from this cutover since the new
  roots are populated (#1007).
