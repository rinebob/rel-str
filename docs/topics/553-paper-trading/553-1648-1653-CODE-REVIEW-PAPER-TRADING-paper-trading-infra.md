**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1648  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1653  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# CODE-REVIEW — #1653 FE-IMPL: symbol-review route + shell + queue picker (Phase 1)

## Scope reviewed

| File | Change |
|------|--------|
| `src/app/core/common/interfaces.ts` | `AppRoutes.SYMBOL_REVIEW = 'signals/symbol-review'` |
| `src/app/core/common/constants.ts` | `CallableName` ×4, `PAGE_INFO` entry, Signals nav item |
| `src/app/core/core-routes.ts` | lazy route + `authGuard` |
| `src/app/core/core-routes.spec.ts` | journey list + parity map + `resolvePageInfo` entries |
| `src/app/core/common/nav-sections.spec.ts` | Signals item list updated |
| `src/app/features/savant-trader/services/signal-review.service.ts` (+spec) | new — 4 `httpsCallable` wrappers |
| `src/app/features/savant-trader/stores/signal-review.store.ts` (+spec) | new — SignalStore, keyed bundle + seq guard |
| `src/app/features/savant-trader/pages/symbol-review/` (4 files) | new — two-pane shell + picker + empty states |

## Pass protocol

```text
First pass complete — 3 majors (stale-bundle contamination, dot-never-clears, viewport collapse), ~10 minors/nits across Standards/Spec/Thermo axes; all fixed in-gate
Second pass complete — no new findings; every first-pass finding accounted for; error paths (stale response, stale error, cross-symbol failure, first-load failure) re-examined and spec'd
Convergence: PASS — two passes, clean second pass; no third pass needed
```

## Findings & disposition

### Majors (fixed in-gate)

| # | Finding | Fix |
|---|---------|-----|
| M1 | Keep-last-good bundle leaked across symbols — a failed select kept the previous symbol's `occurrences` while `selectedSymbol` already pointed at the new one; Phase 2's checkbox rows would have minted/deleted against mislabeled data (`store.ts`, spec enshrined it) | Bundle collapsed into one keyed record `SignalReviewBundle { symbol, previousOpenedAt, openedAt, occurrences }`; template renders it only while `bundle.symbol === selectedSymbol()`; 2 specs pin it (`"never renders a kept bundle under a different selection"`, `"a failed select keeps the prior bundle keyed to its own symbol"`) |
| M2 | New-signal dot never cleared in-session — `hasNewSignal` derived from the queue row's `lastOpenedAt`, only refreshed by `loadQueue`; opening a symbol stamped the server but the dot stayed lit | Success patch propagates `res.openedAt` into `queueRows[].lastOpenedAt`; spec pins dot-clears-after-select |
| M3 | `.symbol-review { height: 100% }` resolved against auto-height host — two-pane layout collapsed to a content strip; picker overflow never engaged | `calc(100vh - var(--header-height, 48px))` + `min-height: 400px` + `overflow: hidden` — the sibling page convention |

### Minors (fixed in-gate)

- Invented `--dse-border`/`--dse-accent` vars + `rgba`/`#ff7a7a` literals → `--mat-sys-*` tokens throughout (outline-variant borders, surface-container panes, primary-container selected, primary dot, error-container banner)
- `core-routes.spec.ts` parity — `signals/symbol-review` added to the journey list, `AppRoutes` parity map, and `resolvePageInfo` case
- First-load failure showed "No symbols" + error banner together → error branch now gates inside the empty-queue arm
- Session store re-entry showed a stale bundle silently → `ngOnInit` re-opens a retained selection (deliberate re-fetch + re-stamp)
- `DatePipe` dead import, `flush` dead helper, `occurrences` indexed-access type → removed / `SignalReviewOccurrence[]` named via `SignalReviewBundle`
- Missing coverage per TEST doc: same-day dot boundary (`SAMEDAY` row), stale-error discard, empty-occurrences + cross-symbol component states, re-open-on-init — all added
- `aria-current` on the selected picker row

### Deferred / informational (not blocking)

- **Naming collision** (Standards #3, Thermo m1): `SignalReviewStore`/`SignalReviewService` back `/signals/symbol-review` while `SignalReviewFacade`/`SignalReviewUiStore` serve `/signals/review`. Names mirror the BE callable domain (`getSignalReviewQueue`/`getSignalReviewBundle`) and the IMPL doc mandates the filenames — kept as spec'd; revisit in #1654 if the confusion materializes.
- **`queueSeq` guard** — `loadQueue` has no stale-response guard (single caller today); Phase 2's Refresh affordance should add it.
- **Mint/delete surface shipped a phase early** — `generatePaperSignalTrades$`/`deletePaperTrades$` + their `CallableName` entries have no Phase-1 caller; AC2 mandates all four wrappers and the BE callables are deployed. Rides forward to #1654.
- **Stamp-on-every-read semantics** (Thermo m4): every bundle fetch advances `lastOpenedAt`, so Phase-2's post-toggle refetches will move the divider — flag to the thread before #1654 lands (BE-side `signal-review-callables.ts`, not this task's file).
- **Same-day dot granularity** (Spec semantic flag, Thermo m2): `lastDailySignalDate > lastOpenedAt` is the documented literal; a signal bar-dated the day of the last open cannot flag (ISO prefix sorts after the bare date). Doc-faithful; commented in the store + spec'd.

### Explicitly clean

- SDK contract parity — all four `CallableName` literals match `functions/src/index.ts:173-179` exports; parity spec pins them; `httpsCallable` + `runInInjectionContext` + `.data` unwrap is a verbatim `PaperTradingService` clone
- `bundleSeq` guard is race-free (synchronous `patchState`, covers success + error paths, newest select always owns `bundleLoading`)
- Feature-state convention — dedicated SignalStore + dumb OnPush component, zero component feature state
- Deliberate no-auto-select — correct: selection is a write (stamps `openedAt`)
- Route wiring — `authGuard`, exhaustive `Record<AppRoutes, PageInfo>`, `pathMatch: 'full'` sibling redirect doesn't shadow
- Spec quality — deterministic Subject sequencing, external-behavior assertions, honest fixtures

## Test results

- Focused: **158/158** (signal-review.service 5, signal-review.store 8, symbol-review.component 10, core-routes + nav-sections suites)
- Full suite: **337/337 suites, 6,395 tests** green
- tsc `--noEmit`: clean on all task files. One foreign error in `topic-viewer.store.ts` (uncommitted #1696 session work — `errMessage` unresolved, `resolvedIssueMap` type errors) — not in scope, reported to the user.

## Verdict

**PASS** — all three axes converged; the three majors were fixed in-gate and re-verified; ACs 1–5 met.

Next: `/proj qa 553 1653`
