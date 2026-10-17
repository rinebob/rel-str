**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #958  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #1055  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

# Code Review — #1055 Option-chain deep link + gallery-card affordance

## Scope reviewed

Uncommitted working-tree diff (6 files):

- `pages/option-chain/option-chain.component.ts` — `?symbol=X` deep link: a `takeUntilDestroyed` `queryParamMap` subscription normalizes the param (`.trim().toUpperCase()`) and feeds the same `setSymbol` + `loadChain` path as the header input; `distinctUntilChanged` on the param itself.
- `components/gallery-card/gallery-card.component.{ts,html,scss}` — `Option chain ↗` anchor on the card action row, right-justified (`margin-left: auto`), `[routerLink]` + `[queryParams]` + `target="_blank"` — navigation, not a decision action, so `actionsDisabled`/`actionBusy` don't gate it.
- Specs for both components; `provideRouter([])` added to `gallery-view` + `gallery-group` specs that render cards.

Dialog files are absent from the diff — the affordance started life in the dialog title row and moved to the card per user direction; the earlier dialog implementation was fully reverted.

## Verdict: PASS (after in-review remediation, 1 round)

Three axes (Standards / Spec / Thermo) returned no blockers; all actionable findings remediated and spec-pinned in round.

## Findings & resolutions

| Sev | Axis | Finding | Resolution |
|---|---|---|---|
| MEDIUM | Spec + Thermo (convergent) | **Spec couldn't see a double-load and proved the wrong path.** `mockStore.setSymbol` was a bare `jest.fn` — `symbol()` never changed, so the init spec's `loadChain` came from the subscription's first emission regardless of the snapshot branch, and call counts were unasserted | `setSymbol` mock now applies the real store's normalization (`trim().toUpperCase()` → `symbol.set`); specs assert `loadChain` `toHaveBeenCalledTimes(1)` |
| MEDIUM | Spec | **Stale-param revert.** The subscription compared the incoming param to `store.symbol()`, so a later `queryParamMap` emission still carrying `symbol=AAPL` silently reverted the user's manually-loaded TSLA | `distinctUntilChanged` keyed on the normalized **param** (not the store symbol) — a param that hasn't changed can't re-fire; spec pins it (`?symbol=AAPL` entry → user loads TSLA → unrelated emission carrying AAPL → no revert) |
| MEDIUM | Standards | **`window.open` + hardcoded `'/options/chain'`** — first `window.open` in `src/`; repo idiom is `<a [routerLink]>` anchors (native new-tab/middle-click semantics, no JS handler); literal bypassed `AppRoutes.OPTION_CHAIN` | Converted to `<a [routerLink]="['/' + OPTION_CHAIN_ROUTE]" [queryParams]="{symbol:…}" target="_blank" rel="noopener">`; `openOptionChain()` deleted; specs assert `href`/`target`. `provideRouter([])` added to `gallery-view`/`gallery-group` specs (RouterLink injects ActivatedRoute) |
| low | Standards | **Orphaned docblock** — the `ticketLine` docblock was split from its property by the inserted `openOptionChain` method | Resolved by the anchor conversion — the method no longer exists |
| low | Spec | `?symbol=` literal-empty param uncovered | Spec added — treated as absent, default load preserved |
| low | Thermo | **Stale `dateInput` survives a same-tab deep link** (`resetChainState` omits it) — header-input semantics, slightly wrong for a "latest chain" link | Author note — the card affordance opens a fresh tab/store; same-tab subscription nav is the only reach path. Deferred, documented |
| low | Thermo | Param removal mid-session keeps current symbol (URL stops matching page) | Accepted as designed — no sensible revert target; spec-pinned |
| nit | Standards | File at ~415 lines ("400 → strong smell") | Pre-existing trajectory; flagged only |
| nit | Spec | Issue ACs 3–4 still described the dialog title-row affordance | Issue body updated to the card-row as-built; ACs checked |

## Verified non-issues (Thermo trace)

- Replay/missed emission: `queryParamMap` is BehaviorSubject-backed — no nav can be lost in a snapshot→subscribe gap; entry param + default-load snapshot check produce exactly one `loadChain`.
- Race: param change mid-fetch → `setSymbol` → `cancelInFlight` drops chain/prior/bars subs; `loadChain` cancels again — no stale write-back.
- Click bubbling: `.card-actions`/`.gallery-card` ancestors have no click handlers — anchor needs no `stopPropagation`.
- `takeUntilDestroyed(destroyRef)` correct; scroll listener untouched.

## Evidence

- `npx jest option-chain gallery-view gallery-card gallery-ticket-dialog gallery-group` — **30 suites / 692 tests**, all green (includes 6 new deep-link specs + 2 card-affordance specs).
- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- Pre-existing `NG0953` destroyed-OutputRef warning from `chain-grid`'s `centered` rAF — unrelated to this diff.
