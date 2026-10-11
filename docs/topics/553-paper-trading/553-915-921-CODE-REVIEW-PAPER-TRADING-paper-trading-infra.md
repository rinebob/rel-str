# CODE-REVIEW — #921 FE: auto-paper group-by dims on trading/paper

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #921  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Blueprint:** #915  
**Domain:** FE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## Round 1 — three axes, PASS after fixes

Diff: working tree, 5 files (~250 lines incl. specs). Axes run per
`.devin/skills/code-review/SKILL.md` (Standards, Spec, Thermo-Nuclear).

### Findings → dispositions

| Axis | Finding | Disposition |
|---|---|---|
| Spec | **`includeAutoPaper` never sent** — #918's `listPaperTrades` excludes `userId: 'auto-paper'` unless the request flag is set; #918 UAT recorded "#921's surface opts in via that flag". Without it every stamped dim degenerates to '—' — feature dead on arrival. | **FIXED** — `loadTrades` sends `{ includeAutoPaper: true, ...tradeFilters }` (flag first so an explicit filter can still opt out). New spec asserts the merge. |
| TN (MAJOR) + Spec | **dir-\* group↔scope mismatch** — FE grouped all trades by `order.side`; BE emits `dir-*` only for `signalType` trades. Jump button would show a curve for a different trade set than the table. | **FIXED** — `tradesByDirection` buckets non-signal trades under `'—'`, matching scope membership; malformed `order` also falls to `'—'`. |
| Standards + TN | Twin 11-branch ternary chains on `groupBy()` (`groupedTrades`, `selectGroupScope`) — dim #13 would touch five sites. | **FIXED** — collapsed into one `GROUP_DIMS` table (`label`/`map`/`scope` per dim). |
| TN (MINOR) | Dead jump button on un-sluggable keys — click silently no-ops via try/catch, no stats doc could ever exist. | **FIXED** — `scopeForGroup(key)` computes the scope (or null) once; template renders the button only when it returns non-null, so a rendered button always repivots. |
| Standards | `NO_SCOPE_KEYS` hard-codes store's private `'—'`/`'none'` literals — silent cross-file coupling. | Accepted — pre-existing pattern (`cohortExpressions` already hard-codes `'—'`); exporting the consts flagged for later. |
| Spec (partial) | TEST plan wants "signalType but no sector → sigtype group + '—' sector". | **FIXED** — store spec now covers a partially-stamped trade. |
| TN (MINOR) | `effectiveScope` silently falls back to `all` when a scope doc is missing — "no data for scope" indistinguishable from "all". | **Deferred** — pre-existing mechanism, existing spec pins the fallback; new dims make it routine so flagged for the follow-up forensics task. |
| TN (NIT) | `key as TradeSide` cast at the `dir-*` boundary. | Accepted — guarded by `NO_SCOPE_KEYS`; enum values are 'long'/'short' strings. |

### Verification after fixes

- `jest paper-trading.store.spec + paper-trading.component.spec`: **48/48**
- `tsc --noEmit -p tsconfig.app.json`: clean on touched files
- Dev server (4210) hot-reload verified in browser preview by user —
  picker options + grouping + '—' behavior eyeballed.

### Spec compliance

All three ACs: six dims group correctly + repivot via scope (spec'd per
dim), '—' group leaves scope unchanged + no jump button, existing
group-bys unchanged + `all` fallback preserved.

## Round 2 — convergence pass on the refactored diff

All five round-1 fixes verified correct (`includeAutoPaper` merge,
direction gating vs. `paper-stats-pass.ts:79-82`, `GROUP_DIMS` table —
'all'/'expression' correctly scopeless, `scopeForGroup` button guard,
spec coverage).

| Finding | Disposition |
|---|---|
| LOW — flag-first spread let a hypothetical `includeAutoPaper:false` filter silently opt out | **Fixed** — flag now spreads last; "this page includes auto-paper" is a contract, not an overridable filter |
| INFO — spec mocks slightly off real semantics (direction mock bucketed non-signal trades under side keys; sector mock had empty `'—'` bucket) | **Fixed** — mocks now mirror the real grouper |

No other new defects: `GROUP_DIMS` arrow fns are lazy (init order safe),
template touches only `dimLabel`/`scopeForGroup`, per-group
`scopeForGroup` cost is trivial under OnPush, no stale tests.

**Stopped at 2 rounds** — one LOW + one INFO, both fixed. Post-fix: 48/48.
