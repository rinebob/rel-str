**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #698  
**Task:** #700  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** CODE-REVIEW  
**Status:** Complete — PASS (3 finding rounds, converged at round 4)  
**Created:** 2026-09-29  
**Last Updated:** 2026-09-30  

# Code Review — #700 FE NavSection model + NAV_SECTIONS data

Three-axis review (Standards / Spec / Thermo-nuclear), iterated until no
new findings. Scope: `NavSection` + slimmed `NavItem` (`interfaces.ts`),
flat `NAV_MENU_ITEMS` array replaced by grouped `NAV_SECTIONS` + derived
flat export (`constants.ts`), new `nav-sections.spec.ts` contract suite,
and review-round fallout: dead header nav loop excised
(`header.component.{ts,html,scss}`, `styles.scss`, `_mixins-global.scss`),
one-line spec fixes (topic-viewer, option-chain), PRD typo fix.

`NAV_MENU_ITEMS` remains as `NAV_SECTIONS.flatMap(s => s.items)` — the
impl plan's explicitly allowed compat path until sidenav (#701) and
header (#702) migrate to sections.

## Findings by round

### Round 1

- **MAJOR (fixed)** — `header.component.html` `@for`/`external === true`
  loop was provably dead (all 18 items non-external) and silently
  orphaned `SelectStockDialogService` — its only call site. Deleted loop
  + `handleOpenSymbols`/`handleNavigation`/dialog injection/
  `NAV_MENU_ITEMS`/`UpperCasePipe` imports. **Behavioral note (flagged
  for owner):** the Select Stock dialog is now unreachable UI-wide —
  consistent with the PRD target header (no nav items, #702); landed two
  tasks early as the cheapest honest resolution.
- **MINOR (fixed)** — every data row repeated `mobileOnly: false,
  external: false, target: '_self'` with zero readers.
- **MINOR (fixed)** — spec pinned the dead `external` field
  (`external === false` for all items).
- **MINOR (fixed)** — `documentation`/`contact` absence unasserted.
- **NIT (fixed)** — `option-chain` spec found item by volatile display
  text → `i.href === AppRoutes.OPTION_CHAIN`.
- **NIT (fixed)** — no uniqueness guards.

### Round 2

- **MINOR (fixed)** — round-1 excision left orphans:
  `globalTopnavMenuCssClass` + `handleTopnavMenuOpen` (dead members),
  `MatMenuModule`/`RouterModule` (dead imports), `.nav-button` scss rule,
  `.global-topnav-menu-css` styles.scss block.
- **MINOR (fixed)** — `NavItem` carried four dead optional fields;
  removed entirely — `NavItem = {name, text, href}`.
- **MINOR (fixed)** — `topic-viewer` spec `nav?.external` became vacuous
  (`undefined` is falsy forever) — line deleted.
- **NIT (fixed)** — `''` accepted as a valid nav href (redirect path in
  the route set); auth deny-list keyed only on `name`; `''`-tail count
  only implicitly guarded; flatMap test near-tautological → strengthened
  to identity check (`indexOf`).

### Round 3

- **MINOR (fixed)** — `registeredPaths()` still accepted redirect routes
  (`signals`, `options`, `chart`, `logout`); now filters
  `r.redirectTo === undefined` and `'logout'` joined the href deny-list.
- **NIT (fixed)** — dead `AppRoutes` members (`BLOG`, `CHAT`,
  `CHART_TWO`) + ~15-line commented enum block removed; `NavItem` gained
  a doc comment; orphaned `globalTopnavMenuCss`/`globalTopnavMenuButtonStyles`
  mixins deleted; `openSidenav` tightened to `output<void>` (consumer
  ignores the payload); stale constants comment corrected; PRD:24
  "Positions" → "Portfolio" (typo-level inconsistency vs the normative
  table).

### Round 4 — CONVERGED

All six round-3 fixes verified landed; fresh-eyes probe found **no new
findings**. Spec axis confirmed all 4 acceptance criteria met across
every round.

## Spec compliance (final)

1. Groups match PRD table exactly — `constants.ts` + per-section
   `it.each` asserts (labels, order, item texts). ✅
2. Every href resolves to a registered *component* route — spec builds
   the set from real `CORE_ROUTES` children minus redirects; fails loud
   if children absent. ✅
3. Retired items absent — 17 hrefs + auth names/hrefs asserted. ✅
4. `NAV_MENU_ITEMS` derived flat — identity + order asserted; all
   consumers compile. ✅

## Explicit deferrals (documented, not findings)

- **Select Stock island (~17 files)** — `features/select-stock/` +
  `dashboard-v2/select-stock-panel/` subtree reachable only through the
  removed dialog entry point; `providedIn: 'root'` → tree-shaken, zero
  bundle cost. **#702 owns teardown** (it inherits the legacy-surface
  decision).
- **sidenav `handleTestNavigation` + `RouterModule`** — pre-existing
  dead code; #701 edits that file next.
- **`signal-history`/`signal-action-report`** flat placement — PRD
  deferred. `core.component.ts` console.log — pre-existing.

## Test results

- Full suite (final): **162 suites / 2308 tests green**.

## Verdict

**PASS** — converged after 3 finding rounds. Interim effect for QA:
header topnav button row is gone (menu, title, refresh-time, auth block
remain); Select Stock dialog unreachable pending #702.
