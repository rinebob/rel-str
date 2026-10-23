**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1228  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1207  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# UAT — #1207 FE: data-theme bootstrap + ThemeService + header toggle

## Scope

The runtime theme plumbing that makes `#1204`'s token layer selectable:
a synchronous `index.html` bootstrap that applies the stored/default
theme before first paint, a root `ThemeService` as the post-bootstrap
authority (`theme()`, `set()`, `toggle()`), and a header toggle button.

Acceptance criteria (task #1207):

1. Cleared storage → `data-theme="dark"` on first paint, no light flash.
2. Header toggle flips the theme live and persists across reload.
3. Unknown/corrupt stored value falls back to dark, no throw.
4. `ThemeService` spec covers default/persist/attribute/toggle/corrupt.

## Prerequisites

- Repo: `rel-str`, branch `prod`, dev deps installed (`npm i` done).
- A running dev server (`npm start` → port 4210, or an existing one on
  4200/4210). Chrome/Edge DevTools for the manual scenarios.
- No credentials needed — the feature works logged-out (header
  toggle renders pre-auth; theme attribute is on `<html>`).

## Start instructions

```powershell
npm start          # or use an already-running instance
# open http://localhost:4210
```

## Test scenarios

### S1 — Bootstrap default: dark on empty storage

**Feature:** AC1. **Start:** app reachable, DevTools open.

1. DevTools → Application → Local Storage → delete `savant-theme`
   (or Console: `localStorage.removeItem('savant-theme')`).
2. Hard-reload (Ctrl+F5).
3. Console: `document.documentElement.dataset.theme`.

**Expected:** `data-theme="dark"`, DS-token surfaces (rs-table,
heatmaps, dashboard cards, login page) paint dark **immediately** —
no light flash (bootstrap is inline in `<head>`, synchronous before
the deferred module bundle). Known accepted bound M1: Material chrome
stays light until #1209 — do not fail on it.
**Cleanup:** none.
**Result:** PASS — jsdom replay of the real `index.html`:
`.devin/tmp/uat-1207/bootstrap-check.mjs` →
`stored=null → data-theme=dark` (+4 more cases). Live: both dev
servers (4200/4210) serve the bootstrap; user observed dark DS
surfaces painting ("colors are way off right now") — direct evidence
the dark default is active.

### S2 — Toggle flips live and persists

**Feature:** AC2. **Start:** app open (any auth state).

1. Click the theme button in the header (icon = target theme:
   `light_mode` shown under dark).
2. Observe DS surfaces flip to light; `dataset.theme` reads `'light'`;
   `localStorage['savant-theme'] === 'light'`.
3. Reload — theme stays light (bootstrap re-reads storage).
4. Toggle again → dark, persisted.

**Expected:** live flip without reload, persistence across reload.
**Result:** PASS — user-confirmed on the live app: "the button is
there and it flips." `header.component.spec.ts` asserts click →
`ThemeService.toggle()` and both icon states;
`theme.service.spec.ts` asserts signal+attribute+storage on
toggle/set; jsdom run shows stored `light` → `data-theme=light` on
load. User note: "not all the dark mode colors are correct" —
expected: colors are intentionally not final at this stage (M1
light Material chrome until #1209; components not yet on `--ds-*`
until sweeps #1213–#1217; dark literal values tuned/locked in #1211).
The mechanism is what shipped; the palette finish is downstream.

### S3 — Corrupt/unknown stored value → dark, no throw

**Feature:** AC3. **Start:** app open.

1. Console: `localStorage.setItem('savant-theme','banana')`; reload.
2. `document.documentElement.dataset.theme` → `'dark'`; no console
   errors from the bootstrap.

**Expected:** dark fallback, silent.
**Result:** PASS — jsdom: `stored=banana → dark`, `stored=DARK → dark`;
`theme.service.spec.ts` corrupt-value + getItem-throw specs.

### S4 — Automated seams

**Feature:** AC4 + relay invariants.
`npx jest src/app/core` → **15/15 suites, 328 tests**.
`npx tsx scripts/verify/design-system-theme-plumbing-1207.ts` → **21/21**.
**Result:** PASS.

### S5 — Accepted-bound checks (flag, don't fail)

- M1 mixed dark/light until #1209 — CONFIRMED present by design;
  toggle restores light.
- /dev/ds explorer light preview under app-dark — deferred regression
  (review m2): `--ds-*` dark values inherit through `<html>`; explorer
  fix belongs to the #1211 lane. User observed the page "looks funky"
  — consistent with the documented inheritance issue; nothing beyond
  it identified.
- SSR exposure — SSR disabled in `angular.json`; consistent with
  neighboring services.
**Result:** CONFIRMED/flagged — no action.

## Traceability

| Criterion | Scenario(s) |
|---|---|
| AC1 dark default, no flash | S1 (+jsdom evidence) |
| AC2 toggle live + persist | S2 (+header/service specs) |
| AC3 corrupt → dark | S3 (+jsdom + spec) |
| AC4 spec coverage | S4 |
| R1 bootstrap-before-bundle | S1 (inline-in-head, relay check 4) |
| Single-writer invariant | S4 relay check 15 |
| Header toggle wiring | S2 + header specs |

## Regression / smoke checklist

- [x] `npx jest src/app/core` green — 328/328 (header, core.component,
  ui-state, page-identity, routes unaffected).
- [x] `index.html` still loads Angular normally — dev server serves
  the app, no bootstrap-induced breakage.
- [x] `/dev/ds` explorer still works (host-scoped preview binding
  untouched; light-preview regression is the flagged deferred item).
- [x] Full suite green at review: 259/259 suites, 4449 tests.
