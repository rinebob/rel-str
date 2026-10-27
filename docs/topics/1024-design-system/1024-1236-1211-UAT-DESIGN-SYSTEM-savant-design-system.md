**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1236  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1211  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-24  
**Last Updated:** 2026-10-24  

# UAT — #1211 FE: /dev/ds palette lock

## Scope

Task #1211 formalized the `/dev/ds` explorer under the shipped `--ds-*`
taxonomy: accent presets + custom picker drive the full `--ds-accent`
family, up/down pickers drive `--ds-up`/`--ds-down`, the host `data-theme`
is always explicit `dark|light`, the palette **lock** persists
accent/up/down/mode to `ds-gallery.palette-lock`, the `App` preview
temporarily pushes the accent onto real app pages, and the accent↔up
hue-adjacency check warns when a green-family accent crowds `--ds-up`.

**Locked palette (recorded for SHARED baking):**
`--ds-accent #22d3ee` (cyan) · `--ds-up #00e676` (neon) ·
`--ds-down #ff3366` (neon). Mint `#00ff9d` retained as a saved plan-B.

## Acceptance criteria (task #1211)

1. Explorer controls bind the shipped token names, host-scoped (no
   app-state leak).
2. Save/compare round-trips after refresh.
3. Final accent + up/down hexes recorded in the doc/issue for baking.
4. Up-vs-accent adjacency verified when accent is green-family.

## Prerequisites

- Repo `rel-str` on `prod` with the #1211 working-tree changes present.
- `npm install` already run (`node_modules/savant-ds` present for the
  verify relay).
- Dev server: `npm start` → `http://localhost:4210/dev/ds`.

## Scenarios

### S1 — Explorer binds shipped token names (AC1)

**Start:** dev server running, open `/dev/ds`.
**Steps:**
1. Click accent preset chips (Cyan, Mint, etc.) — watch the accent
   preview cards and the token inspector.
2. Pick an up/down swatch on the direction pickers.
3. `npx tsx scripts/verify/design-system-palette-lock-1211.ts`
**Expected:** accent changes visibly re-derive the `--ds-accent` family
(`--ds-accent`, on-accent, containers, border, glow); direction badges
recolor on `--ds-up`/`--ds-down`; relay prints `ALL 19 CHECKS PASSED`.
**Result:** PASS — relay 19/19 (2026-10-24); user previewed presets live.

### S2 — No app-state leak (AC1)

**Start:** app running dark mode, `/dev/ds` open.
**Steps:**
1. Toggle the gallery's own Dark/Light control — confirm the *light*
   preview renders genuinely light (no dark-token bleed) while app
   chrome stays dark.
2. Toggle `App` chip ON, navigate to other pages, return, toggle OFF
   (or leave `/dev/ds`).
**Expected:** light preview is light regardless of app mode; gallery
never changes `data-theme` on `<html>`; app accent vars are removed on
toggle-off/destroy.
**Result:** PASS — host emits explicit `light`/`dark` (spec: explicit
attr test); app-preview cleanup spec-pinned; user nav'd app preview and
confirmed the light preview renders genuinely light under a dark app
(2026-10-24: "lgtm").

### S3 — Save/compare round-trip after refresh (AC2)

**Steps:**
1. On `/dev/ds`, pick accent + up/down + mode, name a palette (e.g.
   `cyan-01`), Save.
2. Save a swatch.
3. Hard-refresh the page; re-open the palettes aside; apply the saved
   palette; use compare.
**Expected:** saved accents + named palettes persist; apply restores
accent/up/down/mode; compare shows stored colors.
**Result:** PASS — spec round-trips through a second TestBed instance
against the same localStorage; user saved palette `cyan-01`.

### S4 — Palette lock records + survives refresh (AC3)

**Steps:**
1. Set accent=Cyan (`#22d3ee`), Up=Neon (`#00e676`), Down=Neon
   (`#ff3366`), mode dark.
2. Click **Lock current**; note the lock readout hexes.
3. Refresh → readout still present; click **Clear** → gone.
**Expected:** `{accent, up, down, dark, lockedAt}` persisted to
`ds-gallery.palette-lock`; `'current'` resolves to the shipped hex.
**Result:** PASS — user clicked Lock; lock readout shows the locked
hexes; values recorded on issue comment 6381153934 + IMPL doc Phase 3.

### S5 — Green-family adjacency (AC4)

**Steps:**
1. Pick Mint (`#00ff9d`, ~10° from Neon up) — confirm `⚠ adjacency`
   chip on the up-picker and live Δhue on the Direction badges card.
2. Re-pick Cyan (`#22d3ee`, Δ ≈37° — inside the 50° band) and eyeball
   the LONG badge next to accent-colored chrome.
**Expected:** warning fires inside the band; LONG reads "green = up",
not "accent".
**Result:** PASS — user adjudicated: "way more than enough contrast".

### S6 — App-wide accent preview

**Steps:** pick Cyan → click `App` → navigate signal review, portfolio,
charts, menus, dialogs → switch to Mint (preview re-pushes live) →
toggle `App` off.
**Expected:** accent moves both `--ds-accent` and `--mat-sys` primary
chrome on real pages; follows accent changes; cleans fully on off.
**Result:** PASS — user nav'd multiple screens, reported "looks pretty
good"; cleanup + live-tracking spec-covered.

### S7 — Regression: explorer surface intact

**Steps:** confirm all prior explorer features still work — token
inspector (Inspect button), compare dropdown, theme toggle, widget
demos (9 cards), storage error state.
**Expected:** no regressions.
**Result:** PASS — relay checks 16–18 pin swatch/palette keys,
inspectColors, compareName; widget + entries specs green.

## Automated evidence

```text
npx jest ds-gallery      16/16 — lock round-trip, clear, adjacency,
                          hue math, explicit attr, app-preview
                          push/cleanup/self-clear/live-tracking
npx jest                 4482/4482 · 259 suites
verify relay             19/19 — compile, explicit attr, --ds-accent
                          family, light-restate + dark-mirror parity,
                          SHIPPED_ACCENT parity, lock, adjacency,
                          no-leak + self-cleaning, persistence
git diff --check         clean
```

## Traceability

| AC | Scenarios |
|---|---|
| AC1 shipped names, host-scoped | S1, S2 (+ relay 1–5, 14–15) |
| AC2 save/compare round-trip | S3 (+ spec) |
| AC3 final hexes recorded | S4 (+ issue comment + IMPL doc) |
| AC4 green-family adjacency | S5 |

## Manual UI/UX refinement pass

User navigated the app with `App` preview on across multiple screens
and confirmed the treatment; judged cyan↔neon-up adjacency sufficient;
locked the palette. Gallery is a `/dev/ds` internal tool surface —
refinement scoped to explorer behavior, not production UI polish
(screen-by-screen polish is the deferred roadmap pass).

## Findings

None open.
