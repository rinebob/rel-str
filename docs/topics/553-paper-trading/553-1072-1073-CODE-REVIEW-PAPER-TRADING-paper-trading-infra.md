**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1072  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1073  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# CODE-REVIEW — #1073 trade-analysis contracts

## Scope

`shared/analysis-dataset-contracts.ts` + `.spec.ts` (new),
`shared/paper-trading-ids.ts` (enum + anchors + path helpers),
`shared/paper-trading-contracts.ts` (union + guards hunks only — the
`ticketId` hunks are parallel #1005 work, out of scope),
`firestore.rules`, `tsconfig.json`, `functions/tsconfig.json`,
`jest.config.js`, `functions/scripts/verify/run-all.ts` + `README.md`,
`functions/scripts/verify/paper-trading-analysis-1073-*` (new),
IMPL doc as-built corrections. Spec source: issue #1073 body +
SHARED IMPL sections 1–2.

## Standards

- **nit — `void` import-exercise hack in the verify script** (`void
  TradeSide.LONG` to satisfy `noUnusedLocals`). **Fixed** — unused
  imports removed; the `@paper-trading/analysis` import already
  exercises the module graph.
- **minor — `analysis-slices` CRUD lacks the `instances`-style
  `uid == data.userId` binding** (`firestore.rules`). Accepted:
  `AnalysisSlice` carries no `userId` field and authenticated reads
  across the domain are already unscoped — uid-binding would add a
  contract field that exists only for the rule. Revisit if the app
  ever goes multi-user.
- Everything else checked clean: `col()` manifest helper kills
  per-column boilerplate, `keyof TradeAnalysisRow & string` gives
  compile-time manifest→schema direction, type-only import on the
  `PaperTradingDoc` union avoids a runtime cycle (documented inline),
  alias registered identically in all three resolvers (tsconfig × 2 +
  jest moduleNameMapper), `StPaperTradingKind` correctly untouched —
  its anchor guard now throws on analysis kinds, which is the intended
  behavior since the AC pins these to the legacy `paper-trading` root.

## Spec

All four acceptance criteria met:

- **AC1** — `ANALYSIS_COLUMNS` is the single ordered source of truth:
  `key/label/kind/enumValues/filterable/defaultVisible`, ordered to the
  prototype CSV with provenance prepended.
- **AC2** — bijection spec pins manifest ⇄ row in both directions
  (full row + sparse all-null row).
- **AC3** — `analysisDatasetsPath()`/`analysisSlicesPath()` return the
  AC-pinned paths; `paperTradingDocPath`/`analysisDatasetGcsPath`
  covered too.
- **AC4** — percent-units and ISO `YYYY-MM-DD` conventions documented
  on the module header and per-field comments.

IMPL sections 1–2 fully implemented; superset columns beyond the IMPL's
list (`positionGroupId`, `analysisCohort`, `signalStatus`,
`capitalRequired`, `qty`) are deliberate — provenance + open-trade
analysis require them. IMPL §1 drift corrected to as-built (`ind.*`
keys are the detector's verbatim stamped names incl. `windowV2`, not
`windowZone`; `signalType` carries the full stamped string).

## Thermo-nuclear

- Contract file ~300 lines, grouped by comment banners — no
  decomposition pressure. Flat dot-named row keys are the right call
  over nested sub-objects: manifest key === row key === CSV header,
  so the codec and FE dispatch get a zero-mapping lookup and the
  bijection test is exact.
- `SliceFilter` discriminated union over manifest keys — compile-time
  filter dispatch for free.
- No spaghetti, no speculative generality (`SliceFilter` ops match
  exactly the three the IMPL specs).

## Test results

- Focused: `analysis-dataset-contracts.spec` 12/12 + ids/contracts/
  st-collections 80 → **92/92** across touched suites.
- Real-Firestore verify: `paper-trading-analysis-1073-contracts.ts`
  **16/16** (probe dataset + slice write→read→delete round-trip).
- `tsc --noEmit -p functions/tsconfig.json` clean; `npm run build` clean.
- Full suite: 3807 pass / 44 fail — **all 3 failed suites unrelated and
  pre-existing** (screenshot-capture PositionType growth under #1004,
  order.component NG0201, sidenav DS-Gallery item from #1041).

## Findings

- **minor** — analysis-slices rule unscoped to userId (accepted above).
- **nit** — `void` import hack (fixed).

## Verdict

**PASS** — no critical or major findings.
