**Topic:** RH Scanner  
**Topic Slug:** savant-trader  
**Thread:** Scanner Row Actions  
**Thread Slug:** rh-scanner-scanner-row-actions  
**Issue:** #1302  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1309  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# Code Review — #1309 FE-IMPL: tracked-mode popup — gallery card chart embed

## Scope

```
src/app/features/savant-trader/pages/scanner/scanner-chart-popup.component.ts
src/app/features/savant-trader/pages/scanner/scanner-chart-popup.component.spec.ts
src/app/features/savant-trader/pages/scanner/scanner-recipe-table.component.ts   (comment only)
src/app/features/savant-trader/pages/scanner/scanner-recipe-table.component.spec.ts
```

## First pass — three axes

### Standards

- `scanCard` is a component-local computed assembling the fabricated
  `GalleryCard` — all required fields present, inert fields documented
  (`symbol` + `allOccurrences` are the only reads the card chart makes
  today — verified against `gallery-card-chart.component.ts`: only
  `card().symbol` ×8 and `card().allOccurrences` ×1 are consumed).
- `key: scan-{symbol}` can't collide with real card keys
  (`${symbol}:${side}`).
- DI seam honored: `GalleryCardChartStore` injected at the popup, stubbed
  at both spec seams (provider + `overrideComponent`) — the
  `LocalBarReadService` graph never loads under jsdom.
- Comments updated to as-built (`@task` tags, `chartPopupStateFor`,
  `bodyView`, `onReauth`).

### Spec (IMPL §5 + TEST-FE §5)

| AC | State |
|---|---|
| Popup body embeds `app-gallery-card-chart` on a fabricated minimal `GalleryCard` | MET — template fork + `scanCard`; spec asserts key/symbol/empty occurrences |
| `GalleryCardChartStore.ensureBars(symbol)` on open; card's own mount effect still ensures | MET — constructor effect (auth-gated after in-gate fix); card effect at gallery-card-chart.component.ts:382 unchanged |
| Daily default from root `GalleryUiStore`; per-card D/W chip card-local; no scanner-side control | MET by construction — the card's `interval` `linkedSignal` reads `chartTimeframe`+`chartTimeframeSeq` internally; zero popup code |
| No gallery toolbar actions | MET by construction — embeds the chart component, not `GalleryCardComponent` (actions live there) |
| Specs per TEST-FE §5 | MET — mount-fork, ensureBars call, fabricated card, auth/error shell passthrough + a table-level traced test |

### Thermo-nuclear

- **MAJOR (fixed in-gate):** the tracked `ensureBars` warm-path fired even
  under the `auth` shell. `GalleryCardChartStore` has no per-symbol clear
  (only `clearCache` + epoch) and its settled error/empty slots are
  terminal — an ensure fired into a dead session would strand the
  post-reauth mount on 'unavailable' forever. Fix: the effect skips the
  warm call while `state() === 'auth'`; on release it refires clean.
  Spec-pinned (fires-on-release test). The untracked fork was already
  safe — its `onReauth` does `clearError` + retry.
- Edge cases re-checked: symbol swap mid-popup refires `sym()` → re-ensure
  + refabricate; `scanCard` memoizes off `sym()` so no effect thrash; the
  card's `IntersectionObserver` falls back to `root: null` (viewport)
  inside the cdk overlay — mounts immediately; `--fc-min-height: 0` keeps
  the 300px popup from clipping the flex-chart floor.
- Spec quality: stubs at both seams; no `as any`; asserts on external
  behavior (DOM, store calls, emitted outputs).

### Findings

| Severity | Finding | Disposition |
|---|---|---|
| major | tracked warm-path burned the gallery store's terminal dedupe slot under the auth shell | fixed in-gate + spec-pinned |
| nit | inert fabrication fields (`side`, `direction`, `status`, `profile`, `actionedAt`) could silently lie if the card chart ever consumes them | documented in the `scanCard` comment — accepted |

## Second pass — union coverage

Re-traced all four changed files against the union of the axes: the
auth-gate edit adds a `state()` read to the effect — `error` still
warms (deliberate: the dormant error shell may be transient and the warm
call is harmless). No spec asserts the pre-fix behavior incorrectly —
the rewritten stale test only drops the scanner-store fetch assertion.
Suite re-run post-fix.

**Second pass complete — no new findings; coverage is complete.**

## Tests

- `scanner-chart-popup`: 26/26 (7 tracked-body specs incl. auth-gate pin)
- `scanner-recipe-table`: 54/54 (incl. traced tracked-popup test)
- Full suite: 342/342 suites, 21,809 tests — green
- `tsc --noEmit -p tsconfig.app.json`: clean

## Pass log

```text
First pass complete — 3 axes; 1 major found + fixed in-gate (auth-window dedupe burn), 1 nit documented
Second pass complete — union coverage re-traced; no new findings
Convergence: PASS
```

## Verdict

**PASS** — gate clear for `/proj qa 1098 1309`.
