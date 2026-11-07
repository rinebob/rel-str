**Topic:** Misc fixes, refactoring and improvements  
**Topic Slug:** misc-fixes-refactoring  
**Issue:** #1448  
**Task:** #1448  
**Topic Parent:** #300  
**Domain:** SAVANT-TRADER  
**Type:** CODE-REVIEW  
**Status:** Complete — 2026-11-07 — PASS (1 round, in-gate polish)  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

# CODE-REVIEW — Header avatar: initials circle + account menu

## Verdict

**PASS** — all three axes clean on the first pass (Standards PASS-with-
nits / Spec MET-WITH-NOTES / Thermo-nuclear MEETS BAR). Zero critical,
zero major. Actionable minors/nits were applied in-gate; two findings
were deliberately declined (recorded below).

## Scope

Task #1448 — "IMPL: Header avatar — replace name label with initials
circle" — plus the user's in-flight extensions during implementation:

- `.user-label` span → `.user-avatar` initials circle in the same header
  slot (`header.component.html`).
- Accent-colored initials + accent border (`--ds-accent-text` /
  `--ds-accent-border`).
- Avatar became a ds-menu trigger: **Account** → `/portfolio`,
  **Logout** → `auth.signOut()`; standalone Logout button removed.
- `gap: 10px` on `.nav-buttons-container` for even right-cluster
  spacing.

Scoped diff: 4 files (header.component .ts/.html/.scss/.spec.ts).

## Standards

PASS-with-nits. Verified the ds-menu convention end-to-end against the
#1348 pilot and siblings: signal open state, `host: (document:click)`
dismiss, trigger + panel `stopPropagation`, `.dse-menu`/`.menu-item`/
`.menu-sep`/`.danger` markup. Theme tokens only, no literals; no dead
code; `AppRoutes.PORTFOLIO_DASHBOARD = 'portfolio'` pin correct.

## Spec

MET-WITH-NOTES — every acceptance point verified: initials derivation
(multi-word/single-word/email-fallback, uppercased), same-position
replacement, theme tokens, accent text+border, Account nav, menu
Logout→signOut, standalone Logout removed, even gap, spec coverage.

## Thermo-nuclear

MEETS BAR — document-click mechanics verified against the pilot;
`onSignOut` cannot reject (AuthStore wraps in try/catch); no clipping/
z-index issues; `gap:10px` doesn't double with any ds mixin margins.

## In-gate polish applied

| Finding | Fix |
|---|---|
| `.user-avatar` missing `font-family: inherit` (UA control font, not Roboto) | added (scss) |
| `initials` indexed UTF-16 code units — emoji displayName → lone surrogate | `[...str]` spread in both branches (ts) |
| menu items lacked `type="button"`; decorative icons announced to SRs | `type="button"` + `aria-hidden="true"` (html) |
| `<div>` inside `<span>` host — invalid nesting | host is now `<div>` (html) |
| falsy displayName+email → `''` initials + "Signed in as null" | `initials()` → `'?'`; new `userLabel()` computed → `'Account'` (ts/html) |
| no focus-visible affordance on the avatar button | `outline: 2px solid var(--ds-accent)` (scss) |
| narrating removal comment in template | removed (html) |
| document-click dismiss + re-click toggle unpinned | +2 specs — `document.body.click()` dismiss, second trigger click closes |

## Declined findings (recorded)

- **`[disabled]="loading()"` on the menu Logout** (flagged by 2 axes) —
  declined on Thermo's reasoning: the item self-destructs on click
  (`avatarMenuOpen.set(false)` runs before `signOut`), so there is no
  re-entry path; the old standalone button needed the guard because it
  persisted.
- **Roving tabindex / arrow-key nav / Escape-close for `role="menu"`** —
  the ds-menu docstring's full contract is unimplemented across every
  consumer (sidenav-menu, slice-menu, bulk-menu, lists-menu all share
  the gap). A repo-wide pattern question, not #1448 scope — candidate
  for a DS-level ticket.

## Test results

- `header.component.spec.ts`: **30/30** (after polish; was 28/28 green
  pre-review, +2 dismiss specs).
- `src/app/core` folder: 15 suites / 354 tests green.
- Full suite: **302 suites / 5320 tests** green (suite count grown by
  concurrent sessions).
