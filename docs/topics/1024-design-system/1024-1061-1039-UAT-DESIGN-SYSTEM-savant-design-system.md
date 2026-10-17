**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** design-system-foundation  
**Issue:** #1061  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1039  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# UAT — #1039 ST consumption wiring

**Result: PASS** — all four ACs verified; one sibling-relay staleness
finding remediated during QA.

## Scenarios

### S1 — Relay green

`npx tsx scripts/verify/design-system-consumption-1039.ts` →
`=== ALL CHECKS PASSED ===` — 37 checks / 0 failures: package declared +
junction → sibling checkout, includePaths on `build` and `test`,
`@use 'tokens'` in `src/styles.scss`, no `src/` shadow, every `--ds-*`
in emitted `:root` + dark block, run-all registration + README row.

### S2 — Build green, tokens in emitted bundle

`npm run build` → clean (~20.6s). `dist/browser/styles-*.css` carries
all 27 `--ds-*` declarations and the `[data-theme="dark"]` override
block inside `:root`.

### S3 — Runtime availability

Bundle-level proof is the mechanism: the global stylesheet emitted to
`index.html` carries `:root { --ds-*: var(--mat-sys-*) … }` — identical
to what `document.documentElement` computes at runtime (custom-property
`var()` binds at computed time; Material's `--mat-sys-*` block is in
`src/styles.scss`). User confirmed the live dev server serves the app
post-wiring after a stale-process restart (the initial
`Can't find stylesheet to import` was an old `ng serve` holding
pre-`includePaths` config — a restart loaded the new `angular.json`).
Optional manual spot-check remains: devtools → `:root` computed styles →
`--ds-surface` resolves to the `--mat-sys-surface` value.

### S4 — Sibling regression

All prior relays green: `1034`, `1035`, `1036`, `1037`, `1038` —
`=== ALL CHECKS PASSED ===`.

## Findings

- **F1 — #1034 relay stale proxy check (remediated).** Its dry-run check
  asserted `savant-ds` appears in `npm install --dry-run` output — true
  only when npm plans a change. Once #1039 declared+installed the dep at
  that spec, dry-run reports up-to-date work and omits the name →
  false-FAIL. Fixed: exit-0 alone proves spec resolution (dry-run exits
  non-zero on unresolvable `file:` paths). Re-verified green.
- **F2 — stale `ng serve` collision (environmental, documented).**
  Running dev servers must be restarted after `angular.json` gains
  `includePaths`; watch reloads `styles.scss` but not the Sass config.
- **F3 — unrelated baseline warning:** `NG8113: UpperCasePipe unused in
  GalleryTicketDialogComponent` — in-flight #965 dialog work, untouched.

## Refinement

N/A — wiring task; no component consumes `ds.*` mixins yet (#1040+).
