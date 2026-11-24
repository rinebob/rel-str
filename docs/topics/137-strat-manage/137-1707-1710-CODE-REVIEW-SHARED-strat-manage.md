**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1707  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1710  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# CODE-REVIEW: #1710 — shared netMark + uniform P&L + selection contract

## Diff under review

- `shared/options-position-math.ts` (new, 130 lines) — `legValueSign`, `netMarkValue`, `entryNetMark`, `signedEntryPremium`, `unrealizedPnl`, `hasOptionLegs`, `isOpenOptionPosition`, `NetMarkLegInput`
- `shared/options-position-math.spec.ts` (new, 230 lines, 28 its)

## Standards

- File size 130/230 lines — under the 300 target; single-responsibility pure module, no Firestore/SDK surface. PASS.
- No type duplication: `NetMarkLegInput` is the only leg-math shape; `TradeShape`/`LegKindCarrier` are minimal structural views the real `PaperTrade` satisfies — no contract mirroring. PASS.
- `legValueSign` (liquidation space) is a documented sign-inverse of `position-net.ts`'s `signFor` (cost-to-close space) — the header states the relationship explicitly; `position-net.ts` lives in `functions/` and is not importable from `shared/`, so reuse was not available. PASS.
- Honest contracts: `mark: number | undefined`, `undefined` propagation for unpriceable positions — no zero-filling, no `any`, no type-erased fixtures. PASS.

## Spec

| AC | Status |
|---|---|
| netMark + unrealizedPnl consolidated, one formula, no posture branching | MET — `netMarkValue` + `unrealizedPnl`; callers never branch |
| signedEntryPremium pinned (credit + / debit −) | MET — CCS/PCS +300, CDS −200, PDS −400, strangle +700, IC +400 |
| hasOptionLegs spec-pinned (option in, stock out) | MET — option/stock/empty/absent/mixed all spec'd |
| posture matrix CCS/PCS/CDS/PDS + strangle | MET — plus 4-leg iron condor |

TEST-doc coverage: missing marks → `undefined` ✓; multiplier×qty ✓; legacy+manage same-shape ✓; zero/qty marks ✓ (see findings). Variant-ID specs belong to #1711 — correctly absent.

## Thermo-nuclear

- `entryNetMark` is a one-line alias of `netMarkValue` — retained deliberately: it makes the `netMark − entryNetMark` P&L identity expressible at call sites and is exercised by the end-to-end spec. Nit, accepted.
- Two sign spaces (backtest cost-to-close vs live liquidation) is an intentional documented fork — the module header names the inverse relationship rather than silently diverging. Accepted.
- `isOpenOptionPosition` treats absent `status` as not-OPEN — honest non-fabrication, correct for the selection contract.
- `unrealizedPnl(number, number)` forces callers to resolve `undefined` before invoking — the unpriceable policy decision stays at the boundary. Clean.

## Findings

- ~~minor — `mark: 0` (worthless-but-priced leg) was not spec-pinned; only `undefined` was.~~ FIXED in-gate: added spec pinning `mark: 0` contributes 0 rather than dropping the position (the `=== undefined` check was already correct).
- nit — `entryNetMark` alias (see Thermo-nuclear; accepted).

## Test results

- `npx jest shared/options-position-math.spec.ts` — 28/28 green.
- `npx jest shared/` — 57 suites / 1195 tests green (worker-teardown warning is pre-existing).

## Passes

- First pass complete — three axes; 1 minor spec gap (zero-mark), 2 nits; minor fixed in-gate.
- Second pass complete — full-diff re-check: no new findings, no unexamined error paths, no foreign files.
- Convergence: PASS — all four ACs spec-pinned, suite green, findings resolved.

## Verdict

**PASS**
