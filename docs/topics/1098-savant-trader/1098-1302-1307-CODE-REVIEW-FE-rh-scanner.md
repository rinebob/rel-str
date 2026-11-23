**Topic:** RH Scanner  
**Topic Slug:** savant-trader  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1302  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1307  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Code Review — #1307 FE-IMPL: chart popup infra (overlay + hover intent + states)

## Verdict

**PASS** — after in-gate remediation of one critical and two major findings.

```text
First pass complete — 3 axes: 1 critical (Escape-refocus reopens popup), 3 majors (file >400, unspec'd failing branches, spec-axis unpinned keyboard path), ~14 minors/nits
Second pass complete — remediation verified on the new diff; no stale references; no new findings; teardown paths re-traced end-to-end
Convergence: PASS — every critical/major resolved and spec-pinned; remaining items are declared #1308/#1309 seams or documented deviations
```

## Scope reviewed

Uncommitted working-tree changes for #1307 (chart popup infra — container
and interaction mechanics only; chart bodies are #1308/#1309):

- `pages/scanner/scanner-chart-popup.component.ts` (new) + spec
- `pages/scanner/chart-popup.controller.ts` (new — added in-gate)
- `pages/scanner/scanner-recipe-table.component.{ts,html,scss,spec.ts}`
- `pages/scanner/scanner.component.{html,spec.ts}`

## Findings — first pass

### Standards axis

| Sev | Finding | Disposition |
|---|---|---|
| MAJOR | Escape-refocus reopens popup — `close()` → `origin.focus()` → `focusin` → re-open; the chain-grid `suppressFocusOpen` guard was dropped in the port | **FIXED** — guard ported to `ChartPopupController.close()`; spec-pinned |
| MAJOR | `scanner-recipe-table.component.ts` at 437 lines (>400 smell line, guidelines §1) | **FIXED** — lifecycle extracted to `chart-popup.controller.ts` (DelegatedCellHover precedent); component 301, controller 152 |
| MINOR | Grace-timer core duplicated from chain-grid | Resolved by the same extraction — the mechanics now live in a named unit |
| MINOR | `chartPopupStateFor(_row)` unused param; `'error'` shell + `error` input unreachable in prod | Declared #1308/#1309 seams; comment strengthened to say so |
| MINOR | Spec file ~950 lines | Judgement call — growth is the coverage the review demanded; noted |
| NIT | `aria-haspopup="dialog"` without `role="dialog"`/`aria-expanded` | **FIXED** — `role="dialog"` + `aria-label` on popup root, `aria-expanded` on anchor, spec-pinned |
| NIT | No specs for Escape / focusPrimary / focusout / destroy-timer | **FIXED** — see test results |

### Spec axis

| Requirement | Status |
|---|---|
| `cdkConnectedOverlay` anchored to row's chart button | MET |
| Positions end/bottom→start/top + flip fallbacks, viewportMargin 8 | MET (follows issue's literal positions) |
| Open on mouseenter/focus/click | MET |
| ~150–250ms pinned grace; pointer-travel cancel; popup leave closes | MET — 250ms constant; IMPL's literal "closes immediately" deviated to chain-grid-consistent grace close (spec-pinned, disclosed) |
| One popup at a time | MET |
| Teardown on recipe switch / filtered-out row / refresh churn / error unmount | MET — `linkedSignal` on `rows` re-emission |
| Symbol + name chrome | MET |
| `data-mode` tracked/untracked fork | MET (bodies deferred to #1308/#1309) |
| Loading / error / auth state shells | MET — `'error'` dormant until fetch tasks (documented) |
| Auth → page reauth affordance | MET — `[chartAuth]="store.authFailed()"` + `(reauth)="onReauth()"`; `requiresReauth` correctly NOT wired (dead single-run channel) |

All 6 TEST-FE §3 acceptance bullets have real specs; previously-unspec'd
keyboard/refocus paths are now pinned.

### Thermo-nuclear axis

| Sev | Finding | Disposition |
|---|---|---|
| CRITICAL | Same Escape-refocus reopen as Standards #1 | FIXED + spec-pinned |
| MAJOR | All failing branches untested (Escape, relatedTarget cancel, containsFocus guard) | FIXED — 8 new specs |
| MINOR | `onChartReauth` dropped focus to `<body>` | FIXED — routes through `close()` (refocus + suppress) |
| MINOR | `'error'`/`@case('error')` spec-only reachable | Documented — declared #1308 seam |
| MINOR | `chartAuth` covers `authFailed` only, not `requiresReauth` | Documented as intentional |
| MINOR | `chartResetKey` doc overstated (tracked whole `run`, not status) | FIXED — comment now accurate |
| NIT | Stale duplicate `listMenuFor` comment; dead `!origin` guard; Enter without preventDefault (double-open path); missing `#1307` headers; `as PreviewScanResult` partial cast | All FIXED |
| NIT | Popup instance reused across row swaps — internal state must reset on `[symbol]` change | **Forward note for #1308** (popup is stateless inputs today — chain-cell-popup `effect(cell())` precedent applies when state lands) |

## Test results

- Full suite pre-remediation: **6235/6235 green** (328 suites).
- Full suite post-remediation: **6247/6267 pass** — the 20 failures are
  all in `options-replay-new-run-dialog.component.spec.ts`
  (`ctx_r2.selectedVariant is not a function`): **foreign in-flight work
  from a parallel session** — all four dialog files carry foreign
  working-tree modifications and that spec file appeared in the tree
  between the two runs (+1 suite, +32 tests). Zero overlap with the
  scanner diff; left untouched per scope discipline.
- Scanner suites post-remediation: **97/97 green** (5 suites) — 8 new specs:
  a11y contract, relatedTarget-into-popup cancel, `containsFocus` guard,
  Escape on anchor, **Escape-inside-popup closes + stays closed + refocuses**
  (pins the critical), Enter→focus-into-popup, Re-authorize refocus,
  destroy-with-pending-timer.
- `tsc --noEmit`: clean on all task files (foreign errors unchanged:
  `scripts/bulk-swing-sweep.ts`, `portfolio-dashboard.store.spec.ts`).

## Deferred / disclosed

- `'error'` shell + `error` input: unreachable until #1308's fetch states.
- `data-mode` fork: no body until #1308 (untracked candles) / #1309
  (tracked gallery chart).
- IMPL §3 "popup mouseleave closes immediately": implemented as the
  chain-grid single-choke-point grace close — deliberate, spec-pinned.
- #1306 block's identical `as PreviewScanResult` fixture cast in
  `scanner.component.spec.ts` — foreign-scope nit, left untouched.
- jsdom cannot verify overlay positioning — inherent CDK limitation;
  positions match the #965 shape.
