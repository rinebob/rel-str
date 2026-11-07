**Topic:** Misc fixes, refactoring and improvements  
**Topic Slug:** misc-fixes-refactoring  
**Issue:** #1449  
**Task:** #1448  
**Topic Parent:** #300  
**Domain:** SAVANT-TRADER  
**Type:** UAT  
**Status:** Complete — 2026-11-07 — QA PASS (5 live + 2 mechanism-pinned)  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

# UAT — Header avatar: initials circle + account menu

## Scope

Task #1448 replaced the plain-text name label in the app header with an
initials avatar circle, then (per user direction during implementation)
added an accent border/text, turned it into a ds-menu trigger
(Account → `/portfolio`, Logout), removed the standalone Logout
button, and evened out the right-cluster spacing.

Automated coverage: `header.component.spec.ts` — 30/30 (initials
derivation ×3, menu open/items/actions/dismiss ×5, label removal);
`src/app/core` 15 suites / 354 tests; full suite 302/302 green.

## Prerequisites

- Dev server running (`npm start` → `localhost:4210`).
- A signed-in user with a `displayName` (for the initials scenarios).

## Getting to the feature

1. `http://localhost:4210` — any authenticated route shows the app
   header at the top.
2. The avatar is the right-most element in the header, after
   New Order.

## Scenarios

### 1. Avatar renders initials in the same slot

- **Steps:** View the header while signed in.
- **Expected:** Circle with first+last-name initials (or 2-char
  fallbacks) where the text label was — between New Order and the
  right edge. No standalone Logout button.
- **Result:** PASS — user-confirmed live, 2026-11-07.

### 2. Accent text + border, theme-aware

- **Steps:** Toggle the header's dark/light button both ways.
- **Expected:** Initials + circle border render in the app accent
  color and stay readable in both themes.
- **Result:** PASS — user-confirmed live, 2026-11-07.

### 3. Even spacing in the right cluster

- **Expected:** Uniform gap across theme toggle → fullscreen →
  New Order → avatar.
- **Result:** PASS — user-confirmed live, 2026-11-07.

### 4. Avatar menu opens and dismisses

- **Steps:** Click the avatar → menu opens (Account, Logout). Click
  outside → closes. Re-open → click the avatar again → closes.
- **Result:** PASS — user-confirmed open behavior live; dismiss paths
  spec-pinned (`document.body.click()` + second-trigger-click specs).

### 5. Account navigates to the portfolio dashboard

- **Steps:** Avatar → **Account**.
- **Expected:** Route lands on `/portfolio` (Portfolio Dashboard).
- **Result:** PASS — user-confirmed live, 2026-11-07 (menu open +
  navigation checked); spec pins `navigate(['/portfolio'])`.

### 6. Menu Logout signs out

- **Steps:** Avatar → **Logout**.
- **Expected:** Session ends; header flips to the signed-out view
  (Login / Sign up). The standalone Logout no longer exists — the menu
  item is the only sign-out control.
- **Result:** MECHANISM PASS — spec-pinned (`authStore.signOut` called
  on menu-item click); deliberately not exercised live (ends the QA
  session).

### 7. Signed-out header unaffected

- **Expected:** Signed-out state still shows Login + Sign up with the
  same even spacing; no avatar/menu.
- **Result:** MECHANISM PASS — spec-pinned (signed-out describe still
  green; `isAuthenticated()` guard unchanged).

## Traceability

| Requirement | Scenario |
|---|---|
| Avatar circle + initials, same position | 1 |
| Accent text + border, light/dark | 2 |
| Even spacing | 3 |
| Menu with Account + Logout | 4, 5, 6 |
| Standalone Logout removed | 1, 6 |
| No regression (signed-out, New Order) | 7 |

## Notes

- Declined review findings recorded in the CODE-REVIEW doc: menu
  Logout has no `loading()` guard (self-destructing item — no
  re-entry); roving-tabindex/arrow-key nav is a repo-wide ds-menu gap.
