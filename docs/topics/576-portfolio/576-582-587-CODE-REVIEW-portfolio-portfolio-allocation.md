# Code Review — #587 FE AllocationStore + selectors

**Status:** Final
**Task:** #587 — FE: allocation.store SignalStore + selectors
**Blueprint:** #582 (FE), under Topic #576 / Thread #577
**Files:** `src/app/features/portfolio-dashboard/allocation.store.ts`,
`allocation.types.ts`, `allocation.store.spec.ts`,
`shared/portfolio-allocation-utils.ts` (isWellFormedPosition export +
buildEquityCurve extraction)

## Verdict: PASS (3 axes, findings remediated)

## ACs

| AC | Verdict |
|---|---|
| Selectors scoped to selected account — zero cross-account leakage | ✅ — all selectors key `accounts()[selected]` → `byAccount[accountNumber]` and re-filter attributions; spec injects a foreign-account doc into the stream and asserts no leak |
| Cash row = account value − Σ bucket exposures; never stored | ✅ per PRD — see F1 wording note; `cashCheck(actual, totalValue, positions)` computed per read |
| Unassigned derived from positions lacking attribution | ✅ — incl. dangling-bucketId fold-in (M1 remediation) |
| Store spec covers selector outputs on fixtures | ✅ |
| Post-write selector refresh verified in spec | ✅ — stream push re-derives positionsRows/bucketRows/bucketDetail |

## Findings → resolution

- **[MED] Dangling bucketId dropped positions from ALL stats** — an
  attribution pointing at a missing/deleted bucket rendered 'Unknown
  bucket' in positionsRows but excluded the position from unassignedStats
  AND accountHeader.unassignedExposure → numbers silently vanished.
  Fixed: `attributed` sets in unassignedStats + accountHeader now require
  `liveBucketIds.has(a.bucketId)`. Spec covers it.
- **[MED] unassignedStats diverged from computeBucketStats** — extracted
  shared `buildEquityCurve(matches, unrealizedPnl, hasActivity, asOf)` into
  the utils file; both paths now share the stale-asOf merge guard. Unassigned
  `closedCount` now counts flat-but-traded instruments (same semantics).
- **[LOW] Errored watch stream never re-attached** — error handlers now
  clear the dead subscription; `selectAccount`/`refresh` re-subscribe.
- **[LOW] `refresh()` unguarded** — added the `refreshing` re-entrancy
  guard matching the dashboard-store precedent.
- **[LOW] Impure computed** — `asOf ?? new Date().toISOString()` inside
  `bucketRows` fabricated timestamps; now propagates `''` when unloaded
  (buildEquityCurve's Date.parse guard degrades gracefully).
- **AC wording note (F1)** — "account value − Σ bucket exposures" is
  imprecise in the issue text; implemented semantics (broker actual +
  derived residual incl. Unassigned, net-signed) are PRD-authoritative
  (PRD: "Cash row displays the broker's reported cash figure; a derived
  residual runs alongside as a cross-check"). Code kept; AC noted.

## Deferred (documented, not blockers)

- Index-based `selectedAccountIndex` — a reloaded account list could
  reorder under the user's tab; selection is called once at init, so risk
  is low. `accountNumber`-keyed selection is the robustification if needed.
- `accountHeader` builds its own attributed set rather than consuming the
  unassigned row — small duplication, both derive from the same filter now.

## Test results

- `allocation.store.spec.ts`: **18/18** — incl. dangling-bucket fold-in,
  unassigned realized P&L + closedCount, stream-error re-attach,
  refresh-reload, loadAccounts error, renameBucket happy/throw paths.
- `shared/portfolio-allocation-utils.spec.ts`: 36/36.
- Full suite: **2016/2016**, 147 suites.

## QA handoff

→ `/proj qa 576 587` — UAT scenarios: selector outputs on fixtures,
post-write refresh, cross-account scoping, Unassigned/Cash derivations,
dangling-attribution visibility.
