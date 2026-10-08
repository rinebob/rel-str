# Code Review — Task #778: Account switcher — header-bar button-toggle on both pages

**Topic:** #576 Portfolio Allocation  
**Thread:** #751 Portfolio Visual Consistency  
**Blueprint:** #775 (FE)  
**Task:** #778 — FE: Account switcher — header-bar button-toggle on both pages  
**Reviewer:** Devin + three-axis review (Standards / Spec / Thermo-nuclear sub-agents)  
**Date:** 2026-10-10  
**Verdict:** PASS — one major finding remediated during review (shared  
`AccountSwitcherComponent` extraction), verified green afterward.

## Scope reviewed

- `portfolio-dashboard.component.{html,scss,ts,spec.ts}` — switcher moved
  into the header bar, `accountName`-only labels, non-agentic chip
- `allocation-page.component.{ts,spec.ts}` — account `mat-tab-group`
  replaced by the pill row; header + subtabs render once per selection
- `components/account-switcher.component.ts` — **new**, extracted during
  review to resolve the duplication finding

## Standards axis

- **No hard violations.** No `as any`/`as never`, no new `any`
  signatures, no dead code left behind (`account-tabs` wrapper removed
  cleanly), `MatButtonToggleModule` now lives only inside the shared
  component — dropped from both page imports.
- **Duplicated Code (was minor→major cross-axis):** the ~18-line
  switcher block was verbatim-duplicated across both templates with the
  specs asserting parity — resolved by extracting
  `AccountSwitcherComponent` (inputs: `accounts`, `selectedIndex`;
  output: `select`). The `.non-agentic` chip now exists once, on
  `--mat-sys-*` tokens, replacing allocation's hard-coded hex variant.
- **Nit fixed:** handler names `onTabChange`/`onAccountTab` →
  `onAccountSelect` (§8 naming — no longer a tab).
- **Nit fixed:** stale doc comments still describing "one mat-tab per
  RH account" on the page file and spec header.

## Spec axis — acceptance criteria

| AC | Result |
|---|---|
| Button-toggle replaces account `mat-tab-group`, one click per switch | PASS — both pages |
| Labels render `accountName` only, no account number | PASS — spec asserts numbers absent |
| Non-agentic flag inside label, same tooltip/ARIA | PASS — now enforced structurally by the shared component |
| `change`/`value` wired to existing `selectedAccountIndex`/select paths; no store changes | PASS — `(select)` → `onAccountSelect` → `store.selectAccount(index)`; stores untouched |
| Account `mat-tab-group` removed; `MatTabsModule` dropped where unused | PASS — module legitimately retained on both pages (dashboard section tabs, allocation Buckets/Positions subtabs); the TEST plan's "import drops" line was stale |
| TestIDs `acct-tab-*` → `acct-toggle-*`; specs green | PASS |
| Single-account / all-non-agentic edge cases | PASS — `[value]` pre-checks the single pill; chip renders per label. No dedicated spec exercises these (minor coverage note) |
| "In the header bar on both pages" | PARTIAL → deferred — allocation has no header bar yet; the pill row sits under `.page-toolbar` until #779 builds the real header (code comment marks it). Sanctioned split. |

## Thermo-nuclear axis

- **[major → remediated]** Verbatim switcher duplication across two
  templates + parity-asserting specs = a live cross-surface contract.
  Extracted `AccountSwitcherComponent` — one component deletes the
  synchronization burden. Verified: `tsc --noEmit` clean, 22/349 suites
  green.
- **[minor → remediated]** Allocation switcher rendered ungated during
  loading/zero-accounts (empty bordered strip) — moved inside the
  existing `@if (store.accounts().length)` guard.
- **[minor → remediated]** `.mat-button-toggle-label-content` selectors
  can't match under emulated encapsulation (dead CSS on both pages) —
  removed; the only selector that ever applied
  (`.mat-button-toggle { font-size }`) was ported into the shared
  component.
- **[nit → remediated]** Spec's `?? fixture.nativeElement` fallback
  would silently widen query scope — removed so a missing active tab
  body fails loudly.
- **Acknowledged behavior change:** the single subtab `mat-tab-group`
  now persists Buckets/Positions selection across account switches
  (was per-account before) — arguably better UX, noted deliberately.
- **Test-hygiene note:** `component.onAccountSelect(1)` invokes the
  handler directly rather than clicking the DOM toggle; allocation's
  spec covers the DOM-level `(change)` path, so the binding is proven
  on one surface.

## Test run

```
npx jest src/app/features/portfolio-dashboard --coverage=false
→ 23 suites, 353/353 pass (incl. 4 dedicated switcher tests)
npx tsc --noEmit -p tsconfig.app.json → clean
```

## Round-2 re-review (post-remediation diff)

All three axes re-ran on the final diff. Verdicts: **clean — no new
critical/major/minor findings.** The extraction verified sound:

- Contract: `AccountState[]` (dashboard) and `AccountInfo[]`
  (allocation) both assignable to `readonly AccountInfo[]` — no casts.
- `(selectionChange)` → `onAccountSelect` → `selectAccount(index)`
  wiring verified; `MatButtonToggleGroup.change` fires only on user
  interaction, so no init-time emit.
- TestIDs and chip ARIA/tooltip byte-identical to the pre-refactor
  markup.
- Encapsulation: parents style only the host element; inner group/chip
  styles live inside the component where they can actually match.
- Dead `.non-agentic` rule removed from allocation-page styles (its only
  consumer moved into the component).

### Round-2 nits closed during this pass

- Output renamed `select` → `selectionChange` (native-event shadowing).
- Deselect guard: re-clicking the active pill emits `undefined` from
  `MatButtonToggleGroup` — swallowed in `onSelect` so an account must
  stay selected (pre-existing edge the refactor exposed).
- Added `account-switcher.component.spec.ts` — pill render, name-only
  labels, chip flagging, emit-on-click, no-emit-on-reclick (4 tests).

## Verdict

**PASS.** All ACs met or sanctioned-deferred; the major finding and all
actionable minors were fixed during review and re-verified across two
rounds. Ready for `/proj qa 576 778`.
