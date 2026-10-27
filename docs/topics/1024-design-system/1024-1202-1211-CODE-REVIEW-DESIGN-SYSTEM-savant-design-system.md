**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1202  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1211  
**Domain:** DESIGN-SYSTEM  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-24  
**Last Updated:** 2026-10-24  

# CODE-REVIEW — #1211 FE: /dev/ds palette lock

## Verdict: PASS

All three axes passed with no critical or major findings. Three minor
findings were fixed in-review (see "Fixes applied"); remaining items
are nits or deliberate deferrals, listed below.

## Scope reviewed

- `src/app/features/ds-gallery/ds-gallery.component.ts` (+~170) —
  explicit `dark|light` host attr, `PaletteLock` +
  `lockPalette`/`clearPaletteLock` (`ds-gallery.palette-lock`),
  `hueOf`/`hueDistance`/`upAdjacency` (50° band), `SHIPPED_ACCENT`
  `'current'` resolution, app-wide accent preview
  (`appAccentPreview` + `document.documentElement` push, self-cleaning
  on destroy).
- `ds-gallery.component.html` (+~25) — Lock/Clear readout, `⚠
  adjacency` chip on the up-picker, live Δhue on the direction-badge
  demo, `App` preview chip.
- `ds-gallery.component.scss` (+~144) — full `--ds-accent` family
  derivation from `--picker-accent` in both modes,
  `:host[data-theme='light']` restate of the 30 dark-differing `--ds-*`
  literals (verbatim parity with `_tokens.scss`), `:host[data-theme='dark']`
  `--mat-sys` block completed 19→31 keys (verbatim parity with
  `styles.scss` `:root`).
- `ds-gallery.component.spec.ts` (+~100) — lock round-trip across a
  second TestBed instance, clear-lock, adjacency warn/clear, circular
  hue math incl. wrap-around, explicit attr, app-preview push/cleanup/
  self-clear-on-destroy, live accent-tracking.
- `scripts/verify/design-system-palette-lock-1211.{ts,md}` (new) —
  19-check static relay: real dart-sass compile, explicit-attr pin,
  `--ds-accent` family binds, light-restate + dark-mirror parity parsed
  from shipped sources, lock/adjacency presence, no-leak guards,
  `SHIPPED_ACCENT` parity, persistence keys.
- `scripts/verify/run-all.ts`, `scripts/verify/README.md` — registration
  + index row.
- `docs/topics/1024-design-system/1024-1161-1194-IMPL-*.md` — Phase 3
  marked shipped; locked literals recorded (`#22d3ee` / `#00e676` /
  `#ff3366`).

## Standards — PASS

- Relay mirrors the #1209 conventions exactly (`check()` helper,
  `createRequire` + dart-sass `compile` through vendored includePaths,
  comment stripping, SKIP-exit-0 when `node_modules/savant-ds` absent).
- Both parity pins verified verbatim by hand: all dark-differing `--ds-*`
  keys restated; all 31 `--mat-sys-*` bridge keys mirrored.
- localStorage keys namespaced `ds-gallery.*`; specs follow jest idioms
  with per-test `localStorage.clear()` and `restored.destroy()` cleanup.
- No secrets, no dead imports, comments match code after in-review fix.

## Spec — PASS

| AC | Result | Evidence |
|---|---|---|
| Explorer binds shipped `--ds-*` names, host-scoped | MET | Host binds `--ds-up`/`--ds-down`/`--picker-accent` inline; SCSS derives the full `--ds-accent` family; explicit `data-theme` never attributeless; light restate + dark mirror parity-pinned |
| Save/compare round-trips after refresh | MET | Second-TestBed-instance spec restores `savedAccents`, `savedPalettes`, `lockedPalette` |
| Final hexes recorded for baking | MET | `lockPalette` → `ds-gallery.palette-lock`; locked values on issue comment 6381153934 + IMPL doc Phase 3 |
| Green-family adjacency vs `--ds-up` | MET | `hueOf`/`hueDistance` + `upAdjacency` <50° warn on up-picker + direction-badge Δhue; locked cyan↔up Δ ≈37° adjudicated visually by user |

The `App` preview's `<html>` writes are a deliberate, documented
exception — color custom properties only, `dataset.theme` read never
written, self-clearing; relay-pinned.

## Thermo-nuclear — PASS

- Effect hygiene clean: `applyAppAccent` writes only DOM properties, no
  signals → no re-trigger loop; conditional tracking via `??` covers
  `isDark` only on the `'current'` path; `appliedKeys` teardown exact.
- Hue math hand-verified (`#00ff9d`→157°, `#22d3ee`→188°, wrap-around
  cases); `#rrggbb` assumption matches all inputs (presets + color
  input).
- SCSS specificity sound: host custom-prop declarations always beat
  inherited `<html>` values → light preview under dark app isolated.
- Relay genuinely tests claims: real compile, source-parsed parity,
  quote-normalization aware block extraction.

## Test results

```text
jest ds-gallery    16/16
jest full suite    4482/4482 · 259 suites
verify relay       19/19
git diff --check   clean (CRLF notices only)
```

## Fixes applied in-review

1. Stale header comment — "dark toggle sets data-theme=\"dark\""
   contradicted the explicit-attr contract; rewritten (ts:12-14).
2. `SHIPPED_ACCENT` drift gap — component copies of `--ds-accent`
   literals unpinned; added relay check 19 + guide item 10.
3. `applyAppAccent` comment honesty + caveat — derivations differ from
   the SCSS accent blocks by design (wider `--mat-sys-tertiary`
   coverage); comment now says so and notes `dataset.theme` is read at
   apply time (app-theme flip mid-preview needs an accent re-pick).
4. `PaletteLock.accent: string | null` → `string` — `effectiveAccentHex`
   can't return null.
5. Storage error string duplicated in `persist`/`clearPaletteLock` →
   `STORAGE_ERR_MSG` const.
6. `upAdjacency().delta` raw float in templates → `Math.round`.
7. Spec `document.documentElement.dataset.theme` inline cleanup →
   `afterEach` deletion (mid-test failure can't leak).
8. Spec gap: app-preview live accent-tracking now covered (16th spec).
9. Relay docstring item 8 stale ("never touches documentElement");
   check-name "(all 31 keys)" → dynamic count.
10. IMPL doc Δhue "≈39°" → ≈37° (recomputed).

## Nits (deferred, non-blocking)

- File sizes: component ~620 / scss ~815 / html ~430 lines exceed the
  guideline's 400-line smell threshold — accumulated by design across
  #1041/#1108/#1161; a future split (palette logic out) may be worth a
  thread but is out of scope here.
- Exported types/constants (`DsDemoKind`, `ACCENTS`, …) unused outside
  the file — intentional data-driven surface.
- `upHex()!`/`downHex()!` non-null assertions — safe via UI flow;
  'custom' handled first.
- `hueOf` assumes `#rrggbb`; achromatic colors report hue 0 (could
  false-warn) — all inputs are hex presets/`input[type=color]`.
- Relay's no-leak regex scans `cssRaw` un-stripped (fail-loud direction;
  a comment containing `:root` on a `:host`-less line would false-fail).
- Redundant double DOM write on preview toggle-on (idempotent).
- App preview `dataset.theme` read is non-reactive — flipping app theme
  mid-preview needs an accent re-pick (documented in comment + UAT).
